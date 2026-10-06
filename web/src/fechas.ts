/*
 * Las fechas llegan como instantes en UTC con «Z» y se muestran en la zona del
 * navegador. Se PARSEAN, nunca se cortan: un presupuesto creado a las 20:00 en
 * Bogotá llega como «01:00Z» del día siguiente, y cortar los primeros diez
 * caracteres le pondría la fecha de mañana (DISENO §5, CONTRATO §3.2).
 */

const SOLO_FECHA = new Intl.DateTimeFormat('es-CO', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const FECHA_Y_HORA = new Intl.DateTimeFormat('es-CO', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** «30 sept 2026». Sin el punto de la abreviatura, que en una tabla es ruido. */
export function formatearFecha(instante: string): string {
  return limpiar(SOLO_FECHA.format(new Date(instante)));
}

/** «30 sept 2026, 7:03 p. m.», para un `title` o un dato de apoyo. */
export function formatearFechaYHora(instante: string): string {
  return limpiar(FECHA_Y_HORA.format(new Date(instante)));
}

/**
 * La ISO completa, para el atributo `datetime` de un <time>: lo leen las
 * máquinas, no las personas, y no cambia con la zona.
 */
export function paraAtributo(instante: string): string {
  return new Date(instante).toISOString();
}

function limpiar(texto: string): string {
  return texto.replace(/\b(\p{L}+)\./gu, '$1').replace(/\s+de\s+/g, ' ');
}
