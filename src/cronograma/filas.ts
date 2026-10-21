import type { Calendario } from '../infraestructura/basedatos/calendarios.js';
import type { Restriccion, TipoDeActividad } from './motor.js';

/*
 * Lo que la capa de datos lee de un cronograma, ya en tipos de TypeScript y
 * sin dinero convertido: las cifras siguen como texto (CONTRATO §1.1). Lo
 * consumen el recálculo y el armado de la vista, que son puros.
 *
 * Las fechas-hora van como "2026-11-02T07:00" (timestamp sin zona, al minuto)
 * y las fechas como "2026-11-02".
 */

export interface FilaActividad {
  id: string;
  tipo: TipoDeActividad;
  /** Nulo en hitos, trámites y administración; en una de ítem, «ya no está en el presupuesto» (RN-33). */
  presupuestoItemId: string | null;
  nombre: string;
  codigo: string;
  orden: number;
  grupoId: string | null;
  usaCorrido: boolean;
  cuadrillas: number;
  duracionManualHoras: string | null;
  restriccion: Restriccion | null;
  restriccionSecundaria: Restriccion | null;
  /** El ítem del presupuesto, si la actividad sigue amarrada a uno. */
  item: {
    cantidad: string;
    unidad: string;
    /** De la versión del APU del ítem: unidades por jornal (D-85). */
    rendimiento: string | null;
    costo: string;
    wbsNodoId: string;
  } | null;
}

export interface FilaDependencia {
  id: string;
  predecesoraId: string;
  sucesoraId: string;
  tipo: 'FC' | 'CC' | 'FF' | 'CF';
  desfaseHoras: string;
}

/** Lo que dejó el último cálculo en app.actividad_calculo. */
export interface FilaCalculo {
  inicio: string;
  fin: string;
  inicioTardio: string | null;
  finTardio: string | null;
  duracionCalculadaMinutos: number | null;
  duracionMinutos: number;
  holguraTotalMinutos: number | null;
  holguraLibreMinutos: number | null;
  critica: boolean;
}

export interface FilaCapitulo {
  id: string;
  padreId: string | null;
  codigo: string;
  nombre: string;
  nivel: number;
  posicion: number;
}

export interface FilaGrupo {
  id: string;
  nombre: string;
  orden: number;
}

export interface FilaLineaBase {
  id: string;
  nombre: string;
  guardadaEn: Date;
  guardadaPor: string | null;
  /** El fin más tardío de sus actividades. */
  fin: string;
}

export interface FilasDelCronograma {
  cabecera: {
    id: string;
    presupuestoId: string;
    tenantId: string;
    fechaInicio: string;
    version: number;
    calculadoVersion: number | null;
    calculadoRevision: number | null;
    aviso: unknown;
  };
  presupuesto: {
    estado: 'ABIERTO' | 'ACTIVO' | 'CERRADO';
    revision: number;
    horasPorJornal: string;
    totalAdministracion: string;
  };
  calendarios: { obra: Calendario; corrido: Calendario };
  capitulos: FilaCapitulo[];
  grupos: FilaGrupo[];
  actividades: FilaActividad[];
  dependencias: FilaDependencia[];
  calculos: Map<string, FilaCalculo>;
  lineasBase: FilaLineaBase[];
}

/** ¿Lo guardado corresponde a las entradas y al presupuesto de ahora? (D-91) */
export function estaAlDia(filas: Pick<FilasDelCronograma, 'cabecera' | 'presupuesto'>): boolean {
  return filas.cabecera.calculadoVersion === filas.cabecera.version && filas.cabecera.calculadoRevision === filas.presupuesto.revision;
}
