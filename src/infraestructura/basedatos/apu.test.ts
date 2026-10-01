import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ejecutarConPermiso,
  registrarEmpresa,
  type ClienteEnContexto,
  type CodigoPermiso,
  type EmpresaRegistrada,
} from './contextoTenant.js';
import { crearRecurso, type Recurso } from './recurso.js';
import { crearPresupuesto } from './presupuesto.js';
import { agregarCapitulo } from './edt.js';
import { agregarActividad, leerActividades } from './actividad.js';
import {
  buscarApusParaActividad,
  crearApu,
  editarApu,
  leerApu,
  listarApus,
  listarPresupuestosDelApu,
  type Apu,
  type LineaApu,
} from './apu.js';

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
    versionTerminos: 'terminos-de-prueba',
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

/** Una de las doce unidades estándar de D-15, por símbolo exacto. */
async function leerUnidadPorSimbolo(empresa: EmpresaRegistrada, simbolo: string): Promise<string> {
  return montarEscenarioComoAdmin(empresa, 'CONFIG.PREFERENCIAS', async (cliente) => {
    const { rows } = await cliente.query<{ id: string }>(
      `SELECT id FROM app.unidad_medida WHERE tenant_id = $1 AND simbolo = $2`,
      [empresa.tenantId, simbolo],
    );
    return rows[0]!.id;
  });
}

/** Cuántos APU tiene la empresa: para comprobar que un rechazo no dejó ninguna cabecera suelta. */
async function contarApus(empresa: EmpresaRegistrada): Promise<number> {
  return montarEscenarioComoAdmin(empresa, 'APU.VER', async (cliente) => {
    const { rows } = await cliente.query<{ n: string }>(
      'SELECT count(*) AS n FROM app.apu WHERE tenant_id = $1',
      [empresa.tenantId],
    );
    return Number(rows[0]!.n);
  });
}

