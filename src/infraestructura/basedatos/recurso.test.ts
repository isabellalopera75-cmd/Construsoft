import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ejecutarConPermiso,
  registrarEmpresa,
  type ClienteEnContexto,
  type CodigoPermiso,
  type EmpresaRegistrada,
} from './contextoTenant.js';
import {
  actualizarRecurso,
  crearRecurso,
  eliminarRecurso,
  leerRecurso,
  listarPresupuestosAfectados,
  listarRecursos,
} from './recurso.js';

/**
 * Mismo patrón autocontenido que los demás archivos de prueba de este
 * proyecto: email/NIT propios, sin importar fixtures de otros archivos.
 */
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

/**
 * El permiso ya no es un comodín fijo: cada llamado declara el que de
 * verdad describe la operación que está montando (RECURSOS.CREAR para
 * sembrar un recurso, CONFIG.PREFERENCIAS para leer una unidad de medida,
 * USUARIOS.GESTIONAR para crear un usuario) — el administrador los tiene
 * los 18 igual, pero el nombre del código deja de ser ruido.
 */
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

/** El rol Asistente nace con fn_alta_tenant sin ningún permiso (D-44): el fixture "sin permiso" listo para usar. */
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
    const rolAsistenteId = roles[0]!.id;
    const { rows } = await cliente.query<{ id: string }>(
      `INSERT INTO app.usuario (tenant_id, rol_id, nombre, email, password_hash, estado)
       VALUES ($1, $2, $3, $4, 'hash_de_prueba_no_real', 'ACTIVO')
       RETURNING id`,
      [empresa.tenantId, rolAsistenteId, nombre, email],
    );
    return rows[0]!.id;
  });
}

/** fn_alta_tenant precarga doce unidades estándar (D-15): basta con leer una, no hace falta crearla. */
async function leerUnaUnidad(empresa: EmpresaRegistrada): Promise<string> {
  return montarEscenarioComoAdmin(empresa, 'CONFIG.PREFERENCIAS', async (cliente) => {
    const { rows } = await cliente.query<{ id: string }>(
      `SELECT id FROM app.unidad_medida WHERE tenant_id = $1 ORDER BY simbolo LIMIT 1`,
      [empresa.tenantId],
    );
    return rows[0]!.id;
  });
}

