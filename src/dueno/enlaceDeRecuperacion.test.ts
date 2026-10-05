import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ejecutarConPermiso, consumirTokenRecuperacion, registrarEmpresa } from '../infraestructura/basedatos/contextoTenant.js';
import { hashDeToken } from '../http/tokens.js';
import { prepararEnlaceDeRecuperacion } from './enlaceDeRecuperacion.js';

describe('el enlace de recuperación del dueño (04 §8.5)', () => {
  test('una cuenta activa recibe un token que la recuperación acepta; solo el último sirve', async () => {
    await registrarEmpresa({
      razonSocial: 'Constructora Enlace', nit: '900000370-0', plan: 'EMPRESARIAL', adminNombre: 'Ana',
      adminEmail: 'enlace.ana@construsoft.test', adminHash: 'hash_de_prueba_no_real', versionTerminos: 'v',
    });
    const primero = await prepararEnlaceDeRecuperacion('enlace.ana@construsoft.test');
    const segundo = await prepararEnlaceDeRecuperacion('enlace.ana@construsoft.test');
    assert.match(segundo.token, /^[A-Za-z0-9_-]{43}$/);
    await assert.rejects(consumirTokenRecuperacion(hashDeToken(primero.token), 'hash_nuevo_no_real'));
    await consumirTokenRecuperacion(hashDeToken(segundo.token), 'hash_nuevo_no_real');
  });

  test('un correo sin cuenta, una cuenta pendiente o una revocada: no hay enlace, y el motivo dice qué hacer', async () => {
    await assert.rejects(prepararEnlaceDeRecuperacion('nadie@construsoft.test'), /No hay ninguna cuenta/);
    const empresa = await registrarEmpresa({
      razonSocial: 'Constructora Enlace B', nit: '900000371-1', plan: 'EMPRESARIAL', adminNombre: 'Beto',
      adminEmail: 'enlace.beto@construsoft.test', adminHash: 'hash_de_prueba_no_real', versionTerminos: 'v',
    });
    const contexto = { tenantId: empresa.tenantId, usuarioId: empresa.usuarioId };
    for (const [email, estado, motivo] of [
      ['enlace.pendiente@construsoft.test', 'PENDIENTE', /ACTIVACIÓN/],
      ['enlace.revocado@construsoft.test', 'REVOCADO', /revocada/],
    ] as const) {
      await ejecutarConPermiso(contexto, 'USUARIOS.GESTIONAR', async (c) => {
        const { rows } = await c.query<{ id: string }>(`SELECT id FROM app.rol WHERE tenant_id = $1 AND tipo = 'ASISTENTE'`, [empresa.tenantId]);
        await c.query(
          `INSERT INTO app.usuario (tenant_id, rol_id, nombre, email, password_hash, estado) VALUES ($1, $2, 'X', $3, $4, $5)`,
          [empresa.tenantId, rows[0]!.id, email, estado === 'PENDIENTE' ? null : 'x', estado],
        );
      });
      await assert.rejects(prepararEnlaceDeRecuperacion(email), motivo);
    }
  });
});
