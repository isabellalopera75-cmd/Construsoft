import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { altaSuperadmin, cambiarClaveSuperadmin } from '../infraestructura/basedatos/plataforma.js';
import { desactivarSuperadmin, moverVencimiento } from '../pruebas/superusuario.js';
import { pngDeUnPixel } from '../pruebas/imagenes.js';
import { VERSION_TERMINOS_DE_PRUEBA, CARPETA_LEGAL_DE_PRUEBA, clienteDePrueba } from '../pruebas/clienteHttp.js';
import { hashearContrasena } from './contrasenas.js';
import { COOKIE_PLATAFORMA } from './rutasSuperadmin.js';
import { construirServidor } from './servidor.js';

let app: FastifyInstance;
const { otraIp, pedir, registrar, asistenteCon } = clienteDePrueba(() => app);
const CLAVE = 'clave-del-panel-1';

before(async () => {
  app = await construirServidor({ carpetaLegal: CARPETA_LEGAL_DE_PRUEBA, secretoSesion: randomBytes(32).toString('hex'), versionTerminos: VERSION_TERMINOS_DE_PRUEBA });
});
after(async () => {
  await app.close();
});

function cookieDelPanel(r: LightMyRequestResponse): string | undefined {
  const c = r.cookies.find((x) => x.name === COOKIE_PLATAFORMA);
  return c && c.value !== '' ? `${COOKIE_PLATAFORMA}=${c.value}` : undefined;
}

const entrar = (email: string, contrasena = CLAVE, ip = otraIp()) =>
  app.inject({ method: 'POST', url: '/api/superadmin/sesion', remoteAddress: ip, payload: { email, contrasena } });

/** Da de alta un superadministrador y abre su sesión. */
async function superadmin(email: string, nombre: string): Promise<string> {
  await altaSuperadmin(email, nombre, await hashearContrasena(CLAVE));
  const r = await entrar(email);
  assert.equal(r.statusCode, 200, r.body);
  return cookieDelPanel(r)!;
}

async function panel(metodo: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, cookie: string | undefined, cuerpo?: unknown) {
  const r = await app.inject({
    method: metodo,
    url: `/api/superadmin${url}`,
    remoteAddress: otraIp(),
    ...(cookie ? { headers: { cookie } } : {}),
    ...(cuerpo === undefined ? {} : { payload: cuerpo as object }),
  });
  const cuerpoJson = r.body === '' || !String(r.headers['content-type']).includes('json') ? {} : r.json<Record<string, any>>();
  return { estado: r.statusCode, cuerpo: cuerpoJson as Record<string, any>, crudo: r.body, respuesta: r };
}

