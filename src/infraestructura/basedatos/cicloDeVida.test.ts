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
import { crearPresupuesto, editarPorcentajes, leerPresupuesto } from './presupuesto.js';
import { agregarCapitulo } from './edt.js';
import { agregarActividad, cambiarCantidad } from './actividad.js';
import { activarPresupuesto, cerrarPresupuesto, reabrirPresupuesto } from './cicloDeVida.js';

let empresa: EmpresaRegistrada;
let asistenteId: string;
let apuDeMil: Apu;
let secuencia = 0;

const contexto = () => ({ tenantId: empresa.tenantId, usuarioId: empresa.usuarioId });

async function comoAdmin<T>(operacion: (cliente: ClienteEnContexto) => Promise<T>): Promise<T> {
  return ejecutarConPermiso(contexto(), 'PRESUPUESTOS.VER', operacion);
}

/** Lo que dejó la transición: versiones (numero, tipo, disparador, estado de la foto, motivo) y eventos. */
async function rastro(presupuestoId: string) {
  return comoAdmin(async (cliente) => {
    const { rows: versiones } = await cliente.query<{
      numero: number;
      tipo: string;
      disparador: string;
      estado: string;
      motivo: string | null;
    }>(
      `SELECT numero, tipo, disparador, snapshot->'presupuesto'->>'estado' AS estado, motivo
         FROM app.presupuesto_version WHERE presupuesto_id = $1 ORDER BY numero`,
      [presupuestoId],
    );
    const { rows: eventos } = await cliente.query<{ tipo_evento: string; justificacion: string | null }>(
      `SELECT tipo_evento, justificacion FROM app.evento_auditoria
        WHERE presupuesto_id = $1 AND tipo_evento IN ('CAMBIO_ESTADO', 'REAPERTURA')
        ORDER BY id`,
      [presupuestoId],
    );
    return { versiones, eventos };
  });
}

/** Un presupuesto con una actividad de 1.000 × cantidad. */
async function presupuestoConActividad(cantidad = '1'): Promise<string> {
  secuencia += 1;
  const presupuesto = await crearPresupuesto(contexto(), {
    codigo: `CV-${secuencia}`,
    nombre: `Ciclo ${secuencia}`,
    ubicacion: 'Medellín',
    modoEstructura: 'ITEMS',
  });
  const capitulo = await agregarCapitulo(contexto(), presupuesto.id, { nombre: 'OBRA', clasificacion: 'DIRECTO' });
  await agregarActividad(contexto(), capitulo.id, apuDeMil.id, cantidad);
  return presupuesto.id;
}

const estado = async (id: string) => (await leerPresupuesto(contexto(), id))!.estado;

