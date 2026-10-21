import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { activarPresupuesto } from '../infraestructura/basedatos/cicloDeVida.js';
import { armarPresupuestoDeReferencia } from '../pruebas/presupuestoDeReferencia.js';
import { leerPdf } from '../pruebas/textoDePdf.js';
import { VERSION_TERMINOS_DE_PRUEBA, clienteDePrueba, type Cuenta, CARPETA_LEGAL_DE_PRUEBA } from '../pruebas/clienteHttp.js';
import { construirServidor } from './servidor.js';

/*
 * Exportar el cronograma (CONTRATO §19.9, RF-PRG-10, RF-PRG-11). El Gantt en
 * PDF, sobre el presupuesto de referencia con una cadena de nueve semanas.
 */

let app: FastifyInstance;
const { otraIp, registrar, asistenteCon } = clienteDePrueba(() => app);

before(async () => {
  app = await construirServidor({ carpetaLegal: CARPETA_LEGAL_DE_PRUEBA, secretoSesion: randomBytes(32).toString('hex'), versionTerminos: VERSION_TERMINOS_DE_PRUEBA });
});
after(async () => {
  await app.close();
});

async function llamar(metodo: 'GET' | 'POST' | 'PATCH', url: string, cookie: string, cuerpo?: unknown) {
  const r = await app.inject({ method: metodo, url, remoteAddress: otraIp(), headers: { cookie }, ...(cuerpo === undefined ? {} : { payload: cuerpo as object }) });
  const json = String(r.headers['content-type']).includes('json') ? r.json<Record<string, any>>() : {};
  return { estado: r.statusCode, cuerpo: json, crudo: r.rawPayload, cabeceras: r.headers };
}

