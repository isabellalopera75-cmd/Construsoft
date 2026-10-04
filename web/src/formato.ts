/*
 * El formateo de cifras NO se implementa acá. Se reexporta el módulo que ya
 * usan el PDF y el Excel (src/comun/formatoNumerico.ts), que redondea
 * dígito por dígito con el criterio de round() de PostgreSQL y tiene una
 * prueba que lo compara contra la base en los casos borde.
 *
 * Dos formateadores distintos harían que el mismo número se viera distinto en
 * la pantalla y en la oferta que recibe el cliente, y la diferencia aparecería
 * recién en un 1,005.
 */
export { formatearNumero, redondear } from '@compartido/formatoNumerico';
