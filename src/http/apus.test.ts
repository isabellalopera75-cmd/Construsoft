import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { crearPresupuesto } from '../infraestructura/basedatos/presupuesto.js';
import { agregarCapitulo } from '../infraestructura/basedatos/edt.js';
import { agregarActividad } from '../infraestructura/basedatos/actividad.js';
import { crearRecurso, type Recurso } from '../infraestructura/basedatos/recurso.js';
import { vencerSuscripcion } from '../pruebas/superusuario.js';
import { VERSION_TERMINOS_DE_PRUEBA, clienteDePrueba, type Cuenta, CARPETA_LEGAL_DE_PRUEBA } from '../pruebas/clienteHttp.js';
import { construirServidor } from './servidor.js';

let app: FastifyInstance;
const { otraIp, pedir, registrar, asistenteCon } = clienteDePrueba(() => app);

before(async () => {
  app = await construirServidor({ carpetaLegal: CARPETA_LEGAL_DE_PRUEBA, secretoSesion: randomBytes(32).toString('hex'), versionTerminos: VERSION_TERMINOS_DE_PRUEBA });
});
after(async () => {
  await app.close();
});

async function llamar(metodo: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, cookie: string | undefined, cuerpo?: unknown) {
  const r = await app.inject({
    method: metodo,
    url,
    remoteAddress: otraIp(),
    ...(cookie ? { headers: { cookie } } : {}),
    ...(cuerpo === undefined ? {} : { payload: cuerpo as object }),
  });
  const json = r.body === '' ? {} : r.json<Record<string, unknown>>();
  return { estado: r.statusCode, cuerpo: json as Record<string, any>, crudo: r.body };
}

/** La empresa con los dos recursos del 06 §8.1 y la unidad m³. */
async function empresaConRecursos(cuenta: Cuenta) {
  const unidades = (await llamar('GET', '/api/unidades?para=APU', cuenta.cookie)).cuerpo.unidades as { id: string; simbolo: string }[];
  const u = Object.fromEntries(unidades.map((x) => [x.simbolo, x.id])) as Record<string, string>;
  const premezclado: Recurso = await crearRecurso(cuenta.contexto, {
    nombre: 'Concreto premezclado 3000 PSI', tipo: 'MATERIAL', unidadId: u['m³']!, precioBase: '500000', ivaPct: '19', precioTotal: '595000', viaCaptura: 'BASE',
  });
  const oficial: Recurso = await crearRecurso(cuenta.contexto, {
    nombre: 'Oficial de obra', tipo: 'PERSONAL', unidadId: u['Jr']!, precioBase: '120000', ivaPct: '0', precioTotal: '120000', viaCaptura: 'BASE',
  });
  const concreto = {
    nombre: 'Concreto 3000 PSI para zapatas',
    unidadId: u['m³']!,
    lineas: [
      { recursoId: premezclado.id, cantidad: '1', rendimiento: '1', desperdicioPct: '5' },
      { recursoId: oficial.id, cantidad: '2', rendimiento: '0.05' },
    ],
  };
  return { u, premezclado, oficial, concreto };
}

