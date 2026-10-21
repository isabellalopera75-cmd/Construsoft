import { MINUTOS_POR_DIA, diaDeFecha, diaDeLaSemana, fechaDeDia, minutoDelDia } from './tiempo.js';

/*
 * El calendario como lo ve el motor (D-81). La tabla de tramos por día de la
 * semana y las excepciones por fecha se compilan, para un horizonte de días,
 * en una lista ordenada de intervalos laborables [inicio, fin) en minutos, con
 * el trabajo acumulado antes de cada uno. Con eso la función
 *
 *     W(t) = minutos laborables desde el comienzo del horizonte hasta t
 *
 * es creciente, y toda pregunta del motor es una búsqueda binaria sobre ella:
 *
 *   - sumar N minutos laborables es buscar dónde W vale W(t) + N. Hacia
 *     adelante se toma el primer instante con ese valor —el cierre del tramo,
 *     no el siguiente inicio— y hacia atrás el último —el inicio del tramo, no
 *     el cierre anterior—. Es la RN-27: un fin se queda al cierre del último
 *     tramo trabajado; un inicio pasa al siguiente instante laborable.
 *   - los minutos laborables entre dos instantes son W(b) − W(a).
 *
 * Dos tramos seguidos (20:00–24:00 y 00:00–04:00 del día siguiente) se unen
 * en un solo intervalo: para el motor es una sola jornada que cruza la
 * medianoche, como en P6 y Project.
 */

export interface TramoDeCalendario {
  inicio: string;
  fin: string;
}

export interface DefinicionDeCalendario {
  /** Siete listas; la 0 es el lunes. */
  semana: TramoDeCalendario[][];
  /** Una fecha con horario propio; sin tramos, no se trabaja. */
  excepciones: { fecha: string; tramos: TramoDeCalendario[] }[];
}

/** El calendario no puede responder: no tiene horas laborables, o la cuenta se sale del horizonte. */
export class ErrorDeCalendario extends Error {}

export interface CalendarioCompilado {
  siguienteInstanteLaborable(t: number): number;
  anteriorCierreLaborable(t: number): number;
  /** `n` puede ser negativo: hacia atrás. */
  sumarMinutosLaborables(t: number, n: number): number;
  minutosLaborablesEntre(a: number, b: number): number;
  /** Los minutos trabajados de cada día de calendario entre `a` y `b`, sin los días en cero. */
  minutosPorDia(a: number, b: number): { fecha: string; minutos: number }[];
  /** ¿`t` es el fin del último tramo de su día? (RN-27, la barra que termina a mitad de jornada). */
  esCierreDeJornada(t: number): boolean;
  /** El comienzo de la jornada de una fecha; si no se trabaja, el siguiente instante laborable (A7). */
  comienzoDeJornada(fecha: string): number;
  /** El cierre de la jornada de una fecha; si no se trabaja, el cierre laborable anterior (A7). */
  cierreDeJornada(fecha: string): number;
}

