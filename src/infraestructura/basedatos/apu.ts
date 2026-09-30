import { ejecutarConPermiso, type ClienteEnContexto, type ContextoTenant } from './contextoTenant.js';
import type { EstadoPresupuesto } from './presupuesto.js';
import type { TipoRecurso } from './recurso.js';

/**
 * Una línea de la composición tal como la pide app.fn_nueva_version_apu: la
 * referencia al recurso y sus cantidades, nada más. Código, nombre, tipo,
 * unidad y precio los copia la base del catálogo en el instante de guardar,
 * y es justo eso lo que congela la versión (D-1, D-2). Los números viajan
 * como texto: son numeric de Postgres y esta capa no hace aritmética con
 * ellos (CLAUDE.md, regla 2). La precarga en 1 de RF-APU-19 es de la
 * interfaz; acá los tres campos son obligatorios, para que ningún valor por
 * defecto viva en dos lugares.
 */
export interface LineaApu {
  recursoId: string;
  cantidad: string;
  rendimiento: string;
  desperdicioPct: string;
}

/** Lo que hace falta para crear un APU (RF-APU-05/06). */
export interface DatosApu {
  nombre: string;
  unidadId: string;
  lineas: LineaApu[];
}

/** Una línea congelada de la versión vigente, con los valores que la base copió del catálogo al guardarla. */
export interface LineaApuVigente {
  orden: number;
  recursoId: string;
  recursoCodigo: string;
  recursoNombre: string;
  recursoTipo: TipoRecurso;
  unidadSimbolo: string;
  precioUnitario: string;
  cantidad: string;
  rendimiento: string;
  desperdicioPct: string;
  subtotal: string;
}

/**
 * Una fila de la vista maestra (RF-APU-01): el APU y su versión vigente,
 * sin la composición. El costo es siempre el de la vigente (RF-APU-17).
 */
export interface ResumenApu {
  id: string;
  codigo: string;
  nombre: string;
  unidadId: string;
  /** El de la versión vigente, congelado con ella. */
  unidadSimbolo: string;
  activo: boolean;
  versionVigenteId: string;
  numeroVersion: number;
  costoDirecto: string;
}

/** Un APU con la composición de su versión vigente. */
export interface Apu extends ResumenApu {
  lineas: LineaApuVigente[];
}

interface FilaCabecera {
  id: string;
  codigo: string;
  nombre: string;
  unidad_id: string;
  unidad_simbolo: string;
  activo: boolean;
  version_vigente_id: string;
  numero: number;
  costo_directo: string;
}

/**
 * La cabecera se une SOLO a la versión vigente: un join a app.apu_version
 * sin esa condición devolvería una fila por versión, y la vista maestra
 * mostraría el mismo APU repetido con costos viejos.
 */
const SELECT_CABECERA = `
  SELECT a.id, a.codigo, a.nombre, a.unidad_id, v.unidad_simbolo, a.activo,
         a.version_vigente_id, v.numero, v.costo_directo
    FROM app.apu a
    JOIN app.apu_version v ON v.id = a.version_vigente_id`;

function filaAResumen(fila: FilaCabecera): ResumenApu {
  return {
    id: fila.id,
    codigo: fila.codigo,
    nombre: fila.nombre,
    unidadId: fila.unidad_id,
    unidadSimbolo: fila.unidad_simbolo,
    activo: fila.activo,
    versionVigenteId: fila.version_vigente_id,
    numeroVersion: fila.numero,
    costoDirecto: fila.costo_directo,
  };
}

interface FilaLinea {
  orden: number;
  recurso_id: string;
  recurso_codigo: string;
  recurso_nombre: string;
  recurso_tipo: TipoRecurso;
  unidad_simbolo: string;
  precio_unitario: string;
  cantidad: string;
  rendimiento: string;
  desperdicio_pct: string;
  subtotal: string;
}

/** El JSONB que espera fn_nueva_version_apu. */
function lineasAJson(lineas: LineaApu[]): string {
  return JSON.stringify(
    lineas.map((linea) => ({
      recurso_id: linea.recursoId,
      cantidad: linea.cantidad,
      rendimiento: linea.rendimiento,
      desperdicio_pct: linea.desperdicioPct,
    })),
  );
}

/** Lectura compartida por leerApu y crearApu: dentro de la transacción que ya abrió cada una. */
async function leerConCliente(cliente: ClienteEnContexto, id: string): Promise<Apu | null> {
  const { rows } = await cliente.query<FilaCabecera>(`${SELECT_CABECERA} WHERE a.id = $1`, [id]);
  const cabecera = rows[0];
  if (!cabecera) return null;

  const { rows: lineas } = await cliente.query<FilaLinea>(
    `SELECT orden, recurso_id, recurso_codigo, recurso_nombre, recurso_tipo,
            unidad_simbolo, precio_unitario, cantidad, rendimiento,
            desperdicio_pct, subtotal
       FROM app.apu_version_recurso
      WHERE apu_version_id = $1
      ORDER BY orden`,
    [cabecera.version_vigente_id],
  );

  return {
    ...filaAResumen(cabecera),
    lineas: lineas.map((linea) => ({
      orden: linea.orden,
      recursoId: linea.recurso_id,
      recursoCodigo: linea.recurso_codigo,
      recursoNombre: linea.recurso_nombre,
      recursoTipo: linea.recurso_tipo,
      unidadSimbolo: linea.unidad_simbolo,
      precioUnitario: linea.precio_unitario,
      cantidad: linea.cantidad,
      rendimiento: linea.rendimiento,
      desperdicioPct: linea.desperdicio_pct,
      subtotal: linea.subtotal,
    })),
  };
}

