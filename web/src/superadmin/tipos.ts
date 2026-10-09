import type { Instante } from '../api/tipos.ts';

/*
 * Las formas del CONTRATO §12. Las cifras de dinero viajan como texto
 * (regla 1.1), y las fechas sin hora como «aaaa-mm-dd».
 */

export type Fecha = string;
export type Dinero = string;
export type CodigoDePlan = 'PERSONAL' | 'EMPRESARIAL';
export type EstadoComercial = 'EN_PRUEBA' | 'ACTIVA' | 'VENCIDA' | 'CANCELADA' | 'SIN_SUSCRIPCION';
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
  empresas: { total: number; enPrueba: number; activas: number; vencidas: number; canceladas: number; suspendidas: number };
  nuevasEsteMes: number;
  ingresosDelMes: Dinero;
  moneda: string;
  proyectos: number;
  porPlan: Record<CodigoDePlan, number>;
  porVencer: FilaDeEmpresa[];
  pruebasSinConvertir: FilaDeEmpresa[];
}

export interface PagoDePlataforma {
  id: string;
  fecha: Fecha;
  concepto: string;
  monto: Dinero;
  moneda: string;
  metodo: MetodoDePago;
  referencia: string | null;
  periodoMeses: number | null;
  cubreHasta: Fecha;
  soporteId: string | null;
  registradoPor: string;
  registradoEn: Instante;
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
  } | null;
  usuarios: { id: string; nombre: string; email: string; rolNombre: string; rolTipo: string; estado: string; ultimoAcceso: Instante | null }[];
  cifras: { proyectos: number; recursos: number; apus: number };
  pagos: PagoDePlataforma[];
  eventos: EventoDePlataforma[];
  eliminableDesde: Fecha | null;
}
