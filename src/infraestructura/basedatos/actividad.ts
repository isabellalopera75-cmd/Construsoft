import { ejecutarConPermiso, type ClienteEnContexto, type ContextoTenant } from './contextoTenant.js';
import { ErrorParaElUsuario } from './errorParaElUsuario.js';

/**
 * Una fila de actividad de la mesa de trabajo (RF-PRE-18, 02 §8.3). Solo la
 * cantidad la decide una persona. El número de ítem lo deriva
 * fn_renumerar_wbs (D-42). Código, descripción, unidad y precio son la copia
 * congelada de la versión del APU (RNF-10), y tg_item_fiel_a_su_version los
 * vigila. El costo total es una columna generada (D-55). Los números viajan
 * como texto: esta capa no hace aritmética con ellos.
 */
export interface Actividad {
  id: string;
  wbsNodoId: string;
  codigoItem: string;
  apuId: string;
  apuVersionId: string;
  codigoApu: string;
  descripcion: string;
  unidadSimbolo: string;
  cantidad: string;
  precioUnitario: string;
  costoTotal: string;
}

interface FilaActividad {
  id: string;
  wbs_nodo_id: string;
  codigo_item: string;
  apu_id: string;
  apu_version_id: string;
  codigo_apu: string;
  descripcion: string;
  unidad_simbolo: string;
  cantidad: string;
  precio_unitario: string;
  costo_total: string;
}

const SELECT_ACTIVIDAD = `
  SELECT id, wbs_nodo_id, codigo_item, apu_id, apu_version_id, codigo_apu,
         descripcion, unidad_simbolo, cantidad, precio_unitario, costo_total
    FROM app.presupuesto_item`;

function filaAActividad(fila: FilaActividad): Actividad {
  return {
    id: fila.id,
    wbsNodoId: fila.wbs_nodo_id,
    codigoItem: fila.codigo_item,
    apuId: fila.apu_id,
    apuVersionId: fila.apu_version_id,
    codigoApu: fila.codigo_apu,
    descripcion: fila.descripcion,
    unidadSimbolo: fila.unidad_simbolo,
    cantidad: fila.cantidad,
    precioUnitario: fila.precio_unitario,
    costoTotal: fila.costo_total,
  };
}

async function leerConCliente(cliente: ClienteEnContexto, id: string): Promise<Actividad | null> {
  const { rows } = await cliente.query<FilaActividad>(`${SELECT_ACTIVIDAD} WHERE id = $1`, [id]);
  const fila = rows[0];
  return fila ? filaAActividad(fila) : null;
}

/**
 * RF-PRE-15/16/18 · «+ Agregar Actividad» al final de un capítulo o
 * subcapítulo. Es una sola sentencia: la base copia de la versión VIGENTE del
 * APU su código, nombre, unidad y costo directo; el presupuesto sale del
 * nodo. El orden, el número de ítem, el costo total y los totales los derivan
 * la base y sus disparadores. Nada de eso pasa por esta capa.
 *
 * Si el nodo o el APU no son visibles para esta empresa, el SELECT no produce
 * fila y el INSERT inserta cero. Eso se convierte en un error, no en un
 * silencio: quien agrega una actividad tiene que saber que no quedó.
 */
export async function agregarActividad(
  contexto: ContextoTenant,
  wbsNodoId: string,
  apuId: string,
  cantidad: string,
): Promise<Actividad> {
  return ejecutarConPermiso(contexto, 'PRESUPUESTOS.EDITAR', async (cliente) => {
    const { rows } = await cliente.query<{ id: string }>(
      `INSERT INTO app.presupuesto_item
              (tenant_id, presupuesto_id, wbs_nodo_id, apu_id, apu_version_id,
               codigo_apu, descripcion, unidad_simbolo, precio_unitario, cantidad)
       SELECT $1, n.presupuesto_id, n.id, a.id, v.id,
              a.codigo, v.nombre, v.unidad_simbolo, v.costo_directo, $4
         FROM app.wbs_nodo n
        CROSS JOIN app.apu a
         JOIN app.apu_version v ON v.id = a.version_vigente_id
        WHERE n.id = $2 AND a.id = $3
       RETURNING id`,
      [contexto.tenantId, wbsNodoId, apuId, cantidad],
    );
    const id = rows[0]?.id;
    if (!id) {
      throw new ErrorParaElUsuario(
        'La actividad no se agregó: el capítulo o el APU elegido no existe en esta empresa. ' +
          'Vuelva a cargar la mesa de trabajo y elija de nuevo el capítulo y el APU.',
        'RECHAZADO',
      );
    }
    return (await leerConCliente(cliente, id))!;
  });
}

/**
 * RF-PRE-18 · La única columna editable de la actividad (02 §8.3). El costo
 * total lo recalcula la columna generada y los totales del presupuesto,
 * tg_recalculo_item_upd. Devuelve null si el id no existe en esta empresa.
 */
export async function cambiarCantidad(
  contexto: ContextoTenant,
  id: string,
  cantidad: string,
): Promise<Actividad | null> {
  return ejecutarConPermiso(contexto, 'PRESUPUESTOS.EDITAR', async (cliente) => {
    const { rows } = await cliente.query<{ id: string }>(
      'UPDATE app.presupuesto_item SET cantidad = $2 WHERE id = $1 RETURNING id',
      [id, cantidad],
    );
    return rows[0] ? leerConCliente(cliente, id) : null;
  });
}

/** Renumeración y recálculo los disparan triggers por sentencia. Un id ajeno no borra nada. */
export async function eliminarActividad(contexto: ContextoTenant, id: string): Promise<void> {
  await ejecutarConPermiso(contexto, 'PRESUPUESTOS.EDITAR', (cliente) =>
    cliente.query('DELETE FROM app.presupuesto_item WHERE id = $1', [id]),
  );
}

/**
 * Las actividades del presupuesto en el orden de la oferta: por número de
 * ítem leído como lista de enteros, para que el 1.10 vaya después del 1.9.
 */
export async function leerActividades(contexto: ContextoTenant, presupuestoId: string): Promise<Actividad[]> {
  return ejecutarConPermiso(contexto, 'PRESUPUESTOS.VER', async (cliente) => {
    const { rows } = await cliente.query<FilaActividad>(
      `${SELECT_ACTIVIDAD} WHERE presupuesto_id = $1 ORDER BY string_to_array(codigo_item, '.')::int[]`,
      [presupuestoId],
    );
    return rows.map(filaAActividad);
  });
}
