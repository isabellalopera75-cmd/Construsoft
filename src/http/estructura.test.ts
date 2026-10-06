import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { crearPresupuesto } from '../infraestructura/basedatos/presupuesto.js';
import { agregarCapitulo, agregarSubcapitulo } from '../infraestructura/basedatos/edt.js';
import { agregarActividad } from '../infraestructura/basedatos/actividad.js';
import { activarPresupuesto } from '../infraestructura/basedatos/cicloDeVida.js';
import { armarPresupuestoDeReferencia, type PresupuestoDeReferencia } from '../pruebas/presupuestoDeReferencia.js';
import { vencerSuscripcion } from '../pruebas/superusuario.js';
import { VERSION_TERMINOS_DE_PRUEBA, clienteDePrueba, type Cuenta, CARPETA_LEGAL_DE_PRUEBA } from '../pruebas/clienteHttp.js';
import { construirServidor } from './servidor.js';

let app: FastifyInstance;
const { otraIp, registrar, asistenteCon } = clienteDePrueba(() => app);

before(async () => {
  app = await construirServidor({ carpetaLegal: CARPETA_LEGAL_DE_PRUEBA, secretoSesion: randomBytes(32).toString('hex'), versionTerminos: VERSION_TERMINOS_DE_PRUEBA });
});
after(async () => {
  await app.close();
});

interface Mesa {
  cabecera: { id: string; editable: boolean };
  nodos: { id: string; padreId: string | null; codigoWbs: string; posicion: number; nombre: string; clasificacion: string }[];
  actividades: { id: string; nodoId: string; codigoItem: string; posicion: number }[];
  pie: { valorTotal: string };
}

async function enviar(metodo: 'POST' | 'PATCH' | 'DELETE', url: string, cookie: string | undefined, cuerpo?: unknown) {
  const r = await app.inject({
    method: metodo,
    url,
    remoteAddress: otraIp(),
    ...(cookie ? { headers: { cookie } } : {}),
    ...(cuerpo === undefined ? {} : { payload: cuerpo as object }),
  });
  return { estado: r.statusCode, cuerpo: r.json<Mesa & { mensaje?: string; campo?: string }>(), crudo: r.body };
}

/** El árbol como texto, en orden de presentación: «1.0 OBRA (DIRECTO)», «1.1 Excavación», … */
function arbol(m: Mesa): string[] {
  const hijos = (padre: string | null): string[] =>
    [
      ...m.nodos.filter((n) => n.padreId === padre).map((n) => ({ p: n.posicion, id: n.id, txt: `${n.codigoWbs} ${n.nombre} (${n.clasificacion})` })),
      ...m.actividades.filter((a) => a.nodoId === padre).map((a) => ({ p: a.posicion, id: null, txt: a.codigoItem })),
    ]
      .sort((x, y) => x.p - y.p)
      .flatMap((x) => [x.txt, ...(x.id ? hijos(x.id) : [])]);
  return hijos(null);
}

