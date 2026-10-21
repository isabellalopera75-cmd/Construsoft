import type { CalendarioCompilado } from './calendarioCompilado.js';
import { aMinutos } from './tiempo.js';

/*
 * El motor del cronograma (RF-PRG-05, D-81, D-87, D-89): CPM hacia adelante y
 * hacia atrás con las restricciones de P6, holgura total y libre, y la tarea
 * de administración. Recibe las duraciones ya en minutos y los calendarios ya
 * compilados; devuelve fechas en minutos. No lee ni escribe la base.
 *
 * Las reglas, como las fijó el 07 §6.9 y la bitácora del 20 de octubre:
 *
 *   - El desfase se cuenta en el calendario de la sucesora, en los dos pasos
 *     (RN-29). La duración y las holguras, en el de la actividad (RN-31).
 *   - Ninguna actividad empieza antes de la fecha de inicio del cronograma, y
 *     el paso hacia atrás arranca del fin temprano más tardío (A8).
 *   - Una restricción de inicio toma el comienzo de la jornada de su fecha, y
 *     una de fin el cierre; en un día no laborable, el siguiente comienzo o el
 *     cierre anterior (A7). Las obligatorias pasan por encima de la lógica.
 *     «Inicio el» y «fin el» son, como en P6, «después de» en el paso hacia
 *     adelante y «antes de» en el paso hacia atrás: la lógica puede
 *     empujarlas, y entonces sale holgura negativa, que es una alerta (D-87).
 *   - La holgura total es fin tardío menos fin temprano (P6 por defecto). La
 *     libre es lo que la actividad se puede correr sin mover el inicio
 *     temprano de ninguna sucesora; sin sucesoras, hasta el fin del proyecto.
 *   - Un hito de fin cae al cierre del último instante laborable; uno de
 *     inicio, en el siguiente instante laborable (RN-28).
 *   - La administración va del primer inicio al último fin de las
 *     actividades del presupuesto, sin hitos ni trámites, y no tiene holgura
 *     (RN-37). No tiene relaciones: la base no las deja crear.
 */

export type TipoDeActividad = 'ITEM' | 'HITO_INICIO' | 'HITO_FIN' | 'SIN_COSTO' | 'ADMINISTRACION';

export type TipoDeRestriccion =
  | 'INICIO_EL'
  | 'INICIO_ANTES'
  | 'INICIO_DESPUES'
  | 'FIN_EL'
  | 'FIN_ANTES'
  | 'FIN_DESPUES'
  | 'LO_MAS_TARDE'
  | 'INICIO_OBLIGATORIO'
  | 'FIN_OBLIGATORIO';

export interface Restriccion {
  tipo: TipoDeRestriccion;
  /** "2026-11-04"; nula solo en LO_MAS_TARDE. */
  fecha: string | null;
}

export interface ActividadDelMotor {
  id: string;
  tipo: TipoDeActividad;
  /** false: la actividad de un ítem que salió del presupuesto (RN-33). No cuenta para la administración. */
  enPresupuesto: boolean;
  /** Solo las esperas: el calendario corrido en vez del de la obra (D-86). */
  usaCorrido: boolean;
  /** La que usa el cálculo: la manual si hay, si no la calculada. Cero en los hitos. */
  duracionMinutos: number;
  restriccion: Restriccion | null;
  restriccionSecundaria: Restriccion | null;
}

export interface DependenciaDelMotor {
  predecesoraId: string;
  sucesoraId: string;
  tipo: 'FC' | 'CC' | 'FF' | 'CF';
  /** En minutos laborables del calendario de la sucesora; negativo traslapa. */
  desfaseMinutos: number;
}

export interface EntradaDelMotor {
  fechaInicio: string;
  calendarios: { OBRA: CalendarioCompilado; CORRIDO: CalendarioCompilado };
  actividades: ActividadDelMotor[];
  dependencias: DependenciaDelMotor[];
}

export interface ResultadoDeActividad {
  inicio: number;
  fin: number;
  duracionMinutos: number;
  /** Nulas en la administración. */
  inicioTardio: number | null;
  finTardio: number | null;
  holguraTotalMinutos: number | null;
  holguraLibreMinutos: number | null;
  /** Holgura total de cero o menos (RN-31). La administración nunca. */
  critica: boolean;
  /** RN-27: la barra termina antes del cierre de su jornada. Los hitos nunca. */
  finAMitadDeJornada: boolean;
}

