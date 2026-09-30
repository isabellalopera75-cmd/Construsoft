import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ejecutarConPermiso,
  registrarEmpresa,
  type ClienteEnContexto,
  type CodigoPermiso,
  type EmpresaRegistrada,
} from './contextoTenant.js';
import { crearRecurso } from './recurso.js';
import { crearApu, type Apu } from './apu.js';
import { crearPresupuesto, leerPresupuesto } from './presupuesto.js';
import { agregarCapitulo, agregarSubcapitulo, leerEdt, moverEnEdt } from './edt.js';
import {
  agregarActividad,
  cambiarCantidad,
  eliminarActividad,
  leerActividades,
  type Actividad,
} from './actividad.js';

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

async function leerUnidadPorSimbolo(empresa: EmpresaRegistrada, simbolo: string): Promise<string> {
  return montarEscenarioComoAdmin(empresa, 'CONFIG.PREFERENCIAS', async (cliente) => {
    const { rows } = await cliente.query<{ id: string }>(
      `SELECT id FROM app.unidad_medida WHERE tenant_id = $1 AND simbolo = $2`,
      [empresa.tenantId, simbolo],
    );
    return rows[0]!.id;
  });
}

/** Un APU de un solo recurso: su costo directo es exactamente el precio del recurso. */
async function crearApuDePrecio(empresa: EmpresaRegistrada, nombre: string, precio: string): Promise<Apu> {
  const contexto = { tenantId: empresa.tenantId, usuarioId: empresa.usuarioId };
  const unidad = await leerUnidadPorSimbolo(empresa, 'Und');
  const recurso = await crearRecurso(contexto, {
    nombre: `Recurso de ${nombre}`,
    tipo: 'PERSONAL',
    unidadId: unidad,
    precioBase: precio,
    ivaPct: '0',
    precioTotal: precio,
    viaCaptura: 'BASE',
  });
  return crearApu(contexto, {
    nombre,
    unidadId: unidad,
    lineas: [{ recursoId: recurso.id, cantidad: '1', rendimiento: '1', desperdicioPct: '0' }],
  });
}

async function contarActividades(empresa: EmpresaRegistrada): Promise<number> {
  return montarEscenarioComoAdmin(empresa, 'PRESUPUESTOS.VER', async (cliente) => {
    const { rows } = await cliente.query<{ n: string }>(
      'SELECT count(*) AS n FROM app.presupuesto_item WHERE tenant_id = $1',
      [empresa.tenantId],
    );
    return Number(rows[0]!.n);
  });
}

/** Las actividades reducidas a número de ítem, descripción y cantidad. */
function forma(actividades: Actividad[]): Array<[string, string, string]> {
  return actividades.map((a) => [a.codigoItem, a.descripcion, a.cantidad]);
}

