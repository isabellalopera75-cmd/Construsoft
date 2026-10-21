import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { agregarActividad, cambiarCantidad, eliminarActividad } from '../infraestructura/basedatos/actividad.js';
import { activarPresupuesto, cerrarPresupuesto } from '../infraestructura/basedatos/cicloDeVida.js';
import { armarPresupuestoDeReferencia, type PresupuestoDeReferencia } from '../pruebas/presupuestoDeReferencia.js';
import { comoSuperusuario, vencerSuscripcion } from '../pruebas/superusuario.js';
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
const { otraIp, registrar, asistenteCon } = clienteDePrueba(() => app);

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

describe('el presupuesto manda sobre el cronograma (RN-33, D-91)', () => {
  let duena: Cuenta;
  let referencia: PresupuestoDeReferencia;
  let vista: Record<string, any>;
  const leer = async () => (await llamar('GET', `/api/presupuestos/${referencia.presupuestoId}/cronograma`, duena.cookie)).cuerpo;

  before(async () => {
    duena = await registrar('Constructora Cronograma Presupuesto', '900000984-4', 'cronograma.presupuesto@construsoft.test');
    referencia = await armarPresupuestoDeReferencia(duena.contexto, 'CRONO-MANDA');
    vista = (await llamar('POST', `/api/presupuestos/${referencia.presupuestoId}/cronograma`, duena.cookie, { fechaInicio: '2026-11-02' })).cuerpo;
  });

  test('cambiar una cantidad deja el cronograma desactualizado: la lectura siguiente lo recalcula sin mover la versión', async () => {
    await cambiarCantidad(duena.contexto, referencia.actividades['Excavación manual']!.id, '130');
    const primera = await leer();
    assert.deepEqual([primera.cronograma.recalculado, primera.cronograma.version, porNombre(primera, 'Excavación manual').cantidad], [true, 1, '130.000000']);
    assert.equal((await leer()).cronograma.recalculado, false);
  });

  test('un ítem nuevo aparece en su capítulo, sin relaciones y «sin programar»', async () => {
    const estructura = vista.capitulos.find((c: { nombre: string }) => c.nombre === 'ESTRUCTURA').id;
    const item = await agregarActividad(duena.contexto, estructura, referencia.concreto.id, '12');
    const v = await leer();
    const nueva = v.actividades.find((a: Actividad) => a.presupuestoItemId === item.id);
    assert.deepEqual([nueva.tipo, nueva.capituloId, nueva.codigo, nueva.enPresupuesto], ['ITEM', estructura, item.codigoItem, true]);
    assert.ok(v.revision.sinProgramar.includes(nueva.id));
    // En el orden de la EDT: justo después de la formaleta, el último ítem de ESTRUCTURA.
    const ids = v.actividades.map((a: Actividad) => a.id);
    assert.equal(ids.indexOf(nueva.id), ids.indexOf(porNombre(v, 'Formaleta metálica').id) + 1);
    vista = v;
  });

  test('un ítem que sale del presupuesto queda «ya no está», con código X-, sus relaciones y su duración; el usuario lo borra', async () => {
    const suelos = porNombre(vista, 'Estudio de suelos');
    vista = (await llamar('PATCH', `/api/cronogramas/${vista.cronograma.id}/actividades/${suelos.id}`, duena.cookie, { version: vista.cronograma.version, duracionManualDias: '1' })).cuerpo;
    vista = (
      await llamar('POST', `/api/cronogramas/${vista.cronograma.id}/dependencias`, duena.cookie, {
        version: vista.cronograma.version,
        predecesoraId: suelos.id,
        sucesoraId: porNombre(vista, 'Excavación manual').id,
        tipo: 'FC',
        desfaseDias: '0',
      })
    ).cuerpo;

    await eliminarActividad(duena.contexto, referencia.actividades['Estudio de suelos']!.id);
    const v = await leer();
    const huerfana = v.actividades.find((a: Actividad) => a.id === suelos.id);
    assert.deepEqual(
      [huerfana.enPresupuesto, huerfana.capituloId, huerfana.presupuestoItemId, huerfana.codigo, huerfana.duracionDias],
      [false, null, null, `X-${suelos.codigo}`, '1.0'],
    );
    assert.deepEqual([v.revision.yaNoEstan, v.dependencias.length], [[suelos.id], 1]);
    const tipos = v.actividades.map((a: Actividad) => a.tipo);
    assert.equal(v.actividades.indexOf(huerfana), tipos.indexOf('ADMINISTRACION') - 1);

    const borrada = await llamar('DELETE', `/api/cronogramas/${v.cronograma.id}/actividades/${suelos.id}?version=${v.cronograma.version}`, duena.cookie);
    assert.equal(borrada.estado, 200, borrada.crudo);
    assert.deepEqual([borrada.cuerpo.actividades.some((a: Actividad) => a.id === suelos.id), borrada.cuerpo.dependencias.length], [false, 0]);
    vista = borrada.cuerpo;
  });

  test('la actividad de un ítem que sigue en el presupuesto, y la administración, no se borran: 422', async () => {
    for (const nombre of ['Topografía y replanteo', 'Administración y supervisión de obra']) {
      const r = await llamar('DELETE', `/api/cronogramas/${vista.cronograma.id}/actividades/${porNombre(vista, nombre).id}?version=${vista.cronograma.version}`, duena.cookie);
      assert.equal(r.estado, 422, `${nombre}: ${r.crudo}`);
    }
  });

  test('con el presupuesto Cerrado se lee y se recalcula, pero no se escribe (RN-34)', async () => {
    await activarPresupuesto(duena.contexto, referencia.presupuestoId);
    await cerrarPresupuesto(duena.contexto, referencia.presupuestoId);
    const v = await leer();
    assert.deepEqual([v.cronograma.editable, v.cronograma.recalculado], [false, true]);
    const r = await llamar('PATCH', `/api/cronogramas/${v.cronograma.id}/actividades/${porNombre(v, 'Topografía y replanteo').id}`, duena.cookie, {
      version: v.cronograma.version,
      cuadrillas: 1,
    });
    assert.deepEqual([r.estado, r.cuerpo.campo], [422, undefined], r.crudo);
    assert.match(r.cuerpo.mensaje, /Cerrado/);
    assert.equal((await leer()).cronograma.version, v.cronograma.version);
  });
});

