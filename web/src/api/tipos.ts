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
/** Un instante en UTC con «Z». Se parsea, nunca se corta (DISENO §5). */
export type Instante = string;

export interface FormatoNumerico {
  separadorMiles: string;
  separadorDecimal: string;
  decimalesVista: number;
}

/**
 * D-74 · POR_PAGAR: venció y está en sus dos días hábiles para pagar, con
 * acceso completo. VENCIDA es solo la prueba vencida. SUSPENDIDA es por falta
 * de pago o por la plataforma: lo dice `suspension`.
 */
export type EstadoSuscripcion =
  | 'EN_PRUEBA' | 'ACTIVA' | 'POR_PAGAR' | 'VENCIDA' | 'CANCELADA' | 'SUSPENDIDA' | 'SIN_SUSCRIPCION';

/**
 * Qué deja hacer la suscripción (D-74, CONTRATO §15). Lo decide la base y no
 * se recalcula aquí: COMPLETO trabaja normal; SOLO_LECTURA consulta y exporta;
 * SOLO_PAGO solo entra a la suscripción; NINGUNO espera la eliminación.
 */
export type Acceso = 'COMPLETO' | 'SOLO_LECTURA' | 'SOLO_PAGO' | 'NINGUNO';

/** Los plazos del ciclo de vida (D-74). Todas las fechas son aaaa-mm-dd o nulas. */
export interface CicloDeSuscripcion {
  estado: EstadoSuscripcion;
  acceso: Acceso;
  suspension: 'FALTA_DE_PAGO' | 'PLATAFORMA' | null;
  /** Último día para pagar sin que la cuenta se suspenda. Solo en una suscripción pagada. */
  pagarAMasTardar: string | null;
  suspendidaDesde: string | null;
  /** Una cancelada: hasta cuándo el Administrador puede reactivarla pagando. */
  reactivableHasta: string | null;
  /** Desde cuándo se eliminan los datos si nada cambia; nulo si no corre ese plazo. */
  seEliminaEl: string | null;
  /** PRUEBA: la prueba gratuita pasó sus 10 días de solo lectura sin pago (D-76). */
  canceladaPor: 'EMPRESA' | 'PLATAFORMA' | 'PRUEBA' | null;
  pagoEnVerificacion: boolean;
}

export interface Suscripcion extends CicloDeSuscripcion {
  /** Sale de la misma función de la base que rechaza las escrituras (D-65). No se recalcula. */
  soloLectura: boolean;
  diasRestantes: number;
  /** aaaa-mm-dd como texto: un date convertido a Date cae en la medianoche local. */
  venceEl: string;
  planCodigo: string;
}

/** CONTRATO §3.1. */
export interface Arranque {
  usuarioNombre: string;
  razonSocial: string;
  permisos: string[];
  formatoNumerico: FormatoNumerico;
  /** La moneda de la empresa (D-6: una sola), sin pedir CONFIG.PREFERENCIAS. */
  monedaBase: string;
  /** Null es «sin acceso», nunca «al día». */
  suscripcion: Suscripcion | null;
}

/** Los códigos de app.permiso, tal como los siembra el esquema. */
export type Permiso =
  | 'RECURSOS.VER' | 'RECURSOS.CREAR' | 'RECURSOS.EDITAR' | 'RECURSOS.ELIMINAR'
  | 'APU.VER' | 'APU.CREAR' | 'APU.EDITAR' | 'APU.ELIMINAR'
  | 'PRESUPUESTOS.VER' | 'PRESUPUESTOS.CREAR' | 'PRESUPUESTOS.EDITAR'
  | 'PRESUPUESTOS.EXPORTAR' | 'PRESUPUESTOS.DUPLICAR' | 'PRESUPUESTOS.ESTADO'
  | 'CONFIG.EMPRESA' | 'CONFIG.PREFERENCIAS' | 'CONFIG.SUSCRIPCION'
  | 'USUARIOS.GESTIONAR';

export type EstadoPresupuesto = 'ABIERTO' | 'ACTIVO' | 'CERRADO';
export type ModoEstructura = 'WBS' | 'ITEMS';

/**
 * Un elemento de GET /api/presupuestos (CONTRATO §3.2), que llega como arreglo
 * suelto. Trae el presupuesto entero; acá se declara solo lo que la vista
 * maestra usa.
 */
