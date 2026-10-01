import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { ejecutarConPermiso, type ContextoTenant } from '../infraestructura/basedatos/contextoTenant.js';
import { autenticar } from '../infraestructura/basedatos/autenticacion.js';
import { crearPresupuesto } from '../infraestructura/basedatos/presupuesto.js';
import { comoSuperusuario, vencerSuscripcion } from '../pruebas/superusuario.js';
import { hashearContrasena, parametrosDelHash, PARAMETROS_ARGON2 } from './contrasenas.js';
import { NOMBRE_COOKIE } from './sesion.js';
import { generarToken } from './tokens.js';
import { construirServidor } from './servidor.js';

const VERSION_TERMINOS = 'terminos-2026-10-01';
let app: FastifyInstance;
let ipSecuencia = 0;
/** Cada prueba usa su propia IP: el límite por IP de una no contamina a otra. */
const otraIp = () => `10.0.${Math.floor(ipSecuencia / 250)}.${(ipSecuencia++ % 250) + 1}`;

function cookieDe(respuesta: LightMyRequestResponse): string | undefined {
  const c = respuesta.cookies.find((x) => x.name === NOMBRE_COOKIE);
  return c && c.value !== '' ? `${NOMBRE_COOKIE}=${c.value}` : undefined;
}

function borraLaCookie(respuesta: LightMyRequestResponse): boolean {
  const c = respuesta.cookies.find((x) => x.name === NOMBRE_COOKIE);
  return c !== undefined && (c.value === '' || (c.expires !== undefined && c.expires.getTime() <= Date.now()));
}

interface Cuenta {
  email: string;
  contrasena: string;
  cookie: string;
  contexto: ContextoTenant;
}

async function registrar(razonSocial: string, nit: string, email: string, contrasena = 'contrasena-segura-1'): Promise<Cuenta> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/registro',
    remoteAddress: otraIp(),
    payload: {
      nombre: `Admin de ${razonSocial}`,
      email,
      contrasena,
      razonSocial,
      nit,
      plan: 'EMPRESARIAL',
      aceptaTerminos: true,
      versionTerminos: VERSION_TERMINOS,
    },
  });
  assert.equal(r.statusCode, 201, r.body);
  const yo = (await autenticar(email))!;
  return { email, contrasena, cookie: cookieDe(r)!, contexto: { tenantId: yo.tenantId, usuarioId: yo.usuarioId } };
}

const ingresar = (email: string, contrasena: string, ip = otraIp()) =>
  app.inject({ method: 'POST', url: '/api/sesion', remoteAddress: ip, payload: { email, contrasena } });

const pedir = (url: string, cookie?: string) =>
  app.inject({ method: 'GET', url, remoteAddress: otraIp(), ...(cookie ? { headers: { cookie } } : {}) });

before(async () => {
  app = await construirServidor({ secretoSesion: randomBytes(32).toString('hex'), versionTerminos: VERSION_TERMINOS });
});
after(async () => {
  await app.close();
});

