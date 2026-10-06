import { createContext, useContext } from 'react';
import type { Arranque, Permiso } from './api/tipos.ts';

/*
 * Lo que toda pantalla de adentro necesita saber, leído una sola vez del
 * arranque (CONTRATO §3.1). Nada de esto se infiere de otro lado.
 */
export interface Sesion {
  arranque: Arranque;
  /** ¿El rol tiene este permiso? Solo decide qué se MUESTRA (02 §2, «Permisos»). */
  puede: (permiso: Permiso) => boolean;
  /**
   * ¿Se pueden mostrar controles que escriben? Combina el permiso con
   * `soloLectura`, que manda el servidor y no se recalcula. Una suscripción
   * nula es «sin acceso» y cuenta como solo lectura (CONTRATO §3.1).
   */
  puedeEscribir: (permiso: Permiso) => boolean;
  soloLectura: boolean;
  salir: () => Promise<void>;
  /**
   * Vuelve a leer el arranque sin pasar por la pantalla de carga. Lo usan las
   * preferencias: cambiar el separador decimal cambia cómo se ve toda cifra.
   */
  recargar: () => Promise<void>;
}

export const ContextoDeSesion = createContext<Sesion | null>(null);

export function useSesion(): Sesion {
  const sesion = useContext(ContextoDeSesion);
  if (!sesion) throw new Error('useSesion se usó fuera de una sesión abierta.');
  return sesion;
}

export function crearSesion(
  arranque: Arranque,
  salir: () => Promise<void>,
  recargar: () => Promise<void>,
): Sesion {
  const permisos = new Set(arranque.permisos);
  const soloLectura = arranque.suscripcion === null || arranque.suscripcion.soloLectura;
  const puede = (permiso: Permiso) => permisos.has(permiso);
  return {
    arranque,
    puede,
    puedeEscribir: (permiso) => !soloLectura && puede(permiso),
    soloLectura,
    salir,
    recargar,
  };
}