describe('crearApu / leerApu', () => {
  let empresaA: EmpresaRegistrada;
  let unidadM3: string;
  let asistenteId: string;
  let cemento: Recurso;
  let mezcladora: Recurso;

  before(async () => {
    empresaA = await registrarEmpresaDePrueba('Constructora APU A', '900000040-0', 'dario@construsoft.test');
    unidadM3 = await leerUnidadPorSimbolo(empresaA, 'm³');
    const unidadKg = await leerUnidadPorSimbolo(empresaA, 'Kg');
    const unidadHr = await leerUnidadPorSimbolo(empresaA, 'Hr');
    asistenteId = await crearAsistente(empresaA, 'daniela@construsoft.test', 'Daniela Asistente');

    const contexto = { tenantId: empresaA.tenantId, usuarioId: empresaA.usuarioId };
    cemento = await crearRecurso(contexto, {
      nombre: 'Cemento gris',
      tipo: 'MATERIAL',
      unidadId: unidadKg,
      precioBase: '10000',
      ivaPct: '19',
      precioTotal: '11900',
      viaCaptura: 'BASE',
    });
    mezcladora = await crearRecurso(contexto, {
      nombre: 'Mezcladora',
      tipo: 'EQUIPO',
      unidadId: unidadHr,
      precioBase: '100000',
      ivaPct: '0',
      precioTotal: '100000',
      viaCaptura: 'BASE',
    });
  });

  const contexto = () => ({ tenantId: empresaA.tenantId, usuarioId: empresaA.usuarioId });

  test('con el permiso: crea el APU con código del backend y la base calcula subtotales y costo directo', async () => {
    const apu = await crearApu(contexto(), {
      nombre: 'Concreto 3000 psi',
      unidadId: unidadM3,
      lineas: [
        // D-1 con el precio CON IVA: 2 × 1 × (1 + 5/100) × 11.900 = 24.990
        { recursoId: cemento.id, cantidad: '2', rendimiento: '1', desperdicioPct: '5' },
        // 1 × 0,5 × 1 × 100.000 = 50.000
        { recursoId: mezcladora.id, cantidad: '1', rendimiento: '0.5', desperdicioPct: '0' },
      ],
    });

    assert.match(apu.codigo, /^APU-\d{4,}$/);
    assert.equal(apu.nombre, 'Concreto 3000 psi');
    assert.equal(apu.numeroVersion, 1);
    assert.equal(apu.costoDirecto, '74990.000000');
    assert.equal(apu.lineas.length, 2);

    const [lineaCemento, lineaMezcladora] = apu.lineas;
    assert.equal(lineaCemento!.recursoCodigo, cemento.codigo);
    assert.equal(lineaCemento!.recursoTipo, 'MATERIAL');
    assert.equal(lineaCemento!.unidadSimbolo, 'Kg');
    assert.equal(lineaCemento!.precioUnitario, '11900.000000');
    assert.equal(lineaCemento!.subtotal, '24990.000000');
    assert.equal(lineaMezcladora!.subtotal, '50000.000000');
  });

  test('leerApu devuelve la cabecera y la composición de la versión vigente', async () => {
    const creado = await crearApu(contexto(), {
      nombre: 'Mortero 1:4',
      unidadId: unidadM3,
      lineas: [{ recursoId: cemento.id, cantidad: '1', rendimiento: '1', desperdicioPct: '0' }],
    });

    const leido = await leerApu(contexto(), creado.id);
    assert.ok(leido);
    assert.equal(leido.codigo, creado.codigo);
    assert.equal(leido.versionVigenteId, creado.versionVigenteId);
    assert.equal(leido.costoDirecto, '11900.000000');
    assert.equal(leido.lineas.length, 1);
  });

  test('leerApu: el que no existe da null, no un error', async () => {
    assert.equal(await leerApu(contexto(), '00000000-0000-0000-0000-000000000000'), null);
  });

  test('la base rechaza la composición vacía, y no queda ninguna cabecera suelta (RF-APU-22)', async () => {
    const antes = await contarApus(empresaA);
    await assert.rejects(
      crearApu(contexto(), { nombre: 'APU vacío', unidadId: unidadM3, lineas: [] }),
      /sin recursos/,
    );
    assert.equal(await contarApus(empresaA), antes);
  });

  test('la base rechaza desperdicio en un recurso que no es MATERIAL (RF-APU-07)', async () => {
    const antes = await contarApus(empresaA);
    await assert.rejects(
      crearApu(contexto(), {
        nombre: 'APU con desperdicio indebido',
        unidadId: unidadM3,
        lineas: [{ recursoId: mezcladora.id, cantidad: '1', rendimiento: '1', desperdicioPct: '5' }],
      }),
      /ck_desperdicio_solo_material/,
    );
    assert.equal(await contarApus(empresaA), antes);
  });

  test('la base rechaza cantidad cero (RF-APU-19)', async () => {
    await assert.rejects(
      crearApu(contexto(), {
        nombre: 'APU con cantidad cero',
        unidadId: unidadM3,
        lineas: [{ recursoId: cemento.id, cantidad: '0', rendimiento: '1', desperdicioPct: '0' }],
      }),
      /ck_avr_cantidad_minima/,
    );
  });

  test('sin APU.CREAR no crea nada; sin APU.VER no lee', async () => {
    const contextoAsistente = { tenantId: empresaA.tenantId, usuarioId: asistenteId };
    const antes = await contarApus(empresaA);
    await assert.rejects(
      crearApu(contextoAsistente, {
        nombre: 'no debería crearse',
        unidadId: unidadM3,
        lineas: [{ recursoId: cemento.id, cantidad: '1', rendimiento: '1', desperdicioPct: '0' }],
      }),
      /APU\.CREAR/,
    );
    assert.equal(await contarApus(empresaA), antes);

    const existente = await crearApu(contexto(), {
      nombre: 'APU para leer sin permiso',
      unidadId: unidadM3,
      lineas: [{ recursoId: cemento.id, cantidad: '1', rendimiento: '1', desperdicioPct: '0' }],
    });
    await assert.rejects(leerApu(contextoAsistente, existente.id), /APU\.VER/);
  });

  test('aislamiento: ni leer un APU ajeno con su id exacto, ni componer con un recurso de otra empresa', async () => {
    const empresaB = await registrarEmpresaDePrueba('Constructora APU B', '900000041-1', 'elias@construsoft.test');
    const contextoB = { tenantId: empresaB.tenantId, usuarioId: empresaB.usuarioId };
    const unidadDeB = await leerUnidadPorSimbolo(empresaB, 'm³');

    const apuDeA = await crearApu(contexto(), {
      nombre: 'APU de A',
      unidadId: unidadM3,
      lineas: [{ recursoId: cemento.id, cantidad: '1', rendimiento: '1', desperdicioPct: '0' }],
    });
    assert.equal(await leerApu(contextoB, apuDeA.id), null);

    // B con sus propios permisos, pero con una línea que apunta al cemento de
    // A: fn_nueva_version_apu corre bajo RLS y no lo encuentra.
    const antesEnB = await contarApus(empresaB);
    await assert.rejects(
      crearApu(contextoB, {
        nombre: 'APU con recurso ajeno',
        unidadId: unidadDeB,
        lineas: [{ recursoId: cemento.id, cantidad: '1', rendimiento: '1', desperdicioPct: '0' }],
      }),
      /no existe en esta empresa/,
    );
    assert.equal(await contarApus(empresaB), antesEnB);
  });
});

