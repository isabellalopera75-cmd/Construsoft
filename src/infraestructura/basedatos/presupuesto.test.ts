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
import { agregarCapitulo, agregarSubcapitulo, eliminarNivel, moverEnEdt, renombrarNivel } from './edt.js';
import {
  archivarPresupuesto,
  cambiarModoEstructura,
  crearPresupuesto,
  desarchivarPresupuesto,
  editarCabecera,
  editarPorcentajes,
  leerPresupuesto,
  listarPresupuestos,
  type Presupuesto,
} from './presupuesto.js';

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
      aiuEnCero: true,
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

/** Un APU de 1.000 por unidad (un recurso de 1.000 sin IVA, cantidad y rendimiento 1). */
async function crearApuDeMil(empresa: EmpresaRegistrada): Promise<Apu> {
  const contexto = { tenantId: empresa.tenantId, usuarioId: empresa.usuarioId };
  const unidadGlb = await montarEscenarioComoAdmin(empresa, 'CONFIG.PREFERENCIAS', async (cliente) => {
    const { rows } = await cliente.query<{ id: string }>(
      `SELECT id FROM app.unidad_medida WHERE tenant_id = $1 AND simbolo = 'Glb'`,
      [empresa.tenantId],
    );
    return rows[0]!.id;
  });
  const recurso = await crearRecurso(contexto, {
    nombre: 'Servicio global',
    tipo: 'PERSONAL',
    unidadId: unidadGlb,
    precioBase: '1000',
    ivaPct: '0',
    precioTotal: '1000',
    viaCaptura: 'BASE',
  });
  return crearApu(contexto, {
    nombre: 'Actividad de mil',
    unidadId: unidadGlb,
    lineas: [{ recursoId: recurso.id, cantidad: '1', rendimiento: '1', desperdicioPct: '0' }],
  });
}

/**
 * Un capítulo DIRECTO con una actividad de costo 1.000. Las actividades son
 * del paso 4: aquí se insertan con SQL, solo con lo que decide una persona.
 */
async function ponerMilDeCostoDirecto(empresa: EmpresaRegistrada, presupuestoId: string, apu: Apu): Promise<void> {
  const contexto = { tenantId: empresa.tenantId, usuarioId: empresa.usuarioId };
  const capitulo = await agregarCapitulo(contexto, presupuestoId, { nombre: 'OBRA', clasificacion: 'DIRECTO' });
  await montarEscenarioComoAdmin(empresa, 'PRESUPUESTOS.EDITAR', (cliente) =>
    cliente.query(
      `INSERT INTO app.presupuesto_item
              (tenant_id, presupuesto_id, wbs_nodo_id, apu_id, apu_version_id,
               codigo_apu, descripcion, unidad_simbolo, precio_unitario, cantidad)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1)`,
      [
        empresa.tenantId,
        presupuestoId,
        capitulo.id,
        apu.id,
        apu.versionVigenteId,
        apu.codigo,
        apu.nombre,
        apu.unidadSimbolo,
        apu.costoDirecto,
      ],
    ),
  );
}

async function activar(empresa: EmpresaRegistrada, presupuestoId: string): Promise<void> {
  await montarEscenarioComoAdmin(empresa, 'PRESUPUESTOS.ESTADO', (cliente) =>
    cliente.query('SELECT app.fn_activar_presupuesto($1)', [presupuestoId]),
  );
}

