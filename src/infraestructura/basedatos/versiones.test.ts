import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ejecutarConPermiso,
  registrarEmpresa,
  type ClienteEnContexto,
  type EmpresaRegistrada,
} from './contextoTenant.js';
import { crearRecurso } from './recurso.js';
import { crearApu, type Apu } from './apu.js';
import { crearPresupuesto, editarPorcentajes } from './presupuesto.js';
import { agregarCapitulo } from './edt.js';
import { agregarActividad, cambiarCantidad, type Actividad } from './actividad.js';
import { activarPresupuesto, cerrarPresupuesto, reabrirPresupuesto } from './cicloDeVida.js';
import { guardarVersion, leerFotografia, leerVersion, listarVersiones } from './versiones.js';

let empresa: EmpresaRegistrada;
let asistenteId: string;
let apuDeMil: Apu;
let secuencia = 0;

const contexto = () => ({ tenantId: empresa.tenantId, usuarioId: empresa.usuarioId });

/**
 * Obra de referencia pequeña: OBRA (directo) con 2 × 1.000 y ESTUDIOS
 * (indirecto) con 1 × 1.000; AIU 10/5/5 e IVA 19. CD 2.000, A 200, I 100,
 * U 100, AIU 400, IVA 19, CI 1.000, valor total 3.419.
 */
async function obra(): Promise<{ id: string; actividadObra: Actividad }> {
  secuencia += 1;
  const p = await crearPresupuesto(contexto(), {
    codigo: `VER-${secuencia}`,
    nombre: `Versiones ${secuencia}`,
    ubicacion: 'Medellín',
    modoEstructura: 'ITEMS',
  });
  const directo = await agregarCapitulo(contexto(), p.id, { nombre: 'OBRA', clasificacion: 'DIRECTO' });
  const indirecto = await agregarCapitulo(contexto(), p.id, { nombre: 'ESTUDIOS', clasificacion: 'INDIRECTO' });
  const actividadObra = await agregarActividad(contexto(), directo.id, apuDeMil.id, '2');
  await agregarActividad(contexto(), indirecto.id, apuDeMil.id, '1');
  await editarPorcentajes(contexto(), p.id, {
    aiuAdministracion: '10',
    aiuImprevistos: '5',
    aiuUtilidad: '5',
    ivaUtilidadPct: '19',
  });
  return { id: p.id, actividadObra };
}

const resumen = async (presupuestoId: string) =>
  (await listarVersiones(contexto(), presupuestoId)).map((v) => [v.numero, v.tipo, v.disparador, v.estado, v.motivo]);

