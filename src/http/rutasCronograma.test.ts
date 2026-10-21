import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { armarPresupuestoDeReferencia } from '../pruebas/presupuestoDeReferencia.js';
import { VERSION_TERMINOS_DE_PRUEBA, clienteDePrueba, type Cuenta, CARPETA_LEGAL_DE_PRUEBA } from '../pruebas/clienteHttp.js';
import { construirServidor } from './servidor.js';

/*
 * El cronograma por HTTP (CONTRATO §19.5–§19.6), sobre el presupuesto de
 * referencia del 06 §8: siete ítems en tres capítulos. Sus APU no tienen
 * rendimiento, así que las duraciones se escriben a mano. El calendario es el
 * de por defecto de toda empresa: lunes a viernes, 7:00–12:00 y 13:00–16:00.
 * El cronograma empieza el lunes 2 de noviembre de 2026.
 */

let app: FastifyInstance;
const { otraIp, registrar } = clienteDePrueba(() => app);

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

interface Actividad {
  id: string;
  codigo: string;
  nombre: string;
  tipo: string;
  [clave: string]: any;
}

const porNombre = (vista: Record<string, any>, nombre: string): Actividad => vista.actividades.find((a: Actividad) => a.nombre === nombre);

describe('crear y leer el cronograma (CONTRATO §19.5, RF-PRG-01)', () => {
  let duena: Cuenta;
  let presupuestoId: string;

  before(async () => {
    duena = await registrar('Constructora Cronograma', '900000982-2', 'cronograma.duena@construsoft.test');
    ({ presupuestoId } = await armarPresupuestoDeReferencia(duena.contexto, 'CRONO-RETIRO'));
  });

  test('antes de crearlo, leer responde 200 con cronograma nulo', async () => {
    const r = await llamar('GET', `/api/presupuestos/${presupuestoId}/cronograma`, duena.cookie);
    assert.deepEqual([r.estado, r.cuerpo], [200, { cronograma: null }]);
  });

  test('nace con una actividad por ítem en el orden de la EDT, la administración y los dos hitos; sin relaciones; ya calculado', async () => {
    const r = await llamar('POST', `/api/presupuestos/${presupuestoId}/cronograma`, duena.cookie, { fechaInicio: '2026-11-02' });
    assert.equal(r.estado, 201, r.crudo);
    const v = r.cuerpo;
    assert.deepEqual({ ...v.cronograma, id: undefined }, {
      id: undefined,
      presupuestoId,
      version: 1,
      fechaInicio: '2026-11-02',
      editable: true,
      recalculado: false,
      inicio: '2026-11-02T07:00',
      fin: '2026-11-02T07:00',
      duracionDias: '0.0',
    });
    assert.deepEqual([v.calendarios.obra.nombre, v.calendarios.obra.tipo, v.calendarios.obra.horasSemana], ['Lunes a viernes', 'OBRA', '40.0']);
    assert.deepEqual([v.calendarios.corrido.tipo, v.calendarios.corrido.horasPorDia, v.calendarios.corrido.horasSemana], ['CORRIDO', '24.00', '168.0']);
    assert.deepEqual(v.capitulos.map((c: { nombre: string; nivel: number; posicion: number }) => [c.nombre, c.nivel, c.posicion]), [
      ['PRELIMINARES', 1, 1],
      ['CIMENTACIÓN', 1, 2],
      ['ESTRUCTURA', 1, 3],
    ]);
    assert.deepEqual(v.actividades.map((a: Actividad) => [a.tipo, a.nombre]), [
      ['ITEM', 'Topografía y replanteo'],
      ['ITEM', 'Estudio de suelos'],
      ['ITEM', 'Director de obra'],
      ['ITEM', 'Excavación manual'],
      ['ITEM', 'Concreto 3000 PSI para zapatas'],
      ['ITEM', 'Acero de refuerzo 60.000 PSI'],
      ['ITEM', 'Formaleta metálica'],
      ['ADMINISTRACION', 'Administración y supervisión de obra'],
      ['HITO_INICIO', 'Inicio del proyecto'],
      ['HITO_FIN', 'Fin del proyecto'],
    ]);
    const topografia = porNombre(v, 'Topografía y replanteo');
    assert.deepEqual({ ...topografia, id: undefined, capituloId: undefined, presupuestoItemId: undefined }, {
      id: undefined,
      tipo: 'ITEM',
      codigo: topografia.codigo,
      nombre: 'Topografía y replanteo',
      capituloId: undefined,
      grupoId: null,
      orden: 1,
      presupuestoItemId: undefined,
      enPresupuesto: true,
      cantidad: '1.000000',
      unidad: 'Glb',
      rendimiento: null,
      costo: '3200000.000000',
      cuadrillas: 1,
      usaCorrido: false,
      duracionCalculadaDias: null,
      duracionManualDias: null,
      duracionDias: '0.0',
      restriccion: null,
      restriccionSecundaria: null,
      inicio: '2026-11-02T07:00',
      fin: '2026-11-02T07:00',
      inicioTardio: '2026-11-02T07:00',
      finTardio: '2026-11-02T07:00',
      holguraTotalDias: '0.0',
      holguraLibreDias: '0.0',
      critica: true,
      finAMitadDeJornada: false,
    });
    assert.equal(topografia.capituloId, v.capitulos[0].id);
    assert.match(topografia.codigo, /^\d+(\.\d+)+$/);
    const adm = porNombre(v, 'Administración y supervisión de obra');
    // RN-37: la administración del AIU, 10 % de un costo directo de 105.490.000 (06 §8).
    assert.deepEqual([adm.codigo, adm.costo, adm.inicioTardio, adm.holguraTotalDias, adm.critica], ['ADM', '10549000.000000', null, null, false]);

    const items = v.actividades.filter((a: Actividad) => a.tipo === 'ITEM').map((a: Actividad) => a.id);
    const hitos = v.actividades.filter((a: Actividad) => a.tipo.startsWith('HITO')).map((a: Actividad) => a.id);
    assert.deepEqual(v.revision, {
      sinProgramar: items,
      yaNoEstan: [],
      manualDistinta: [],
      sinRendimiento: items,
      sinPredecesora: [...items, ...hitos],
      sinSucesora: [...items, ...hitos],
      holguraNegativa: [],
    });
    assert.deepEqual([v.grupos, v.dependencias, v.avisos, v.lineasBase, v.lineaBase], [[], [], { presupuesto: null, festivos: null, administracion: null }, [], null]);
  });

  test('un segundo cronograma para el mismo presupuesto es 409; uno sin fecha, 422 en fechaInicio', async () => {
    assert.equal((await llamar('POST', `/api/presupuestos/${presupuestoId}/cronograma`, duena.cookie, { fechaInicio: '2026-11-02' })).estado, 409);
    const otro = await armarPresupuestoDeReferencia(duena.contexto, 'CRONO-RETIRO-2');
    const sinFecha = await llamar('POST', `/api/presupuestos/${otro.presupuestoId}/cronograma`, duena.cookie, {});
    assert.deepEqual([sinFecha.estado, sinFecha.cuerpo.campo], [422, 'fechaInicio']);
  });

  test('leerlo de nuevo no recalcula: está al día', async () => {
    const r = await llamar('GET', `/api/presupuestos/${presupuestoId}/cronograma`, duena.cookie);
    assert.deepEqual([r.estado, r.cuerpo.cronograma.recalculado, r.cuerpo.cronograma.version], [200, false, 1]);
  });
});

