import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { altaSuperadmin, purgarEmpresas } from '../infraestructura/basedatos/plataforma.js';
import {
  activarYMoverVencimiento,
  moverCancelacion,
  moverVencimiento,
  purgarComoLaAplicacion,
} from '../pruebas/superusuario.js';
import { VERSION_TERMINOS_DE_PRUEBA, CARPETA_LEGAL_DE_PRUEBA, clienteDePrueba, type Cuenta } from '../pruebas/clienteHttp.js';
import { hashearContrasena } from './contrasenas.js';
import { COOKIE_PLATAFORMA } from './rutasSuperadmin.js';
import { construirServidor } from './servidor.js';

/*
 * CONTRATO §15 (D-74): el ciclo de vida de la suscripción. Los plazos los
 * calcula plataforma.fn_ciclo_suscripcion; aquí se comprueba que la API los
 * lleva tal cual a la empresa y al panel, que el 423 sale de CS006, y que la
 * purga solo la corre el panel.
 */

let app: FastifyInstance;
const { otraIp, registrar, asistenteCon } = clienteDePrueba(() => app);
let panel: string;

before(async () => {
  app = await construirServidor({ carpetaLegal: CARPETA_LEGAL_DE_PRUEBA, secretoSesion: randomBytes(32).toString('hex'), versionTerminos: VERSION_TERMINOS_DE_PRUEBA });
  await altaSuperadmin('ciclo.panel@construsoft.test', 'Pía Plazos', await hashearContrasena('clave-del-panel-1'));
  const r = await app.inject({
    method: 'POST',
    url: '/api/superadmin/sesion',
    remoteAddress: otraIp(),
    payload: { email: 'ciclo.panel@construsoft.test', contrasena: 'clave-del-panel-1' },
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

const HOY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

const sesion = async (c: Cuenta | string) => (await llamar('GET', '/api/sesion', typeof c === 'string' ? c : c.cookie)).cuerpo.suscripcion;
const detalle = async (c: Cuenta | string) => (await llamar('GET', '/api/configuracion/suscripcion', typeof c === 'string' ? c : c.cookie)).cuerpo;
const ficha = async (tenantId: string) => (await llamar('GET', `/api/superadmin/empresas/${tenantId}`, panel)).cuerpo;
const cancelar = (c: Cuenta | string, motivo = 'Cerramos la empresa') =>
  llamar('POST', '/api/configuracion/suscripcion/cancelar', typeof c === 'string' ? c : c.cookie, { motivo });
const reanudar = (c: Cuenta | string) => llamar('POST', '/api/configuracion/suscripcion/reanudar', typeof c === 'string' ? c : c.cookie);

async function reportar(cookie: string) {
  const subida = await app.inject({
    method: 'POST',
    url: '/api/configuracion/suscripcion/comprobantes',
    remoteAddress: otraIp(),
    headers: { cookie, 'content-type': 'application/pdf' },
    payload: Buffer.from(`%PDF-1.4 ${randomBytes(8).toString('hex')}`),
  });
  return llamar('POST', '/api/configuracion/suscripcion/pagos', cookie, {
    fecha: HOY,
    monto: '150000',
    metodo: 'TRANSFERENCIA',
    referencia: 'TRX-15',
    periodoMeses: 1,
    comprobanteId: subida.json<{ id: string }>().id,
  });
}

describe('el arranque trae el ciclo (CONTRATO §15.1)', () => {
  test('al día: acceso completo y los plazos en nulo', async () => {
    const e = await registrar('Constructora Ciclo Al Dia', '900000440-0', 'ciclo.aldia@construsoft.test');
    const s = await sesion(e);
    assert.deepEqual(
      [s.estado, s.soloLectura, s.acceso, s.suspension, s.pagarAMasTardar, s.suspendidaDesde, s.reactivableHasta, s.canceladaPor, s.pagoEnVerificacion],
      ['EN_PRUEBA', false, 'COMPLETO', null, null, null, null, null, false],
    );
    assert.match(s.seEliminaEl, /^\d{4}-\d{2}-\d{2}$/, 'una prueba se elimina a mano a los 10 días de vencer');
  });

  test('vencida y en sus dos días hábiles: POR_PAGAR con la fecha límite, y sigue trabajando', async () => {
    const e = await registrar('Constructora Por Pagar', '900000441-1', 'ciclo.porpagar@construsoft.test');
    await activarYMoverVencimiento(e.contexto.tenantId, -1);
    const s = await sesion(e);
    assert.deepEqual([s.estado, s.acceso, s.soloLectura, s.suspension], ['POR_PAGAR', 'COMPLETO', false, null]);
    assert.ok(s.pagarAMasTardar >= HOY, `${s.pagarAMasTardar} es hoy o después`);
    assert.equal((await llamar('GET', '/api/recursos', e.cookie)).estado, 200);
  });

  test('pasado el plazo: SUSPENDIDA por falta de pago, solo pago, con la fecha en que se eliminan sus datos', async () => {
    const e = await registrar('Constructora Suspendida Pago', '900000442-2', 'ciclo.suspendida@construsoft.test');
    await activarYMoverVencimiento(e.contexto.tenantId, -20);
    const s = await sesion(e);
    assert.deepEqual([s.estado, s.acceso, s.soloLectura, s.suspension], ['SUSPENDIDA', 'SOLO_PAGO', true, 'FALTA_DE_PAGO']);
    assert.ok(s.suspendidaDesde < HOY);
    assert.ok(s.seEliminaEl > HOY);
  });
});

describe('CS006 es 423: una cuenta detenida solo entra a la suscripción (CONTRATO §15.2)', () => {
  test('consultar y escribir dan 423; la suscripción, el arranque y Mi cuenta siguen respondiendo', async () => {
    const e = await registrar('Constructora Detenida', '900000443-3', 'ciclo.detenida@construsoft.test');
    await activarYMoverVencimiento(e.contexto.tenantId, -20);

    const consultar = await llamar('GET', '/api/recursos', e.cookie);
    assert.equal(consultar.estado, 423, consultar.crudo);
    assert.match(consultar.cuerpo.mensaje, /suspendida o cancelada/);
    assert.equal(consultar.cuerpo.campo, undefined);
    const escribir = await llamar('POST', '/api/configuracion/unidades', e.cookie, { simbolo: 'm4', descripcion: 'Metro raro' });
    assert.equal(escribir.estado, 423, escribir.crudo);

    assert.equal((await llamar('GET', '/api/configuracion/suscripcion', e.cookie)).estado, 200);
    assert.equal((await llamar('GET', '/api/sesion', e.cookie)).estado, 200);
    assert.equal((await llamar('GET', '/api/configuracion/cuenta', e.cookie)).estado, 200);
    const r = await reportar(e.cookie);
    assert.equal(r.estado, 201, r.crudo);
    assert.equal((await sesion(e)).pagoEnVerificacion, true);
  });

  test('la suspensión del panel también deja solo la suscripción', async () => {
    const e = await registrar('Constructora Suspendida Panel', '900000444-4', 'ciclo.panel.susp@construsoft.test');
    const r = await llamar('POST', `/api/superadmin/empresas/${e.contexto.tenantId}/suspender`, panel, { motivo: 'Revisión' });
    assert.equal(r.estado, 200, r.crudo);
    const s = await sesion(e);
    assert.deepEqual([s.estado, s.acceso, s.suspension], ['SUSPENDIDA', 'SOLO_PAGO', 'PLATAFORMA']);
    assert.equal((await llamar('GET', '/api/recursos', e.cookie)).estado, 423);
  });
});

describe('cancelar y reanudar (CONTRATO §15.3)', () => {
  test('el Administrador cancela: funciona hasta lo pagado, puede reanudar, y no cancela dos veces', async () => {
    const e = await registrar('Constructora Cancela Sola', '900000445-5', 'ciclo.cancela@construsoft.test');
    const antes = await detalle(e);
    assert.deepEqual([antes.puedeCancelar, antes.puedeReanudar, antes.puedeReportar], [true, false, true]);

    const r = await cancelar(e);
    assert.equal(r.estado, 200, r.crudo);
    assert.deepEqual(
      [r.cuerpo.estado, r.cuerpo.acceso, r.cuerpo.canceladaPor, r.cuerpo.puedeCancelar, r.cuerpo.puedeReanudar, r.cuerpo.puedeReportar],
      ['CANCELADA', 'COMPLETO', 'EMPRESA', false, true, false],
    );
    assert.equal(r.cuerpo.venceEl, antes.venceEl);
    assert.equal((await llamar('GET', '/api/recursos', e.cookie)).estado, 200, 'funciona hasta lo pagado');

    const otra = await cancelar(e);
    assert.deepEqual([otra.estado, otra.cuerpo.campo], [422, undefined]);
    assert.match(otra.cuerpo.mensaje, /ya está cancelada/);

    const eventos = (await ficha(e.contexto.tenantId)).eventos;
    assert.equal(eventos[0].tipo, 'SUSCRIPCION_CANCELADA');

    const vuelta = await reanudar(e);
    assert.equal(vuelta.estado, 200, vuelta.crudo);
    assert.deepEqual([vuelta.cuerpo.estado, vuelta.cuerpo.canceladaPor, vuelta.cuerpo.puedeCancelar], ['EN_PRUEBA', null, true]);
    assert.equal((await ficha(e.contexto.tenantId)).eventos[0].tipo, 'SUSCRIPCION_REANUDADA');
    assert.equal((await reanudar(e)).estado, 422, 'no está cancelada');
  });

  test('cancelar y reanudar son solo del Administrador, aunque el otro tenga CONFIG.SUSCRIPCION', async () => {
    const e = await registrar('Constructora Cancela Permiso', '900000446-6', 'ciclo.permiso@construsoft.test');
    const otro = await asistenteCon(e, 'ciclo.permiso.otro@construsoft.test', ['CONFIG.SUSCRIPCION']);
    const d = await detalle(otro);
    assert.deepEqual([d.puedeCancelar, d.puedeReanudar, d.puedeReportar], [false, false, true]);
    assert.equal((await cancelar(otro)).estado, 403);
    assert.equal((await cancelar(e)).estado, 200);
    assert.equal((await reanudar(otro)).estado, 403);
  });

  test('con un pago esperando verificación no se cancela', async () => {
    const e = await registrar('Constructora Cancela Pendiente', '900000447-7', 'ciclo.pendiente@construsoft.test');
    assert.equal((await reportar(e.cookie)).estado, 201);
    assert.equal((await detalle(e)).puedeCancelar, false);
    const r = await cancelar(e);
    assert.deepEqual([r.estado, r.cuerpo.campo], [422, undefined]);
    assert.match(r.cuerpo.mensaje, /esperando verificación/);
  });

  test('pasada la fecha pagada: solo el Administrador la reactiva, reportando; el panel lo confirma y vuelve ACTIVA', async () => {
    const e = await registrar('Constructora Reactiva', '900000448-8', 'ciclo.reactiva@construsoft.test');
    const otro = await asistenteCon(e, 'ciclo.reactiva.otro@construsoft.test', ['CONFIG.SUSCRIPCION']);
    assert.equal((await cancelar(e)).estado, 200);
    await moverVencimiento(e.contexto.tenantId, -1);

    const s = await sesion(e);
    assert.deepEqual([s.estado, s.acceso, s.canceladaPor], ['CANCELADA', 'SOLO_PAGO', 'EMPRESA']);
    assert.ok(s.reactivableHasta > HOY);
    assert.equal((await llamar('GET', '/api/recursos', e.cookie)).estado, 423);

    const d = await detalle(e);
    assert.deepEqual([d.puedeReportar, d.puedeReanudar, d.puedeCancelar], [true, false, false]);
    assert.equal((await detalle(otro)).puedeReportar, false, 'reactivar es solo del Administrador');
    const tarde = await reanudar(e);
    assert.equal(tarde.estado, 422);
    assert.match(tarde.cuerpo.mensaje, /reporte su pago/);

    const reporte = await reportar(e.cookie);
    assert.equal(reporte.estado, 201, reporte.crudo);
    assert.equal(reporte.cuerpo.pagoEnVerificacion, true);

    // §15.4: la propuesta responde aunque esté cancelada, porque hay un pago que confirmar.
    const propuesta = await llamar('GET', `/api/superadmin/empresas/${e.contexto.tenantId}/pagos/propuesta?periodoMeses=1`, panel);
    assert.equal(propuesta.estado, 200, propuesta.crudo);
    const pago = (await ficha(e.contexto.tenantId)).pagos.find((p: { estado: string }) => p.estado === 'PENDIENTE');
    const confirmado = await llamar('POST', `/api/superadmin/pagos/${pago.id}/confirmar`, panel, { periodoMeses: 1, cubreHasta: null });
    assert.equal(confirmado.estado, 200, confirmado.crudo);
    assert.deepEqual([confirmado.cuerpo.suscripcion.estado, confirmado.cuerpo.suscripcion.venceEl], ['ACTIVA', propuesta.cuerpo.cubreHasta]);
    assert.ok(confirmado.cuerpo.eventos.some((x: { tipo: string }) => x.tipo === 'SUSCRIPCION_REACTIVADA'));
    assert.equal((await sesion(e)).acceso, 'COMPLETO');
  });
});

describe('el panel ve el ciclo (CONTRATO §15.4)', () => {
  test('POR_PAGAR y SUSPENDIDA en la lista y el resumen; el filtro SUSPENDIDA trae las dos suspensiones', async () => {
    const porPagar = await registrar('Constructora Panel Por Pagar', '900000449-9', 'ciclo.p.porpagar@construsoft.test');
    await activarYMoverVencimiento(porPagar.contexto.tenantId, -1);
    const sinPagar = await registrar('Constructora Panel Sin Pagar', '900000450-0', 'ciclo.p.sinpagar@construsoft.test');
    await activarYMoverVencimiento(sinPagar.contexto.tenantId, -20);
    const delPanel = await registrar('Constructora Panel Suspende', '900000451-1', 'ciclo.p.suspende@construsoft.test');
    await llamar('POST', `/api/superadmin/empresas/${delPanel.contexto.tenantId}/suspender`, panel, { motivo: 'Revisión' });

    const porPagarLista = (await llamar('GET', '/api/superadmin/empresas?estado=POR_PAGAR', panel)).cuerpo.empresas;
    assert.deepEqual(
      porPagarLista.filter((f: { id: string }) => f.id === porPagar.contexto.tenantId).map((f: { estado: string }) => f.estado),
      ['POR_PAGAR'],
    );
    const suspendidas = (await llamar('GET', '/api/superadmin/empresas?estado=SUSPENDIDA', panel)).cuerpo.empresas.map((f: { id: string }) => f.id);
    assert.ok(suspendidas.includes(sinPagar.contexto.tenantId) && suspendidas.includes(delPanel.contexto.tenantId));
    assert.ok(!suspendidas.includes(porPagar.contexto.tenantId));

    const resumen = (await llamar('GET', '/api/superadmin/resumen', panel)).cuerpo;
    assert.ok(resumen.empresas.porPagar >= 1);
    assert.ok(resumen.empresas.suspendidas >= 2);
  });

  test('la ficha trae los plazos; «se eliminan pronto» trae las que vencen en 7 días y no las pruebas vencidas', async () => {
    const pronto = await registrar('Constructora Se Elimina Pronto', '900000452-2', 'ciclo.pronto@construsoft.test');
    // Suspendida hace ~56 días: le quedan menos de 7 para el día 61.
    await activarYMoverVencimiento(pronto.contexto.tenantId, -60);
    const prueba = await registrar('Constructora Prueba Abandonada', '900000453-3', 'ciclo.prueba@construsoft.test');
    await moverVencimiento(prueba.contexto.tenantId, -9);

    const f = await ficha(pronto.contexto.tenantId);
    assert.deepEqual([f.suscripcion.estado, f.suscripcion.canceladaPor, f.suscripcion.reactivableHasta], ['SUSPENDIDA', null, null]);
    assert.match(f.suscripcion.pagarAMasTardar, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(f.suscripcion.suspendidaDesde, /^\d{4}-\d{2}-\d{2}$/);

    const resumen = (await llamar('GET', '/api/superadmin/resumen', panel)).cuerpo;
    const ids = resumen.porEliminar.map((x: { id: string }) => x.id);
    assert.ok(ids.includes(pronto.contexto.tenantId));
    assert.ok(!ids.includes(prueba.contexto.tenantId), 'la prueba vencida sigue siendo a mano');
    const fechas = resumen.porEliminar.map((x: { eliminableDesde: string }) => x.eliminableDesde);
    assert.deepEqual(fechas, [...fechas].sort());
  });

  test('una cancelada por el panel dice PLATAFORMA en la ficha y en la empresa', async () => {
    const e = await registrar('Constructora Cancela Panel', '900000454-4', 'ciclo.cancelapanel@construsoft.test');
    const r = await llamar('POST', `/api/superadmin/empresas/${e.contexto.tenantId}/suscripcion/cancelar`, panel, { motivo: 'Pidió la baja' });
    assert.equal(r.estado, 200, r.crudo);
    assert.equal(r.cuerpo.suscripcion.canceladaPor, 'PLATAFORMA');
    assert.equal((await sesion(e)).canceladaPor, 'PLATAFORMA');
  });
});

describe('la purga diaria (CONTRATO §15.5)', () => {
  test('elimina las que cumplieron su plazo, dice por qué, y deja las demás', async () => {
    const vieja = await registrar('Constructora Suspendida Vieja', '900000455-5', 'ciclo.vieja@construsoft.test');
    await activarYMoverVencimiento(vieja.contexto.tenantId, -80);
    const fuera = await registrar('Constructora Cancelada Fuera', '900000456-6', 'ciclo.fuera@construsoft.test');
    assert.equal((await cancelar(fuera)).estado, 200);
    await moverVencimiento(fuera.contexto.tenantId, -30);
    await moverCancelacion(fuera.contexto.tenantId, -30);
    assert.equal((await sesion(fuera)).acceso, 'NINGUNO');
    const viva = await registrar('Constructora Sigue Viva', '900000457-7', 'ciclo.viva@construsoft.test');
    await activarYMoverVencimiento(viva.contexto.tenantId, -20);

    const purgadas = await purgarEmpresas();
    const porId = new Map(purgadas.map((p) => [p.tenantId, p]));
    assert.match(porId.get(vieja.contexto.tenantId)!.motivo, /falta de pago/);
    assert.equal(porId.get(vieja.contexto.tenantId)!.razonSocial, 'Constructora Suspendida Vieja');
    assert.match(porId.get(fuera.contexto.tenantId)!.motivo, /cancelada/);
    assert.ok(!porId.has(viva.contexto.tenantId));

    assert.equal((await llamar('GET', `/api/superadmin/empresas/${vieja.contexto.tenantId}`, panel)).estado, 404);
    assert.equal((await llamar('GET', `/api/superadmin/empresas/${viva.contexto.tenantId}`, panel)).estado, 200);
    const evento = (await llamar('GET', '/api/superadmin/eventos', panel)).cuerpo.eventos.find(
      (x: { tipo: string; justificacion: string }) => x.tipo === 'TENANT_ELIMINADO' && /Suspendida Vieja|falta de pago/.test(x.justificacion ?? ''),
    );
    assert.ok(evento, 'el evento sobrevive a la empresa');
    assert.equal(evento.autor, null, 'la purga no tiene autor');
  });

  test('la aplicación de las empresas no la puede correr: solo el rol del panel', async () => {
    await assert.rejects(purgarComoLaAplicacion(), /permiso denegado|permission denied/);
  });
});
