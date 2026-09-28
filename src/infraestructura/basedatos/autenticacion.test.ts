import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { autenticar, resolverToken } from './autenticacion.js';

/**
 * Fixture de esta prueba: una empresa real (fn_alta_tenant) y un token de
 * recuperación real, sembrados con el rol SUPERUSER de pruebas — la misma
 * razón que en contextoTenant.test.ts: bypassea RLS para poder leer lo que
 * acaba de insertar. Valores fijos (no sufijos aleatorios): construsoft_test
 * se rehace desde cero antes de cada suite (scripts/resetear-base-pruebas.sh).
 *
 * Distintos del email/NIT que usa contextoTenant.test.ts, porque ambos
 * archivos pueden correr contra la misma construsoft_test en la misma
 * corrida y email/token_hash son UNIQUE.
 */
const EMAIL = 'carla@construsoft.test';
const TOKEN_HASH = 'hash_de_token_de_prueba_no_real';

const poolSuperusuario = new Pool({
  host: process.env.TEST_SUPERUSER_HOST,
  port: Number(process.env.TEST_SUPERUSER_PORT ?? 5432),
  database: process.env.TEST_SUPERUSER_DB,
  user: process.env.TEST_SUPERUSER_USER,
  password: process.env.TEST_SUPERUSER_PASSWORD,
});

let tenantId: string;
let usuarioId: string;
let tokenId: string;

describe('autenticar / resolverToken', () => {
  before(async () => {
    const alta = await poolSuperusuario.query<{ fn_alta_tenant: string }>(
      `SELECT app.fn_alta_tenant($1, $2, 'EMPRESARIAL', $3, $4, $5) AS fn_alta_tenant`,
      ['Constructora Test Auth', '900000003-3', 'Carla Admin', EMAIL, 'hash_de_prueba_no_real'],
    );
    tenantId = alta.rows[0]!.fn_alta_tenant;

    const usuario = await poolSuperusuario.query<{ id: string }>(
      'SELECT id FROM app.usuario WHERE email = $1',
      [EMAIL],
    );
    usuarioId = usuario.rows[0]!.id;

    const token = await poolSuperusuario.query<{ id: string }>(
      `INSERT INTO app.token_recuperacion (tenant_id, usuario_id, proposito, token_hash, expira_en)
       VALUES ($1, $2, 'RECUPERACION', $3, now() + interval '10 minutes')
       RETURNING id`,
      [tenantId, usuarioId, TOKEN_HASH],
    );
    tokenId = token.rows[0]!.id;
  });

  after(async () => {
    await poolSuperusuario.end();
  });

  test('autenticar(email) devuelve el usuario con el tenantId/usuarioId reales', async () => {
    const resultado = await autenticar(EMAIL);
    assert.ok(resultado);
    assert.equal(resultado.usuarioId, usuarioId);
    assert.equal(resultado.tenantId, tenantId);
    assert.equal(resultado.nombre, 'Carla Admin');
    assert.equal(resultado.passwordHash, 'hash_de_prueba_no_real');
    assert.equal(resultado.estado, 'ACTIVO');
  });

  test('autenticar(email inexistente) devuelve null, no un error', async () => {
    const resultado = await autenticar('nadie-existe-con-este-correo@construsoft.test');
    assert.equal(resultado, null);
  });

  test('resolverToken(hash) devuelve el token con el tenantId/usuarioId reales', async () => {
    const resultado = await resolverToken(TOKEN_HASH);
    assert.ok(resultado);
    assert.equal(resultado.tokenId, tokenId);
    assert.equal(resultado.usuarioId, usuarioId);
    assert.equal(resultado.tenantId, tenantId);
    assert.equal(resultado.usadoEn, null);
    assert.equal(resultado.anuladoEn, null);
  });

  test('resolverToken(hash inexistente) devuelve null, no un error', async () => {
    const resultado = await resolverToken('un-hash-que-no-existe');
    assert.equal(resultado, null);
  });
});

// Postgres frasea distinto el rechazo de SET ROLE ("se ha denegado el
// permiso para definir el rol...") del rechazo de un SELECT sobre una tabla
// ("permiso denegado a la tabla..."). El regex cubre las dos formas, no una
// paráfrasis con las palabras dadas vuelta.
const RECHAZO_DE_PERMISO = /permiso denegado|denegado el permiso|permission denied/i;

describe('D-50 · lo único que auth_login puede hacer son esas dos funciones', () => {
  async function conectarComoAuthLogin() {
    const pool = new Pool({
      host: process.env.AUTH_DB_HOST,
      port: Number(process.env.AUTH_DB_PORT ?? 5432),
      database: process.env.AUTH_DB_NAME,
      user: process.env.AUTH_DB_USER,
      password: process.env.AUTH_DB_PASSWORD,
    });
    const cliente = await pool.connect();
    return {
      cliente,
      cerrar: async () => {
        cliente.release();
        await pool.end();
      },
    };
  }

  test(
    'auth_login NO puede SET ROLE construsoft_auth — es el caso que de verdad importa',
    async () => {
      // Si esto alguna vez deja de rechazar, un GRANT distraído reabrió D-50:
      // construsoft_auth tiene BYPASSRLS y SELECT sobre app.usuario, así que
      // vestirse de él expone los hashes de contraseña de toda la plataforma
      // desde el único endpoint que atiende sin autenticar.
      const { cliente, cerrar } = await conectarComoAuthLogin();
      try {
        await assert.rejects(cliente.query('SET ROLE construsoft_auth'), RECHAZO_DE_PERMISO);
      } finally {
        await cerrar();
      }
    },
  );

  test('auth_login NO puede leer app.usuario directo (solo las dos funciones)', async () => {
    const { cliente, cerrar } = await conectarComoAuthLogin();
    try {
      await assert.rejects(cliente.query('SELECT * FROM app.usuario'), RECHAZO_DE_PERMISO);
    } finally {
      await cerrar();
    }
  });
});