describe('crearRecurso', () => {
  let empresaA: EmpresaRegistrada;
  let unidadId: string;
  let asistenteId: string;

  before(async () => {
    empresaA = await registrarEmpresaDePrueba(
      'Constructora Recurso A',
      '900000030-0',
      'valeria@construsoft.test',
    );
    unidadId = await leerUnaUnidad(empresaA);
    asistenteId = await crearAsistente(empresaA, 'victoria@construsoft.test', 'Victoria Asistente');
  });

  test('con el permiso: crea el recurso con un código de app.fn_siguiente_codigo (RF-REC-02/06/11)', async () => {
    const contexto = { tenantId: empresaA.tenantId, usuarioId: empresaA.usuarioId };
    const recurso = await crearRecurso(contexto, {
      nombre: 'Cemento gris tipo I',
      tipo: 'MATERIAL',
      unidadId,
      precioBase: '10000',
      ivaPct: '19',
      precioTotal: '11900',
      viaCaptura: 'BASE',
    });

    assert.match(recurso.codigo, /^REC-\d{4,}$/);
    assert.equal(recurso.nombre, 'Cemento gris tipo I');
    assert.equal(recurso.tipo, 'MATERIAL');
    assert.equal(recurso.unidadId, unidadId);
    assert.equal(recurso.viaCaptura, 'BASE');
    assert.equal(recurso.activo, true);
  });

  test('dos recursos seguidos reciben códigos consecutivos, sin importar la vía de captura', async () => {
    const contexto = { tenantId: empresaA.tenantId, usuarioId: empresaA.usuarioId };
    const primero = await crearRecurso(contexto, {
      nombre: 'Arena de río',
      tipo: 'MATERIAL',
      unidadId,
      precioBase: '5000',
      ivaPct: '19',
      precioTotal: '5950',
      viaCaptura: 'BASE',
    });
    // Vía TOTAL: 100000 / 1.19 = 84033.613445 (redondeado a 6 decimales),
    // el camino inverso de ck_recurso_precios_cuadran.
    const segundo = await crearRecurso(contexto, {
      nombre: 'Retroexcavadora',
      tipo: 'EQUIPO',
      unidadId,
      precioBase: '84033.613445',
      ivaPct: '19',
      precioTotal: '100000',
      viaCaptura: 'TOTAL',
    });

    const numero = (codigo: string) => Number(codigo.split('-')[1]);
    assert.equal(numero(segundo.codigo), numero(primero.codigo) + 1);
  });

  test('IVA vacío: 0% dado explícito, y los dos precios coinciden (RF-REC-08)', async () => {
    const contexto = { tenantId: empresaA.tenantId, usuarioId: empresaA.usuarioId };
    const recurso = await crearRecurso(contexto, {
      nombre: 'Jornal oficial',
      tipo: 'PERSONAL',
      unidadId,
      precioBase: '80000',
      ivaPct: '0',
      precioTotal: '80000',
      viaCaptura: 'BASE',
    });
    assert.equal(recurso.precioBase, recurso.precioTotal);
  });

  test('la base rechaza un precio que no cuadra con la vía declarada (ck_recurso_precios_cuadran)', async () => {
    const contexto = { tenantId: empresaA.tenantId, usuarioId: empresaA.usuarioId };
    await assert.rejects(
      crearRecurso(contexto, {
        nombre: 'Recurso con precio inventado',
        tipo: 'MATERIAL',
        unidadId,
        precioBase: '100',
        ivaPct: '19',
        precioTotal: '500',
        viaCaptura: 'BASE',
      }),
      /ck_recurso_precios_cuadran/,
    );
  });

  test('sin RECURSOS.CREAR: no crea nada', async () => {
    const contextoAsistente = { tenantId: empresaA.tenantId, usuarioId: asistenteId };
    await assert.rejects(
      crearRecurso(contextoAsistente, {
        nombre: 'no debería crearse',
        tipo: 'MATERIAL',
        unidadId,
        precioBase: '1',
        ivaPct: '0',
        precioTotal: '1',
        viaCaptura: 'BASE',
      }),
      /RECURSOS\.CREAR/,
    );
  });

  test('aislamiento: el permiso de una empresa no crea recursos en otra', async () => {
    const empresaB = await registrarEmpresaDePrueba(
      'Constructora Recurso B',
      '900000031-1',
      'walter@construsoft.test',
    );

    // El administrador de B tiene RECURSOS.CREAR de verdad, pero en SU
    // PROPIA empresa. Mezclado con el tenant de A, RLS esconde su fila de
    // app.usuario y fn_exigir_permiso falla cerrado antes de llegar al INSERT.
    await assert.rejects(
      crearRecurso(
        { tenantId: empresaA.tenantId, usuarioId: empresaB.usuarioId },
        {
          nombre: 'no debería crearse',
          tipo: 'MATERIAL',
          unidadId,
          precioBase: '1',
          ivaPct: '0',
          precioTotal: '1',
          viaCaptura: 'BASE',
        },
      ),
      /no existe en esta empresa/,
    );
  });
});

/** Una de las doce unidades estándar de D-15, por símbolo exacto — para tener dos unidades distintas y probar el filtro. */
async function leerUnidadPorSimbolo(empresa: EmpresaRegistrada, simbolo: string): Promise<string> {
  return montarEscenarioComoAdmin(empresa, 'CONFIG.PREFERENCIAS', async (cliente) => {
    const { rows } = await cliente.query<{ id: string }>(
      `SELECT id FROM app.unidad_medida WHERE tenant_id = $1 AND simbolo = $2`,
      [empresa.tenantId, simbolo],
    );
    return rows[0]!.id;
  });
}

