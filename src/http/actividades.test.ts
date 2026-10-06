import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { crearPresupuesto } from '../infraestructura/basedatos/presupuesto.js';
import { agregarCapitulo } from '../infraestructura/basedatos/edt.js';
import { agregarActividad } from '../infraestructura/basedatos/actividad.js';
import { activarPresupuesto } from '../infraestructura/basedatos/cicloDeVida.js';
import { armarPresupuestoDeReferencia, type PresupuestoDeReferencia } from '../pruebas/presupuestoDeReferencia.js';
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

interface Actividad {
  id: string;
  nodoId: string;
  codigoItem: string;
  posicion: number;
  codigoApu: string;
  descripcion: string;
  unidadSimbolo: string;
  cantidad: string;
  precioUnitario: string;
  costoTotal: string;
  apuId: string;
}
interface Mesa {
  nodos: { id: string; padreId: string | null; codigoWbs: string; montoAcumulado: string }[];
  actividades: Actividad[];
  pie: Record<string, unknown> & { valorTotal: string };
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

const mesaDe = async (presupuestoId: string, cookie: string) => (await pedir(`/api/presupuestos/${presupuestoId}/mesa`, cookie)).json<Mesa>();

/** Las actividades de un nodo, en orden de posición: «1.1 TOP-001 x1.000000». */
const filasDe = (m: Mesa, nodoId: string) =>
  m.actividades
    .filter((a) => a.nodoId === nodoId)
    .sort((x, y) => x.posicion - y.posicion)
    .map((a) => `${a.codigoItem} ${a.descripcion} x${a.cantidad}`);

describe('GET /api/apu/buscar: el autocompletado de la mesa (contrato §4.3, 02 §8.3)', () => {
  let duena: Cuenta;
  let referencia: PresupuestoDeReferencia;

  before(async () => {
    duena = await registrar('Constructora Buscar', '900000320-0', 'buscar.admin@construsoft.test');
    referencia = await armarPresupuestoDeReferencia(duena.contexto, 'BUS-REF');
  });

  test('devuelve lo que hace falta para elegir, y nada más', async () => {
    const r = await pedir('/api/apu/buscar?q=concreto', duena.cookie);
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json(), {
      apus: [
        {
          id: referencia.concreto.id,
          codigo: referencia.concreto.codigo,
          nombre: 'Concreto 3000 PSI para zapatas',
          unidadSimbolo: 'm³',
          costoDirecto: '636750.000000',
          activo: true,
        },
      ],
    });
  });

  test('limite acota el número de resultados', async () => {
    // «Recurso ·» no es un APU; los APU de la referencia que tienen «o»: varios.
    const todos = (await pedir('/api/apu/buscar?q=o', duena.cookie)).json<{ apus: unknown[] }>().apus.length;
    assert.ok(todos > 2, `hay ${todos}`);
    assert.equal((await pedir('/api/apu/buscar?q=o&limite=2', duena.cookie)).json<{ apus: unknown[] }>().apus.length, 2);
  });

  test('sin texto, o con un límite que no es un entero de 1 a 50: 422 que marca el campo', async () => {
    for (const [url, campo] of [
      ['/api/apu/buscar', 'q'],
      ['/api/apu/buscar?q=%20%20', 'q'],
      ['/api/apu/buscar?q=x&limite=0', 'limite'],
      ['/api/apu/buscar?q=x&limite=51', 'limite'],
      ['/api/apu/buscar?q=x&limite=dos', 'limite'],
    ] as const) {
      const r = await pedir(url, duena.cookie);
      assert.deepEqual([r.statusCode, r.json<{ campo?: string }>().campo], [422, campo], url);
    }
  });

  test('sin APU.VER: 403 con el nombre del permiso', async () => {
    const cookie = await asistenteCon(duena, 'buscar.sinapu@construsoft.test', ['PRESUPUESTOS.VER']);
    const r = await pedir('/api/apu/buscar?q=concreto', cookie);
    assert.equal(r.statusCode, 403);
    assert.match(r.json<{ mensaje: string }>().mensaje, /APU\.VER/);
  });

  test('aislamiento: los APU de otra empresa no aparecen (cero resultados, no un error)', async () => {
    const otra = await registrar('Constructora Buscar B', '900000321-1', 'buscar.b@construsoft.test');
    const r = await pedir('/api/apu/buscar?q=concreto', otra.cookie);
    assert.deepEqual([r.statusCode, r.json()], [200, { apus: [] }]);
  });
});

