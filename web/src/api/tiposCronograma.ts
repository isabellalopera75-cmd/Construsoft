import type { Dinero, Instante } from './tipos.ts';

/*
 * Las formas del módulo de programación de obra, tal como las fija
 * web/CONTRATO.md §19. Viven aparte de tipos.ts porque son un módulo entero y
 * crecen juntas.
 *
 * Dos reglas del §19.1 que estas formas cargan:
 *   - Una `FechaHora` es texto LOCAL sin zona, al minuto: «2026-11-02T07:00».
 *     No es UTC y no se convierte a Date: se corta (ver cronograma/tiempo.ts).
 *   - Las duraciones, holguras y desfases llegan en días, como texto con un
 *     decimal («5.1»), ya convertidos por el servidor con el factor del
 *     calendario que corresponde. La pantalla no los convierte.
 */

/** «2026-11-02T07:00», hora local del proyecto, sin zona. */
export type FechaHora = string;
/** «2026-11-02». */
export type Fecha = string;
/** Días con un decimal, como texto: «5.1». */
export type Dias = string;

// --- §19.3 · Calendarios --------------------------------------------------------

export interface Tramo {
  inicio: string; // «07:00»
  fin: string;    // «12:00»; la medianoche del final del día es «24:00»
}

export interface Excepcion {
  fecha: Fecha;
  motivo: string | null;
  /** Sin tramos, el día no se trabaja. */
  tramos: Tramo[];
  horas: string;
}

export type TipoDeCalendario = 'EMPRESA' | 'OBRA' | 'CORRIDO';

export interface OrigenDeFestivos {
  tipo: 'PLATAFORMA' | 'PROPIA';
  id: string;
  nombre: string;
}

export interface Calendario {
  id: string;
  nombre: string;
  tipo: TipoDeCalendario;
  /** «1 día = X h», «8.00». */
  horasPorDia: string;
  porDefecto: boolean;
  /** Siete listas; la 0 es el lunes. */
  semana: Tramo[][];
  horasDia: string[];
  horasSemana: string;
  excepciones: Excepcion[];
  festivos: { origen: OrigenDeFestivos | null; hasta: number | null };
}

export interface CalendarioResumen {
  id: string;
  nombre: string;
  horasPorDia: string;
  horasSemana: string;
  porDefecto: boolean;
}

/** Lo que se manda al crear o editar un calendario. */
export interface DatosDeCalendario {
  nombre: string;
  horasPorDia: string;
  semana: Tramo[][];
}

// --- §19.4 · Festivos -------------------------------------------------------------

export interface ListaDeLaPlataforma {
  id: string;
  pais: string;
  nombre: string;
  anioDesde: number;
  anioHasta: number;
}

export interface ListaPropiaResumen {
  id: string;
  nombre: string;
  fechas: number;
  desde: number | null;
  hasta: number | null;
}

export interface ListaPropia {
  id: string;
  nombre: string;
  fechas: { fecha: Fecha; nombre: string | null }[];
}

export interface ListasDeFestivos {
  plataforma: ListaDeLaPlataforma[];
  propias: ListaPropiaResumen[];
}

// --- §19.5 · La vista del cronograma ------------------------------------------------

export type TipoDeActividad = 'ITEM' | 'HITO_INICIO' | 'HITO_FIN' | 'SIN_COSTO' | 'ADMINISTRACION';

export type TipoDeRestriccion =
  | 'INICIO_EL' | 'INICIO_ANTES' | 'INICIO_DESPUES'
  | 'FIN_EL' | 'FIN_ANTES' | 'FIN_DESPUES'
  | 'LO_MAS_TARDE' | 'INICIO_OBLIGATORIO' | 'FIN_OBLIGATORIO';

export interface Restriccion {
  tipo: TipoDeRestriccion;
  /** Nula solo en «lo más tarde posible». */
  fecha: Fecha | null;
}

export type TipoDeRelacion = 'FC' | 'CC' | 'FF' | 'CF';

export interface Capitulo {
  id: string;
  padreId: string | null;
  codigo: string;
  nombre: string;
  nivel: number;
  posicion: number;
  inicio: FechaHora | null;
  fin: FechaHora | null;
  duracionDias: Dias | null;
  critico: boolean;
}

export interface Grupo {
  id: string;
  nombre: string;
  orden: number;
}