describe('leerRecurso / listarRecursos', () => {
  let empresaC: EmpresaRegistrada;
  let unidadKg: string;
  let unidadHr: string;
  let asistenteId: string;
  let cementoGris: Awaited<ReturnType<typeof crearRecurso>>;

  before(async () => {
    empresaC = await registrarEmpresaDePrueba(
      'Constructora Recurso C',
      '900000032-2',
      'ximena@construsoft.test',
    );
    unidadKg = await leerUnidadPorSimbolo(empresaC, 'Kg');
    unidadHr = await leerUnidadPorSimbolo(empresaC, 'Hr');
    asistenteId = await crearAsistente(empresaC, 'ximeno@construsoft.test', 'Ximeno Asistente');

    const contexto = { tenantId: empresaC.tenantId, usuarioId: empresaC.usuarioId };
    cementoGris = await crearRecurso(contexto, {
      nombre: 'Cemento gris tipo I',
      tipo: 'MATERIAL',
      unidadId: unidadKg,
      precioBase: '10000',
      ivaPct: '19',
      precioTotal: '11900',
      viaCaptura: 'BASE',
    });
    await crearRecurso(contexto, {
      nombre: 'Cemento blanco especial',
      tipo: 'MATERIAL',
      unidadId: unidadKg,
      precioBase: '20000',
      ivaPct: '19',
      precioTotal: '23800',
      viaCaptura: 'BASE',
    });
    await crearRecurso(contexto, {
      nombre: 'Retroexcavadora 320D',
      tipo: 'EQUIPO',
      unidadId: unidadHr,
      precioBase: '150000',
      ivaPct: '19',
      precioTotal: '178500',
      viaCaptura: 'BASE',
    });
    await crearRecurso(contexto, {
      nombre: 'Jornal oficial',
      tipo: 'PERSONAL',
      unidadId: unidadHr,
      precioBase: '80000',
      ivaPct: '0',
      precioTotal: '80000',
      viaCaptura: 'BASE',
    });
  });

  test('listar sin filtros: devuelve los cuatro recursos de la empresa (RF-REC-04)', async () => {
    const recursos = await listarRecursos({ tenantId: empresaC.tenantId, usuarioId: empresaC.usuarioId });
    assert.equal(recursos.length, 4);
  });

  test('filtra por tipo', async () => {
    const materiales = await listarRecursos(
      { tenantId: empresaC.tenantId, usuarioId: empresaC.usuarioId },
      { tipo: 'MATERIAL' },
    );
    assert.equal(materiales.length, 2);
    assert.ok(materiales.every((recurso) => recurso.tipo === 'MATERIAL'));
  });

  test('busca por texto y rompe el filtro por pestañas (RF-REC-03): sin tipo, cruza los cuatro tipos', async () => {
    const resultado = await listarRecursos(
      { tenantId: empresaC.tenantId, usuarioId: empresaC.usuarioId },
      { texto: 'cemento' },
    );
    assert.equal(resultado.length, 2);
    assert.ok(resultado.every((recurso) => recurso.nombre.toLowerCase().includes('cemento')));
  });

  test('filtra por unidad', async () => {
    const enHoras = await listarRecursos(
      { tenantId: empresaC.tenantId, usuarioId: empresaC.usuarioId },
      { unidadId: unidadHr },
    );
    assert.equal(enHoras.length, 2);
    assert.ok(enHoras.every((recurso) => recurso.unidadId === unidadHr));
  });

  test('filtra por rango de precio', async () => {
    const caros = await listarRecursos(
      { tenantId: empresaC.tenantId, usuarioId: empresaC.usuarioId },
      { precioMin: '100000', precioMax: '200000' },
    );
    assert.equal(caros.length, 1);
    assert.equal(caros[0]!.nombre, 'Retroexcavadora 320D');
  });

  test('leerRecurso: una fila por id', async () => {
    const recurso = await leerRecurso(
      { tenantId: empresaC.tenantId, usuarioId: empresaC.usuarioId },
      cementoGris.id,
    );
    assert.ok(recurso);
    assert.equal(recurso.nombre, 'Cemento gris tipo I');
    assert.equal(recurso.codigo, cementoGris.codigo);
  });

  test('leerRecurso: el que no existe da null, no un error', async () => {
    const recurso = await leerRecurso(
      { tenantId: empresaC.tenantId, usuarioId: empresaC.usuarioId },
      '00000000-0000-0000-0000-000000000000',
    );
    assert.equal(recurso, null);
  });

  test('sin RECURSOS.VER: ni listar ni leer corren', async () => {
    const contextoAsistente = { tenantId: empresaC.tenantId, usuarioId: asistenteId };
    await assert.rejects(listarRecursos(contextoAsistente), /RECURSOS\.VER/);
    await assert.rejects(leerRecurso(contextoAsistente, cementoGris.id), /RECURSOS\.VER/);
  });

  test('aislamiento: otra empresa no ve estos recursos ni con el id exacto', async () => {
    const empresaD = await registrarEmpresaDePrueba(
      'Constructora Recurso D',
      '900000033-3',
      'yolanda@construsoft.test',
    );
    const contextoD = { tenantId: empresaD.tenantId, usuarioId: empresaD.usuarioId };

    const listaDesdeD = await listarRecursos(contextoD);
    assert.equal(listaDesdeD.length, 0);

    const leidoDesdeD = await leerRecurso(contextoD, cementoGris.id);
    assert.equal(leidoDesdeD, null);
  });
});

