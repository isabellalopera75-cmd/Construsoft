import { ejecutarConPermiso, type ContextoTenant } from './contextoTenant.js';

/*
 * Las tres transiciones del ciclo de vida (RF-PRE-24..28, RN-03). Esta capa
 * solo abre la puerta de PRESUPUESTOS.ESTADO y llama a la función de la base:
 * el rol de la aplicación no tiene UPDATE sobre presupuesto.estado (modelo P4).
 *
 * Todo lo demás lo hace la base, y por eso no se repite aquí:
 *   · fn_exigir_admin: ser Administrador, sobre el usuario de la sesión;
 *   · el estado de origen correcto, para que un doble clic no reescriba la
 *     fecha de la línea base;
 *   · D-20 con sus dos mensajes, desde tg_transicion_estado;
 *   · la versión automática y el evento del historial, desde
 *     tg_version_por_transicion, en la misma transacción.
 *
 * PRESUPUESTOS.ESTADO solo lo puede tener un rol ADMIN (tg sobre rol_permiso),
 * así que las dos comprobaciones dicen lo mismo por dos caminos: la del permiso
 * da el mensaje que la pantalla entiende y la del rol cierra la puerta en la base.
 */

/** RF-PRE-24/25 · «Aprobar y Activar Proyecto». Guarda la versión que es la línea base. */
export async function activarPresupuesto(contexto: ContextoTenant, id: string): Promise<void> {
  await ejecutarConPermiso(contexto, 'PRESUPUESTOS.ESTADO', (cliente) =>
    cliente.query('SELECT app.fn_activar_presupuesto($1)', [id]),
  );
}

/** RF-PRE-26 · «Cerrar Proyecto». CERRADO es terminal: no se reabre (RF-PRE-33). */
export async function cerrarPresupuesto(contexto: ContextoTenant, id: string): Promise<void> {
  await ejecutarConPermiso(contexto, 'PRESUPUESTOS.ESTADO', (cliente) =>
    cliente.query('SELECT app.fn_cerrar_presupuesto($1)', [id]),
  );
}

/**
 * RF-PRE-28 · «Reabrir Presupuesto». La justificación es obligatoria en la
 * base: la guarda en el evento REAPERTURA y como motivo de la versión que
 * archiva la línea base anterior (RF-VER-08).
 */
export async function reabrirPresupuesto(contexto: ContextoTenant, id: string, justificacion: string): Promise<void> {
  await ejecutarConPermiso(contexto, 'PRESUPUESTOS.ESTADO', (cliente) =>
    cliente.query('SELECT app.fn_reabrir_presupuesto($1, $2)', [id, justificacion]),
  );
}

/**
 * RF-PRE-40, D-18, D-61 · Eliminar un presupuesto que nunca se activó. La
 * única puerta es app.fn_eliminar_presupuesto: la aplicación no tiene DELETE
 * sobre la tabla. La base exige el rol Administrador y un motivo escrito, que
 * queda en el evento PRESUPUESTO_ELIMINADO, la única huella que sobrevive.
 * Uno que se activó alguna vez lo rechaza tg_borrar_solo_no_activado.
 *
 * Aquí la puerta es PRESUPUESTOS.ESTADO porque es el único permiso exclusivo
 * del Administrador, y D-18 pone el borrado junto al cambio de estado.
 */
export async function eliminarPresupuesto(contexto: ContextoTenant, id: string, motivo: string): Promise<void> {
  await ejecutarConPermiso(contexto, 'PRESUPUESTOS.ESTADO', (cliente) =>
    cliente.query('SELECT app.fn_eliminar_presupuesto($1, $2)', [id, motivo]),
  );
}
