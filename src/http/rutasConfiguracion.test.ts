import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { vencerSuscripcion } from '../pruebas/superusuario.js';
import { VERSION_TERMINOS_DE_PRUEBA, clienteDePrueba, cookieDe, type Cuenta } from '../pruebas/clienteHttp.js';
import { construirServidor } from './servidor.js';

let app: FastifyInstance;
const { otraIp, ingresar, registrar, asistenteCon } = clienteDePrueba(() => app);

before(async () => {
  app = await construirServidor({ secretoSesion: randomBytes(32).toString('hex'), versionTerminos: VERSION_TERMINOS_DE_PRUEBA });
});
after(async () => {
  await app.close();
});

async function llamar(metodo: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, cookie: string | undefined, cuerpo?: unknown) {
  const r = await app.inject({
    method: metodo,
    url,
    remoteAddress: otraIp(),
    ...(cookie ? { headers: { cookie } } : {}),
    ...(cuerpo === undefined ? {} : { payload: cuerpo as object }),
  });
  const json = r.body === '' ? {} : r.json<Record<string, unknown>>();
  return { estado: r.statusCode, cuerpo: json as Record<string, any>, crudo: r.body, respuesta: r };
}

describe('Mi cuenta (02 §11.1)', () => {
  test('muestra nombre, correo y rol de quien está en sesión, sin pedir ningún permiso', async () => {
    const duena = await registrar('Constructora Cuenta', '900000350-0', 'cuenta.admin@construsoft.test');
    const r = await llamar('GET', '/api/configuracion/cuenta', duena.cookie);
    assert.deepEqual([r.estado, r.cuerpo], [200, { nombre: 'Admin de Constructora Cuenta', email: 'cuenta.admin@construsoft.test', rol: 'Administrador' }]);
    const sinPermisos = await asistenteCon(duena, 'cuenta.asistente@construsoft.test', []);
    const suya = await llamar('GET', '/api/configuracion/cuenta', sinPermisos);
    assert.deepEqual([suya.estado, suya.cuerpo.email], [200, 'cuenta.asistente@construsoft.test']);
  });

  test('cambiar la contraseña: verifica la actual, cierra las otras sesiones y deja abierta esta', async () => {
    const duena = await registrar('Constructora Clave', '900000351-1', 'clave.admin@construsoft.test');
    const otraSesion = cookieDe(await ingresar(duena.email, duena.contrasena))!;

    const mala = await llamar('POST', '/api/configuracion/cuenta/contrasena', duena.cookie, { actual: 'no-es-esta-1', nueva: 'contrasena-nueva-2' });
    assert.deepEqual([mala.estado, mala.cuerpo.campo], [422, 'actual']);
    const corta = await llamar('POST', '/api/configuracion/cuenta/contrasena', duena.cookie, { actual: duena.contrasena, nueva: 'corta' });
    assert.deepEqual([corta.estado, corta.cuerpo.campo], [422, 'nueva']);

    const r = await llamar('POST', '/api/configuracion/cuenta/contrasena', duena.cookie, { actual: duena.contrasena, nueva: 'contrasena-nueva-2' });
    assert.equal(r.estado, 204, r.crudo);
    const nuevaCookie = cookieDe(r.respuesta)!;
    assert.ok(nuevaCookie);
    assert.equal((await llamar('GET', '/api/sesion', nuevaCookie)).estado, 200);
    assert.equal((await llamar('GET', '/api/sesion', otraSesion)).estado, 401);
    assert.equal((await ingresar(duena.email, 'contrasena-nueva-2')).statusCode, 200);
  });

  test('cinco contraseñas actuales equivocadas bloquean el cambio: la sesión no sirve para adivinar', async () => {
    const duena = await registrar('Constructora Clave Bloqueo', '900000352-2', 'clave.bloqueo@construsoft.test');
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await llamar('POST', '/api/configuracion/cuenta/contrasena', duena.cookie, { actual: `mala-${i}-xxxx`, nueva: 'contrasena-nueva-2' })).estado, 422);
    }
    const bloqueada = await llamar('POST', '/api/configuracion/cuenta/contrasena', duena.cookie, { actual: duena.contrasena, nueva: 'contrasena-nueva-2' });
    assert.equal(bloqueada.estado, 429);
    assert.ok(bloqueada.respuesta.headers['retry-after']);
  });
});