describe('actividades de la mesa: cada mutación responde con la mesa completa (contrato §4.3)', () => {
  let duena: Cuenta;
  let referencia: PresupuestoDeReferencia;
  let presupuesto: string;
  let capitulo: string;

  before(async () => {
    duena = await registrar('Constructora Actividades', '900000322-2', 'actividades.admin@construsoft.test');
    referencia = await armarPresupuestoDeReferencia(duena.contexto, 'ACT-REF');
    presupuesto = (await crearPresupuesto(duena.contexto, { codigo: 'ACT-WBS', nombre: 'Act', ubicacion: 'Bello', modoEstructura: 'WBS' })).id;
    capitulo = (await agregarCapitulo(duena.contexto, presupuesto, { nombre: 'OBRA', clasificacion: 'DIRECTO' })).id;
  });

  test('agregar: 201, y el código, la descripción, la unidad y el precio los pone el servidor desde el APU', async () => {
    const r = await enviar('POST', `/api/nodos/${capitulo}/actividades`, duena.cookie, { apuId: referencia.concreto.id, cantidad: '2' });
    assert.equal(r.estado, 201, r.crudo);
    const [a] = r.cuerpo.actividades.filter((x) => x.nodoId === capitulo);
    assert.deepEqual(
      { codigoItem: a!.codigoItem, codigoApu: a!.codigoApu, descripcion: a!.descripcion, unidad: a!.unidadSimbolo, cantidad: a!.cantidad, precio: a!.precioUnitario, costo: a!.costoTotal },
      {
        codigoItem: '1.1',
        codigoApu: referencia.concreto.codigo,
        descripcion: 'Concreto 3000 PSI para zapatas',
        unidad: 'm³',
        cantidad: '2.000000',
        precio: '636750.000000',
        costo: '1273500.000000',
      },
    );
    assert.equal(r.cuerpo.nodos.find((n) => n.id === capitulo)!.montoAcumulado, '1273500.000000');
  });

  test('la interfaz no manda precio ni descripción: un campo de más es 422 que lo nombra', async () => {
    const r = await enviar('POST', `/api/nodos/${capitulo}/actividades`, duena.cookie, {
      apuId: referencia.concreto.id,
      cantidad: '1',
      precioUnitario: '1',
    });
    assert.deepEqual([r.estado, r.cuerpo.campo], [422, 'precioUnitario']);
  });

  test('la cantidad viaja como texto decimal con punto y no negativa: si no, 422 en cantidad', async () => {
    for (const cantidad of [3, '-1', '1,5', '', 'abc', '1.1234567']) {
      const r = await enviar('POST', `/api/nodos/${capitulo}/actividades`, duena.cookie, { apuId: referencia.concreto.id, cantidad });
      assert.deepEqual([r.estado, r.cuerpo.campo], [422, 'cantidad'], `cantidad ${JSON.stringify(cantidad)}`);
    }
    const sinApu = await enviar('POST', `/api/nodos/${capitulo}/actividades`, duena.cookie, { apuId: 'x', cantidad: '1' });
    assert.deepEqual([sinApu.estado, sinApu.cuerpo.campo], [422, 'apuId']);
  });

  test('editar la cantidad: es lo único editable de la fila; el costo y el pie los recalcula la base', async () => {
    const p = (await crearPresupuesto(duena.contexto, { codigo: 'ACT-CANT', nombre: 'C', ubicacion: 'Bello', modoEstructura: 'WBS' })).id;
    const c = (await agregarCapitulo(duena.contexto, p, { nombre: 'OBRA', clasificacion: 'DIRECTO' })).id;
    const a = await agregarActividad(duena.contexto, c, referencia.concreto.id, '1');

    const r = await enviar('PATCH', `/api/actividades/${a.id}`, duena.cookie, { cantidad: '10.5' });
    assert.equal(r.estado, 200, r.crudo);
    assert.deepEqual(filasDe(r.cuerpo, c), ['1.1 Concreto 3000 PSI para zapatas x10.500000']);
    assert.equal(r.cuerpo.actividades[0]!.costoTotal, '6685875.000000');

    const otraCosa = await enviar('PATCH', `/api/actividades/${a.id}`, duena.cookie, { cantidad: '1', descripcion: 'otra' });
    assert.deepEqual([otraCosa.estado, otraCosa.cuerpo.campo], [422, 'descripcion']);
  });

  test('mover a una posición absoluta, y eliminar: la base renumera', async () => {
    const p = (await crearPresupuesto(duena.contexto, { codigo: 'ACT-MOV', nombre: 'M', ubicacion: 'Bello', modoEstructura: 'WBS' })).id;
    const c = (await agregarCapitulo(duena.contexto, p, { nombre: 'OBRA', clasificacion: 'DIRECTO' })).id;
    const a1 = await agregarActividad(duena.contexto, c, referencia.concreto.id, '1');
    await agregarActividad(duena.contexto, c, referencia.concreto.id, '2');
    const a3 = await agregarActividad(duena.contexto, c, referencia.concreto.id, '3');

    const movida = await enviar('POST', `/api/actividades/${a3.id}/mover`, duena.cookie, { posicion: 1 });
    assert.equal(movida.estado, 200, movida.crudo);
    const esperado = [
      '1.1 Concreto 3000 PSI para zapatas x3.000000',
      '1.2 Concreto 3000 PSI para zapatas x1.000000',
      '1.3 Concreto 3000 PSI para zapatas x2.000000',
    ];
    assert.deepEqual(filasDe(movida.cuerpo, c), esperado);
    // El mismo pedido otra vez no la corre más.
    assert.deepEqual(filasDe((await enviar('POST', `/api/actividades/${a3.id}/mover`, duena.cookie, { posicion: 1 })).cuerpo, c), esperado);

    const fuera = await enviar('POST', `/api/actividades/${a3.id}/mover`, duena.cookie, { posicion: 4 });
    assert.deepEqual([fuera.estado, fuera.cuerpo.campo], [422, 'posicion']);
    assert.match(fuera.cuerpo.mensaje!, /1 a 3/);

    const borrada = await enviar('DELETE', `/api/actividades/${a1.id}`, duena.cookie);
    assert.equal(borrada.estado, 200, borrada.crudo);
    assert.deepEqual(filasDe(borrada.cuerpo, c), ['1.1 Concreto 3000 PSI para zapatas x3.000000', '1.2 Concreto 3000 PSI para zapatas x2.000000']);
  });

  test('una ruta de actividad con el id de un nodo responde 404, y al revés', async () => {
    assert.equal((await enviar('POST', `/api/actividades/${capitulo}/mover`, duena.cookie, { posicion: 1 })).estado, 404);
    assert.equal((await enviar('DELETE', `/api/actividades/${capitulo}`, duena.cookie)).estado, 404);
    const [a] = (await mesaDe(presupuesto, duena.cookie)).actividades;
    assert.equal((await enviar('POST', `/api/nodos/${a!.id}/mover`, duena.cookie, { posicion: 1 })).estado, 404);
  });

  test('sobre un presupuesto ACTIVO la base rechaza: 422 sin campo', async () => {
    const p = await armarPresupuestoDeReferencia(duena.contexto, 'ACT-ACTIVO');
    await activarPresupuesto(duena.contexto, p.presupuestoId);
    const actividad = p.actividades['Topografía y replanteo']!;
    for (const [metodo, url, cuerpo] of [
      ['POST', `/api/nodos/${actividad.wbsNodoId}/actividades`, { apuId: referencia.concreto.id, cantidad: '1' }],
      ['PATCH', `/api/actividades/${actividad.id}`, { cantidad: '2' }],
      ['POST', `/api/actividades/${actividad.id}/mover`, { posicion: 2 }],
      ['DELETE', `/api/actividades/${actividad.id}`, undefined],
      ['PATCH', `/api/presupuestos/${p.presupuestoId}/porcentajes`, { a: '1', i: '1', u: '1', iva: '19' }],
    ] as const) {
      const r = await enviar(metodo, url, duena.cookie, cuerpo);
      assert.deepEqual([r.estado, r.cuerpo.campo], [422, undefined], `${metodo} ${url}: ${r.crudo}`);
    }
  });

  test('sin PRESUPUESTOS.EDITAR: 403 en cada mutación, y nada cambia', async () => {
    const lector = await asistenteCon(duena, 'actividades.lector@construsoft.test', ['PRESUPUESTOS.VER', 'APU.VER']);
    const actividad = referencia.actividades['Topografía y replanteo']!;
    const antes = await mesaDe(referencia.presupuestoId, duena.cookie);
    for (const [metodo, url, cuerpo] of [
      ['POST', `/api/nodos/${actividad.wbsNodoId}/actividades`, { apuId: referencia.concreto.id, cantidad: '1' }],
      ['PATCH', `/api/actividades/${actividad.id}`, { cantidad: '2' }],
      ['POST', `/api/actividades/${actividad.id}/mover`, { posicion: 2 }],
      ['DELETE', `/api/actividades/${actividad.id}`, undefined],
      ['PATCH', `/api/presupuestos/${referencia.presupuestoId}/porcentajes`, { a: '1', i: '1', u: '1', iva: '19' }],
    ] as const) {
      const r = await enviar(metodo, url, lector, cuerpo);
      assert.equal(r.estado, 403, `${metodo} ${url}: ${r.crudo}`);
      assert.match(r.cuerpo.mensaje!, /PRESUPUESTOS\.EDITAR/);
    }
    assert.deepEqual(await mesaDe(referencia.presupuestoId, duena.cookie), antes);
  });

  test('sin sesión: 401', async () => {
    assert.equal((await enviar('POST', `/api/nodos/${capitulo}/actividades`, undefined, { apuId: referencia.concreto.id, cantidad: '1' })).estado, 401);
  });
});

