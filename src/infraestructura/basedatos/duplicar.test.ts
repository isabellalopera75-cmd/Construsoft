import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ejecutarConPermiso,
  registrarEmpresa,
  type ContextoTenant,
  type EmpresaRegistrada,
} from './contextoTenant.js';
import { crearRecurso, type Recurso } from './recurso.js';
import { crearApu, editarApu, type Apu } from './apu.js';
import { crearPresupuesto, editarPorcentajes, leerPresupuesto, listarPresupuestos } from './presupuesto.js';
import { agregarCapitulo, agregarSubcapitulo, leerEdt } from './edt.js';
import { agregarActividad, leerActividades } from './actividad.js';
import { activarPresupuesto, cerrarPresupuesto } from './cicloDeVida.js';
import { listarHistorial } from './historial.js';
import { duplicarPresupuesto, leerPieConApuVigentes, listarApusDesactualizados, type PieFinanciero } from './duplicar.js';

let empresa: EmpresaRegistrada;
let admin: ContextoTenant;
let asistente: ContextoTenant;
let unidad: string;
let recurso: Recurso;
let apuFijo: Apu;
let secuencia = 0;

/** Un APU de un recurso de 1.000: su costo es 1.000 × rendimiento. */
async function apuDeMil(nombre: string): Promise<Apu> {
  return crearApu(admin, {
    nombre,
    unidadId: unidad,
    lineas: [{ recursoId: recurso.id, cantidad: '1', rendimiento: '1', desperdicioPct: '0' }],
  });
}

/**
 * Obra de origen: EDT con subcapítulo, una actividad con un APU que después
 * sube de precio y otra con uno que no cambia. AIU 10/5/5 e IVA 19.
 * CD = 2 × 1.000 + 3 × 1.000 = 5.000 → A 500, I 250, U 250, IVA 47,5 → 6.047,5.
 */
async function origen(apuQueSube: Apu): Promise<string> {
  secuencia += 1;
  const p = await crearPresupuesto(admin, {
    codigo: `DUP-${secuencia}`,
    nombre: `Origen ${secuencia}`,
    ubicacion: 'Rionegro',
    modoEstructura: 'WBS',
  });
  const capitulo = await agregarCapitulo(admin, p.id, { nombre: 'OBRA', clasificacion: 'DIRECTO' });
  const sub = await agregarSubcapitulo(admin, capitulo.id, { nombre: 'Concretos' });
  await agregarActividad(admin, capitulo.id, apuQueSube.id, '2');
  await agregarActividad(admin, sub.id, apuFijo.id, '3');
  await editarPorcentajes(admin, p.id, {
    aiuAdministracion: '10',
    aiuImprevistos: '5',
    aiuUtilidad: '5',
    ivaUtilidadPct: '19',
  });
  return p.id;
}

/** El contenido que una copia fiel tiene que repetir: estructura, actividades y pie. */
async function contenido(id: string) {
  const p = (await leerPresupuesto(admin, id))!;
  return {
    edt: (await leerEdt(admin, id)).map((n) => [n.codigoWbs, n.nombre, n.clasificacion, n.montoAcumulado]),
    actividades: (await leerActividades(admin, id)).map((a) => [
      a.codigoItem,
      a.descripcion,
      a.cantidad,
      a.precioUnitario,
      a.apuVersionId,
    ]),
    pie: [p.aiuAdministracion, p.aiuImprevistos, p.aiuUtilidad, p.ivaUtilidadPct, p.modoEstructura, p.valorTotal],
  };
}

async function subirPrecio(apu: Apu): Promise<void> {
  // Rendimiento 1,1 → costo 1.100. Sin reapuntar nada: los presupuestos se quedan en la versión vieja.
  await editarApu(admin, apu.id, {
    nombre: apu.nombre,
    unidadId: unidad,
    lineas: [{ recursoId: recurso.id, cantidad: '1', rendimiento: '1.1', desperdicioPct: '0' }],
  });
}