export function compilarCalendario(definicion: DefinicionDeCalendario, horizonte: { desde: string; hasta: string }): CalendarioCompilado {
  const primerDia = diaDeFecha(horizonte.desde);
  const ultimoDia = diaDeFecha(horizonte.hasta);
  const excepciones = new Map(definicion.excepciones.map((e) => [diaDeFecha(e.fecha), e.tramos]));

  const inicios: number[] = [];
  const fines: number[] = [];
  /** El fin del último tramo de cada día, o null si ese día no se trabaja. */
  const cierreDelDia: (number | null)[] = [];
  for (let dia = primerDia; dia <= ultimoDia; dia += 1) {
    const tramos = [...(excepciones.get(dia) ?? definicion.semana[diaDeLaSemana(dia) - 1] ?? [])]
      .map((t) => [dia * MINUTOS_POR_DIA + minutoDelDia(t.inicio), dia * MINUTOS_POR_DIA + minutoDelDia(t.fin)] as const)
      .filter(([i, f]) => f > i)
      .sort((x, y) => x[0] - y[0]);
    cierreDelDia.push(tramos.length > 0 ? tramos[tramos.length - 1]![1] : null);
    for (const [i, f] of tramos) {
      if (fines.length > 0 && fines[fines.length - 1] === i) fines[fines.length - 1] = f;
      else {
        inicios.push(i);
        fines.push(f);
      }
    }
  }
  if (inicios.length === 0) {
    throw new ErrorDeCalendario('El calendario no tiene ninguna hora laborable: marque al menos un tramo en la semana o en una excepción.');
  }

  // acumulado[k]: minutos laborables antes del intervalo k; acumulado[n], el total.
  const acumulado: number[] = [0];
  for (let k = 0; k < inicios.length; k += 1) acumulado.push(acumulado[k]! + fines[k]! - inicios[k]!);
  const total = acumulado[inicios.length]!;
  const desdeMinuto = primerDia * MINUTOS_POR_DIA;
  const hastaMinuto = (ultimoDia + 1) * MINUTOS_POR_DIA;

  const fueraDelHorizonte = () =>
    new ErrorDeCalendario(
      `El cálculo se sale de las fechas que el calendario cubre (${horizonte.desde} a ${horizonte.hasta}). Revise la fecha de inicio, los desfases y las restricciones.`,
    );
  const exigirDentro = (t: number) => {
    if (t < desdeMinuto || t > hastaMinuto) throw fueraDelHorizonte();
  };

  /** El último k < `largo` con lista[k] ≤ valor (o < valor si `estricto`); −1 si ninguno. */
  function ultimoHasta(lista: number[], valor: number, estricto = false, largo = lista.length): number {
    let bajo = 0;
    let alto = largo - 1;
    let respuesta = -1;
    while (bajo <= alto) {
      const medio = (bajo + alto) >> 1;
      const v = lista[medio]!;
      if (estricto ? v < valor : v <= valor) {
        respuesta = medio;
        bajo = medio + 1;
      } else alto = medio - 1;
    }
    return respuesta;
  }

  function trabajoHasta(t: number): number {
    const k = ultimoHasta(inicios, t);
    if (k < 0) return 0;
    return acumulado[k]! + Math.min(t, fines[k]!) - inicios[k]!;
  }

  function siguienteInstanteLaborable(t: number): number {
    exigirDentro(t);
    const k = ultimoHasta(inicios, t);
    if (k >= 0 && t < fines[k]!) return t;
    if (k + 1 >= inicios.length) throw fueraDelHorizonte();
    return inicios[k + 1]!;
  }

  function anteriorCierreLaborable(t: number): number {
    exigirDentro(t);
    const k = ultimoHasta(inicios, t, true);
    if (k < 0) throw fueraDelHorizonte();
    return Math.min(t, fines[k]!);
  }

  function sumarMinutosLaborables(t: number, n: number): number {
    exigirDentro(t);
    if (n === 0) return t;
    const meta = trabajoHasta(t) + n;
    if (meta < 0 || meta > total) throw fueraDelHorizonte();
    if (n > 0) {
      // El primer intervalo cuyo acumulado al cerrar alcanza la meta.
      let bajo = 0;
      let alto = inicios.length - 1;
      while (bajo < alto) {
        const medio = (bajo + alto) >> 1;
        if (acumulado[medio + 1]! >= meta) alto = medio;
        else bajo = medio + 1;
      }
      return inicios[bajo]! + meta - acumulado[bajo]!;
    }
    // El último intervalo cuyo acumulado al abrir no pasa la meta.
    const k = ultimoHasta(acumulado, meta, false, inicios.length);
    return inicios[k]! + meta - acumulado[k]!;
  }

  function minutosPorDia(a: number, b: number): { fecha: string; minutos: number }[] {
    exigirDentro(a);
    exigirDentro(b);
    const porDia = new Map<number, number>();
    for (let k = Math.max(0, ultimoHasta(inicios, a)); k < inicios.length && inicios[k]! < b; k += 1) {
      let desde = Math.max(a, inicios[k]!);
      const hasta = Math.min(b, fines[k]!);
      while (desde < hasta) {
        const dia = Math.floor(desde / MINUTOS_POR_DIA);
        const corte = Math.min(hasta, (dia + 1) * MINUTOS_POR_DIA);
        porDia.set(dia, (porDia.get(dia) ?? 0) + corte - desde);
        desde = corte;
      }
    }
    return [...porDia.entries()].sort((x, y) => x[0] - y[0]).map(([dia, minutos]) => ({ fecha: fechaDeDia(dia), minutos }));
  }

  function cierreDe(dia: number): number | null {
    if (dia < primerDia || dia > ultimoDia) throw fueraDelHorizonte();
    return cierreDelDia[dia - primerDia]!;
  }

  return {
    siguienteInstanteLaborable,
    anteriorCierreLaborable,
    sumarMinutosLaborables,
    minutosLaborablesEntre: (a, b) => {
      exigirDentro(a);
      exigirDentro(b);
      return trabajoHasta(b) - trabajoHasta(a);
    },
    minutosPorDia,
    // Un tramo que termina a las 24:00 es del día anterior: por eso t − 1.
    esCierreDeJornada: (t) => cierreDe(Math.floor((t - 1) / MINUTOS_POR_DIA)) === t,
    comienzoDeJornada: (fecha) => siguienteInstanteLaborable(diaDeFecha(fecha) * MINUTOS_POR_DIA),
    cierreDeJornada: (fecha) => cierreDe(diaDeFecha(fecha)) ?? anteriorCierreLaborable(diaDeFecha(fecha) * MINUTOS_POR_DIA),
  };
}