describe('registro (02 §3.1) con la aceptación de los términos (Ley 1581, 04 §7)', () => {
  test('crea la empresa, firma los términos con su versión, y deja la sesión abierta con la cookie correcta', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/registro',
      remoteAddress: otraIp(),
      payload: {
        nombre: 'Rosa Registro',
        email: 'http.rosa@construsoft.test',
        contrasena: 'contrasena-segura-1',
        razonSocial: 'Constructora HTTP Registro',
        nit: '900000200-0',
        plan: 'PERSONAL',
        aceptaTerminos: true,
        versionTerminos: VERSION_TERMINOS,
      },
    });
    assert.equal(r.statusCode, 201, r.body);
    const cookie = r.cookies.find((c) => c.name === NOMBRE_COOKIE)!;
    assert.deepEqual(
      { httpOnly: cookie.httpOnly, secure: cookie.secure, sameSite: cookie.sameSite, path: cookie.path, maxAge: cookie.maxAge },
      { httpOnly: true, secure: true, sameSite: 'Strict', path: '/', maxAge: 8 * 60 * 60 },
    );
    const yo = (await autenticar('http.rosa@construsoft.test'))!;
    const terminos = await comoSuperusuario(async (c) => {
      const { rows } = await c.query<{ acepto: boolean; version: string }>(
        'SELECT acepto_terminos_en IS NOT NULL AS acepto, version_terminos AS version FROM plataforma.tenant WHERE id = $1',
        [yo.tenantId],
      );
      return rows[0];
    });
    assert.deepEqual(terminos, { acepto: true, version: VERSION_TERMINOS });
    assert.match(yo.passwordHash!, /^\$argon2id\$/);
    assert.deepEqual(parametrosDelHash(yo.passwordHash!), PARAMETROS_ARGON2);
  });

  test('sin aceptar los términos no hay empresa', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/registro',
      remoteAddress: otraIp(),
      payload: {
        nombre: 'Sin Aceptar',
        email: 'http.sin.aceptar@construsoft.test',
        contrasena: 'contrasena-segura-1',
        razonSocial: 'Constructora Sin Aceptar',
        nit: '900000201-1',
        plan: 'PERSONAL',
        aceptaTerminos: false,
        versionTerminos: VERSION_TERMINOS,
      },
    });
    assert.equal(r.statusCode, 422);
    assert.equal(await autenticar('http.sin.aceptar@construsoft.test'), null);
  });

  test('si los términos cambiaron desde que se abrió el formulario, se rechaza con 409 y no hay empresa', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/registro',
      remoteAddress: otraIp(),
      payload: {
        nombre: 'Version Vieja',
        email: 'http.version.vieja@construsoft.test',
        contrasena: 'contrasena-segura-1',
        razonSocial: 'Constructora Version Vieja',
        nit: '900000202-2',
        plan: 'PERSONAL',
        aceptaTerminos: true,
        versionTerminos: 'terminos-2025-01-01',
      },
    });
    assert.equal(r.statusCode, 409);
    assert.match(r.json<{ mensaje: string }>().mensaje, /términos cambiaron/);
    assert.equal(await autenticar('http.version.vieja@construsoft.test'), null);
  });

  test('una contraseña de menos de 8 caracteres se rechaza y no hay empresa (04 §5)', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/registro',
      remoteAddress: otraIp(),
      payload: {
        nombre: 'Corta',
        email: 'http.corta@construsoft.test',
        contrasena: 'corta',
        razonSocial: 'Constructora Corta',
        nit: '900000203-3',
        plan: 'PERSONAL',
        aceptaTerminos: true,
        versionTerminos: VERSION_TERMINOS,
      },
    });
    assert.equal(r.statusCode, 422);
    assert.equal(await autenticar('http.corta@construsoft.test'), null);
  });
});

