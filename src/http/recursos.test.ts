import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { crearApu } from '../infraestructura/basedatos/apu.js';
import { crearPresupuesto } from '../infraestructura/basedatos/presupuesto.js';
import { agregarCapitulo } from '../infraestructura/basedatos/edt.js';
import { agregarActividad } from '../infraestructura/basedatos/actividad.js';
import { vencerSuscripcion } from '../pruebas/superusuario.js';
import { armarPresupuestoDeReferencia } from '../pruebas/presupuestoDeReferencia.js';
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

interface Recurso {
  id: string;
  codigo: string;
  nombre: string;
  tipo: string;
  unidadId: string;
  unidadSimbolo: string;
  precioBase: string;
  ivaPct: string;
  precioTotal: string;
  viaCaptura: string;
  activo: boolean;
}

async function enviar(metodo: 'POST' | 'PUT' | 'DELETE', url: string, cookie: string | undefined, cuerpo?: unknown) {
  const r = await app.inject({
    method: metodo,
    url,
    remoteAddress: otraIp(),
    ...(cookie ? { headers: { cookie } } : {}),
    ...(cuerpo === undefined ? {} : { payload: cuerpo as object }),
  });
  const json = r.body === '' ? {} : r.json<Record<string, unknown>>();
  return { estado: r.statusCode, cuerpo: json as Record<string, unknown> & { mensaje?: string; campo?: string }, crudo: r.body };
}

async function unidadesDe(cookie: string): Promise<Record<string, string>> {
  const r = await pedir('/api/unidades', cookie);
  assert.equal(r.statusCode, 200, r.body);
  return Object.fromEntries(r.json<{ unidades: { id: string; simbolo: string }[] }>().unidades.map((u) => [u.simbolo, u.id]));
}

const nuevo = (unidadId: string, extra: Record<string, unknown> = {}) => ({
  nombre: 'Cemento gris 50 kg',
  tipo: 'MATERIAL',
  unidadId,
  precioBase: '30000',
  ivaPct: '19',
  precioTotal: '35700',
  viaCaptura: 'BASE',
  ...extra,
});

