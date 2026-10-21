import { ejecutarConPermiso, type ClienteEnContexto, type ContextoTenant } from './contextoTenant.js';

/*
 * Los festivos (D-90, RF-CFG-32, CONTRATO §19.4). Las listas de la plataforma
 * son de todas las empresas y ninguna las escribe; las propias son privadas de
 * su empresa, y la RLS las acota. Copiar una lista a un calendario está en
 * calendarios.ts.
 */

export interface FechaFestiva {
  fecha: string;
  nombre: string | null;
}

export interface ListaPropia {
  id: string;
  nombre: string;
  fechas: FechaFestiva[];
}

export interface DatosDeListaPropia {
  nombre: string;
  fechas: FechaFestiva[];
}

export async function leerListaPropiaEn(cliente: ClienteEnContexto, id: string): Promise<ListaPropia | null> {
  const lista = await cliente.query<{ id: string; nombre: string }>('SELECT id, nombre FROM app.lista_festivos_propia WHERE id = $1', [id]);
  const fila = lista.rows[0];
  if (!fila) return null;
  const { rows } = await cliente.query<FechaFestiva>(
    `SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha, nombre
       FROM app.lista_festivos_propia_fecha WHERE lista_id = $1 ORDER BY fecha`,
    [id],
  );
  return { id: fila.id, nombre: fila.nombre, fechas: rows };
}

async function escribirFechasEn(cliente: ClienteEnContexto, tenantId: string, listaId: string, fechas: FechaFestiva[]): Promise<void> {
  await cliente.query('DELETE FROM app.lista_festivos_propia_fecha WHERE lista_id = $1', [listaId]);
  await cliente.query(
    `INSERT INTO app.lista_festivos_propia_fecha (tenant_id, lista_id, fecha, nombre)
     SELECT $1, $2, f::date, n FROM unnest($3::text[], $4::text[]) AS t(f, n)`,
    [tenantId, listaId, fechas.map((f) => f.fecha), fechas.map((f) => f.nombre)],
  );
}

// -----------------------------------------------------------------------------
//  CONFIG.PREFERENCIAS · Las listas propias. null si el id no es de esta
//  empresa: lo ajeno y lo inexistente son lo mismo (404).
// -----------------------------------------------------------------------------

export async function crearListaPropia(contexto: ContextoTenant, datos: DatosDeListaPropia): Promise<ListaPropia> {
  return ejecutarConPermiso(contexto, 'CONFIG.PREFERENCIAS', async (cliente) => {
    const { rows } = await cliente.query<{ id: string }>(
      'INSERT INTO app.lista_festivos_propia (tenant_id, nombre) VALUES ($1, $2) RETURNING id',
      [contexto.tenantId, datos.nombre],
    );
    const id = rows[0]!.id;
    await escribirFechasEn(cliente, contexto.tenantId, id, datos.fechas);
    return (await leerListaPropiaEn(cliente, id))!;
  });
}

/** Reemplaza el nombre y la lista entera de fechas (CONTRATO §19.4). */
export async function reemplazarListaPropia(contexto: ContextoTenant, id: string, datos: DatosDeListaPropia): Promise<ListaPropia | null> {
  return ejecutarConPermiso(contexto, 'CONFIG.PREFERENCIAS', async (cliente) => {
    const { rowCount } = await cliente.query('UPDATE app.lista_festivos_propia SET nombre = $2 WHERE id = $1', [id, datos.nombre]);
    if (rowCount !== 1) return null;
    await escribirFechasEn(cliente, contexto.tenantId, id, datos.fechas);
    return leerListaPropiaEn(cliente, id);
  });
}

/** Los calendarios que la copiaron conservan sus fechas y olvidan de dónde salieron (ON DELETE SET NULL). */
export async function eliminarListaPropia(contexto: ContextoTenant, id: string): Promise<boolean> {
  return ejecutarConPermiso(contexto, 'CONFIG.PREFERENCIAS', async (cliente) => {
    const { rowCount } = await cliente.query('DELETE FROM app.lista_festivos_propia WHERE id = $1', [id]);
    return rowCount === 1;
  });
}