describe('ingreso (02 §3.2, 04 §8.2) y su límite de intentos (04 §5)', () => {
  let cuenta: Cuenta;

  before(async () => {
    cuenta = await registrar('Constructora HTTP Ingreso', '900000210-0', 'http.ingreso@construsoft.test');
  });

  test('con la contraseña correcta abre sesión y el arranque la reconoce', async () => {
    const r = await ingresar(cuenta.email, cuenta.contrasena);
    assert.equal(r.statusCode, 200, r.body);
    const arranque = await pedir('/api/sesion', cookieDe(r));
    assert.equal(arranque.statusCode, 200);
    assert.equal(arranque.json<{ razonSocial: string }>().razonSocial, 'Constructora HTTP Ingreso');
  });

  test('«no existe» y «existe con otra contraseña» responden exactamente igual', async () => {
    const mala = await ingresar(cuenta.email, 'otra-contrasena-1');
    const nadie = await ingresar('http.nadie@construsoft.test', 'otra-contrasena-1');
    assert.deepEqual([mala.statusCode, mala.body], [nadie.statusCode, nadie.body]);
    assert.equal(mala.statusCode, 401);
    assert.equal(cookieDe(mala), undefined);
  });

  test('cinco fallos con un correo bloquean ese correo: el sexto, aun con la contraseña correcta, es 429 con Retry-After', async () => {
    const victima = await registrar('Constructora HTTP Bloqueo', '900000211-1', 'http.bloqueo@construsoft.test');
    for (let i = 0; i < 5; i += 1) assert.equal((await ingresar(victima.email, 'mala-contrasena-1')).statusCode, 401);
    const correcta = await ingresar(victima.email, victima.contrasena);
    assert.equal(correcta.statusCode, 429);
    assert.equal(cookieDe(correcta), undefined);
    assert.ok(Number(correcta.headers['retry-after']) > 0);
    assert.match(correcta.json<{ mensaje: string }>().mensaje, /Demasiados intentos/);
  });

  test('un correo que no existe se bloquea igual: el bloqueo no delata qué correos tienen cuenta', async () => {
    for (let i = 0; i < 5; i += 1) await ingresar('http.fantasma@construsoft.test', 'mala-contrasena-1');
    assert.equal((await ingresar('http.fantasma@construsoft.test', 'mala-contrasena-1')).statusCode, 429);
  });

  test('veinte fallos desde una IP la bloquean, aunque cada intento use un correo distinto', async () => {
    const ip = otraIp();
    for (let i = 0; i < 20; i += 1) await ingresar(`http.serie.${i}@construsoft.test`, 'mala-contrasena-1', ip);
    assert.equal((await ingresar(cuenta.email, cuenta.contrasena, ip)).statusCode, 429);
    assert.equal((await ingresar(cuenta.email, cuenta.contrasena, otraIp())).statusCode, 200);
  });

  test('un usuario PENDIENTE recibe su propio aviso: la concesión de 04 §8.2', async () => {
    await ejecutarConPermiso(cuenta.contexto, 'USUARIOS.GESTIONAR', async (c) => {
      const { rows } = await c.query<{ id: string }>(`SELECT id FROM app.rol WHERE tenant_id = $1 AND tipo = 'ASISTENTE'`, [
        cuenta.contexto.tenantId,
      ]);
      await c.query(
        `INSERT INTO app.usuario (tenant_id, rol_id, nombre, email, estado) VALUES ($1, $2, 'Pedro Pendiente', 'http.pendiente@construsoft.test', 'PENDIENTE')`,
        [cuenta.contexto.tenantId, rows[0]!.id],
      );
    });
    const r = await ingresar('http.pendiente@construsoft.test', 'cualquiera-1');
    assert.equal(r.statusCode, 403);
    assert.match(r.json<{ mensaje: string }>().mensaje, /enlace de activación/);
  });

  test('un hash con parámetros viejos se rehace al ingresar, y la sesión abierta en ese mismo ingreso sigue valiendo', async () => {
    const vieja = await registrar('Constructora HTTP Rehash', '900000212-2', 'http.rehash@construsoft.test');
    const { hash } = await import('@node-rs/argon2');
    const hashViejo = await hash(vieja.contrasena, { memoryCost: 4096, timeCost: 3, parallelism: 1 });
    await ejecutarConPermiso(vieja.contexto, 'USUARIOS.GESTIONAR', (c) =>
      c.query('UPDATE app.usuario SET password_hash = $1 WHERE id = $2', [hashViejo, vieja.contexto.usuarioId]),
    );

    const r = await ingresar(vieja.email, vieja.contrasena);
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(parametrosDelHash((await autenticar(vieja.email))!.passwordHash!), PARAMETROS_ARGON2);
    // El rehash movió el sello: si la cookie llevara el de antes, esto sería 401.
    assert.equal((await pedir('/api/sesion', cookieDe(r))).statusCode, 200);
  });
});

