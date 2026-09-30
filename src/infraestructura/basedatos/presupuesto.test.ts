import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ejecutarConPermiso,
  registrarEmpresa,
  type ClienteEnContexto,
  type CodigoPermiso,
  type EmpresaRegistrada,
} from './contextoTenant.js';
import { crearPresupuesto, leerPresupuesto } from './presupuesto.js';

/** Mismo patrón autocontenido que los demás archivos de prueba: email/NIT propios. */
async function registrarEmpresaDePrueba(
  razonSocial: string,
  nit: string,
  email: string,
): Promise<EmpresaRegistrada> {
  return registrarEmpresa({
    razonSocial,
    nit,
    plan: 'EMPRESARIAL',
    adminNombre: `Admin de ${razonSocial}`,
    adminEmail: email,
    adminHash: 'hash_de_prueba_no_real',
  });
}

/** El permiso declara lo que de verdad hace cada paso de montaje; el administrador tiene los 18. */
async function montarEscenarioComoAdmin<T>(
  empresa: EmpresaRegistrada,
  permiso: CodigoPermiso,
  operacion: (cliente: ClienteEnContexto) => Promise<T>,
): Promise<T> {
  return ejecutarConPermiso(
    { tenantId: empresa.tenantId, usuarioId: empresa.usuarioId },
    permiso,
    operacion,
  );
}

/** El rol Asistente nace con fn_alta_tenant sin ningún permiso (D-44). */
async function crearAsistente(
  empresa: EmpresaRegistrada,
  email: string,
  nombre: string,
): Promise<string> {
  return montarEscenarioComoAdmin(empresa, 'USUARIOS.GESTIONAR', async (cliente) => {
    const { rows: roles } = await cliente.query<{ id: string }>(
      `SELECT id FROM app.rol WHERE tenant_id = $1 AND tipo = 'ASISTENTE'`,
      [empresa.tenantId],
    );
    const { rows } = await cliente.query<{ id: string }>(
      `INSERT INTO app.usuario (tenant_id, rol_id, nombre, email, password_hash, estado)
       VALUES ($1, $2, $3, $4, 'hash_de_prueba_no_real', 'ACTIVO')
       RETURNING id`,
      [empresa.tenantId, roles[0]!.id, nombre, email],
    );
    return rows[0]!.id;
  });
}

/** Cuántos presupuestos tiene la empresa: para comprobar que un rechazo no dejó nada. */
async function contarPresupuestos(empresa: EmpresaRegistrada): Promise<number> {
  return montarEscenarioComoAdmin(empresa, 'PRESUPUESTOS.VER', async (cliente) => {
    const { rows } = await cliente.query<{ n: string }>(
      'SELECT count(*) AS n FROM app.presupuesto WHERE tenant_id = $1',
      [empresa.tenantId],
    );
    return Number(rows[0]!.n);
  });
}

