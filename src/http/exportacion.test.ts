import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { activarPresupuesto } from '../infraestructura/basedatos/cicloDeVida.js';
import { armarPresupuestoDeReferencia, type PresupuestoDeReferencia } from '../pruebas/presupuestoDeReferencia.js';
import { vencerSuscripcion } from '../pruebas/superusuario.js';
import { textoDePdf } from '../pruebas/textoDePdf.js';
import { VERSION_TERMINOS_DE_PRUEBA, clienteDePrueba, type Cuenta } from '../pruebas/clienteHttp.js';
import { construirServidor } from './servidor.js';

let app: FastifyInstance;
const { pedir, registrar, asistenteCon } = clienteDePrueba(() => app);

before(async () => {
  app = await construirServidor({ secretoSesion: randomBytes(32).toString('hex'), versionTerminos: VERSION_TERMINOS_DE_PRUEBA });
});
after(async () => {
  await app.close();
});

describe('exportar la oferta en PDF y Excel (02 §9.5, RF-PRE-29/30)', () => {
  let duena: Cuenta;
  let referencia: PresupuestoDeReferencia;

  before(async () => {
    duena = await registrar('Constructora Exporta HTTP', '900000360-0', 'exporta.http@construsoft.test');
    referencia = await armarPresupuestoDeReferencia(duena.contexto, 'EXP-HTTP');
  });

  test('el presupuesto vivo en PDF: el archivo, su nombre y la cifra de la referencia adentro', async () => {
    const r = await pedir(`/api/presupuestos/${referencia.presupuestoId}/exportar?formato=pdf`, duena.cookie);
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.headers['content-type'], 'application/pdf');
    assert.match(String(r.headers['content-disposition']), /^attachment; filename="EXP-HTTP\.pdf"/);
    assert.equal(r.rawPayload.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.match(textoDePdf(r.rawPayload).join(' '), /180\.590\.155/);
  });

  test('el presupuesto vivo en Excel', async () => {
    const r = await pedir(`/api/presupuestos/${referencia.presupuestoId}/exportar?formato=xlsx`, duena.cookie);
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.headers['content-type'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.match(String(r.headers['content-disposition']), /filename="EXP-HTTP\.xlsx"/);
    assert.equal(r.rawPayload.subarray(0, 2).toString('latin1'), 'PK');
  });

  test('sin formato, o uno que no existe: 422 en formato', async () => {
    for (const url of [`/api/presupuestos/${referencia.presupuestoId}/exportar`, `/api/presupuestos/${referencia.presupuestoId}/exportar?formato=doc`]) {
      const r = await pedir(url, duena.cookie);
      assert.deepEqual([r.statusCode, r.json<{ campo?: string }>().campo], [422, 'formato'], url);
    }
  });

  test('las versiones: el listado del 02 §10.1, y cada una se exporta con su número en el nombre', async () => {
    const p = await armarPresupuestoDeReferencia(duena.contexto, 'EXP-VER');
    await activarPresupuesto(duena.contexto, p.presupuestoId);
    const lista = await pedir(`/api/presupuestos/${p.presupuestoId}/versiones`, duena.cookie);
    assert.equal(lista.statusCode, 200, lista.body);
    const [v1] = lista.json<{ versiones: { id: string; numero: number; valorTotal: string; estado: string }[] }>().versiones;
    assert.deepEqual([v1!.numero, v1!.valorTotal, v1!.estado], [1, '180590155.000000', 'ACTIVO']);

    const r = await pedir(`/api/versiones/${v1!.id}/exportar?formato=pdf`, duena.cookie);
    assert.equal(r.statusCode, 200, r.body);
    assert.match(String(r.headers['content-disposition']), /filename="EXP-VER - Version 1\.pdf"; filename\*=UTF-8''EXP-VER%20-%20Versi%C3%B3n%201\.pdf/);
    assert.match(textoDePdf(r.rawPayload).join(' '), /Versión 1/);
  });

  test('sin PRESUPUESTOS.EXPORTAR: ver no alcanza para exportar', async () => {
    const lector = await asistenteCon(duena, 'exporta.lector@construsoft.test', ['PRESUPUESTOS.VER']);
    const r = await pedir(`/api/presupuestos/${referencia.presupuestoId}/exportar?formato=pdf`, lector);
    assert.equal(r.statusCode, 403);
    assert.match(r.json<{ mensaje: string }>().mensaje, /PRESUPUESTOS\.EXPORTAR/);
    assert.equal((await pedir(`/api/presupuestos/${referencia.presupuestoId}/versiones`, lector)).statusCode, 200);
  });

  test('con la suscripción vencida se exporta igual: los datos son de la empresa (D-65)', async () => {
    const vencida = await registrar('Constructora Exporta Vencida', '900000361-1', 'exporta.vencida@construsoft.test');
    const p = await armarPresupuestoDeReferencia(vencida.contexto, 'EXP-V');
    await vencerSuscripcion(vencida.contexto.tenantId);
    assert.equal((await pedir(`/api/presupuestos/${p.presupuestoId}/exportar?formato=pdf`, vencida.cookie)).statusCode, 200);
  });
});

describe('aislamiento: no se exporta ni se lista lo de otra empresa (RN-01)', () => {
  test('presupuesto y versión de B responden el mismo 404 que lo inexistente', async () => {
    const a = await registrar('Constructora Exporta A', '900000362-2', 'exporta.http.a@construsoft.test');
    const b = await registrar('Constructora Exporta B', '900000363-3', 'exporta.http.b@construsoft.test');
    const deB = await armarPresupuestoDeReferencia(b.contexto, 'EXP-B');
    await activarPresupuesto(b.contexto, deB.presupuestoId);
    const versionDeB = (await pedir(`/api/presupuestos/${deB.presupuestoId}/versiones`, b.cookie)).json<{ versiones: { id: string }[] }>().versiones[0]!.id;

    for (const plantilla of ['/api/presupuestos/ID/exportar?formato=pdf', '/api/presupuestos/ID/versiones', '/api/versiones/ID/exportar?formato=pdf']) {
      const idDeB = plantilla.startsWith('/api/versiones') ? versionDeB : deB.presupuestoId;
      const ajeno = await pedir(plantilla.replace('ID', idDeB), a.cookie);
      assert.equal(ajeno.statusCode, 404, `${plantilla}: ${ajeno.body}`);
      for (const id of ['01900000-0000-7000-8000-000000000000', 'no-es-un-id']) {
        const otro = await pedir(plantilla.replace('ID', id), a.cookie);
        assert.deepEqual([otro.statusCode, otro.body], [ajeno.statusCode, ajeno.body], `${plantilla} con ${id}`);
      }
    }
  });
});