describe('la sesión: sello, vencimiento, firma y cierre (04 §8.1, D-67)', () => {
  test('cambiar la contraseña invalida TODAS las cookies anteriores; la sesión nueva funciona', async () => {
    const cuenta = await registrar('Constructora HTTP Sello', '900000220-0', 'http.sello@construsoft.test');
    const otraCookie = cookieDe(await ingresar(cuenta.email, cuenta.contrasena))!;
    assert.equal((await pedir('/api/sesion', cuenta.cookie)).statusCode, 200);

    const nueva = 'contrasena-nueva-1';
    const hashNuevo = await hashearContrasena(nueva);
    await ejecutarConPermiso(cuenta.contexto, 'USUARIOS.GESTIONAR', (c) =>
      c.query('UPDATE app.usuario SET password_hash = $1 WHERE id = $2', [hashNuevo, cuenta.contexto.usuarioId]),
    );

    for (const vieja of [cuenta.cookie, otraCookie]) {
      const r = await pedir('/api/sesion', vieja);
      assert.equal(r.statusCode, 401);
      assert.ok(borraLaCookie(r), 'una cookie vieja no se borró');
    }
    const fresca = await ingresar(cuenta.email, nueva);
    assert.equal((await pedir('/api/sesion', cookieDe(fresca))).statusCode, 200);
  });

  test('sin cookie, con una cookie manipulada o con una vencida: 401', async () => {
    const cuenta = await registrar('Constructora HTTP Firma', '900000221-1', 'http.firma@construsoft.test');
    assert.equal((await pedir('/api/presupuestos')).statusCode, 401);

    const [nombre, valor] = cuenta.cookie.split('=') as [string, string];
    const manipulada = `${nombre}=${valor.slice(0, -2)}${valor.endsWith('AA') ? 'BB' : 'AA'}`;
    assert.equal((await pedir('/api/sesion', manipulada)).statusCode, 401);

    const futuro = await construirServidor({
      secretoSesion: randomBytes(32).toString('hex'),
      versionTerminos: VERSION_TERMINOS,
      ahora: () => Date.now() + 9 * 60 * 60 * 1000,
    });
    try {
      // Firmada con otro secreto, así que también prueba que la firma importa; y el reloj adelantado, el vencimiento.
      assert.equal((await futuro.inject({ method: 'GET', url: '/api/sesion', headers: { cookie: cuenta.cookie } })).statusCode, 401);
    } finally {
      await futuro.close();
    }
  });

  test('cerrar sesión borra la cookie', async () => {
    const cuenta = await registrar('Constructora HTTP Salir', '900000222-2', 'http.salir@construsoft.test');
    const r = await app.inject({ method: 'DELETE', url: '/api/sesion', headers: { cookie: cuenta.cookie } });
    assert.equal(r.statusCode, 204);
    assert.ok(borraLaCookie(r));
  });

  test('una cuenta revocada: la cookie que tenía recibe 403 y se borra (CS003)', async () => {
    const cuenta = await registrar('Constructora HTTP Revocada', '900000223-3', 'http.revocada.admin@construsoft.test');
    const asistente = 'http.revocada@construsoft.test';
    const contrasena = 'contrasena-segura-1';
    const hashAsis = await hashearContrasena(contrasena);
    await ejecutarConPermiso(cuenta.contexto, 'USUARIOS.GESTIONAR', async (c) => {
      const { rows } = await c.query<{ id: string }>(`SELECT id FROM app.rol WHERE tenant_id = $1 AND tipo = 'ASISTENTE'`, [
        cuenta.contexto.tenantId,
      ]);
      await c.query(`INSERT INTO app.rol_permiso (tenant_id, rol_id, permiso_codigo) VALUES ($1, $2, 'PRESUPUESTOS.VER')`, [
        cuenta.contexto.tenantId,
        rows[0]!.id,
      ]);
      await c.query(
        `INSERT INTO app.usuario (tenant_id, rol_id, nombre, email, password_hash, estado) VALUES ($1, $2, 'Asistente', $3, $4, 'ACTIVO')`,
        [cuenta.contexto.tenantId, rows[0]!.id, asistente, hashAsis],
      );
    });
    const cookie = cookieDe(await ingresar(asistente, contrasena))!;
    assert.equal((await pedir('/api/presupuestos', cookie)).statusCode, 200);

    await ejecutarConPermiso(cuenta.contexto, 'USUARIOS.GESTIONAR', (c) =>
      c.query(`UPDATE app.usuario SET estado = 'REVOCADO' WHERE email = $1`, [asistente]),
    );
    const r = await pedir('/api/presupuestos', cookie);
    assert.equal(r.statusCode, 403);
    assert.ok(borraLaCookie(r));
  });
});