describe('Recursos (02 §5): catálogo, crear, editar con la pregunta de los presupuestos abiertos, eliminar', () => {
  let duena: Cuenta;
  let u: Record<string, string>;

  before(async () => {
    duena = await registrar('Constructora Recursos', '900000330-0', 'recursos.admin@construsoft.test');
    u = await unidadesDe(duena.cookie);
  });

  test('GET /api/unidades: las unidades de la empresa para los selectores', async () => {
    assert.ok(u['m³'] && u['Kg'] && u['Glb'], JSON.stringify(Object.keys(u)));
  });

  test('crear por la vía del costo base: 201, código del servidor y el símbolo de la unidad', async () => {
    const r = await enviar('POST', '/api/recursos', duena.cookie, nuevo(u['Kg']!));
    assert.equal(r.estado, 201, r.crudo);
    const { id, codigo, ...resto } = r.cuerpo as unknown as Recurso;
    assert.match(id, /^[0-9a-f-]{36}$/);
    assert.match(codigo, /\d/);
    assert.deepEqual(resto, {
      nombre: 'Cemento gris 50 kg',
      tipo: 'MATERIAL',
      unidadId: u['Kg'],
      unidadSimbolo: 'Kg',
      precioBase: '30000.000000',
      ivaPct: '19.000000',
      precioTotal: '35700.000000',
      viaCaptura: 'BASE',
      activo: true,
    });
  });

  test('el IVA es opcional: vacío es 0 % y los dos precios coinciden (RF-REC-08)', async () => {
    const { ivaPct, ...sinIva } = nuevo(u['Kg']!, { nombre: 'Arena', precioBase: '80000', precioTotal: '80000' });
    void ivaPct;
    const r = await enviar('POST', '/api/recursos', duena.cookie, sinIva);
    assert.equal(r.estado, 201, r.crudo);
    assert.equal(r.cuerpo.ivaPct, '0.000000');
  });

  test('precios que no cuadran con el IVA los rechaza la base con un mensaje para la persona', async () => {
    const r = await enviar('POST', '/api/recursos', duena.cookie, nuevo(u['Kg']!, { precioTotal: '36000' }));
    assert.equal(r.estado, 422);
    assert.match(r.cuerpo.mensaje!, /no cuadran/);
  });

  test('la forma del pedido: tipo, vía, precios como texto y sin código: 422 que marca el campo', async () => {
    for (const [cambio, campo] of [
      [{ tipo: 'HERRAMIENTA' }, 'tipo'],
      [{ viaCaptura: 'AMBAS' }, 'viaCaptura'],
      [{ precioBase: 30000 }, 'precioBase'],
      [{ precioTotal: '-1' }, 'precioTotal'],
      [{ nombre: ' ' }, 'nombre'],
      [{ unidadId: 'm3' }, 'unidadId'],
      [{ codigo: 'MAT-999' }, 'codigo'],
    ] as const) {
      const r = await enviar('POST', '/api/recursos', duena.cookie, nuevo(u['Kg']!, cambio));
      assert.deepEqual([r.estado, r.cuerpo.campo], [422, campo], JSON.stringify(cambio));
    }
  });

  test('una unidad que no existe en la empresa es 422 en unidadId, no un 500', async () => {
    const r = await enviar('POST', '/api/recursos', duena.cookie, nuevo('01900000-0000-7000-8000-000000000000'));
    assert.deepEqual([r.estado, r.cuerpo.campo], [422, 'unidadId'], r.crudo);
  });

  test('la vista maestra: por pestaña, y con texto el filtro por pestaña se rompe (02 §5.1)', async () => {
    const otra = await registrar('Constructora Recursos Lista', '900000331-1', 'recursos.lista@construsoft.test');
    const un = await unidadesDe(otra.cookie);
    for (const [nombre, tipo, unidad] of [
      ['Bloque de concreto', 'MATERIAL', 'Und'],
      ['Mezcladora de concreto', 'EQUIPO', 'Hr'],
      ['Oficial', 'PERSONAL', 'Jr'],
    ] as const) {
      const r = await enviar('POST', '/api/recursos', otra.cookie, nuevo(un[unidad]!, { nombre, tipo, precioBase: '100', ivaPct: '0', precioTotal: '100' }));
      assert.equal(r.estado, 201, r.crudo);
    }
    const nombres = async (url: string) => (await pedir(url, otra.cookie)).json<{ recursos: Recurso[] }>().recursos.map((x) => x.nombre);
    assert.deepEqual(await nombres('/api/recursos'), ['Bloque de concreto', 'Mezcladora de concreto', 'Oficial']);
    assert.deepEqual(await nombres('/api/recursos?tipo=EQUIPO'), ['Mezcladora de concreto']);
    assert.deepEqual(await nombres('/api/recursos?texto=concreto'), ['Bloque de concreto', 'Mezcladora de concreto']);
    assert.deepEqual(await nombres('/api/recursos?tipo=MATERIAL&texto=concreto'), ['Bloque de concreto']);
    assert.equal((await pedir('/api/recursos?tipo=OTRO', otra.cookie)).statusCode, 422);
  });

  test('editar un recurso en uso: la lista de presupuestos abiertos afectados, y reapuntar solo los elegidos', async () => {
    const creado = (await enviar('POST', '/api/recursos', duena.cookie, nuevo(u['m³']!, { nombre: 'Concreto 3000', precioBase: '500000', ivaPct: '0', precioTotal: '500000' })))
      .cuerpo as unknown as Recurso;
    const apu = await crearApu(duena.contexto, {
      nombre: 'Zapata',
      unidadId: u['m³']!,
      lineas: [{ recursoId: creado.id, cantidad: '1', rendimiento: '1', desperdicioPct: '0' }],
    });
    const abiertos = [];
    for (const codigo of ['REC-P1', 'REC-P2']) {
      const p = await crearPresupuesto(duena.contexto, { codigo, nombre: codigo, ubicacion: 'x', modoEstructura: 'WBS' });
      const c = await agregarCapitulo(duena.contexto, p.id, { nombre: 'OBRA', clasificacion: 'DIRECTO' });
      await agregarActividad(duena.contexto, c.id, apu.id, '1');
      abiertos.push(p.id);
    }

    const afectados = await pedir(`/api/recursos/${creado.id}/presupuestos-afectados`, duena.cookie);
    assert.equal(afectados.statusCode, 200, afectados.body);
    assert.deepEqual(afectados.json<{ presupuestos: { codigo: string }[] }>().presupuestos.map((p) => p.codigo), ['REC-P1', 'REC-P2']);

    const r = await enviar('PUT', `/api/recursos/${creado.id}`, duena.cookie, {
      ...nuevo(u['m³']!, { nombre: 'Concreto 3000', precioBase: '600000', ivaPct: '0', precioTotal: '600000' }),
      presupuestosAReapuntar: [abiertos[0]],
    });
    assert.equal(r.estado, 200, r.crudo);
    assert.deepEqual([(r.cuerpo.recurso as Recurso).precioTotal, r.cuerpo.apusVersionados], ['600000.000000', 1]);

    const precioEn = async (p: string) => (await pedir(`/api/presupuestos/${p}/mesa`, duena.cookie)).json<{ actividades: { precioUnitario: string }[] }>().actividades[0]!.precioUnitario;
    assert.equal(await precioEn(abiertos[0]!), '600000.000000');
    assert.equal(await precioEn(abiertos[1]!), '500000.000000');

    // Una lista VACÍA es «no reapuntar ninguno» —02 §5.3, «No, solo para
    // nuevos»—: el catálogo cambia, los abiertos quedan como estaban.
    const ninguno = await enviar('PUT', `/api/recursos/${creado.id}`, duena.cookie, {
      ...nuevo(u['m³']!, { nombre: 'Concreto 3000', precioBase: '650000', ivaPct: '0', precioTotal: '650000' }),
      presupuestosAReapuntar: [],
    });
    assert.deepEqual([ninguno.estado, (ninguno.cuerpo.recurso as Recurso).precioTotal, ninguno.cuerpo.apusVersionados], [200, '650000.000000', 1], ninguno.crudo);
    assert.deepEqual([await precioEn(abiertos[0]!), await precioEn(abiertos[1]!)], ['600000.000000', '500000.000000']);

    // En uso en un APU: no se elimina, y el mensaje dice dónde.
    const borrar = await enviar('DELETE', `/api/recursos/${creado.id}`, duena.cookie);
    assert.equal(borrar.estado, 422);
    assert.match(borrar.cuerpo.mensaje!, /APU/);
  });

  test('eliminar un recurso sin uso: 204, y deja de existir', async () => {
    const creado = (await enviar('POST', '/api/recursos', duena.cookie, nuevo(u['Kg']!, { nombre: 'Para borrar' }))).cuerpo as unknown as Recurso;
    assert.equal((await enviar('DELETE', `/api/recursos/${creado.id}`, duena.cookie)).estado, 204);
    assert.equal((await pedir(`/api/recursos/${creado.id}`, duena.cookie)).statusCode, 404);
  });

  test('permisos: solo ver lista y lee; crear, editar y eliminar son 403 con el permiso que falta', async () => {
    const lector = await asistenteCon(duena, 'recursos.lector@construsoft.test', ['RECURSOS.VER']);
    const [cualquiera] = (await pedir('/api/recursos', lector)).json<{ recursos: Recurso[] }>().recursos;
    assert.ok(cualquiera);
    assert.equal((await pedir('/api/unidades', lector)).statusCode, 200);
    for (const [metodo, url, cuerpo, permiso] of [
      ['POST', '/api/recursos', nuevo(u['Kg']!), 'RECURSOS.CREAR'],
      ['PUT', `/api/recursos/${cualquiera.id}`, nuevo(u['Kg']!), 'RECURSOS.EDITAR'],
      ['DELETE', `/api/recursos/${cualquiera.id}`, undefined, 'RECURSOS.ELIMINAR'],
    ] as const) {
      const r = await enviar(metodo, url, lector, cuerpo);
      assert.equal(r.estado, 403, `${metodo} ${url}: ${r.crudo}`);
      assert.match(r.cuerpo.mensaje!, new RegExp(permiso.replace('.', '\\.')));
    }
    const sinVer = await asistenteCon(duena, 'recursos.sinver@construsoft.test', ['APU.VER']);
    assert.equal((await pedir('/api/recursos', sinVer)).statusCode, 403);
    assert.equal((await pedir('/api/recursos')).statusCode, 401);
  });
});

