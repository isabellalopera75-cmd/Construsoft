import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ejecutarConPermiso,
  registrarEmpresa,
  type ClienteEnContexto,
  type EmpresaRegistrada,
} from './contextoTenant.js';

/**
 * D-59 · El único prerrequisito entre módulos: un rol que edita presupuestos
 * necesita Ver APU. Lo impone tg_rol_permisos_coherentes al CONFIRMAR la
 * transacción (es diferido), así que el rechazo llega en el COMMIT y la
 * transacción entera vuelve atrás. Todavía no hay módulo de roles: estas
 * pruebas escriben app.rol_permiso con SQL bajo USUARIOS.GESTIONAR, que es
 * el permiso que de verdad gobierna esa tabla.
 */

let empresa: EmpresaRegistrada;
let rolAsistente: string;

async function comoAdministrador<T>(operacion: (cliente: ClienteEnContexto) => Promise<T>): Promise<T> {
  return ejecutarConPermiso(
    { tenantId: empresa.tenantId, usuarioId: empresa.usuarioId },
    'USUARIOS.GESTIONAR',
    operacion,
  );
}

async function permisosDelAsistente(): Promise<string[]> {
  return comoAdministrador(async (cliente) => {
    const { rows } = await cliente.query<{ permiso_codigo: string }>(
      'SELECT permiso_codigo FROM app.rol_permiso WHERE rol_id = $1 ORDER BY permiso_codigo',
      [rolAsistente],
    );
    return rows.map((r) => r.permiso_codigo);
  });
}

async function conceder(cliente: ClienteEnContexto, codigo: string): Promise<void> {
  await cliente.query('INSERT INTO app.rol_permiso (tenant_id, rol_id, permiso_codigo) VALUES ($1, $2, $3)', [
    empresa.tenantId,
    rolAsistente,
    codigo,
  ]);
}

const MENSAJE_D59 = /Un rol que edita presupuestos necesita tambien Ver APU.*\(D-59\)/;

describe('D-59: editar presupuestos exige Ver APU, y lo impone la base', () => {
  before(async () => {
    empresa = await registrarEmpresa({
      razonSocial: 'Constructora Roles',
      nit: '900000090-0',
      plan: 'EMPRESARIAL',
      adminNombre: 'Admin de roles',
      adminEmail: 'roles.admin@construsoft.test',
      adminHash: 'hash_de_prueba_no_real',
      versionTerminos: 'terminos-de-prueba',
    });
    rolAsistente = await comoAdministrador(async (cliente) => {
      const { rows } = await cliente.query<{ id: string }>(
        `SELECT id FROM app.rol WHERE tenant_id = $1 AND tipo = 'ASISTENTE'`,
        [empresa.tenantId],
      );
      return rows[0]!.id;
    });
  });

  test('guardar un rol que edita presupuestos sin Ver APU se rechaza, y no queda ningún permiso a medias', async () => {
    await assert.rejects(
      comoAdministrador(async (cliente) => {
        await conceder(cliente, 'PRESUPUESTOS.VER');
        await conceder(cliente, 'PRESUPUESTOS.EDITAR');
      }),
      MENSAJE_D59,
    );
    assert.deepEqual(await permisosDelAsistente(), []);
  });

  test('con Ver APU se guarda, en cualquier orden dentro de la transacción', async () => {
    await comoAdministrador(async (cliente) => {
      await conceder(cliente, 'PRESUPUESTOS.EDITAR');
      await conceder(cliente, 'PRESUPUESTOS.VER');
      await conceder(cliente, 'APU.VER');
    });
    assert.deepEqual(await permisosDelAsistente(), ['APU.VER', 'PRESUPUESTOS.EDITAR', 'PRESUPUESTOS.VER']);
  });

  test('quitarle Ver APU después se rechaza, por DELETE y por UPDATE, y el rol queda como estaba', async () => {
    await assert.rejects(
      comoAdministrador((cliente) =>
        cliente.query(`DELETE FROM app.rol_permiso WHERE rol_id = $1 AND permiso_codigo = 'APU.VER'`, [rolAsistente]),
      ),
      MENSAJE_D59,
    );
    await assert.rejects(
      comoAdministrador((cliente) =>
        cliente.query(
          `UPDATE app.rol_permiso SET permiso_codigo = 'RECURSOS.VER'
            WHERE rol_id = $1 AND permiso_codigo = 'APU.VER'`,
          [rolAsistente],
        ),
      ),
      MENSAJE_D59,
    );
    assert.deepEqual(await permisosDelAsistente(), ['APU.VER', 'PRESUPUESTOS.EDITAR', 'PRESUPUESTOS.VER']);
  });

  test('sin editar presupuestos, Ver APU se puede quitar: la regla es ese prerrequisito y ningún otro', async () => {
    await comoAdministrador((cliente) =>
      cliente.query(`DELETE FROM app.rol_permiso WHERE rol_id = $1 AND permiso_codigo = 'PRESUPUESTOS.EDITAR'`, [
        rolAsistente,
      ]),
    );
    await comoAdministrador((cliente) =>
      cliente.query(`DELETE FROM app.rol_permiso WHERE rol_id = $1 AND permiso_codigo = 'APU.VER'`, [rolAsistente]),
    );
    assert.deepEqual(await permisosDelAsistente(), ['PRESUPUESTOS.VER']);
  });
});