describe('cronograma: permiso y aislamiento (RN-43, RN-01)', () => {
  let duena: Cuenta;
  let vista: Record<string, any>;

  before(async () => {
    duena = await registrar('Constructora Cronograma Permiso', '900000985-5', 'cronograma.permiso@construsoft.test');
    const { presupuestoId } = await armarPresupuestoDeReferencia(duena.contexto, 'CRONO-PERMISO');
    vista = (await llamar('POST', `/api/presupuestos/${presupuestoId}/cronograma`, duena.cookie, { fechaInicio: '2026-11-02' })).cuerpo;
  });

  test('quien solo ve el presupuesto lee el cronograma con editable falso, y escribir es 403', async () => {
    const lector = await asistenteCon(duena, 'cronograma.lector@construsoft.test', ['PRESUPUESTOS.VER']);
    const r = await llamar('GET', `/api/presupuestos/${vista.cronograma.presupuestoId}/cronograma`, lector);
    assert.deepEqual([r.estado, r.cuerpo.cronograma.editable], [200, false]);
    const escribe = await llamar('PATCH', `/api/cronogramas/${vista.cronograma.id}`, lector, { version: vista.cronograma.version, fechaInicio: '2026-11-09' });
    assert.equal(escribe.estado, 403);
  });

  test('el cronograma de otra empresa no existe: leerlo, crearlo, editarlo o cerrar su aviso es 404', async () => {
    const otra = await registrar('Constructora Cronograma Ajena', '900000986-6', 'cronograma.ajena@construsoft.test');
    const id = vista.cronograma.id;
    const actividad = vista.actividades[0].id;
    for (const [metodo, url, cuerpo] of [
      ['GET', `/api/presupuestos/${vista.cronograma.presupuestoId}/cronograma`, undefined],
      ['POST', `/api/presupuestos/${vista.cronograma.presupuestoId}/cronograma`, { fechaInicio: '2026-11-02' }],
      ['PATCH', `/api/cronogramas/${id}`, { version: 1, fechaInicio: '2026-11-09' }],
      ['PATCH', `/api/cronogramas/${id}/actividades/${actividad}`, { version: 1, cuadrillas: 2 }],
      ['POST', `/api/cronogramas/${id}/grupos`, { version: 1, nombre: 'Robado' }],
      ['DELETE', `/api/cronogramas/${id}/actividades/${actividad}?version=1`, undefined],
      ['POST', `/api/cronogramas/${id}/aviso/cerrar`, {}],
      ['GET', '/api/presupuestos/no-es-un-id/cronograma', undefined],
    ] as const) {
      const r = await llamar(metodo, url, otra.cookie, cuerpo);
      assert.equal(r.estado, 404, `${metodo} ${url}: ${r.crudo}`);
    }
    const intacto = await llamar('GET', `/api/presupuestos/${vista.cronograma.presupuestoId}/cronograma`, duena.cookie);
    assert.deepEqual([intacto.cuerpo.cronograma.version, intacto.cuerpo.cronograma.fechaInicio, intacto.cuerpo.grupos], [1, '2026-11-02', []]);
  });
});