/**
 * Fixtures de APU para simular "recurso en uso" (RF-REC-13), sin esperar al
 * módulo de APU: llaman directo a app.fn_nueva_version_apu, la única puerta
 * de versionado (D-21/D-22), con el permiso que de verdad describe cada
 * paso — APU.CREAR para el alta, APU.EDITAR para una versión nueva del
 * mismo APU — aunque ese módulo todavía no exista como superficie propia.
 */
async function crearApuConLinea(
  empresa: EmpresaRegistrada,
  nombre: string,
  unidadId: string,
  recursoId: string,
): Promise<string> {
  return montarEscenarioComoAdmin(empresa, 'APU.CREAR', async (cliente) => {
    const { rows: filasCodigo } = await cliente.query<{ fn_siguiente_codigo: string }>(
      `SELECT app.fn_siguiente_codigo($1, 'APU')`,
      [empresa.tenantId],
    );
    const { rows } = await cliente.query<{ id: string }>(
      `INSERT INTO app.apu (tenant_id, codigo, nombre, unidad_id, creado_por)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [empresa.tenantId, filasCodigo[0]!.fn_siguiente_codigo, nombre, unidadId, empresa.usuarioId],
    );
    const apuId = rows[0]!.id;
    const lineas = JSON.stringify([
      { recurso_id: recursoId, cantidad: '1', rendimiento: '1', desperdicio_pct: '0' },
    ]);
    await cliente.query(
      `SELECT app.fn_nueva_version_apu($1, $2::jsonb, NULL, NULL, 'fixture de prueba')`,
      [apuId, lineas],
    );
    return apuId;
  });
}

/** Versiona de nuevo el mismo APU con otro recurso: el anterior queda solo en la versión histórica, ya no vigente. */
async function reversionarApuConOtroRecurso(
  empresa: EmpresaRegistrada,
  apuId: string,
  recursoId: string,
): Promise<void> {
  await montarEscenarioComoAdmin(empresa, 'APU.EDITAR', async (cliente) => {
    const lineas = JSON.stringify([
      { recurso_id: recursoId, cantidad: '1', rendimiento: '1', desperdicio_pct: '0' },
    ]);
    await cliente.query(
      `SELECT app.fn_nueva_version_apu($1, $2::jsonb, NULL, NULL, 'segunda versión de prueba')`,
      [apuId, lineas],
    );
  });
}

describe('eliminarRecurso', () => {
  let empresaE: EmpresaRegistrada;
  let unidadId: string;
  let asistenteId: string;

  before(async () => {
    empresaE = await registrarEmpresaDePrueba(
      'Constructora Recurso E',
      '900000034-4',
      'zoe@construsoft.test',
    );
    unidadId = await leerUnaUnidad(empresaE);
    asistenteId = await crearAsistente(empresaE, 'zenon@construsoft.test', 'Zenón Asistente');
  });

  async function crearRecursoDePrueba(nombre: string) {
    return crearRecurso(
      { tenantId: empresaE.tenantId, usuarioId: empresaE.usuarioId },
      { nombre, tipo: 'MATERIAL', unidadId, precioBase: '1000', ivaPct: '0', precioTotal: '1000', viaCaptura: 'BASE' },
    );
  }

  test('con el permiso: elimina un recurso que no está en uso', async () => {
    const contexto = { tenantId: empresaE.tenantId, usuarioId: empresaE.usuarioId };
    const recurso = await crearRecursoDePrueba('Recurso sin uso');

    await eliminarRecurso(contexto, recurso.id);

    assert.equal(await leerRecurso(contexto, recurso.id), null);
  });

  test('RF-REC-13: no elimina un recurso en uso en la versión vigente de un APU', async () => {
    const contexto = { tenantId: empresaE.tenantId, usuarioId: empresaE.usuarioId };
    const recurso = await crearRecursoDePrueba('Recurso en uso');
    await crearApuConLinea(empresaE, 'APU que usa el recurso', unidadId, recurso.id);

    await assert.rejects(eliminarRecurso(contexto, recurso.id), /interviene en/);
    assert.ok(await leerRecurso(contexto, recurso.id));
  });

  test('RF-REC-13: tampoco elimina si el uso quedó solo en una versión histórica, ya no vigente', async () => {
    const contexto = { tenantId: empresaE.tenantId, usuarioId: empresaE.usuarioId };
    const recursoHistorico = await crearRecursoDePrueba('Recurso que queda histórico');
    const recursoReemplazo = await crearRecursoDePrueba('Recurso de reemplazo');
    const apuId = await crearApuConLinea(empresaE, 'APU reversionado', unidadId, recursoHistorico.id);

    // La versión 2 ya no referencia a recursoHistorico: queda solo en la
    // versión 1, que dejó de ser la vigente. fn_eliminar_recurso cuenta
    // también eso (su propio comentario: "incluidas versiones históricas").
    await reversionarApuConOtroRecurso(empresaE, apuId, recursoReemplazo.id);

    await assert.rejects(eliminarRecurso(contexto, recursoHistorico.id), /interviene en/);
  });

  test('sin RECURSOS.ELIMINAR: no elimina nada', async () => {
    const contexto = { tenantId: empresaE.tenantId, usuarioId: empresaE.usuarioId };
    const recurso = await crearRecursoDePrueba('Recurso protegido por permiso');

    await assert.rejects(
      eliminarRecurso({ tenantId: empresaE.tenantId, usuarioId: asistenteId }, recurso.id),
      /RECURSOS\.ELIMINAR/,
    );
    assert.ok(await leerRecurso(contexto, recurso.id));
  });

  test('aislamiento: no elimina el recurso de otra empresa ni con el id exacto', async () => {
    const empresaF = await registrarEmpresaDePrueba(
      'Constructora Recurso F',
      '900000035-5',
      'ariel@construsoft.test',
    );
    const contextoE = { tenantId: empresaE.tenantId, usuarioId: empresaE.usuarioId };
    const recursoDeE = await crearRecursoDePrueba('Recurso de E');

    // fn_eliminar_recurso corre como construsoft_owner (NO BYPASSRLS): desde
    // el tenant de F, RLS le esconde la fila de E antes de que la función
    // llegue a comprobar nada por su cuenta.
    await assert.rejects(
      eliminarRecurso({ tenantId: empresaF.tenantId, usuarioId: empresaF.usuarioId }, recursoDeE.id),
      /no existe en esta empresa/,
    );
    assert.ok(await leerRecurso(contextoE, recursoDeE.id));
  });
});

/** El id de la versión vigente de un APU y su costo_directo — para comprobar si actualizarRecurso versionó o no. */
async function leerVersionVigente(
  empresa: EmpresaRegistrada,
  apuId: string,
): Promise<{ versionId: string; costoDirecto: string }> {
  return montarEscenarioComoAdmin(empresa, 'APU.VER', async (cliente) => {
    const { rows } = await cliente.query<{ version_vigente_id: string; costo_directo: string }>(
      `SELECT a.version_vigente_id, v.costo_directo
         FROM app.apu a JOIN app.apu_version v ON v.id = a.version_vigente_id
        WHERE a.id = $1`,
      [apuId],
    );
    const fila = rows[0]!;
    return { versionId: fila.version_vigente_id, costoDirecto: fila.costo_directo };
  });
}

/**
 * Presupuesto con un solo capítulo y un solo ítem que usa la versión
 * vigente de `apuId` — el mínimo de app.wbs_nodo + app.presupuesto_item que
 * fn_propagar_recurso necesita para tener algo que reapuntar (RF-REC-12).
 *
 * La línea base solo se puede insertar mientras el presupuesto sigue
 * ABIERTO (tg_linea_base_item/tg_linea_base_wbs, RN-04): por eso el
 * contenido se arma primero, y ACTIVAR o CERRAR pasa recién después, con
 * las funciones reales — nunca con un UPDATE directo sobre `estado`, que el
 * rol de la aplicación no tiene (modelo P4).
 */
async function crearPresupuestoConItem(
  empresa: EmpresaRegistrada,
  codigo: string,
  apuId: string,
  estado: 'ABIERTO' | 'ACTIVO' | 'CERRADO',
): Promise<{ presupuestoId: string; itemId: string }> {
  const { presupuestoId, itemId } = await montarEscenarioComoAdmin(
    empresa,
    'PRESUPUESTOS.CREAR',
    async (cliente) => {
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
         VALUES ($1, $2, $3, 'Bogotá', 'COP', $4)
         RETURNING id`,
        [empresa.tenantId, codigo, `Presupuesto ${codigo}`, empresa.usuarioId],
      );
      const presupuestoId = filasPresupuesto[0]!.id;

      const { rows: filasNodo } = await cliente.query<{ id: string }>(
        `INSERT INTO app.wbs_nodo
               (tenant_id, presupuesto_id, orden, nivel, codigo_wbs, nombre, clasificacion)
         VALUES ($1, $2, 1, 1, '1.0', 'Capítulo único', 'DIRECTO')
         RETURNING id`,
        [empresa.tenantId, presupuestoId],
      );
      const wbsNodoId = filasNodo[0]!.id;

      const { rows: filasItem } = await cliente.query<{ id: string }>(
        `INSERT INTO app.presupuesto_item
               (tenant_id, presupuesto_id, wbs_nodo_id, orden, apu_id, apu_version_id,
                codigo_apu, descripcion, unidad_simbolo, precio_unitario, cantidad, costo_total)
         VALUES ($1, $2, $3, 1, $4, $5, $6, 'Ítem de prueba', $7, $8, 1, $8)
         RETURNING id`,
        [
          empresa.tenantId,
          presupuestoId,
          wbsNodoId,
          apuId,
          apu.version_vigente_id,
          apu.codigo,
          apu.unidad_simbolo,
          apu.costo_directo,
        ],
      );

      return { presupuestoId, itemId: filasItem[0]!.id };
    },
  );

  if (estado === 'ACTIVO' || estado === 'CERRADO') {
    await montarEscenarioComoAdmin(empresa, 'PRESUPUESTOS.ESTADO', (cliente) =>
      cliente.query('SELECT app.fn_activar_presupuesto($1)', [presupuestoId]),
    );
  }
  if (estado === 'CERRADO') {
    await montarEscenarioComoAdmin(empresa, 'PRESUPUESTOS.ESTADO', (cliente) =>
      cliente.query('SELECT app.fn_cerrar_presupuesto($1)', [presupuestoId]),
    );
  }

  return { presupuestoId, itemId };
}

