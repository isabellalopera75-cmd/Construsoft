import { useEffect, useState } from 'react';

/*
 * Las direcciones de la aplicación viven después del «#».
 *
 * Por qué no rutas «limpias» con history.pushState: obligarían a que el
 * servidor de producción devuelva index.html para cualquier ruta desconocida,
 * una regla de despliegue más que alguien tiene que recordar. Y hay una razón
 * de seguridad que pesa más: el enlace de restablecimiento lleva un token, y lo
 * que va después del «#» no sale nunca del navegador —no llega al servidor, ni
 * a sus registros, ni a la cabecera Referer de otro sitio—.
 *
 * Solo cambian de dirección las pantallas. Una capa encima (crear, editar) no
 * es un lugar y no toca la dirección (DISENO §8).
 */

/** Las pestañas de Configuración (02 §11). */
export type PestanaDeConfiguracion = 'cuenta' | 'empresa' | 'preferencias' | 'suscripcion' | 'usuarios';
const PESTANAS: readonly PestanaDeConfiguracion[] = ['cuenta', 'empresa', 'preferencias', 'suscripcion', 'usuarios'];

export type Ruta =
  | { pantalla: 'inicio' }
  | { pantalla: 'presupuestos' }
  | { pantalla: 'mesa'; id: string }
  | { pantalla: 'recursos' }
  | { pantalla: 'apu' }
  | { pantalla: 'configuracion'; pestana?: PestanaDeConfiguracion }
  | { pantalla: 'recuperar'; token: string }
  | { pantalla: 'activar'; token: string }
  | { pantalla: 'no-existe' };

export function leerRuta(hash: string): Ruta {
  const [camino = '', consulta = ''] = hash.replace(/^#/, '').split('?');
  const partes = camino.split('/').filter((p) => p !== '');
  const [primera, segunda] = partes;

  if (partes.length === 0) return { pantalla: 'inicio' };
  // «Proyectos» desde el 6 de octubre de 2026; «presupuestos» sigue abriendo,
  // para que un enlace guardado antes no quede roto.
  const esProyectos = primera === 'proyectos' || primera === 'presupuestos';
  if (esProyectos && partes.length === 1) return { pantalla: 'presupuestos' };
  if (esProyectos && segunda !== undefined && partes.length === 2) {
    return { pantalla: 'mesa', id: decodeURIComponent(segunda) };
  }
  if (primera === 'recursos' && partes.length === 1) return { pantalla: 'recursos' };
  if (primera === 'apu' && partes.length === 1) return { pantalla: 'apu' };
  if (primera === 'configuracion' && partes.length === 1) return { pantalla: 'configuracion' };
  if (primera === 'configuracion' && partes.length === 2) {
    const pestana = PESTANAS.find((p) => p === segunda);
    return pestana ? { pantalla: 'configuracion', pestana } : { pantalla: 'no-existe' };
  }
  if (primera === 'recuperar' && partes.length === 1) {
    return { pantalla: 'recuperar', token: new URLSearchParams(consulta).get('token') ?? '' };
  }
  // El enlace de activación de un usuario invitado (CONTRATO §11.4).
  if (primera === 'activar' && partes.length === 1) {
    return { pantalla: 'activar', token: new URLSearchParams(consulta).get('token') ?? '' };
  }
  return { pantalla: 'no-existe' };
}

export function enlaceA(ruta: Ruta): string {
  switch (ruta.pantalla) {
    case 'inicio': return '#/';
    case 'presupuestos': return '#/proyectos';
    case 'mesa': return `#/proyectos/${encodeURIComponent(ruta.id)}`;
    case 'recursos': return '#/recursos';
    case 'apu': return '#/apu';
    case 'configuracion': return ruta.pestana ? `#/configuracion/${ruta.pestana}` : '#/configuracion';
    case 'recuperar': return `#/recuperar?token=${encodeURIComponent(ruta.token)}`;
    case 'activar': return `#/activar?token=${encodeURIComponent(ruta.token)}`;
    case 'no-existe': return '#/';
  }
}

export function ir(ruta: Ruta): void {
  window.location.hash = enlaceA(ruta);
}

/**
 * Cambia la dirección sin dejar la anterior en el historial: para salir de una
 * pantalla a la que no tiene sentido volver con «atrás», como el enlace de
 * restablecimiento ya usado.
 */
export function reemplazar(ruta: Ruta): void {
  window.history.replaceState(null, '', enlaceA(ruta));
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function useRuta(): Ruta {
  const [ruta, setRuta] = useState(() => leerRuta(window.location.hash));
  useEffect(() => {
    const alCambiar = () => {
      setRuta(leerRuta(window.location.hash));
      // Al cambiar de pantalla se empieza arriba, como en una página nueva.
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', alCambiar);
    return () => window.removeEventListener('hashchange', alCambiar);
  }, []);
  return ruta;
}