describe('el Gantt en PDF (RF-PRG-10)', () => {
  let duena: Cuenta;
  let presupuestoId: string;
  let vista: Record<string, any>;
  const exportar = (consulta: string, cookie = duena.cookie) => llamar('GET', `/api/cronogramas/${vista.cronograma.id}/exportar?${consulta}`, cookie);

  before(async () => {
    duena = await registrar('Constructora Gantt', '900001000-0', 'gantt.duena@construsoft.test');
    ({ presupuestoId } = await armarPresupuestoDeReferencia(duena.contexto, 'CRONO-GANTT'));
    vista = (await llamar('POST', `/api/presupuestos/${presupuestoId}/cronograma`, duena.cookie, { fechaInicio: '2026-11-02' })).cuerpo;
    const items = vista.actividades.filter((a: { tipo: string }) => a.tipo === 'ITEM');
    for (const [i, a] of items.entries()) {
      vista = (await llamar('PATCH', `/api/cronogramas/${vista.cronograma.id}/actividades/${a.id}`, duena.cookie, { version: vista.cronograma.version, duracionManualDias: i % 2 === 0 ? '5' : '10' })).cuerpo;
      if (i > 0) {
        vista = (
          await llamar('POST', `/api/cronogramas/${vista.cronograma.id}/dependencias`, duena.cookie, {
            version: vista.cronograma.version, predecesoraId: items[i - 1].id, sucesoraId: a.id, tipo: 'FC', desfaseDias: '0',
          })
        ).cuerpo;
      }
    }
  });

  test('el PDF trae la tabla y las barras de cada actividad, con quién lo emite, en todas las páginas, y con las fuentes incrustadas', async () => {
    const r = await exportar('formato=pdf&escala=SEMANA');
    assert.equal(r.estado, 200, r.crudo.toString());
    assert.equal(r.cabeceras['content-type'], 'application/pdf');
    assert.match(String(r.cabeceras['content-disposition']), /filename="CRONO-GANTT - Cronograma\.pdf"/);
    const pdf = leerPdf(r.crudo);
    const texto = pdf.paginas.flat();
    for (const a of vista.actividades) {
      assert.ok(texto.includes(a.codigo), `falta el código ${a.codigo}`);
      assert.ok(texto.some((t) => t.startsWith(a.nombre.slice(0, 20))), `falta ${a.nombre}`);
    }
    for (const nombre of ['PRELIMINARES', 'CIMENTACIÓN', 'ESTRUCTURA', 'Hitos y trámites']) assert.ok(texto.includes(nombre), nombre);
    pdf.paginas.forEach((pagina, i) => {
      assert.ok(pagina.includes('Constructora Gantt'), `página ${i + 1} sin emisor`);
      assert.ok(pagina.includes(`Página ${i + 1} de ${pdf.paginas.length}`), `página ${i + 1} sin numeración`);
    });
    assert.ok(texto.some((t) => t.includes('Cronograma')));
    assert.deepEqual([pdf.glifosFaltantes, pdf.fuentesSinIncrustar], [0, 0]);
  });

  test('por día, una obra de nueve semanas pasa a varias páginas a lo ancho; por mes cabe en una', async () => {
    const dias = leerPdf((await exportar('formato=pdf&escala=DIA')).crudo).paginas.length;
    const meses = leerPdf((await exportar('formato=pdf&escala=MES')).crudo).paginas.length;
    assert.ok(dias > 1, `por día: ${dias} páginas`);
    assert.equal(meses, 1);
  });

  test('con una línea base, el PDF dice cuál es', async () => {
    await activarPresupuesto(duena.contexto, presupuestoId);
    vista = (await llamar('GET', `/api/presupuestos/${presupuestoId}/cronograma`, duena.cookie)).cuerpo;
    const lb = (await llamar('POST', `/api/cronogramas/${vista.cronograma.id}/lineas-base`, duena.cookie, { version: vista.cronograma.version, nombre: 'Contrato' })).cuerpo.lineaBase;
    const texto = leerPdf((await exportar(`formato=pdf&escala=SEMANA&lineaBase=${lb.id}`)).crudo).paginas.flat();
    assert.ok(texto.some((t) => t.includes('Línea base «Contrato»')), texto.join(' | ').slice(0, 300));
  });

  test('un formato o una escala que no existen son 422 con su campo; sin EXPORTAR, 403; de otra empresa, 404', async () => {
    const formato = await exportar('formato=docx');
    assert.deepEqual([formato.estado, formato.cuerpo.campo], [422, 'formato']);
    const escala = await exportar('formato=pdf&escala=HORA');
    assert.deepEqual([escala.estado, escala.cuerpo.campo], [422, 'escala']);
    const lector = await asistenteCon(duena, 'gantt.lector@construsoft.test', ['PRESUPUESTOS.VER']);
    assert.equal((await exportar('formato=pdf&escala=SEMANA', lector)).estado, 403);
    const otra = await registrar('Constructora Gantt Ajena', '900001001-1', 'gantt.ajena@construsoft.test');
    assert.equal((await exportar('formato=pdf&escala=SEMANA', otra.cookie)).estado, 404);
  });
});