describe('aislamiento por HTTP: la empresa A pide un presupuesto de B y recibe 404, no 403 (RN-01)', () => {
  let a: Cuenta;
  let deB: string;

  before(async () => {
    a = await registrar('Constructora HTTP A', '900000230-0', 'http.a@construsoft.test');
    const b = await registrar('Constructora HTTP B', '900000231-1', 'http.b@construsoft.test');
    deB = (
      await crearPresupuesto(b.contexto, { codigo: 'B-SECRETO', nombre: 'Obra de B', ubicacion: 'Cali', modoEstructura: 'ITEMS' })
    ).id;
    await crearPresupuesto(a.contexto, { codigo: 'A-PROPIO', nombre: 'Obra de A', ubicacion: 'Medellín', modoEstructura: 'ITEMS' });
  });

  test('el id de B, un id que no existe y algo que ni es un id dan la MISMA respuesta: 404 y el mismo cuerpo', async () => {
    const ajeno = await pedir(`/api/presupuestos/${deB}`, a.cookie);
    const inexistente = await pedir('/api/presupuestos/00000000-0000-7000-8000-000000000000', a.cookie);
    const basura = await pedir('/api/presupuestos/no-es-un-id', a.cookie);
    assert.equal(ajeno.statusCode, 404);
    assert.deepEqual([ajeno.statusCode, ajeno.body], [inexistente.statusCode, inexistente.body]);
    assert.deepEqual([ajeno.statusCode, ajeno.body], [basura.statusCode, basura.body]);
  });

  test('la vista maestra de A trae lo suyo y nada de B', async () => {
    const r = await pedir('/api/presupuestos', a.cookie);
    assert.equal(r.statusCode, 200);
    assert.deepEqual(r.json<Array<{ codigo: string }>>().map((p) => p.codigo), ['A-PROPIO']);
  });
});

