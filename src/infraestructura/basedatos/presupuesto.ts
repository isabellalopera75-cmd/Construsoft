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
 * escribe app.fn_recalcular_presupuesto, y sinBaseAiu y aiuEnCero son columnas
 * generadas que deciden los avisos de RF-PRE-36 y RF-PRE-35: la interfaz no
 * evalúa ninguna de las dos condiciones.
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
  /** RF-PRE-35 · Los tres porcentajes del AIU en cero: la confirmación de activar lo advierte. Columna generada. */
  aiuEnCero: boolean;
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
  aiu_en_cero: boolean;
  fecha_elaboracion: Date;
  fecha_modificacion: Date;
}

const SELECT_CABECERA = `
  SELECT id, codigo, nombre, ubicacion, moneda, estado, modo_estructura,
         archivado_en, aiu_administracion, aiu_imprevistos, aiu_utilidad,
         iva_utilidad_pct, total_costo_directo, total_costo_indirecto,
         total_administracion, total_imprevistos, total_utilidad, total_aiu,
         total_iva, valor_total, sin_base_aiu, aiu_en_cero, fecha_elaboracion,
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
    aiuEnCero: fila.aiu_en_cero,
    fechaElaboracion: fila.fecha_elaboracion,
    fechaModificacion: fila.fecha_modificacion,
  };
}

/** Lectura compartida por leerPresupuesto y crearPresupuesto: dentro de la transacción que ya abrió cada una. */
export async function leerPresupuestoEnCliente(cliente: ClienteEnContexto, id: string): Promise<Presupuesto | null> {
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
    return (await leerPresupuestoEnCliente(cliente, rows[0]!.id))!;
  });
}

/** La cabecera del presupuesto, o null si no existe en esta empresa. */
export async function leerPresupuesto(contexto: ContextoTenant, id: string): Promise<Presupuesto | null> {
  return ejecutarConPermiso(contexto, 'PRESUPUESTOS.VER', (cliente) => leerPresupuestoEnCliente(cliente, id));
}

/**
 * RF-PRE-01/02/39. Sin filtros es la vista maestra: todos los no archivados.
 * `archivados: true` es el filtro «Ver archivados» y muestra los archivados;
 * texto y estado se combinan con cualquiera de los dos.
 */
export interface FiltrosPresupuesto {
  /** Coincidencia parcial por nombre O por código: las dos las resuelve fn_buscar_presupuesto. */
  texto?: string;
  estado?: EstadoPresupuesto;
  archivados?: boolean;
  /** Solo se usa junto con `texto`: fn_buscar_presupuesto lo exige (D-47). Por defecto, el mismo 50 de la función. */
  limite?: number;
}

/**
 * La vista maestra. `texto` pasa por app.fn_buscar_presupuesto (D-47), nunca
 * por ILIKE contra la tabla bajo RLS. El orden es el del índice
 * ix_presupuesto_estado: lo último que se tocó, primero.
 */
export async function listarPresupuestos(
  contexto: ContextoTenant,
  filtros: FiltrosPresupuesto = {},
): Promise<Presupuesto[]> {
  return ejecutarConPermiso(contexto, 'PRESUPUESTOS.VER', async (cliente) => {
    const texto = filtros.texto?.trim();
    const parametros: unknown[] = [];
    const condiciones: string[] = [
      filtros.archivados ? 'archivado_en IS NOT NULL' : 'archivado_en IS NULL',
    ];

    if (texto) {
      parametros.push(texto, filtros.limite ?? 50);
      condiciones.push('id IN (SELECT id FROM app.fn_buscar_presupuesto($1, $2))');
    }
    if (filtros.estado) {
      parametros.push(filtros.estado);
      condiciones.push(`estado = $${parametros.length}`);
    }

    const { rows } = await cliente.query<FilaPresupuesto>(
      `${SELECT_CABECERA} WHERE ${condiciones.join(' AND ')} ORDER BY fecha_modificacion DESC, codigo`,
      parametros,
    );
    return rows.map(filaAPresupuesto);
  });
}

/** RF-PRE-38 · Lo que se edita desde el encabezado de la mesa de trabajo. */
export interface DatosCabecera {
  codigo: string;
  nombre: string;
  ubicacion: string;
}

/**
 * Un UPDATE de la cabecera que devuelve el presupuesto como quedó, o null si
 * el id no existe en esta empresa (la RLS lo esconde y el UPDATE afecta cero
 * filas). Los rechazos son de la base: tg_cabecera_presupuesto fuera de
 * ABIERTO, UNIQUE del código, ck_presupuesto_texto_no_vacio, y los recálculos
 * los dispara tg_recalculo_aiu.
 */
async function actualizarCabecera(
  contexto: ContextoTenant,
  id: string,
  asignaciones: string,
  valores: unknown[],
): Promise<Presupuesto | null> {
  return ejecutarConPermiso(contexto, 'PRESUPUESTOS.EDITAR', async (cliente) => {
    const { rows } = await cliente.query<{ id: string }>(
      `UPDATE app.presupuesto SET ${asignaciones} WHERE id = $1 RETURNING id`,
      [id, ...valores],
    );
    return rows[0] ? leerPresupuestoEnCliente(cliente, id) : null;
  });
}

/**
 * RF-PRE-38. Los validadores son los mismos que al crear porque son los
 * mismos objetos de la base: el UNIQUE del código y ck_presupuesto_texto_no_vacio
 * se aplican solos al INSERT y al UPDATE.
 */
export async function editarCabecera(
  contexto: ContextoTenant,
  id: string,
  datos: DatosCabecera,
): Promise<Presupuesto | null> {
  return actualizarCabecera(contexto, id, 'codigo = $2, nombre = $3, ubicacion = $4', [
    datos.codigo,
    datos.nombre,
    datos.ubicacion,
  ]);
}

/** RF-PRE-23 · Los tres porcentajes del AIU y el del IVA, en puntos (19 es 19 %, RNF-22). */
export interface PorcentajesPresupuesto {
  aiuAdministracion: string;
  aiuImprevistos: string;
  aiuUtilidad: string;
  ivaUtilidadPct: string;
}

/**
 * RF-PRE-23. Solo escribe los porcentajes: A, I, U, IVA, valor total y
 * sinBaseAiu los recalcula la base en la misma transacción (tg_recalculo_aiu),
 * y lo que se devuelve es lo que quedó guardado.
 */
export async function editarPorcentajes(
  contexto: ContextoTenant,
  id: string,
  porcentajes: PorcentajesPresupuesto,
): Promise<Presupuesto | null> {
  return actualizarCabecera(
    contexto,
    id,
    'aiu_administracion = $2, aiu_imprevistos = $3, aiu_utilidad = $4, iva_utilidad_pct = $5',
    [porcentajes.aiuAdministracion, porcentajes.aiuImprevistos, porcentajes.aiuUtilidad, porcentajes.ivaUtilidadPct],
  );
}

/**
 * RF-PRE-44. Pasar de EDT a ítems con subcapítulos lo rechaza
 * tg_cambio_modo_estructura, nombrando cuántos hay.
 */
export async function cambiarModoEstructura(
  contexto: ContextoTenant,
  id: string,
  modo: ModoEstructura,
): Promise<Presupuesto | null> {
  return actualizarCabecera(contexto, id, 'modo_estructura = $2', [modo]);
}

/**
 * D-18, RF-PRE-39. Archivar no borra nada ni cambia el estado, y vale en
 * cualquier estado: archivado_en no forma parte de la línea base que
 * tg_cabecera_presupuesto congela.
 */
export async function archivarPresupuesto(contexto: ContextoTenant, id: string): Promise<Presupuesto | null> {
  return actualizarCabecera(contexto, id, 'archivado_en = now()', []);
}

export async function desarchivarPresupuesto(contexto: ContextoTenant, id: string): Promise<Presupuesto | null> {
  return actualizarCabecera(contexto, id, 'archivado_en = NULL', []);
}