describe('crearPresupuesto / leerPresupuesto', () => {
  let empresaA: EmpresaRegistrada;
  let asistenteId: string;

  before(async () => {
    empresaA = await registrarEmpresaDePrueba('Constructora Presupuesto A', '900000050-0', 'pre.fabian@construsoft.test');
    asistenteId = await crearAsistente(empresaA, 'pre.fernanda@construsoft.test', 'Fernanda Asistente');
  });

  const contexto = () => ({ tenantId: empresaA.tenantId, usuarioId: empresaA.usuarioId });

  test('con el permiso: nace ABIERTO, en la moneda de la empresa, con AIU en cero, IVA en 19 y totales en cero', async () => {
    const creado = await crearPresupuesto(contexto(), {
      codigo: 'PRE-2026-001',
      nombre: 'Casa campestre El Retiro',
      ubicacion: 'El Retiro, Antioquia',
      modoEstructura: 'ITEMS',
    });

    const { id, fechaElaboracion, fechaModificacion, ...resto } = creado;
    assert.match(id, /^[0-9a-f-]{36}$/);
    assert.ok(fechaElaboracion instanceof Date);
    assert.ok(fechaModificacion instanceof Date);
    assert.deepEqual(resto, {
      codigo: 'PRE-2026-001',
      nombre: 'Casa campestre El Retiro',
      ubicacion: 'El Retiro, Antioquia',
      moneda: 'COP',
      estado: 'ABIERTO',
      modoEstructura: 'ITEMS',
      archivadoEn: null,
      aiuAdministracion: '0.000000',
      aiuImprevistos: '0.000000',
      aiuUtilidad: '0.000000',
      ivaUtilidadPct: '19.000000',
      totalCostoDirecto: '0.000000',
      totalCostoIndirecto: '0.000000',
      totalAdministracion: '0.000000',
      totalImprevistos: '0.000000',
      totalUtilidad: '0.000000',
      totalAiu: '0.000000',
      totalIva: '0.000000',
      valorTotal: '0.000000',
      sinBaseAiu: false,
    });
  });

  test('leerPresupuesto devuelve exactamente la cabecera que devolvió la creación', async () => {
    const creado = await crearPresupuesto(contexto(), {
      codigo: 'PRE-2026-002',
      nombre: 'Bodega Rionegro',
      ubicacion: 'Rionegro',
      modoEstructura: 'WBS',
    });
    assert.deepEqual(await leerPresupuesto(contexto(), creado.id), creado);
  });

  test('leerPresupuesto: el que no existe da null, no un error', async () => {
    assert.equal(await leerPresupuesto(contexto(), '00000000-0000-7000-8000-000000000000'), null);
  });

  test('el código repetido en la misma empresa lo rechaza la base, y no queda nada (RF-PRE-03)', async () => {
    await crearPresupuesto(contexto(), {
      codigo: 'PRE-REPETIDO',
      nombre: 'Primero',
      ubicacion: 'Medellín',
      modoEstructura: 'WBS',
    });
    const antes = await contarPresupuestos(empresaA);
    await assert.rejects(
      crearPresupuesto(contexto(), {
        codigo: 'PRE-REPETIDO',
        nombre: 'Segundo',
        ubicacion: 'Envigado',
        modoEstructura: 'WBS',
      }),
      /presupuesto_tenant_id_codigo_key/,
    );
    assert.equal(await contarPresupuestos(empresaA), antes);
  });

  test('sin PRESUPUESTOS.CREAR no crea nada; sin PRESUPUESTOS.VER no lee', async () => {
    const contextoAsistente = { tenantId: empresaA.tenantId, usuarioId: asistenteId };
    const antes = await contarPresupuestos(empresaA);
    await assert.rejects(
      crearPresupuesto(contextoAsistente, {
        codigo: 'PRE-SIN-PERMISO',
        nombre: 'no debería crearse',
        ubicacion: 'Medellín',
        modoEstructura: 'WBS',
      }),
      /PRESUPUESTOS\.CREAR/,
    );
    assert.equal(await contarPresupuestos(empresaA), antes);

    const existente = await crearPresupuesto(contexto(), {
      codigo: 'PRE-PARA-LEER',
      nombre: 'Para leer sin permiso',
      ubicacion: 'Medellín',
      modoEstructura: 'WBS',
    });
    await assert.rejects(leerPresupuesto(contextoAsistente, existente.id), /PRESUPUESTOS\.VER/);
  });

  test('aislamiento: otra empresa no lee el presupuesto con su id exacto, y puede usar el mismo código', async () => {
    const empresaB = await registrarEmpresaDePrueba('Constructora Presupuesto B', '900000051-1', 'pre.gabriel@construsoft.test');
    const contextoB = { tenantId: empresaB.tenantId, usuarioId: empresaB.usuarioId };

    const deA = await crearPresupuesto(contexto(), {
      codigo: 'PRE-COMPARTIDO',
      nombre: 'Obra de A',
      ubicacion: 'Medellín',
      modoEstructura: 'WBS',
    });
    assert.equal(await leerPresupuesto(contextoB, deA.id), null);

    // El código es único POR empresa: que B pueda usarlo prueba que no ve el de A.
    const deB = await crearPresupuesto(contextoB, {
      codigo: 'PRE-COMPARTIDO',
      nombre: 'Obra de B',
      ubicacion: 'Cali',
      modoEstructura: 'ITEMS',
    });
    assert.notEqual(deB.id, deA.id);
    assert.equal((await leerPresupuesto(contexto(), deA.id))!.nombre, 'Obra de A');
  });
});