describe('estructura de la mesa: cada mutación responde con la mesa completa recalculada (contrato §4.2, 02 §8.2)', () => {
  let duena: Cuenta;
  let referencia: PresupuestoDeReferencia;
  let wbs: string;

  before(async () => {
    duena = await registrar('Constructora Estructura', '900000310-0', 'estructura.admin@construsoft.test');
    referencia = await armarPresupuestoDeReferencia(duena.contexto, 'EST-REF');
    wbs = (await crearPresupuesto(duena.contexto, { codigo: 'EST-WBS', nombre: 'Por EDT', ubicacion: 'Bello', modoEstructura: 'WBS' })).id;
  });

  test('crear un capítulo: 201 y la mesa con el capítulo al final, numerado por la base', async () => {
    const r = await enviar('POST', `/api/presupuestos/${wbs}/capitulos`, duena.cookie, { nombre: 'PRELIMINARES', clasificacion: 'INDIRECTO' });
    assert.equal(r.estado, 201, r.crudo);
    assert.equal(r.cuerpo.cabecera.id, wbs);
    assert.deepEqual(arbol(r.cuerpo), ['1.0 PRELIMINARES (INDIRECTO)']);
    const r2 = await enviar('POST', `/api/presupuestos/${wbs}/capitulos`, duena.cookie, { nombre: 'OBRA', clasificacion: 'DIRECTO' });
    assert.deepEqual(arbol(r2.cuerpo), ['1.0 PRELIMINARES (INDIRECTO)', '2.0 OBRA (DIRECTO)']);
  });

  test('la clasificación es obligatoria y sin valor por defecto: 422 que marca el campo (02 §8.4)', async () => {
    for (const cuerpo of [{ nombre: 'SIN CLASE' }, { nombre: 'MAL', clasificacion: 'MIXTO' }]) {
      const r = await enviar('POST', `/api/presupuestos/${wbs}/capitulos`, duena.cookie, cuerpo);
      assert.deepEqual([r.estado, r.cuerpo.campo], [422, 'clasificacion']);
      assert.match(r.cuerpo.mensaje!, /directo o indirecto/);
    }
    const vacio = await enviar('POST', `/api/presupuestos/${wbs}/capitulos`, duena.cookie, { nombre: '  ', clasificacion: 'DIRECTO' });
    assert.deepEqual([vacio.estado, vacio.cuerpo.campo], [422, 'nombre']);
  });

  test('crear un subnivel: hereda la clasificación del capítulo, y no la acepta en el cuerpo', async () => {
    const mesa = (await enviar('POST', `/api/presupuestos/${wbs}/capitulos`, duena.cookie, { nombre: 'CUBIERTA', clasificacion: 'DIRECTO' })).cuerpo;
    const cubierta = mesa.nodos.find((n) => n.nombre === 'CUBIERTA')!;
    const r = await enviar('POST', `/api/nodos/${cubierta.id}/subniveles`, duena.cookie, { nombre: 'Tejas' });
    assert.equal(r.estado, 201, r.crudo);
    assert.ok(arbol(r.cuerpo).includes(`${cubierta.codigoWbs.replace('.0', '.1')} Tejas (DIRECTO)`), arbol(r.cuerpo).join(' | '));

    const conClase = await enviar('POST', `/api/nodos/${cubierta.id}/subniveles`, duena.cookie, { nombre: 'X', clasificacion: 'INDIRECTO' });
    assert.deepEqual([conClase.estado, conClase.cuerpo.campo], [422, 'clasificacion']);
  });

  test('un subnivel en un presupuesto por ítems lo rechaza la base: 422 sin campo (la interfaz recarga)', async () => {
    const r = await enviar('POST', `/api/nodos/${(await capitulos(referencia.presupuestoId))[0]}/subniveles`, duena.cookie, { nombre: 'X' });
    assert.equal(r.estado, 422);
    assert.equal(r.cuerpo.campo, undefined);
    assert.match(r.cuerpo.mensaje!, /por ítems/);
  });

  test('renombrar y reclasificar con PATCH; las dos cosas a la vez, o ninguna, es 422', async () => {
    const p = (await crearPresupuesto(duena.contexto, { codigo: 'EST-PATCH', nombre: 'Patch', ubicacion: 'Itagüí', modoEstructura: 'WBS' })).id;
    const cap = await agregarCapitulo(duena.contexto, p, { nombre: 'OBRA', clasificacion: 'DIRECTO' });
    const sub = await agregarSubcapitulo(duena.contexto, cap.id, { nombre: 'Muros' });

    const renombrado = await enviar('PATCH', `/api/nodos/${sub.id}`, duena.cookie, { nombre: 'Muros de carga' });
    assert.equal(renombrado.estado, 200, renombrado.crudo);
    assert.deepEqual(arbol(renombrado.cuerpo), ['1.0 OBRA (DIRECTO)', '1.1 Muros de carga (DIRECTO)']);

    const reclasificado = await enviar('PATCH', `/api/nodos/${cap.id}`, duena.cookie, { clasificacion: 'INDIRECTO' });
    assert.deepEqual(arbol(reclasificado.cuerpo), ['1.0 OBRA (INDIRECTO)', '1.1 Muros de carga (INDIRECTO)']);

    // Un subnivel no se reclasifica: lo rechaza la base (D-8).
    const sobreSub = await enviar('PATCH', `/api/nodos/${sub.id}`, duena.cookie, { clasificacion: 'DIRECTO' });
    assert.deepEqual([sobreSub.estado, sobreSub.cuerpo.campo], [422, undefined]);

    for (const cuerpo of [{}, { nombre: 'A', clasificacion: 'DIRECTO' }]) {
      assert.equal((await enviar('PATCH', `/api/nodos/${cap.id}`, duena.cookie, cuerpo)).estado, 422);
    }
  });

  test('mover a una posición absoluta: el mismo pedido dos veces deja el mismo árbol', async () => {
    const p = (await crearPresupuesto(duena.contexto, { codigo: 'EST-MOVER', nombre: 'Mover', ubicacion: 'Caldas', modoEstructura: 'WBS' })).id;
    await agregarCapitulo(duena.contexto, p, { nombre: 'A', clasificacion: 'DIRECTO' });
    await agregarCapitulo(duena.contexto, p, { nombre: 'B', clasificacion: 'DIRECTO' });
    const c = await agregarCapitulo(duena.contexto, p, { nombre: 'C', clasificacion: 'INDIRECTO' });

    const r1 = await enviar('POST', `/api/nodos/${c.id}/mover`, duena.cookie, { posicion: 1 });
    assert.equal(r1.estado, 200, r1.crudo);
    assert.deepEqual(arbol(r1.cuerpo), ['1.0 C (INDIRECTO)', '2.0 A (DIRECTO)', '3.0 B (DIRECTO)']);
    const r2 = await enviar('POST', `/api/nodos/${c.id}/mover`, duena.cookie, { posicion: 1 });
    assert.deepEqual(arbol(r2.cuerpo), arbol(r1.cuerpo));

    const fuera = await enviar('POST', `/api/nodos/${c.id}/mover`, duena.cookie, { posicion: 4 });
    // Fuera de rango es el mismo dato y la misma corrección que «no es un
    // entero»: los dos marcan el campo, y la pantalla no recarga la mesa.
    assert.deepEqual([fuera.estado, fuera.cuerpo.campo], [422, 'posicion']);
    assert.match(fuera.cuerpo.mensaje!, /1 a 3/);
    // El borde: la última posición existe.
    const alFinal = await enviar('POST', `/api/nodos/${c.id}/mover`, duena.cookie, { posicion: 3 });
    assert.deepEqual([alFinal.estado, arbol(alFinal.cuerpo)], [200, ['1.0 A (DIRECTO)', '2.0 B (DIRECTO)', '3.0 C (INDIRECTO)']]);
    const noEntero = await enviar('POST', `/api/nodos/${c.id}/mover`, duena.cookie, { posicion: 1.5 });
    assert.deepEqual([noEntero.estado, noEntero.cuerpo.campo], [422, 'posicion']);
  });

  test('eliminar con contenido pide confirmación: 409 con los conteos en el mensaje; con ?confirmado=si se borra', async () => {
    const p = (await crearPresupuesto(duena.contexto, { codigo: 'EST-BORRAR', nombre: 'Borrar', ubicacion: 'Girardota', modoEstructura: 'WBS' })).id;
    const cap = await agregarCapitulo(duena.contexto, p, { nombre: 'OBRA', clasificacion: 'DIRECTO' });
    const sub = await agregarSubcapitulo(duena.contexto, cap.id, { nombre: 'Muros' });
    await agregarActividad(duena.contexto, cap.id, referencia.concreto.id, '1');
    await agregarActividad(duena.contexto, sub.id, referencia.concreto.id, '2');
    const vacio = await agregarCapitulo(duena.contexto, p, { nombre: 'VACÍO', clasificacion: 'DIRECTO' });

    const sinConfirmar = await enviar('DELETE', `/api/nodos/${cap.id}`, duena.cookie);
    assert.equal(sinConfirmar.estado, 409);
    assert.match(sinConfirmar.cuerpo.mensaje!, /1 subnivel y 2 actividades/);

    const confirmado = await enviar('DELETE', `/api/nodos/${cap.id}?confirmado=si`, duena.cookie);
    assert.equal(confirmado.estado, 200, confirmado.crudo);
    assert.deepEqual(arbol(confirmado.cuerpo), ['1.0 VACÍO (DIRECTO)']);

    // Un nivel sin nada debajo se borra sin pedir confirmación.
    const sinNada = await enviar('DELETE', `/api/nodos/${vacio.id}`, duena.cookie);
    assert.deepEqual([sinNada.estado, arbol(sinNada.cuerpo)], [200, []]);
  });

  test('sobre un presupuesto ACTIVO la base rechaza: 422 sin campo', async () => {
    const p = await armarPresupuestoDeReferencia(duena.contexto, 'EST-ACTIVO');
    await activarPresupuesto(duena.contexto, p.presupuestoId);
    const [primero] = await capitulos(p.presupuestoId);
    for (const [metodo, url, cuerpo] of [
      ['POST', `/api/presupuestos/${p.presupuestoId}/capitulos`, { nombre: 'X', clasificacion: 'DIRECTO' }],
      ['PATCH', `/api/nodos/${primero}`, { nombre: 'X' }],
      ['POST', `/api/nodos/${primero}/mover`, { posicion: 2 }],
      ['DELETE', `/api/nodos/${primero}?confirmado=si`, undefined],
    ] as const) {
      const r = await enviar(metodo, url, duena.cookie, cuerpo);
      assert.deepEqual([r.estado, r.cuerpo.campo], [422, undefined], `${metodo} ${url}: ${r.crudo}`);
    }
  });

  test('sin PRESUPUESTOS.EDITAR: 403 en cada mutación, y nada cambia', async () => {
    const lector = await asistenteCon(duena, 'estructura.lector@construsoft.test', ['PRESUPUESTOS.VER']);
    const [primero] = await capitulos(referencia.presupuestoId);
    const antes = arbol(await mesa(referencia.presupuestoId));
    for (const [metodo, url, cuerpo] of [
      ['POST', `/api/presupuestos/${referencia.presupuestoId}/capitulos`, { nombre: 'X', clasificacion: 'DIRECTO' }],
      ['POST', `/api/nodos/${primero}/subniveles`, { nombre: 'X' }],
      ['PATCH', `/api/nodos/${primero}`, { nombre: 'X' }],
      ['POST', `/api/nodos/${primero}/mover`, { posicion: 2 }],
      ['DELETE', `/api/nodos/${primero}?confirmado=si`, undefined],
    ] as const) {
      const r = await enviar(metodo, url, lector, cuerpo);
      assert.equal(r.estado, 403, `${metodo} ${url}: ${r.crudo}`);
      assert.match(r.cuerpo.mensaje!, /PRESUPUESTOS\.EDITAR/);
    }
    assert.deepEqual(arbol(await mesa(referencia.presupuestoId)), antes);
  });

  test('sin sesión: 401', async () => {
    const r = await enviar('POST', `/api/presupuestos/${wbs}/capitulos`, undefined, { nombre: 'X', clasificacion: 'DIRECTO' });
    assert.equal(r.estado, 401);
  });

  /** La mesa leída por HTTP con la cookie de la dueña. */
  async function mesa(presupuestoId: string): Promise<Mesa> {
    const r = await app.inject({ method: 'GET', url: `/api/presupuestos/${presupuestoId}/mesa`, remoteAddress: otraIp(), headers: { cookie: duena.cookie } });
    return r.json<Mesa>();
  }

  /** Los ids de los capítulos raíz. */
  async function capitulos(presupuestoId: string): Promise<string[]> {
    return (await mesa(presupuestoId)).nodos.filter((n) => n.padreId === null).map((n) => n.id);
  }
});