describe('APU (02 §6): crear, consultar, editar con control de cambios, desactivar y eliminar', () => {
  let duena: Cuenta;
  let datos: Awaited<ReturnType<typeof empresaConRecursos>>;

  before(async () => {
    duena = await registrar('Constructora APU', '900000340-0', 'apu.admin@construsoft.test');
    datos = await empresaConRecursos(duena);
  });

  test('crear el APU del 06 §8.2: 201, código del servidor y costo directo 636.750 calculado por la base', async () => {
    const r = await llamar('POST', '/api/apus', duena.cookie, datos.concreto);
    assert.equal(r.estado, 201, r.crudo);
    assert.match(r.cuerpo.codigo, /\d/);
    assert.deepEqual(
      { nombre: r.cuerpo.nombre, unidad: r.cuerpo.unidadSimbolo, activo: r.cuerpo.activo, costo: r.cuerpo.costoDirecto },
      { nombre: 'Concreto 3000 PSI para zapatas', unidad: 'm³', activo: true, costo: '636750.000000' },
    );
    assert.deepEqual(
      (r.cuerpo.lineas as Record<string, string>[]).map((l) => [l.recursoNombre, l.cantidad, l.rendimiento, l.desperdicioPct, l.subtotal]),
      [
        ['Concreto premezclado 3000 PSI', '1.000000', '1.000000', '5.000000', '624750.000000'],
        ['Oficial de obra', '2.000000', '0.050000', '0.000000', '12000.000000'],
      ],
    );
    // Las versiones son internas (02 §6.4): no viajan.
    assert.equal('versionVigenteId' in r.cuerpo || 'numeroVersion' in r.cuerpo, false);
  });

  test('la forma del pedido: sin líneas, cantidad cero, campos de más: 422 que marca el campo', async () => {
    for (const [cuerpo, campo] of [
      [{ ...datos.concreto, lineas: [] }, 'lineas'],
      [{ ...datos.concreto, lineas: [{ ...datos.concreto.lineas[0], cantidad: '0' }] }, 'lineas.0.cantidad'],
      [{ ...datos.concreto, lineas: [{ ...datos.concreto.lineas[0], rendimiento: '0.0000001' }] }, 'lineas.0.rendimiento'],
      [{ ...datos.concreto, nombre: ' ' }, 'nombre'],
      [{ ...datos.concreto, costoDirecto: '1' }, 'costoDirecto'],
      [{ ...datos.concreto, unidadId: '01900000-0000-7000-8000-000000000000' }, 'unidadId'],
    ] as const) {
      const r = await llamar('POST', '/api/apus', duena.cookie, cuerpo);
      assert.deepEqual([r.estado, r.cuerpo.campo], [422, campo], `${campo}: ${r.crudo}`);
    }
  });

  test('la vista maestra: búsqueda por nombre o código y filtro por unidad', async () => {
    const otra = await registrar('Constructora APU Lista', '900000341-1', 'apu.lista@construsoft.test');
    const d = await empresaConRecursos(otra);
    await llamar('POST', '/api/apus', otra.cookie, d.concreto);
    await llamar('POST', '/api/apus', otra.cookie, { ...d.concreto, nombre: 'Mano de obra por jornal', unidadId: d.u['Jr'], lineas: [d.concreto.lineas[1]] });
    const nombres = async (url: string) => ((await llamar('GET', url, otra.cookie)).cuerpo.apus as { nombre: string }[]).map((a) => a.nombre);
    assert.deepEqual(await nombres('/api/apus'), ['Concreto 3000 PSI para zapatas', 'Mano de obra por jornal']);
    assert.deepEqual(await nombres('/api/apus?texto=jornal'), ['Mano de obra por jornal']);
    assert.deepEqual(await nombres(`/api/apus?unidadId=${d.u['m³']}`), ['Concreto 3000 PSI para zapatas']);
  });

  test('editar un APU en uso: versión nueva siempre, y solo los presupuestos abiertos elegidos se reapuntan; el código no cambia', async () => {
    const creado = (await llamar('POST', '/api/apus', duena.cookie, { ...datos.concreto, nombre: 'APU en uso' })).cuerpo;
    const abiertos: string[] = [];
    for (const codigo of ['APU-P1', 'APU-P2']) {
      const p = await crearPresupuesto(duena.contexto, { codigo, nombre: codigo, ubicacion: 'x', modoEstructura: 'WBS' });
      const c = await agregarCapitulo(duena.contexto, p.id, { nombre: 'OBRA', clasificacion: 'DIRECTO' });
      await agregarActividad(duena.contexto, c.id, creado.id, '1');
      abiertos.push(p.id);
    }
    const vinculados = await llamar('GET', `/api/apus/${creado.id}/presupuestos`, duena.cookie);
    assert.deepEqual((vinculados.cuerpo.presupuestos as { codigo: string; estado: string }[]).map((p) => [p.codigo, p.estado]), [
      ['APU-P1', 'ABIERTO'],
      ['APU-P2', 'ABIERTO'],
    ]);

    const r = await llamar('PUT', `/api/apus/${creado.id}`, duena.cookie, {
      ...datos.concreto,
      nombre: 'APU en uso',
      lineas: [{ ...datos.concreto.lineas[0], desperdicioPct: '0' }, datos.concreto.lineas[1]],
      presupuestosAReapuntar: [abiertos[0]],
    });
    assert.equal(r.estado, 200, r.crudo);
    assert.deepEqual([r.cuerpo.apu.codigo, r.cuerpo.apu.costoDirecto, r.cuerpo.itemsReapuntados], [creado.codigo, '607000.000000', 1]);

    const precio = async (p: string) => ((await llamar('GET', `/api/presupuestos/${p}/mesa`, duena.cookie)).cuerpo.actividades as { precioUnitario: string }[])[0]!.precioUnitario;
    assert.deepEqual([await precio(abiertos[0]!), await precio(abiertos[1]!)], ['607000.000000', '636750.000000']);

    // En uso: no se elimina, y el mensaje ofrece la salida real.
    const borrar = await llamar('DELETE', `/api/apus/${creado.id}`, duena.cookie);
    assert.equal(borrar.estado, 422);
    assert.match(borrar.cuerpo.mensaje, /inactivo/);
  });

  test('desactivar deja de ofrecerlo en la mesa; reactivar lo devuelve', async () => {
    const creado = (await llamar('POST', '/api/apus', duena.cookie, { ...datos.concreto, nombre: 'Zapata aislada' })).cuerpo;
    const enBuscador = async () => ((await llamar('GET', '/api/apu/buscar?q=aislada', duena.cookie)).cuerpo.apus as unknown[]).length;
    assert.equal(await enBuscador(), 1);
    const r = await llamar('PATCH', `/api/apus/${creado.id}`, duena.cookie, { activo: false });
    assert.deepEqual([r.estado, r.cuerpo.activo], [200, false], r.crudo);
    assert.equal(await enBuscador(), 0);
    await llamar('PATCH', `/api/apus/${creado.id}`, duena.cookie, { activo: true });
    assert.equal(await enBuscador(), 1);
  });

  test('no hay dos APU con el mismo nombre, sin importar mayúsculas: crear y editar marcan el campo nombre', async () => {
    const primero = (await llamar('POST', '/api/apus', duena.cookie, { ...datos.concreto, nombre: 'Muro en bloque' })).cuerpo;
    const otro = await llamar('POST', '/api/apus', duena.cookie, { ...datos.concreto, nombre: ' MURO en BLOQUE ' });
    assert.deepEqual([otro.estado, otro.cuerpo.campo], [422, 'nombre'], otro.crudo);
    assert.ok(String(otro.cuerpo.mensaje).includes(`Ya existe un APU llamado «Muro en bloque» (${primero.codigo})`), otro.crudo);

    const segundo = (await llamar('POST', '/api/apus', duena.cookie, { ...datos.concreto, nombre: 'Pañete liso' })).cuerpo;
    const renombrado = await llamar('PUT', `/api/apus/${segundo.id}`, duena.cookie, { ...datos.concreto, nombre: 'muro EN bloque' });
    assert.deepEqual([renombrado.estado, renombrado.cuerpo.campo], [422, 'nombre']);
    // Guardarse a sí mismo con el mismo nombre no es repetirlo.
    const igual = await llamar('PUT', `/api/apus/${primero.id}`, duena.cookie, { ...datos.concreto, nombre: 'Muro En Bloque' });
    assert.equal(igual.estado, 200, igual.crudo);
  });

  test('eliminar un APU sin uso: 204, con sus versiones', async () => {
    const creado = (await llamar('POST', '/api/apus', duena.cookie, { ...datos.concreto, nombre: 'Para borrar' })).cuerpo;
    assert.equal((await llamar('DELETE', `/api/apus/${creado.id}`, duena.cookie)).estado, 204);
    assert.equal((await llamar('GET', `/api/apus/${creado.id}`, duena.cookie)).estado, 404);
  });

  test('permisos: con APU.VER lee; crear, editar, desactivar y eliminar piden su permiso', async () => {
    const lector = await asistenteCon(duena, 'apu.lector@construsoft.test', ['APU.VER']);
    const [uno] = (await llamar('GET', '/api/apus', lector)).cuerpo.apus as { id: string }[];
    assert.ok(uno);
    assert.equal((await llamar('GET', `/api/apus/${uno.id}`, lector)).estado, 200);
    assert.equal((await llamar('GET', '/api/unidades?para=APU', lector)).estado, 200);
    for (const [metodo, url, cuerpo, permiso] of [
      ['POST', '/api/apus', datos.concreto, 'APU.CREAR'],
      ['PUT', `/api/apus/${uno.id}`, datos.concreto, 'APU.EDITAR'],
      ['PATCH', `/api/apus/${uno.id}`, { activo: false }, 'APU.EDITAR'],
      ['DELETE', `/api/apus/${uno.id}`, undefined, 'APU.ELIMINAR'],
    ] as const) {
      const r = await llamar(metodo, url, lector, cuerpo);
      assert.equal(r.estado, 403, `${metodo} ${url}: ${r.crudo}`);
      assert.match(r.cuerpo.mensaje, new RegExp(permiso.replace('.', '\\.')));
    }
    const sinVer = await asistenteCon(duena, 'apu.sinver@construsoft.test', ['RECURSOS.VER']);
    assert.equal((await llamar('GET', '/api/apus', sinVer)).estado, 403);
    assert.equal((await llamar('GET', '/api/apus', undefined)).estado, 401);
  });
});

