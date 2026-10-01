import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ejecutarConPermiso, registrarEmpresa, type ContextoTenant } from './contextoTenant.js';
import { leerPreferencias, actualizarPreferencias } from './configuracionEmpresa.js';
import { leerPresupuesto } from './presupuesto.js';
import { activarPresupuesto } from './cicloDeVida.js';
import { leerVersion, listarVersiones } from './versiones.js';
import { leerPresupuestoParaExportar, leerVersionParaExportar } from './exportacion.js';
import { armarPresupuestoDeReferencia } from '../../pruebas/presupuestoDeReferencia.js';

let contexto: ContextoTenant;
let asistente: ContextoTenant;
let presupuestoId: string;

describe('lo que se exporta: la fotografía, viva o de una versión, con el formato de la empresa (RF-PRE-29/30, RF-VER-07)', () => {
  before(async () => {
    const empresa = await registrarEmpresa({
      razonSocial: 'Constructora Exporta',
      nit: '900000150-0',
      plan: 'EMPRESARIAL',
      adminNombre: 'Admin de exportación',
      adminEmail: 'exporta.admin@construsoft.test',
      adminHash: 'hash_de_prueba_no_real',
    });
    contexto = { tenantId: empresa.tenantId, usuarioId: empresa.usuarioId };
    asistente = {
      tenantId: empresa.tenantId,
      usuarioId: await ejecutarConPermiso(contexto, 'USUARIOS.GESTIONAR', async (cliente) => {
        const { rows: roles } = await cliente.query<{ id: string }>(
          `SELECT id FROM app.rol WHERE tenant_id = $1 AND tipo = 'ASISTENTE'`,
          [empresa.tenantId],
        );
        const { rows } = await cliente.query<{ id: string }>(
          `INSERT INTO app.usuario (tenant_id, rol_id, nombre, email, password_hash, estado)
           VALUES ($1, $2, 'Asistente', 'exporta.asistente@construsoft.test', 'x', 'ACTIVO') RETURNING id`,
          [empresa.tenantId, roles[0]!.id],
        );
        return rows[0]!.id;
      }),
    };
    presupuestoId = (await armarPresupuestoDeReferencia(contexto, 'EXP-RETIRO')).presupuestoId;
  });

  test('el presupuesto vivo se exporta con la misma fotografía que una versión, sin guardar ninguna', async () => {
    const documento = (await leerPresupuestoParaExportar(contexto, presupuestoId))!;
    assert.equal(documento.numeroVersion, null);
    assert.equal(documento.fotografia.schema, 5);
    assert.equal(documento.fotografia.presupuesto.estado, 'ABIERTO');
    assert.equal(documento.fotografia.presupuesto.totales.valorTotal, '180590155.000000');
    assert.equal(documento.fotografia.items.length, 7);
    assert.deepEqual(documento.formato, { separadorMiles: '.', separadorDecimal: ',', decimalesVista: 2 });
    assert.deepEqual(await listarVersiones(contexto, presupuestoId), []);
  });

  test('una versión se exporta con su número y exactamente la fotografía guardada', async () => {
    await activarPresupuesto(contexto, presupuestoId);
    const [v1] = await listarVersiones(contexto, presupuestoId);
    const documento = (await leerVersionParaExportar(contexto, v1!.id))!;
    assert.equal(documento.numeroVersion, 1);
    assert.deepEqual(documento.fotografia, (await leerVersion(contexto, v1!.id))!.fotografia);
  });

  test('el formato es el de la empresa hoy, también al reimprimir una versión: es presentación, no contenido', async () => {
    const preferencias = await leerPreferencias(contexto);
    await actualizarPreferencias(contexto, { ...preferencias, separadorMiles: ',', separadorDecimal: '.', decimalesVista: 0 });
    const [v1] = await listarVersiones(contexto, presupuestoId);
    assert.deepEqual((await leerVersionParaExportar(contexto, v1!.id))!.formato, {
      separadorMiles: ',',
      separadorDecimal: '.',
      decimalesVista: 0,
    });
    await actualizarPreferencias(contexto, preferencias);
  });

  test('lo que no existe en esta empresa da null', async () => {
    const inexistente = '00000000-0000-7000-8000-000000000000';
    assert.equal(await leerPresupuestoParaExportar(contexto, inexistente), null);
    assert.equal(await leerVersionParaExportar(contexto, inexistente), null);
  });

  test('sin PRESUPUESTOS.EXPORTAR no se lee nada para exportar', async () => {
    const [v1] = await listarVersiones(contexto, presupuestoId);
    await assert.rejects(leerPresupuestoParaExportar(asistente, presupuestoId), /PRESUPUESTOS\.EXPORTAR/);
    await assert.rejects(leerVersionParaExportar(asistente, v1!.id), /PRESUPUESTOS\.EXPORTAR/);
  });

  test('aislamiento: otra empresa no exporta este presupuesto ni sus versiones con los ids exactos', async () => {
    const empresaB = await registrarEmpresa({
      razonSocial: 'Constructora Exporta B',
      nit: '900000151-1',
      plan: 'PERSONAL',
      adminNombre: 'Admin B',
      adminEmail: 'exporta.b@construsoft.test',
      adminHash: 'hash_de_prueba_no_real',
    });
    const contextoB = { tenantId: empresaB.tenantId, usuarioId: empresaB.usuarioId };
    const [v1] = await listarVersiones(contexto, presupuestoId);
    assert.equal(await leerPresupuestoParaExportar(contextoB, presupuestoId), null);
    assert.equal(await leerVersionParaExportar(contextoB, v1!.id), null);
    assert.equal((await leerPresupuesto(contexto, presupuestoId))!.estado, 'ACTIVO');
  });
});