describe('listarPresupuestos (vista maestra, búsqueda y archivados)', () => {
  let empresaA: EmpresaRegistrada;
  let asistenteId: string;

  // Cinco presupuestos: cuatro a la vista y uno archivado; uno de los cuatro ACTIVO.
  before(async () => {
    empresaA = await registrarEmpresaDePrueba('Constructora Lista A', '900000052-2', 'pre.lista.a@construsoft.test');
    asistenteId = await crearAsistente(empresaA, 'pre.lista.asistente@construsoft.test', 'Asistente de lista');
    const contexto = { tenantId: empresaA.tenantId, usuarioId: empresaA.usuarioId };
    const nuevo = (codigo: string, nombre: string) =>
      crearPresupuesto(contexto, { codigo, nombre, ubicacion: 'Antioquia', modoEstructura: 'WBS' });

    await nuevo('OBRA-001', 'Casa campestre');
    await nuevo('OBRA-002', 'Casa urbana');
    await nuevo('OBRA-003', 'Bodega');
    const colegio = await nuevo('LIC-004', 'Colegio');
    await archivarPresupuesto(contexto, colegio.id);
    const puente = await nuevo('PUE-005', 'Puente');
    await ponerMilDeCostoDirecto(empresaA, puente.id, await crearApuDeMil(empresaA));
    await activar(empresaA, puente.id);
  });

  const contexto = () => ({ tenantId: empresaA.tenantId, usuarioId: empresaA.usuarioId });
  const codigos = (lista: Presupuesto[]) => lista.map((p) => p.codigo).sort();

  test('sin filtros: los cuatro no archivados, nunca el archivado (RF-PRE-01, D-18)', async () => {
    assert.deepEqual(codigos(await listarPresupuestos(contexto())), ['OBRA-001', 'OBRA-002', 'OBRA-003', 'PUE-005']);
  });

  test('busca por nombre: dos de cuatro (RF-PRE-02)', async () => {
    assert.deepEqual(codigos(await listarPresupuestos(contexto(), { texto: 'casa' })), ['OBRA-001', 'OBRA-002']);
  });

  test('busca por código, en minúsculas y a medias: tres de cuatro (RF-PRE-02)', async () => {
    assert.deepEqual(codigos(await listarPresupuestos(contexto(), { texto: 'obra-00' })), [
      'OBRA-001',
      'OBRA-002',
      'OBRA-003',
    ]);
  });

  test('filtra por estado: un ACTIVO, tres ABIERTOS (RF-PRE-02)', async () => {
    assert.deepEqual(codigos(await listarPresupuestos(contexto(), { estado: 'ACTIVO' })), ['PUE-005']);
    assert.deepEqual(codigos(await listarPresupuestos(contexto(), { estado: 'ABIERTO' })), [
      'OBRA-001',
      'OBRA-002',
      'OBRA-003',
    ]);
  });

  test('«Ver archivados» muestra el archivado, y la búsqueda no lo encuentra sin ese filtro (RF-PRE-39)', async () => {
    assert.deepEqual(codigos(await listarPresupuestos(contexto(), { archivados: true })), ['LIC-004']);
    assert.deepEqual(codigos(await listarPresupuestos(contexto(), { texto: 'colegio' })), []);
    assert.deepEqual(codigos(await listarPresupuestos(contexto(), { texto: 'colegio', archivados: true })), ['LIC-004']);
  });

  test('sin PRESUPUESTOS.VER: no lista', async () => {
    await assert.rejects(
      listarPresupuestos({ tenantId: empresaA.tenantId, usuarioId: asistenteId }),
      /PRESUPUESTOS\.VER/,
    );
  });

  test('aislamiento: otra empresa no ve estos presupuestos, ni listando ni buscando', async () => {
    const empresaB = await registrarEmpresaDePrueba('Constructora Lista B', '900000053-3', 'pre.lista.b@construsoft.test');
    const contextoB = { tenantId: empresaB.tenantId, usuarioId: empresaB.usuarioId };
    await crearPresupuesto(contextoB, {
      codigo: 'OBRA-001',
      nombre: 'Casa de B',
      ubicacion: 'Cali',
      modoEstructura: 'ITEMS',
    });
    assert.deepEqual(codigos(await listarPresupuestos(contextoB)), ['OBRA-001']);
    assert.deepEqual((await listarPresupuestos(contextoB, { texto: 'casa' })).map((p) => p.nombre), ['Casa de B']);
    assert.deepEqual(codigos(await listarPresupuestos(contextoB, { archivados: true })), []);
  });
});

