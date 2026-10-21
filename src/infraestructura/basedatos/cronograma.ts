import { ErrorDeCalendario } from '../../cronograma/calendarioCompilado.js';
import { estaAlDia, type FilaActividad, type FilaCalculo, type FilasDelCronograma } from '../../cronograma/filas.js';
import type { TipoDeRestriccion } from '../../cronograma/motor.js';
import { recalcular, repartoEnMinutos } from '../../cronograma/recalculo.js';
import { deMinutos } from '../../cronograma/tiempo.js';
import type { LineaBaseLeida } from '../../cronograma/vista.js';
import { leerCalendarioEn } from './calendarios.js';
import { ejecutarConPermiso, ejecutarConPermisoEnUnaFoto, type ClienteEnContexto, type ContextoTenant } from './contextoTenant.js';
import { ErrorParaElUsuario } from './errorParaElUsuario.js';

/*
 * El cronograma en la base (07 §6, CONTRATO §19.5–§19.6, bitácora del 20 de
 * octubre). La base guarda las entradas y defiende sus reglas; el motor corre
 * aquí y escribe sus resultados en app.actividad_calculo (D-89).
 *
 * Un recálculo es una sola transacción en REPEATABLE READ (B4): todas las
 * lecturas ven la misma foto del presupuesto, la fila del cronograma se
 * bloquea antes de escribir y los resultados entran en una sola sentencia.
 * Está al día si calculado_version = version y calculado_revision =
 * presupuesto.revision (D-91); si no, leer lo recalcula antes de responder.
 */

const FECHA_HORA = (columna: string) => `to_char(${columna}, 'YYYY-MM-DD"T"HH24:MI')`;
const FECHA = (columna: string) => `to_char(${columna}, 'YYYY-MM-DD')`;

export interface CronogramaLeido {
  filas: FilasDelCronograma;
  recalculado: boolean;
  lineaBase: LineaBaseLeida | null;
}

// -----------------------------------------------------------------------------
//  Leer
// -----------------------------------------------------------------------------

