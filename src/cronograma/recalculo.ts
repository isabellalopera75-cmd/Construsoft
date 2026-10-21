import type { Calendario } from '../infraestructura/basedatos/calendarios.js';
import { compilarCalendario, ErrorDeCalendario, type CalendarioCompilado } from './calendarioCompilado.js';
import { minutosCalculados, minutosDeDesfase, minutosDeDuracionManual } from './duraciones.js';
import type { FilasDelCronograma } from './filas.js';
import { calcularCronograma, type ActividadDelMotor } from './motor.js';
import { diaDeFecha, fechaDeDia } from './tiempo.js';

/*
 * Del cronograma leído de la base a la entrada del motor, y de su resultado a
 * las filas de app.actividad_calculo. Puro: no lee ni escribe la base.
 */

export interface CalendariosCompilados {
  OBRA: CalendarioCompilado;
  CORRIDO: CalendarioCompilado;
}

/** Lo que el recálculo escribe por actividad, en minutos. */
export interface CalculoNuevo {
  actividadId: string;
  inicio: number;
  fin: number;
  inicioTardio: number | null;
  finTardio: number | null;
  duracionCalculadaMinutos: number | null;
  duracionMinutos: number;
  holguraTotalMinutos: number | null;
  holguraLibreMinutos: number | null;
}

const MARGEN_DIAS = 400;

export const definicionDe = (c: Calendario) => ({
  semana: c.semana,
  excepciones: c.excepciones.map((e) => ({ fecha: e.fecha, tramos: e.tramos })),
});

/**
 * Compila los dos calendarios para un horizonte que cubre las fechas dadas,
 * con margen hacia atrás (desfases negativos, restricciones anteriores) y
 * `anios` hacia adelante. El horizonte lo dimensiona quien llama: no hay una
 * cifra fija que sirva para toda obra.
 */
export function compilarCalendarios(filas: Pick<FilasDelCronograma, 'calendarios'>, fechas: string[], anios: number): CalendariosCompilados {
  const dias = fechas.map(diaDeFecha);
  const desde = fechaDeDia(Math.min(...dias) - MARGEN_DIAS);
  const hasta = fechaDeDia(Math.max(...dias) + Math.ceil(anios * 366));
  return {
    OBRA: compilarCalendario(definicionDe(filas.calendarios.obra), { desde, hasta }),
    CORRIDO: compilarCalendario(definicionDe(filas.calendarios.corrido), { desde, hasta }),
  };
}

/** Intenta con 6 años y duplica mientras el cálculo se salga del horizonte, hasta 96. */
export function conHorizonte<T>(filas: Pick<FilasDelCronograma, 'calendarios'>, fechas: string[], operacion: (c: CalendariosCompilados) => T): T {
  for (let anios = 6; ; anios *= 2) {
    try {
      return operacion(compilarCalendarios(filas, fechas, anios));
    } catch (error) {
      if (!(error instanceof ErrorDeCalendario) || error.motivo !== 'FUERA_DEL_HORIZONTE' || anios >= 96) throw error;
    }
  }
}

/** La duración calculada (nula si no hay de dónde) y la que usa el motor (07 §6.1, 6.9). */
export function duracionesDe(filas: FilasDelCronograma, a: FilasDelCronograma['actividades'][number]): { calculada: number | null; usada: number } {
  const manual = a.duracionManualHoras === null ? null : minutosDeDuracionManual(a.duracionManualHoras);
  if (a.tipo === 'ITEM' && a.item) {
    // Cantidad cero: dura cero aunque haya rendimiento (07 §6.9).
    const calculada = minutosCalculados(a.item.cantidad, a.item.rendimiento, filas.presupuesto.horasPorJornal, a.cuadrillas);
    return { calculada, usada: manual ?? calculada ?? 0 };
  }
  if (a.tipo === 'ITEM') {
    // RN-33 · Ya no está en el presupuesto: conserva la duración que tenía,
    // para que la cadena que la incluye no se acorte en silencio.
    return { calculada: null, usada: manual ?? filas.calculos.get(a.id)?.duracionMinutos ?? 0 };
  }
  if (a.tipo === 'SIN_COSTO') return { calculada: null, usada: manual ?? 0 };
  return { calculada: null, usada: 0 };
}

/** Las fechas que el horizonte tiene que cubrir para calcular: el inicio y las de las restricciones. */
function fechasParaCalcular(filas: FilasDelCronograma): string[] {
  const fechas = [filas.cabecera.fechaInicio];
  for (const a of filas.actividades) {
    for (const r of [a.restriccion, a.restriccionSecundaria]) if (r?.fecha) fechas.push(r.fecha);
  }
  return fechas;
}

export function recalcular(filas: FilasDelCronograma): CalculoNuevo[] {
  const duraciones = new Map(filas.actividades.map((a) => [a.id, duracionesDe(filas, a)]));
  const actividades: ActividadDelMotor[] = filas.actividades.map((a) => ({
    id: a.id,
    tipo: a.tipo,
    enPresupuesto: a.item !== null,
    usaCorrido: a.usaCorrido,
    duracionMinutos: duraciones.get(a.id)!.usada,
    restriccion: a.restriccion,
    restriccionSecundaria: a.restriccionSecundaria,
  }));
  const dependencias = filas.dependencias.map((d) => ({
    predecesoraId: d.predecesoraId,
    sucesoraId: d.sucesoraId,
    tipo: d.tipo,
    desfaseMinutos: minutosDeDesfase(d.desfaseHoras),
  }));
  const resultado = conHorizonte(filas, fechasParaCalcular(filas), (calendarios) =>
    calcularCronograma({ fechaInicio: filas.cabecera.fechaInicio, calendarios, actividades, dependencias }),
  );
  return filas.actividades.map((a) => {
    const r = resultado.actividades.get(a.id)!;
    return {
      actividadId: a.id,
      inicio: r.inicio,
      fin: r.fin,
      inicioTardio: r.inicioTardio,
      finTardio: r.finTardio,
      duracionCalculadaMinutos: duraciones.get(a.id)!.calculada,
      duracionMinutos: r.duracionMinutos,
      holguraTotalMinutos: r.holguraTotalMinutos,
      holguraLibreMinutos: r.holguraLibreMinutos,
    };
  });
}
