import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { CARPETA_LEGAL_DE_PRUEBA, VERSION_TERMINOS_DE_PRUEBA } from '../pruebas/clienteHttp.js';
import { construirServidor } from './servidor.js';

/*
 * Lo que pide el despliegue de prueba en Dokploy (bitácora del producto, 21 de
 * octubre de 2026): que un error inesperado deje rastro en el registro del
 * contenedor, y que el dueño pueda ver qué IP le atribuye la API a una
 * petición detrás de Traefik.
 */

const opciones = { carpetaLegal: CARPETA_LEGAL_DE_PRUEBA, secretoSesion: randomBytes(32).toString('hex'), versionTerminos: VERSION_TERMINOS_DE_PRUEBA };

describe('los errores inesperados van al registro, sin datos de la petición (04 §6)', () => {
  let app: FastifyInstance;
  const lineas: string[] = [];

  before(async () => {
    app = await construirServidor({ ...opciones, registrarError: (linea) => lineas.push(linea) });
    app.post('/api/prueba-500/:id', async () => {
      throw new Error('falla de prueba');
    });
  });
  after(async () => {
    await app.close();
  });

  test('un 500 escribe una línea con la hora, el método, la ruta y el error; ni el cuerpo, ni la consulta, ni los ids', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/prueba-500/0d6f7c1e-0000-4000-8000-000000000001?correo=persona@ejemplo.co',
      payload: { contrasena: 'no-debe-salir' },
    });
    assert.equal(r.statusCode, 500);
    assert.equal(lineas.length, 1);
    const registro = JSON.parse(lineas[0]!);
    assert.match(registro.hora, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    assert.deepEqual([registro.metodo, registro.ruta, registro.estado], ['POST', '/api/prueba-500/:id', 500]);
    assert.match(registro.error, /falla de prueba/);
    for (const dato of ['no-debe-salir', 'persona@ejemplo.co', '0d6f7c1e']) assert.ok(!lineas[0]!.includes(dato), dato);
  });

  test('un rechazo esperado (401, 422…) no es un error: no escribe nada', async () => {
    lineas.length = 0;
    assert.equal((await app.inject({ method: 'GET', url: '/api/sesion' })).statusCode, 401);
    assert.deepEqual(lineas, []);
  });
});

describe('GET /api/diagnostico/ip: la IP que la API le atribuye a quien pregunta', () => {
  let sinProxy: FastifyInstance;
  let conProxy: FastifyInstance;

  before(async () => {
    sinProxy = await construirServidor(opciones);
    conProxy = await construirServidor({ ...opciones, proxiesDeConfianza: ['10.0.0.0/8'] });
  });
  after(async () => {
    await sinProxy.close();
    await conProxy.close();
  });

  const preguntar = async (app: FastifyInstance, desde: string, reenviadaPor?: string) =>
    (
      await app.inject({ method: 'GET', url: '/api/diagnostico/ip', remoteAddress: desde, ...(reenviadaPor ? { headers: { 'x-forwarded-for': reenviadaPor } } : {}) })
    ).json<{ ip: string }>();

  test('sin proxy, la de la conexión, aunque la petición traiga X-Forwarded-For', async () => {
    assert.deepEqual(await preguntar(sinProxy, '203.0.113.7', '198.51.100.9'), { ip: '203.0.113.7' });
  });

  test('detrás del proxy de confianza, la que él reenvía; desde fuera de esa red, la cabecera no se cree', async () => {
    assert.deepEqual(await preguntar(conProxy, '10.0.1.5', '198.51.100.9'), { ip: '198.51.100.9' });
    assert.deepEqual(await preguntar(conProxy, '203.0.113.7', '198.51.100.9'), { ip: '203.0.113.7' });
  });
});
