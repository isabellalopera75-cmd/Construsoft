import { createHash } from 'node:crypto';
import { redondear } from '../comun/formatoNumerico.js';
import type { CalendarioCompilado } from '../cronograma/calendarioCompilado.js';
import type { FilasDelCronograma } from '../cronograma/filas.js';
import type { Restriccion, TipoDeRestriccion } from '../cronograma/motor.js';
import { minutosDeDesfase } from '../cronograma/duraciones.js';
import { conHorizonte } from '../cronograma/recalculo.js';
import { aMinutos, deMinutos } from '../cronograma/tiempo.js';
import type { ActividadEnVista, VistaCronograma } from '../cronograma/vista.js';
import type { Calendario, Tramo } from '../infraestructura/basedatos/calendarios.js';
import { filasEnOrden } from './gantt.js';

/*
 * RF-PRG-11 · El cronograma en XER, el formato de intercambio de Primavera P6
 * (CONTRATO §19.9, D-92). La forma sale de los archivos de muestra del dueño
 * para P6 8.2, 15.2 y 21.12, leídos el 21 de octubre de 2026:
 *
 *   - Windows-1252, fin de línea CRLF y sin BOM. Un carácter que no existe en
 *     esa página de códigos pierde la tilde que no tiene (ő → o); si tampoco
 *     así cabe, sale «?».
 *   - Una línea ERMHDR con la versión, y después cada tabla: %T con su nombre,
 *     %F con las columnas, una %R por fila; al final, %E. Las columnas son las
 *     de las muestras, en su orden, y son las mismas en las tres versiones.
 *   - 8.2 y 15.2 son el mismo archivo salvo la versión. 21.12 suma la tabla
 *     SCHEDOPTIONS, y con ella el calendario del desfase: el de la sucesora
 *     (RN-29). Las dos anteriores no tienen dónde decirlo, y P6 usa por
 *     defecto el de la predecesora: solo cambia algo en una relación entre
 *     una actividad de obra y una del corrido.
 *   - La administración es un Level of Effort (TT_LOE), como en las muestras:
 *     una relación CC desde la actividad que empieza primero, y una FF hacia
 *     la que termina de última.
 *   - Los capítulos y «Hitos y trámites» son nodos de la EDT (PROJWBS) bajo el
 *     nodo del proyecto, que lleva el código del presupuesto.
 *   - Duraciones, holguras y desfases en horas. Las fechas, como las calculó
 *     el motor; P6 las recalcula al programar. La fecha de corte es la de
 *     inicio del cronograma.
 *   - El costo es opcional y por defecto no va (RF-PRG-11). Si va, cada
 *     actividad del presupuesto y la administración llevan un gasto
 *     (PROJCOST) con su costo, repartido uniforme.
 *
 * Función pura: la vista y las filas adentro, los bytes del archivo afuera.
 */

export type VersionDeP6 = '8.2' | '15.2' | '21.12';

export interface DatosDelXer {
  vista: VistaCronograma;
  filas: FilasDelCronograma;
  presupuesto: { codigo: string; nombre: string };
  costo: boolean;
  version: VersionDeP6;
  /** "2026-10-21": el día de la exportación, en Colombia. */
  hoy: string;
}

// --- Windows-1252 ----------------------------------------------------------------------------

/** Los 27 caracteres de 0x80–0x9F que Windows-1252 no comparte con Latin-1. */
const DE_0X80 = '€\u0000‚ƒ„…†‡ˆ‰Š‹Œ\u0000Ž\u0000\u0000‘’“”•–—˜™š›œ\u0000žŸ';
const BYTE_DE = new Map<number, number>();
for (let b = 0; b < 0x100; b += 1) {
  if (b >= 0x80 && b < 0xa0) {
    const c = DE_0X80.codePointAt(b - 0x80)!;
    if (c !== 0) BYTE_DE.set(c, b);
  } else BYTE_DE.set(b, b);
}
const MARCA_COMBINANTE = /^\p{M}$/u;