/**
 * Crea un APU (RF-APU-05/06/11). Código, cabecera y primera versión van en
 * UNA transacción: el código sale de app.fn_siguiente_codigo, y la versión
 * —subtotales, costo directo, snapshots del catálogo— la arma
 * app.fn_nueva_version_apu. Esta función no calcula nada: arma el JSONB.
 *
 * Todo lo que la composición puede tener de mal lo rechaza la base, y
 * entonces la transacción entera vuelve atrás, cabecera y código incluidos:
 * composición vacía (RF-APU-22), desperdicio fuera de MATERIAL (RF-APU-07),
 * cantidad o rendimiento bajo el mínimo (RF-APU-19), recurso de otra empresa
 * (RN-01), y el costo que no cuadra con sus líneas (D-21, al confirmar).
 */
export async function crearApu(contexto: ContextoTenant, datos: DatosApu): Promise<Apu> {
  return ejecutarConPermiso(contexto, 'APU.CREAR', async (cliente) => {
    const { rows: filasCodigo } = await cliente.query<{ fn_siguiente_codigo: string }>(
      `SELECT app.fn_siguiente_codigo($1, 'APU')`,
      [contexto.tenantId],
    );

    const { rows } = await cliente.query<{ id: string }>(
      `INSERT INTO app.apu (tenant_id, codigo, nombre, unidad_id, creado_por)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [contexto.tenantId, filasCodigo[0]!.fn_siguiente_codigo, datos.nombre, datos.unidadId, contexto.usuarioId],
    );
    const id = rows[0]!.id;

    await cliente.query(
      `SELECT app.fn_nueva_version_apu($1, $2::jsonb, NULL, NULL, 'Versión inicial')`,
      [id, lineasAJson(datos.lineas)],
    );

    return (await leerConCliente(cliente, id))!;
  });
}

/** Un APU con la composición de su versión vigente, o null si no existe en esta empresa. */
export async function leerApu(contexto: ContextoTenant, id: string): Promise<Apu | null> {
  return ejecutarConPermiso(contexto, 'APU.VER', (cliente) => leerConCliente(cliente, id));
}

/** Un presupuesto que usa el APU, con su estado: la interfaz solo pregunta por los ABIERTOS. */
export interface PresupuestoVinculado {
  id: string;
  codigo: string;
  nombre: string;
  estado: EstadoPresupuesto;
}

/**
 * RF-APU-13: en qué presupuestos está vinculado el APU. Devuelve TODOS, con
 * su estado, y no solo los ABIERTOS como listarPresupuestosAfectados de
 * Recursos: acá el requisito es verificar dónde está usado, y la interfaz
 * decide qué preguntar. Nada se decide con esto: aunque un ACTIVO o CERRADO
 * llegue después a la lista de reapuntar, fn_reapuntar_apu lo ignora.
 */
export async function listarPresupuestosDelApu(
  contexto: ContextoTenant,
  apuId: string,
): Promise<PresupuestoVinculado[]> {
  return ejecutarConPermiso(contexto, 'APU.EDITAR', async (cliente) => {
    const { rows } = await cliente.query<PresupuestoVinculado>(
      `SELECT DISTINCT p.id, p.codigo, p.nombre, p.estado
         FROM app.presupuesto_item i
         JOIN app.presupuesto p ON p.id = i.presupuesto_id
        WHERE i.apu_id = $1
        ORDER BY p.codigo`,
      [apuId],
    );
    return rows;
  });
}

/** Lo que devuelve editarApu: el APU con su versión nueva ya vigente, y cuántos ítems se movieron a ella. */
export interface ResultadoEditarApu {
  apu: Apu;
  itemsReapuntados: number;
}

/**
 * RF-APU-12..18. Editar no modifica nada: crea SIEMPRE una versión nueva y
 * la deja vigente (D-22), conteste lo que conteste el usuario. Su respuesta
 * decide una sola cosa, `presupuestosAReapuntar`, y eso lo resuelve
 * app.fn_reapuntar_apu en la misma transacción: pasa los ítems de esos
 * presupuestos a la versión vigente, con precio y costo redondeados por la
 * base, y los totales los recalcula tg_recalculo_item_upd. Los ACTIVOS y
 * CERRADOS de la lista se ignoran —el filtro está dentro de la función, no
 * en el llamador—, así que pasarlos por error no mueve un céntimo.
 *
 * El código no cambia nunca (RF-APU-18): fn_nueva_version_apu no lo toca y
 * tg_apu_inmutable lo protege. Cambiar la unidad de un APU que ya está en
 * un presupuesto lo rechaza tg_apu_unidad, y entonces no queda versión nueva:
 * todo es una transacción.
 */
export async function editarApu(
  contexto: ContextoTenant,
  id: string,
  datos: DatosApu,
  presupuestosAReapuntar?: string[],
): Promise<ResultadoEditarApu> {
  return ejecutarConPermiso(contexto, 'APU.EDITAR', async (cliente) => {
    await cliente.query(
      `SELECT app.fn_nueva_version_apu($1, $2::jsonb, $3, $4, 'Edición del APU')`,
      [id, lineasAJson(datos.lineas), datos.nombre, datos.unidadId],
    );

    const { rows } = await cliente.query<{ fn_reapuntar_apu: number }>(
      'SELECT app.fn_reapuntar_apu($1, $2)',
      [id, presupuestosAReapuntar ?? null],
    );

    return {
      apu: (await leerConCliente(cliente, id))!,
      itemsReapuntados: rows[0]!.fn_reapuntar_apu,
    };
  });
}

/** RF-APU-02/03. Sin filtros es el inventario completo (RF-APU-01), no un caso aparte. */
export interface FiltrosApu {
  /** Coincidencia parcial por nombre O por código: las dos las resuelve fn_buscar_apu. */
  texto?: string;
  unidadId?: string;
  /** Solo se usa junto con `texto`: fn_buscar_apu lo exige (D-47). Por defecto, el mismo 50 de la función. */
  limite?: number;
}

/**
 * La vista maestra (RF-APU-01..03). `texto` pasa por app.fn_buscar_apu
 * (D-47, índices trigrama compuestos con tenant_id), nunca por ILIKE contra
 * la tabla bajo RLS. Desde que la función devuelve RETURNS TABLE (id uuid),
 * "SELECT id FROM fn_buscar_apu(...)" resuelve id contra la columna de la
 * función y no contra app.apu de la consulta externa: el alias que hizo
 * falta en Recursos ya no es necesario acá.
 */
export async function listarApus(contexto: ContextoTenant, filtros: FiltrosApu = {}): Promise<ResumenApu[]> {
  return ejecutarConPermiso(contexto, 'APU.VER', async (cliente) => {
    const texto = filtros.texto?.trim();
    const parametros: unknown[] = [];
    const condiciones: string[] = [];

    if (texto) {
      parametros.push(texto, filtros.limite ?? 50);
      condiciones.push('a.id IN (SELECT id FROM app.fn_buscar_apu($1, $2))');
    }
    if (filtros.unidadId) {
      parametros.push(filtros.unidadId);
      condiciones.push(`a.unidad_id = $${parametros.length}`);
    }

    const dondeSql = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';
    const { rows } = await cliente.query<FilaCabecera>(
      `${SELECT_CABECERA} ${dondeSql} ORDER BY lower(a.nombre)`,
      parametros,
    );
    return rows.map(filaAResumen);
  });
}

/**
 * El buscador de «+ Agregar Actividad» de la mesa de trabajo (RF-PRE-15,
 * 02 §6.5 y §8.3): solo APU activos. Es una función aparte y no un parámetro
 * de listarApus a propósito. Con un parámetro de valor por defecto, una de las
 * dos pantallas dependería de que nadie olvide pasarlo, y el olvido no falla:
 * devuelve en silencio la lista equivocada. Si el valor por defecto excluyera
 * los inactivos, la vista maestra dejaría de mostrarlos y no habría dónde
 * reactivarlos; si los incluyera, el buscador ofrecería lo que se desactivó
 * para no ofrecerse. Con dos funciones, cada pantalla nombra lo que quiere, y
 * la regla del buscador no se puede apagar. El texto es obligatorio: un
 * autocompletado siempre busca algo.
 *
 * El filtro es solo de lectura: la base sigue aceptando un APU inactivo en una
 * actividad, porque un presupuesto viejo puede usar uno que se desactivó
 * después. Sin APU.VER, fn_exigir_permiso rechaza con el nombre del permiso
 * que falta, en vez de devolver una lista vacía que parezca un catálogo vacío.
 *
 * PENDIENTE: fn_buscar_apu aplica su LIMIT antes que el filtro de activos de
 * aquí, así que muchos inactivos que coincidan pueden ocupar cupos del límite y
 * dejar fuera a activos. Cuando se toque esa función, el filtro de activos se
 * mueve dentro de ella y este `AND a.activo` sale.
 */
export async function buscarApusParaActividad(
  contexto: ContextoTenant,
  texto: string,
  limite = 50,
): Promise<ResumenApu[]> {
  return ejecutarConPermiso(contexto, 'APU.VER', async (cliente) => {
    const { rows } = await cliente.query<FilaCabecera>(
      `${SELECT_CABECERA}
        WHERE a.id IN (SELECT id FROM app.fn_buscar_apu($1, $2))
          AND a.activo
        ORDER BY lower(a.nombre)`,
      [texto.trim(), limite],
    );
    return rows.map(filaAResumen);
  });
}