async function cargarFilasEn(cliente: ClienteEnContexto, cronogramaId: string): Promise<FilasDelCronograma | null> {
  const cabecera = await cliente.query<{
    id: string;
    presupuesto_id: string;
    tenant_id: string;
    fecha_inicio: string;
    version: string;
    calculado_version: string | null;
    calculado_revision: string | null;
    calculado_valor_total: string | null;
    aviso_presupuesto: unknown;
    estado: FilasDelCronograma['presupuesto']['estado'];
    revision: string;
    horas_por_jornal: string;
    total_administracion: string;
    valor_total: string;
    fecha_modificacion: Date;
  }>(
    `SELECT c.id, c.presupuesto_id, c.tenant_id, ${FECHA('c.fecha_inicio')} AS fecha_inicio, c.version,
            c.calculado_version, c.calculado_revision, c.calculado_valor_total, c.aviso_presupuesto,
            p.estado, p.revision, p.horas_por_jornal, p.total_administracion, p.valor_total, p.fecha_modificacion
       FROM app.cronograma c JOIN app.presupuesto p ON p.id = c.presupuesto_id
      WHERE c.id = $1`,
    [cronogramaId],
  );
  const c = cabecera.rows[0];
  if (!c) return null;

  const calendarios = await cliente.query<{ id: string; tipo: 'OBRA' | 'CORRIDO' }>('SELECT id, tipo FROM app.calendario WHERE cronograma_id = $1', [cronogramaId]);
  const calendario = async (tipo: 'OBRA' | 'CORRIDO') => (await leerCalendarioEn(cliente, calendarios.rows.find((k) => k.tipo === tipo)!.id, false))!;

  const capitulos = await cliente.query<{ id: string; padre_id: string | null; codigo_wbs: string; nivel: number; nombre: string; orden: number }>(
    `SELECT e.id, e.padre_id, e.codigo_wbs, e.nivel, e.nombre, n.orden
       FROM app.fn_leer_edt($1) WITH ORDINALITY
            AS e(id, padre_id, codigo_wbs, nivel, nombre, clasificacion, monto_acumulado, incidencia_pct, posicion)
       JOIN app.wbs_nodo n ON n.id = e.id
      ORDER BY e.posicion`,
    [c.presupuesto_id],
  );
  const grupos = await cliente.query<{ id: string; nombre: string; orden: number }>(
    'SELECT id, nombre, orden FROM app.grupo_tramite WHERE cronograma_id = $1 ORDER BY orden, lower(nombre)',
    [cronogramaId],
  );
  const actividades = await cliente.query<{
    id: string;
    tipo: FilaActividad['tipo'];
    presupuesto_item_id: string | null;
    nombre: string;
    codigo: string;
    orden: number;
    grupo_id: string | null;
    usa_corrido: boolean;
    cuadrillas: number;
    duracion_manual_horas: string | null;
    restriccion_tipo: TipoDeRestriccion | null;
    restriccion_fecha: string | null;
    restriccion2_tipo: TipoDeRestriccion | null;
    restriccion2_fecha: string | null;
    cantidad: string | null;
    unidad_simbolo: string | null;
    rendimiento_actividad: string | null;
    costo_total: string | null;
    wbs_nodo_id: string | null;
  }>(
    `SELECT a.id, a.tipo, a.presupuesto_item_id, a.nombre, a.codigo, a.orden, a.grupo_id, a.usa_corrido,
            a.cuadrillas, a.duracion_manual_horas,
            a.restriccion_tipo, ${FECHA('a.restriccion_fecha')} AS restriccion_fecha,
            a.restriccion2_tipo, ${FECHA('a.restriccion2_fecha')} AS restriccion2_fecha,
            i.cantidad, i.unidad_simbolo, v.rendimiento_actividad, i.costo_total, i.wbs_nodo_id
       FROM app.actividad_programada a
       LEFT JOIN app.presupuesto_item i ON i.id = a.presupuesto_item_id
       LEFT JOIN app.apu_version v ON v.id = i.apu_version_id
      WHERE a.cronograma_id = $1`,
    [cronogramaId],
  );
  const dependencias = await cliente.query<{ id: string; predecesora_id: string; sucesora_id: string; tipo: 'FC' | 'CC' | 'FF' | 'CF'; desfase_horas: string }>(
    'SELECT id, predecesora_id, sucesora_id, tipo, desfase_horas FROM app.dependencia WHERE cronograma_id = $1 ORDER BY id',
    [cronogramaId],
  );
  const calculos = await cliente.query<{
    actividad_id: string;
    inicio: string;
    fin: string;
    inicio_tardio: string | null;
    fin_tardio: string | null;
    duracion_calculada_minutos: number | null;
    duracion_minutos: number;
    holgura_total_minutos: number | null;
    holgura_libre_minutos: number | null;
    critica: boolean;
    en_presupuesto: boolean;
  }>(
    `SELECT k.actividad_id, ${FECHA_HORA('k.inicio_temprano')} AS inicio, ${FECHA_HORA('k.fin_temprano')} AS fin,
            ${FECHA_HORA('k.inicio_tardio')} AS inicio_tardio, ${FECHA_HORA('k.fin_tardio')} AS fin_tardio,
            k.duracion_calculada_minutos, k.duracion_minutos, k.holgura_total_minutos, k.holgura_libre_minutos, k.critica,
            k.en_presupuesto
       FROM app.actividad_calculo k JOIN app.actividad_programada a ON a.id = k.actividad_id
      WHERE a.cronograma_id = $1`,
    [cronogramaId],
  );
  const lineasBase = await cliente.query<{ id: string; nombre: string; guardada_en: Date; guardada_por: string | null; fin: string }>(
    `SELECT lb.id, lb.nombre, lb.guardada_en, u.nombre AS guardada_por, ${FECHA_HORA('max(x.fin)')} AS fin
       FROM app.linea_base lb
       LEFT JOIN app.usuario u ON u.id = lb.guardada_por
       LEFT JOIN app.linea_base_actividad x ON x.linea_base_id = lb.id
      WHERE lb.cronograma_id = $1
      GROUP BY lb.id, u.nombre
      ORDER BY lb.guardada_en, lb.id`,
    [cronogramaId],
  );

  const restriccion = (tipo: TipoDeRestriccion | null, fecha: string | null) => (tipo === null ? null : { tipo, fecha });
  return {
    cabecera: {
      id: c.id,
      presupuestoId: c.presupuesto_id,
      tenantId: c.tenant_id,
      fechaInicio: c.fecha_inicio,
      version: Number(c.version),
      calculadoVersion: c.calculado_version === null ? null : Number(c.calculado_version),
      calculadoRevision: c.calculado_revision === null ? null : Number(c.calculado_revision),
      calculadoValorTotal: c.calculado_valor_total,
      aviso: c.aviso_presupuesto,
    },
    presupuesto: {
      estado: c.estado,
      revision: Number(c.revision),
      horasPorJornal: c.horas_por_jornal,
      totalAdministracion: c.total_administracion,
      valorTotal: c.valor_total,
      fechaModificacion: c.fecha_modificacion,
    },
    calendarios: { obra: await calendario('OBRA'), corrido: await calendario('CORRIDO') },
    capitulos: capitulos.rows.map((k) => ({ id: k.id, padreId: k.padre_id, codigo: k.codigo_wbs, nombre: k.nombre, nivel: k.nivel, posicion: k.orden })),
    grupos: grupos.rows,
    actividades: actividades.rows.map((a) => ({
      id: a.id,
      tipo: a.tipo,
      presupuestoItemId: a.presupuesto_item_id,
      nombre: a.nombre,
      codigo: a.codigo,
      orden: a.orden,
      grupoId: a.grupo_id,
      usaCorrido: a.usa_corrido,
      cuadrillas: a.cuadrillas,
      duracionManualHoras: a.duracion_manual_horas,
      restriccion: restriccion(a.restriccion_tipo, a.restriccion_fecha),
      restriccionSecundaria: restriccion(a.restriccion2_tipo, a.restriccion2_fecha),
      item:
        a.presupuesto_item_id === null
          ? null
          : { cantidad: a.cantidad!, unidad: a.unidad_simbolo!, rendimiento: a.rendimiento_actividad, costo: a.costo_total!, wbsNodoId: a.wbs_nodo_id! },
    })),
    dependencias: dependencias.rows.map((d) => ({ id: d.id, predecesoraId: d.predecesora_id, sucesoraId: d.sucesora_id, tipo: d.tipo, desfaseHoras: d.desfase_horas })),
    calculos: new Map(
      calculos.rows.map((k) => [
        k.actividad_id,
        {
          inicio: k.inicio,
          fin: k.fin,
          inicioTardio: k.inicio_tardio,
          finTardio: k.fin_tardio,
          duracionCalculadaMinutos: k.duracion_calculada_minutos,
          duracionMinutos: k.duracion_minutos,
          holguraTotalMinutos: k.holgura_total_minutos,
          holguraLibreMinutos: k.holgura_libre_minutos,
          critica: k.critica,
          enPresupuesto: k.en_presupuesto,
        },
      ]),
    ),
    lineasBase: lineasBase.rows.map((l) => ({ id: l.id, nombre: l.nombre, guardadaEn: l.guardada_en, guardadaPor: l.guardada_por, fin: l.fin })),
  };
}

