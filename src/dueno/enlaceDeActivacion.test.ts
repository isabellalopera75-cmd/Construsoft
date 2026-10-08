import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ejecutarConPermiso, registrarEmpresa } from '../infraestructura/basedatos/contextoTenant.js';
import { prepararEnlaceDeActivacion } from './enlaceDeActivacion.js';

describe('el enlace de activación del dueño (CONTRATO §11.4)', () => {
  test('solo para una cuenta PENDIENTE: vence a las 72 horas; activa o inexistente, el motivo dice qué hacer', async () => {
    const empresa = await registrarEmpresa({
      razonSocial: 'Constructora Activa', nit: '900000395-5', plan: 'EMPRESARIAL', adminNombre: 'Abel',
      adminEmail: 'activa.abel@construsoft.test', adminHash: 'hash_de_prueba_no_real', versionTerminos: 'v',
    });
    await ejecutarConPermiso({ tenantId: empresa.tenantId, usuarioId: empresa.usuarioId }, 'USUARIOS.GESTIONAR', async (c) => {
      const { rows } = await c.query<{ id: string }>(`SELECT id FROM app.rol WHERE tenant_id = $1 AND tipo = 'ASISTENTE'`, [empresa.tenantId]);
      await c.query(`INSERT INTO app.usuario (tenant_id, rol_id, nombre, email) VALUES ($1, $2, 'Bea', 'activa.bea@construsoft.test')`, [
        empresa.tenantId,
        rows[0]!.id,
      ]);
    });
    const enlace = await prepararEnlaceDeActivacion('activa.bea@construsoft.test');
    assert.match(enlace.token, /^[A-Za-z0-9_-]{43}$/);
    const horas = (Date.parse(enlace.expiraEn) - Date.now()) / 3_600_000;
    assert.ok(horas > 71.9 && horas <= 72, `vence en ${horas} horas`);

    await assert.rejects(prepararEnlaceDeActivacion('activa.abel@construsoft.test'), /ya está activa/);
    await assert.rejects(prepararEnlaceDeActivacion('nadie.activa@construsoft.test'), /No hay ninguna cuenta/);
  });
});