describe('actividades: agregar, cantidad, reordenar y eliminar', () => {
  let empresaA: EmpresaRegistrada;
  let asistenteId: string;
  let apuFino: Apu;
  let apuMil: Apu;
  let secuencia = 0;

  before(async () => {
    empresaA = await registrarEmpresaDePrueba('Constructora Actividad A', '900000070-0', 'act.julia@construsoft.test');
    asistenteId = await crearAsistente(empresaA, 'act.julian@construsoft.test', 'Julián Asistente');
    apuFino = await crearApuDePrecio(empresaA, 'Actividad de precio fino', '1234.567891');
    apuMil = await crearApuDePrecio(empresaA, 'Actividad de mil', '1000');
  });

  const contexto = () => ({ tenantId: empresaA.tenantId, usuarioId: empresaA.usuarioId });

  async function presupuestoConCapitulo(): Promise<{ presupuestoId: string; capituloId: string }> {
    secuencia += 1;
    const presupuesto = await crearPresupuesto(contexto(), {
      codigo: `ACT-${secuencia}`,
      nombre: `Actividades ${secuencia}`,
      ubicacion: 'Medellín',
      modoEstructura: 'WBS',
    });
    const capitulo = await agregarCapitulo(contexto(), presupuesto.id, { nombre: 'OBRA', clasificacion: 'DIRECTO' });
    return { presupuestoId: presupuesto.id, capituloId: capitulo.id };
  }

  test('agregar copia código, descripción, unidad y precio de la versión vigente, y la base calcula el costo (RF-PRE-15/16/18)', async () => {
    const { capituloId } = await presupuestoConCapitulo();
    const actividad = await agregarActividad(contexto(), capituloId, apuFino.id, '2.5');

    const { id, ...resto } = actividad;
    assert.match(id, /^[0-9a-f-]{36}$/);
    assert.deepEqual(resto, {
      wbsNodoId: capituloId,
      codigoItem: '1.1',
      apuId: apuFino.id,
      apuVersionId: apuFino.versionVigenteId,
      codigoApu: apuFino.codigo,
      descripcion: 'Actividad de precio fino',
      unidadSimbolo: 'Und',
      cantidad: '2.500000',
      precioUnitario: '1234.567891',
      // 2,5 × 1.234,567891 = 3.086,4197275 → la columna generada redondea a seis decimales.
      costoTotal: '3086.419728',
    });
  });

  test('capítulos y actividades comparten contador: 1.1 actividad, 1.2 subcapítulo, 1.2.1 su actividad, 1.3 (D-42)', async () => {
    const { presupuestoId, capituloId } = await presupuestoConCapitulo();
    await agregarActividad(contexto(), capituloId, apuMil.id, '1');
    const sub = await agregarSubcapitulo(contexto(), capituloId, { nombre: 'Concretos' });
    await agregarActividad(contexto(), sub.id, apuFino.id, '2');
    await agregarActividad(contexto(), capituloId, apuMil.id, '3');

    assert.deepEqual(forma(await leerActividades(contexto(), presupuestoId)), [
      ['1.1', 'Actividad de mil', '1.000000'],
      ['1.2.1', 'Actividad de precio fino', '2.000000'],
      ['1.3', 'Actividad de mil', '3.000000'],
    ]);
    assert.deepEqual(
      (await leerEdt(contexto(), presupuestoId)).map((n) => n.codigoWbs),
      ['1.0', '1.2'],
    );
  });

  test('los montos del capítulo y los totales del presupuesto los recalcula la base al agregar y al cambiar la cantidad (RF-PRE-21)', async () => {
    const { presupuestoId, capituloId } = await presupuestoConCapitulo();
    const actividad = await agregarActividad(contexto(), capituloId, apuMil.id, '3');
    assert.equal((await leerPresupuesto(contexto(), presupuestoId))!.totalCostoDirecto, '3000.000000');

    const cambiada = await cambiarCantidad(contexto(), actividad.id, '7');
    assert.equal(cambiada!.costoTotal, '7000.000000');
    assert.equal((await leerPresupuesto(contexto(), presupuestoId))!.totalCostoDirecto, '7000.000000');
    assert.deepEqual(
      (await leerEdt(contexto(), presupuestoId)).map((n) => [n.codigoWbs, n.montoAcumulado, n.incidenciaPct?.slice(0, 6)]),
      [['1.0', '7000.000000', '100.00']],
    );
  });

  test('una cantidad negativa la rechaza la base y la actividad queda como estaba', async () => {
    const { presupuestoId, capituloId } = await presupuestoConCapitulo();
    const actividad = await agregarActividad(contexto(), capituloId, apuMil.id, '4');
    await assert.rejects(cambiarCantidad(contexto(), actividad.id, '-1'));
    assert.deepEqual(forma(await leerActividades(contexto(), presupuestoId)), [['1.1', 'Actividad de mil', '4.000000']]);
  });

  test('reordenar y eliminar actividades renumera a sus hermanos (RF-PRE-45)', async () => {
    const { presupuestoId, capituloId } = await presupuestoConCapitulo();
    const primera = await agregarActividad(contexto(), capituloId, apuMil.id, '1');
    await agregarActividad(contexto(), capituloId, apuMil.id, '2');
    const tercera = await agregarActividad(contexto(), capituloId, apuMil.id, '3');

    await moverEnEdt(contexto(), tercera.id, 1);
    assert.deepEqual(forma(await leerActividades(contexto(), presupuestoId)), [
      ['1.1', 'Actividad de mil', '3.000000'],
      ['1.2', 'Actividad de mil', '1.000000'],
      ['1.3', 'Actividad de mil', '2.000000'],
    ]);

    await eliminarActividad(contexto(), primera.id);
    assert.deepEqual(forma(await leerActividades(contexto(), presupuestoId)), [
      ['1.1', 'Actividad de mil', '3.000000'],
      ['1.2', 'Actividad de mil', '2.000000'],
    ]);
    assert.equal((await leerPresupuesto(contexto(), presupuestoId))!.totalCostoDirecto, '5000.000000');
  });

  test('un capítulo o un APU que no existen en esta empresa no agregan nada, y lo dice', async () => {
    const { capituloId } = await presupuestoConCapitulo();
    const antes = await contarActividades(empresaA);
    await assert.rejects(
      agregarActividad(contexto(), '00000000-0000-7000-8000-000000000000', apuMil.id, '1'),
      /no existe en esta empresa/,
    );
    await assert.rejects(
      agregarActividad(contexto(), capituloId, '00000000-0000-7000-8000-000000000000', '1'),
      /no existe en esta empresa/,
    );
    assert.equal(await contarActividades(empresaA), antes);
  });

  test('en un presupuesto ACTIVO no se agrega, cambia ni elimina ninguna actividad (RN-04)', async () => {
    const { presupuestoId, capituloId } = await presupuestoConCapitulo();
    const actividad = await agregarActividad(contexto(), capituloId, apuMil.id, '1');
    await montarEscenarioComoAdmin(empresaA, 'PRESUPUESTOS.ESTADO', (cliente) =>
      cliente.query('SELECT app.fn_activar_presupuesto($1)', [presupuestoId]),
    );
    const antes = await leerActividades(contexto(), presupuestoId);

    await assert.rejects(agregarActividad(contexto(), capituloId, apuMil.id, '1'), /estado ACTIVO/);
    await assert.rejects(cambiarCantidad(contexto(), actividad.id, '9'), /estado ACTIVO/);
    await assert.rejects(eliminarActividad(contexto(), actividad.id), /estado ACTIVO/);
    assert.deepEqual(await leerActividades(contexto(), presupuestoId), antes);
  });

  test('sin PRESUPUESTOS.EDITAR no se agrega, cambia ni elimina; sin PRESUPUESTOS.VER no se lee', async () => {
    const { presupuestoId, capituloId } = await presupuestoConCapitulo();
    const actividad = await agregarActividad(contexto(), capituloId, apuMil.id, '1');
    const antes = await leerActividades(contexto(), presupuestoId);
    const asistente = { tenantId: empresaA.tenantId, usuarioId: asistenteId };

    await assert.rejects(agregarActividad(asistente, capituloId, apuMil.id, '1'), /PRESUPUESTOS\.EDITAR/);
    await assert.rejects(cambiarCantidad(asistente, actividad.id, '9'), /PRESUPUESTOS\.EDITAR/);
    await assert.rejects(eliminarActividad(asistente, actividad.id), /PRESUPUESTOS\.EDITAR/);
    await assert.rejects(leerActividades(asistente, presupuestoId), /PRESUPUESTOS\.VER/);
    assert.deepEqual(await leerActividades(contexto(), presupuestoId), antes);
  });

  test('aislamiento: otra empresa no lee ni toca estas actividades, ni usa un APU ajeno en su propio presupuesto', async () => {
    const empresaB = await registrarEmpresaDePrueba('Constructora Actividad B', '900000071-1', 'act.karla@construsoft.test');
    const contextoB = { tenantId: empresaB.tenantId, usuarioId: empresaB.usuarioId };
    const { presupuestoId, capituloId } = await presupuestoConCapitulo();
    const actividad = await agregarActividad(contexto(), capituloId, apuMil.id, '1');
    const antes = await leerActividades(contexto(), presupuestoId);

    assert.deepEqual(await leerActividades(contextoB, presupuestoId), []);
    await assert.rejects(agregarActividad(contextoB, capituloId, apuMil.id, '1'), /no existe en esta empresa/);
    assert.equal(await cambiarCantidad(contextoB, actividad.id, '99'), null);
    await eliminarActividad(contextoB, actividad.id);

    const presupuestoDeB = await crearPresupuesto(contextoB, {
      codigo: 'ACT-B',
      nombre: 'De B',
      ubicacion: 'Cali',
      modoEstructura: 'WBS',
    });
    const capituloDeB = await agregarCapitulo(contextoB, presupuestoDeB.id, { nombre: 'OBRA', clasificacion: 'DIRECTO' });
    await assert.rejects(agregarActividad(contextoB, capituloDeB.id, apuMil.id, '1'), /no existe en esta empresa/);

    assert.deepEqual(await leerActividades(contexto(), presupuestoId), antes);
    assert.equal(await contarActividades(empresaB), 0);
  });
});