export interface ResultadoDelMotor {
  actividades: Map<string, ResultadoDeActividad>;
  proyecto: { inicio: number; fin: number };
}

/** RF-PRG-05: hay un ciclo, no se calcula nada. `actividades` son las del ciclo, y solo esas. */
export class ErrorDeCiclo extends Error {
  constructor(readonly actividades: string[]) {
    super(`Hay un ciclo entre ${actividades.length} actividades: una actividad no puede depender de sí misma.`);
  }
}

interface Nodo {
  actividad: ActividadDelMotor;
  calendario: CalendarioCompilado;
  predecesoras: { nodo: number; dependencia: DependenciaDelMotor }[];
  sucesoras: { nodo: number; dependencia: DependenciaDelMotor }[];
  inicio: number;
  fin: number;
  inicioTardio: number;
  finTardio: number;
  holguraTotal: number;
  holguraLibre: number;
}

const restriccionesDe = (a: ActividadDelMotor) => [a.restriccion, a.restriccionSecundaria].filter((r): r is Restriccion => r !== null);

/** El orden topológico, o el ciclo que lo impide. */
function ordenar(nodos: Nodo[]): number[] {
  const entrantes = nodos.map((n) => n.predecesoras.length);
  const listos = nodos.flatMap((_, i) => (entrantes[i] === 0 ? [i] : []));
  const orden: number[] = [];
  while (listos.length > 0) {
    const i = listos.pop()!;
    orden.push(i);
    for (const { nodo } of nodos[i]!.sucesoras) {
      entrantes[nodo]! -= 1;
      if (entrantes[nodo] === 0) listos.push(nodo);
    }
  }
  if (orden.length === nodos.length) return orden;

  // Lo que quedó tiene al menos una predecesora que también quedó. Caminar
  // hacia atrás por ellas termina repitiendo un nodo: desde la primera vez
  // que aparece hasta ahí es el ciclo. Lo que cuelga del ciclo no entra.
  const quedo = new Set(nodos.flatMap((_, i) => (entrantes[i]! > 0 ? [i] : [])));
  let actual = quedo.values().next().value!;
  const visto = new Map<number, number>();
  const camino: number[] = [];
  while (!visto.has(actual)) {
    visto.set(actual, camino.length);
    camino.push(actual);
    actual = nodos[actual]!.predecesoras.find((p) => quedo.has(p.nodo))!.nodo;
  }
  throw new ErrorDeCiclo(camino.slice(visto.get(actual)).map((i) => nodos[i]!.actividad.id));
}