describe('la sesión del panel (CONTRATO §12.1)', () => {
  test('ingresar da la cookie cs_plataforma, solo para /api/superadmin, por 2 horas; salir la borra', async () => {
    await altaSuperadmin('panel.sesion@construsoft.test', 'Sara Plataforma', await hashearContrasena(CLAVE));
    const r = await entrar('PANEL.Sesion@construsoft.test');
    assert.deepEqual([r.statusCode, r.json()], [200, { nombre: 'Sara Plataforma', email: 'panel.sesion@construsoft.test' }]);
    const c = r.cookies.find((x) => x.name === COOKIE_PLATAFORMA)!;
    assert.deepEqual([c.path, c.httpOnly, c.secure, c.sameSite, c.maxAge], ['/api/superadmin', true, true, 'Strict', 7200]);

    const cookie = cookieDelPanel(r)!;
    assert.deepEqual((await panel('GET', '/sesion', cookie)).cuerpo, { nombre: 'Sara Plataforma', email: 'panel.sesion@construsoft.test' });
    const salir = await panel('DELETE', '/sesion', cookie);
    assert.equal(salir.estado, 204);
    assert.equal(salir.respuesta.cookies.find((x) => x.name === COOKIE_PLATAFORMA)?.value, '');
  });

  test('correo inexistente, contraseña errada y cuenta inactiva responden lo mismo; cinco fallos bloquean', async () => {
    await altaSuperadmin('panel.inactivo@construsoft.test', 'Inactivo', await hashearContrasena(CLAVE));
    await desactivarSuperadmin('panel.inactivo@construsoft.test');
    await altaSuperadmin('panel.bloqueo@construsoft.test', 'Bloqueo', await hashearContrasena(CLAVE));
    const respuestas = [
      await entrar('panel.nadie@construsoft.test'),
      await entrar('panel.bloqueo@construsoft.test', 'otra-clave-1'),
      await entrar('panel.inactivo@construsoft.test'),
    ];
    assert.deepEqual(new Set(respuestas.map((r) => `${r.statusCode} ${r.body}`)).size, 1);
    assert.equal(respuestas[0]!.statusCode, 401);

    for (let i = 0; i < 4; i += 1) await entrar('panel.bloqueo@construsoft.test', `mala-${i}`);
    const bloqueada = await entrar('panel.bloqueo@construsoft.test');
    assert.equal(bloqueada.statusCode, 429);
    assert.ok(bloqueada.headers['retry-after']);
  });

  test('cambiar la contraseña por terminal cierra las sesiones abiertas', async () => {
    const cookie = await superadmin('panel.clave@construsoft.test', 'Clave');
    assert.equal((await panel('GET', '/sesion', cookie)).estado, 200);
    await cambiarClaveSuperadmin('panel.clave@construsoft.test', await hashearContrasena('otra-clave-del-panel'));
    assert.equal((await panel('GET', '/sesion', cookie)).estado, 401);
  });

  test('las dos puertas no se cruzan: la cookie de una empresa no abre el panel, y la del panel no abre una empresa', async () => {
    const empresa = await registrar('Constructora Puerta', '900000420-0', 'panel.puerta@construsoft.test');
    assert.equal((await panel('GET', '/resumen', empresa.cookie)).estado, 401);
    const cookie = await superadmin('panel.cruce@construsoft.test', 'Cruce');
    assert.equal((await pedir('/api/sesion', cookie)).statusCode, 401);
    assert.equal((await panel('GET', '/resumen', undefined)).estado, 401);
  });
});

