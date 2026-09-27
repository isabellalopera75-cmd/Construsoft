import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { ejecutarComoTenant } from './contextoTenant.js';

/**
 * Fixtures de esta prueba: dos empresas reales, creadas con
 * app.fn_alta_tenant (RN-01), igual que hace docs/prueba-fase-0.sql.
 *
 * Se siembran con un rol SUPERUSER local (ver .env.example,
 * TEST_SUPERUSER_*) y NO con app_login, por una razón concreta: RLS con
 * FORCE está activo incluso para el propio sembrado, y fn_alta_tenant fija
 * su contexto con `set_config(..., true)` — local a SU transacción. Cuando
 * esa transacción termina, el contexto se pierde; una lectura posterior con
 * app_login y sin contexto vería cero filas aunque el WHERE sea correcto.
 * Un superusuario evita ese problema porque bypassea RLS por completo, y es
 * exactamente lo que docs/prueba-fase-0.sql hace con SET ROLE en un solo
 * archivo de psql. Esta base es la única vía sancionada por el esquema para
 * resolver un id de usuario antes de que exista contexto (RF-AUT-04):
 * app.fn_autenticar. La usamos tal cual la usaría auth_login en producción.
 *
 * Esta base de datos de desarrollo no ofrece un borrado inmediato de
 * tenants: app.fn_eliminar_tenant exige 10 días de prueba vencida (RF-SAD-13)
 * y es deliberado — el esquema hace difícil destruir datos a propósito. Los
 * tenants de esta prueba quedan en la base; usamos sufijos aleatorios para
 * que correr la prueba de nuevo no choque con un UNIQUE.
 */
const poolSuperusuario = new Pool({
  host: process.env.TEST_SUPERUSER_HOST,
  port: Number(process.env.TEST_SUPERUSER_PORT ?? 5432),
  database: process.env.TEST_SUPERUSER_DB,
  user: process.env.TEST_SUPERUSER_USER,
  password: process.env.TEST_SUPERUSER_PASSWORD,
});

interface EmpresaDePrueba {
  tenantId: string;
  usuarioId: string;
  razonSocial: string;
}

async function sembrarEmpresa(nombre: string, nit: string, email: string): Promise<EmpresaDePrueba> {
  const alta = await poolSuperusuario.query<{ fn_alta_tenant: string }>(
    `SELECT app.fn_alta_tenant($1, $2, 'EMPRESARIAL', $3, $4, 'hash_de_prueba_no_real') AS fn_alta_tenant`,
    [nombre, nit, `Admin de ${nombre}`, email],
  );
  const tenantId = alta.rows[0]!.fn_alta_tenant;

  const auth = await poolSuperusuario.query<{ usuario_id: string }>(
    `SELECT usuario_id FROM app.fn_autenticar($1)`,
    [email],
  );
  const usuarioId = auth.rows[0]!.usuario_id;

  return { tenantId, usuarioId, razonSocial: nombre };
}

let empresaA: EmpresaDePrueba;
let empresaB: EmpresaDePrueba;

describe('ejecutarComoTenant', () => {
  before(async () => {
    const sufijo = randomUUID().slice(0, 8);
    empresaA = await sembrarEmpresa(
      `Constructora Test A ${sufijo}`,
      `900-${sufijo}`,
      `ana-${sufijo}@test.co`,
    );
    empresaB = await sembrarEmpresa(
      `Constructora Test B ${sufijo}`,
      `800-${sufijo}`,
      `beto-${sufijo}@test.co`,
    );
  });

  after(async () => {
    await poolSuperusuario.end();
  });

  test('cada empresa ve su propia razón social y ninguna otra (RN-01)', async () => {
    const vistaDesdeA = await ejecutarComoTenant(
      { tenantId: empresaA.tenantId, usuarioId: empresaA.usuarioId },
      async (cliente) => {
        const { rows } = await cliente.query<{ razon_social: string }>(
          'SELECT razon_social FROM plataforma.tenant',
        );
        return rows;
      },
    );
    assert.deepEqual(vistaDesdeA.map((f) => f.razon_social), [empresaA.razonSocial]);

    const vistaDesdeB = await ejecutarComoTenant(
      { tenantId: empresaB.tenantId, usuarioId: empresaB.usuarioId },
      async (cliente) => {
        const { rows } = await cliente.query<{ razon_social: string }>(
          'SELECT razon_social FROM plataforma.tenant',
        );
        return rows;
      },
    );
    assert.deepEqual(vistaDesdeB.map((f) => f.razon_social), [empresaB.razonSocial]);
  });

  test('fija app.usuario_id: fn_usuario_actual() devuelve exactamente el usuarioId del contexto', async () => {
    const usuarioVisto = await ejecutarComoTenant(
      { tenantId: empresaA.tenantId, usuarioId: empresaA.usuarioId },
      async (cliente) => {
        const { rows } = await cliente.query<{ fn_usuario_actual: string }>(
          'SELECT app.fn_usuario_actual()',
        );
        return rows[0]!.fn_usuario_actual;
      },
    );
    assert.equal(usuarioVisto, empresaA.usuarioId);
  });

  test('hace ROLLBACK si la operación lanza, y libera el cliente de todos modos', async () => {
    await assert.rejects(
      ejecutarComoTenant(
        { tenantId: empresaA.tenantId, usuarioId: empresaA.usuarioId },
        async () => {
          throw new Error('falla deliberada de la prueba');
        },
      ),
      /falla deliberada de la prueba/,
    );

    // Si el cliente hubiera quedado sin liberar, este segundo llamado se
    // colgaría esperando una conexión libre del pool en vez de resolver.
    const siguePudiendoConsultar = await ejecutarComoTenant(
      { tenantId: empresaA.tenantId, usuarioId: empresaA.usuarioId },
      async (cliente) => {
        const { rows } = await cliente.query('SELECT 1 AS ok');
        return rows[0]!.ok;
      },
    );
    assert.equal(siguePudiendoConsultar, 1);
  });

  test('rechaza un tenantId que no es UUID en vez de mandarlo a la base', async () => {
    await assert.rejects(
      ejecutarComoTenant(
        { tenantId: 'no-es-un-uuid', usuarioId: empresaA.usuarioId },
        async () => {
          throw new Error('no debería llegar a ejecutar la operación');
        },
      ),
      /tenantId/,
    );
  });
});

describe('el problema que este wrapper existe para evitar', () => {
  test(
    'un cliente del pool de app_login sin pasar por el wrapper no ve nada, sin ningún error que lo explique',
    async () => {
      // A propósito NO se importa ejecutarComoTenant acá: este pool es
      // "suelto", tal como lo describe el pedido original. Nunca fija
      // app.tenant_id. RLS con FORCE hace que el WHERE ni siquiera importe:
      // devuelve cero filas en silencio, aunque sí exista una empresa A.
      const poolSuelto = new Pool({
        host: process.env.APP_DB_HOST,
        port: Number(process.env.APP_DB_PORT ?? 5432),
        database: process.env.APP_DB_NAME,
        user: process.env.APP_DB_USER,
        password: process.env.APP_DB_PASSWORD,
      });
      try {
        const { rows } = await poolSuelto.query('SELECT razon_social FROM plataforma.tenant');
        assert.deepEqual(rows, []);
      } finally {
        await poolSuelto.end();
      }
    },
  );

  test('el módulo no expone el pool ni un query suelto: solo ejecutarComoTenant', async () => {
    const modulo = await import('./contextoTenant.js');
    assert.deepEqual(Object.keys(modulo).sort(), ['ejecutarComoTenant']);
  });
});