describe('editar: duraciones, relaciones, la versión y los círculos (CONTRATO §19.6)', () => {
  let duena: Cuenta;
  let vista: Record<string, any>;
  let cronogramaId: string;

  before(async () => {
    duena = await registrar('Constructora Cronograma Edita', '900000983-3', 'cronograma.edita@construsoft.test');
    const { presupuestoId } = await armarPresupuestoDeReferencia(duena.contexto, 'CRONO-EDITA');
    vista = (await llamar('POST', `/api/presupuestos/${presupuestoId}/cronograma`, duena.cookie, { fechaInicio: '2026-11-02' })).cuerpo;
    cronogramaId = vista.cronograma.id;
  });

  const patch = (actividad: Actividad, cambios: Record<string, unknown>) =>
    llamar('PATCH', `/api/cronogramas/${cronogramaId}/actividades/${actividad.id}`, duena.cookie, { version: vista.cronograma.version, ...cambios });

  test('una duración manual en días se guarda en horas y recalcula en la misma petición; la versión sube', async () => {
    const r = await patch(porNombre(vista, 'Topografía y replanteo'), { duracionManualDias: '2' });
    assert.equal(r.estado, 200, r.crudo);
    vista = r.cuerpo;
    const topografia = porNombre(vista, 'Topografía y replanteo');
    assert.deepEqual([vista.cronograma.version, topografia.duracionManualDias, topografia.duracionDias, topografia.inicio, topografia.fin], [
      2, '2.0', '2.0', '2026-11-02T07:00', '2026-11-03T16:00',
    ]);
    assert.deepEqual(vista.revision.manualDistinta, []);
  });

  test('una relación FC: la excavación arranca después de la topografía, y la administración las abarca a las dos', async () => {
    vista = (await patch(porNombre(vista, 'Excavación manual'), { duracionManualDias: '3' })).cuerpo;
    const r = await llamar('POST', `/api/cronogramas/${cronogramaId}/dependencias`, duena.cookie, {
      version: vista.cronograma.version,
      predecesoraId: porNombre(vista, 'Topografía y replanteo').id,
      sucesoraId: porNombre(vista, 'Excavación manual').id,
      tipo: 'FC',
      desfaseDias: '0',
    });
    assert.equal(r.estado, 200, r.crudo);
    vista = r.cuerpo;
    const excavacion = porNombre(vista, 'Excavación manual');
    assert.deepEqual([excavacion.inicio, excavacion.fin, excavacion.critica], ['2026-11-04T07:00', '2026-11-06T16:00', true]);
    const adm = porNombre(vista, 'Administración y supervisión de obra');
    assert.deepEqual([adm.inicio, adm.fin, adm.duracionDias], ['2026-11-02T07:00', '2026-11-06T16:00', '5.0']);
    assert.deepEqual([vista.cronograma.fin, vista.cronograma.duracionDias], ['2026-11-06T16:00', '5.0']);
    // Un ítem sin duración ni relaciones tiene toda la obra de holgura.
    assert.equal(porNombre(vista, 'Estudio de suelos').holguraTotalDias, '5.0');
    assert.deepEqual(vista.dependencias.map((d: { tipo: string; desfaseDias: string }) => [d.tipo, d.desfaseDias]), [['FC', '0.0']]);
    assert.ok(!vista.revision.sinProgramar.includes(excavacion.id));
  });

  test('un guardado con una versión vieja es 409 con la versión nueva en cronograma, y no guarda nada', async () => {
    const vieja = vista.cronograma.version - 1;
    const r = await llamar('PATCH', `/api/cronogramas/${cronogramaId}/actividades/${porNombre(vista, 'Estudio de suelos').id}`, duena.cookie, {
      version: vieja,
      duracionManualDias: '9',
    });
    assert.equal(r.estado, 409, r.crudo);
    assert.match(r.cuerpo.mensaje, /Otra persona cambió el cronograma/);
    assert.equal(r.cuerpo.cronograma.cronograma.version, vista.cronograma.version);
    assert.equal(porNombre(r.cuerpo.cronograma, 'Estudio de suelos').duracionManualDias, null);
  });

  test('una relación que cierra un círculo es 422 en predecesoraId con los ids del círculo, y no se guarda', async () => {
    const r = await llamar('POST', `/api/cronogramas/${cronogramaId}/dependencias`, duena.cookie, {
      version: vista.cronograma.version,
      predecesoraId: porNombre(vista, 'Excavación manual').id,
      sucesoraId: porNombre(vista, 'Topografía y replanteo').id,
      tipo: 'FC',
      desfaseDias: '0',
    });
    assert.deepEqual([r.estado, r.cuerpo.campo], [422, 'predecesoraId'], r.crudo);
    assert.deepEqual([...r.cuerpo.ciclo].sort(), [porNombre(vista, 'Excavación manual').id, porNombre(vista, 'Topografía y replanteo').id].sort());
    const leida = await llamar('GET', `/api/presupuestos/${vista.cronograma.presupuestoId}/cronograma`, duena.cookie);
    assert.deepEqual([leida.cuerpo.cronograma.version, leida.cuerpo.dependencias.length], [vista.cronograma.version, 1]);
  });
});