describe('duplicar (RF-PRE-27, D-19)', () => {
  before(async () => {
    empresa = await registrarEmpresa({
      razonSocial: 'Constructora Duplicados',
      nit: '900000130-0',
      plan: 'EMPRESARIAL',
      adminNombre: 'Diana Admin',
      adminEmail: 'duplicar.admin@construsoft.test',
      adminHash: 'hash_de_prueba_no_real',
      versionTerminos: 'terminos-de-prueba',
    });
    admin = { tenantId: empresa.tenantId, usuarioId: empresa.usuarioId };
    asistente = {
      tenantId: empresa.tenantId,
      usuarioId: await ejecutarConPermiso(admin, 'USUARIOS.GESTIONAR', async (cliente) => {
        const { rows: roles } = await cliente.query<{ id: string }>(
          `SELECT id FROM app.rol WHERE tenant_id = $1 AND tipo = 'ASISTENTE'`,
          [empresa.tenantId],
        );
        const { rows } = await cliente.query<{ id: string }>(
          `INSERT INTO app.usuario (tenant_id, rol_id, nombre, email, password_hash, estado)
           VALUES ($1, $2, 'Asistente', 'duplicar.asistente@construsoft.test', 'x', 'ACTIVO') RETURNING id`,
          [empresa.tenantId, roles[0]!.id],
        );
        return rows[0]!.id;
      }),
    };
    unidad = await ejecutarConPermiso(admin, 'CONFIG.PREFERENCIAS', async (cliente) => {
      const { rows } = await cliente.query<{ id: string }>(
        `SELECT id FROM app.unidad_medida WHERE tenant_id = $1 AND simbolo = 'Und'`,
        [empresa.tenantId],
      );
      return rows[0]!.id;
    });
    recurso = await crearRecurso(admin, {
      nombre: 'Servicio de mil',
      tipo: 'PERSONAL',
      unidadId: unidad,
      precioBase: '1000',
      ivaPct: '0',
      precioTotal: '1000',
      viaCaptura: 'BASE',
    });
    apuFijo = await apuDeMil('Actividad que no cambia');
  });

  test('la copia repite estructura, actividades, versiones de APU y porcentajes, nace ABIERTA y con un solo evento', async () => {
    const id = await origen(await apuDeMil('Actividad A'));
    const copia = await duplicarPresupuesto(admin, id, { codigo: 'DUP-COPIA-1', actualizarApu: false });

    assert.deepEqual(await contenido(copia), await contenido(id));
    const cabecera = (await leerPresupuesto(admin, copia))!;
    assert.deepEqual(
      [cabecera.codigo, cabecera.nombre, cabecera.estado, cabecera.valorTotal],
      ['DUP-COPIA-1', `Origen ${secuencia} (copia)`, 'ABIERTO', '6047.500000'],
    );
    assert.deepEqual(
      (await listarHistorial(admin, copia)).map((e) => e.tipoEvento),
      ['PRESUPUESTO_DUPLICADO'],
    );
  });

  test('se duplica en cualquier estado: un ACTIVO y un CERRADO dan copias ABIERTAS, y el original no se mueve', async () => {
    const activo = await origen(await apuDeMil('Actividad B'));
    await activarPresupuesto(admin, activo);
    const cerrado = await origen(await apuDeMil('Actividad C'));
    await activarPresupuesto(admin, cerrado);
    await cerrarPresupuesto(admin, cerrado);
    const antesActivo = await contenido(activo);

    const deActivo = await duplicarPresupuesto(admin, activo, { codigo: 'DUP-DE-ACTIVO', nombre: 'Retomada', actualizarApu: false });
    const deCerrado = await duplicarPresupuesto(admin, cerrado, { codigo: 'DUP-DE-CERRADO', actualizarApu: false });

    assert.deepEqual(
      [(await leerPresupuesto(admin, deActivo))!.estado, (await leerPresupuesto(admin, deActivo))!.nombre],
      ['ABIERTO', 'Retomada'],
    );
    assert.equal((await leerPresupuesto(admin, deCerrado))!.estado, 'ABIERTO');
    assert.deepEqual(await contenido(activo), antesActivo);
    assert.equal((await leerPresupuesto(admin, activo))!.estado, 'ACTIVO');
  });

  test('los APU desactualizados: solo el que subió, con su precio en el presupuesto y el de hoy (D-19)', async () => {
    const queSube = await apuDeMil('Actividad que sube');
    const id = await origen(queSube);
    assert.deepEqual(await listarApusDesactualizados(admin, id), []);

    await subirPrecio(queSube);
    assert.deepEqual(
      (await listarApusDesactualizados(admin, id)).map((d) => [d.codigo, d.descripcion, d.cantidad, d.precioEnElPresupuesto, d.precioVigente]),
      [[queSube.codigo, 'Actividad que sube', '2.000000', '1000.000000', '1100.000000']],
    );
  });

  test('duplicar sin actualizar conserva los precios viejos; actualizando, la copia sube y el original no se mueve', async () => {
    const queSube = await apuDeMil('Actividad que sube después');
    const id = await origen(queSube);
    await subirPrecio(queSube);
    const antes = await contenido(id);

    const sinActualizar = await duplicarPresupuesto(admin, id, { codigo: 'DUP-VIEJOS', actualizarApu: false });
    assert.equal((await leerPresupuesto(admin, sinActualizar))!.valorTotal, '6047.500000');

    const actualizada = await duplicarPresupuesto(admin, id, { codigo: 'DUP-NUEVOS', actualizarApu: true });
    // CD = 2 × 1.100 + 3 × 1.000 = 5.200 → A 520, I 260, U 260, IVA 49,4 → 6.289,4.
    assert.equal((await leerPresupuesto(admin, actualizada))!.valorTotal, '6289.400000');
    assert.deepEqual(await listarApusDesactualizados(admin, actualizada), []);
    assert.deepEqual(await contenido(id), antes);
  });

  test('el «después» del diálogo es exactamente el pie que queda guardado en la copia actualizada (D-19, D-63)', async () => {
    const pieGuardado = async (id: string): Promise<PieFinanciero> => {
      const p = (await leerPresupuesto(admin, id))!;
      return {
        costoDirecto: p.totalCostoDirecto,
        costoIndirecto: p.totalCostoIndirecto,
        administracion: p.totalAdministracion,
        imprevistos: p.totalImprevistos,
        utilidad: p.totalUtilidad,
        aiu: p.totalAiu,
        iva: p.totalIva,
        valorTotal: p.valorTotal,
      };
    };
    const queSube = await apuDeMil('Actividad del diálogo');
    const id = await origen(queSube);

    // Sin nada desactualizado, antes y después son el mismo pie.
    assert.deepEqual(await leerPieConApuVigentes(admin, id), await pieGuardado(id));

    await subirPrecio(queSube);
    const despues = (await leerPieConApuVigentes(admin, id))!;
    assert.equal(despues.valorTotal, '6289.400000');
    assert.equal((await pieGuardado(id)).valorTotal, '6047.500000');

    const copia = await duplicarPresupuesto(admin, id, { codigo: 'DUP-DIALOGO', actualizarApu: true });
    assert.deepEqual(despues, await pieGuardado(copia));
  });

  test('el código repetido lo rechaza la base y no queda ninguna copia a medias', async () => {
    const id = await origen(await apuDeMil('Actividad D'));
    const codigoOrigen = (await leerPresupuesto(admin, id))!.codigo;
    const antes = (await listarPresupuestos(admin)).length;
    await assert.rejects(
      duplicarPresupuesto(admin, id, { codigo: codigoOrigen, actualizarApu: false }),
      /presupuesto_tenant_id_codigo_key/,
    );
    assert.equal((await listarPresupuestos(admin)).length, antes);
  });

  test('sin PRESUPUESTOS.DUPLICAR no se duplica ni se consulta la lista de desactualizados', async () => {
    const id = await origen(await apuDeMil('Actividad E'));
    await assert.rejects(
      duplicarPresupuesto(asistente, id, { codigo: 'DUP-SIN-PERMISO', actualizarApu: false }),
      /PRESUPUESTOS\.DUPLICAR/,
    );
    await assert.rejects(listarApusDesactualizados(asistente, id), /PRESUPUESTOS\.DUPLICAR/);
    await assert.rejects(leerPieConApuVigentes(asistente, id), /PRESUPUESTOS\.DUPLICAR/);
  });

  test('aislamiento: otra empresa no duplica este presupuesto ni ve sus desactualizados', async () => {
    const queSube = await apuDeMil('Actividad F');
    const id = await origen(queSube);
    await subirPrecio(queSube);
    const empresaB = await registrarEmpresa({
      razonSocial: 'Constructora Duplicados B',
      nit: '900000131-1',
      plan: 'PERSONAL',
      adminNombre: 'Admin B',
      adminEmail: 'duplicar.b@construsoft.test',
      adminHash: 'hash_de_prueba_no_real',
      versionTerminos: 'terminos-de-prueba',
    });
    const contextoB = { tenantId: empresaB.tenantId, usuarioId: empresaB.usuarioId };
    await assert.rejects(
      duplicarPresupuesto(contextoB, id, { codigo: 'ROBADO', actualizarApu: true }),
      /no existe en esta empresa/,
    );
    assert.deepEqual(await listarApusDesactualizados(contextoB, id), []);
    assert.equal(await leerPieConApuVigentes(contextoB, id), null);
  });
});
