import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { altaSuperadmin } from '../infraestructura/basedatos/plataforma.js';
import { VERSION_TERMINOS_DE_PRUEBA, CARPETA_LEGAL_DE_PRUEBA, clienteDePrueba } from '../pruebas/clienteHttp.js';
import { hashearContrasena } from './contrasenas.js';
import { COOKIE_PLATAFORMA } from './rutasSuperadmin.js';
import { construirServidor } from './servidor.js';

/*
 * CONTRATO §18.2 y §18.3 (D-78): los plazos del ciclo, leídos por la empresa y
 * cambiados por el panel.
 *
 * Los plazos son de TODA la plataforma y las pruebas de los demás archivos
 * corren a la vez. Por eso aquí solo se programan cambios para 2099, que no
 * mueven el plazo de nadie hoy, y cada prueba anula lo que programó.
 */

let app: FastifyInstance;
const { otraIp, registrar } = clienteDePrueba(() => app);
let panel: string;

before(async () => {
  app = await construirServidor({ carpetaLegal: CARPETA_LEGAL_DE_PRUEBA, secretoSesion: randomBytes(32).toString('hex'), versionTerminos: VERSION_TERMINOS_DE_PRUEBA });
  await altaSuperadmin('plazos.panel@construsoft.test', 'Paula Plazos', await hashearContrasena('clave-del-panel-1'));
  const r = await app.inject({
    method: 'POST',
    url: '/api/superadmin/sesion',
    remoteAddress: otraIp(),
    payload: { email: 'plazos.panel@construsoft.test', contrasena: 'clave-del-panel-1' },
  });
  panel = `${COOKIE_PLATAFORMA}=${r.cookies.find((c) => c.name === COOKIE_PLATAFORMA)!.value}`;
});
after(async () => {
  await app.close();
});

async function llamar(metodo: 'GET' | 'POST', url: string, cookie: string, cuerpo?: unknown) {
  const r = await app.inject({
    method: metodo,
    url,
    remoteAddress: otraIp(),
    headers: { cookie },
    ...(cuerpo === undefined ? {} : { payload: cuerpo as object }),
  });
  return { estado: r.statusCode, cuerpo: (r.body === '' ? {} : r.json()) as Record<string, any>, crudo: r.body };
}

const ORDEN = ['GRACIA_PAGO', 'PLAZO_TRAS_RECHAZO', 'SUSPENSION', 'PRUEBA_SOLO_LECTURA', 'REACTIVACION'];

describe('la empresa lee los plazos vigentes (CONTRATO §18.2)', () => {
  test('la pestaña de suscripción trae los cinco plazos de hoy, como números', async () => {
    const e = await registrar('Constructora Lee Plazos', '900000470-0', 'plazos.empresa@construsoft.test');
    const r = await llamar('GET', '/api/configuracion/suscripcion', e.cookie);
    assert.equal(r.estado, 200, r.crudo);
    assert.deepEqual(r.cuerpo.plazos, { graciaPago: 2, plazoTrasRechazo: 2, suspension: 60, pruebaSoloLectura: 10, reactivacion: 10 });
  });
});