/**
 * Versiona un APU con otra composición llamando directo a la única puerta de
 * versionado. Es montaje: la edición de verdad (editarApu) es el paso 4.
 */
async function versionarConCantidad(
  empresa: EmpresaRegistrada,
  apuId: string,
  recursoId: string,
  cantidad: string,
): Promise<void> {
  await montarEscenarioComoAdmin(empresa, 'APU.EDITAR', async (cliente) => {
    const lineas = JSON.stringify([
      { recurso_id: recursoId, cantidad, rendimiento: '1', desperdicio_pct: '0' },
    ]);
    await cliente.query(
      `SELECT app.fn_nueva_version_apu($1, $2::jsonb, NULL, NULL, 'versión de prueba')`,
      [apuId, lineas],
    );
  });
}

/**
 * Seis APU sobre tres unidades. Ningún filtro de estas pruebas puede
 * devolver 6 —el catálogo entero de la empresa— salvo el de "sin filtros":
 * un conteo igual al total no distinguiría "filtró bien" de "no filtró".
 */
describe('listarApus', () => {
  let empresaC: EmpresaRegistrada;
  let unidadM3: string;
  let unidadM2: string;
  let asistenteId: string;
  let cemento: Recurso;
  let concreto3000: Apu;

  before(async () => {
    empresaC = await registrarEmpresaDePrueba('Constructora APU C', '900000042-2', 'fermin@construsoft.test');
    unidadM3 = await leerUnidadPorSimbolo(empresaC, 'm³');
    unidadM2 = await leerUnidadPorSimbolo(empresaC, 'm²');
    const unidadUnd = await leerUnidadPorSimbolo(empresaC, 'Und');
    const unidadKg = await leerUnidadPorSimbolo(empresaC, 'Kg');
    asistenteId = await crearAsistente(empresaC, 'fernanda@construsoft.test', 'Fernanda Asistente');

    const contexto = { tenantId: empresaC.tenantId, usuarioId: empresaC.usuarioId };
    cemento = await crearRecurso(contexto, {
      nombre: 'Cemento gris',
      tipo: 'MATERIAL',
      unidadId: unidadKg,
      precioBase: '10000',
      ivaPct: '0',
      precioTotal: '10000',
      viaCaptura: 'BASE',
    });

    const conCemento = (cantidad: string) => [
      { recursoId: cemento.id, cantidad, rendimiento: '1', desperdicioPct: '0' },
    ];
    concreto3000 = await crearApu(contexto, { nombre: 'Concreto 3000 psi', unidadId: unidadM3, lineas: conCemento('1') });
    await crearApu(contexto, { nombre: 'Concreto 4000 psi', unidadId: unidadM3, lineas: conCemento('2') });
    await crearApu(contexto, { nombre: 'Concreto para andenes', unidadId: unidadM2, lineas: conCemento('3') });
    await crearApu(contexto, { nombre: 'Mortero 1:4', unidadId: unidadM3, lineas: conCemento('4') });
    await crearApu(contexto, { nombre: 'Pañete liso', unidadId: unidadM2, lineas: conCemento('5') });
    await crearApu(contexto, { nombre: 'Punto eléctrico', unidadId: unidadUnd, lineas: conCemento('6') });
  });

  const contexto = () => ({ tenantId: empresaC.tenantId, usuarioId: empresaC.usuarioId });

  test('sin filtros: el inventario completo, los seis (RF-APU-01)', async () => {
    const apus = await listarApus(contexto());
    assert.equal(apus.length, 6);
  });

  test('busca por nombre: tres de seis', async () => {
    const concretos = await listarApus(contexto(), { texto: 'concreto' });
    assert.equal(concretos.length, 3);
    assert.ok(concretos.every((apu) => apu.nombre.startsWith('Concreto')));
  });

  test('busca por código completo, en minúsculas o solo el número: uno de seis (RF-APU-02)', async () => {
    const numero = concreto3000.codigo.split('-')[1]!;
    for (const texto of [concreto3000.codigo, concreto3000.codigo.toLowerCase(), numero]) {
      const resultado = await listarApus(contexto(), { texto });
      assert.equal(resultado.length, 1, `buscando «${texto}»`);
      assert.equal(resultado[0]!.id, concreto3000.id);
    }
  });

  test('filtra por unidad: tres en m³, dos en m² (RF-APU-03)', async () => {
    assert.equal((await listarApus(contexto(), { unidadId: unidadM3 })).length, 3);
    assert.equal((await listarApus(contexto(), { unidadId: unidadM2 })).length, 2);
  });

  test('texto y unidad se combinan: los concretos en m³ son dos', async () => {
    const resultado = await listarApus(contexto(), { texto: 'concreto', unidadId: unidadM3 });
    assert.equal(resultado.length, 2);
  });

  test('muestra el costo de la versión vigente, una fila por APU aunque tenga varias versiones (RF-APU-17)', async () => {
    const antes = (await listarApus(contexto())).find((apu) => apu.id === concreto3000.id)!;
    assert.equal(antes.costoDirecto, '10000.000000');
    assert.equal(antes.numeroVersion, 1);

    await versionarConCantidad(empresaC, concreto3000.id, cemento.id, '7');

    const despues = await listarApus(contexto());
    // Un join a apu_version sin atarse a la vigente devolvería 7 filas.
    assert.equal(despues.length, 6);
    const vigente = despues.find((apu) => apu.id === concreto3000.id)!;
    assert.equal(vigente.costoDirecto, '70000.000000');
    assert.equal(vigente.numeroVersion, 2);
    assert.equal(vigente.codigo, concreto3000.codigo);
  });

  test('sin APU.VER: no lista', async () => {
    await assert.rejects(
      listarApus({ tenantId: empresaC.tenantId, usuarioId: asistenteId }),
      /APU\.VER/,
    );
  });

  test('aislamiento: otra empresa no ve estos APU, ni listando ni buscando', async () => {
    const empresaD = await registrarEmpresaDePrueba('Constructora APU D', '900000043-3', 'gilberto@construsoft.test');
    const contextoD = { tenantId: empresaD.tenantId, usuarioId: empresaD.usuarioId };
    assert.equal((await listarApus(contextoD)).length, 0);
    assert.equal((await listarApus(contextoD, { texto: 'concreto' })).length, 0);
    assert.equal((await listarApus(contextoD, { texto: concreto3000.codigo })).length, 0);
  });
});

