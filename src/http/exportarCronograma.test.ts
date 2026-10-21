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
});
