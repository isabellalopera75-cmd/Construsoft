/**
 * Un error que la capa de datos levanta por su cuenta —sin pasar por la base—
 * y cuyo mensaje está escrito para la persona que usa el sistema: dice qué
 * pasó y qué hacer (CLAUDE.md). Se distingue de un Error común, que es un
 * fallo de programación y nunca se le muestra a nadie.
 *
 *  · NO_EXISTE: lo pedido no existe en esta empresa. Bajo aislamiento es lo
 *    mismo que no existir en absoluto.
 *  · RECHAZADO: existe, pero la operación no se puede hacer así (un enlace
 *    vencido, un registro sin aceptar los términos).
 *  · CONFLICTO: choca con lo que ya hay (un presupuesto que ya tiene su
 *    cronograma). Es el 409.
 *
 * Los rechazos que levanta la BASE no pasan por aquí: llegan con su SQLSTATE,
 * y los traduce src/http/errores.ts.
 */
export class ErrorParaElUsuario extends Error {
  readonly motivo: 'NO_EXISTE' | 'RECHAZADO' | 'CONFLICTO';
  /** El dato del pedido que hay que corregir, cuando es uno solo (contrato §2). */
  readonly campo: string | undefined;

  constructor(mensaje: string, motivo: 'NO_EXISTE' | 'RECHAZADO' | 'CONFLICTO', campo?: string) {
    super(mensaje);
    this.name = 'ErrorParaElUsuario';
    this.motivo = motivo;
    this.campo = campo;
  }
}