describe('PATCH /api/presupuestos/:id/porcentajes: responde con el pie recalculado (contrato §4.4)', () => {
  let duena: Cuenta;
  let referencia: PresupuestoDeReferencia;

  before(async () => {
    duena = await registrar('Constructora Porcentajes', '900000323-3', 'porcentajes.admin@construsoft.test');
    referencia = await armarPresupuestoDeReferencia(duena.contexto, 'POR-REF');
  });

  test('administración al 12 %: el pie entero lo recalcula la base', async () => {
    const r = await enviar('PATCH', `/api/presupuestos/${referencia.presupuestoId}/porcentajes`, duena.cookie, {
      a: '12',
      i: '5.00',
      u: '5',
      iva: '19',
    });
    assert.equal(r.estado, 200, r.crudo);
    assert.deepEqual(r.cuerpo, {
      costoIndirecto: '53000000.000000',
      costoDirecto: '105490000.000000',
      administracion: '12658800.000000',
      imprevistos: '5274500.000000',
      utilidad: '5274500.000000',
      aiu: '23207800.000000',
      iva: '1002155.000000',
      valorTotal: '182699955.000000',
      porcentajes: { a: '12.000000', i: '5.000000', u: '5.000000', iva: '19.000000' },
      aiuEnCero: false,
      sinBaseAiu: false,
    });
  });

  test('los cuatro son obligatorios, en puntos y como texto: si no, 422 que marca cuál', async () => {
    for (const [cuerpo, campo] of [
      [{ i: '5', u: '5', iva: '19' }, 'a'],
      [{ a: 10, i: '5', u: '5', iva: '19' }, 'a'],
      [{ a: '10', i: '-5', u: '5', iva: '19' }, 'i'],
      [{ a: '10', i: '5', u: '5,5', iva: '19' }, 'u'],
      [{ a: '10', i: '5', u: '5', iva: '1000' }, 'iva'],
      [{ a: '10', i: '5', u: '5', iva: '19', valorTotal: '1' }, 'valorTotal'],
    ] as const) {
      const r = await enviar('PATCH', `/api/presupuestos/${referencia.presupuestoId}/porcentajes`, duena.cookie, cuerpo);
      assert.deepEqual([r.estado, r.cuerpo.campo], [422, campo], JSON.stringify(cuerpo));
    }
  });
});