async function leerLineaBaseEn(cliente: ClienteEnContexto, cronogramaId: string, lineaBaseId: string): Promise<LineaBaseLeida> {
  const lb = await cliente.query<{ id: string; nombre: string; guardada_en: Date }>(
    'SELECT id, nombre, guardada_en FROM app.linea_base WHERE id = $1 AND cronograma_id = $2',
    [lineaBaseId, cronogramaId],
  );
  if (!lb.rows[0]) throw new ErrorParaElUsuario('Esa línea base no existe en este cronograma.', 'NO_EXISTE');
  const { rows } = await cliente.query<{ actividad_id: string; inicio: string; fin: string; duracion_minutos: number }>(
    `SELECT actividad_id, ${FECHA_HORA('inicio')} AS inicio, ${FECHA_HORA('fin')} AS fin, duracion_minutos
       FROM app.linea_base_actividad WHERE linea_base_id = $1`,
    [lineaBaseId],
  );
  return {
    id: lb.rows[0].id,
    nombre: lb.rows[0].nombre,
    guardadaEn: lb.rows[0].guardada_en,
    actividades: rows.map((r) => ({ actividadId: r.actividad_id, inicio: r.inicio, fin: r.fin, duracionMinutos: r.duracion_minutos })),
  };
}

// -----------------------------------------------------------------------------
//  Recalcular (B4)
// -----------------------------------------------------------------------------

/**
 * Pone las actividades al día con el presupuesto (RN-33, RN-42): primero
 * refresca número, nombre y orden de las que siguen amarradas a su ítem, y
 * después crea las de los ítems nuevos. En ese orden: al revés, el número de un
 * ítem nuevo choca con el número viejo de otra actividad que todavía no se
 * refrescó (bitácora del producto, 20 de octubre).
 */