/** El apu_version_id y precio_unitario de un ítem, para comprobar si actualizarRecurso lo reapuntó o lo dejó intacto. */
async function leerItem(
  empresa: EmpresaRegistrada,
  itemId: string,
): Promise<{ apuVersionId: string; precioUnitario: string }> {
  return montarEscenarioComoAdmin(empresa, 'PRESUPUESTOS.VER', async (cliente) => {
    const { rows } = await cliente.query<{ apu_version_id: string; precio_unitario: string }>(
      `SELECT apu_version_id, precio_unitario FROM app.presupuesto_item WHERE id = $1`,
      [itemId],
    );
    const fila = rows[0]!;
    return { apuVersionId: fila.apu_version_id, precioUnitario: fila.precio_unitario };
  });
}

describe('actualizarRecurso / listarPresupuestosAfectados', () => {
  let empresaG: EmpresaRegistrada;
  let unidadId: string;
  let asistenteId: string;
  let contadorPresupuesto = 0;

  before(async () => {
    empresaG = await registrarEmpresaDePrueba(
      'Constructora Recurso G',
      '900000036-6',
      'benito@construsoft.test',
    );
    unidadId = await leerUnaUnidad(empresaG);
    asistenteId = await crearAsistente(empresaG, 'berta@construsoft.test', 'Berta Asistente');
  });

  const contexto = () => ({ tenantId: empresaG.tenantId, usuarioId: empresaG.usuarioId });

  async function crearRecursoDePrueba(nombre: string, precio: string) {
    return crearRecurso(contexto(), {
      nombre,
      tipo: 'MATERIAL',
      unidadId,
      precioBase: precio,
      ivaPct: '0',
      precioTotal: precio,
      viaCaptura: 'BASE',
    });
  }

  function siguienteCodigoPresupuesto(): string {
    contadorPresupuesto += 1;
    return `PRE-G${contadorPresupuesto}`;
  }

  test('editar sin cambiar el precio no propaga: el APU en uso queda con la misma versión', async () => {
    const recurso = await crearRecursoDePrueba('Recurso para renombrar', '5000');
    const apuId = await crearApuConLinea(empresaG, 'APU sin cambio de precio', unidadId, recurso.id);
    const antes = await leerVersionVigente(empresaG, apuId);

    const resultado = await actualizarRecurso(contexto(), recurso.id, {
      nombre: 'Recurso renombrado',
      tipo: recurso.tipo,
      unidadId: recurso.unidadId,
      precioBase: recurso.precioBase,
      ivaPct: recurso.ivaPct,
      precioTotal: recurso.precioTotal,
      viaCaptura: recurso.viaCaptura,
    });

    assert.equal(resultado.apusVersionados, 0);
    assert.equal(resultado.recurso.nombre, 'Recurso renombrado');
    const despues = await leerVersionVigente(empresaG, apuId);
    assert.equal(despues.versionId, antes.versionId);
  });

  test('editar el precio de un recurso sin uso no versiona nada (fn_propagar_recurso es no-op)', async () => {
    const recurso = await crearRecursoDePrueba('Recurso sin uso para editar', '1000');

    const resultado = await actualizarRecurso(contexto(), recurso.id, {
      ...recurso,
      precioBase: '2000',
      precioTotal: '2000',
    });

    assert.equal(resultado.apusVersionados, 0);
    assert.equal(resultado.recurso.precioTotal, '2000.000000');
  });

  test('RF-REC-12: editar el precio de un recurso en uso versiona el APU y actualiza su costo_directo', async () => {
    const recurso = await crearRecursoDePrueba('Recurso en uso para editar', '1000');
    const apuId = await crearApuConLinea(empresaG, 'APU con cambio de precio', unidadId, recurso.id);
    const antes = await leerVersionVigente(empresaG, apuId);
    assert.equal(antes.costoDirecto, '1000.000000');

    const resultado = await actualizarRecurso(contexto(), recurso.id, {
      ...recurso,
      precioBase: '4000',
      precioTotal: '4000',
    });

    assert.equal(resultado.apusVersionados, 1);
    const despues = await leerVersionVigente(empresaG, apuId);
    assert.notEqual(despues.versionId, antes.versionId);
    assert.equal(despues.costoDirecto, '4000.000000');
  });

  test('listarPresupuestosAfectados: solo el ABIERTO aparece, nunca ACTIVO ni CERRADO', async () => {
    const recurso = await crearRecursoDePrueba('Recurso en tres presupuestos', '1000');
    const apuId = await crearApuConLinea(empresaG, 'APU en tres presupuestos', unidadId, recurso.id);

    const abierto = await crearPresupuestoConItem(empresaG, siguienteCodigoPresupuesto(), apuId, 'ABIERTO');
    await crearPresupuestoConItem(empresaG, siguienteCodigoPresupuesto(), apuId, 'ACTIVO');
    await crearPresupuestoConItem(empresaG, siguienteCodigoPresupuesto(), apuId, 'CERRADO');

    const afectados = await listarPresupuestosAfectados(contexto(), recurso.id);
    assert.equal(afectados.length, 1);
    assert.equal(afectados[0]!.id, abierto.presupuestoId);
  });

  test('reapunta el presupuesto ABIERTO elegido; ACTIVO y CERRADO no se mueven ni un céntimo aunque se los pase', async () => {
    const recurso = await crearRecursoDePrueba('Recurso reapuntado', '1000');
    const apuId = await crearApuConLinea(empresaG, 'APU reapuntado', unidadId, recurso.id);

    const abierto = await crearPresupuestoConItem(empresaG, siguienteCodigoPresupuesto(), apuId, 'ABIERTO');
    const activo = await crearPresupuestoConItem(empresaG, siguienteCodigoPresupuesto(), apuId, 'ACTIVO');
    const itemActivoAntes = await leerItem(empresaG, activo.itemId);

    await actualizarRecurso(
      contexto(),
      recurso.id,
      { ...recurso, precioBase: '3000', precioTotal: '3000' },
      // A propósito se pasan LOS DOS ids, incluido el de un presupuesto
      // ACTIVO: fn_propagar_recurso tiene que ignorarlo igual, sin que haga
      // falta que el llamador lo filtre primero.
      [abierto.presupuestoId, activo.presupuestoId],
    );

    const itemAbiertoDespues = await leerItem(empresaG, abierto.itemId);
    assert.equal(itemAbiertoDespues.precioUnitario, '3000.000000');

    const itemActivoDespues = await leerItem(empresaG, activo.itemId);
    assert.equal(itemActivoDespues.apuVersionId, itemActivoAntes.apuVersionId);
    assert.equal(itemActivoDespues.precioUnitario, itemActivoAntes.precioUnitario);
  });

  test('sin RECURSOS.EDITAR: ni actualizar ni listar presupuestos afectados corren', async () => {
    const recurso = await crearRecursoDePrueba('Recurso protegido por permiso', '1000');
    const contextoAsistente = { tenantId: empresaG.tenantId, usuarioId: asistenteId };

    await assert.rejects(
      actualizarRecurso(contextoAsistente, recurso.id, { ...recurso, nombre: 'no debería aplicarse' }),
      /RECURSOS\.EDITAR/,
    );
    await assert.rejects(listarPresupuestosAfectados(contextoAsistente, recurso.id), /RECURSOS\.EDITAR/);

    const sigueIgual = await leerRecurso(contexto(), recurso.id);
    assert.equal(sigueIgual!.nombre, 'Recurso protegido por permiso');
  });

  test('aislamiento: no edita el recurso de otra empresa ni con el id exacto', async () => {
    const empresaH = await registrarEmpresaDePrueba(
      'Constructora Recurso H',
      '900000037-7',
      'carola@construsoft.test',
    );
    const recurso = await crearRecursoDePrueba('Recurso de G', '1000');

    await assert.rejects(
      actualizarRecurso(
        { tenantId: empresaG.tenantId, usuarioId: empresaH.usuarioId },
        recurso.id,
        { ...recurso, nombre: 'no debería aplicarse' },
      ),
      /no existe en esta empresa/,
    );

    const sigueIgual = await leerRecurso(contexto(), recurso.id);
    assert.equal(sigueIgual!.nombre, 'Recurso de G');
  });
});