export interface FilaDePresupuesto {
  id: string;
  codigo: string;
  nombre: string;
  ubicacion: string;
  moneda: string;
  estado: EstadoPresupuesto;
  modoEstructura: ModoEstructura;
  fechaElaboracion: Instante;
  fechaModificacion: Instante;
  /** Archivado es «tiene fecha de archivado». */
  archivadoEn: Instante | null;
  valorTotal: Dinero;
}

/** El cuerpo de POST /api/presupuestos (02 §7.1). La moneda no viaja: la pone la base. */
export interface NuevoPresupuesto {
  codigo: string;
  nombre: string;
  ubicacion: string;
  modoEstructura: ModoEstructura;
}

// --- La mesa de trabajo (CONTRATO §4) -----------------------------------------

export type Clasificacion = 'DIRECTO' | 'INDIRECTO';

export interface CabeceraDeMesa {
  id: string;
  codigo: string;
  nombre: string;
  ubicacion: string;
  moneda: string;
  estado: EstadoPresupuesto;
  modoEstructura: ModoEstructura;
  fechaElaboracion: Instante;
  fechaModificacion: Instante;
  /** Abierto, suscripción vigente y PRESUPUESTOS.EDITAR. Lo resuelve el servidor. */
  editable: boolean;
}

export interface NodoDeMesa {
  id: string;
  padreId: string | null;
  codigoWbs: string;
  nivel: number;
  /** Lugar entre sus hermanos —nodos y actividades juntos—, de 1 a n. */
  posicion: number;
  nombre: string;
  /** Resuelta en todos los nodos: la fija el que tiene padreId nulo. */
  clasificacion: Clasificacion;
  montoAcumulado: Dinero;
  /** Null cuando no hay costo directo: se muestra un guion, nunca un cero. */
  incidenciaPct: Porcentaje | null;
}

export interface ActividadDeMesa {
  id: string;
  nodoId: string;
  codigoItem: string;
  posicion: number;
  codigoApu: string;
  descripcion: string;
  unidadSimbolo: string;
  cantidad: Cantidad;
  precioUnitario: Dinero;
  costoTotal: Dinero;
  apuId: string;
  apuVersionId: string;
}

export interface Porcentajes {
  a: Porcentaje;
  i: Porcentaje;
  u: Porcentaje;
  iva: Porcentaje;
}

export interface Pie {
  costoIndirecto: Dinero;
  costoDirecto: Dinero;
  administracion: Dinero;
  imprevistos: Dinero;
  utilidad: Dinero;
  aiu: Dinero;
  iva: Dinero;
  valorTotal: Dinero;
  porcentajes: Porcentajes;
  aiuEnCero: boolean;
  sinBaseAiu: boolean;
}

export interface Mesa {
  cabecera: CabeceraDeMesa;
  nodos: NodoDeMesa[];
  actividades: ActividadDeMesa[];
  pie: Pie;
}

export interface ApuEncontrado {
  id: string;
  codigo: string;
  nombre: string;
  unidadSimbolo: string;
  costoDirecto: Dinero;
  activo: boolean;
}

// --- Versiones, historial y duplicación (CONTRATO §8 y 6.4) --------------------

export type DisparadorVersion = 'ABIERTO_A_ACTIVO' | 'ACTIVO_A_CERRADO' | 'ACTIVO_A_ABIERTO' | 'MANUAL';

export interface Version {
  id: string;
  numero: number;
  tipo: 'AUTOMATICA' | 'MANUAL';
  disparador: DisparadorVersion;
  estado: EstadoPresupuesto;
  motivo: string | null;
  valorTotal: Dinero;
  creadaEn: Instante;
  autor: string | null;
}

export interface CapituloFotografia {
  id: string;
  codigoWbs: string;
  padreCodigo: string | null;
  nivel: number;
  nombre: string;
  clasificacion: Clasificacion;
  montoAcumulado: Dinero;
  incidenciaPct: Porcentaje | null;
}

export interface ItemFotografia {
  id: string;
  wbsNodoId: string;
  codigoItem: string;
  codigoWbsPadre: string;
  codigoApu: string;
  descripcion: string;
  unidad: string;
  cantidad: Cantidad;
  precioUnitario: Dinero;
  costoTotal: Dinero;
}