describe('editarCabecera / editarPorcentajes / cambiarModoEstructura / archivar', () => {
  let empresaA: EmpresaRegistrada;
  let asistenteId: string;
  let apuDeMil: Apu;
  let secuencia = 0;

  before(async () => {
    empresaA = await registrarEmpresaDePrueba('Constructora Edicion A', '900000054-4', 'pre.edicion.a@construsoft.test');
    asistenteId = await crearAsistente(empresaA, 'pre.edicion.asistente@construsoft.test', 'Asistente de edición');
    apuDeMil = await crearApuDeMil(empresaA);
  });

  const contexto = () => ({ tenantId: empresaA.tenantId, usuarioId: empresaA.usuarioId });

  async function nuevo(): Promise<Presupuesto> {
    secuencia += 1;
    return crearPresupuesto(contexto(), {
      codigo: `ED-${secuencia}`,
      nombre: `Edición ${secuencia}`,
      ubicacion: 'Medellín',
      modoEstructura: 'WBS',
    });
  }

  const porcentajes = { aiuAdministracion: '10', aiuImprevistos: '5', aiuUtilidad: '5', ivaUtilidadPct: '19' };

  test('editarCabecera cambia código, nombre y ubicación (RF-PRE-38)', async () => {
    const presupuesto = await nuevo();
    const editado = await editarCabecera(contexto(), presupuesto.id, {
      codigo: 'ED-RENOMBRADO',
      nombre: 'Casa campestre El Retiro',
      ubicacion: 'El Retiro',
    });
    assert.deepEqual(
      { codigo: editado!.codigo, nombre: editado!.nombre, ubicacion: editado!.ubicacion },
      { codigo: 'ED-RENOMBRADO', nombre: 'Casa campestre El Retiro', ubicacion: 'El Retiro' },
    );
    assert.deepEqual(await leerPresupuesto(contexto(), presupuesto.id), editado);
  });

  test('los mismos validadores al crear y al editar: código repetido y texto en blanco los rechaza la base (RF-PRE-38)', async () => {
    const otro = await nuevo();
    const presupuesto = await nuevo();

    await assert.rejects(
      editarCabecera(contexto(), presupuesto.id, { codigo: otro.codigo, nombre: 'x', ubicacion: 'x' }),
      /presupuesto_tenant_id_codigo_key/,
    );
    await assert.rejects(
      editarCabecera(contexto(), presupuesto.id, { codigo: presupuesto.codigo, nombre: '   ', ubicacion: 'x' }),
      /ck_presupuesto_texto_no_vacio/,
    );
    await assert.rejects(
      crearPresupuesto(contexto(), { codigo: 'ED-BLANCO', nombre: 'x', ubicacion: '  ', modoEstructura: 'WBS' }),
      /ck_presupuesto_texto_no_vacio/,
    );
    assert.deepEqual(await leerPresupuesto(contexto(), presupuesto.id), presupuesto);
  });

  test('editarPorcentajes: la base recalcula A, I, U, IVA y valor total sobre el costo directo (RF-PRE-22/23/43)', async () => {
    const presupuesto = await nuevo();
    await ponerMilDeCostoDirecto(empresaA, presupuesto.id, apuDeMil);

    const editado = await editarPorcentajes(contexto(), presupuesto.id, porcentajes);
    assert.deepEqual(
      {
        cd: editado!.totalCostoDirecto,
        a: editado!.totalAdministracion,
        i: editado!.totalImprevistos,
        u: editado!.totalUtilidad,
        aiu: editado!.totalAiu,
        iva: editado!.totalIva,
        total: editado!.valorTotal,
        sinBase: editado!.sinBaseAiu,
        aiuEnCero: editado!.aiuEnCero,
      },
      {
        cd: '1000.000000',
        a: '100.000000',
        i: '50.000000',
        u: '50.000000',
        aiu: '200.000000',
        iva: '9.500000',
        total: '1209.500000',
        sinBase: false,
        aiuEnCero: false,
      },
    );
  });

  test('con AIU configurado y sin costo directo, sinBaseAiu lo marca la base (RF-PRE-36)', async () => {
    const presupuesto = await nuevo();
    const editado = await editarPorcentajes(contexto(), presupuesto.id, {
      aiuAdministracion: '10',
      aiuImprevistos: '0',
      aiuUtilidad: '0',
      ivaUtilidadPct: '19',
    });
    assert.equal(editado!.sinBaseAiu, true);
    assert.equal(editado!.totalAiu, '0.000000');
  });

  test('cambiar de EDT a ítems se rechaza con subcapítulos, nombrando cuántos, y funciona sin ellos (RF-PRE-44)', async () => {
    const conSub = await nuevo();
    const capitulo = await agregarCapitulo(contexto(), conSub.id, { nombre: 'OBRA', clasificacion: 'DIRECTO' });
    await agregarSubcapitulo(contexto(), capitulo.id, { nombre: 'Sub' });
    await assert.rejects(cambiarModoEstructura(contexto(), conSub.id, 'ITEMS'), /tiene 1 subcapítulo/);
    assert.equal((await leerPresupuesto(contexto(), conSub.id))!.modoEstructura, 'WBS');

    const sinSub = await nuevo();
    assert.equal((await cambiarModoEstructura(contexto(), sinSub.id, 'ITEMS'))!.modoEstructura, 'ITEMS');
  });

  test('archivar y desarchivar, en cualquier estado; ACTIVO no deja editar cabecera, porcentajes ni modo (D-18, RN-04)', async () => {
    const presupuesto = await nuevo();
    await ponerMilDeCostoDirecto(empresaA, presupuesto.id, apuDeMil);
    await activar(empresaA, presupuesto.id);
    const activo = (await leerPresupuesto(contexto(), presupuesto.id))!;

    await assert.rejects(
      editarCabecera(contexto(), presupuesto.id, { codigo: 'ED-X', nombre: 'x', ubicacion: 'x' }),
      /estado ACTIVO/,
    );
    await assert.rejects(editarPorcentajes(contexto(), presupuesto.id, porcentajes), /estado ACTIVO/);
    await assert.rejects(cambiarModoEstructura(contexto(), presupuesto.id, 'ITEMS'), /estado ACTIVO/);
    assert.deepEqual(await leerPresupuesto(contexto(), presupuesto.id), activo);

    const archivado = (await archivarPresupuesto(contexto(), presupuesto.id))!;
    assert.ok(archivado.archivadoEn instanceof Date);
    assert.equal(archivado.estado, 'ACTIVO');
    const desarchivado = (await desarchivarPresupuesto(contexto(), presupuesto.id))!;
    assert.equal(desarchivado.archivadoEn, null);
    assert.equal(desarchivado.estado, 'ACTIVO');
  });

  test('sin PRESUPUESTOS.EDITAR no se edita, reconfigura ni archiva nada', async () => {
    const presupuesto = await nuevo();
    const asistente = { tenantId: empresaA.tenantId, usuarioId: asistenteId };
    await assert.rejects(
      editarCabecera(asistente, presupuesto.id, { codigo: 'ED-X', nombre: 'x', ubicacion: 'x' }),
      /PRESUPUESTOS\.EDITAR/,
    );
    await assert.rejects(editarPorcentajes(asistente, presupuesto.id, porcentajes), /PRESUPUESTOS\.EDITAR/);
    await assert.rejects(cambiarModoEstructura(asistente, presupuesto.id, 'ITEMS'), /PRESUPUESTOS\.EDITAR/);
    await assert.rejects(archivarPresupuesto(asistente, presupuesto.id), /PRESUPUESTOS\.EDITAR/);
    await assert.rejects(desarchivarPresupuesto(asistente, presupuesto.id), /PRESUPUESTOS\.EDITAR/);
    assert.deepEqual(await leerPresupuesto(contexto(), presupuesto.id), presupuesto);
  });

  test('aislamiento: otra empresa no edita, reconfigura ni archiva este presupuesto con su id exacto', async () => {
    const empresaB = await registrarEmpresaDePrueba('Constructora Edicion B', '900000055-5', 'pre.edicion.b@construsoft.test');
    const contextoB = { tenantId: empresaB.tenantId, usuarioId: empresaB.usuarioId };
    const presupuesto = await nuevo();

    assert.equal(
      await editarCabecera(contextoB, presupuesto.id, { codigo: 'INTRUSO', nombre: 'x', ubicacion: 'x' }),
      null,
    );
    assert.equal(await editarPorcentajes(contextoB, presupuesto.id, porcentajes), null);
    assert.equal(await cambiarModoEstructura(contextoB, presupuesto.id, 'ITEMS'), null);
    assert.equal(await archivarPresupuesto(contextoB, presupuesto.id), null);
    assert.deepEqual(await leerPresupuesto(contexto(), presupuesto.id), presupuesto);
  });
});