describe('Recursos con la suscripción vencida: se leen, no se escriben (D-65)', () => {
  test('la lista responde 200 y crear responde 402', async () => {
    const vencida = await registrar('Constructora Recursos Vencida', '900000332-2', 'recursos.vencida@construsoft.test');
    const un = await unidadesDe(vencida.cookie);
    await vencerSuscripcion(vencida.contexto.tenantId);
    assert.equal((await pedir('/api/recursos', vencida.cookie)).statusCode, 200);
    assert.equal((await enviar('POST', '/api/recursos', vencida.cookie, nuevo(un['Kg']!))).estado, 402);
  });
});

describe('aislamiento: los recursos y las unidades de otra empresa no existen (RN-01)', () => {
  test('cada ruta con un id de B responde lo mismo que con uno inexistente o uno que no es un id, y B queda intacta', async () => {
    const a = await registrar('Constructora Recursos A', '900000333-3', 'recursos.a@construsoft.test');
    const b = await registrar('Constructora Recursos B', '900000334-4', 'recursos.b@construsoft.test');
    const ua = await unidadesDe(a.cookie);
    const ub = await unidadesDe(b.cookie);
    const deB = (await enviar('POST', '/api/recursos', b.cookie, nuevo(ub['Kg']!, { nombre: 'Secreto de B' }))).cuerpo as unknown as Recurso;
    const inexistente = '01900000-0000-7000-8000-000000000000';

    assert.deepEqual((await pedir('/api/recursos?texto=Secreto', a.cookie)).json(), { recursos: [] });
    assert.ok(!Object.values(ua).includes(ub['Kg']!));

    const llamar = async (metodo: 'GET' | 'PUT' | 'DELETE', url: string) => {
      const r = await app.inject({
        method: metodo,
        url,
        remoteAddress: otraIp(),
        headers: { cookie: a.cookie },
        ...(metodo === 'PUT' ? { payload: nuevo(ua['Kg']!) } : {}),
      });
      return [r.statusCode, r.body] as const;
    };
    for (const [metodo, sufijo] of [
      ['GET', ''],
      ['GET', '/presupuestos-afectados'],
      ['PUT', ''],
      ['DELETE', ''],
    ] as const) {
      const ajeno = await llamar(metodo, `/api/recursos/${deB.id}${sufijo}`);
      assert.equal(ajeno[0], 404, `${metodo} ${sufijo}: ${ajeno[1]}`);
      assert.deepEqual(await llamar(metodo, `/api/recursos/${inexistente}${sufijo}`), ajeno);
      assert.deepEqual(await llamar(metodo, `/api/recursos/no-es-un-id${sufijo}`), ajeno);
    }

    // Una unidad de B en un recurso de A: igual que una unidad que no existe.
    const conUnidadDeB = await enviar('POST', '/api/recursos', a.cookie, nuevo(ub['Kg']!));
    const conUnidadInexistente = await enviar('POST', '/api/recursos', a.cookie, nuevo(inexistente));
    assert.deepEqual([conUnidadDeB.estado, conUnidadDeB.crudo], [conUnidadInexistente.estado, conUnidadInexistente.crudo]);

    const deBDespues = (await pedir(`/api/recursos/${deB.id}`, b.cookie)).json<Recurso>();
    assert.deepEqual(deBDespues, deB);
  });

  test('cada referencia de un pedido —unidad al editar, presupuestos a reapuntar— no distingue lo de B de lo inexistente', async () => {
    const a = await registrar('Constructora Recursos FK A', '900000335-5', 'recursos.fk.a@construsoft.test');
    const b = await registrar('Constructora Recursos FK B', '900000336-6', 'recursos.fk.b@construsoft.test');
    const ua = await unidadesDe(a.cookie);
    const ub = await unidadesDe(b.cookie);
    const inexistente = '01900000-0000-7000-8000-000000000000';
    const propio = (await enviar('POST', '/api/recursos', a.cookie, nuevo(ua['Kg']!))).cuerpo as unknown as Recurso;

    const conUnidadDeB = await enviar('PUT', `/api/recursos/${propio.id}`, a.cookie, nuevo(ub['Kg']!));
    const conUnidadInexistente = await enviar('PUT', `/api/recursos/${propio.id}`, a.cookie, nuevo(inexistente));
    assert.deepEqual([conUnidadDeB.estado, conUnidadDeB.cuerpo.campo], [422, 'unidadId']);
    assert.deepEqual([conUnidadDeB.estado, conUnidadDeB.crudo], [conUnidadInexistente.estado, conUnidadInexistente.crudo]);

    // Un presupuesto de B en la lista de los que hay que reapuntar: se ignora
    // igual que uno que no existe, y el de B no se toca.
    const deB = await armarPresupuestoDeReferencia(b.contexto, 'REC-FK-B');
    const mesaDeB = async () => (await pedir(`/api/presupuestos/${deB.presupuestoId}/mesa`, b.cookie)).body;
    const antes = await mesaDeB();
    const respuestas = [];
    for (const [k, lista] of [[1, [deB.presupuestoId]], [2, [inexistente]]] as const) {
      const r = await enviar('PUT', `/api/recursos/${propio.id}`, a.cookie, {
        ...nuevo(ua['Kg']!, { precioBase: `${40000 + k}`, ivaPct: '0', precioTotal: `${40000 + k}` }),
        presupuestosAReapuntar: lista,
      });
      respuestas.push([r.estado, r.cuerpo.apusVersionados]);
    }
    assert.deepEqual(respuestas[0], [200, 0]);
    assert.deepEqual(respuestas[1], respuestas[0]);
    assert.equal(await mesaDeB(), antes);
  });
});