export interface VersionConFotografia extends Version {
  fotografia: {
    presupuesto: {
      codigo: string;
      nombre: string;
      ubicacion: string;
      moneda: string;
      estado: EstadoPresupuesto;
      aiu: { a: Porcentaje; i: Porcentaje; u: Porcentaje };
      ivaUtilidadPct: Porcentaje;
      totales: {
        costoDirecto: Dinero;
        costoIndirecto: Dinero;
        administracion: Dinero;
        imprevistos: Dinero;
        utilidad: Dinero;
        aiu: Dinero;
        iva: Dinero;
        valorTotal: Dinero;
      };
    };
    capitulos: CapituloFotografia[];
    items: ItemFotografia[];
  };
}

export type TipoEvento =
  | 'CAMBIO_ESTADO' | 'REAPERTURA' | 'ITEM_AGREGADO' | 'ITEM_ELIMINADO' | 'CANTIDAD_MODIFICADA'
  | 'PRECIO_MODIFICADO' | 'CAPITULO_AGREGADO' | 'CAPITULO_ELIMINADO' | 'AIU_MODIFICADO'
  | 'PRESUPUESTO_ARCHIVADO' | 'PRESUPUESTO_DESARCHIVADO' | 'PRESUPUESTO_ELIMINADO'
  | 'PRESUPUESTO_DUPLICADO' | 'RECURSO_MODIFICADO' | 'APU_VERSIONADO' | 'ADMIN_RESTABLECIDO';

export interface Evento {
  id: string;
  tipoEvento: TipoEvento;
  descripcion: string;
  valorAnterior: string | null;
  valorNuevo: string | null;
  justificacion: string | null;
  usuarioId: string | null;
  usuarioNombre: string | null;
  ocurridoEn: Instante;
}

export interface Duplicacion {
  apusDesactualizados: {
    itemId: string;
    apuId: string;
    codigo: string;
    descripcion: string;
    cantidad: Cantidad;
    precioEnElPresupuesto: Dinero;
    precioVigente: Dinero;
  }[];
  valorTotalActual: Dinero;
  valorTotalConApuVigentes: Dinero;
}

/** GET /api/presupuestos/:id: el presupuesto entero; acá, lo que la mesa usa. */
export interface Presupuesto {
  id: string;
  archivadoEn: Instante | null;
}

// --- Recursos y APU (CONTRATO §5 y §6) ------------------------------------------

export interface Unidad {
  id: string;
  simbolo: string;
  descripcion: string;
}

export type TipoRecurso = 'MATERIAL' | 'EQUIPO' | 'PERSONAL' | 'ACTIVIDAD_TODO_COSTO';
export type ViaCaptura = 'BASE' | 'TOTAL';

export interface Recurso {
  id: string;
  codigo: string;
  nombre: string;
  tipo: TipoRecurso;
  unidadId: string;
  unidadSimbolo: string;
  precioBase: Dinero;
  ivaPct: Porcentaje;
  precioTotal: Dinero;
  viaCaptura: ViaCaptura;
  activo: boolean;
}

export interface DatosDeRecurso {
  nombre: string;
  tipo: TipoRecurso;
  unidadId: string;
  precioBase: Dinero;
  ivaPct?: Porcentaje;
  precioTotal: Dinero;
  viaCaptura: ViaCaptura;
}

export interface PresupuestoVinculado {
  id: string;
  codigo: string;
  nombre: string;
  estado?: EstadoPresupuesto;
}

export interface ApuDeLista {
  id: string;
  codigo: string;
  nombre: string;
  unidadId: string;
  unidadSimbolo: string;
  activo: boolean;
  costoDirecto: Dinero;
}

export interface LineaDeApu {
  recursoId: string;
  recursoCodigo: string;
  recursoNombre: string;
  recursoTipo: TipoRecurso;
  unidadSimbolo: string;
  precioUnitario: Dinero;
  cantidad: Cantidad;
  rendimiento: Cantidad;
  desperdicioPct: Porcentaje;
  subtotal: Dinero;
}

export interface Apu extends ApuDeLista {
  lineas: LineaDeApu[];
}

export interface DatosDeApu {
  nombre: string;
  unidadId: string;
  lineas: { recursoId: string; cantidad: Cantidad; rendimiento: Cantidad; desperdicioPct?: Porcentaje }[];
}

// --- Configuración (CONTRATO §7) -------------------------------------------------