describe('ciclo de vida: activar, cerrar y reabrir (RF-PRE-24..28, RF-VER-01/02/08)', () => {
  before(async () => {
    empresa = await registrarEmpresa({
      razonSocial: 'Constructora Ciclo',
      nit: '900000100-0',
      plan: 'EMPRESARIAL',
      adminNombre: 'Admin del ciclo',
      adminEmail: 'ciclo.admin@construsoft.test',
      adminHash: 'hash_de_prueba_no_real',
    });
    asistenteId = await ejecutarConPermiso(contexto(), 'USUARIOS.GESTIONAR', async (cliente) => {
      const { rows: roles } = await cliente.query<{ id: string }>(
        `SELECT id FROM app.rol WHERE tenant_id = $1 AND tipo = 'ASISTENTE'`,
        [empresa.tenantId],
      );
      const { rows } = await cliente.query<{ id: string }>(
        `INSERT INTO app.usuario (tenant_id, rol_id, nombre, email, password_hash, estado)
         VALUES ($1, $2, 'Asistente del ciclo', 'ciclo.asistente@construsoft.test', 'x', 'ACTIVO') RETURNING id`,
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

  test('activar: estado ACTIVO, versión 1 automática con la línea base, y el evento del cambio', async () => {
    const id = await presupuestoConActividad();
    await activarPresupuesto(contexto(), id);
    assert.equal(await estado(id), 'ACTIVO');
    assert.deepEqual(await rastro(id), {
      versiones: [{ numero: 1, tipo: 'AUTOMATICA', disparador: 'ABIERTO_A_ACTIVO', estado: 'ACTIVO', motivo: null }],
      eventos: [{ tipo_evento: 'CAMBIO_ESTADO', justificacion: null }],
    });
  });

  test('D-20: sin actividades y con valor cero se rechazan con dos mensajes distintos, y siguen ABIERTOS', async () => {
    secuencia += 1;
    const vacio = await crearPresupuesto(contexto(), {
      codigo: `CV-VACIO-${secuencia}`,
      nombre: 'Vacío',
      ubicacion: 'Medellín',
      modoEstructura: 'ITEMS',
    });
    await assert.rejects(activarPresupuesto(contexto(), vacio.id), /no tiene ninguna actividad/);
    assert.equal(await estado(vacio.id), 'ABIERTO');

    const enCero = await presupuestoConActividad('0');
    await assert.rejects(activarPresupuesto(contexto(), enCero), /el valor total es cero\. Revise las cantidades/);
    assert.equal(await estado(enCero), 'ABIERTO');
    assert.deepEqual(await rastro(enCero), { versiones: [], eventos: [] });
  });

  test('activar dos veces se rechaza y no reescribe la línea base: sigue habiendo una sola versión', async () => {
    const id = await presupuestoConActividad();
    await activarPresupuesto(contexto(), id);
    await assert.rejects(activarPresupuesto(contexto(), id), /Solo se activa un proyecto ABIERTO/);
    assert.equal((await rastro(id)).versiones.length, 1);
  });

  test('cerrar: solo desde ACTIVO; guarda la versión 2 y CERRADO no se reabre (RF-PRE-26/33, RF-VER-02)', async () => {
    const id = await presupuestoConActividad();
    await assert.rejects(cerrarPresupuesto(contexto(), id), /Solo se cierra un proyecto ACTIVO/);
    await activarPresupuesto(contexto(), id);
    await cerrarPresupuesto(contexto(), id);
    assert.equal(await estado(id), 'CERRADO');
    await assert.rejects(reabrirPresupuesto(contexto(), id, 'Retomar la obra'), /Solo se reabre un proyecto ACTIVO/);
    assert.deepEqual(
      (await rastro(id)).versiones.map((v) => [v.numero, v.disparador, v.estado]),
      [
        [1, 'ABIERTO_A_ACTIVO', 'ACTIVO'],
        [2, 'ACTIVO_A_CERRADO', 'CERRADO'],
      ],
    );
  });

  test('reabrir exige justificación escrita; en blanco se rechaza y el proyecto sigue ACTIVO (RF-PRE-28)', async () => {
    const id = await presupuestoConActividad();
    await activarPresupuesto(contexto(), id);
    await assert.rejects(reabrirPresupuesto(contexto(), id, '   '), /exige una justificacion escrita/);
    assert.equal(await estado(id), 'ACTIVO');
    assert.equal((await rastro(id)).versiones.length, 1);
  });

  test('reabrir y volver a activar: la foto de la reapertura es la línea base ACTIVA, el motivo queda en el evento, y la nueva línea base es la versión 3 (RF-VER-08)', async () => {
    const id = await presupuestoConActividad();
    await activarPresupuesto(contexto(), id);
    await reabrirPresupuesto(contexto(), id, 'El cliente pidió ampliar la cimentación');
    assert.equal(await estado(id), 'ABIERTO');

    const actividad = await comoAdmin(async (cliente) => {
      const { rows } = await cliente.query<{ id: string }>(
        'SELECT id FROM app.presupuesto_item WHERE presupuesto_id = $1',
        [id],
      );
      return rows[0]!.id;
    });
    await cambiarCantidad(contexto(), actividad, '3');
    await activarPresupuesto(contexto(), id);

    assert.deepEqual(await rastro(id), {
      versiones: [
        { numero: 1, tipo: 'AUTOMATICA', disparador: 'ABIERTO_A_ACTIVO', estado: 'ACTIVO', motivo: null },
        {
          numero: 2,
          tipo: 'AUTOMATICA',
          disparador: 'ACTIVO_A_ABIERTO',
          estado: 'ACTIVO',
          motivo: 'El cliente pidió ampliar la cimentación',
        },
        { numero: 3, tipo: 'AUTOMATICA', disparador: 'ABIERTO_A_ACTIVO', estado: 'ACTIVO', motivo: null },
      ],
      eventos: [
        { tipo_evento: 'CAMBIO_ESTADO', justificacion: null },
        { tipo_evento: 'REAPERTURA', justificacion: 'El cliente pidió ampliar la cimentación' },
        { tipo_evento: 'CAMBIO_ESTADO', justificacion: null },
      ],
    });
    assert.equal((await leerPresupuesto(contexto(), id))!.valorTotal, '3000.000000');
  });

  test('aiuEnCero lo decide la base: en cero al nacer, falso en cuanto un porcentaje del AIU es mayor que cero (RF-PRE-35)', async () => {
    const id = await presupuestoConActividad();
    assert.equal((await leerPresupuesto(contexto(), id))!.aiuEnCero, true);
    const editado = await editarPorcentajes(contexto(), id, {
      aiuAdministracion: '0',
      aiuImprevistos: '0',
      aiuUtilidad: '3',
      ivaUtilidadPct: '19',
    });
    assert.equal(editado!.aiuEnCero, false);
  });

  test('sin PRESUPUESTOS.ESTADO no se activa, cierra ni reabre nada, y no queda rastro', async () => {
    const id = await presupuestoConActividad();
    const asistente = { tenantId: empresa.tenantId, usuarioId: asistenteId };
    await assert.rejects(activarPresupuesto(asistente, id), /PRESUPUESTOS\.ESTADO/);
    await activarPresupuesto(contexto(), id);
    await assert.rejects(cerrarPresupuesto(asistente, id), /PRESUPUESTOS\.ESTADO/);
    await assert.rejects(reabrirPresupuesto(asistente, id, 'Sin permiso'), /PRESUPUESTOS\.ESTADO/);
    assert.equal(await estado(id), 'ACTIVO');
    assert.equal((await rastro(id)).versiones.length, 1);
  });

  test('aislamiento: otra empresa no activa, cierra ni reabre este presupuesto con su id exacto', async () => {
    const empresaB = await registrarEmpresa({
      razonSocial: 'Constructora Ciclo B',
      nit: '900000101-1',
      plan: 'PERSONAL',
      adminNombre: 'Admin B',
      adminEmail: 'ciclo.b@construsoft.test',
      adminHash: 'hash_de_prueba_no_real',
    });
    const contextoB = { tenantId: empresaB.tenantId, usuarioId: empresaB.usuarioId };
    const abierto = await presupuestoConActividad();
    const activo = await presupuestoConActividad();
    await activarPresupuesto(contexto(), activo);

    await assert.rejects(activarPresupuesto(contextoB, abierto), /no existe en esta empresa/);
    await assert.rejects(cerrarPresupuesto(contextoB, activo), /no existe en esta empresa/);
    await assert.rejects(reabrirPresupuesto(contextoB, activo, 'Intruso'), /no existe en esta empresa/);
    assert.equal(await estado(abierto), 'ABIERTO');
    assert.equal(await estado(activo), 'ACTIVO');
    assert.equal((await rastro(activo)).versiones.length, 1);
  });
});