/**
 * Presupuesto con un capítulo y un ítem sobre la versión vigente de `apuId`.
 * La línea base solo se escribe mientras el presupuesto está ABIERTO
 * (tg_linea_base_item/wbs), así que el contenido va primero y ACTIVAR o
 * CERRAR después, con las funciones reales: el rol de la aplicación no
 * tiene UPDATE sobre presupuesto.estado (modelo P4).
 */
async function crearPresupuestoConItem(
  empresa: EmpresaRegistrada,
  codigo: string,
  apuId: string,
  estado: 'ABIERTO' | 'ACTIVO' | 'CERRADO',
): Promise<{ presupuestoId: string; itemId: string }> {
  const creado = await montarEscenarioComoAdmin(empresa, 'PRESUPUESTOS.CREAR', async (cliente) => {
    const { rows: filasApu } = await cliente.query<{
      codigo: string;
      version_vigente_id: string;
      unidad_simbolo: string;
      costo_directo: string;
    }>(
      `SELECT a.codigo, a.version_vigente_id, v.unidad_simbolo, v.costo_directo
         FROM app.apu a JOIN app.apu_version v ON v.id = a.version_vigente_id
        WHERE a.id = $1`,
      [apuId],
    );
    const apu = filasApu[0]!;
    const { rows: filasPresupuesto } = await cliente.query<{ id: string }>(
      `INSERT INTO app.presupuesto (tenant_id, codigo, nombre, ubicacion, moneda, creado_por)
       VALUES ($1, $2, $3, 'Medellín', 'COP', $4)
       RETURNING id`,
      [empresa.tenantId, codigo, `Presupuesto ${codigo}`, empresa.usuarioId],
    );
    const presupuestoId = filasPresupuesto[0]!.id;
    const { rows: filasNodo } = await cliente.query<{ id: string }>(
      `INSERT INTO app.wbs_nodo (tenant_id, presupuesto_id, nombre, clasificacion)
       VALUES ($1, $2, 'Capítulo único', 'DIRECTO')
       RETURNING id`,
      [empresa.tenantId, presupuestoId],
    );
    const { rows: filasItem } = await cliente.query<{ id: string }>(
      `INSERT INTO app.presupuesto_item
             (tenant_id, presupuesto_id, wbs_nodo_id, apu_id, apu_version_id,
              codigo_apu, descripcion, unidad_simbolo, precio_unitario, cantidad)
       VALUES ($1, $2, $3, $4, $5, $6, 'Ítem de prueba', $7, $8, 1)
       RETURNING id`,
      [
        empresa.tenantId,
        presupuestoId,
        filasNodo[0]!.id,
        apuId,
        apu.version_vigente_id,
        apu.codigo,
        apu.unidad_simbolo,
        apu.costo_directo,
      ],
    );
    return { presupuestoId, itemId: filasItem[0]!.id };
  });

  if (estado === 'ACTIVO' || estado === 'CERRADO') {
    await montarEscenarioComoAdmin(empresa, 'PRESUPUESTOS.ESTADO', (cliente) =>
      cliente.query('SELECT app.fn_activar_presupuesto($1)', [creado.presupuestoId]),
    );
  }
  if (estado === 'CERRADO') {
    await montarEscenarioComoAdmin(empresa, 'PRESUPUESTOS.ESTADO', (cliente) =>
      cliente.query('SELECT app.fn_cerrar_presupuesto($1)', [creado.presupuestoId]),
    );
  }
  return creado;
}

