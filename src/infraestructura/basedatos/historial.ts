import { ejecutarConPermiso, type ContextoTenant } from './contextoTenant.js';

/**
 * El catálogo app.tipo_evento como unión literal. Una prueba compara esta
 * lista con el catálogo de la base, igual que CODIGOS_PERMISO con app.permiso:
 * si alguien agrega un tipo en un lado, la suite lo avisa.
 */
export const TIPOS_EVENTO = [
  'CAMBIO_ESTADO',
  'REAPERTURA',
  'ITEM_AGREGADO',
  'ITEM_ELIMINADO',
  'CANTIDAD_MODIFICADA',
  'PRECIO_MODIFICADO',
  'CAPITULO_AGREGADO',
  'CAPITULO_ELIMINADO',
  'AIU_MODIFICADO',
  'PRESUPUESTO_ARCHIVADO',
  'PRESUPUESTO_DESARCHIVADO',
  'PRESUPUESTO_ELIMINADO',
  'PRESUPUESTO_DUPLICADO',
  'RECURSO_MODIFICADO',
  'APU_VERSIONADO',
  'ADMIN_RESTABLECIDO',
] as const;

export type TipoEvento = (typeof TIPOS_EVENTO)[number];

/**
 * Una línea del panel de historial (RF-HIS-02). La escribió la base, nunca
 * esta capa (D-45): el autor sale del contexto de la transacción en que
 * ocurrió el cambio. El id es bigint y viaja como texto.
 */
export interface Evento {
  id: string;
  tipoEvento: TipoEvento;
  descripcion: string;
  valorAnterior: Record<string, unknown> | null;
  valorNuevo: Record<string, unknown> | null;
  justificacion: string | null;
  usuarioId: string | null;
  usuarioNombre: string | null;
  ocurridoEn: Date;
}

/**
 * RF-HIS-04. El rango es semiabierto: `desde` entra y `hasta` no, para que
 * dos rangos seguidos (un día y el siguiente) no cuenten dos veces el evento
 * que cae justo en el borde.
 */
export interface FiltrosHistorial {
  desde?: Date;
  hasta?: Date;
  tipo?: TipoEvento;
  usuarioId?: string;
}

interface FilaEvento {
  id: string;
  tipo_evento: TipoEvento;
  descripcion: string;
  valor_anterior: Record<string, unknown> | null;
  valor_nuevo: Record<string, unknown> | null;
  justificacion: string | null;
  usuario_id: string | null;
  usuario_nombre: string | null;
  ocurrido_en: Date;
}

/**
 * RF-HIS-01..04 · El historial de un presupuesto, del más reciente al más
 * antiguo. Los eventos que no cuelgan de un proyecto —el precio de un
 * recurso— no aparecen aquí. Dentro de una misma transacción varios eventos
 * comparten la marca de tiempo; el id, que es creciente, decide el orden.
 */
export async function listarHistorial(
  contexto: ContextoTenant,
  presupuestoId: string,
  filtros: FiltrosHistorial = {},
): Promise<Evento[]> {
  return ejecutarConPermiso(contexto, 'PRESUPUESTOS.VER', async (cliente) => {
    const parametros: unknown[] = [presupuestoId];
    const condiciones = ['e.presupuesto_id = $1'];
    const agregar = (condicion: string, valor: unknown) => {
      parametros.push(valor);
      condiciones.push(condicion.replace('?', `$${parametros.length}`));
    };
    if (filtros.desde) agregar('e.ocurrido_en >= ?', filtros.desde);
    if (filtros.hasta) agregar('e.ocurrido_en < ?', filtros.hasta);
    if (filtros.tipo) agregar('e.tipo_evento = ?', filtros.tipo);
    if (filtros.usuarioId) agregar('e.usuario_id = ?', filtros.usuarioId);

    const { rows } = await cliente.query<FilaEvento>(
      `SELECT e.id::text AS id, e.tipo_evento, e.descripcion, e.valor_anterior,
              e.valor_nuevo, e.justificacion, e.usuario_id, u.nombre AS usuario_nombre,
              e.ocurrido_en
         FROM app.evento_auditoria e
         LEFT JOIN app.usuario u ON u.id = e.usuario_id
        WHERE ${condiciones.join(' AND ')}
        ORDER BY e.ocurrido_en DESC, e.id DESC`,
      parametros,
    );
    return rows.map((fila) => ({
      id: fila.id,
      tipoEvento: fila.tipo_evento,
      descripcion: fila.descripcion,
      valorAnterior: fila.valor_anterior,
      valorNuevo: fila.valor_nuevo,
      justificacion: fila.justificacion,
      usuarioId: fila.usuario_id,
      usuarioNombre: fila.usuario_nombre,
      ocurridoEn: fila.ocurrido_en,
    }));
  });
}