/** El texto en Windows-1252. Lo que no cabe pierde la marca que no existe; si ni así, «?». */
export function aWindows1252(texto: string): Buffer {
  const bytes: number[] = [];
  for (const caracter of texto.normalize('NFC')) {
    const b = BYTE_DE.get(caracter.codePointAt(0)!);
    if (b !== undefined) {
      bytes.push(b);
      continue;
    }
    const base = [...caracter.normalize('NFD')].filter((x) => !MARCA_COMBINANTE.test(x)).map((x) => BYTE_DE.get(x.codePointAt(0)!));
    if (base.length > 0 && base.every((x) => x !== undefined)) bytes.push(...(base as number[]));
    else bytes.push(0x3f);
  }
  return Buffer.from(bytes);
}

// --- Valores ---------------------------------------------------------------------------------

/** Un campo no puede llevar tabulador ni salto de línea: separan columnas y filas. */
const limpio = (texto: string) => texto.replace(/[\t\r\n]+/g, ' ');
/** "2026-11-02 07:00", como fecha-hora de P6. */
const fechaHora = (minutos: number) => deMinutos(minutos).replace('T', ' ');
/** Horas sin ceros de sobra: 16, 4.5, 0.1667. Son tiempos, no dinero. */
const horas = (minutos: number) => String(Number((minutos / 60).toFixed(4)));
/** "8.00" → "8": el número de la base, sin ceros de sobra. */
const sinCeros = (texto: string) => (texto.includes('.') ? texto.replace(/\.?0+$/, '') : texto);
/** El GUID de P6: 16 bytes en base64, sin el relleno. Del uuid si lo hay, para que exportar dos veces dé el mismo. */
function guid(semilla: string): string {
  const bytes = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(semilla)
    ? Buffer.from(semilla.replace(/-/g, ''), 'hex')
    : createHash('md5').update(semilla).digest();
  return bytes.toString('base64').slice(0, 22);
}
/** Días desde el 30 de diciembre de 1899, como las fechas de Excel: P6 las usa en las excepciones del calendario. */
const serialDeFecha = (fecha: string) => (Date.parse(`${fecha}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000;

// --- Códigos de P6 ---------------------------------------------------------------------------

const TIPO_DE_RESTRICCION: Record<TipoDeRestriccion, string> = {
  INICIO_EL: 'CS_MSO',
  INICIO_ANTES: 'CS_MSOB',
  INICIO_DESPUES: 'CS_MSOA',
  FIN_EL: 'CS_MEO',
  FIN_ANTES: 'CS_MEOB',
  FIN_DESPUES: 'CS_MEOA',
  LO_MAS_TARDE: 'CS_ALAP',
  INICIO_OBLIGATORIO: 'CS_MANDSTART',
  FIN_OBLIGATORIO: 'CS_MANDFIN',
};
const TIPO_DE_RELACION: Record<string, string> = { FC: 'PR_FS', CC: 'PR_SS', FF: 'PR_FF', CF: 'PR_SF' };
const TIPO_DE_TAREA: Record<ActividadEnVista['tipo'], [string, string]> = {
  ITEM: ['TT_Task', 'DT_FixedDUR2'],
  SIN_COSTO: ['TT_Task', 'DT_FixedDUR2'],
  HITO_INICIO: ['TT_Mile', 'DT_FixedDrtn'],
  HITO_FIN: ['TT_FinMile', 'DT_FixedDrtn'],
  ADMINISTRACION: ['TT_LOE', 'DT_FixedDUR2'],
};

// --- Las columnas, como en las muestras ------------------------------------------------------

const COLUMNAS = {
  CURRTYPE:
    'curr_id decimal_digit_cnt curr_symbol decimal_symbol digit_group_symbol pos_curr_fmt_type neg_curr_fmt_type curr_type curr_short_name group_digit_cnt base_exch_rate',
  OBS: 'obs_id parent_obs_id guid seq_num obs_name obs_descr',
  PROJECT:
    'proj_id fy_start_month_num rsrc_self_add_flag allow_complete_flag rsrc_multi_assign_flag checkout_flag project_flag step_complete_flag cost_qty_recalc_flag batch_sum_flag name_sep_char def_complete_pct_type proj_short_name acct_id orig_proj_id source_proj_id base_type_id clndr_id sum_base_proj_id task_code_base task_code_step priority_num wbs_max_sum_level strgy_priority_num last_checksum critical_drtn_hr_cnt def_cost_per_qty last_recalc_date plan_start_date plan_end_date scd_end_date add_date last_tasksum_date fcst_start_date def_duration_type task_code_prefix guid def_qty_type add_by_name web_local_root_path proj_url def_rate_type add_act_remain_flag act_this_per_link_flag def_task_type act_pct_link_flag critical_path_type task_code_prefix_flag def_rollup_dates_flag use_project_baseline_flag rem_target_link_flag reset_planned_flag allow_neg_act_flag sum_assign_level last_fin_dates_id last_baseline_update_date cr_external_key apply_actuals_date fintmpl_id location_id loaded_scope_level export_flag new_fin_dates_id baselines_to_export baseline_names_to_export next_data_date close_period_flag sum_refresh_date trsrcsum_loaded sumtask_loaded',
  CALENDAR:
    'clndr_id default_flag clndr_name proj_id base_clndr_id last_chng_date clndr_type day_hr_cnt week_hr_cnt month_hr_cnt year_hr_cnt rsrc_private clndr_data',
  SCHEDOPTIONS:
    'schedoptions_id proj_id sched_outer_depend_type sched_open_critical_flag sched_lag_early_start_flag sched_retained_logic sched_setplantoforecast sched_float_type sched_calendar_on_relationship_lag sched_use_expect_end_flag sched_progress_override level_float_thrs_cnt level_outer_assign_flag level_outer_assign_priority level_over_alloc_pct level_within_float_flag level_keep_sched_date_flag level_all_rsrc_flag sched_use_project_end_date_for_float enable_multiple_longest_path_calc limit_multiple_longest_path_calc max_multiple_longest_path use_total_float_multiple_longest_paths key_activity_for_multiple_longest_paths LevelPriorityList',
  PROJWBS:
    'wbs_id proj_id obs_id seq_num est_wt proj_node_flag sum_data_flag status_code wbs_short_name wbs_name phase_id parent_wbs_id ev_user_pct ev_etc_user_value orig_cost indep_remain_total_cost ann_dscnt_rate_pct dscnt_period_type indep_remain_work_qty anticip_start_date anticip_end_date ev_compute_type ev_etc_compute_type guid tmpl_guid plan_open_state',
  TASK:
    'task_id proj_id wbs_id clndr_id phys_complete_pct rev_fdbk_flag est_wt lock_plan_flag auto_compute_act_flag complete_pct_type task_type duration_type status_code task_code task_name rsrc_id total_float_hr_cnt free_float_hr_cnt remain_drtn_hr_cnt act_work_qty remain_work_qty target_work_qty target_drtn_hr_cnt target_equip_qty act_equip_qty remain_equip_qty cstr_date act_start_date act_end_date late_start_date late_end_date expect_end_date early_start_date early_end_date restart_date reend_date target_start_date target_end_date rem_late_start_date rem_late_end_date cstr_type priority_type suspend_date resume_date float_path float_path_order guid tmpl_guid cstr_date2 cstr_type2 driving_path_flag act_this_per_work_qty act_this_per_equip_qty external_early_start_date external_late_end_date create_date update_date create_user update_user location_id crt_path_num',
  PROJCOST:
    'cost_item_id acct_id pobs_id cost_type_id proj_id task_id cost_name po_number vendor_name act_cost cost_per_qty remain_cost target_cost cost_load_type auto_compute_act_flag target_qty qty_name cost_descr contract_manager_import',
  TASKPRED: 'task_pred_id task_id pred_task_id proj_id pred_proj_id pred_type lag_hr_cnt comments float_path aref arls',
} as const;
type Tabla = keyof typeof COLUMNAS;

/** Una tabla del XER: cada fila trae sus valores por nombre de columna; lo que falta va vacío. */
function tabla(nombre: Tabla, filas: Record<string, string | number>[]): string[] {
  const columnas = COLUMNAS[nombre].split(' ');
  return [
    `%T\t${nombre}`,
    `%F\t${columnas.join('\t')}`,
    ...filas.map((f) => `%R\t${columnas.map((c) => limpio(String(f[c] ?? ''))).join('\t')}`),
  ];
}

// --- El calendario ---------------------------------------------------------------------------

/** El salto de línea dentro de clndr_data. */
const SALTO = '\x7f\x7f';
/** Un nodo de clndr_data: «(0||nombre(atributos)(hijos))», con la sangría de su nivel. */
const nodo = (nivel: number, nombre: string | number, atributos: string, hijos: string[]) =>
  `${' '.repeat(nivel * 2)}(0||${nombre}(${atributos})(${hijos.length > 0 ? SALTO + hijos.join(SALTO) : ''}))`;
/** La medianoche del final del día es 00:00 en P6, como en Project. */
const tramos = (nivel: number, lista: Tramo[]) => lista.map((t, i) => nodo(nivel, i, `s|${t.inicio}|f|${t.fin === '24:00' ? '00:00' : t.fin}`, []));

/** clndr_data: la semana de 1 (domingo) a 7 y las excepciones con su fecha de Excel. La semana del sistema empieza el lunes. */
export function datosDelCalendario(c: Calendario): string {
  const dias = [1, 2, 3, 4, 5, 6, 7].map((d) => nodo(2, d, '', tramos(3, c.semana[(d + 5) % 7]!)));
  const excepciones = c.excepciones.map((e, i) => nodo(2, i, `d|${serialDeFecha(e.fecha)}`, tramos(3, e.tramos)));
  return nodo(0, 'CalendarData', '', [nodo(1, 'DaysOfWeek', '', dias), nodo(1, 'VIEW', 'ShowTotal|N', []), nodo(1, 'Exceptions', '', excepciones)]);
}

// --- El archivo ------------------------------------------------------------------------------

const PROYECTO = 1;
const OBS = 1;
const USUARIO = 'CONSTRUSOFT';

export function generarXer(datos: DatosDelXer): Buffer {
  const { vista, filas, presupuesto, costo, version, hoy } = datos;
  const fechas = [vista.cronograma.fechaInicio, ...vista.actividades.flatMap((a) => [a.inicio.slice(0, 10), a.fin.slice(0, 10)])];
  for (const a of vista.actividades) for (const r of [a.restriccion, a.restriccionSecundaria]) if (r?.fecha) fechas.push(r.fecha);

  const texto = conHorizonte(filas, fechas, (cal) => {
    const calDe = (a: ActividadEnVista): CalendarioCompilado => (a.usaCorrido ? cal.CORRIDO : cal.OBRA);
    const CALENDARIO = { OBRA: 1, CORRIDO: 2 };
    const ahora = `${hoy} 00:00`;

    // La EDT: el nodo del proyecto y, debajo, los capítulos y los grupos, en el orden de la pantalla.
    const ordenadas = filasEnOrden(vista);
    const nodos: Record<string, string | number>[] = [];
    const wbs = (id: number, padre: number | '', corto: string, nombre: string, semilla: string, raiz = false) =>
      nodos.push({
        wbs_id: id, proj_id: PROYECTO, obs_id: OBS, seq_num: nodos.length * 10, est_wt: 1, proj_node_flag: raiz ? 'Y' : 'N', sum_data_flag: 'N',
        status_code: 'WS_Open', wbs_short_name: corto, wbs_name: nombre, parent_wbs_id: padre, ev_user_pct: 6, ev_etc_user_value: '0.88',
        orig_cost: '0.0000', indep_remain_total_cost: '0.0000', dscnt_period_type: 'Month', ev_compute_type: 'EC_Cmp_pct', ev_etc_compute_type: 'EE_PF_cpi', guid: guid(semilla),
      });
    wbs(1, '', presupuesto.codigo, presupuesto.nombre, vista.cronograma.presupuestoId, true);
    const pila = [1];
    const wbsDe = new Map<string, number>();
    let grupo = 0;
    for (const f of ordenadas) {
      if (f.tipo === 'actividad') {
        wbsDe.set(f.actividad.id, pila[f.nivel - 1]!);
        continue;
      }
      const id = nodos.length + 1;
      if (f.tipo === 'capitulo') wbs(id, pila[f.nivel - 1]!, f.codigo.split('.').pop()!, f.nombre, `${vista.cronograma.id}:${f.codigo}`);
      else if (f.nivel === 1) wbs(id, pila[0]!, 'HT', f.texto, `${vista.cronograma.id}:HT`);
      else wbs(id, pila[f.nivel - 1]!, String((grupo += 1)), f.texto, `${vista.cronograma.id}:HT:${grupo}`);
      pila[f.nivel] = id;
      pila.length = f.nivel + 1;
    }

    const actividades = ordenadas.flatMap((f) => (f.tipo === 'actividad' ? [f.actividad] : []));
    const taskId = new Map(actividades.map((a, i) => [a.id, i + 1]));
    const fechaDe = (a: ActividadEnVista, r: Restriccion | null) =>
      r?.fecha ? fechaHora(r.tipo.startsWith('INICIO') ? calDe(a).comienzoDeJornada(r.fecha) : calDe(a).cierreDeJornada(r.fecha)) : '';

    const tareas = actividades.map((a) => {
      const calculo = filas.calculos.get(a.id);
      const [inicio, fin] = [aMinutos(a.inicio), aMinutos(a.fin)];
      const [inicioTardio, finTardio] = [a.inicioTardio ? aMinutos(a.inicioTardio) : inicio, a.finTardio ? aMinutos(a.finTardio) : fin];
      const [tipo, duracion] = TIPO_DE_TAREA[a.tipo];
      const hito = a.tipo === 'HITO_INICIO' || a.tipo === 'HITO_FIN';
      const duracionHoras = horas(hito ? 0 : calDe(a).minutosLaborablesEntre(inicio, fin));
      const holgura = (m: number | null | undefined) => (m === null || m === undefined ? '' : horas(m));
      return {
        task_id: taskId.get(a.id)!, proj_id: PROYECTO, wbs_id: wbsDe.get(a.id)!, clndr_id: a.usaCorrido ? CALENDARIO.CORRIDO : CALENDARIO.OBRA,
        phys_complete_pct: 0, rev_fdbk_flag: 'N', est_wt: 1, lock_plan_flag: 'N', auto_compute_act_flag: 'N', complete_pct_type: 'CP_Drtn',
        task_type: tipo, duration_type: duracion, status_code: 'TK_NotStart', task_code: a.codigo, task_name: a.nombre,
        total_float_hr_cnt: holgura(calculo?.holguraTotalMinutos), free_float_hr_cnt: holgura(calculo?.holguraLibreMinutos),
        remain_drtn_hr_cnt: duracionHoras, target_drtn_hr_cnt: duracionHoras,
        act_work_qty: 0, remain_work_qty: 0, target_work_qty: 0, target_equip_qty: 0, act_equip_qty: 0, remain_equip_qty: 0,
        cstr_date: fechaDe(a, a.restriccion), cstr_type: a.restriccion ? TIPO_DE_RESTRICCION[a.restriccion.tipo] : '',
        cstr_date2: fechaDe(a, a.restriccionSecundaria), cstr_type2: a.restriccionSecundaria ? TIPO_DE_RESTRICCION[a.restriccionSecundaria.tipo] : '',
        late_start_date: fechaHora(inicioTardio), late_end_date: fechaHora(finTardio),
        early_start_date: fechaHora(inicio), early_end_date: fechaHora(fin), restart_date: fechaHora(inicio), reend_date: fechaHora(fin),
        target_start_date: fechaHora(inicio), target_end_date: fechaHora(fin), rem_late_start_date: fechaHora(inicioTardio), rem_late_end_date: fechaHora(finTardio),
        priority_type: 'PT_Normal', guid: guid(a.id), driving_path_flag: 'N', act_this_per_work_qty: 0, act_this_per_equip_qty: 0,
        create_date: ahora, update_date: ahora, create_user: USUARIO, update_user: USUARIO,
      };
    });

    // Las relaciones, y las dos de la administración: P6 calcula el Level of Effort con ellas.
    const relaciones: Record<string, string | number>[] = [];
    const relacion = (predecesora: number, sucesora: number, tipo: string, desfaseMinutos: number) =>
      relaciones.push({
        task_pred_id: relaciones.length + 1, task_id: sucesora, pred_task_id: predecesora, proj_id: PROYECTO, pred_proj_id: PROYECTO,
        pred_type: tipo, lag_hr_cnt: horas(desfaseMinutos),
      });
    for (const d of filas.dependencias) {
      const [p, s] = [taskId.get(d.predecesoraId), taskId.get(d.sucesoraId)];
      if (p !== undefined && s !== undefined) relacion(p, s, TIPO_DE_RELACION[d.tipo]!, minutosDeDesfase(d.desfaseHoras));
    }
    const administracion = actividades.find((a) => a.tipo === 'ADMINISTRACION');
    const otras = tareas.filter((t) => t.task_type !== 'TT_LOE');
    if (administracion && otras.length > 0) {
      const primera = otras.reduce((x, y) => (y.early_start_date < x.early_start_date ? y : x));
      const ultima = otras.reduce((x, y) => (y.early_end_date > x.early_end_date ? y : x));
      const loe = taskId.get(administracion.id)!;
      relacion(primera.task_id, loe, 'PR_SS', 0);
      relacion(loe, ultima.task_id, 'PR_FF', 0);
    }

    const gastos = costo
      ? actividades
          .filter((a) => (a.tipo === 'ITEM' && a.enPresupuesto) || a.tipo === 'ADMINISTRACION')
          .map((a, i) => {
            // RF-PRG-11 · El costo va como lo dio la base, sobre el texto: el dinero no pasa por Number.
            const valor = redondear(a.costo, 2);
            return {
              cost_item_id: i + 1, proj_id: PROYECTO, task_id: taskId.get(a.id)!, cost_name: 'Costo', act_cost: '0.00', cost_per_qty: valor,
              remain_cost: valor, target_cost: valor, cost_load_type: 'CL_Uniform', auto_compute_act_flag: 'N', target_qty: 1,
            };
          })
      : [];

    const calendario = (id: number, c: Calendario) => {
      const semana = Number(c.horasSemana);
      return {
        clndr_id: id, default_flag: 'N', clndr_name: `${presupuesto.codigo} - ${c.nombre}`, last_chng_date: ahora, clndr_type: 'CA_Base',
        day_hr_cnt: sinCeros(c.horasPorDia), week_hr_cnt: sinCeros(c.horasSemana), month_hr_cnt: Math.round(semana * 4.3), year_hr_cnt: Math.round(semana * 50),
        rsrc_private: 'N', clndr_data: datosDelCalendario(c),
      };
    };

    const inicioDelCorte = `${vista.cronograma.fechaInicio} 00:00`;
    const lineas = [
      ['ERMHDR', version, hoy, 'Project', USUARIO, USUARIO, 'dbxDatabaseNoName', 'Project Management', 'COP'].join('\t'),
      ...tabla('CURRTYPE', [
        {
          curr_id: 1, decimal_digit_cnt: 2, curr_symbol: '$', decimal_symbol: '.', digit_group_symbol: ',', pos_curr_fmt_type: '#1.1',
          neg_curr_fmt_type: '(#1.1)', curr_type: 'Peso colombiano', curr_short_name: 'COP', group_digit_cnt: 3, base_exch_rate: 1,
        },
      ]),
      ...tabla('OBS', [{ obs_id: OBS, seq_num: 0, obs_name: 'Enterprise' }]),
      ...tabla('PROJECT', [
        {
          proj_id: PROYECTO, fy_start_month_num: 1, rsrc_self_add_flag: 'Y', allow_complete_flag: 'Y', rsrc_multi_assign_flag: 'Y', checkout_flag: 'N',
          project_flag: 'Y', step_complete_flag: 'N', cost_qty_recalc_flag: 'N', batch_sum_flag: 'Y', name_sep_char: '.', def_complete_pct_type: 'CP_Drtn',
          proj_short_name: presupuesto.codigo, clndr_id: CALENDARIO.OBRA, task_code_base: 1000, task_code_step: 10, priority_num: 10,
          wbs_max_sum_level: 2, strgy_priority_num: 500, critical_drtn_hr_cnt: 0, def_cost_per_qty: '0.0000',
          last_recalc_date: inicioDelCorte, plan_start_date: inicioDelCorte, scd_end_date: fechaHora(aMinutos(vista.cronograma.fin)), add_date: ahora,
          def_duration_type: 'DT_FixedDUR2', task_code_prefix: 'A', guid: guid(vista.cronograma.id), add_by_name: USUARIO, def_rate_type: 'COST_PER_QTY',
          add_act_remain_flag: 'Y', act_this_per_link_flag: 'Y', def_task_type: 'TT_Task', act_pct_link_flag: 'N', critical_path_type: 'CT_TotFloat',
          task_code_prefix_flag: 'N', def_rollup_dates_flag: 'Y', use_project_baseline_flag: 'Y', rem_target_link_flag: 'Y', reset_planned_flag: 'Y',
          allow_neg_act_flag: 'Y', sum_assign_level: 'SL_Taskrsrc', loaded_scope_level: 7, export_flag: 'Y',
        },
      ]),
      ...tabla('CALENDAR', [calendario(CALENDARIO.OBRA, vista.calendarios.obra), calendario(CALENDARIO.CORRIDO, vista.calendarios.corrido)]),
      ...(version === '21.12'
        ? tabla('SCHEDOPTIONS', [
            {
              schedoptions_id: 1, proj_id: PROYECTO, sched_outer_depend_type: 'SD_Both', sched_open_critical_flag: 'N', sched_lag_early_start_flag: 'Y',
              sched_retained_logic: 'Y', sched_setplantoforecast: 'N', sched_float_type: 'FT_FF',
              // RN-29 · El desfase se cuenta en el calendario de la sucesora.
              sched_calendar_on_relationship_lag: 'rcal_Successor',
              sched_use_expect_end_flag: 'Y', sched_progress_override: 'N', level_float_thrs_cnt: 0, level_outer_assign_flag: 'N',
              level_outer_assign_priority: 5, level_over_alloc_pct: 25, level_within_float_flag: 'N', level_keep_sched_date_flag: 'Y',
              level_all_rsrc_flag: 'Y', sched_use_project_end_date_for_float: 'Y', enable_multiple_longest_path_calc: 'N',
              limit_multiple_longest_path_calc: 'Y', max_multiple_longest_path: 10, use_total_float_multiple_longest_paths: 'Y',
              LevelPriorityList: `priority_type,ASC_BY_FIELD/ASC${SALTO}`,
            },
          ])
        : []),
      ...tabla('PROJWBS', nodos),
      ...tabla('TASK', tareas),
      ...(gastos.length > 0 ? tabla('PROJCOST', gastos) : []),
      ...tabla('TASKPRED', relaciones),
      '%E',
      '',
    ];
    return lineas.join('\r\n');
  });
  return aWindows1252(texto);
}