export interface Actividad {
  id: string;
  tipo: TipoDeActividad;
  codigo: string;
  nombre: string;
  capituloId: string | null;
  grupoId: string | null;
  orden: number;
  presupuestoItemId: string | null;
  /** Falso: «ya no está en el presupuesto» (RN-33). */
  enPresupuesto: boolean;
  cantidad: string | null;
  unidad: string | null;
  rendimiento: string | null;
  costo: Dinero;
  cuadrillas: number;
  usaCorrido: boolean;
  duracionCalculadaDias: Dias | null;
  duracionManualDias: Dias | null;
  duracionDias: Dias;
  restriccion: Restriccion | null;
  restriccionSecundaria: Restriccion | null;
  inicio: FechaHora;
  fin: FechaHora;
  inicioTardio: FechaHora | null;
  finTardio: FechaHora | null;
  holguraTotalDias: Dias | null;
  holguraLibreDias: Dias | null;
  critica: boolean;
  finAMitadDeJornada: boolean;
}

export interface Dependencia {
  id: string;
  predecesoraId: string;
  sucesoraId: string;
  tipo: TipoDeRelacion;
  desfaseDias: Dias;
}

export interface Revision {
  sinProgramar: string[];
  yaNoEstan: string[];
  manualDistinta: string[];
  sinRendimiento: string[];
  sinPredecesora: string[];
  sinSucesora: string[];
  holguraNegativa: string[];
}

export interface ActividadNombrada {
  id: string;
  codigo: string;
  nombre: string;
}

export interface AvisoDelPresupuesto {
  ultimoCambio: Instante;
  entraron: ActividadNombrada[];
  salieron: ActividadNombrada[];
  duracionesCambiadas: (ActividadNombrada & { antesDias: Dias; ahoraDias: Dias })[];
  finAntes: FechaHora;
  finAhora: FechaHora;
  valorTotalAntes: Dinero;
  valorTotalAhora: Dinero;
}

export interface Avisos {
  presupuesto: AvisoDelPresupuesto | null;
  festivos: { hasta: number; finDelProyecto: Fecha } | null;
  administracion: { lineaBaseId: string; finLineaBase: FechaHora; finActual: FechaHora; diasDeMas: Dias } | null;
}

export interface LineaBaseResumen {
  id: string;
  nombre: string;
  guardadaEn: Instante;
  guardadaPor: string | null;
  fin: FechaHora;
}

export interface ActividadDeLineaBase {
  actividadId: string;
  inicio: FechaHora;
  fin: FechaHora;
  duracionDias: Dias;
  variacionInicioDias: Dias | null;
  variacionFinDias: Dias | null;
}

export interface LineaBaseEnVista {
  id: string;
  nombre: string;
  guardadaEn: Instante;
  actividades: ActividadDeLineaBase[];
}

export interface CabeceraDeCronograma {
  id: string;
  presupuestoId: string;
  version: number;
  fechaInicio: Fecha;
  editable: boolean;
  recalculado: boolean;
  inicio: FechaHora;
  fin: FechaHora;
  duracionDias: Dias;
  /**
   * 1 = lunes … 7 = domingo, el de la empresa (RF-CFG-33): el Gantt arma sus
   * semanas con él. Agregado al contrato el 21 de octubre de 2026; mientras la
   * API no lo mande, la pantalla toma el lunes.
   */
  inicioSemana?: number;
}

export interface VistaCronograma {
  cronograma: CabeceraDeCronograma;
  calendarios: { obra: Calendario; corrido: Calendario };
  capitulos: Capitulo[];
  grupos: Grupo[];
  actividades: Actividad[];
  dependencias: Dependencia[];
  revision: Revision;
  avisos: Avisos;
  lineasBase: LineaBaseResumen[];
  lineaBase: LineaBaseEnVista | null;
}

/** El GET de un presupuesto sin cronograma todavía. */
export interface SinCronograma {
  cronograma: null;
}

// --- §19.7 · Curvas ---------------------------------------------------------------

export type Granularidad = 'SEMANA' | 'MES';

export interface Periodo {
  periodo: Fecha;
  facturacion: Dinero;
  costo: Dinero;
  facturacionAcumulada: Dinero;
  costoAcumulado: Dinero;
}

export interface Curvas {
  granularidad: Granularidad;
  periodos: Periodo[];
  totales: { facturacion: Dinero; costo: Dinero };
  lineaBase: { id: string; nombre: string; periodos: Periodo[] } | null;
}