interface FotoDelItem {
  apuVersionId: string;
  precioUnitario: string;
  costoTotal: string;
  totalCostoDirectoDelPresupuesto: string;
}

/** El ítem y el total de su presupuesto: todo lo que "no moverse ni un céntimo" tiene que dejar igual. */
async function fotografiarItem(empresa: EmpresaRegistrada, itemId: string): Promise<FotoDelItem> {
  return montarEscenarioComoAdmin(empresa, 'PRESUPUESTOS.VER', async (cliente) => {
    const { rows } = await cliente.query<{
      apu_version_id: string;
      precio_unitario: string;
      costo_total: string;
      total_costo_directo: string;
    }>(
      `SELECT i.apu_version_id, i.precio_unitario, i.costo_total, p.total_costo_directo
         FROM app.presupuesto_item i
         JOIN app.presupuesto p ON p.id = i.presupuesto_id
        WHERE i.id = $1`,
      [itemId],
    );
    const fila = rows[0]!;
    return {
      apuVersionId: fila.apu_version_id,
      precioUnitario: fila.precio_unitario,
      costoTotal: fila.costo_total,
      totalCostoDirectoDelPresupuesto: fila.total_costo_directo,
    };
  });
}

describe('editarApu / listarPresupuestosDelApu', () => {
  let empresaE: EmpresaRegistrada;
  let unidadM3: string;
  let unidadM2: string;
  let asistenteId: string;
  let cemento: Recurso;
  let contadorPresupuesto = 0;

  before(async () => {
    empresaE = await registrarEmpresaDePrueba('Constructora APU E', '900000044-4', 'hector@construsoft.test');
    unidadM3 = await leerUnidadPorSimbolo(empresaE, 'm³');
    unidadM2 = await leerUnidadPorSimbolo(empresaE, 'm²');
    const unidadKg = await leerUnidadPorSimbolo(empresaE, 'Kg');
    asistenteId = await crearAsistente(empresaE, 'helena@construsoft.test', 'Helena Asistente');
    cemento = await crearRecurso(
      { tenantId: empresaE.tenantId, usuarioId: empresaE.usuarioId },
      {
        nombre: 'Cemento gris',
        tipo: 'MATERIAL',
        unidadId: unidadKg,
        precioBase: '10000',
        ivaPct: '0',
        precioTotal: '10000',
        viaCaptura: 'BASE',
      },
    );
  });

  const contexto = () => ({ tenantId: empresaE.tenantId, usuarioId: empresaE.usuarioId });
  const conCemento = (cantidad: string): LineaApu[] => [
    { recursoId: cemento.id, cantidad, rendimiento: '1', desperdicioPct: '0' },
  ];
  const siguienteCodigo = () => `PRE-E${++contadorPresupuesto}`;

  test('listarPresupuestosDelApu: los tres vinculados con su estado, y no el que usa otro APU (RF-APU-13)', async () => {
    const apu = await crearApu(contexto(), { nombre: 'APU en tres presupuestos', unidadId: unidadM3, lineas: conCemento('1') });
    const otroApu = await crearApu(contexto(), { nombre: 'Otro APU', unidadId: unidadM3, lineas: conCemento('1') });
    const abierto = await crearPresupuestoConItem(empresaE, siguienteCodigo(), apu.id, 'ABIERTO');
    const activo = await crearPresupuestoConItem(empresaE, siguienteCodigo(), apu.id, 'ACTIVO');
    const cerrado = await crearPresupuestoConItem(empresaE, siguienteCodigo(), apu.id, 'CERRADO');
    await crearPresupuestoConItem(empresaE, siguienteCodigo(), otroApu.id, 'ABIERTO');

    const vinculados = await listarPresupuestosDelApu(contexto(), apu.id);
    assert.equal(vinculados.length, 3);
    const estadoDe = (id: string) => vinculados.find((p) => p.id === id)?.estado;
    assert.equal(estadoDe(abierto.presupuestoId), 'ABIERTO');
    assert.equal(estadoDe(activo.presupuestoId), 'ACTIVO');
    assert.equal(estadoDe(cerrado.presupuestoId), 'CERRADO');
  });

  test('RF-APU-14..16: con los tres ids en la lista a propósito, se reapunta solo el ABIERTO; ACTIVO y CERRADO no se mueven ni un céntimo', async () => {
    const apu = await crearApu(contexto(), { nombre: 'APU editado', unidadId: unidadM3, lineas: conCemento('1') });
    const abierto = await crearPresupuestoConItem(empresaE, siguienteCodigo(), apu.id, 'ABIERTO');
    const activo = await crearPresupuestoConItem(empresaE, siguienteCodigo(), apu.id, 'ACTIVO');
    const cerrado = await crearPresupuestoConItem(empresaE, siguienteCodigo(), apu.id, 'CERRADO');

    const activoAntes = await fotografiarItem(empresaE, activo.itemId);
    const cerradoAntes = await fotografiarItem(empresaE, cerrado.itemId);
    assert.equal((await fotografiarItem(empresaE, abierto.itemId)).totalCostoDirectoDelPresupuesto, '10000.000000');

    const resultado = await editarApu(
      contexto(),
      apu.id,
      { nombre: 'APU editado', unidadId: unidadM3, lineas: conCemento('3') },
      [abierto.presupuestoId, activo.presupuestoId, cerrado.presupuestoId],
    );

    // fn_reapuntar_apu devuelve cuántos ítems movió: exactamente uno.
    assert.equal(resultado.itemsReapuntados, 1);
    assert.equal(resultado.apu.numeroVersion, 2);
    assert.equal(resultado.apu.costoDirecto, '30000.000000');
    assert.equal(resultado.apu.codigo, apu.codigo); // RF-APU-18

    // El ABIERTO pasa a la versión nueva, con precio, costo y total recalculados.
    const abiertoDespues = await fotografiarItem(empresaE, abierto.itemId);
    assert.equal(abiertoDespues.apuVersionId, resultado.apu.versionVigenteId);
    assert.equal(abiertoDespues.precioUnitario, '30000.000000');
    assert.equal(abiertoDespues.costoTotal, '30000.000000');
    assert.equal(abiertoDespues.totalCostoDirectoDelPresupuesto, '30000.000000');

    // ACTIVO y CERRADO: idénticos, campo por campo, incluido el total.
    assert.deepEqual(await fotografiarItem(empresaE, activo.itemId), activoAntes);
    assert.deepEqual(await fotografiarItem(empresaE, cerrado.itemId), cerradoAntes);
  });

  test('RF-APU-17: si no se reapunta nada, la versión nueva se crea igual y el ABIERTO queda exactamente como estaba', async () => {
    const apu = await crearApu(contexto(), { nombre: 'APU sin reapuntar', unidadId: unidadM3, lineas: conCemento('1') });
    const abierto = await crearPresupuestoConItem(empresaE, siguienteCodigo(), apu.id, 'ABIERTO');
    const antes = await fotografiarItem(empresaE, abierto.itemId);

    const resultado = await editarApu(contexto(), apu.id, {
      nombre: 'APU sin reapuntar',
      unidadId: unidadM3,
      lineas: conCemento('2'),
    });

    assert.equal(resultado.itemsReapuntados, 0);
    assert.equal(resultado.apu.numeroVersion, 2);
    assert.equal(resultado.apu.costoDirecto, '20000.000000');
    assert.deepEqual(await fotografiarItem(empresaE, abierto.itemId), antes);
  });

  test('cambiar la unidad de un APU en uso lo rechaza la base, y no queda ninguna versión nueva', async () => {
    const apu = await crearApu(contexto(), { nombre: 'APU en uso, unidad fija', unidadId: unidadM3, lineas: conCemento('1') });
    await crearPresupuestoConItem(empresaE, siguienteCodigo(), apu.id, 'ABIERTO');

    await assert.rejects(
      editarApu(contexto(), apu.id, { nombre: apu.nombre, unidadId: unidadM2, lineas: conCemento('1') }),
      /su unidad no se cambia/,
    );
    assert.equal((await leerApu(contexto(), apu.id))!.numeroVersion, 1);
  });

  test('sin APU.EDITAR: ni editar ni listar vínculos, y el APU sigue en su versión', async () => {
    const apu = await crearApu(contexto(), { nombre: 'APU protegido', unidadId: unidadM3, lineas: conCemento('1') });
    const contextoAsistente = { tenantId: empresaE.tenantId, usuarioId: asistenteId };

    await assert.rejects(
      editarApu(contextoAsistente, apu.id, { nombre: 'no debería aplicarse', unidadId: unidadM3, lineas: conCemento('9') }),
      /APU\.EDITAR/,
    );
    await assert.rejects(listarPresupuestosDelApu(contextoAsistente, apu.id), /APU\.EDITAR/);

    const sigue = (await leerApu(contexto(), apu.id))!;
    assert.equal(sigue.numeroVersion, 1);
    assert.equal(sigue.nombre, 'APU protegido');
  });

  test('aislamiento: otra empresa no edita este APU, ni mezclando contextos ni con el id exacto desde el suyo', async () => {
    const empresaF = await registrarEmpresaDePrueba('Constructora APU F', '900000045-5', 'ines@construsoft.test');
    const apu = await crearApu(contexto(), { nombre: 'APU de E', unidadId: unidadM3, lineas: conCemento('1') });
    const cambio = { nombre: 'no debería aplicarse', unidadId: unidadM3, lineas: conCemento('9') };

    // El usuario de F mezclado con el tenant de E: lo frena fn_exigir_permiso.
    await assert.rejects(
      editarApu({ tenantId: empresaE.tenantId, usuarioId: empresaF.usuarioId }, apu.id, cambio),
      /no existe en esta empresa/,
    );
    // F en su propio contexto, con el id exacto del APU de E: lo frena
    // fn_nueva_version_apu, que bajo RLS no encuentra el APU.
    await assert.rejects(
      editarApu({ tenantId: empresaF.tenantId, usuarioId: empresaF.usuarioId }, apu.id, cambio),
      /no existe en esta empresa/,
    );
    assert.equal(
      (await listarPresupuestosDelApu({ tenantId: empresaF.tenantId, usuarioId: empresaF.usuarioId }, apu.id)).length,
      0,
    );

    const sigue = (await leerApu(contexto(), apu.id))!;
    assert.equal(sigue.numeroVersion, 1);
    assert.equal(sigue.nombre, 'APU de E');
  });
});