describe('Datos de empresa, preferencias y suscripción (02 §11.2, §11.3, §11.5)', () => {
  let duena: Cuenta;

  before(async () => {
    duena = await registrar('Constructora Config HTTP', '900000353-3', 'config.http@construsoft.test');
  });

  test('datos de empresa: leer y editar los cuatro campos y el correo de recuperación', async () => {
    const antes = await llamar('GET', '/api/configuracion/empresa', duena.cookie);
    assert.deepEqual([antes.estado, antes.cuerpo.razonSocial, antes.cuerpo.nit], [200, 'Constructora Config HTTP', '900000353-3']);
    const datos = { razonSocial: 'Constructora Config HTTP SAS', nit: '900000353-3', direccion: 'Calle 10 # 20-30', telefono: '6045551234', emailRecuperacion: 'recuperar.config@construsoft.test' };
    const r = await llamar('PUT', '/api/configuracion/empresa', duena.cookie, datos);
    assert.deepEqual([r.estado, r.cuerpo], [200, datos]);
  });

  test('un NIT que ya tiene otra empresa: 409 que marca el campo nit', async () => {
    await registrar('Constructora NIT Ocupado', '900000354-4', 'config.ocupado@construsoft.test');
    const r = await llamar('PUT', '/api/configuracion/empresa', duena.cookie, {
      razonSocial: 'X', nit: '900000354-4', direccion: null, telefono: null, emailRecuperacion: null,
    });
    assert.deepEqual([r.estado, r.cuerpo.campo], [409, 'nit']);
  });

  test('preferencias: separadores y decimales de vista; el arranque ve el formato nuevo', async () => {
    const leidas = await llamar('GET', '/api/configuracion/preferencias', duena.cookie);
    assert.equal(leidas.estado, 200);
    const r = await llamar('PUT', '/api/configuracion/preferencias', duena.cookie, { ...leidas.cuerpo, separadorMiles: ',', separadorDecimal: '.', decimalesVista: 0 });
    assert.equal(r.estado, 200, r.crudo);
    assert.deepEqual((await llamar('GET', '/api/sesion', duena.cookie)).cuerpo.formatoNumerico, { separadorMiles: ',', separadorDecimal: '.', decimalesVista: 0 });
    const tres = await llamar('PUT', '/api/configuracion/preferencias', duena.cookie, { ...leidas.cuerpo, decimalesVista: 3 });
    assert.deepEqual([tres.estado, tres.cuerpo.campo], [422, 'decimalesVista']);
  });

  test('suscripción: estado, plan y vencimiento; vencida se consulta igual', async () => {
    const r = await llamar('GET', '/api/configuracion/suscripcion', duena.cookie);
    assert.deepEqual([r.estado, r.cuerpo.estado, r.cuerpo.plan, r.cuerpo.pagos], [200, 'EN_PRUEBA', 'EMPRESARIAL', []]);
    assert.match(r.cuerpo.venceEl, /^\d{4}-\d{2}-\d{2}$/);
    const vencida = await registrar('Constructora Config Vencida HTTP', '900000355-5', 'config.vencida@construsoft.test');
    await vencerSuscripcion(vencida.contexto.tenantId);
    assert.equal((await llamar('GET', '/api/configuracion/suscripcion', vencida.cookie)).cuerpo.estado, 'VENCIDA');
  });

  test('sin el permiso de cada pestaña: 403 con su nombre', async () => {
    const sinNada = await asistenteCon(duena, 'config.sinnada@construsoft.test', []);
    for (const [url, permiso] of [
      ['/api/configuracion/empresa', 'CONFIG.EMPRESA'],
      ['/api/configuracion/preferencias', 'CONFIG.PREFERENCIAS'],
      ['/api/configuracion/unidades', 'CONFIG.PREFERENCIAS'],
      ['/api/configuracion/suscripcion', 'CONFIG.SUSCRIPCION'],
    ] as const) {
      const r = await llamar('GET', url, sinNada);
      assert.equal(r.estado, 403, url);
      assert.match(r.cuerpo.mensaje, new RegExp(permiso.replace('.', '\\.')));
    }
  });
});

