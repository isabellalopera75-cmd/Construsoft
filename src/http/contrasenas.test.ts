import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PARAMETROS_ARGON2,
  hashearContrasena,
  necesitaRehash,
  parametrosDelHash,
  verificarContrasena,
} from './contrasenas.js';

describe('contraseñas: Argon2id con los parámetros del documento 04 §8.2', () => {
  test('los parámetros son los que fija el árbitro: 19456 KiB, 2 iteraciones, paralelismo 1, 32 bytes, sal de 16', () => {
    assert.deepEqual(PARAMETROS_ARGON2, { memoria: 19456, iteraciones: 2, paralelismo: 1, salida: 32, sal: 16 });
  });

  test('un hash nuevo lleva exactamente esos parámetros, leídos del propio hash', async () => {
    const hash = await hashearContrasena('una contraseña larga');
    assert.match(hash, /^\$argon2id\$v=19\$/);
    assert.deepEqual(parametrosDelHash(hash), PARAMETROS_ARGON2);
  });

  test('verifica la correcta y rechaza la incorrecta', async () => {
    const hash = await hashearContrasena('correcta-123');
    assert.equal(await verificarContrasena(hash, 'correcta-123'), true);
    assert.equal(await verificarContrasena(hash, 'incorrecta-123'), false);
  });

  test('sin hash —el correo no existe— igual se gasta un Argon2 completo con los mismos parámetros, y responde falso', async () => {
    const inicio = process.hrtime.bigint();
    assert.equal(await verificarContrasena(null, 'cualquiera-123'), false);
    const sinHash = process.hrtime.bigint() - inicio;

    const real = await hashearContrasena('cualquiera-123');
    const otro = process.hrtime.bigint();
    await verificarContrasena(real, 'otra-cosa-123');
    const conHash = process.hrtime.bigint() - otro;

    // No es un cronómetro fino: es la garantía de que el camino sin usuario
    // también hace el trabajo de Argon2 y no responde en microsegundos.
    assert.ok(sinHash * 4n > conHash, `sin hash tardó ${sinHash} ns y con hash ${conHash} ns`);
  });

  test('el hash falso usa los mismos parámetros que los reales: si se separan, el tiempo vuelve a delatar los correos', async () => {
    const { HASH_FALSO_PARA_PRUEBAS } = await import('./contrasenas.js');
    assert.deepEqual(parametrosDelHash(await HASH_FALSO_PARA_PRUEBAS()), PARAMETROS_ARGON2);
  });

  test('necesitaRehash: sí con parámetros viejos, no con los actuales', async () => {
    assert.equal(necesitaRehash(await hashearContrasena('x-12345678')), false);
    const viejo = '$argon2id$v=19$m=4096,t=3,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g';
    assert.equal(necesitaRehash(viejo), true);
    assert.equal(necesitaRehash('esto-no-es-un-hash'), true);
  });
});
