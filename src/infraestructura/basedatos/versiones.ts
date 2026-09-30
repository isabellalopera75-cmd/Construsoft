import { ejecutarConPermiso, type ClienteEnContexto, type ContextoTenant } from './contextoTenant.js';
import type { EstadoPresupuesto, ModoEstructura } from './presupuesto.js';
import type { Clasificacion } from './edt.js';

export type TipoVersion = 'AUTOMATICA' | 'MANUAL';
export type DisparadorVersion = 'ABIERTO_A_ACTIVO' | 'ACTIVO_A_CERRADO' | 'ACTIVO_A_ABIERTO' | 'MANUAL';

/**
 * Una fila del historial de versiones (RF-VER-05). `estado` es el de la
 * fotografía, no el del presupuesto hoy: la versión que guarda una reapertura
 * es ACTIVO, porque archiva la línea base tal como estaba firmada (RF-VER-08).
 */
export interface ResumenVersion {
  id: string;
  numero: number;
  tipo: TipoVersion;
  disparador: DisparadorVersion;
  estado: EstadoPresupuesto;
  motivo: string | null;
  valorTotal: string;
  creadaEn: Date;
  autor: string | null;
}

export interface CapituloFotografia {
  id: string;
  codigoWbs: string;
  padreCodigo: string | null;
  nivel: number;
  nombre: string;
  /** La efectiva: la del capítulo raíz, heredada por los subniveles (D-8). Schema 4. */
  clasificacion: Clasificacion;
  montoAcumulado: string;
  /** Null cuando no había costo directo (RF-PRE-37): se muestra como guion. */
  incidenciaPct: string | null;
}

export interface ItemFotografia {
  id: string;
  wbsNodoId: string;
  codigoItem: string;
  codigoWbsPadre: string;
  codigoApu: string;
  descripcion: string;
  unidad: string;
  cantidad: string;
  precioUnitario: string;
  costoTotal: string;
  apuVersionId: string;
}

/** La fotografía completa de D-28, schema 4, con los importes como texto. */
export interface FotografiaPresupuesto {
  schema: 4;
  presupuesto: {
    codigo: string;
    nombre: string;
    ubicacion: string;
    moneda: string;
    estado: EstadoPresupuesto;
    tipoProyecto: string;
    modoEstructura: ModoEstructura;
    aiu: { a: string; i: string; u: string };
    ivaUtilidadPct: string;
    totales: {
      costoDirecto: string;
      costoIndirecto: string;
      administracion: string;
      imprevistos: string;
      utilidad: string;
      aiu: string;
      iva: string;
      valorTotal: string;
    };
    fechaElaboracion: string;
  };
  empresa: { razonSocial: string; nit: string | null };
  capitulos: CapituloFotografia[];
  items: ItemFotografia[];
  generada: {
    porUsuarioId: string | null;
    porUsuarioNombre: string | null;
    en: string;
    disparador: DisparadorVersion;
    motivo: string | null;
  };
}

export interface Version extends ResumenVersion {
  fotografia: FotografiaPresupuesto;
}

/**
 * El único formato de fotografía que este lector sabe leer. El 3 guardaba la
 * clasificación cruda (null en los subniveles); el 4 la guarda heredada. Leer
 * un 3 como si fuera un 4 dejaría subcapítulos sin clasificación sin que nada
 * fallara, y por eso el 3 se rechaza igual que cualquier otro número.
 */
const SCHEMA_FOTOGRAFIA = 4;

