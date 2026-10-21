import type { Permiso } from '../../api/tipos.ts';
import type { PestanaDeConfiguracion } from '../../navegacion.ts';

/*
 * Las pestañas de Configuración que el rol permite, en su orden. Viven aparte
 * porque las usan dos: la pantalla de Configuración y el submenú de la barra
 * lateral, que las muestra al pasar el mouse (pedido del dueño, 13 de octubre
 * de 2026). Mi cuenta no pide permiso.
 */
export function pestanasDeConfiguracion(puede: (p: Permiso) => boolean): { id: PestanaDeConfiguracion; nombre: string }[] {
  return [
    { id: 'cuenta' as const, nombre: 'Mi cuenta', visible: true },
    { id: 'empresa' as const, nombre: 'Datos de empresa', visible: puede('CONFIG.EMPRESA') },
    { id: 'preferencias' as const, nombre: 'Preferencias y unidades', visible: puede('CONFIG.PREFERENCIAS') },
    // CONTRATO §19.3 y §19.4: los calendarios y los festivos son preferencias de la empresa.
    { id: 'calendarios' as const, nombre: 'Calendarios y festivos', visible: puede('CONFIG.PREFERENCIAS') },
    { id: 'suscripcion' as const, nombre: 'Suscripción', visible: puede('CONFIG.SUSCRIPCION') },
    { id: 'usuarios' as const, nombre: 'Usuarios', visible: puede('USUARIOS.GESTIONAR') },
  ]
    .filter((p) => p.visible)
    .map(({ id, nombre }) => ({ id, nombre }));
}