describe('actividades y porcentajes con la suscripción vencida: solo lectura (D-65)', () => {
  test('agregar una actividad y cambiar los porcentajes responden 402', async () => {
    const vencida = await registrar('Constructora Actividades Vencida', '900000324-4', 'actividades.vencida@construsoft.test');
    const p = await armarPresupuestoDeReferencia(vencida.contexto, 'ACT-V');
    await vencerSuscripcion(vencida.contexto.tenantId);
    const actividad = p.actividades['Topografía y replanteo']!;
    assert.equal((await enviar('POST', `/api/nodos/${actividad.wbsNodoId}/actividades`, vencida.cookie, { apuId: p.concreto.id, cantidad: '1' })).estado, 402);
    assert.equal((await enviar('PATCH', `/api/presupuestos/${p.presupuestoId}/porcentajes`, vencida.cookie, { a: '1', i: '1', u: '1', iva: '19' })).estado, 402);
  });
});

describe('aislamiento: las actividades y los porcentajes de otra empresa no existen (RN-01)', () => {
  test('cada ruta con un id de B responde el mismo 404 que con uno inexistente o uno que no es un id, y B queda intacta', async () => {
    const a = await registrar('Constructora Actividades A', '900000325-5', 'actividades.a@construsoft.test');
    const b = await registrar('Constructora Actividades B', '900000326-6', 'actividades.b@construsoft.test');
    const deB = await armarPresupuestoDeReferencia(b.contexto, 'ACT-B');
    const apuDeA = (await armarPresupuestoDeReferencia(a.contexto, 'ACT-A')).concreto.id;
    const actividadDeB = deB.actividades['Topografía y replanteo']!;
    const inexistente = '01900000-0000-7000-8000-000000000000';

    const casos = (actividad: string, nodo: string, presupuesto: string) =>
      [
        ['POST', `/api/nodos/${nodo}/actividades`, { apuId: apuDeA, cantidad: '1' }],
        ['PATCH', `/api/actividades/${actividad}`, { cantidad: '2' }],
        ['POST', `/api/actividades/${actividad}/mover`, { posicion: 2 }],
        ['DELETE', `/api/actividades/${actividad}`, undefined],
        ['PATCH', `/api/presupuestos/${presupuesto}/porcentajes`, { a: '1', i: '1', u: '1', iva: '19' }],
      ] as const;
    const ajenos = casos(actividadDeB.id, actividadDeB.wbsNodoId, deB.presupuestoId);
    const inexistentes = casos(inexistente, inexistente, inexistente);
    const noIds = casos('no-es-un-id', 'no-es-un-id', 'no-es-un-id');
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

    // Un APU de B en un capítulo de A: rechazado igual que un APU que no existe.
    const pA = (await crearPresupuesto(a.contexto, { codigo: 'ACT-A3', nombre: 'A3', ubicacion: 'x', modoEstructura: 'WBS' })).id;
    const cA = (await agregarCapitulo(a.contexto, pA, { nombre: 'OBRA', clasificacion: 'DIRECTO' })).id;
    const conApuDeB = await enviar('POST', `/api/nodos/${cA}/actividades`, a.cookie, { apuId: deB.concreto.id, cantidad: '1' });
    const conApuInexistente = await enviar('POST', `/api/nodos/${cA}/actividades`, a.cookie, { apuId: inexistente, cantidad: '1' });
    assert.equal(conApuDeB.estado, 422);
    assert.deepEqual([conApuDeB.estado, conApuDeB.crudo], [conApuInexistente.estado, conApuInexistente.crudo]);
    assert.deepEqual((await mesaDe(pA, a.cookie)).actividades, []);

    const mesaDeB = await mesaDe(deB.presupuestoId, b.cookie);
    assert.equal(mesaDeB.actividades.length, 7);
    assert.equal(mesaDeB.pie.valorTotal, '180590155.000000');
  });
});