describe('las curvas y las líneas base (CONTRATO §19.7–§19.8)', () => {
  let duena: Cuenta;
  let referencia: PresupuestoDeReferencia;
  let vista: Record<string, any>;
  const editarActividad = async (nombre: string, cambios: Record<string, unknown>) => {
    const r = await llamar('PATCH', `/api/cronogramas/${vista.cronograma.id}/actividades/${porNombre(vista, nombre).id}`, duena.cookie, {
      version: vista.cronograma.version,
      ...cambios,
    });
    assert.equal(r.estado, 200, r.crudo);
    vista = r.cuerpo;
  };
  const leer = async (consulta = '') => (await llamar('GET', `/api/presupuestos/${referencia.presupuestoId}/cronograma${consulta}`, duena.cookie)).cuerpo;

  before(async () => {
    duena = await registrar('Constructora Cronograma Curvas', '900000987-7', 'cronograma.curvas@construsoft.test');
    referencia = await armarPresupuestoDeReferencia(duena.contexto, 'CRONO-CURVAS');
    vista = (await llamar('POST', `/api/presupuestos/${referencia.presupuestoId}/cronograma`, duena.cookie, { fechaInicio: '2026-11-02' })).cuerpo;
    // Una cadena de nueve semanas: cada ítem dura una o dos y sigue al anterior.
    const nombres = vista.actividades.filter((a: Actividad) => a.tipo === 'ITEM').map((a: Actividad) => a.nombre);
    for (const [i, nombre] of nombres.entries()) await editarActividad(nombre, { duracionManualDias: i % 2 === 0 ? '5' : '10' });
    for (let i = 1; i < nombres.length; i += 1) {
      const r = await llamar('POST', `/api/cronogramas/${vista.cronograma.id}/dependencias`, duena.cookie, {
        version: vista.cronograma.version,
        predecesoraId: porNombre(vista, nombres[i - 1]).id,
        sucesoraId: porNombre(vista, nombres[i]).id,
        tipo: 'FC',
        desfaseDias: '0',
      });
      vista = r.cuerpo;
    }
  });

  test('la facturación suma el valor total y el costo, directo más indirecto más administración; las acumuladas cierran en esos totales', async () => {
    for (const granularidad of ['SEMANA', 'MES']) {
      const r = await llamar('GET', `/api/cronogramas/${vista.cronograma.id}/curvas?granularidad=${granularidad}`, duena.cookie);
      assert.equal(r.estado, 200, r.crudo);
      const { periodos, totales } = r.cuerpo;
      assert.equal(r.cuerpo.granularidad, granularidad);
      // 06 §8: el presupuesto de referencia cierra en 180.590.155.
      assert.equal(totales.facturacion, '180590155.000000');
      const ultimo = periodos.at(-1);
      assert.deepEqual([ultimo.facturacionAcumulada, ultimo.costoAcumulado], [totales.facturacion, totales.costo]);
      assert.ok(periodos.length >= (granularidad === 'SEMANA' ? 9 : 3), `${granularidad}: ${periodos.length} periodos`);
      assert.ok(periodos.every((p: { periodo: string }) => /^\d{4}-\d{2}-\d{2}$/.test(p.periodo)));
      assert.equal(r.cuerpo.lineaBase, null);
    }
    const semanas = (await llamar('GET', `/api/cronogramas/${vista.cronograma.id}/curvas?granularidad=SEMANA`, duena.cookie)).cuerpo.periodos;
    // La semana empieza el lunes (inicio_semana = 1): cada periodo se nombra por su lunes.
    assert.ok(semanas.every((p: { periodo: string }) => new Date(`${p.periodo}T00:00Z`).getUTCDay() === 1));
    const mala = await llamar('GET', `/api/cronogramas/${vista.cronograma.id}/curvas?granularidad=DIA`, duena.cookie);
    assert.deepEqual([mala.estado, mala.cuerpo.campo], [422, 'granularidad']);
  });

  test('una línea base no se guarda con el presupuesto Abierto: 422 sin campo', async () => {
    const r = await llamar('POST', `/api/cronogramas/${vista.cronograma.id}/lineas-base`, duena.cookie, { version: vista.cronograma.version, nombre: 'Contrato' });
    assert.deepEqual([r.estado, r.cuerpo.campo], [422, undefined], r.crudo);
  });

  test('con el presupuesto Activo: guardar, no sobrescribir en silencio, reemplazar, comparar y eliminar', async () => {
    await activarPresupuesto(duena.contexto, referencia.presupuestoId);
    vista = await leer();
    const guardada = await llamar('POST', `/api/cronogramas/${vista.cronograma.id}/lineas-base`, duena.cookie, { version: vista.cronograma.version, nombre: 'Contrato' });
    assert.equal(guardada.estado, 201, guardada.crudo);
    const lb = guardada.cuerpo.lineaBase;
    assert.deepEqual([lb.nombre, lb.guardadaPor, lb.fin], ['Contrato', 'Admin de Constructora Cronograma Curvas', vista.cronograma.fin]);
    assert.equal((await leer()).cronograma.version, vista.cronograma.version, 'guardar no sube la versión');

    const otraVez = await llamar('POST', `/api/cronogramas/${vista.cronograma.id}/lineas-base`, duena.cookie, { version: vista.cronograma.version, nombre: ' contrato ' });
    assert.deepEqual([otraVez.estado, otraVez.cuerpo.campo, otraVez.cuerpo.lineaBaseId], [409, 'nombre', lb.id], otraVez.crudo);
    assert.equal(otraVez.cuerpo.mensaje, 'Ya hay una línea base «Contrato». ¿Quiere reemplazarla?');

    // La obra se alarga una semana: la línea base la compara y avisa de la administración.
    await editarActividad('Formaleta metálica', { duracionManualDias: '10' });
    const comparada = await leer(`?lineaBase=${lb.id}`);
    const formaleta = comparada.lineaBase.actividades.find((x: { actividadId: string }) => x.actividadId === porNombre(comparada, 'Formaleta metálica').id);
    assert.deepEqual([formaleta.variacionInicioDias, formaleta.variacionFinDias, formaleta.duracionDias], ['0.0', '5.0', '5.0']);
    assert.deepEqual([comparada.avisos.administracion.lineaBaseId, comparada.avisos.administracion.diasDeMas], [lb.id, '5.0']);
    assert.equal((await leer()).avisos.administracion, null, 'sin línea base a la vista, no hay aviso');

    const curvas = await llamar('GET', `/api/cronogramas/${vista.cronograma.id}/curvas?granularidad=MES&lineaBase=${lb.id}`, duena.cookie);
    assert.equal(curvas.cuerpo.lineaBase.periodos.at(-1).facturacionAcumulada, '180590155.000000');

    const reemplazada = await llamar('POST', `/api/lineas-base/${lb.id}/reemplazar`, duena.cookie, { version: vista.cronograma.version });
    assert.equal(reemplazada.estado, 200, reemplazada.crudo);
    assert.deepEqual([reemplazada.cuerpo.lineaBase.id, reemplazada.cuerpo.lineaBase.fin], [lb.id, vista.cronograma.fin]);
    const lista = await llamar('GET', `/api/cronogramas/${vista.cronograma.id}/lineas-base`, duena.cookie);
    assert.deepEqual(lista.cuerpo.lineasBase.map((x: { nombre: string }) => x.nombre), ['Contrato']);

    assert.equal((await llamar('DELETE', `/api/lineas-base/${lb.id}`, duena.cookie)).estado, 204);
    assert.deepEqual((await leer()).lineasBase, []);
  });

  test('si el cronograma estaba desactualizado al pedir guardar, no se guarda: 409 con la vista recalculada', async () => {
    await comoSuperusuario((c) => c.query('UPDATE app.cronograma SET calculado_version = NULL, calculado_revision = NULL WHERE id = $1', [vista.cronograma.id]));
    const r = await llamar('POST', `/api/cronogramas/${vista.cronograma.id}/lineas-base`, duena.cookie, { version: vista.cronograma.version, nombre: 'Tarde' });
    assert.equal(r.estado, 409, r.crudo);
    assert.match(r.cuerpo.mensaje, /El presupuesto cambió desde que usted abrió el cronograma/);
    assert.equal(r.cuerpo.cronograma.cronograma.recalculado, true);
    assert.deepEqual((await leer()).lineasBase, []);
  });
});