async function ponerAlDiaConElPresupuestoEn(cliente: ClienteEnContexto, filas: Pick<FilasDelCronograma, 'cabecera'>): Promise<void> {
  const ordenDeLaEdt = `
    SELECT i.id, i.codigo_item, app.fn_texto_limpio(i.descripcion) AS nombre,
           (row_number() OVER (ORDER BY string_to_array(i.codigo_item, '.')::int[], i.id))::int AS n
      FROM app.presupuesto_item i
     WHERE i.presupuesto_id = $2 AND i.codigo_item IS NOT NULL`;
  await cliente.query(
    `WITH o AS (${ordenDeLaEdt})
     UPDATE app.actividad_programada a
        SET codigo = o.codigo_item, nombre = o.nombre, orden = o.n
       FROM o
      WHERE a.presupuesto_item_id = o.id AND a.cronograma_id = $1
        AND (a.codigo, a.nombre, a.orden) IS DISTINCT FROM (o.codigo_item, o.nombre, o.n)`,
    [filas.cabecera.id, filas.cabecera.presupuestoId],
  );
  await cliente.query(
    `INSERT INTO app.actividad_programada (tenant_id, cronograma_id, tipo, presupuesto_item_id, orden)
     SELECT $3, $1, 'ITEM', o.id, o.n
       FROM (${ordenDeLaEdt}) o
      WHERE NOT EXISTS (SELECT 1 FROM app.actividad_programada a WHERE a.presupuesto_item_id = o.id)`,
    [filas.cabecera.id, filas.cabecera.presupuestoId, filas.cabecera.tenantId],
  );
}

/** Corre el motor y escribe sus resultados en una sentencia. Devuelve las filas ya con el cálculo nuevo. */
async function recalcularEn(cliente: ClienteEnContexto, cronogramaId: string): Promise<FilasDelCronograma> {
  await cliente.query('SELECT 1 FROM app.cronograma WHERE id = $1 FOR UPDATE', [cronogramaId]);
  const antes = (await cargarFilasEn(cliente, cronogramaId))!;
  await ponerAlDiaConElPresupuestoEn(cliente, antes);
  const filas = (await cargarFilasEn(cliente, cronogramaId))!;

  let calculos;
  try {
    calculos = recalcular(filas);
  } catch (error) {
    if (!(error instanceof ErrorDeCalendario)) throw error;
    throw new ErrorParaElUsuario(
      error.motivo === 'SIN_HORAS'
        ? 'El calendario de la obra no tiene ninguna hora laborable: marque al menos un tramo en su semana antes de programar.'
        : 'El cronograma no cabe en las fechas que el sistema puede calcular. Revise la fecha de inicio, los desfases y las restricciones: alguna está a décadas del resto.',
      'RECHAZADO',
    );
  }

  const texto = (minutos: number | null) => (minutos === null ? null : deMinutos(minutos));
  const enPresupuesto = new Set(filas.actividades.filter((a) => a.item !== null).map((a) => a.id));
  await cliente.query(
    `INSERT INTO app.actividad_calculo
         (actividad_id, tenant_id, inicio_temprano, fin_temprano, inicio_tardio, fin_tardio,
          duracion_calculada_minutos, duracion_minutos, holgura_total_minutos, holgura_libre_minutos,
          en_presupuesto)
     SELECT x.id, $1, x.i::timestamp, x.f::timestamp, x.it::timestamp, x.ft::timestamp, x.dc, x.d, x.ht, x.hl, x.ep
       FROM unnest($2::uuid[], $3::text[], $4::text[], $5::text[], $6::text[],
                   $7::int[], $8::int[], $9::int[], $10::int[], $11::boolean[]) AS x(id, i, f, it, ft, dc, d, ht, hl, ep)
     ON CONFLICT (actividad_id) DO UPDATE SET
         inicio_temprano = EXCLUDED.inicio_temprano, fin_temprano = EXCLUDED.fin_temprano,
         inicio_tardio = EXCLUDED.inicio_tardio, fin_tardio = EXCLUDED.fin_tardio,
         duracion_calculada_minutos = EXCLUDED.duracion_calculada_minutos,
         duracion_minutos = EXCLUDED.duracion_minutos,
         holgura_total_minutos = EXCLUDED.holgura_total_minutos,
         holgura_libre_minutos = EXCLUDED.holgura_libre_minutos,
         en_presupuesto = EXCLUDED.en_presupuesto`,
    [
      filas.cabecera.tenantId,
      calculos.map((k) => k.actividadId),
      calculos.map((k) => deMinutos(k.inicio)),
      calculos.map((k) => deMinutos(k.fin)),
      calculos.map((k) => texto(k.inicioTardio)),
      calculos.map((k) => texto(k.finTardio)),
      calculos.map((k) => k.duracionCalculadaMinutos),
      calculos.map((k) => k.duracionMinutos),
      calculos.map((k) => k.holguraTotalMinutos),
      calculos.map((k) => k.holguraLibreMinutos),
      calculos.map((k) => enPresupuesto.has(k.actividadId)),
    ],
  );
  await cliente.query(
    'UPDATE app.cronograma SET calculado_version = version, calculado_revision = $2, calculado_valor_total = $3 WHERE id = $1',
    [cronogramaId, filas.presupuesto.revision, filas.presupuesto.valorTotal],
  );

  // Las filas, con el cálculo que se acaba de escribir: no hace falta leerlo de nuevo.
  const nuevos = new Map<string, FilaCalculo>(
    calculos.map((k) => [
      k.actividadId,
      {
        inicio: deMinutos(k.inicio),
        fin: deMinutos(k.fin),
        inicioTardio: texto(k.inicioTardio),
        finTardio: texto(k.finTardio),
        duracionCalculadaMinutos: k.duracionCalculadaMinutos,
        duracionMinutos: k.duracionMinutos,
        holguraTotalMinutos: k.holguraTotalMinutos,
        holguraLibreMinutos: k.holguraLibreMinutos,
        // La misma regla que la columna generada de la base (RN-31).
        critica: k.holguraTotalMinutos !== null && k.holguraTotalMinutos <= 0,
        enPresupuesto: enPresupuesto.has(k.actividadId),
      },
    ]),
  );
  return {
    ...filas,
    cabecera: {
      ...filas.cabecera,
      calculadoVersion: filas.cabecera.version,
      calculadoRevision: filas.presupuesto.revision,
      calculadoValorTotal: filas.presupuesto.valorTotal,
    },
    calculos: nuevos,
  };
}

