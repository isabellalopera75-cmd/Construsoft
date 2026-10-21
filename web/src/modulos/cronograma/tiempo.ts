import type { FormatoNumerico } from '../../api/tipos.ts';
import type { Dias, Fecha, FechaHora } from '../../api/tiposCronograma.ts';

/*
 * El tiempo del cronograma (CONTRATO §19.1). Una fecha-hora llega como texto
 * LOCAL y sin zona, «2026-11-02T07:00»: es la hora de la obra, la que guardó
 * la base. No es UTC, así que NO se convierte a Date —el navegador la leería
 * como hora de Bogotá o como UTC según el formato, y en las dos se puede correr
 * un día—. Se corta.
 *
 * Para dibujar el Gantt hace falta una posición, y la posición es un entero:
 * minutos desde el 1 de enero de 1970, contados con el calendario civil
 * (el algoritmo de días civiles de Howard Hinnant). Son enteros del dibujo,
 * no dinero, y se arman dígito por dígito sin pasar por Number.
 */

/** Un entero de dígitos ASCII. Para fechas, horas y cuadrillas; nunca para dinero. */
export function entero(texto: string): number {
  let n = 0;
  for (const c of texto) n = n * 10 + (c.charCodeAt(0) - 48);
  return n;
}

function diasCiviles(anio: number, mes: number, dia: number): number {
  const y = mes <= 2 ? anio - 1 : anio;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (mes + (mes > 2 ? -3 : 9)) + 2) / 5) + dia - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civil(dias: number): [number, number, number] {
  const z = dias + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, d];
}

const dos = (n: number) => (n < 10 ? `0${n}` : `${n}`);

/** «2026-11-02» → días desde 1970. */
export function diaDe(fecha: Fecha): number {
  return diasCiviles(entero(fecha.slice(0, 4)), entero(fecha.slice(5, 7)), entero(fecha.slice(8, 10)));
}

/** Días desde 1970 → «2026-11-02». */
export function fechaDe(dia: number): Fecha {
  const [a, m, d] = civil(dia);
  return `${a}-${dos(m)}-${dos(d)}`;
}

/** «07:30» → 450. «24:00» → 1440. */
export function minutosDelDia(hora: string): number {
  return entero(hora.slice(0, 2)) * 60 + entero(hora.slice(3, 5));
}

/** «2026-11-02T07:00» → minutos desde 1970. */
export function minutos(fechaHora: FechaHora): number {
  return diaDe(fechaHora) * 1440 + minutosDelDia(fechaHora.slice(11, 16));
}

/** 0 = lunes … 6 = domingo, como la `semana` de un calendario. */
export function diaDeLaSemana(dia: number): number {
  return (((dia % 7) + 7) % 7 + 3) % 7;
}

const DIAS_CORTOS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
export const DIAS_DE_LA_SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** «02 nov 2026». Para la tabla: una columna de fechas se lee alineada. */
export function fechaCorta(texto: Fecha | FechaHora): string {
  const [a, m, d] = civil(diaDe(texto));
  return `${dos(d)} ${MESES_CORTOS[m - 1] ?? ''} ${a}`;
}

/** «lun 2 nov 2026». */
export function fechaConDia(texto: Fecha | FechaHora): string {
  const dia = diaDe(texto);
  const [a, m, d] = civil(dia);
  return `${DIAS_CORTOS[diaDeLaSemana(dia)] ?? ''} ${d} ${MESES_CORTOS[m - 1] ?? ''} ${a}`;
}

/** «lun 2 nov 2026, 7:00». La hora de la obra, tal como llegó. */
export function fechaYHora(fechaHora: FechaHora): string {
  const hora = fechaHora.slice(11, 16);
  return `${fechaConDia(fechaHora)}, ${hora.startsWith('0') ? hora.slice(1) : hora}`;
}

/** «noviembre de 2026», para la escala del Gantt por mes. */
export function nombreDelMes(dia: number): string {
  const [a, m] = civil(dia);
  return `${MESES[m - 1] ?? ''} ${a}`;
}

export function mesCorto(dia: number): string {
  const [a, m] = civil(dia);
  return `${MESES_CORTOS[m - 1] ?? ''} ${a}`;
}

export function diaDelMes(dia: number): number {
  return civil(dia)[2];
}

/** El primer día del mes del día dado. */
export function primeroDelMes(dia: number): number {
  const [a, m] = civil(dia);
  return diasCiviles(a, m, 1);
}

/** El primer día del mes siguiente. */
export function mesSiguiente(dia: number): number {
  const [a, m] = civil(dia);
  return m === 12 ? diasCiviles(a + 1, 1, 1) : diasCiviles(a, m + 1, 1);
}

/** Hoy, en la fecha del navegador: para sugerir la fecha de inicio. */
export function hoy(): Fecha {
  const d = new Date();
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

/**
 * Días con un decimal, como los manda el servidor («5.1», «-2.0»), con el
 * separador decimal de la empresa. Es texto: no se redondea ni se suma.
 */
export function dias(texto: Dias | null, formato: FormatoNumerico): string {
  if (texto === null) return '—';
  return texto.replace('.', formato.separadorDecimal);
}

/** «5.1» → «5,1» para un campo, o «» si es nulo. */
export function diasParaEditar(texto: Dias | null, formato: FormatoNumerico): string {
  return texto === null ? '' : texto.replace('.', formato.separadorDecimal);
}

/** ¿El texto de días es negativo? Mirando el signo, sin convertir. */
export function esNegativo(texto: Dias | null): boolean {
  return texto !== null && texto.startsWith('-') && /[1-9]/.test(texto);
}

/**
 * Lo que se escribe en días (duración manual y desfase, CONTRATO §19.1): una
 * cifra con hasta un decimal, coma o punto. Solo el desfase puede ser
 * negativo. Devuelve el texto canónico que viaja («-1.5»).
 */
export function leerDias(texto: string, opciones: { negativo?: boolean; nombre: string }): { valor: string } | { error: string } {
  const limpio = texto.trim().replace(/\s/g, '').replace(',', '.');
  if (limpio === '') return { error: `Escriba ${opciones.nombre}, en días.` };
  const patron = opciones.negativo ? /^-?\d+(\.\d)?$/ : /^\d+(\.\d)?$/;
  if (!patron.test(limpio)) {
    if (/^-?\d+\.\d{2,}$/.test(limpio)) return { error: `${mayuscula(opciones.nombre)} va en días con un decimal como máximo: por ejemplo 2,5.` };
    if (!opciones.negativo && limpio.startsWith('-')) return { error: `${mayuscula(opciones.nombre)} no puede ser negativa.` };
    return { error: `${mayuscula(opciones.nombre)} solo admite una cifra en días, como 3 o 2,5.` };
  }
  const sinCeros = limpio.replace(/^(-?)0+(?=\d)/, '$1');
  return { valor: sinCeros === '-0' || sinCeros === '-0.0' ? sinCeros.slice(1) : sinCeros };
}

function mayuscula(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** «02/11/26», como en el PDF del Gantt: la columna de la tabla es angosta. */
export function fechaTabla(texto: Fecha | FechaHora): string {
  const [a, m, d] = civil(diaDe(texto));
  return `${dos(d)}/${dos(m)}/${dos(a % 100)}`;
}