describe('la cabecera, el calendario de la obra, hitos, trámites y restricciones (CONTRATO §19.6)', () => {
  let duena: Cuenta;
  let vista: Record<string, any>;
  const escribir = async (metodo: 'POST' | 'PUT' | 'PATCH' | 'DELETE', ruta: string, cuerpo?: Record<string, unknown>) => {
    const url = `/api/cronogramas/${vista.cronograma.id}${ruta}`;
    const r =
      metodo === 'DELETE'
        ? await llamar('DELETE', `${url}${url.includes('?') ? '&' : '?'}version=${vista.cronograma.version}`, duena.cookie)
        : await llamar(metodo, url, duena.cookie, { version: vista.cronograma.version, ...cuerpo });
    if (r.estado === 200) vista = r.cuerpo;
    return r;
  };

  before(async () => {
    duena = await registrar('Constructora Cronograma Calendario', '900000988-8', 'cronograma.calendario@construsoft.test');
    const { presupuestoId } = await armarPresupuestoDeReferencia(duena.contexto, 'CRONO-CALENDARIO');
    vista = (await llamar('POST', `/api/presupuestos/${presupuestoId}/cronograma`, duena.cookie, { fechaInicio: '2026-11-02' })).cuerpo;
    await escribir('PATCH', `/actividades/${porNombre(vista, 'Topografía y replanteo').id}`, { duracionManualDias: '2' });
  });

  test('mover la fecha de inicio corre todo lo que no tiene restricciones, y deja su evento en el historial', async () => {
    const r = await escribir('PATCH', '', { fechaInicio: '2026-11-09' });
    assert.equal(r.estado, 200, r.crudo);
    assert.deepEqual([vista.cronograma.fechaInicio, porNombre(vista, 'Topografía y replanteo').inicio], ['2026-11-09', '2026-11-09T07:00']);
    const historial = await llamar('GET', `/api/presupuestos/${vista.cronograma.presupuestoId}/historial?tipo=CRONOGRAMA_FECHA_INICIO`, duena.cookie);
    assert.equal(historial.cuerpo.eventos.length, 1, historial.crudo);
  });

  test('el calendario de la obra se edita solo en la obra: con 10 h por día, dos días de 8 h son 1,6 días y las mismas horas', async () => {
    const diez = [{ inicio: '07:00', fin: '12:00' }, { inicio: '13:00', fin: '18:00' }];
    const r = await escribir('PUT', '/calendario-obra', { nombre: 'Obra, 10 horas', horasPorDia: '10', semana: [diez, diez, diez, diez, diez, [], []] });
    assert.equal(r.estado, 200, r.crudo);
    const topografia = porNombre(vista, 'Topografía y replanteo');
    // 16 horas guardadas; un día de 10 h y seis horas del siguiente (RN-27).
    assert.deepEqual([topografia.duracionManualDias, topografia.inicio, topografia.fin, vista.calendarios.obra.nombre], ['1.6', '2026-11-09T07:00', '2026-11-10T14:00', 'Obra, 10 horas']);
    assert.equal(topografia.finAMitadDeJornada, true);
    const empresa = await llamar('GET', '/api/configuracion/preferencias', duena.cookie);
    assert.equal(empresa.estado, 200);
  });

  test('un festivo en el calendario de la obra corre las fechas, y quitarlo las devuelve', async () => {
    await escribir('PUT', '/calendario-obra/excepciones/2026-11-09', { motivo: 'Festivo local', tramos: [] });
    assert.equal(porNombre(vista, 'Topografía y replanteo').inicio, '2026-11-10T07:00');
    await escribir('DELETE', '/calendario-obra/excepciones/2026-11-09');
    assert.equal(porNombre(vista, 'Topografía y replanteo').inicio, '2026-11-09T07:00');
  });

  test('reemplazar el calendario de la obra por uno de la empresa vuelve a sus 8 h, y deja su evento', async () => {
    const calendarios = (await llamar('GET', '/api/calendarios', duena.cookie)).cuerpo.calendarios as { id: string; porDefecto: boolean }[] | undefined;
    const elDeDefecto = calendarios?.find((c) => c.porDefecto)?.id
      ?? (await comoSuperusuario(async (c) => (await c.query<{ id: string }>("SELECT id FROM app.calendario WHERE tenant_id = $1 AND tipo = 'EMPRESA' AND por_defecto", [duena.contexto.tenantId])).rows[0]!.id));
    const r = await escribir('PUT', '/calendario', { calendarioId: elDeDefecto });
    assert.equal(r.estado, 200, r.crudo);
    assert.deepEqual([vista.calendarios.obra.nombre, porNombre(vista, 'Topografía y replanteo').fin], ['Lunes a viernes', '2026-11-10T16:00']);
    const historial = await llamar('GET', `/api/presupuestos/${vista.cronograma.presupuestoId}/historial?tipo=CRONOGRAMA_CALENDARIO`, duena.cookie);
    assert.equal(historial.cuerpo.eventos.length, 1);
  });

  test('hitos y trámites: el código automático, la espera en el corrido, el subgrupo y la posición', async () => {
    await escribir('POST', '/grupos', { nombre: 'Licencias' });
    const grupo = vista.grupos[0];
    assert.equal(grupo.nombre, 'Licencias');
    const espera = await escribir('POST', '/actividades', { tipo: 'SIN_COSTO', nombre: 'Curado de la placa', duracionManualDias: '7', usaCorrido: true, grupoId: grupo.id });
    assert.equal(espera.estado, 200, espera.crudo);
    const curado = porNombre(vista, 'Curado de la placa');
    assert.deepEqual([curado.codigo, curado.usaCorrido, curado.duracionDias, curado.grupoId], ['T-001', true, '7.0', grupo.id]);
    await escribir('POST', '/actividades', { tipo: 'HITO_FIN', nombre: 'Entrega de la licencia', grupoId: grupo.id });
    const entrega = porNombre(vista, 'Entrega de la licencia');
    assert.equal(entrega.codigo, 'H-003');
    // Los subgrupos van después de la raíz de «Hitos y trámites»; la espera, primera de su subgrupo.
    const nombres = vista.actividades.map((a: Actividad) => a.nombre);
    assert.deepEqual(nombres.slice(-4), ['Inicio del proyecto', 'Fin del proyecto', 'Curado de la placa', 'Entrega de la licencia']);
    await escribir('PUT', `/actividades/${entrega.id}/posicion`, { posicion: 1 });
    assert.deepEqual(vista.actividades.map((a: Actividad) => a.nombre).slice(-2), ['Entrega de la licencia', 'Curado de la placa']);
    const fuera = await escribir('PUT', `/actividades/${entrega.id}/posicion`, { posicion: 3 });
    assert.deepEqual([fuera.estado, fuera.cuerpo.campo], [422, 'posicion']);
    // Un subgrupo con actividades no se elimina.
    assert.equal((await escribir('DELETE', `/grupos/${grupo.id}`)).estado, 422);
    // Un hito no lleva duración, y una actividad del presupuesto no se renombra aquí.
    const conDuracion = await escribir('POST', '/actividades', { tipo: 'HITO_INICIO', nombre: 'Malo', duracionManualDias: '1' });
    assert.deepEqual([conDuracion.estado, conDuracion.cuerpo.campo], [422, 'duracionManualDias']);
    const renombrar = await escribir('PATCH', `/actividades/${porNombre(vista, 'Excavación manual').id}`, { nombre: 'Otro nombre' });
    assert.deepEqual([renombrar.estado, renombrar.cuerpo.campo], [422, 'nombre']);
    const codigoDeItem = await escribir('PATCH', `/actividades/${entrega.id}`, { codigo: '9.9' });
    assert.deepEqual([codigoDeItem.estado, codigoDeItem.cuerpo.campo], [422, 'codigo']);
  });

  test('las restricciones: la fecha empuja el inicio; una pareja que la base no admite llega con su campo del contrato', async () => {
    const excavacion = porNombre(vista, 'Excavación manual');
    const r = await escribir('PATCH', `/actividades/${excavacion.id}`, { duracionManualDias: '1', restriccion: { tipo: 'INICIO_DESPUES', fecha: '2026-11-18' } });
    assert.equal(r.estado, 200, r.crudo);
    assert.deepEqual([porNombre(vista, 'Excavación manual').inicio, porNombre(vista, 'Excavación manual').restriccion], ['2026-11-18T07:00', { tipo: 'INICIO_DESPUES', fecha: '2026-11-18' }]);
    const pareja = await escribir('PATCH', `/actividades/${excavacion.id}`, { restriccionSecundaria: { tipo: 'INICIO_ANTES', fecha: '2026-11-10' } });
    assert.deepEqual([pareja.estado, pareja.cuerpo.campo], [422, 'restriccionSecundaria.fecha'], pareja.crudo);
    const sinFecha = await escribir('PATCH', `/actividades/${excavacion.id}`, { restriccion: { tipo: 'FIN_ANTES', fecha: null } });
    assert.deepEqual([sinFecha.estado, sinFecha.cuerpo.campo], [422, 'restriccion.fecha'], sinFecha.crudo);
    const tipoMalo = await escribir('PATCH', `/actividades/${excavacion.id}`, { restriccion: { tipo: 'CUANDO_SEA', fecha: '2026-11-10' } });
    assert.deepEqual([tipoMalo.estado, tipoMalo.cuerpo.campo], [422, 'restriccion.tipo']);
    const fueraDeTipo = await escribir('PATCH', `/actividades/${excavacion.id}`, { usaCorrido: true });
    assert.deepEqual([fueraDeTipo.estado, fueraDeTipo.cuerpo.campo], [422, 'usaCorrido']);
  });

  test('cerrar la franja no lleva versión ni la sube: 204', async () => {
    const antes = vista.cronograma.version;
    const r = await llamar('POST', `/api/cronogramas/${vista.cronograma.id}/aviso/cerrar`, duena.cookie, {});
    assert.equal(r.estado, 204, r.crudo);
    assert.equal((await llamar('GET', `/api/presupuestos/${vista.cronograma.presupuestoId}/cronograma`, duena.cookie)).cuerpo.cronograma.version, antes);
  });

  test('con la suscripción vencida se lee, con editable falso, y escribir es 402', async () => {
    await vencerSuscripcion(duena.contexto.tenantId);
    const r = await llamar('GET', `/api/presupuestos/${vista.cronograma.presupuestoId}/cronograma`, duena.cookie);
    assert.deepEqual([r.estado, r.cuerpo.cronograma.editable], [200, false]);
    assert.equal((await escribir('PATCH', '', { fechaInicio: '2026-11-16' })).estado, 402);
  });
});