describe('el XML para Project (RF-PRG-11, CONTRATO §19.9)', () => {
  let duena: Cuenta;
  let vista: Record<string, any>;
  const exportar = async (consulta: string) => {
    const r = await app.inject({ method: 'GET', url: `/api/cronogramas/${vista.cronograma.id}/exportar?${consulta}`, remoteAddress: otraIp(), headers: { cookie: duena.cookie } });
    return { estado: r.statusCode, xml: r.body, cabeceras: r.headers };
  };
  const tareas = (xml: string) => [...xml.matchAll(/<Task>([\s\S]*?)<\/Task>/g)].map((m) => m[1]!);
  const campo = (tarea: string, nombre: string) => tarea.match(new RegExp(`<${nombre}>([^<]*)</${nombre}>`))?.[1];
  const tareaDe = (xml: string, nombre: string) => tareas(xml).find((t) => campo(t, 'Name') === nombre)!;

  before(async () => {
    duena = await registrar('Constructora Project', '900001002-2', 'project.duena@construsoft.test');
    const { presupuestoId } = await armarPresupuestoDeReferencia(duena.contexto, 'CRONO-XML');
    vista = (await llamar('POST', `/api/presupuestos/${presupuestoId}/cronograma`, duena.cookie, { fechaInicio: '2026-11-02' })).cuerpo;
    const editar = async (nombre: string, cambios: Record<string, unknown>) => {
      const a = vista.actividades.find((x: { nombre: string }) => x.nombre === nombre);
      vista = (await llamar('PATCH', `/api/cronogramas/${vista.cronograma.id}/actividades/${a.id}`, duena.cookie, { version: vista.cronograma.version, ...cambios })).cuerpo;
    };
    await editar('Topografía y replanteo', { duracionManualDias: '2' });
    await editar('Excavación manual', {
      duracionManualDias: '3',
      restriccion: { tipo: 'INICIO_DESPUES', fecha: '2026-11-04' },
      restriccionSecundaria: { tipo: 'FIN_ANTES', fecha: '2026-11-20' },
    });
    const id = (nombre: string) => vista.actividades.find((x: { nombre: string }) => x.nombre === nombre).id;
    vista = (
      await llamar('POST', `/api/cronogramas/${vista.cronograma.id}/dependencias`, duena.cookie, {
        version: vista.cronograma.version, predecesoraId: id('Topografía y replanteo'), sucesoraId: id('Excavación manual'), tipo: 'CC', desfaseDias: '1',
      })
    ).cuerpo;
  });

  test('una tarea por actividad y por capítulo, en el orden y el nivel de la EDT, con su calendario y sin costo por defecto', async () => {
    const r = await exportar('formato=xml');
    assert.equal(r.estado, 200, r.xml);
    assert.match(String(r.cabeceras['content-type']), /^application\/xml/);
    assert.match(String(r.cabeceras['content-disposition']), /filename="CRONO-XML - Cronograma\.xml"/);
    assert.match(r.xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\s*<Project xmlns="http:\/\/schemas\.microsoft\.com\/project">/);
    const nombres = tareas(r.xml).map((t) => [campo(t, 'Name'), campo(t, 'OutlineLevel'), campo(t, 'Summary')]);
    assert.deepEqual(nombres.slice(0, 5), [
      ['PRELIMINARES', '1', '1'],
      ['Topografía y replanteo', '2', '0'],
      ['Estudio de suelos', '2', '0'],
      ['Director de obra', '2', '0'],
      ['CIMENTACIÓN', '1', '1'],
    ]);
    assert.ok(nombres.some(([n, nivel]) => n === 'Administración y supervisión de obra' && nivel === '1'));
    assert.ok(nombres.some(([n, nivel, resumen]) => n === 'Hitos y trámites' && nivel === '1' && resumen === '1'));
    const topografia = tareaDe(r.xml, 'Topografía y replanteo');
    assert.deepEqual(
      [campo(topografia, 'WBS'), campo(topografia, 'Start'), campo(topografia, 'Finish'), campo(topografia, 'Duration')],
      [vista.actividades.find((a: { nombre: string }) => a.nombre === 'Topografía y replanteo').codigo, '2026-11-02T07:00:00', '2026-11-03T16:00:00', 'PT16H0M0S'],
    );
    assert.equal(campo(tareaDe(r.xml, 'Fin del proyecto'), 'Milestone'), '1');
    assert.doesNotMatch(r.xml, /<FixedCost>/);
    assert.equal([...r.xml.matchAll(/<Calendar>/g)].length, 2);
    assert.match(r.xml, /<FromTime>07:00:00<\/FromTime><ToTime>12:00:00<\/ToTime>/);
  });

  test('la relación con su tipo y su desfase, y la restricción principal; la secundaria «fin en o antes de» va como fecha límite', async () => {
    const xml = (await exportar('formato=xml')).xml;
    const excavacion = tareaDe(xml, 'Excavación manual');
    const topografia = tareaDe(xml, 'Topografía y replanteo');
    // CC es el tipo 3 de Project; un día de 8 h son 4.800 décimas de minuto.
    assert.deepEqual(
      [campo(excavacion, 'PredecessorUID'), campo(excavacion, 'Type'), campo(excavacion, 'LinkLag'), campo(excavacion, 'LagFormat')],
      [campo(topografia, 'UID'), '3', '4800', '7'],
    );
    // «Inicio en o después de» es SNET (4) y toma el comienzo de la jornada; la fecha límite, el cierre.
    assert.deepEqual([campo(excavacion, 'ConstraintType'), campo(excavacion, 'ConstraintDate'), campo(excavacion, 'Deadline')], ['4', '2026-11-04T07:00:00', '2026-11-20T16:00:00']);
  });

  test('con costo=true, cada tarea del presupuesto lleva su costo, en centavos como lo lee Project', async () => {
    const xml = (await exportar('formato=xml&costo=true')).xml;
    assert.equal(campo(tareaDe(xml, 'Topografía y replanteo'), 'FixedCost'), '320000000');
    assert.equal(campo(tareaDe(xml, 'Administración y supervisión de obra'), 'FixedCost'), '1054900000');
    assert.equal(campo(tareaDe(xml, 'Inicio del proyecto'), 'FixedCost'), undefined);
  });

  test('un texto con caracteres de XML sale escapado', async () => {
    const r = await llamar('POST', `/api/cronogramas/${vista.cronograma.id}/actividades`, duena.cookie, { version: vista.cronograma.version, tipo: 'HITO_FIN', nombre: 'Entrega <acta> & firma' });
    vista = r.cuerpo;
    const xml = (await exportar('formato=xml')).xml;
    assert.match(xml, /<Name>Entrega &lt;acta&gt; &amp; firma<\/Name>/);
  });

  test('una espera del corrido va en días transcurridos, y el desfase hacia ella también: 7 «edías», no 21 días de 8 h', async () => {
    vista = (await llamar('POST', `/api/cronogramas/${vista.cronograma.id}/actividades`, duena.cookie, {
      version: vista.cronograma.version, tipo: 'SIN_COSTO', nombre: 'Curado de la placa', duracionManualDias: '7', usaCorrido: true,
    })).cuerpo;
    const id = (nombre: string) => vista.actividades.find((x: { nombre: string }) => x.nombre === nombre).id;
    vista = (await llamar('POST', `/api/cronogramas/${vista.cronograma.id}/dependencias`, duena.cookie, {
      version: vista.cronograma.version, predecesoraId: id('Excavación manual'), sucesoraId: id('Curado de la placa'), tipo: 'FC', desfaseDias: '1',
    })).cuerpo;
    const xml = (await exportar('formato=xml')).xml;
    const curado = tareaDe(xml, 'Curado de la placa');
    assert.deepEqual([campo(curado, 'Duration'), campo(curado, 'DurationFormat'), campo(curado, 'CalendarUID')], ['PT168H0M0S', '8', '2']);
    // Un día del corrido son 24 h: 14.400 décimas de minuto, en días transcurridos.
    assert.deepEqual([campo(curado, 'LinkLag'), campo(curado, 'LagFormat')], ['14400', '8']);
    // Lo que no es del corrido sigue en días de trabajo.
    assert.equal(campo(tareaDe(xml, 'Topografía y replanteo'), 'DurationFormat'), '7');
  });

  test('las tareas resumen de «Hitos y trámites» llevan su WBS: HT y HT-1, HT-2… por subgrupo, para que Project no invente uno que choque con un capítulo', async () => {
    vista = (await llamar('POST', `/api/cronogramas/${vista.cronograma.id}/grupos`, duena.cookie, { version: vista.cronograma.version, nombre: 'Licencias' })).cuerpo;
    const xml = (await exportar('formato=xml')).xml;
    assert.deepEqual([campo(tareaDe(xml, 'Hitos y trámites'), 'WBS'), campo(tareaDe(xml, 'Licencias'), 'WBS')], ['HT', 'HT-1']);
  });
});