/** Las filas al día: si el cálculo guardado no corresponde a las entradas o al presupuesto, recalcula (D-91). */
async function alDiaEn(cliente: ClienteEnContexto, cronogramaId: string, lineaBaseId: string | null): Promise<CronogramaLeido> {
  let filas = (await cargarFilasEn(cliente, cronogramaId))!;
  let recalculado = false;
  if (!estaAlDia(filas)) {
    filas = await recalcularEn(cliente, cronogramaId);
    recalculado = true;
  }
  const lineaBase = lineaBaseId === null ? null : await leerLineaBaseEn(cliente, cronogramaId, lineaBaseId);
  return { filas, recalculado, lineaBase };
}

// -----------------------------------------------------------------------------
//  PRESUPUESTOS.VER · Leer (§19.5). Recalcular no es editar: pasa con cualquier
//  rol que pueda leer, con el presupuesto Cerrado y en solo lectura.
// -----------------------------------------------------------------------------

/** null: el presupuesto no existe en esta empresa. 'SIN_CRONOGRAMA': existe y no tiene. */
export async function leerCronogramaDelPresupuesto(
  contexto: ContextoTenant,
  presupuestoId: string,
  lineaBaseId: string | null,
): Promise<CronogramaLeido | 'SIN_CRONOGRAMA' | null> {
  return ejecutarConPermisoEnUnaFoto(contexto, 'PRESUPUESTOS.VER', async (cliente) => {
    const { rows } = await cliente.query<{ id: string }>('SELECT id FROM app.cronograma WHERE presupuesto_id = $1', [presupuestoId]);
    if (!rows[0]) {
      const existe = await cliente.query('SELECT 1 FROM app.presupuesto WHERE id = $1', [presupuestoId]);
      return existe.rowCount === 1 ? 'SIN_CRONOGRAMA' : null;
    }
    return alDiaEn(cliente, rows[0].id, lineaBaseId);
  });
}

/** El mismo, buscado por el id del cronograma. null si no es de esta empresa. */
export async function leerCronograma(contexto: ContextoTenant, cronogramaId: string): Promise<CronogramaLeido | null> {
  return ejecutarConPermisoEnUnaFoto(contexto, 'PRESUPUESTOS.VER', async (cliente) => {
    const { rowCount } = await cliente.query('SELECT 1 FROM app.cronograma WHERE id = $1', [cronogramaId]);
    return rowCount === 1 ? alDiaEn(cliente, cronogramaId, null) : null;
  });
}

// -----------------------------------------------------------------------------
//  PRESUPUESTOS.EDITAR · Crear y editar (§19.5–§19.6)
// -----------------------------------------------------------------------------

