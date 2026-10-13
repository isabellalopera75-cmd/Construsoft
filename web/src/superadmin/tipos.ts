import type { Instante } from '../api/tipos.ts';

/*
 * Las formas del CONTRATO §12. Las cifras de dinero viajan como texto
 * (regla 1.1), y las fechas sin hora como «aaaa-mm-dd».
 */

export type Fecha = string;
export type Dinero = string;
export type CodigoDePlan = 'PERSONAL' | 'EMPRESARIAL';
/**
 * D-74 · POR_PAGAR: venció y corre su plazo de dos días hábiles. SUSPENDIDA
 * aquí es por falta de pago; la del panel va aparte, en `suspendida`.
 */
export type EstadoComercial = 'EN_PRUEBA' | 'ACTIVA' | 'POR_PAGAR' | 'VENCIDA' | 'SUSPENDIDA' | 'CANCELADA' | 'SIN_SUSCRIPCION';
export type MetodoDePago = 'TRANSFERENCIA' | 'PSE' | 'EFECTIVO' | 'OTRO';

export interface Superadministrador {
  nombre: string;
  email: string;
}

export interface FilaDeEmpresa {
  id: string;
  razonSocial: string;
  nit: string;
  planCodigo: CodigoDePlan | null;
  estado: EstadoComercial;
  suspendida: boolean;
  venceEl: Fecha | null;
  diasRestantes: number | null;
  usuarios: number;
  proyectos: number;
  registradaEn: Instante;
  eliminableDesde: Fecha | null;
}

export interface Resumen {
  /** `suspendidas` cuenta las dos suspensiones: por el panel y por falta de pago (D-74). */
  empresas: { total: number; enPrueba: number; activas: number; porPagar: number; vencidas: number; canceladas: number; suspendidas: number };
  nuevasEsteMes: number;
  ingresosDelMes: Dinero;
  moneda: string;
  proyectos: number;
  porPlan: Record<CodigoDePlan, number>;
  porVencer: FilaDeEmpresa[];
  pruebasSinConvertir: FilaDeEmpresa[];
  /** Pagos que reportaron las empresas y esperan verificación (CONTRATO §14). */
  porVerificar: PagoDePlataforma[];
  /**
   * D-74 · Suspendidas por falta de pago o canceladas cuyos datos se eliminan
   * en los próximos 7 días (o ya debían): la purga diaria las borra sola.
   */
  porEliminar: FilaDeEmpresa[];
}

export type EstadoDePago = 'EXITOSO' | 'PENDIENTE' | 'RECHAZADO';

export interface PagoDePlataforma {
  id: string;
  fecha: Fecha;
  concepto: string;
  monto: Dinero;
  moneda: string;
  metodo: MetodoDePago;
  referencia: string | null;
  periodoMeses: number | null;
  /** Nulo mientras un pago reportado espera verificación (CONTRATO §14). */
  cubreHasta: Fecha | null;
  soporteId: string | null;
  estado: EstadoDePago;
  origen: 'MANUAL' | 'REPORTADO' | 'PASARELA';
  /** Quién de la empresa lo reportó, si lo reportó la empresa. */
  reportadoPor: string | null;
  /** Quién lo registró o lo verificó en el panel; nulo mientras espera. */
  registradoPor: string | null;
  registradoEn: Instante;
  rechazoMotivo: string | null;
  empresa: { id: string; razonSocial: string };
}

export interface EventoDePlataforma {
  id: string;
  tipo: string;
  descripcion: string;
  justificacion: string | null;
  ocurridoEn: Instante;
  autor: string | null;
  empresa: { id: string; razonSocial: string } | null;
}

export interface FichaDeEmpresa {
  empresa: {
    id: string;
    razonSocial: string;
    nit: string;
    direccion: string | null;
    telefono: string | null;
    emailRecuperacion: string | null;
    registradaEn: Instante;
    suspendida: boolean;
  };
  suscripcion: {
    id: string;
    planCodigo: CodigoDePlan;
    estado: EstadoComercial;
    fechaInicio: Fecha;
    venceEl: Fecha;
    diasRestantes: number;
    canceladaEn: Instante | null;
    canceladaMotivo: string | null;
    // D-74 · Los plazos que calcula la base.
    canceladaPor: 'EMPRESA' | 'PLATAFORMA' | null;
    pagarAMasTardar: Fecha | null;
    suspendidaDesde: Fecha | null;
    reactivableHasta: Fecha | null;
  } | null;
  usuarios: { id: string; nombre: string; email: string; rolNombre: string; rolTipo: string; estado: string; ultimoAcceso: Instante | null }[];
  cifras: { proyectos: number; recursos: number; apus: number };
  pagos: PagoDePlataforma[];
  eventos: EventoDePlataforma[];
  eliminableDesde: Fecha | null;
}