describe('APU con la suscripción vencida: se leen, no se escriben (D-65)', () => {
  test('la lista responde 200 y crear responde 402', async () => {
    const vencida = await registrar('Constructora APU Vencida', '900000342-2', 'apu.vencida@construsoft.test');
    const d = await empresaConRecursos(vencida);
    await vencerSuscripcion(vencida.contexto.tenantId);
    assert.equal((await llamar('GET', '/api/apus', vencida.cookie)).estado, 200);
    assert.equal((await llamar('POST', '/api/apus', vencida.cookie, d.concreto)).estado, 402);
  });
});

describe('aislamiento: los APU de otra empresa no existen (RN-01)', () => {
  test('cada ruta con un id de B responde lo mismo que con uno inexistente o uno que no es un id, y B queda intacta', async () => {
    const a = await registrar('Constructora APU A', '900000343-3', 'apu.a@construsoft.test');
    const b = await registrar('Constructora APU B', '900000344-4', 'apu.b@construsoft.test');
    const da = await empresaConRecursos(a);
    const db = await empresaConRecursos(b);
    const deB = (await llamar('POST', '/api/apus', b.cookie, { ...db.concreto, nombre: 'Secreto de B' })).cuerpo;
    const inexistente = '01900000-0000-7000-8000-000000000000';

    assert.deepEqual((await llamar('GET', '/api/apus?texto=Secreto', a.cookie)).cuerpo, { apus: [] });

    for (const [metodo, sufijo, cuerpo] of [
      ['GET', '', undefined],
      ['GET', '/presupuestos', undefined],
      ['PUT', '', da.concreto],
      ['PATCH', '', { activo: false }],
      ['DELETE', '', undefined],
    ] as const) {
      const ajeno = await llamar(metodo, `/api/apus/${deB.id}${sufijo}`, a.cookie, cuerpo);
      assert.equal(ajeno.estado, 404, `${metodo} ${sufijo}: ${ajeno.crudo}`);
      for (const id of [inexistente, 'no-es-un-id']) {
        const otro = await llamar(metodo, `/api/apus/${id}${sufijo}`, a.cookie, cuerpo);
        assert.deepEqual([otro.estado, otro.crudo], [ajeno.estado, ajeno.crudo], `${metodo} ${sufijo} con ${id}`);
      }
    }

    // Un recurso de B en una línea de un APU de A: igual que uno que no existe.
    const conRecursoDeB = await llamar('POST', '/api/apus', a.cookie, { ...da.concreto, lineas: [{ ...da.concreto.lineas[0], recursoId: db.premezclado.id }] });
    const conRecursoInexistente = await llamar('POST', '/api/apus', a.cookie, { ...da.concreto, lineas: [{ ...da.concreto.lineas[0], recursoId: inexistente }] });
    assert.equal(conRecursoDeB.estado, 422);
    assert.deepEqual([conRecursoDeB.estado, conRecursoDeB.crudo], [conRecursoInexistente.estado, conRecursoInexistente.crudo]);

    const deBDespues = (await llamar('GET', `/api/apus/${deB.id}`, b.cookie)).cuerpo;
    assert.deepEqual(deBDespues, deB);
  });

  test('cada referencia de un pedido —unidad, recurso de una línea, presupuestos a reapuntar— no distingue lo de B de lo inexistente', async () => {
    const a = await registrar('Constructora APU FK A', '900000345-5', 'apu.fk.a@construsoft.test');
    const b = await registrar('Constructora APU FK B', '900000346-6', 'apu.fk.b@construsoft.test');
    const da = await empresaConRecursos(a);
    const db = await empresaConRecursos(b);
    const inexistente = '01900000-0000-7000-8000-000000000000';
    const propio = (await llamar('POST', '/api/apus', a.cookie, da.concreto)).cuerpo;
    const igualQueInexistente = async (metodo: 'POST' | 'PUT', url: string, deB: object, noExiste: object, campo?: string) => {
      const r1 = await llamar(metodo, url, a.cookie, deB);
      const r2 = await llamar(metodo, url, a.cookie, noExiste);
      assert.equal(r1.estado, 422, `${metodo} ${url}: ${r1.crudo}`);
      if (campo) assert.equal(r1.cuerpo.campo, campo);
      assert.deepEqual([r1.estado, r1.crudo], [r2.estado, r2.crudo], `${metodo} ${url}`);
    };

    await igualQueInexistente('POST', '/api/apus', { ...da.concreto, unidadId: db.u['m³'] }, { ...da.concreto, unidadId: inexistente }, 'unidadId');
    await igualQueInexistente('PUT', `/api/apus/${propio.id}`, { ...da.concreto, unidadId: db.u['m³'] }, { ...da.concreto, unidadId: inexistente }, 'unidadId');
    await igualQueInexistente(
      'PUT',
      `/api/apus/${propio.id}`,
      { ...da.concreto, lineas: [{ ...da.concreto.lineas[0], recursoId: db.premezclado.id }] },
      { ...da.concreto, lineas: [{ ...da.concreto.lineas[0], recursoId: inexistente }] },
    );

    // Un presupuesto de B en la lista de los que hay que reapuntar: se ignora
    // igual que uno que no existe, y el de B no se toca.
    const deB = await crearPresupuesto(b.contexto, { codigo: 'APU-FK-B', nombre: 'De B', ubicacion: 'Cali', modoEstructura: 'WBS' });
    const capB = await agregarCapitulo(b.contexto, deB.id, { nombre: 'OBRA', clasificacion: 'DIRECTO' });
    const apuDeB = (await llamar('POST', '/api/apus', b.cookie, db.concreto)).cuerpo;
    await agregarActividad(b.contexto, capB.id, apuDeB.id, '1');
    const mesaDeB = async () => (await llamar('GET', `/api/presupuestos/${deB.id}/mesa`, b.cookie)).crudo;
    const antes = await mesaDeB();
    const respuestas = [];
    for (const lista of [[deB.id], [inexistente]]) {
      const r = await llamar('PUT', `/api/apus/${propio.id}`, a.cookie, { ...da.concreto, presupuestosAReapuntar: lista });
      respuestas.push([r.estado, r.cuerpo.itemsReapuntados]);
    }
    assert.deepEqual(respuestas[0], [200, 0]);
    assert.deepEqual(respuestas[1], respuestas[0]);
    assert.equal(await mesaDeB(), antes);
  });
});