describe('estructura con la suscripción vencida: solo lectura (D-65)', () => {
  test('crear un capítulo responde 402', async () => {
    const vencida = await registrar('Constructora Estructura Vencida', '900000311-1', 'estructura.vencida@construsoft.test');
    const p = await crearPresupuesto(vencida.contexto, { codigo: 'EST-V', nombre: 'V', ubicacion: 'Medellín', modoEstructura: 'WBS' });
    await vencerSuscripcion(vencida.contexto.tenantId);
    const r = await enviar('POST', `/api/presupuestos/${p.id}/capitulos`, vencida.cookie, { nombre: 'X', clasificacion: 'DIRECTO' });
    assert.equal(r.estado, 402);
  });
});

describe('aislamiento: la estructura de otra empresa no existe (RN-01)', () => {
  test('cada mutación con un id de B responde el mismo 404 que con un id inexistente, y B queda intacta', async () => {
    const a = await registrar('Constructora Estructura A', '900000312-2', 'estructura.a@construsoft.test');
    const b = await registrar('Constructora Estructura B', '900000313-3', 'estructura.b@construsoft.test');
    const deB = (await crearPresupuesto(b.contexto, { codigo: 'EST-B', nombre: 'De B', ubicacion: 'Cali', modoEstructura: 'WBS' })).id;
    const capB = await agregarCapitulo(b.contexto, deB, { nombre: 'DE B', clasificacion: 'DIRECTO' });
    await agregarCapitulo(b.contexto, deB, { nombre: 'OTRO DE B', clasificacion: 'DIRECTO' });
    const inexistente = '01900000-0000-7000-8000-000000000000';

    const casos = (presupuesto: string, nodo: string) =>
      [
        ['POST', `/api/presupuestos/${presupuesto}/capitulos`, { nombre: 'X', clasificacion: 'DIRECTO' }],
        ['POST', `/api/nodos/${nodo}/subniveles`, { nombre: 'X' }],
        ['PATCH', `/api/nodos/${nodo}`, { nombre: 'X' }],
        ['POST', `/api/nodos/${nodo}/mover`, { posicion: 2 }],
        ['DELETE', `/api/nodos/${nodo}?confirmado=si`, undefined],
      ] as const;

    const ajenos = casos(deB, capB.id);
    const inexistentes = casos(inexistente, inexistente);
    const noIds = casos('no-es-un-id', 'no-es-un-id');
    for (let k = 0; k < ajenos.length; k += 1) {
      const respuestas = [];
      for (const [metodo, url, cuerpo] of [ajenos[k]!, inexistentes[k]!, noIds[k]!]) {
        const r = await enviar(metodo, url, a.cookie, cuerpo);
        respuestas.push([r.estado, r.crudo]);
      }
      assert.equal(respuestas[0]![0], 404, `${ajenos[k]![0]} ${ajenos[k]![1]}: ${respuestas[0]![1]}`);
      assert.deepEqual(respuestas[1], respuestas[0]);
      assert.deepEqual(respuestas[2], respuestas[0]);
    }

    const mesaDeB = await app.inject({ method: 'GET', url: `/api/presupuestos/${deB}/mesa`, remoteAddress: otraIp(), headers: { cookie: b.cookie } });
    assert.deepEqual(arbol(mesaDeB.json<Mesa>()), ['1.0 DE B (DIRECTO)', '2.0 OTRO DE B (DIRECTO)']);
  });
});