/** RF-PRG-01. Crea y calcula. null si el presupuesto no es de esta empresa. */
export async function crearCronograma(
  contexto: ContextoTenant,
  presupuestoId: string,
  fechaInicio: string,
  calendarioId: string | null,
): Promise<CronogramaLeido | null> {
  return ejecutarConPermisoEnUnaFoto(contexto, 'PRESUPUESTOS.EDITAR', async (cliente) => {
    const existe = await cliente.query('SELECT 1 FROM app.presupuesto WHERE id = $1', [presupuestoId]);
    if (existe.rowCount !== 1) return null;
    const ya = await cliente.query('SELECT 1 FROM app.cronograma WHERE presupuesto_id = $1', [presupuestoId]);
    if (ya.rowCount === 1) {
      throw new ErrorParaElUsuario('Este presupuesto ya tiene su cronograma: hay uno por presupuesto (D-82). Ábralo para editarlo.', 'CONFLICTO');
    }
    const { rows } = await cliente.query<{ id: string }>('SELECT app.fn_crear_cronograma($1, $2::date, $3) AS id', [presupuestoId, fechaInicio, calendarioId]);
    const leido = await alDiaEn(cliente, rows[0]!.id, null);
    // Crear calcula por definición: «recalculado» habla de una lectura.
    return { ...leido, recalculado: false };
  });
}

export type ResultadoDeEdicion = { tipo: 'HECHO'; leido: CronogramaLeido } | { tipo: 'VERSION_VIEJA' };

/**
 * Toda escritura de las entradas (§19.1): bloquea la fila del cronograma,
 * compara la versión que trae la petición, aplica el cambio, sube la versión,
 * cierra la franja del presupuesto (D-93) y recalcula, todo en la misma
 * transacción. null si el cronograma no es de esta empresa.
 *
 * Con el presupuesto Cerrado se rechaza aquí y no solo en la base: un cambio
 * que no mueve ningún valor no despierta a los guardianes, y sin esta línea
 * subiría la versión de un cronograma de solo lectura (RN-34).
 */
export async function editarCronograma(
  contexto: ContextoTenant,
  cronogramaId: string,
  version: number,
  cambio: (cliente: ClienteEnContexto, filas: FilasDelCronograma) => Promise<void>,
): Promise<ResultadoDeEdicion | null> {
  return ejecutarConPermisoEnUnaFoto(contexto, 'PRESUPUESTOS.EDITAR', async (cliente) => {
    const bloqueada = await cliente.query('SELECT 1 FROM app.cronograma WHERE id = $1 FOR UPDATE', [cronogramaId]);
    if (bloqueada.rowCount !== 1) return null;
    const filas = (await cargarFilasEn(cliente, cronogramaId))!;
    if (filas.cabecera.version !== version) return { tipo: 'VERSION_VIEJA' };
    if (filas.presupuesto.estado === 'CERRADO') {
      throw new ErrorParaElUsuario('El presupuesto está Cerrado: su cronograma es de solo lectura (RN-34).', 'RECHAZADO');
    }
    await cambio(cliente, filas);
    await cliente.query('UPDATE app.cronograma SET version = version + 1, aviso_presupuesto = NULL WHERE id = $1', [cronogramaId]);
    return { tipo: 'HECHO', leido: { filas: await recalcularEn(cliente, cronogramaId), recalculado: false, lineaBase: null } };
  });
}

/** D-93 · Cerrar la franja no es una entrada: no lleva versión ni la sube. false si no es de esta empresa. */
export async function cerrarAvisoDelPresupuesto(contexto: ContextoTenant, cronogramaId: string): Promise<boolean> {
  return ejecutarConPermiso(contexto, 'PRESUPUESTOS.EDITAR', async (cliente) => {
    const { rowCount } = await cliente.query('UPDATE app.cronograma SET aviso_presupuesto = NULL WHERE id = $1', [cronogramaId]);
    return rowCount === 1;
  });
}

// -----------------------------------------------------------------------------
//  §19.7 · Las curvas. El dinero lo reparte la base (fn_curvas) con los minutos
//  que entrega el motor; las acumuladas también salen de ella (regla 1.1).
// -----------------------------------------------------------------------------

export interface Periodo {
  periodo: string;
  facturacion: string;
  costo: string;
  facturacionAcumulada: string;
  costoAcumulado: string;
}

