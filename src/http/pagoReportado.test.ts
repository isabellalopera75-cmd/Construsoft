import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { altaSuperadmin } from '../infraestructura/basedatos/plataforma.js';
import { vencerSuscripcion } from '../pruebas/superusuario.js';
import { VERSION_TERMINOS_DE_PRUEBA, CARPETA_LEGAL_DE_PRUEBA, clienteDePrueba, type Cuenta } from '../pruebas/clienteHttp.js';
import { hashearContrasena } from './contrasenas.js';
import { COOKIE_PLATAFORMA } from './rutasSuperadmin.js';
import { construirServidor } from './servidor.js';

/*
 * CONTRATO §14 (D-73): la empresa reporta su pago con el comprobante; el
 * pago queda en verificación y NO da acceso hasta que el panel lo confirma.
 */

let app: FastifyInstance;
const { otraIp, registrar, asistenteCon } = clienteDePrueba(() => app);
let panel: string;

before(async () => {
  app = await construirServidor({ carpetaLegal: CARPETA_LEGAL_DE_PRUEBA, secretoSesion: randomBytes(32).toString('hex'), versionTerminos: VERSION_TERMINOS_DE_PRUEBA });
  await altaSuperadmin('reporte.panel@construsoft.test', 'Vera Verifica', await hashearContrasena('clave-del-panel-1'));
  const r = await app.inject({
    method: 'POST',
    url: '/api/superadmin/sesion',
    remoteAddress: otraIp(),
    payload: { email: 'reporte.panel@construsoft.test', contrasena: 'clave-del-panel-1' },
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

async function subirComprobante(cookie: string, archivo = Buffer.from(`%PDF-1.4 ${randomBytes(8).toString('hex')}`)) {
  const r = await app.inject({
    method: 'POST',
    url: '/api/configuracion/suscripcion/comprobantes',
    remoteAddress: otraIp(),
    headers: { cookie, 'content-type': 'application/pdf' },
    payload: archivo,
  });
  return { estado: r.statusCode, cuerpo: r.json<{ id?: string; mensaje?: string; campo?: string }>() };
}

const HOY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

/** Sube un comprobante y reporta un pago de 3 meses. */
async function reportar(cuenta: Cuenta | string, cambios: Record<string, unknown> = {}) {
  const cookie = typeof cuenta === 'string' ? cuenta : cuenta.cookie;
  const { cuerpo } = await subirComprobante(cookie);
  return llamar('POST', '/api/configuracion/suscripcion/pagos', cookie, {
    fecha: HOY,
    monto: '150000',
    metodo: 'TRANSFERENCIA',
    referencia: 'TRX-77',
    periodoMeses: 3,
    comprobanteId: cuerpo.id,
    ...cambios,
  });
}

describe('la empresa reporta su pago (CONTRATO §14.1)', () => {
  test('el pago queda en verificación y no da acceso; un segundo reporte espera al primero', async () => {
    const e = await registrar('Constructora Reporta', '900000430-0', 'reporte.admin@construsoft.test');
    const antes = await llamar('GET', '/api/configuracion/suscripcion', e.cookie);
    assert.equal(antes.cuerpo.puedeReportar, true);

    const r = await reportar(e);
    assert.equal(r.estado, 201, r.crudo);
    assert.equal(r.cuerpo.estado, 'EN_PRUEBA', 'reportar no da acceso');
    assert.equal(r.cuerpo.venceEl, antes.cuerpo.venceEl);
    const [pago] = r.cuerpo.pagos;
    assert.deepEqual(
      [pago.estado, pago.origen, pago.cubreHasta, pago.periodoMeses, pago.monto, pago.rechazoMotivo],
      ['PENDIENTE', 'REPORTADO', null, 3, '150000.000000', null],
    );

    const otro = await reportar(e);
    assert.equal(otro.estado, 422);
    assert.equal(otro.cuerpo.campo, undefined);
    assert.match(otro.cuerpo.mensaje, /esperando verificación/);
  });

  test('los datos que faltan o están mal marcan su campo', async () => {
    const e = await registrar('Constructora Reporta Mal', '900000431-1', 'reporte.mal@construsoft.test');
    assert.deepEqual(((r) => [r.estado, r.cuerpo.campo])(await reportar(e, { monto: '0.00' })), [422, 'monto']);
    assert.deepEqual(((r) => [r.estado, r.cuerpo.campo])(await reportar(e, { comprobanteId: null })), [422, 'comprobante']);
    assert.deepEqual(((r) => [r.estado, r.cuerpo.campo])(await reportar(e, { periodoMeses: 2 })), [422, 'periodoMeses']);
    assert.deepEqual(((r) => [r.estado, r.cuerpo.campo])(await reportar(e, { fecha: '2099-01-01' })), [422, 'fecha']);
    const svg = await subirComprobante(e.cookie, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'));
    assert.deepEqual([svg.estado, svg.cuerpo.campo], [422, 'comprobante']);
  });

  test('con la suscripción vencida se puede reportar: es justo cuando hace falta', async () => {
    const e = await registrar('Constructora Reporta Vencida', '900000432-2', 'reporte.vencida@construsoft.test');
    await vencerSuscripcion(e.contexto.tenantId);
    assert.equal((await llamar('GET', '/api/configuracion/suscripcion', e.cookie)).cuerpo.puedeReportar, true);
    const r = await reportar(e);
    assert.deepEqual([r.estado, r.cuerpo.estado], [201, 'VENCIDA']);
  });

  test('reporta quien tiene CONFIG.SUSCRIPCION; sin él, 403', async () => {
    const e = await registrar('Constructora Reporta Permiso', '900000433-3', 'reporte.permiso@construsoft.test');
    const sinPermiso = await asistenteCon(e, 'reporte.sin@construsoft.test', ['RECURSOS.VER']);
    assert.equal((await subirComprobante(sinPermiso)).estado, 403);
    const conPermiso = await asistenteCon(e, 'reporte.con@construsoft.test', ['CONFIG.SUSCRIPCION']);
    assert.equal((await reportar(conPermiso)).estado, 201);
  });

  test('aislamiento: el comprobante de otra empresa no sirve para reportar (RN-01)', async () => {
    const a = await registrar('Constructora Reporta A', '900000434-4', 'reporte.a@construsoft.test');
    const b = await registrar('Constructora Reporta B', '900000435-5', 'reporte.b@construsoft.test');
    const deB = (await subirComprobante(b.cookie)).cuerpo.id;
    const r = await reportar(a, { comprobanteId: deB });
    assert.deepEqual([r.estado, r.cuerpo.campo], [422, 'comprobante']);
    assert.equal((await llamar('GET', '/api/configuracion/suscripcion', a.cookie)).cuerpo.pagos.length, 0);
  });
});

describe('el panel verifica el pago reportado (CONTRATO §14.2)', () => {
  const ficha = async (tenantId: string) => (await llamar('GET', `/api/superadmin/empresas/${tenantId}`, panel)).cuerpo;

  test('el resumen lo muestra primero; confirmar lo da por pagado, activa la suscripción y queda firmado', async () => {
    const e = await registrar('Constructora Confirmada', '900000436-6', 'reporte.confirmada@construsoft.test');
    await reportar(e);
    const resumen = (await llamar('GET', '/api/superadmin/resumen', panel)).cuerpo;
    const pendiente = resumen.porVerificar.find((p: { empresa: { id: string } }) => p.empresa.id === e.contexto.tenantId);
    assert.deepEqual(
      [pendiente.estado, pendiente.origen, pendiente.reportadoPor, pendiente.registradoPor, pendiente.cubreHasta],
      ['PENDIENTE', 'REPORTADO', 'Admin de Constructora Confirmada', null, null],
    );
    const [reportado] = (await ficha(e.contexto.tenantId)).eventos;
    assert.deepEqual([reportado.tipo, reportado.autor], ['PAGO_REPORTADO', 'Admin de Constructora Confirmada (empresa)']);

    const propuesta = (await llamar('GET', `/api/superadmin/empresas/${e.contexto.tenantId}/pagos/propuesta?periodoMeses=3`, panel)).cuerpo.cubreHasta;
    const r = await llamar('POST', `/api/superadmin/pagos/${pendiente.id}/confirmar`, panel, {});
    assert.equal(r.estado, 200, r.crudo);
    assert.deepEqual([r.cuerpo.suscripcion.estado, r.cuerpo.suscripcion.venceEl], ['ACTIVA', propuesta]);
    const pago = r.cuerpo.pagos.find((p: { id: string }) => p.id === pendiente.id);
    assert.deepEqual([pago.estado, pago.registradoPor, pago.cubreHasta], ['EXITOSO', 'Vera Verifica', propuesta]);
    assert.equal((await llamar('GET', '/api/configuracion/suscripcion', e.cookie)).cuerpo.estado, 'ACTIVA');

    const otraVez = await llamar('POST', `/api/superadmin/pagos/${pendiente.id}/confirmar`, panel, {});
    assert.deepEqual([otraVez.estado, otraVez.cuerpo.mensaje], [422, 'Ese pago no está esperando verificación.']);
  });

  test('rechazar exige motivo; la empresa lo lee tal cual, sigue sin acceso, y un rechazo no cuenta como pago', async () => {
    const e = await registrar('Constructora Rechazada', '900000437-7', 'reporte.rechazada@construsoft.test');
    const reporte = await reportar(e);
    const pagoId = reporte.cuerpo.pagos[0].id;
    const sinMotivo = await llamar('POST', `/api/superadmin/pagos/${pagoId}/rechazar`, panel, { motivo: ' ' });
    assert.deepEqual([sinMotivo.estado, sinMotivo.cuerpo.campo], [422, 'motivo']);

    const r = await llamar('POST', `/api/superadmin/pagos/${pagoId}/rechazar`, panel, { motivo: 'El comprobante no aparece en el banco.' });
    assert.equal(r.estado, 200, r.crudo);
    assert.notEqual(r.cuerpo.eliminableDesde, null, 'un comprobante falso no compra la conservación de los datos');
    const empresa = (await llamar('GET', '/api/configuracion/suscripcion', e.cookie)).cuerpo;
    assert.deepEqual(
      [empresa.estado, empresa.pagos[0].estado, empresa.pagos[0].rechazoMotivo],
      ['EN_PRUEBA', 'RECHAZADO', 'El comprobante no aparece en el banco.'],
    );
    const rechazados = (await llamar('GET', `/api/superadmin/pagos?desde=2000-01-01&hasta=2099-12-31&estado=RECHAZADO`, panel)).cuerpo;
    assert.ok(rechazados.pagos.some((p: { id: string }) => p.id === pagoId));
    assert.ok(rechazados.pagos.every((p: { estado: string }) => p.estado === 'RECHAZADO'));
    // Con una fecha de pago MÁS VIEJA que la del rechazado: la lista va por
    // registro, así que el pendiente nuevo se lee primero igual.
    const nuevo = await reportar(e, { fecha: '2026-01-15' });
    assert.equal(nuevo.estado, 201, 'después del rechazo puede reportar otro');
    assert.deepEqual(nuevo.cuerpo.pagos.map((p: { estado: string }) => p.estado), ['PENDIENTE', 'RECHAZADO']);
  });

  test('confirmar con una fecha pasada marca cubreHasta; un pago que no existe es 404', async () => {
    const e = await registrar('Constructora Fecha Pasada', '900000438-8', 'reporte.pasada@construsoft.test');
    const pagoId = (await reportar(e)).cuerpo.pagos[0].id;
    const pasada = await llamar('POST', `/api/superadmin/pagos/${pagoId}/confirmar`, panel, { periodoMeses: null, cubreHasta: '2020-01-01' });
    assert.deepEqual([pasada.estado, pasada.cuerpo.campo], [422, 'cubreHasta']);
    for (const id of ['01900000-0000-7000-8000-000000000000', 'no-es-un-id']) {
      assert.equal((await llamar('POST', `/api/superadmin/pagos/${id}/confirmar`, panel, {})).estado, 404);
    }
  });

  test('una empresa cancelada ya no puede reportar', async () => {
    const e = await registrar('Constructora Reporta Cancelada', '900000439-9', 'reporte.cancelada@construsoft.test');
    await llamar('POST', `/api/superadmin/empresas/${e.contexto.tenantId}/suscripcion/cancelar`, panel, { motivo: 'No renovó' });
    assert.equal((await llamar('GET', '/api/configuracion/suscripcion', e.cookie)).cuerpo.puedeReportar, false);
    assert.equal((await reportar(e)).estado, 422);
  });
});
