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
import { crearApu } from './apu.js';
import { crearPresupuesto, type ModoEstructura } from './presupuesto.js';
import {
  agregarCapitulo,
  agregarSubcapitulo,
  eliminarNivel,
  leerContenidoDelNivel,
  leerEdt,
  moverEnEdt,
  reclasificarCapitulo,
  renombrarNivel,
  type NodoEdt,
} from './edt.js';

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

/** Cuántos nodos tiene la empresa en total: para comprobar que un rechazo no dejó nada. */
async function contarNodos(empresa: EmpresaRegistrada): Promise<number> {
  return montarEscenarioComoAdmin(empresa, 'PRESUPUESTOS.VER', async (cliente) => {
    const { rows } = await cliente.query<{ n: string }>(
      'SELECT count(*) AS n FROM app.wbs_nodo WHERE tenant_id = $1',
      [empresa.tenantId],
    );
    return Number(rows[0]!.n);
  });
}

/** La EDT reducida a lo que decide la numeración: código, nombre, nivel y clasificación efectiva. */
function forma(edt: NodoEdt[]): Array<[string, string, number, string]> {
  return edt.map((nodo) => [nodo.codigoWbs, nodo.nombre, nodo.nivel, nodo.clasificacion]);
}

describe('EDT: capítulos, subcapítulos, clasificación, reordenar y eliminar', () => {
  let empresaA: EmpresaRegistrada;
  let asistenteId: string;
  let secuencia = 0;

  before(async () => {
    empresaA = await registrarEmpresaDePrueba('Constructora EDT A', '900000060-0', 'edt.hector@construsoft.test');
    asistenteId = await crearAsistente(empresaA, 'edt.helena@construsoft.test', 'Helena Asistente');
  });

  const contexto = () => ({ tenantId: empresaA.tenantId, usuarioId: empresaA.usuarioId });

  /** Cada prueba trabaja sobre su propio presupuesto: los códigos de la EDT no se contaminan entre pruebas. */
  async function nuevoPresupuesto(modo: ModoEstructura = 'WBS'): Promise<string> {
    secuencia += 1;
    const creado = await crearPresupuesto(contexto(), {
      codigo: `EDT-${secuencia}`,
      nombre: `Presupuesto EDT ${secuencia}`,
      ubicacion: 'Medellín',
      modoEstructura: modo,
    });
    return creado.id;
  }

  test('los capítulos se numeran solos 1.0, 2.0, 3.0 y nacen con la clasificación elegida (RF-PRE-11/12/19)', async () => {
    const presupuestoId = await nuevoPresupuesto();
    const preliminares = await agregarCapitulo(contexto(), presupuestoId, {
      nombre: 'PRELIMINARES',
      clasificacion: 'INDIRECTO',
    });
    await agregarCapitulo(contexto(), presupuestoId, { nombre: 'CIMENTACIÓN', clasificacion: 'DIRECTO' });
    await agregarCapitulo(contexto(), presupuestoId, { nombre: 'ESTRUCTURA', clasificacion: 'DIRECTO' });

    assert.deepEqual(
      { codigo: preliminares.codigoWbs, nivel: preliminares.nivel, padre: preliminares.padreId },
      { codigo: '1.0', nivel: 1, padre: null },
    );
    assert.deepEqual(forma(await leerEdt(contexto(), presupuestoId)), [
      ['1.0', 'PRELIMINARES', 1, 'INDIRECTO'],
      ['2.0', 'CIMENTACIÓN', 1, 'DIRECTO'],
      ['3.0', 'ESTRUCTURA', 1, 'DIRECTO'],
    ]);
  });

  test('los subcapítulos se numeran 2.1, 2.2, 2.1.1 y heredan la clasificación del raíz (RF-PRE-13/20)', async () => {
    const presupuestoId = await nuevoPresupuesto();
    await agregarCapitulo(contexto(), presupuestoId, { nombre: 'PRELIMINARES', clasificacion: 'INDIRECTO' });
    const cimentacion = await agregarCapitulo(contexto(), presupuestoId, {
      nombre: 'CIMENTACIÓN',
      clasificacion: 'DIRECTO',
    });
    const concretos = await agregarSubcapitulo(contexto(), cimentacion.id, { nombre: 'Concretos' });
    await agregarSubcapitulo(contexto(), cimentacion.id, { nombre: 'Aceros' });
    await agregarSubcapitulo(contexto(), concretos.id, { nombre: 'Zapatas' });

    assert.deepEqual(forma(await leerEdt(contexto(), presupuestoId)), [
      ['1.0', 'PRELIMINARES', 1, 'INDIRECTO'],
      ['2.0', 'CIMENTACIÓN', 1, 'DIRECTO'],
      ['2.1', 'Concretos', 2, 'DIRECTO'],
      ['2.1.1', 'Zapatas', 3, 'DIRECTO'],
      ['2.2', 'Aceros', 2, 'DIRECTO'],
    ]);
  });

  test('un presupuesto por ítems rechaza el subcapítulo, y no queda ningún nodo suelto (RF-PRE-44)', async () => {
    const presupuestoId = await nuevoPresupuesto('ITEMS');
    const capitulo = await agregarCapitulo(contexto(), presupuestoId, { nombre: 'OBRA', clasificacion: 'DIRECTO' });
    const antes = await contarNodos(empresaA);
    await assert.rejects(
      agregarSubcapitulo(contexto(), capitulo.id, { nombre: 'Subcapítulo prohibido' }),
      /se estructura por ítems/,
    );
    assert.equal(await contarNodos(empresaA), antes);
  });

  test('renombrar cambia el nombre y deja el código donde estaba (RF-PRE-14)', async () => {
    const presupuestoId = await nuevoPresupuesto();
    await agregarCapitulo(contexto(), presupuestoId, { nombre: 'PRELIMINARES', clasificacion: 'INDIRECTO' });
    const segundo = await agregarCapitulo(contexto(), presupuestoId, { nombre: 'Cimentacion', clasificacion: 'DIRECTO' });

    await renombrarNivel(contexto(), segundo.id, 'CIMENTACIÓN');

    assert.deepEqual(forma(await leerEdt(contexto(), presupuestoId)), [
      ['1.0', 'PRELIMINARES', 1, 'INDIRECTO'],
      ['2.0', 'CIMENTACIÓN', 1, 'DIRECTO'],
    ]);
  });

  test('reclasificar el capítulo arrastra a sus subniveles; un subcapítulo no se clasifica por separado (RF-PRE-19/20)', async () => {
    const presupuestoId = await nuevoPresupuesto();
    const capitulo = await agregarCapitulo(contexto(), presupuestoId, { nombre: 'ESTUDIOS', clasificacion: 'DIRECTO' });
    const sub = await agregarSubcapitulo(contexto(), capitulo.id, { nombre: 'Suelos' });

    await reclasificarCapitulo(contexto(), capitulo.id, 'INDIRECTO');
    assert.deepEqual(forma(await leerEdt(contexto(), presupuestoId)), [
      ['1.0', 'ESTUDIOS', 1, 'INDIRECTO'],
      ['1.1', 'Suelos', 2, 'INDIRECTO'],
    ]);

    await assert.rejects(reclasificarCapitulo(contexto(), sub.id, 'DIRECTO'), /vive solo en el capítulo raíz/);
    assert.deepEqual(forma(await leerEdt(contexto(), presupuestoId)), [
      ['1.0', 'ESTUDIOS', 1, 'INDIRECTO'],
      ['1.1', 'Suelos', 2, 'INDIRECTO'],
    ]);
  });

  test('mover a una posición renumera a todos los hermanos y a sus hijos en un paso, y repetirlo no mueve nada más (D-56)', async () => {
    const presupuestoId = await nuevoPresupuesto();
    await agregarCapitulo(contexto(), presupuestoId, { nombre: 'A', clasificacion: 'DIRECTO' });
    const b = await agregarCapitulo(contexto(), presupuestoId, { nombre: 'B', clasificacion: 'DIRECTO' });
    const c = await agregarCapitulo(contexto(), presupuestoId, { nombre: 'C', clasificacion: 'INDIRECTO' });
    await agregarSubcapitulo(contexto(), b.id, { nombre: 'B hijo' });

    await moverEnEdt(contexto(), c.id, 1);
    const esperado: Array<[string, string, number, string]> = [
      ['1.0', 'C', 1, 'INDIRECTO'],
      ['2.0', 'A', 1, 'DIRECTO'],
      ['3.0', 'B', 1, 'DIRECTO'],
      ['3.1', 'B hijo', 2, 'DIRECTO'],
    ];
    assert.deepEqual(forma(await leerEdt(contexto(), presupuestoId)), esperado);

    // Idempotente: el doble clic o el reintento tras un error de red no corre el capítulo otra vez.
    await moverEnEdt(contexto(), c.id, 1);
    assert.deepEqual(forma(await leerEdt(contexto(), presupuestoId)), esperado);
  });

  test('una posición fuera de rango la rechaza la base y la EDT queda igual', async () => {
    const presupuestoId = await nuevoPresupuesto();
    const a = await agregarCapitulo(contexto(), presupuestoId, { nombre: 'A', clasificacion: 'DIRECTO' });
    await agregarCapitulo(contexto(), presupuestoId, { nombre: 'B', clasificacion: 'DIRECTO' });
    const antes = await leerEdt(contexto(), presupuestoId);

    await assert.rejects(moverEnEdt(contexto(), a.id, 3), /La posicion 3 no existe/);
    await assert.rejects(moverEnEdt(contexto(), a.id, 0), /La posicion 0 no existe/);
    assert.deepEqual(await leerEdt(contexto(), presupuestoId), antes);
  });

  test('eliminar se lleva el nivel con todo lo que cuelga, avisa antes qué contiene, y renumera lo que queda (RF-PRE-14)', async () => {
    const presupuestoId = await nuevoPresupuesto();
    await agregarCapitulo(contexto(), presupuestoId, { nombre: 'A', clasificacion: 'DIRECTO' });
    const b = await agregarCapitulo(contexto(), presupuestoId, { nombre: 'B', clasificacion: 'DIRECTO' });
    const bHijo = await agregarSubcapitulo(contexto(), b.id, { nombre: 'B hijo' });
    await agregarSubcapitulo(contexto(), bHijo.id, { nombre: 'B nieto' });
    await agregarCapitulo(contexto(), presupuestoId, { nombre: 'C', clasificacion: 'INDIRECTO' });

    assert.deepEqual(await leerContenidoDelNivel(contexto(), b.id), { subniveles: 2, actividades: 0 });

    await eliminarNivel(contexto(), b.id);
    assert.deepEqual(forma(await leerEdt(contexto(), presupuestoId)), [
      ['1.0', 'A', 1, 'DIRECTO'],
      ['2.0', 'C', 1, 'INDIRECTO'],
    ]);
  });

  test('sin PRESUPUESTOS.EDITAR no se agrega, renombra, mueve ni elimina nada; sin PRESUPUESTOS.VER no se lee', async () => {
    const presupuestoId = await nuevoPresupuesto();
    const a = await agregarCapitulo(contexto(), presupuestoId, { nombre: 'A', clasificacion: 'DIRECTO' });
    await agregarCapitulo(contexto(), presupuestoId, { nombre: 'B', clasificacion: 'DIRECTO' });
    const antes = await leerEdt(contexto(), presupuestoId);
    const asistente = { tenantId: empresaA.tenantId, usuarioId: asistenteId };

    await assert.rejects(
      agregarCapitulo(asistente, presupuestoId, { nombre: 'X', clasificacion: 'DIRECTO' }),
      /PRESUPUESTOS\.EDITAR/,
    );
    await assert.rejects(agregarSubcapitulo(asistente, a.id, { nombre: 'X' }), /PRESUPUESTOS\.EDITAR/);
    await assert.rejects(renombrarNivel(asistente, a.id, 'X'), /PRESUPUESTOS\.EDITAR/);
    await assert.rejects(reclasificarCapitulo(asistente, a.id, 'INDIRECTO'), /PRESUPUESTOS\.EDITAR/);
    await assert.rejects(moverEnEdt(asistente, a.id, 2), /PRESUPUESTOS\.EDITAR/);
    await assert.rejects(leerContenidoDelNivel(asistente, a.id), /PRESUPUESTOS\.EDITAR/);
    await assert.rejects(eliminarNivel(asistente, a.id), /PRESUPUESTOS\.EDITAR/);
    await assert.rejects(leerEdt(asistente, presupuestoId), /PRESUPUESTOS\.VER/);

    assert.deepEqual(await leerEdt(contexto(), presupuestoId), antes);
  });

  test('un presupuesto ACTIVO no admite ningún cambio de estructura, y su EDT queda idéntica (RN-04)', async () => {
    const presupuestoId = await nuevoPresupuesto();
    const capitulo = await agregarCapitulo(contexto(), presupuestoId, { nombre: 'OBRA', clasificacion: 'DIRECTO' });
    await agregarCapitulo(contexto(), presupuestoId, { nombre: 'OTRA', clasificacion: 'INDIRECTO' });

    // D-20: no se activa un presupuesto vacío. Una actividad de valor positivo basta.
    const unidadGlb = await montarEscenarioComoAdmin(empresaA, 'CONFIG.PREFERENCIAS', async (cliente) => {
      const { rows } = await cliente.query<{ id: string }>(
        `SELECT id FROM app.unidad_medida WHERE tenant_id = $1 AND simbolo = 'Glb'`,
        [empresaA.tenantId],
      );
      return rows[0]!.id;
    });
    const recurso = await crearRecurso(contexto(), {
      nombre: 'Topografía',
      tipo: 'PERSONAL',
      unidadId: unidadGlb,
      precioBase: '1000',
      ivaPct: '0',
      precioTotal: '1000',
      viaCaptura: 'BASE',
    });
    const apu = await crearApu(contexto(), {
      nombre: 'Replanteo',
      unidadId: unidadGlb,
      lineas: [{ recursoId: recurso.id, cantidad: '1', rendimiento: '1', desperdicioPct: '0' }],
    });
    await montarEscenarioComoAdmin(empresaA, 'PRESUPUESTOS.EDITAR', (cliente) =>
      cliente.query(
        `INSERT INTO app.presupuesto_item
                (tenant_id, presupuesto_id, wbs_nodo_id, apu_id, apu_version_id,
                 codigo_apu, descripcion, unidad_simbolo, precio_unitario, cantidad)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1)`,
        [
          empresaA.tenantId,
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
    await montarEscenarioComoAdmin(empresaA, 'PRESUPUESTOS.ESTADO', (cliente) =>
      cliente.query('SELECT app.fn_activar_presupuesto($1)', [presupuestoId]),
    );
    const antes = await leerEdt(contexto(), presupuestoId);

    await assert.rejects(
      agregarCapitulo(contexto(), presupuestoId, { nombre: 'X', clasificacion: 'DIRECTO' }),
      /estado ACTIVO/,
    );
    await assert.rejects(agregarSubcapitulo(contexto(), capitulo.id, { nombre: 'X' }), /estado ACTIVO/);
    await assert.rejects(renombrarNivel(contexto(), capitulo.id, 'X'), /estado ACTIVO/);
    await assert.rejects(reclasificarCapitulo(contexto(), capitulo.id, 'INDIRECTO'), /estado ACTIVO/);
    await assert.rejects(moverEnEdt(contexto(), capitulo.id, 2), /estado ACTIVO/);
    await assert.rejects(eliminarNivel(contexto(), capitulo.id), /estado ACTIVO/);

    assert.deepEqual(await leerEdt(contexto(), presupuestoId), antes);
  });

  test('aislamiento: otra empresa no lee, agrega, renombra, mueve ni elimina en esta EDT, ni con los ids exactos', async () => {
    const empresaB = await registrarEmpresaDePrueba('Constructora EDT B', '900000061-1', 'edt.ivan@construsoft.test');
    const contextoB = { tenantId: empresaB.tenantId, usuarioId: empresaB.usuarioId };
    const presupuestoId = await nuevoPresupuesto();
    const a = await agregarCapitulo(contexto(), presupuestoId, { nombre: 'A', clasificacion: 'DIRECTO' });
    await agregarCapitulo(contexto(), presupuestoId, { nombre: 'B', clasificacion: 'DIRECTO' });
    const antes = await leerEdt(contexto(), presupuestoId);
    const nodosDeB = await contarNodos(empresaB);

    assert.deepEqual(await leerEdt(contextoB, presupuestoId), []);
    await assert.rejects(
      agregarCapitulo(contextoB, presupuestoId, { nombre: 'Intruso', clasificacion: 'DIRECTO' }),
    );
    await assert.rejects(agregarSubcapitulo(contextoB, a.id, { nombre: 'Intruso' }), /no existe en esta empresa/);
    await assert.rejects(moverEnEdt(contextoB, a.id, 2), /no existe en esta empresa/);
    // Renombrar, reclasificar y eliminar un id ajeno no afecta ninguna fila: la RLS lo esconde.
    await renombrarNivel(contextoB, a.id, 'Intruso');
    await reclasificarCapitulo(contextoB, a.id, 'INDIRECTO');
    await eliminarNivel(contextoB, a.id);
    assert.deepEqual(await leerContenidoDelNivel(contextoB, a.id), { subniveles: 0, actividades: 0 });

    assert.deepEqual(await leerEdt(contexto(), presupuestoId), antes);
    assert.equal(await contarNodos(empresaB), nodosDeB);
  });
});