describe('permisos y suscripción vencida (D-65, 04 §8.4)', () => {
  test('un asistente sin PRESUPUESTOS.VER recibe 403 con el mensaje de la base', async () => {
    const cuenta = await registrar('Constructora HTTP Permisos', '900000240-0', 'http.permisos.admin@construsoft.test');
    const contrasena = 'contrasena-segura-1';
    const hashAsis = await hashearContrasena(contrasena);
    await ejecutarConPermiso(cuenta.contexto, 'USUARIOS.GESTIONAR', async (c) => {
      const { rows } = await c.query<{ id: string }>(`SELECT id FROM app.rol WHERE tenant_id = $1 AND tipo = 'ASISTENTE'`, [
        cuenta.contexto.tenantId,
      ]);
      await c.query(
        `INSERT INTO app.usuario (tenant_id, rol_id, nombre, email, password_hash, estado) VALUES ($1, $2, 'Sin permisos', 'http.permisos@construsoft.test', $3, 'ACTIVO')`,
        [cuenta.contexto.tenantId, rows[0]!.id, hashAsis],
      );
    });
    const cookie = cookieDe(await ingresar('http.permisos@construsoft.test', contrasena))!;
    const r = await pedir('/api/presupuestos', cookie);
    assert.equal(r.statusCode, 403);
    assert.match(r.json<{ mensaje: string }>().mensaje, /PRESUPUESTOS\.VER/);
  });

  test('vencida es solo lectura: consultar responde 200, crear responde 402 con el mensaje de la base, y el arranque lo dice', async () => {
    const cuenta = await registrar('Constructora HTTP Vencida', '900000241-1', 'http.vencida@construsoft.test');
    await vencerSuscripcion(cuenta.contexto.tenantId);

    assert.equal((await pedir('/api/presupuestos', cuenta.cookie)).statusCode, 200);
    const crear = await app.inject({
      method: 'POST',
      url: '/api/presupuestos',
      headers: { cookie: cuenta.cookie },
      payload: { codigo: 'V-1', nombre: 'No debería', ubicacion: 'Bogotá', modoEstructura: 'ITEMS' },
    });
    assert.equal(crear.statusCode, 402);
    assert.ok(crear.json<{ mensaje: string }>().mensaje.length > 0);
    const arranque = (await pedir('/api/sesion', cuenta.cookie)).json<{ suscripcion: { estado: string; soloLectura: boolean } }>();
    assert.deepEqual(
      { estado: arranque.suscripcion.estado, soloLectura: arranque.suscripcion.soloLectura },
      { estado: 'VENCIDA', soloLectura: true },
    );
  });

  test('al día, crear desde la vista maestra responde 201', async () => {
    const cuenta = await registrar('Constructora HTTP Al Dia', '900000242-2', 'http.aldia@construsoft.test');
    const r = await app.inject({
      method: 'POST',
      url: '/api/presupuestos',
      headers: { cookie: cuenta.cookie },
      payload: { codigo: 'D-1', nombre: 'Obra nueva', ubicacion: 'Bogotá', modoEstructura: 'ITEMS' },
    });
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json<{ codigo: string; estado: string }>().estado, 'ABIERTO');
  });
});

describe('restablecer la contraseña con un enlace (el procedimiento manual del dueño, 04 §8.5)', () => {
  test('el enlace fija la contraseña nueva, cierra las sesiones anteriores, y no sirve dos veces', async () => {
    const cuenta = await registrar('Constructora HTTP Enlace', '900000250-0', 'http.enlace@construsoft.test');
    const { token, hash } = generarToken();
    await ejecutarConPermiso(cuenta.contexto, 'USUARIOS.GESTIONAR', (c) =>
      c.query(
        `INSERT INTO app.token_recuperacion (tenant_id, usuario_id, proposito, token_hash, expira_en)
         VALUES ($1, $2, 'RECUPERACION', $3, now() + interval '30 minutes')`,
        [cuenta.contexto.tenantId, cuenta.contexto.usuarioId, hash],
      ),
    );

    const usar = () =>
      app.inject({ method: 'POST', url: '/api/recuperacion', remoteAddress: otraIp(), payload: { token, contrasena: 'restablecida-1' } });
    assert.equal((await usar()).statusCode, 204);
    assert.equal((await pedir('/api/sesion', cuenta.cookie)).statusCode, 401);
    assert.equal((await ingresar(cuenta.email, 'restablecida-1')).statusCode, 200);
    const otraVez = await usar();
    assert.equal(otraVez.statusCode, 422);
    assert.match(otraVez.json<{ mensaje: string }>().mensaje, /ya fue usado/);
  });

  test('diez enlaces inválidos desde una IP la bloquean: 429', async () => {
    const ip = otraIp();
    for (let i = 0; i < 10; i += 1) {
      const r = await app.inject({
        method: 'POST',
        url: '/api/recuperacion',
        remoteAddress: ip,
        payload: { token: generarToken().token, contrasena: 'cualquiera-1' },
      });
      assert.equal(r.statusCode, 422);
    }
    const bloqueada = await app.inject({
      method: 'POST',
      url: '/api/recuperacion',
      remoteAddress: ip,
      payload: { token: generarToken().token, contrasena: 'cualquiera-1' },
    });
    assert.equal(bloqueada.statusCode, 429);
  });
});
