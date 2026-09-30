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