/* La fotografía tal como la escribe app.fn_snapshot_presupuesto, en snake_case. */
interface FotografiaCruda {
  schema: 4;
  presupuesto: {
    codigo: string;
    nombre: string;
    ubicacion: string;
    moneda: string;
    estado: EstadoPresupuesto;
    tipo_proyecto: string;
    modo_estructura: ModoEstructura;
    aiu: { a: string; i: string; u: string };
    iva_utilidad_pct: string;
    totales: {
      costo_directo: string;
      costo_indirecto: string;
      administracion: string;
      imprevistos: string;
      utilidad: string;
      aiu: string;
      iva: string;
      valor_total: string;
    };
    fecha_elaboracion: string;
  };
  empresa: { razon_social: string; nit: string | null };
  capitulos: Array<{
    id: string;
    codigo_wbs: string;
    padre_codigo: string | null;
    nivel: number;
    nombre: string;
    clasificacion: Clasificacion;
    monto_acumulado: string;
    incidencia_pct: string | null;
  }>;
  items: Array<{
    id: string;
    wbs_nodo_id: string;
    codigo_item: string;
    codigo_wbs_padre: string;
    codigo_apu: string;
    descripcion: string;
    unidad: string;
    cantidad: string;
    precio_unitario: string;
    costo_total: string;
    apu_version_id: string;
  }>;
  generada: {
    por_usuario_id: string | null;
    por_usuario_nombre: string | null;
    en: string;
    disparador: DisparadorVersion;
    motivo: string | null;
  };
}

/**
 * Interpreta la fotografía de una versión. El número de schema se COMPRUEBA,
 * no se asume. Las versiones son inmutables, así que una guardada con otro
 * formato no se podrá corregir nunca. Un lector que la leyera como si fuera
 * del 4 mostraría una línea base mal interpretada, y nadie se enteraría. Ante
 * un número desconocido, falla y nombra el número que llegó.
 */
export function leerFotografia(snapshot: unknown): FotografiaPresupuesto {
  const schema =
    typeof snapshot === 'object' && snapshot !== null ? (snapshot as { schema?: unknown }).schema : undefined;
  if (typeof schema !== 'number') {
    throw new Error(
      'La fotografía de esta versión llegó sin número de schema, así que no se puede saber cómo leerla. ' +
        'No se interpreta a ciegas: revise la versión en la base antes de mostrarla o exportarla.',
    );
  }
  if (schema !== SCHEMA_FOTOGRAFIA) {
    throw new Error(
      `La fotografía de esta versión usa el schema ${schema} y este lector solo sabe leer el schema ` +
        `${SCHEMA_FOTOGRAFIA}. Las versiones son inmutables: hace falta un lector para el schema ${schema}, ` +
        'no reinterpretarla con el formato actual.',
    );
  }
  const f = snapshot as FotografiaCruda;
  const p = f.presupuesto;
  return {
    schema: SCHEMA_FOTOGRAFIA,
    presupuesto: {
      codigo: p.codigo,
      nombre: p.nombre,
      ubicacion: p.ubicacion,
      moneda: p.moneda,
      estado: p.estado,
      tipoProyecto: p.tipo_proyecto,
      modoEstructura: p.modo_estructura,
      aiu: { a: p.aiu.a, i: p.aiu.i, u: p.aiu.u },
      ivaUtilidadPct: p.iva_utilidad_pct,
      totales: {
        costoDirecto: p.totales.costo_directo,
        costoIndirecto: p.totales.costo_indirecto,
        administracion: p.totales.administracion,
        imprevistos: p.totales.imprevistos,
        utilidad: p.totales.utilidad,
        aiu: p.totales.aiu,
        iva: p.totales.iva,
        valorTotal: p.totales.valor_total,
      },
      fechaElaboracion: p.fecha_elaboracion,
    },
    empresa: { razonSocial: f.empresa.razon_social, nit: f.empresa.nit },
    capitulos: f.capitulos.map((c) => ({
      id: c.id,
      codigoWbs: c.codigo_wbs,
      padreCodigo: c.padre_codigo,
      nivel: c.nivel,
      nombre: c.nombre,
      clasificacion: c.clasificacion,
      montoAcumulado: c.monto_acumulado,
      incidenciaPct: c.incidencia_pct,
    })),
    items: f.items.map((i) => ({
      id: i.id,
      wbsNodoId: i.wbs_nodo_id,
      codigoItem: i.codigo_item,
      codigoWbsPadre: i.codigo_wbs_padre,
      codigoApu: i.codigo_apu,
      descripcion: i.descripcion,
      unidad: i.unidad,
      cantidad: i.cantidad,
      precioUnitario: i.precio_unitario,
      costoTotal: i.costo_total,
      apuVersionId: i.apu_version_id,
    })),
    generada: {
      porUsuarioId: f.generada.por_usuario_id,
      porUsuarioNombre: f.generada.por_usuario_nombre,
      en: f.generada.en,
      disparador: f.generada.disparador,
      motivo: f.generada.motivo,
    },
  };
}

