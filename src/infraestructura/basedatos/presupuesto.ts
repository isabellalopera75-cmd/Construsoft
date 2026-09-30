import { ejecutarConPermiso, type ClienteEnContexto, type ContextoTenant } from './contextoTenant.js';

export type EstadoPresupuesto = 'ABIERTO' | 'ACTIVO' | 'CERRADO';

/** D-42 · ITEMS es capítulo → actividad; WBS admite subcapítulos a cualquier profundidad. */
export type ModoEstructura = 'ITEMS' | 'WBS';

/**
 * Lo que decide una persona al crear un presupuesto (RF-PRE-03/04/44). El
 * modo es obligatorio aunque la columna tenga DEFAULT 'WBS': 02 §7.1 exige
 * elegirlo, y un valor por defecto aquí sería una segunda decisión escondida.
 * Todo lo demás lo pone la base: estado ABIERTO (RF-PRE-05), fecha de
 * elaboración (RF-PRE-06), AIU en cero e IVA en 19 (D-41, D-33), totales.
 */
export interface DatosPresupuesto {
  codigo: string;
  nombre: string;
  ubicacion: string;
  modoEstructura: ModoEstructura;
}

/**
 * La cabecera del presupuesto: el encabezado de la mesa de trabajo
 * (RF-PRE-09) y los datos del pie financiero (RF-PRE-22/43). Los importes y
 * porcentajes son numeric de Postgres y viajan como texto: esta capa no hace
 * aritmética con ellos (CLAUDE.md, regla 2; 06 §2.4). Todos los totales los
 * escribe app.fn_recalcular_presupuesto, y sinBaseAiu es una columna generada
 * que decide el aviso de RF-PRE-36: la interfaz no evalúa la condición.
 */
export interface Presupuesto {
  id: string;
  codigo: string;
  nombre: string;
  ubicacion: string;
  moneda: string;
  estado: EstadoPresupuesto;
  modoEstructura: ModoEstructura;
  /** No nulo ⇒ archivado (D-18). */
  archivadoEn: Date | null;
  aiuAdministracion: string;
  aiuImprevistos: string;
  aiuUtilidad: string;
  ivaUtilidadPct: string;
  totalCostoDirecto: string;
  totalCostoIndirecto: string;
  totalAdministracion: string;
  totalImprevistos: string;
  totalUtilidad: string;
  totalAiu: string;
  totalIva: string;
  valorTotal: string;
  sinBaseAiu: boolean;
  fechaElaboracion: Date;
  fechaModificacion: Date;
}

interface FilaPresupuesto {
  id: string;
  codigo: string;
  nombre: string;
  ubicacion: string;
  moneda: string;
  estado: EstadoPresupuesto;
  modo_estructura: ModoEstructura;
  archivado_en: Date | null;
  aiu_administracion: string;
  aiu_imprevistos: string;
  aiu_utilidad: string;
  iva_utilidad_pct: string;
  total_costo_directo: string;
  total_costo_indirecto: string;
  total_administracion: string;
  total_imprevistos: string;
  total_utilidad: string;
  total_aiu: string;
  total_iva: string;
  valor_total: string;
  sin_base_aiu: boolean;
  fecha_elaboracion: Date;
  fecha_modificacion: Date;
}

const SELECT_CABECERA = `
  SELECT id, codigo, nombre, ubicacion, moneda, estado, modo_estructura,
         archivado_en, aiu_administracion, aiu_imprevistos, aiu_utilidad,
         iva_utilidad_pct, total_costo_directo, total_costo_indirecto,
         total_administracion, total_imprevistos, total_utilidad, total_aiu,
         total_iva, valor_total, sin_base_aiu, fecha_elaboracion,
         fecha_modificacion
    FROM app.presupuesto`;

function filaAPresupuesto(fila: FilaPresupuesto): Presupuesto {
  return {
    id: fila.id,
    codigo: fila.codigo,
    nombre: fila.nombre,
    ubicacion: fila.ubicacion,
    moneda: fila.moneda,
    estado: fila.estado,
    modoEstructura: fila.modo_estructura,
    archivadoEn: fila.archivado_en,
    aiuAdministracion: fila.aiu_administracion,
    aiuImprevistos: fila.aiu_imprevistos,
    aiuUtilidad: fila.aiu_utilidad,
    ivaUtilidadPct: fila.iva_utilidad_pct,
    totalCostoDirecto: fila.total_costo_directo,
    totalCostoIndirecto: fila.total_costo_indirecto,
    totalAdministracion: fila.total_administracion,
    totalImprevistos: fila.total_imprevistos,
    totalUtilidad: fila.total_utilidad,
    totalAiu: fila.total_aiu,
    totalIva: fila.total_iva,
    valorTotal: fila.valor_total,
    sinBaseAiu: fila.sin_base_aiu,
    fechaElaboracion: fila.fecha_elaboracion,
    fechaModificacion: fila.fecha_modificacion,
  };
}

/** Lectura compartida por leerPresupuesto y crearPresupuesto: dentro de la transacción que ya abrió cada una. */
async function leerConCliente(cliente: ClienteEnContexto, id: string): Promise<Presupuesto | null> {
  const { rows } = await cliente.query<FilaPresupuesto>(`${SELECT_CABECERA} WHERE id = $1`, [id]);
  const fila = rows[0];
  return fila ? filaAPresupuesto(fila) : null;
}

/**
 * Crea un presupuesto (RF-PRE-03..07, RF-PRE-44). La moneda no la elige
 * nadie: se lee de la configuración de la empresa en la misma sentencia
 * (RF-PRE-04, D-6), y tg_moneda_unica rechazaría cualquier otra. Es una
 * subconsulta escalar y no un INSERT … SELECT: si la configuración faltara,
 * el NOT NULL falla en voz alta en vez de insertar cero filas en silencio.
 *
 * El código repetido en la empresa lo rechaza UNIQUE (tenant_id, codigo), y
 * el mismo código en otra empresa es válido: es único por inquilino.
 */
export async function crearPresupuesto(
  contexto: ContextoTenant,
  datos: DatosPresupuesto,
): Promise<Presupuesto> {
  return ejecutarConPermiso(contexto, 'PRESUPUESTOS.CREAR', async (cliente) => {
    const { rows } = await cliente.query<{ id: string }>(
      `INSERT INTO app.presupuesto
              (tenant_id, codigo, nombre, ubicacion, moneda, modo_estructura, creado_por)
       VALUES ($1, $2, $3, $4,
               (SELECT moneda_base FROM app.configuracion_empresa WHERE tenant_id = $1),
               $5, $6)
       RETURNING id`,
      [contexto.tenantId, datos.codigo, datos.nombre, datos.ubicacion, datos.modoEstructura, contexto.usuarioId],
    );
    return (await leerConCliente(cliente, rows[0]!.id))!;
  });
}

/** La cabecera del presupuesto, o null si no existe en esta empresa. */
export async function leerPresupuesto(contexto: ContextoTenant, id: string): Promise<Presupuesto | null> {
  return ejecutarConPermiso(contexto, 'PRESUPUESTOS.VER', (cliente) => leerConCliente(cliente, id));
}
