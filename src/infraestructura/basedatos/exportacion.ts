import { ejecutarConPermiso, type ClienteEnContexto, type ContextoTenant, type FormatoNumerico } from './contextoTenant.js';
import { leerFotografia, type FotografiaPresupuesto } from './versiones.js';

/**
 * Todo lo que un renderizador necesita, y nada más (D-28): la fotografía, el
 * formato numérico de la empresa y, si es una versión, su número (RF-VER-07).
 * El desglose de los APU no viaja porque la fotografía no lo trae, así que
 * RF-PRE-31 se cumple por construcción: no se puede exportar lo que no llega.
 *
 * El logo viaja como llave (fotografia.empresa.logoRuta), no como bytes: los
 * trae el almacenamiento de objetos (D-30), que no es asunto de la base.
 */
export interface DocumentoExportable {
  fotografia: FotografiaPresupuesto;
  formato: FormatoNumerico;
  numeroVersion: number | null;
}

/**
 * El formato es el de la empresa HOY, también al reimprimir una versión vieja.
 * D-28 congela el contenido; separadores y decimales son presentación.
 */
async function leerFormato(cliente: ClienteEnContexto, tenantId: string): Promise<FormatoNumerico> {
  const { rows } = await cliente.query<{
    separador_miles: string;
    separador_decimal: string;
    decimales_vista: number;
  }>(
    `SELECT separador_miles, separador_decimal, decimales_vista
       FROM app.configuracion_empresa WHERE tenant_id = $1`,
    [tenantId],
  );
  const fila = rows[0]!;
  return {
    separadorMiles: fila.separador_miles,
    separadorDecimal: fila.separador_decimal,
    decimalesVista: fila.decimales_vista,
  };
}

/**
 * RF-PRE-29/30 · El presupuesto tal como está ahora. La fotografía la arma
 * app.fn_snapshot_presupuesto, la misma función de las versiones, pero sin
 * guardar nada: así el estado actual y una versión pasan por un solo
 * renderizador. Null si el presupuesto no existe en esta empresa.
 */
export async function leerPresupuestoParaExportar(
  contexto: ContextoTenant,
  presupuestoId: string,
): Promise<DocumentoExportable | null> {
  return ejecutarConPermiso(contexto, 'PRESUPUESTOS.EXPORTAR', async (cliente) => {
    const { rows } = await cliente.query<{ snapshot: unknown }>(
      `SELECT app.fn_snapshot_presupuesto(p.id, p.estado, NULL, NULL) AS snapshot
         FROM app.presupuesto p WHERE p.id = $1`,
      [presupuestoId],
    );
    const fila = rows[0];
    if (!fila) return null;
    return {
      fotografia: leerFotografia(fila.snapshot),
      formato: await leerFormato(cliente, contexto.tenantId),
      numeroVersion: null,
    };
  });
}

/** RF-VER-07 · Una versión guardada, con su número para que el documento lo diga. */
export async function leerVersionParaExportar(
  contexto: ContextoTenant,
  versionId: string,
): Promise<DocumentoExportable | null> {
  return ejecutarConPermiso(contexto, 'PRESUPUESTOS.EXPORTAR', async (cliente) => {
    const { rows } = await cliente.query<{ numero: number; snapshot: unknown }>(
      'SELECT numero, snapshot FROM app.presupuesto_version WHERE id = $1',
      [versionId],
    );
    const fila = rows[0];
    if (!fila) return null;
    return {
      fotografia: leerFotografia(fila.snapshot),
      formato: await leerFormato(cliente, contexto.tenantId),
      numeroVersion: fila.numero,
    };
  });
}