describe('versiones: guardar manual, listar y consultar la fotografía (RF-VER-03..06)', () => {
  before(async () => {
    empresa = await registrarEmpresa({
      razonSocial: 'Constructora Versiones',
      nit: '900000110-0',
      plan: 'EMPRESARIAL',
      adminNombre: 'Valeria Admin',
      adminEmail: 'versiones.admin@construsoft.test',
      adminHash: 'hash_de_prueba_no_real',
    });
    asistenteId = await ejecutarConPermiso(contexto(), 'USUARIOS.GESTIONAR', async (cliente: ClienteEnContexto) => {
      const { rows: roles } = await cliente.query<{ id: string }>(
        `SELECT id FROM app.rol WHERE tenant_id = $1 AND tipo = 'ASISTENTE'`,
        [empresa.tenantId],
      );
      const { rows } = await cliente.query<{ id: string }>(
        `INSERT INTO app.usuario (tenant_id, rol_id, nombre, email, password_hash, estado)
         VALUES ($1, $2, 'Asistente de versiones', 'versiones.asistente@construsoft.test', 'x', 'ACTIVO') RETURNING id`,
        [empresa.tenantId, roles[0]!.id],
      );
      return rows[0]!.id;
    });
    const unidad = await ejecutarConPermiso(contexto(), 'CONFIG.PREFERENCIAS', async (cliente) => {
      const { rows } = await cliente.query<{ id: string }>(
        `SELECT id FROM app.unidad_medida WHERE tenant_id = $1 AND simbolo = 'Und'`,
        [empresa.tenantId],
      );
      return rows[0]!.id;
    });
    const recurso = await crearRecurso(contexto(), {
      nombre: 'Servicio de mil',
      tipo: 'PERSONAL',
      unidadId: unidad,
      precioBase: '1000',
      ivaPct: '0',
      precioTotal: '1000',
      viaCaptura: 'BASE',
    });
    apuDeMil = await crearApu(contexto(), {
      nombre: 'Actividad de mil',
      unidadId: unidad,
      lineas: [{ recursoId: recurso.id, cantidad: '1', rendimiento: '1', desperdicioPct: '0' }],
    });
  });

  test('guardar una versión manual: número 1, tipo y disparador MANUAL, estado de la foto el actual, con motivo y autor (RF-VER-03/05)', async () => {
    const { id } = await obra();
    const guardada = await guardarVersion(contexto(), id, 'Antes de la reunión con el cliente');
    assert.deepEqual(
      {
        numero: guardada.numero,
        tipo: guardada.tipo,
        disparador: guardada.disparador,
        estado: guardada.estado,
        motivo: guardada.motivo,
        valorTotal: guardada.valorTotal,
        autor: guardada.autor,
      },
      {
        numero: 1,
        tipo: 'MANUAL',
        disparador: 'MANUAL',
        estado: 'ABIERTO',
        motivo: 'Antes de la reunión con el cliente',
        valorTotal: '3419.000000',
        autor: 'Valeria Admin',
      },
    );
    assert.ok(guardada.creadaEn instanceof Date);
    assert.deepEqual(await listarVersiones(contexto(), id), [guardada]);
  });

  test('sin motivo no se guarda nada; un CERRADO no admite versiones manuales', async () => {
    const { id } = await obra();
    await assert.rejects(guardarVersion(contexto(), id, '  '), /exige escribir el motivo/);
    assert.deepEqual(await listarVersiones(contexto(), id), []);

    await activarPresupuesto(contexto(), id);
    await cerrarPresupuesto(contexto(), id);
    await assert.rejects(guardarVersion(contexto(), id, 'Una más'), /CERRADO no admite versiones manuales/);
    assert.deepEqual(await resumen(id), [
      [1, 'AUTOMATICA', 'ABIERTO_A_ACTIVO', 'ACTIVO', null],
      [2, 'AUTOMATICA', 'ACTIVO_A_CERRADO', 'CERRADO', null],
    ]);
  });

  test('el historial de versiones mezcla automáticas y manuales, numeradas en orden (RF-VER-05)', async () => {
    const { id } = await obra();
    await guardarVersion(contexto(), id, 'Borrador para revisión');
    await activarPresupuesto(contexto(), id);
    await guardarVersion(contexto(), id, 'Copia firmada escaneada');
    await reabrirPresupuesto(contexto(), id, 'Ajuste de cantidades');
    assert.deepEqual(await resumen(id), [
      [1, 'MANUAL', 'MANUAL', 'ABIERTO', 'Borrador para revisión'],
      [2, 'AUTOMATICA', 'ABIERTO_A_ACTIVO', 'ACTIVO', null],
      [3, 'MANUAL', 'MANUAL', 'ACTIVO', 'Copia firmada escaneada'],
      [4, 'AUTOMATICA', 'ACTIVO_A_ABIERTO', 'ACTIVO', 'Ajuste de cantidades'],
    ]);
  });

  test('la fotografía de la línea base se lee tipada y no se mueve cuando el presupuesto vivo cambia (RF-VER-04/06)', async () => {
    const { id, actividadObra } = await obra();
    await activarPresupuesto(contexto(), id);
    const [lineaBase] = await listarVersiones(contexto(), id);
    const antes = (await leerVersion(contexto(), lineaBase!.id))!;

    assert.equal(antes.fotografia.schema, 3);
    assert.deepEqual(antes.fotografia.presupuesto.totales, {
      costoDirecto: '2000.000000',
      costoIndirecto: '1000.000000',
      administracion: '200.000000',
      imprevistos: '100.000000',
      utilidad: '100.000000',
      aiu: '400.000000',
      iva: '19.000000',
      valorTotal: '3419.000000',
    });
    assert.deepEqual(
      antes.fotografia.capitulos.map((c) => [c.codigoWbs, c.nombre, c.clasificacion, c.montoAcumulado]),
      [
        ['1.0', 'OBRA', 'DIRECTO', '2000.000000'],
        ['2.0', 'ESTUDIOS', 'INDIRECTO', '1000.000000'],
      ],
    );
    // Con precisión completa: la cantidad de ceros es la escala de numeric, no un dato del presupuesto.
    assert.match(antes.fotografia.capitulos[0]!.incidenciaPct!, /^100(\.0+)?$/);
    assert.match(antes.fotografia.capitulos[1]!.incidenciaPct!, /^50(\.0+)?$/);
    assert.deepEqual(
      antes.fotografia.items.map((i) => [i.codigoItem, i.codigoWbsPadre, i.cantidad, i.costoTotal]),
      [
        ['1.1', '1.0', '2.000000', '2000.000000'],
        ['2.1', '2.0', '1.000000', '1000.000000'],
      ],
    );
    assert.deepEqual(
      { estado: antes.fotografia.presupuesto.estado, disparador: antes.fotografia.generada.disparador },
      { estado: 'ACTIVO', disparador: 'ABIERTO_A_ACTIVO' },
    );

    await reabrirPresupuesto(contexto(), id, 'Cambió la cimentación');
    await cambiarCantidad(contexto(), actividadObra.id, '9');
    assert.deepEqual(await leerVersion(contexto(), lineaBase!.id), antes);
  });

  test('una versión no se edita ni se borra: la aplicación no tiene con qué (RF-VER-04, 02 §10.2)', async () => {
    const { id } = await obra();
    const guardada = await guardarVersion(contexto(), id, 'Intocable');
    await assert.rejects(
      ejecutarConPermiso(contexto(), 'PRESUPUESTOS.EDITAR', (cliente) =>
        cliente.query(`UPDATE app.presupuesto_version SET motivo = 'retocado' WHERE id = $1`, [guardada.id]),
      ),
      /permiso denegado|permission denied/,
    );
    await assert.rejects(
      ejecutarConPermiso(contexto(), 'PRESUPUESTOS.EDITAR', (cliente) =>
        cliente.query('DELETE FROM app.presupuesto_version WHERE id = $1', [guardada.id]),
      ),
      /permiso denegado|permission denied/,
    );
    assert.deepEqual(await listarVersiones(contexto(), id), [guardada]);
  });

  test('leerVersion: la que no existe da null', async () => {
    assert.equal(await leerVersion(contexto(), '00000000-0000-7000-8000-000000000000'), null);
  });

  test('sin PRESUPUESTOS.EDITAR no se guarda; sin PRESUPUESTOS.VER no se lista ni se consulta', async () => {
    const { id } = await obra();
    const guardada = await guardarVersion(contexto(), id, 'De la administradora');
    const asistente = { tenantId: empresa.tenantId, usuarioId: asistenteId };
    await assert.rejects(guardarVersion(asistente, id, 'No debería'), /PRESUPUESTOS\.EDITAR/);
    await assert.rejects(listarVersiones(asistente, id), /PRESUPUESTOS\.VER/);
    await assert.rejects(leerVersion(asistente, guardada.id), /PRESUPUESTOS\.VER/);
    assert.equal((await listarVersiones(contexto(), id)).length, 1);
  });

  test('aislamiento: otra empresa no lista, no consulta ni guarda versiones de este presupuesto', async () => {
    const empresaB = await registrarEmpresa({
      razonSocial: 'Constructora Versiones B',
      nit: '900000111-1',
      plan: 'PERSONAL',
      adminNombre: 'Admin B',
      adminEmail: 'versiones.b@construsoft.test',
      adminHash: 'hash_de_prueba_no_real',
    });
    const contextoB = { tenantId: empresaB.tenantId, usuarioId: empresaB.usuarioId };
    const { id } = await obra();
    const guardada = await guardarVersion(contexto(), id, 'Solo de A');

    assert.deepEqual(await listarVersiones(contextoB, id), []);
    assert.equal(await leerVersion(contextoB, guardada.id), null);
    await assert.rejects(guardarVersion(contextoB, id, 'Intruso'), /no existe en esta empresa/);
    assert.equal((await listarVersiones(contexto(), id)).length, 1);
  });
});

describe('leerFotografia: el número de schema se comprueba, no se asume', () => {
  test('un schema distinto de 3 se rechaza nombrando el que llegó y el que se sabe leer', () => {
    assert.throws(() => leerFotografia({ schema: 2, presupuesto: {} }), /schema 2.*solo sabe leer el schema 3/);
    assert.throws(() => leerFotografia({ schema: 4, presupuesto: {} }), /schema 4.*solo sabe leer el schema 3/);
  });

  test('una fotografía sin número de schema, o que no es un objeto, también se rechaza', () => {
    assert.throws(() => leerFotografia({ presupuesto: {} }), /sin número de schema/);
    assert.throws(() => leerFotografia(null), /sin número de schema/);
    assert.throws(() => leerFotografia('{"schema":3}'), /sin número de schema/);
  });
});