describe('el panel ve y cambia los plazos (CONTRATO §18.3)', () => {
  test('la vista: los cinco en el orden de la pantalla, sin «-infinity», y el historial con los valores iniciales', async () => {
    const r = await llamar('GET', '/api/superadmin/parametros', panel);
    assert.equal(r.estado, 200, r.crudo);
    assert.deepEqual(r.cuerpo.parametros.map((p: { clave: string }) => p.clave), ORDEN);
    const gracia = r.cuerpo.parametros[0];
    assert.deepEqual(
      [gracia.unidad, gracia.valorHoy, gracia.vigenteDesde, gracia.apareceEnTerminos, typeof gracia.minimo, typeof gracia.maximo],
      ['DIAS_HABILES', 2, null, false, 'number', 'number'],
    );
    assert.ok(!r.crudo.includes('infinity'), 'la API nunca manda «-infinity»');
    const inicial = r.cuerpo.historial.find((h: { clave: string; registradoPor: string | null }) => h.clave === 'SUSPENSION' && h.registradoPor === null);
    assert.deepEqual([inicial.valor, inicial.vigenteDesde, inicial.nombre], [60, null, 'Suspensión antes de eliminar']);
    assert.match(inicial.registradoEn, /^\d{4}-\d{2}-\d{2}T/);
  });

  test('programar un cambio y anularlo: devuelven la vista, dejan su evento y queda firmado', async () => {
    const programar = await llamar('POST', '/api/superadmin/parametros/SUSPENSION', panel, { valor: '90', vigenteDesde: '2099-01-01', motivo: 'Más tiempo para pagar' });
    assert.equal(programar.estado, 200, programar.crudo);
    const suspension = programar.cuerpo.parametros.find((p: { clave: string }) => p.clave === 'SUSPENSION');
    assert.deepEqual([suspension.valorHoy, suspension.valorProgramado, suspension.programadoDesde], [60, 90, '2099-01-01']);
    const [ultimo] = programar.cuerpo.historial;
    assert.deepEqual([ultimo.clave, ultimo.valor, ultimo.vigenteDesde, ultimo.motivo, ultimo.registradoPor], ['SUSPENSION', 90, '2099-01-01', 'Más tiempo para pagar', 'Paula Plazos']);

    const anular = await llamar('POST', '/api/superadmin/parametros/SUSPENSION/anular', panel, { vigenteDesde: '2099-01-01', motivo: 'Lo decidimos después' });
    assert.equal(anular.estado, 200, anular.crudo);
    const despues = anular.cuerpo.parametros.find((p: { clave: string }) => p.clave === 'SUSPENSION');
    assert.deepEqual([despues.valorProgramado, despues.programadoDesde], [null, null]);

    const eventos = (await llamar('GET', '/api/superadmin/eventos', panel)).cuerpo.eventos;
    const tipos = eventos.filter((x: { autor: string }) => x.autor === 'Paula Plazos').map((x: { tipo: string }) => x.tipo);
    assert.deepEqual(tipos.slice(0, 2), ['PARAMETRO_ANULADO', 'PARAMETRO_CAMBIADO']);
  });

  test('los rechazos marcan su campo: valor que no es un número, fuera de límites, fecha pasada, sin motivo', async () => {
    const intentar = (cuerpo: Record<string, unknown>) =>
      llamar('POST', '/api/superadmin/parametros/REACTIVACION', panel, { valor: '15', vigenteDesde: '2099-02-01', motivo: 'Prueba', ...cuerpo });
    for (const [cuerpo, campo] of [
      [{ valor: 'quince' }, 'valor'],
      [{ valor: '15.5' }, 'valor'],
      [{ valor: 15 }, 'valor'],
      [{ valor: '9999' }, 'valor'],
      [{ vigenteDesde: '2020-01-01' }, 'vigenteDesde'],
      [{ motivo: '  ' }, 'motivo'],
    ] as const) {
      const r = await intentar(cuerpo);
      assert.deepEqual([r.estado, r.cuerpo.campo], [422, campo], `${JSON.stringify(cuerpo)}: ${r.crudo}`);
    }
    const nada = (await llamar('GET', '/api/superadmin/parametros', panel)).cuerpo.parametros.find((p: { clave: string }) => p.clave === 'REACTIVACION');
    assert.equal(nada.valorProgramado, null, 'ningún rechazo dejó nada programado');
  });

  test('una clave que no existe es 404, al cambiar y al anular; anular lo que no está programado es 422', async () => {
    assert.equal((await llamar('POST', '/api/superadmin/parametros/NO_EXISTE', panel, { valor: '5', vigenteDesde: '2099-01-01', motivo: 'x' })).estado, 404);
    assert.equal((await llamar('POST', '/api/superadmin/parametros/NO_EXISTE/anular', panel, { vigenteDesde: '2099-01-01', motivo: 'x' })).estado, 404);
    const sinNada = await llamar('POST', '/api/superadmin/parametros/GRACIA_PAGO/anular', panel, { vigenteDesde: '2099-03-01', motivo: 'x' });
    assert.equal(sinNada.estado, 422, sinNada.crudo);
  });

  test('sin la sesión del panel, 401; con la de una empresa, también', async () => {
    const e = await registrar('Constructora Sin Panel', '900000471-1', 'plazos.sinpanel@construsoft.test');
    assert.equal((await llamar('GET', '/api/superadmin/parametros', e.cookie)).estado, 401);
    assert.equal((await llamar('POST', '/api/superadmin/parametros/SUSPENSION', e.cookie, { valor: '90', vigenteDesde: '2099-01-01', motivo: 'x' })).estado, 401);
  });
});