export interface Curvas {
  granularidad: 'SEMANA' | 'MES';
  periodos: Periodo[];
  totales: { facturacion: string; costo: string };
  lineaBase: { id: string; nombre: string; periodos: Periodo[] } | null;
}

const ACUMULADAS = `
    to_char(periodo, 'YYYY-MM-DD') AS periodo, facturacion, costo,
    (sum(facturacion) OVER (ORDER BY periodo))::app.dinero AS "facturacionAcumulada",
    (sum(costo) OVER (ORDER BY periodo))::app.dinero AS "costoAcumulado"`;

/** null si el cronograma no es de esta empresa. Recalcula antes si hace falta (§19.7). */
export async function leerCurvas(
  contexto: ContextoTenant,
  cronogramaId: string,
  granularidad: 'SEMANA' | 'MES',
  lineaBaseId: string | null,
): Promise<Curvas | null> {
  return ejecutarConPermisoEnUnaFoto(contexto, 'PRESUPUESTOS.VER', async (cliente) => {
    const { rowCount } = await cliente.query('SELECT 1 FROM app.cronograma WHERE id = $1', [cronogramaId]);
    if (rowCount !== 1) return null;
    const { filas, lineaBase } = await alDiaEn(cliente, cronogramaId, lineaBaseId);
    const reparto = repartoEnMinutos(filas);
    const periodos = await cliente.query<Periodo>(
      `SELECT ${ACUMULADAS} FROM app.fn_curvas($1, $2::uuid[], $3::date[], $4::int[], $5) ORDER BY periodo`,
      [filas.cabecera.presupuestoId, reparto.actividadIds, reparto.fechas, reparto.minutos, granularidad],
    );
    const totales = await cliente.query<{ facturacion: string; costo: string }>(
      `SELECT valor_total AS facturacion,
              (total_costo_directo + total_costo_indirecto + total_administracion)::app.dinero AS costo
         FROM app.presupuesto WHERE id = $1`,
      [filas.cabecera.presupuestoId],
    );
    let curvaBase: Curvas['lineaBase'] = null;
    if (lineaBase) {
      // Por día en la base; la semana y el mes se arman aquí con la semana de hoy (RN-38, B6).
      const { rows } = await cliente.query<Periodo>(
        `WITH s AS (SELECT inicio_semana FROM app.configuracion_empresa WHERE tenant_id = $3),
              p AS (
                SELECT CASE WHEN $2 = 'SEMANA'
                            THEN d.fecha - ((extract(isodow FROM d.fecha)::int - s.inicio_semana + 7) % 7)
                            ELSE date_trunc('month', d.fecha)::date END AS periodo,
                       sum(d.facturacion)::app.dinero AS facturacion, sum(d.costo)::app.dinero AS costo
                  FROM app.linea_base_periodo d CROSS JOIN s
                 WHERE d.linea_base_id = $1
                 GROUP BY 1)
         SELECT ${ACUMULADAS} FROM p ORDER BY periodo`,
        [lineaBase.id, granularidad, filas.cabecera.tenantId],
      );
      curvaBase = { id: lineaBase.id, nombre: lineaBase.nombre, periodos: rows };
    }
    return { granularidad, periodos: periodos.rows, totales: totales.rows[0]!, lineaBase: curvaBase };
  });
}

// -----------------------------------------------------------------------------
//  §19.8 · Líneas base. Solo con el presupuesto Activo; guardar no sube la
//  versión, porque no es una entrada.
// -----------------------------------------------------------------------------

export interface LineaBaseResumen {
  id: string;
  nombre: string;
  guardadaEn: Date;
  guardadaPor: string | null;
  fin: string;
}

const RESUMEN_DE_LINEA_BASE = `
    SELECT lb.id, lb.nombre, lb.guardada_en AS "guardadaEn", u.nombre AS "guardadaPor", ${FECHA_HORA('max(x.fin)')} AS fin
      FROM app.linea_base lb
      LEFT JOIN app.usuario u ON u.id = lb.guardada_por
      LEFT JOIN app.linea_base_actividad x ON x.linea_base_id = lb.id`;

export type ResultadoDeLineaBase =
  | { tipo: 'HECHO'; lineaBase: LineaBaseResumen }
  | { tipo: 'VERSION_VIEJA'; cronogramaId: string }
  | { tipo: 'DESACTUALIZADO'; leido: CronogramaLeido }
  | { tipo: 'NOMBRE_REPETIDO'; id: string; nombre: string };