export interface MiCuenta {
  nombre: string;
  email: string;
  rol: string;
}

export interface Empresa {
  razonSocial: string;
  nit: string;
  direccion: string | null;
  telefono: string | null;
  emailRecuperacion: string | null;
  /** El logo vigente (CONTRATO §13): se pide a /api/logos/:id. Null: sin logo. */
  logoId: string | null;
}

export interface Preferencias {
  monedaBase: string;
  separadorMiles: string;
  separadorDecimal: string;
  decimalesVista: 0 | 1 | 2;
  notifVencimiento: boolean;
  notifCambioEstado: boolean;
}

export type EstadoDePago = 'EXITOSO' | 'PENDIENTE' | 'RECHAZADO';

export interface Pago {
  id: string;
  fecha: string;
  concepto: string;
  monto: Dinero;
  moneda: string;
  metodo: string;
  estado: EstadoDePago;
  /** CONTRATO §14: REPORTADO es el que subió la empresa y verifica el panel. */
  origen: 'MANUAL' | 'REPORTADO' | 'PASARELA';
  periodoMeses: number | null;
  /** Nulo mientras un pago reportado espera verificación. */
  cubreHasta: string | null;
  /** Por qué se rechazó un pago reportado; lo escribe el panel. */
  rechazoMotivo: string | null;
  facturaNumero: string | null;
}

export interface DetalleDeSuscripcion extends CicloDeSuscripcion {
  plan: string;
  venceEl: string;
  diasRestantes: number;
  pagos: Pago[];
  /**
   * Si esta persona puede reportar un pago ahora (CONTRATO §14.1). Con la
   * suscripción cancelada, solo el Administrador y en su plazo para
   * reactivarla (D-74).
   */
  puedeReportar: boolean;
  /** CONTRATO §15 · Solo el Administrador, con la suscripción vigente y sin un pago esperando. */
  puedeCancelar: boolean;
  /** CONTRATO §15 · Solo el Administrador, con la suscripción cancelada y antes de la fecha pagada. */
  puedeReanudar: boolean;
  /**
   * CONTRATO §18.2 · D-78 · Los plazos que rigen hoy, para que la pantalla no
   * los escriba de memoria: el superadministrador los cambia. Opcional hasta
   * que la API lo mande; sin él, los textos no dicen el número.
   */
  plazos?: PlazosVigentes;
}

/** D-78 · Los plazos del ciclo de suscripción vigentes hoy, en días. */
export interface PlazosVigentes {
  /** Días HÁBILES después del vencimiento para pagar. */
  graciaPago: number;
  /** Días HÁBILES para reenviar el comprobante tras un rechazo. */
  plazoTrasRechazo: number;
  /** Días que una cuenta suspendida conserva sus datos. */
  suspension: number;
  /** Días de solo lectura al terminar la prueba. */
  pruebaSoloLectura: number;
  /** Días para reactivar una suscripción cancelada. */
  reactivacion: number;
}

// --- CONTRATO §11 · Usuarios y roles (02 §11.4) -------------------------------

export type EstadoUsuario = 'PENDIENTE' | 'ACTIVO' | 'REVOCADO';
export type TipoDeRol = 'ADMIN' | 'ASISTENTE' | 'PERSONALIZADO';

export interface Usuario {
  id: string;
  nombre: string;
  email: string;
  estado: EstadoUsuario;
  rolId: string;
  rolNombre: string;
  rolTipo: TipoDeRol;
  creadoEn: Instante;
  ultimoAcceso: Instante | null;
  /** El enlace de activación vigente, si hay uno. */
  activacionVenceEn: Instante | null;
  esUsted: boolean;
}

export interface Rol {
  id: string;
  nombre: string;
  tipo: TipoDeRol;
  permisos: Permiso[];
  /** Cuántos usuarios lo tienen, revocados incluidos. */
  usuarios: number;
}

export interface PermisoDelCatalogo {
  codigo: Permiso;
  modulo: string;
  accion: string;
  descripcion: string;
}

export interface PanelDeUsuarios {
  plan: { codigo: 'PERSONAL' | 'EMPRESARIAL'; maxUsuarios: number | null; rolesPersonalizados: boolean };
  usuarios: Usuario[];
  roles: Rol[];
  /** El catálogo sin PRESUPUESTOS.ESTADO, que no es delegable. */
  permisos: PermisoDelCatalogo[];
}