export function calcularCronograma(entrada: EntradaDelMotor): ResultadoDelMotor {
  const { OBRA, CORRIDO } = entrada.calendarios;
  const comienzo = aMinutos(entrada.fechaInicio);

  const administraciones = entrada.actividades.filter((a) => a.tipo === 'ADMINISTRACION');
  const nodos: Nodo[] = entrada.actividades
    .filter((a) => a.tipo !== 'ADMINISTRACION')
    .map((actividad) => ({
      actividad,
      calendario: actividad.usaCorrido ? CORRIDO : OBRA,
      predecesoras: [],
      sucesoras: [],
      inicio: 0,
      fin: 0,
      inicioTardio: 0,
      finTardio: 0,
      holguraTotal: 0,
      holguraLibre: 0,
    }));
  const indice = new Map(nodos.map((n, i) => [n.actividad.id, i]));
  for (const dependencia of entrada.dependencias) {
    const p = indice.get(dependencia.predecesoraId);
    const s = indice.get(dependencia.sucesoraId);
    if (p === undefined || s === undefined) {
      throw new Error(`La relación ${dependencia.predecesoraId} → ${dependencia.sucesoraId} apunta a una actividad que el motor no recibió.`);
    }
    nodos[p]!.sucesoras.push({ nodo: s, dependencia });
    nodos[s]!.predecesoras.push({ nodo: p, dependencia });
  }
  const orden = ordenar(nodos);

  // --- Hacia adelante -----------------------------------------------------------
  for (const i of orden) {
    const n = nodos[i]!;
    const c = n.calendario;
    const d = n.actividad.duracionMinutos;
    let desde = comienzo;
    const exigirFin = (t: number) => (desde = Math.max(desde, d > 0 ? c.sumarMinutosLaborables(t, -d) : t));
    for (const { nodo, dependencia } of n.predecesoras) {
      const p = nodos[nodo]!;
      const l = dependencia.desfaseMinutos;
      if (dependencia.tipo === 'FC') desde = Math.max(desde, c.sumarMinutosLaborables(p.fin, l));
      else if (dependencia.tipo === 'CC') desde = Math.max(desde, c.sumarMinutosLaborables(p.inicio, l));
      else if (dependencia.tipo === 'FF') exigirFin(c.sumarMinutosLaborables(p.fin, l));
      else exigirFin(c.sumarMinutosLaborables(p.inicio, l));
    }
    let inicioObligatorio: number | null = null;
    let finObligatorio: number | null = null;
    for (const r of restriccionesDe(n.actividad)) {
      if (r.tipo === 'INICIO_DESPUES' || r.tipo === 'INICIO_EL') desde = Math.max(desde, c.comienzoDeJornada(r.fecha!));
      else if (r.tipo === 'FIN_DESPUES' || r.tipo === 'FIN_EL') exigirFin(c.cierreDeJornada(r.fecha!));
      else if (r.tipo === 'INICIO_OBLIGATORIO') inicioObligatorio = c.comienzoDeJornada(r.fecha!);
      else if (r.tipo === 'FIN_OBLIGATORIO') finObligatorio = c.cierreDeJornada(r.fecha!);
    }
    if (inicioObligatorio !== null) {
      n.inicio = inicioObligatorio;
      n.fin = d > 0 ? c.sumarMinutosLaborables(n.inicio, d) : n.inicio;
    } else if (finObligatorio !== null) {
      n.fin = finObligatorio;
      n.inicio = d > 0 ? c.sumarMinutosLaborables(n.fin, -d) : n.fin;
    } else if (n.actividad.tipo === 'HITO_FIN') {
      // Al cierre del último instante laborable, pero nunca antes de que el cronograma empiece.
      const primerInstante = c.siguienteInstanteLaborable(comienzo);
      n.inicio = n.fin = Math.max(c.anteriorCierreLaborable(desde), primerInstante);
    } else {
      n.inicio = c.siguienteInstanteLaborable(desde);
      n.fin = d > 0 ? c.sumarMinutosLaborables(n.inicio, d) : n.inicio;
    }
  }

  const finDelProyecto = nodos.length > 0 ? Math.max(...nodos.map((n) => n.fin)) : OBRA.siguienteInstanteLaborable(comienzo);
  const inicioDelProyecto = nodos.length > 0 ? Math.min(...nodos.map((n) => n.inicio)) : finDelProyecto;

  // --- Hacia atrás ----------------------------------------------------------------
  for (const i of [...orden].reverse()) {
    const n = nodos[i]!;
    const c = n.calendario;
    const d = n.actividad.duracionMinutos;
    let hasta = finDelProyecto;
    const exigirInicio = (t: number) => (hasta = Math.min(hasta, d > 0 ? c.sumarMinutosLaborables(t, d) : t));
    for (const { nodo, dependencia } of n.sucesoras) {
      const s = nodos[nodo]!;
      const l = dependencia.desfaseMinutos;
      // El desfase, en el calendario de la sucesora también hacia atrás (RN-29).
      if (dependencia.tipo === 'FC') hasta = Math.min(hasta, s.calendario.sumarMinutosLaborables(s.inicioTardio, -l));
      else if (dependencia.tipo === 'CC') exigirInicio(s.calendario.sumarMinutosLaborables(s.inicioTardio, -l));
      else if (dependencia.tipo === 'FF') hasta = Math.min(hasta, s.calendario.sumarMinutosLaborables(s.finTardio, -l));
      else exigirInicio(s.calendario.sumarMinutosLaborables(s.finTardio, -l));
    }
    let inicioObligatorio: number | null = null;
    let finObligatorio: number | null = null;
    for (const r of restriccionesDe(n.actividad)) {
      if (r.tipo === 'INICIO_ANTES' || r.tipo === 'INICIO_EL') exigirInicio(c.comienzoDeJornada(r.fecha!));
      else if (r.tipo === 'FIN_ANTES' || r.tipo === 'FIN_EL') hasta = Math.min(hasta, c.cierreDeJornada(r.fecha!));
      else if (r.tipo === 'INICIO_OBLIGATORIO') inicioObligatorio = c.comienzoDeJornada(r.fecha!);
      else if (r.tipo === 'FIN_OBLIGATORIO') finObligatorio = c.cierreDeJornada(r.fecha!);
    }
    if (inicioObligatorio !== null) {
      n.inicioTardio = inicioObligatorio;
      n.finTardio = d > 0 ? c.sumarMinutosLaborables(inicioObligatorio, d) : inicioObligatorio;
    } else if (finObligatorio !== null) {
      n.finTardio = finObligatorio;
      n.inicioTardio = d > 0 ? c.sumarMinutosLaborables(finObligatorio, -d) : finObligatorio;
    } else {
      n.finTardio = c.anteriorCierreLaborable(hasta);
      n.inicioTardio = d > 0 ? c.sumarMinutosLaborables(n.finTardio, -d) : n.finTardio;
    }
    n.holguraTotal = c.minutosLaborablesEntre(n.fin, n.finTardio);
  }

  // --- Holgura libre, y «lo más tarde posible» --------------------------------------
  const holguraLibre = (n: Nodo): number => {
    const c = n.calendario;
    if (n.sucesoras.length === 0) return c.minutosLaborablesEntre(n.fin, finDelProyecto);
    return Math.min(
      ...n.sucesoras.map(({ nodo, dependencia }) => {
        const s = nodos[nodo]!;
        const l = dependencia.desfaseMinutos;
        const atras = (t: number) => s.calendario.sumarMinutosLaborables(t, -l);
        if (dependencia.tipo === 'FC') return c.minutosLaborablesEntre(n.fin, atras(s.inicio));
        if (dependencia.tipo === 'CC') return c.minutosLaborablesEntre(n.inicio, atras(s.inicio));
        if (dependencia.tipo === 'FF') return c.minutosLaborablesEntre(n.fin, atras(s.fin));
        return c.minutosLaborablesEntre(n.inicio, atras(s.fin));
      }),
    );
  };
  // De la última a la primera, para que cada una se corra con sus sucesoras ya en su lugar.
  // La holgura total se queda como salió del cálculo: correrla no la vuelve crítica.
  for (const i of [...orden].reverse()) {
    const n = nodos[i]!;
    if (n.actividad.restriccion?.tipo !== 'LO_MAS_TARDE') continue;
    const libre = holguraLibre(n);
    if (libre <= 0) continue;
    const c = n.calendario;
    const d = n.actividad.duracionMinutos;
    n.inicio = c.siguienteInstanteLaborable(c.sumarMinutosLaborables(n.inicio, libre));
    n.fin = d > 0 ? c.sumarMinutosLaborables(n.inicio, d) : n.inicio;
  }
  for (const n of nodos) n.holguraLibre = holguraLibre(n);

  // --- El resultado ---------------------------------------------------------------
  const actividades = new Map<string, ResultadoDeActividad>();
  for (const n of nodos) {
    const d = n.actividad.duracionMinutos;
    actividades.set(n.actividad.id, {
      inicio: n.inicio,
      fin: n.fin,
      duracionMinutos: d,
      inicioTardio: n.inicioTardio,
      finTardio: n.finTardio,
      holguraTotalMinutos: n.holguraTotal,
      holguraLibreMinutos: n.holguraLibre,
      critica: n.holguraTotal <= 0,
      finAMitadDeJornada: d > 0 && !n.calendario.esCierreDeJornada(n.fin),
    });
  }

  const delPresupuesto = nodos.filter((n) => n.actividad.tipo === 'ITEM' && n.actividad.enPresupuesto);
  const inicioAdm = delPresupuesto.length > 0 ? Math.min(...delPresupuesto.map((n) => n.inicio)) : OBRA.siguienteInstanteLaborable(comienzo);
  const finAdm = delPresupuesto.length > 0 ? Math.max(...delPresupuesto.map((n) => n.fin)) : inicioAdm;
  for (const adm of administraciones) {
    const duracion = OBRA.minutosLaborablesEntre(inicioAdm, finAdm);
    actividades.set(adm.id, {
      inicio: inicioAdm,
      fin: finAdm,
      duracionMinutos: duracion,
      inicioTardio: null,
      finTardio: null,
      holguraTotalMinutos: null,
      holguraLibreMinutos: null,
      critica: false,
      finAMitadDeJornada: duracion > 0 && !OBRA.esCierreDeJornada(finAdm),
    });
  }

  return { actividades, proyecto: { inicio: inicioDelProyecto, fin: finDelProyecto } };
}
