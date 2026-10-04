/*
 * Las formas que viaja la API, tal como las fija web/CONTRATO.md.
 *
 * Todo lo que es dinero o cantidad es `Dinero`, que es `string`. No es una
 * elección estética: las columnas son numeric(24,6) y en JavaScript no hay
 * aritmética decimal exacta (RNF-06, 04 §4.1). Como `string`, el compilador ya
 * rechaza `a * b` y `a + b` deja de ser una suma; lo que el compilador no puede
 * impedir es `Number(a)`, y de eso se encarga la regla de lint.
 */
export type Dinero = string;
export type Cantidad = string;
/** Porcentaje en puntos: «19.00» es el 19 %, nunca «0.19» (04 §4.1). */
export type Porcentaje = string;

export interface FormatoNumerico {
  separadorMiles: string;
  separadorDecimal: string;
  decimalesVista: number;
}

export type EstadoSuscripcion =
  | 'EN_PRUEBA' | 'ACTIVA' | 'VENCIDA' | 'CANCELADA' | 'SUSPENDIDA' | 'SIN_SUSCRIPCION';

export interface Suscripcion {
  estado: EstadoSuscripcion;
  /** Sale de la misma función de la base que rechaza las escrituras (D-65). No se recalcula. */
  soloLectura: boolean;
  diasRestantes: number;
  /** aaaa-mm-dd como texto: un date convertido a Date cae en la medianoche local. */
  venceEl: string;
  planCodigo: string;
}

export interface Arranque {
  usuarioNombre: string;
  razonSocial: string;
  permisos: string[];
  formatoNumerico: FormatoNumerico;
  /** Null es «sin acceso», nunca «al día». */
  suscripcion: Suscripcion | null;
}

export type EstadoPresupuesto = 'ABIERTO' | 'ACTIVO' | 'CERRADO';

export interface FilaDePresupuesto {
  id: string;
  codigo: string;
  nombre: string;
  ubicacion: string;
  moneda: string;
  fechaElaboracion: string;
  fechaModificacion: string;
  estado: EstadoPresupuesto;
  archivado: boolean;
  valorTotal: Dinero;
  modoEstructura: 'WBS' | 'ITEMS';
}
