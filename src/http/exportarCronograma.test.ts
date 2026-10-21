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