/**
 * La marca de tiempo viaja como Date, con resolución de milisegundos. Dos
 * operaciones seguidas pueden caer en el mismo milisegundo; la espera evita
 * que «no se movió» se confunda con «se movió dentro del mismo milisegundo».
 */
const esperar = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

describe('fecha_modificacion (D-58): la mueve el contenido, nunca archivar', () => {
  let empresaA: EmpresaRegistrada;
  let secuencia = 0;

  before(async () => {
    empresaA = await registrarEmpresaDePrueba('Constructora Fecha A', '900000056-6', 'pre.fecha.a@construsoft.test');
  });

  const contexto = () => ({ tenantId: empresaA.tenantId, usuarioId: empresaA.usuarioId });
  const fecha = async (id: string) => (await leerPresupuesto(contexto(), id))!.fechaModificacion.getTime();

  async function nuevo(): Promise<Presupuesto> {
    secuencia += 1;
    return crearPresupuesto(contexto(), {
      codigo: `FE-${secuencia}`,
      nombre: `Fecha ${secuencia}`,
      ubicacion: 'Medellín',
      modoEstructura: 'WBS',
    });
  }

  /** Corre la operación y devuelve si la fecha avanzó. */
  async function avanza(id: string, operacion: () => Promise<unknown>): Promise<boolean> {
    const antes = await fecha(id);
    await esperar(5);
    await operacion();
    return (await fecha(id)) > antes;
  }

  test('la cabecera y los porcentajes la mueven (RF-PRE-07)', async () => {
    const p = await nuevo();
    assert.equal(await avanza(p.id, () => editarCabecera(contexto(), p.id, { codigo: p.codigo, nombre: 'Otro', ubicacion: 'X' })), true);
    assert.equal(
      await avanza(p.id, () =>
        editarPorcentajes(contexto(), p.id, { aiuAdministracion: '1', aiuImprevistos: '0', aiuUtilidad: '0', ivaUtilidadPct: '19' }),
      ),
      true,
    );
  });

  test('la estructura la mueve: agregar, renombrar, reordenar y eliminar (RF-PRE-07)', async () => {
    const p = await nuevo();
    let a = '';
    assert.equal(
      await avanza(p.id, async () => {
        a = (await agregarCapitulo(contexto(), p.id, { nombre: 'A', clasificacion: 'DIRECTO' })).id;
      }),
      true,
    );
    await agregarCapitulo(contexto(), p.id, { nombre: 'B', clasificacion: 'DIRECTO' });
    assert.equal(await avanza(p.id, () => renombrarNivel(contexto(), a, 'A renombrado')), true);
    assert.equal(await avanza(p.id, () => moverEnEdt(contexto(), a, 2)), true);
    assert.equal(await avanza(p.id, () => eliminarNivel(contexto(), a)), true);
  });

  test('archivar y desarchivar NO la mueven: cambian la visibilidad, no el contenido', async () => {
    const p = await nuevo();
    assert.equal(await avanza(p.id, () => archivarPresupuesto(contexto(), p.id)), false);
    assert.equal(await avanza(p.id, () => desarchivarPresupuesto(contexto(), p.id)), false);
  });

  test('la aplicación no puede escribirla: una marca que el llamador elige no es una marca', async () => {
    const p = await nuevo();
    const antes = await fecha(p.id);
    await assert.rejects(
      montarEscenarioComoAdmin(empresaA, 'PRESUPUESTOS.EDITAR', (cliente) =>
        cliente.query(`UPDATE app.presupuesto SET fecha_modificacion = '2020-01-01' WHERE id = $1`, [p.id]),
      ),
      /permiso denegado|permission denied/,
    );
    assert.equal(await fecha(p.id), antes);
  });

  test('la vista maestra sigue al contenido: desarchivar una licitación vieja no la sube (ix_presupuesto_estado)', async () => {
    const empresaB = await registrarEmpresaDePrueba('Constructora Fecha B', '900000057-7', 'pre.fecha.b@construsoft.test');
    const contextoB = { tenantId: empresaB.tenantId, usuarioId: empresaB.usuarioId };
    const nuevoEnB = (codigo: string) =>
      crearPresupuesto(contextoB, { codigo, nombre: codigo, ubicacion: 'Cali', modoEstructura: 'WBS' });
    const orden = async () => (await listarPresupuestos(contextoB)).map((p) => p.codigo);

    const vieja = await nuevoEnB('LICITACION-VIEJA');
    await esperar(5);
    await nuevoEnB('OBRA-RECIENTE');
    assert.deepEqual(await orden(), ['OBRA-RECIENTE', 'LICITACION-VIEJA']);

    await esperar(5);
    await archivarPresupuesto(contextoB, vieja.id);
    await desarchivarPresupuesto(contextoB, vieja.id);
    assert.deepEqual(await orden(), ['OBRA-RECIENTE', 'LICITACION-VIEJA']);

    await esperar(5);
    await editarCabecera(contextoB, vieja.id, { codigo: vieja.codigo, nombre: 'Retomada', ubicacion: 'Cali' });
    assert.deepEqual(await orden(), ['LICITACION-VIEJA', 'OBRA-RECIENTE']);
  });
});
