/*
 * El tiempo del motor: minutos enteros desde 1970-01-01T00:00, sin zona
 * horaria. Las fechas-hora del cronograma son hora local de la obra (07
 * §6.2) y Colombia no cambia la hora, pero el servidor puede estar en otra
 * zona: por eso nada de esto pasa por un Date local. Date.UTC solo sirve para
 * contar días del calendario gregoriano.
 */

export const MINUTOS_POR_DIA = 1440;

/** "2026-11-02T07:00" → minutos. También acepta "2026-11-02" (las 00:00). */
export function aMinutos(fechaHora: string): number {
  const [fecha, hora = '00:00'] = fechaHora.split('T');
  return diaDeFecha(fecha!) * MINUTOS_POR_DIA + minutoDelDia(hora);
}

/** Minutos → "2026-11-02T07:00", como viaja en el contrato (§19.1). */
export function deMinutos(minutos: number): string {
  return new Date(minutos * 60_000).toISOString().slice(0, 16);
}

/** "2026-11-02" → número de día desde 1970-01-01. */
export function diaDeFecha(fecha: string): number {
  const [a, m, d] = fecha.split('-').map(Number);
  return Date.UTC(a!, m! - 1, d!) / 86_400_000;
}

export function fechaDeDia(dia: number): string {
  return new Date(dia * 86_400_000).toISOString().slice(0, 10);
}

/** Día de la semana ISO: 1 = lunes … 7 = domingo. */
export function diaDeLaSemana(dia: number): number {
  // El 1 de enero de 1970 fue jueves (4).
  return ((((dia + 3) % 7) + 7) % 7) + 1;
}

/** "07:30" → 450; "24:00" → 1440. */
export function minutoDelDia(hora: string): number {
  return Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5));
}