describe('las lecturas del panel (RF-SAD-02, 03, 10)', () => {
  let cookie: string;
  before(async () => {
    cookie = await superadmin('panel.lector@construsoft.test', 'Lector');
  });

  test('la lista busca sin mayúsculas ni tildes, por NIT y por estado; la ficha solo trae conteos', async () => {
    const rios = await registrar('Constructora Ríos Andinos', '900.000.421-1', 'panel.rios@construsoft.test');
    await asistenteCon(rios, 'panel.rios.asistente@construsoft.test', ['RECURSOS.VER']);

    const porNombre = (await panel('GET', '/empresas?texto=RIOS%20andinos', cookie)).cuerpo.empresas;
    assert.deepEqual(porNombre.map((e: { id: string }) => e.id), [rios.contexto.tenantId]);
    const fila = porNombre[0];
    assert.deepEqual(
      [fila.razonSocial, fila.planCodigo, fila.estado, fila.suspendida, fila.usuarios, fila.proyectos],
      ['Constructora Ríos Andinos', 'EMPRESARIAL', 'EN_PRUEBA', false, 2, 0],
    );
    assert.match(fila.venceEl, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(fila.eliminableDesde, /^\d{4}-\d{2}-\d{2}$/);

    assert.deepEqual((await panel('GET', '/empresas?texto=900000421', cookie)).cuerpo.empresas.length, 1);
    const sinDigitos = (await panel('GET', '/empresas?texto=zzz-no-existe', cookie)).cuerpo.empresas;
    assert.deepEqual(sinDigitos, [], 'un texto sin dígitos no encuentra todas las empresas por el NIT');
    const vencidas = (await panel('GET', '/empresas?estado=VENCIDA', cookie)).cuerpo.empresas;
    assert.ok(!vencidas.some((e: { id: string }) => e.id === rios.contexto.tenantId));

    const ficha = (await panel('GET', `/empresas/${rios.contexto.tenantId}`, cookie)).cuerpo;
    assert.deepEqual(Object.keys(ficha).sort(), ['cifras', 'eliminableDesde', 'empresa', 'eventos', 'pagos', 'suscripcion', 'usuarios']);
    assert.deepEqual(ficha.cifras, { proyectos: 0, recursos: 0, apus: 0 });
    assert.deepEqual(ficha.usuarios.map((u: { email: string; rolTipo: string }) => u.rolTipo).sort(), ['ADMIN', 'PERSONALIZADO']);
    assert.equal(ficha.suscripcion.estado, 'EN_PRUEBA');
    assert.equal(ficha.empresa.suspendida, false);
  });

  test('una empresa que no existe, o algo que no es un id, da el mismo 404', async () => {
    const a = await panel('GET', '/empresas/01900000-0000-7000-8000-000000000000', cookie);
    const b = await panel('GET', '/empresas/no-es-un-id', cookie);
    assert.deepEqual([a.estado, a.crudo], [404, b.crudo]);
  });

  test('el resumen: por vencer en 7 días y pruebas vencidas sin convertir', async () => {
    const pronto = await registrar('Constructora Vence Pronto', '900000422-2', 'panel.pronto@construsoft.test');
    await moverVencimiento(pronto.contexto.tenantId, 3);
    const vencida = await registrar('Constructora Prueba Vencida', '900000423-3', 'panel.vencida@construsoft.test');
    await moverVencimiento(vencida.contexto.tenantId, -2);

    const r = await panel('GET', '/resumen', cookie);
    assert.equal(r.estado, 200);
    const resumen = r.cuerpo;
    assert.ok(resumen.porVencer.some((f: { id: string; diasRestantes: number }) => f.id === pronto.contexto.tenantId && f.diasRestantes === 3));
    assert.ok(resumen.pruebasSinConvertir.some((f: { id: string }) => f.id === vencida.contexto.tenantId));
    assert.ok(!resumen.porVencer.some((f: { id: string }) => f.id === vencida.contexto.tenantId));
    assert.ok(resumen.empresas.total >= 2 && resumen.empresas.vencidas >= 1);
    assert.match(resumen.ingresosDelMes, /^\d+(\.\d+)?$/);
    assert.equal(resumen.moneda, 'COP');
  });
});

describe('las acciones del panel van firmadas (D-72)', () => {
  let cookie: string;
  before(async () => {
    cookie = await superadmin('panel.acciones@construsoft.test', 'Ana Acciones');
  });

  /** El evento más reciente de la empresa. */
  async function ultimoEvento(tenantId: string) {
    return (await panel('GET', `/eventos?empresaId=${tenantId}`, cookie)).cuerpo.eventos[0];
  }

  test('suspender exige motivo, corta el acceso de la empresa y queda firmado; reactivar lo devuelve', async () => {
    const e = await registrar('Constructora Suspendida', '900000424-4', 'panel.suspendida@construsoft.test');
    const sinMotivo = await panel('POST', `/empresas/${e.contexto.tenantId}/suspender`, cookie, { motivo: '  ' });
    assert.deepEqual([sinMotivo.estado, sinMotivo.cuerpo.campo], [422, 'motivo']);

    const r = await panel('POST', `/empresas/${e.contexto.tenantId}/suspender`, cookie, { motivo: 'Uso indebido reportado' });
    assert.equal(r.estado, 200, r.crudo);
    assert.equal(r.cuerpo.empresa.suspendida, true);
    assert.equal(r.cuerpo.suscripcion.estado, 'EN_PRUEBA', 'suspender no toca la suscripción');
    assert.equal((await pedir('/api/sesion', e.cookie)).json<{ suscripcion: { estado: string } }>().suscripcion.estado, 'SUSPENDIDA');
    assert.deepEqual(
      (({ tipo, justificacion, autor }) => ({ tipo, justificacion, autor }))(await ultimoEvento(e.contexto.tenantId)),
      { tipo: 'TENANT_SUSPENDIDO', justificacion: 'Uso indebido reportado', autor: 'Ana Acciones' },
    );
    assert.equal((await panel('POST', `/empresas/${e.contexto.tenantId}/suspender`, cookie, { motivo: 'otra vez' })).estado, 422);

    const devuelta = await panel('POST', `/empresas/${e.contexto.tenantId}/reactivar`, cookie, { motivo: 'Aclarado con el cliente' });
    assert.equal(devuelta.cuerpo.empresa.suspendida, false);
    assert.equal((await ultimoEvento(e.contexto.tenantId)).tipo, 'TENANT_REACTIVADO');
  });

  test('cambiar plan y vencimiento: fecha pasada es 422 en venceEl; el plan menor lo frena la base; queda firmado', async () => {
    const e = await registrar('Constructora Cambia Plan', '900000425-5', 'panel.plan@construsoft.test');
    await asistenteCon(e, 'panel.plan.asistente@construsoft.test', []);
    const ruta = `/empresas/${e.contexto.tenantId}/suscripcion`;

    const pasada = await panel('PUT', ruta, cookie, { planCodigo: 'EMPRESARIAL', venceEl: '2020-01-01', motivo: 'x' });
    assert.deepEqual([pasada.estado, pasada.cuerpo.campo], [422, 'venceEl']);
    const menor = await panel('PUT', ruta, cookie, { planCodigo: 'PERSONAL', venceEl: '2099-01-31', motivo: 'Pidió bajar de plan' });
    assert.equal(menor.estado, 422);
    assert.match(menor.cuerpo.mensaje, /^El plan PERSONAL .*\(D-26/);

    const r = await panel('PUT', ruta, cookie, { planCodigo: 'EMPRESARIAL', venceEl: '2099-01-31', motivo: 'Cortesía comercial' });
    assert.equal(r.estado, 200, r.crudo);
    assert.equal(r.cuerpo.suscripcion.venceEl, '2099-01-31');
    const evento = await ultimoEvento(e.contexto.tenantId);
    assert.deepEqual([evento.tipo, evento.justificacion, evento.autor], ['PLAN_CAMBIADO', 'Cortesía comercial', 'Ana Acciones']);
    assert.match(evento.descripcion, /Vencimiento .* → 2099-01-31/);
  });

  test('registrar un pago: la propuesta la da la base, el comprobante se sube aparte y el pago activa la suscripción', async () => {
    const e = await registrar('Constructora Paga', '900000426-6', 'panel.paga@construsoft.test');
    const base = `/empresas/${e.contexto.tenantId}`;
    const propuesta = await panel('GET', `${base}/pagos/propuesta?periodoMeses=12`, cookie);
    assert.match(propuesta.cuerpo.cubreHasta, /^\d{4}-\d{2}-\d{2}$/);

    const subir = (archivo: Buffer) =>
      app.inject({ method: 'POST', url: '/api/superadmin/soportes', remoteAddress: otraIp(), headers: { cookie, 'content-type': 'application/octet-stream' }, payload: archivo });
    const pdf = Buffer.from('%PDF-1.4 comprobante');
    const soporte = await subir(pdf);
    assert.equal(soporte.statusCode, 201, soporte.body);
    const soporteId = soporte.json<{ id: string }>().id;
    assert.equal((await subir(Buffer.from('<svg/>'))).statusCode, 422);
    assert.equal((await subir(Buffer.concat([pngDeUnPixel(1, 1, 1), Buffer.alloc(5 * 1024 * 1024)]))).statusCode, 413);
    const leido = await panel('GET', `/soportes/${soporteId}`, cookie);
    assert.deepEqual([leido.respuesta.headers['content-type'], leido.respuesta.headers['x-content-type-options']], ['application/pdf', 'nosniff']);
    assert.deepEqual(leido.respuesta.rawPayload, pdf);

    const pago = { fecha: '2026-10-11', concepto: 'Plan Empresarial anual', monto: '1200000', metodo: 'TRANSFERENCIA', referencia: 'TRX-1', soporteId };
    const pasado = await panel('POST', `${base}/pagos`, cookie, { ...pago, periodoMeses: null, cubreHasta: '2020-01-01' });
    assert.deepEqual([pasado.estado, pasado.cuerpo.campo], [422, 'cubreHasta']);
    const ninguno = await panel('POST', `${base}/pagos`, cookie, { ...pago, periodoMeses: null, cubreHasta: null });
    assert.equal(ninguno.estado, 422);

    const r = await panel('POST', `${base}/pagos`, cookie, { ...pago, periodoMeses: 12, cubreHasta: null });
    assert.equal(r.estado, 201, r.crudo);
    assert.deepEqual([r.cuerpo.suscripcion.estado, r.cuerpo.suscripcion.venceEl], ['ACTIVA', propuesta.cuerpo.cubreHasta]);
    const [registrado] = r.cuerpo.pagos;
    assert.deepEqual(
      [registrado.monto, registrado.cubreHasta, registrado.soporteId, registrado.registradoPor],
      ['1200000.000000', propuesta.cuerpo.cubreHasta, soporteId, 'Ana Acciones'],
    );
    assert.equal(r.cuerpo.eliminableDesde, null, 'una empresa que pagó no se elimina');

    const delMes = (await panel('GET', '/pagos?desde=2026-10-01&hasta=2026-10-31', cookie)).cuerpo;
    assert.ok(delMes.pagos.some((p: { id: string }) => p.id === registrado.id));
    assert.match(delMes.total, /^\d+(\.\d+)?$/);
  });

  test('cancelar es comercial: la suscripción queda CANCELADA, firmada, y ya no admite pagos', async () => {
    const e = await registrar('Constructora Cancela', '900000427-7', 'panel.cancela@construsoft.test');
    const r = await panel('POST', `/empresas/${e.contexto.tenantId}/suscripcion/cancelar`, cookie, { motivo: 'No renovó' });
    assert.equal(r.estado, 200, r.crudo);
    assert.deepEqual([r.cuerpo.suscripcion.estado, r.cuerpo.suscripcion.canceladaMotivo], ['CANCELADA', 'No renovó']);
    const evento = await ultimoEvento(e.contexto.tenantId);
    assert.deepEqual([evento.tipo, evento.autor], ['SUSCRIPCION_CANCELADA', 'Ana Acciones']);
    assert.equal((await panel('GET', `/empresas/${e.contexto.tenantId}/pagos/propuesta?periodoMeses=1`, cookie)).estado, 422);
  });

  test('designar administrador: un correo nuevo nace PENDIENTE con el rol de administrador; la justificación es obligatoria', async () => {
    const e = await registrar('Constructora Designa', '900000428-8', 'panel.designa@construsoft.test');
    const ruta = `/empresas/${e.contexto.tenantId}/administrador`;
    const sin = await panel('POST', ruta, cookie, { email: 'panel.nuevo.admin@construsoft.test', nombre: 'Nuevo', justificacion: '' });
    assert.deepEqual([sin.estado, sin.cuerpo.campo], [422, 'justificacion']);

    const r = await panel('POST', ruta, cookie, { email: 'panel.nuevo.admin@construsoft.test', nombre: 'Nuevo Admin', justificacion: 'Videollamada con cédula' });
    assert.equal(r.estado, 200, r.crudo);
    const nuevo = r.cuerpo.usuarios.find((u: { email: string }) => u.email === 'panel.nuevo.admin@construsoft.test');
    assert.deepEqual([nuevo.estado, nuevo.rolTipo], ['PENDIENTE', 'ADMIN']);
    const evento = await ultimoEvento(e.contexto.tenantId);
    assert.deepEqual([evento.tipo, evento.justificacion, evento.autor], ['ADMIN_DESIGNADO', 'Videollamada con cédula', 'Ana Acciones']);
  });

  // Eliminar vive en cicloDeSuscripcion.test.ts, con la purga: los dos se
  // llevan empresas eliminables, y en archivos distintos correrían a la vez.
});