describe('buscarApusParaActividad: el buscador de «+ Agregar Actividad» no ofrece inactivos', () => {
  let empresaA: EmpresaRegistrada;
  let asistenteId: string;
  let morteroInactivo: Apu;

  // Tres morteros (uno inactivo) y un concreto: el buscador de la mesa ve dos, la vista maestra tres.
  before(async () => {
    empresaA = await registrarEmpresaDePrueba('Constructora Buscador A', '900000046-6', 'apu.buscador.a@construsoft.test');
    asistenteId = await crearAsistente(empresaA, 'apu.buscador.asistente@construsoft.test', 'Asistente del buscador');
    const contexto = { tenantId: empresaA.tenantId, usuarioId: empresaA.usuarioId };
    const unidadM3 = await leerUnidadPorSimbolo(empresaA, 'm³');
    const arena = await crearRecurso(contexto, {
      nombre: 'Arena',
      tipo: 'MATERIAL',
      unidadId: unidadM3,
      precioBase: '50000',
      ivaPct: '0',
      precioTotal: '50000',
      viaCaptura: 'BASE',
    });
    const nuevo = (nombre: string) =>
      crearApu(contexto, {
        nombre,
        unidadId: unidadM3,
        lineas: [{ recursoId: arena.id, cantidad: '1', rendimiento: '1', desperdicioPct: '0' }],
      });
    await nuevo('Mortero 1:3');
    await nuevo('Mortero 1:4');
    morteroInactivo = await nuevo('Mortero 1:5 descontinuado');
    await nuevo('Concreto ciclópeo');
    await montarEscenarioComoAdmin(empresaA, 'APU.EDITAR', (cliente) =>
      cliente.query('UPDATE app.apu SET activo = false WHERE id = $1', [morteroInactivo.id]),
    );
  });

  const contexto = () => ({ tenantId: empresaA.tenantId, usuarioId: empresaA.usuarioId });
  const nombres = (lista: { nombre: string }[]) => lista.map((a) => a.nombre).sort();

  test('por nombre: dos de los tres morteros, nunca el inactivo; la vista maestra sigue mostrando los tres', async () => {
    assert.deepEqual(nombres(await buscarApusParaActividad(contexto(), 'mortero')), ['Mortero 1:3', 'Mortero 1:4']);
    assert.deepEqual(nombres(await listarApus(contexto(), { texto: 'mortero' })), [
      'Mortero 1:3',
      'Mortero 1:4',
      'Mortero 1:5 descontinuado',
    ]);
  });

  test('por el código exacto del inactivo: cero', async () => {
    assert.deepEqual(await buscarApusParaActividad(contexto(), morteroInactivo.codigo), []);
  });

  test('la base sigue permitiendo el APU inactivo en un presupuesto: el filtro es del buscador, no una restricción', async () => {
    const presupuesto = await crearPresupuesto(contexto(), {
      codigo: 'BUS-1',
      nombre: 'Con un APU desactivado después',
      ubicacion: 'Medellín',
      modoEstructura: 'ITEMS',
    });
    const capitulo = await agregarCapitulo(contexto(), presupuesto.id, { nombre: 'OBRA', clasificacion: 'DIRECTO' });
    await agregarActividad(contexto(), capitulo.id, morteroInactivo.id, '2');
    assert.deepEqual(
      (await leerActividades(contexto(), presupuesto.id)).map((a) => [a.codigoItem, a.descripcion]),
      [['1.1', 'Mortero 1:5 descontinuado']],
    );
  });

  test('sin APU.VER el buscador no devuelve una lista vacía muda: el rechazo dice qué permiso falta y a quién pedirlo', async () => {
    await assert.rejects(
      buscarApusParaActividad({ tenantId: empresaA.tenantId, usuarioId: asistenteId }, 'mortero'),
      /Su rol no tiene el permiso «APU\.VER»\. Pídale a un administrador/,
    );
  });

  test('aislamiento: otra empresa no encuentra estos APU', async () => {
    const empresaB = await registrarEmpresaDePrueba('Constructora Buscador B', '900000047-7', 'apu.buscador.b@construsoft.test');
    assert.deepEqual(
      await buscarApusParaActividad({ tenantId: empresaB.tenantId, usuarioId: empresaB.usuarioId }, 'mortero'),
      [],
    );
  });
});