describe('Unidades de medida (02 §11.6)', () => {
  test('crear, editar, el duplicado sin distinguir mayúsculas, y eliminar solo si nadie la usa', async () => {
    const duena = await registrar('Constructora Unidades HTTP', '900000356-6', 'unidades.http@construsoft.test');
    const creada = await llamar('POST', '/api/configuracion/unidades', duena.cookie, { simbolo: 'plg', descripcion: 'Pulgada' });
    assert.deepEqual([creada.estado, creada.cuerpo.simbolo], [201, 'plg']);
    const editada = await llamar('PUT', `/api/configuracion/unidades/${creada.cuerpo.id}`, duena.cookie, { simbolo: 'plg', descripcion: 'Pulgada inglesa' });
    assert.deepEqual([editada.estado, editada.cuerpo.descripcion], [200, 'Pulgada inglesa']);
    const duplicada = await llamar('POST', '/api/configuracion/unidades', duena.cookie, { simbolo: 'KG', descripcion: 'x' });
    assert.deepEqual([duplicada.estado, duplicada.cuerpo.campo], [409, 'simbolo']);

    const usada = (await llamar('GET', '/api/configuracion/unidades', duena.cookie)).cuerpo.unidades.find((u: { simbolo: string }) => u.simbolo === 'Kg');
    await llamar('POST', '/api/recursos', duena.cookie, {
      nombre: 'Acero', tipo: 'MATERIAL', unidadId: usada.id, precioBase: '1', ivaPct: '0', precioTotal: '1', viaCaptura: 'BASE',
    });
    const enUso = await llamar('DELETE', `/api/configuracion/unidades/${usada.id}`, duena.cookie);
    assert.equal(enUso.estado, 422);
    assert.match(enUso.cuerpo.mensaje, /«Kg» está en uso en 1 recurso/);

    assert.equal((await llamar('DELETE', `/api/configuracion/unidades/${creada.cuerpo.id}`, duena.cookie)).estado, 204);
  });

  test('aislamiento: editar o eliminar una unidad de B responde lo mismo que una que no existe, y B queda intacta', async () => {
    const a = await registrar('Constructora Unidades A', '900000357-7', 'unidades.a@construsoft.test');
    const b = await registrar('Constructora Unidades B', '900000358-8', 'unidades.b@construsoft.test');
    const deB = (await llamar('POST', '/api/configuracion/unidades', b.cookie, { simbolo: 'bulto', descripcion: 'Bulto' })).cuerpo;
    for (const [metodo, cuerpo] of [
      ['PUT', { simbolo: 'x', descripcion: 'x' }],
      ['DELETE', undefined],
    ] as const) {
      const ajena = await llamar(metodo, `/api/configuracion/unidades/${deB.id}`, a.cookie, cuerpo);
      assert.equal(ajena.estado, 404, ajena.crudo);
      for (const id of ['01900000-0000-7000-8000-000000000000', 'no-es-un-id']) {
        const otra = await llamar(metodo, `/api/configuracion/unidades/${id}`, a.cookie, cuerpo);
        assert.deepEqual([otra.estado, otra.crudo], [ajena.estado, ajena.crudo]);
      }
    }
    const deBDespues = (await llamar('GET', '/api/configuracion/unidades', b.cookie)).cuerpo.unidades.find((u: { id: string }) => u.id === deB.id);
    assert.deepEqual(deBDespues, deB);
  });
});