interface FilaVersion {
  id: string;
  numero: number;
  tipo: TipoVersion;
  disparador: DisparadorVersion;
  estado: EstadoPresupuesto;
  motivo: string | null;
  valor_total: string;
  creada_en: Date;
  autor: string | null;
}

const SELECT_VERSION = `
  SELECT v.id, v.numero, v.tipo, v.disparador,
         v.snapshot->'presupuesto'->>'estado' AS estado,
         v.motivo, v.valor_total, v.creada_en, u.nombre AS autor
    FROM app.presupuesto_version v
    LEFT JOIN app.usuario u ON u.id = v.creada_por`;

function filaAResumen(fila: FilaVersion): ResumenVersion {
  return {
    id: fila.id,
    numero: fila.numero,
    tipo: fila.tipo,
    disparador: fila.disparador,
    estado: fila.estado,
    motivo: fila.motivo,
    valorTotal: fila.valor_total,
    creadaEn: fila.creada_en,
    autor: fila.autor,
  };
}

async function leerResumen(cliente: ClienteEnContexto, id: string): Promise<ResumenVersion | null> {
  const { rows } = await cliente.query<FilaVersion>(`${SELECT_VERSION} WHERE v.id = $1`, [id]);
  return rows[0] ? filaAResumen(rows[0]) : null;
}

/**
 * RF-VER-03 · «Guardar versión». La base numera la versión y toma la
 * fotografía (fn_guardar_version). Esta capa no pone el disparador ni el
 * estado de la foto: para una versión MANUAL los fija la base. Un motivo en
 * blanco o un presupuesto CERRADO también los rechaza ella.
 */
export async function guardarVersion(
  contexto: ContextoTenant,
  presupuestoId: string,
  motivo: string,
): Promise<ResumenVersion> {
  return ejecutarConPermiso(contexto, 'PRESUPUESTOS.EDITAR', async (cliente) => {
    const { rows } = await cliente.query<{ id: string }>(
      `SELECT app.fn_guardar_version($1, 'MANUAL', NULL, $2, NULL) AS id`,
      [presupuestoId, motivo],
    );
    return (await leerResumen(cliente, rows[0]!.id))!;
  });
}

/** RF-VER-05 · El historial de versiones, de la primera a la última. */
export async function listarVersiones(contexto: ContextoTenant, presupuestoId: string): Promise<ResumenVersion[]> {
  return ejecutarConPermiso(contexto, 'PRESUPUESTOS.VER', async (cliente) => {
    const { rows } = await cliente.query<FilaVersion>(
      `${SELECT_VERSION} WHERE v.presupuesto_id = $1 ORDER BY v.numero`,
      [presupuestoId],
    );
    return rows.map(filaAResumen);
  });
}

/** RF-VER-06 · Una versión con su fotografía, en solo lectura; null si no existe en esta empresa. */
export async function leerVersion(contexto: ContextoTenant, versionId: string): Promise<Version | null> {
  return ejecutarConPermiso(contexto, 'PRESUPUESTOS.VER', async (cliente) => {
    const { rows } = await cliente.query<FilaVersion & { snapshot: unknown }>(
      `SELECT r.*, v.snapshot
         FROM (${SELECT_VERSION} WHERE v.id = $1) r
         JOIN app.presupuesto_version v ON v.id = r.id`,
      [versionId],
    );
    const fila = rows[0];
    if (!fila) return null;
    const { snapshot, ...resumen } = fila;
    return { ...filaAResumen(resumen), fotografia: leerFotografia(snapshot) };
  });
}