/**
 * Guarda (o reemplaza, con `reemplazaId`) la foto de lo que la persona vio.
 * Si el cronograma no estaba al día, lo que vio ya no es lo que se guardaría:
 * recalcula, no guarda y lo dice (§19.8). null si no es de esta empresa.
 */
export async function guardarLineaBase(
  contexto: ContextoTenant,
  ubicacion: { cronogramaId: string } | { reemplazaId: string },
  version: number,
  nombre: string | null,
): Promise<ResultadoDeLineaBase | null> {
  return ejecutarConPermisoEnUnaFoto(contexto, 'PRESUPUESTOS.EDITAR', async (cliente) => {
    let cronogramaId: string;
    let reemplazaId: string | null = null;
    if ('cronogramaId' in ubicacion) cronogramaId = ubicacion.cronogramaId;
    else {
      const { rows } = await cliente.query<{ cronograma_id: string }>('SELECT cronograma_id FROM app.linea_base WHERE id = $1', [ubicacion.reemplazaId]);
      if (!rows[0]) return null;
      cronogramaId = rows[0].cronograma_id;
      reemplazaId = ubicacion.reemplazaId;
    }
    const bloqueada = await cliente.query('SELECT 1 FROM app.cronograma WHERE id = $1 FOR UPDATE', [cronogramaId]);
    if (bloqueada.rowCount !== 1) return null;
    let filas = (await cargarFilasEn(cliente, cronogramaId))!;
    if (filas.cabecera.version !== version) return { tipo: 'VERSION_VIEJA', cronogramaId };
    if (filas.presupuesto.estado !== 'ACTIVO') {
      throw new ErrorParaElUsuario(
        `Las líneas base se guardan solo con el presupuesto Activo, y este está ${filas.presupuesto.estado === 'ABIERTO' ? 'Abierto' : 'Cerrado'} (RF-PRG-09).`,
        'RECHAZADO',
      );
    }
    if (!estaAlDia(filas)) {
      filas = await recalcularEn(cliente, cronogramaId);
      return { tipo: 'DESACTUALIZADO', leido: { filas, recalculado: true, lineaBase: null } };
    }
    if (reemplazaId === null) {
      const { rows } = await cliente.query<{ id: string; nombre: string }>(
        'SELECT id, nombre FROM app.linea_base WHERE cronograma_id = $1 AND lower(btrim(nombre)) = lower(btrim($2))',
        [cronogramaId, nombre],
      );
      if (rows[0]) return { tipo: 'NOMBRE_REPETIDO', id: rows[0].id, nombre: rows[0].nombre };
    }
    const reparto = repartoEnMinutos(filas);
    const { rows } = await cliente.query<{ id: string }>('SELECT app.fn_guardar_linea_base($1, $2, $3::uuid[], $4::date[], $5::int[], $6) AS id', [
      cronogramaId,
      nombre,
      reparto.actividadIds,
      reparto.fechas,
      reparto.minutos,
      reemplazaId,
    ]);
    const resumen = await cliente.query<LineaBaseResumen>(`${RESUMEN_DE_LINEA_BASE} WHERE lb.id = $1 GROUP BY lb.id, u.nombre`, [rows[0]!.id]);
    return { tipo: 'HECHO', lineaBase: resumen.rows[0]! };
  });
}

/** null si el cronograma no es de esta empresa. */
export async function listarLineasBase(contexto: ContextoTenant, cronogramaId: string): Promise<LineaBaseResumen[] | null> {
  return ejecutarConPermiso(contexto, 'PRESUPUESTOS.VER', async (cliente) => {
    const { rowCount } = await cliente.query('SELECT 1 FROM app.cronograma WHERE id = $1', [cronogramaId]);
    if (rowCount !== 1) return null;
    const { rows } = await cliente.query<LineaBaseResumen>(
      `${RESUMEN_DE_LINEA_BASE} WHERE lb.cronograma_id = $1 GROUP BY lb.id, u.nombre ORDER BY lb.guardada_en, lb.id`,
      [cronogramaId],
    );
    return rows;
  });
}

/** Solo con el presupuesto Activo: lo rechaza la base, y deja su evento si entra. false si no es de esta empresa. */
export async function eliminarLineaBase(contexto: ContextoTenant, lineaBaseId: string): Promise<boolean> {
  return ejecutarConPermiso(contexto, 'PRESUPUESTOS.EDITAR', async (cliente) => {
    const { rowCount } = await cliente.query('DELETE FROM app.linea_base WHERE id = $1', [lineaBaseId]);
    return rowCount === 1;
  });
}
