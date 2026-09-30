import { ejecutarConPermiso, type ContextoTenant } from './contextoTenant.js';

/**
 * Una actividad cuyo APU ya tiene una versión más nueva que la que usa
 * (D-19). Es lo que el diálogo de duplicar muestra antes de confirmar: el
 * precio que el presupuesto tiene y el de hoy. Los dos los lee la base; esta
 * capa no los compara ni los resta.
 */
export interface ApuDesactualizado {
  itemId: string;
  apuId: string;
  codigo: string;
  descripcion: string;
  cantidad: string;
  precioEnElPresupuesto: string;
  precioVigente: string;
}

/**
 * Lo que decide el usuario al duplicar (RF-PRE-27). El código es obligatorio
 * y lo pone él; sin nombre, la base usa el del original con «(copia)».
 * `actualizarApu` es la respuesta al diálogo de D-19: con true, cada
 * actividad pasa a la versión vigente de su APU.
 */
export interface DatosDuplicado {
  codigo: string;
  nombre?: string;
  actualizarApu: boolean;
}

interface FilaDesactualizado {
  item_id: string;
  apu_id: string;
  codigo: string;
  descripcion: string;
  cantidad: string;
  precio_en_el_presupuesto: string;
  precio_vigente: string;
}

/**
 * D-19 · La lista del diálogo, de app.fn_apu_desactualizados (SECURITY
 * INVOKER: un presupuesto de otra empresa devuelve cero filas). Pide
 * PRESUPUESTOS.DUPLICAR porque solo existe para decidir una duplicación.
 */
export async function listarApusDesactualizados(
  contexto: ContextoTenant,
  presupuestoId: string,
): Promise<ApuDesactualizado[]> {
  return ejecutarConPermiso(contexto, 'PRESUPUESTOS.DUPLICAR', async (cliente) => {
    const { rows } = await cliente.query<FilaDesactualizado>(
      `SELECT item_id, apu_id, codigo, descripcion, cantidad,
              precio_en_el_presupuesto, precio_vigente
         FROM app.fn_apu_desactualizados($1)`,
      [presupuestoId],
    );
    return rows.map((fila) => ({
      itemId: fila.item_id,
      apuId: fila.apu_id,
      codigo: fila.codigo,
      descripcion: fila.descripcion,
      cantidad: fila.cantidad,
      precioEnElPresupuesto: fila.precio_en_el_presupuesto,
      precioVigente: fila.precio_vigente,
    }));
  });
}

/**
 * RF-PRE-27 · Duplica en cualquier estado y la copia nace ABIERTA.
 * app.fn_duplicar_presupuesto clona la EDT y las actividades en una
 * transacción, silencia los eventos de edición y deja uno solo,
 * PRESUPUESTO_DUPLICADO. Si el código ya existe, la base rechaza la copia y
 * no queda nada. Devuelve el id de la copia.
 */
export async function duplicarPresupuesto(
  contexto: ContextoTenant,
  origenId: string,
  datos: DatosDuplicado,
): Promise<string> {
  return ejecutarConPermiso(contexto, 'PRESUPUESTOS.DUPLICAR', async (cliente) => {
    const { rows } = await cliente.query<{ id: string }>(
      'SELECT app.fn_duplicar_presupuesto($1, $2, $3, $4) AS id',
      [origenId, datos.codigo, datos.nombre ?? null, datos.actualizarApu],
    );
    return rows[0]!.id;
  });
}

/** El pie financiero completo, con los importes como texto. */
export interface PieFinanciero {
  costoDirecto: string;
  costoIndirecto: string;
  administracion: string;
  imprevistos: string;
  utilidad: string;
  aiu: string;
  iva: string;
  valorTotal: string;
}

interface FilaPie {
  costo_directo: string;
  costo_indirecto: string;
  administracion: string;
  imprevistos: string;
  utilidad: string;
  aiu: string;
  iva: string;
  valor_total: string;
}

/**
 * D-19, D-63 · El «después» del diálogo de duplicar: el pie que tendría el
 * presupuesto con cada actividad en la versión vigente de su APU. Lo calcula
 * app.fn_pie_con_apu_vigentes con las mismas funciones que el recálculo
 * (fn_costo_actividad, fn_pie_financiero), así que la cifra que la pantalla
 * anticipa es la que queda guardada en la copia. El «antes» es la cabecera
 * del presupuesto tal como está. Null si el presupuesto no existe en esta
 * empresa.
 */
export async function leerPieConApuVigentes(
  contexto: ContextoTenant,
  presupuestoId: string,
): Promise<PieFinanciero | null> {
  return ejecutarConPermiso(contexto, 'PRESUPUESTOS.DUPLICAR', async (cliente) => {
    const { rows } = await cliente.query<FilaPie>(
      `SELECT costo_directo, costo_indirecto, administracion, imprevistos,
              utilidad, aiu, iva, valor_total
         FROM app.fn_pie_con_apu_vigentes($1)`,
      [presupuestoId],
    );
    const fila = rows[0];
    return fila
      ? {
          costoDirecto: fila.costo_directo,
          costoIndirecto: fila.costo_indirecto,
          administracion: fila.administracion,
          imprevistos: fila.imprevistos,
          utilidad: fila.utilidad,
          aiu: fila.aiu,
          iva: fila.iva,
          valorTotal: fila.valor_total,
        }
      : null;
  });
}