describe('el XER para P6 (RF-PRG-11, CONTRATO §19.9)', () => {
  let duena: Cuenta;
  let vista: Record<string, any>;
  const exportar = async (consulta: string) => {
    const r = await app.inject({ method: 'GET', url: `/api/cronogramas/${vista.cronograma.id}/exportar?${consulta}`, remoteAddress: otraIp(), headers: { cookie: duena.cookie } });
    return { estado: r.statusCode, bytes: r.rawPayload, cabeceras: r.headers, cuerpo: String(r.headers['content-type']).includes('json') ? r.json<Record<string, any>>() : {} };
  };
  const actividad = (nombre: string) => vista.actividades.find((a: { nombre: string }) => a.nombre === nombre);

  /*
   * Lee el XER como lo lee P6: Windows-1252, CRLF, y tablas %T, %F y %R. No usa
   * TextDecoder('windows-1252'): el de Node 20 decodifica 0x80–0x9F como Latin-1,
   * y la raya «—» (0x97) desaparece. Aquí van los de ese tramo que usan las pruebas.
   */
  const DE_0X80: Record<number, string> = { 0x80: '€', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x96: '–', 0x97: '—' };
  function leerXer(bytes: Buffer) {
    const lineas = [...bytes].map((b) => DE_0X80[b] ?? String.fromCharCode(b)).join('').split('\r\n');
    const filas = new Map<string, Record<string, string>[]>();
    const columnas = new Map<string, string[]>();
    let tabla = '';
    for (const linea of lineas) {
      const [marca, ...resto] = linea.split('\t');
      if (marca === '%T') {
        tabla = resto[0]!;
        filas.set(tabla, []);
      } else if (marca === '%F') columnas.set(tabla, resto);
      else if (marca === '%R') filas.get(tabla)!.push(Object.fromEntries(columnas.get(tabla)!.map((c, i) => [c, resto[i] ?? ''])));
    }
    const tarea = (nombre: string) => filas.get('TASK')!.find((t) => t.task_name === nombre)!;
    return { lineas, filas, columnas, tablas: [...filas.keys()], tarea };
  }

  before(async () => {
    duena = await registrar('Constructora Primavera', '900001004-4', 'p6.duena@construsoft.test');
    const { presupuestoId } = await armarPresupuestoDeReferencia(duena.contexto, 'CRONO-XER');
    vista = (await llamar('POST', `/api/presupuestos/${presupuestoId}/cronograma`, duena.cookie, { fechaInicio: '2026-11-02' })).cuerpo;
    const editar = async (nombre: string, cambios: Record<string, unknown>) => {
      vista = (await llamar('PATCH', `/api/cronogramas/${vista.cronograma.id}/actividades/${actividad(nombre).id}`, duena.cookie, { version: vista.cronograma.version, ...cambios })).cuerpo;
    };
    const relacionar = async (predecesora: string, sucesora: string, tipo: string, desfaseDias: string) => {
      vista = (
        await llamar('POST', `/api/cronogramas/${vista.cronograma.id}/dependencias`, duena.cookie, {
          version: vista.cronograma.version, predecesoraId: actividad(predecesora).id, sucesoraId: actividad(sucesora).id, tipo, desfaseDias,
        })
      ).cuerpo;
    };
    await editar('Topografía y replanteo', { duracionManualDias: '2' });
    await editar('Excavación manual', {
      duracionManualDias: '3',
      restriccion: { tipo: 'INICIO_DESPUES', fecha: '2026-11-04' },
      restriccionSecundaria: { tipo: 'FIN_ANTES', fecha: '2026-11-20' },
    });
    await relacionar('Topografía y replanteo', 'Excavación manual', 'CC', '1');
    vista = (await llamar('POST', `/api/cronogramas/${vista.cronograma.id}/actividades`, duena.cookie, {
      version: vista.cronograma.version, tipo: 'SIN_COSTO', nombre: 'Curado de la placa', duracionManualDias: '7', usaCorrido: true,
    })).cuerpo;
    await relacionar('Excavación manual', 'Curado de la placa', 'FC', '1');
    vista = (await llamar('POST', `/api/cronogramas/${vista.cronograma.id}/grupos`, duena.cookie, { version: vista.cronograma.version, nombre: 'Licencias' })).cuerpo;
    vista = (await llamar('POST', `/api/cronogramas/${vista.cronograma.id}/actividades`, duena.cookie, {
      version: vista.cronograma.version, tipo: 'HITO_FIN', nombre: 'Acta Nº 2 — losa de 30 m² <revisión> & firma Gödel ő ✓',
    })).cuerpo;
  });

  test('GET /api/exportacion/p6 da las tres versiones, en el orden del contrato', async () => {
    const r = await llamar('GET', '/api/exportacion/p6', duena.cookie);
    assert.equal(r.estado, 200);
    assert.deepEqual(r.cuerpo.versiones, [
      { id: '8.2', nombre: 'P6 8.2' },
      { id: '15.2', nombre: 'P6 15.2' },
      { id: '21.12', nombre: 'P6 21.12 o posterior' },
    ]);
  });

  test('el archivo va en Windows-1252, con CRLF y sin BOM, con la versión en ERMHDR y las tablas que P6 necesita, sin costo por defecto', async () => {
    const r = await exportar('formato=xer&p6=8.2');
    assert.equal(r.estado, 200, r.bytes.toString());
    assert.match(String(r.cabeceras['content-disposition']), /filename="CRONO-XER - Cronograma\.xer"/);
    assert.equal(r.bytes.subarray(0, 6).toString('latin1'), 'ERMHDR');
    assert.equal(r.bytes.toString('latin1').replace(/\r\n/g, '').includes('\n'), false, 'un salto de línea sin CR');
    const xer = leerXer(r.bytes);
    const cabecera = xer.lineas[0]!.split('\t');
    assert.deepEqual([cabecera[0], cabecera[1], cabecera[3], cabecera[6], cabecera[7], cabecera[8]], ['ERMHDR', '8.2', 'Project', 'dbxDatabaseNoName', 'Project Management', 'COP']);
    assert.match(cabecera[2]!, /^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(xer.tablas, ['CURRTYPE', 'OBS', 'PROJECT', 'CALENDAR', 'PROJWBS', 'TASK', 'TASKPRED']);
    assert.deepEqual(xer.lineas.slice(-2), ['%E', '']);
    assert.equal(xer.filas.get('TASK')!.length, vista.actividades.length);
  });

  test('cada actividad con su código, su tipo, su calendario, sus fechas y holguras en horas', async () => {
    const xer = leerXer((await exportar('formato=xer&p6=8.2')).bytes);
    const calendarios = xer.filas.get('CALENDAR')!;
    const topografia = xer.tarea('Topografía y replanteo');
    assert.deepEqual(
      [topografia.task_code, topografia.task_type, topografia.duration_type, topografia.status_code, topografia.target_drtn_hr_cnt, topografia.remain_drtn_hr_cnt],
      [actividad('Topografía y replanteo').codigo, 'TT_Task', 'DT_FixedDUR2', 'TK_NotStart', '16', '16'],
    );
    assert.deepEqual([topografia.early_start_date, topografia.early_end_date, topografia.target_start_date, topografia.target_end_date], [
      '2026-11-02 07:00', '2026-11-03 16:00', '2026-11-02 07:00', '2026-11-03 16:00',
    ]);
    const enVista = actividad('Topografía y replanteo');
    assert.deepEqual([topografia.late_end_date, Number(topografia.total_float_hr_cnt)], [enVista.finTardio.replace('T', ' '), Number(enVista.holguraTotalDias) * 8]);
    assert.deepEqual([xer.tarea('Inicio del proyecto').task_type, xer.tarea('Fin del proyecto').task_type], ['TT_Mile', 'TT_FinMile']);
    assert.equal(xer.tarea('Fin del proyecto').duration_type, 'DT_FixedDrtn');
    assert.equal(xer.tarea('Administración y supervisión de obra').task_type, 'TT_LOE');
    const curado = xer.tarea('Curado de la placa');
    const corrido = calendarios.find((c) => c.clndr_id === curado.clndr_id)!;
    assert.deepEqual([curado.target_drtn_hr_cnt, corrido.day_hr_cnt, corrido.week_hr_cnt], ['168', '24', '168']);
    assert.notEqual(topografia.clndr_id, curado.clndr_id);
  });

  test('la EDT: el proyecto como nodo raíz, los capítulos con su código y «Hitos y trámites» como HT con sus grupos', async () => {
    const xer = leerXer((await exportar('formato=xer&p6=8.2')).bytes);
    const wbs = xer.filas.get('PROJWBS')!;
    const raiz = wbs.find((w) => w.proj_node_flag === 'Y')!;
    assert.deepEqual([raiz.wbs_short_name, xer.filas.get('PROJECT')![0]!.proj_short_name], ['CRONO-XER', 'CRONO-XER']);
    const preliminares = wbs.find((w) => w.wbs_name === 'PRELIMINARES')!;
    assert.equal(preliminares.parent_wbs_id, raiz.wbs_id);
    assert.equal(xer.tarea('Topografía y replanteo').wbs_id, preliminares.wbs_id);
    const ht = wbs.find((w) => w.wbs_name === 'Hitos y trámites')!;
    assert.deepEqual([ht.wbs_short_name, ht.parent_wbs_id], ['HT', raiz.wbs_id]);
    assert.equal(wbs.find((w) => w.wbs_name === 'Licencias')!.parent_wbs_id, ht.wbs_id);
    assert.equal(xer.tarea('Fin del proyecto').wbs_id, ht.wbs_id);
    assert.equal(xer.tarea('Administración y supervisión de obra').wbs_id, raiz.wbs_id);
  });

  test('las relaciones con su tipo y el desfase en horas del calendario de la sucesora; la restricción principal y la secundaria', async () => {
    const xer = leerXer((await exportar('formato=xer&p6=8.2')).bytes);
    const relaciones = xer.filas.get('TASKPRED')!;
    const entre = (p: string, s: string) => relaciones.find((x) => x.pred_task_id === xer.tarea(p).task_id && x.task_id === xer.tarea(s).task_id)!;
    const cc = entre('Topografía y replanteo', 'Excavación manual');
    assert.deepEqual([cc.pred_type, cc.lag_hr_cnt], ['PR_SS', '8']);
    const alCorrido = entre('Excavación manual', 'Curado de la placa');
    assert.deepEqual([alCorrido.pred_type, alCorrido.lag_hr_cnt], ['PR_FS', '24']);
    const excavacion = xer.tarea('Excavación manual');
    assert.deepEqual([excavacion.cstr_type, excavacion.cstr_date, excavacion.cstr_type2, excavacion.cstr_date2], ['CS_MSOA', '2026-11-04 07:00', 'CS_MEOB', '2026-11-20 16:00']);
    assert.deepEqual([xer.tarea('Topografía y replanteo').cstr_type, xer.tarea('Topografía y replanteo').cstr_date], ['', '']);
  });

  test('la administración como Level of Effort: CC desde la que empieza primero y FF hacia la que termina de última', async () => {
    const xer = leerXer((await exportar('formato=xer&p6=8.2')).bytes);
    const tareas = xer.filas.get('TASK')!;
    const loe = xer.tarea('Administración y supervisión de obra');
    const otras = tareas.filter((t) => t !== loe);
    const primera = otras.reduce((a, b) => (b.early_start_date! < a.early_start_date! ? b : a));
    const ultima = otras.reduce((a, b) => (b.early_end_date! > a.early_end_date! ? b : a));
    const suyas = xer.filas.get('TASKPRED')!.filter((x) => x.task_id === loe.task_id || x.pred_task_id === loe.task_id);
    assert.deepEqual(
      suyas.map((x) => [x.pred_type, x.pred_task_id, x.task_id, x.lag_hr_cnt]),
      [
        ['PR_SS', primera.task_id, loe.task_id, '0'],
        ['PR_FF', loe.task_id, ultima.task_id, '0'],
      ],
    );
  });

  test('los calendarios con sus jornadas en el formato de P6: los días de 1 (domingo) a 7 y las horas del día', async () => {
    const xer = leerXer((await exportar('formato=xer&p6=8.2')).bytes);
    const obra = xer.filas.get('CALENDAR')!.find((c) => c.clndr_id === xer.tarea('Topografía y replanteo').clndr_id)!;
    assert.deepEqual([obra.clndr_type, obra.day_hr_cnt, obra.week_hr_cnt], ['CA_Base', '8', String(Number(vista.calendarios.obra.horasSemana))]);
    const datos = obra.clndr_data!;
    assert.ok(datos.startsWith('(0||CalendarData()(\x7f\x7f  (0||DaysOfWeek()(\x7f\x7f    (0||1()())'), datos.slice(0, 80));
    assert.ok(datos.includes('(0||2()(\x7f\x7f      (0||0(s|07:00|f|12:00)())\x7f\x7f      (0||1(s|13:00|f|16:00)())))'), datos);
    assert.ok(obra.clndr_name!.startsWith('CRONO-XER - '));
  });

  test('un texto sale tal cual si cabe en Windows-1252; si no, sin la tilde que no existe, y si tampoco, con «?»', async () => {
    const r = await exportar('formato=xer&p6=8.2');
    const xer = leerXer(r.bytes);
    assert.ok(xer.filas.get('TASK')!.some((t) => t.task_name === 'Acta Nº 2 — losa de 30 m² <revisión> & firma Gödel o ?'));
    // m² y la raya en Windows-1252 son un byte cada uno: 0xB2 y 0x97.
    assert.ok(r.bytes.includes(Buffer.from([0x6d, 0xb2])));
    assert.ok(r.bytes.includes(Buffer.from([0x20, 0x97, 0x20])));
  });

  test('con costo=true, cada actividad del presupuesto y la administración llevan su gasto en PROJCOST', async () => {
    const xer = leerXer((await exportar('formato=xer&p6=8.2&costo=true')).bytes);
    assert.ok(xer.tablas.includes('PROJCOST'));
    const gastos = xer.filas.get('PROJCOST')!;
    const de = (nombre: string) => gastos.filter((g) => g.task_id === xer.tarea(nombre).task_id);
    assert.deepEqual(
      de('Topografía y replanteo').map((g) => [g.target_cost, g.remain_cost, g.act_cost, g.cost_load_type]),
      [['3200000.00', '3200000.00', '0.00', 'CL_Uniform']],
    );
    assert.equal(de('Administración y supervisión de obra')[0]!.target_cost, '10549000.00');
    assert.deepEqual(de('Inicio del proyecto'), []);
  });

  test('P6 15.2 lleva el mismo archivo con su versión; 21.12 suma las opciones de cálculo, con el desfase en el calendario de la sucesora', async () => {
    const v15 = leerXer((await exportar('formato=xer&p6=15.2')).bytes);
    assert.equal(v15.lineas[0]!.split('\t')[1], '15.2');
    assert.ok(!v15.tablas.includes('SCHEDOPTIONS'));
    const v21 = leerXer((await exportar('formato=xer&p6=21.12')).bytes);
    assert.equal(v21.lineas[0]!.split('\t')[1], '21.12');
    const opciones = v21.filas.get('SCHEDOPTIONS')!;
    assert.deepEqual(
      [opciones.length, opciones[0]!.sched_calendar_on_relationship_lag, opciones[0]!.sched_float_type, opciones[0]!.proj_id],
      [1, 'rcal_Successor', 'FT_FF', v21.filas.get('PROJECT')![0]!.proj_id],
    );
  });

  test('una versión de P6 que no está en la lista, o ninguna, es 422 en p6', async () => {
    for (const consulta of ['formato=xer&p6=6.2', 'formato=xer']) {
      const r = await exportar(consulta);
      assert.deepEqual([r.estado, r.cuerpo.campo], [422, 'p6'], consulta);
    }
  });
});
