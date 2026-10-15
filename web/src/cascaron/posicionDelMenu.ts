import { useSyncExternalStore } from 'react';

/*
 * Dónde va el menú de módulos (pedido del dueño, 15 de octubre de 2026): a la
 * izquierda, como siempre, o arriba, en la barra superior, para que cada
 * pantalla gane el ancho de la barra lateral. Cada quien lo elige en
 * Configuración › Mi cuenta, y el cambio se ve en el acto, sin «Guardar».
 *
 * Se recuerda en este navegador, como el tema y la barra plegada: es una
 * comodidad de pantalla, no un dato de la cuenta. Sin almacenamiento, el menú
 * vuelve a la izquierda la próxima vez. En el teléfono no aplica: allí el menú
 * es siempre el cajón del botón ☰.
 */

export type PosicionDelMenu = 'izquierda' | 'arriba';

const CLAVE = 'construsoft.posicionDelMenu';

function leerPosicion(): PosicionDelMenu {
  try {
    return window.localStorage.getItem(CLAVE) === 'arriba' ? 'arriba' : 'izquierda';
  } catch {
    return 'izquierda';
  }
}

let actual: PosicionDelMenu = leerPosicion();
const oyentes = new Set<() => void>();

export function cambiarPosicionDelMenu(posicion: PosicionDelMenu): void {
  actual = posicion;
  try {
    window.localStorage.setItem(CLAVE, posicion);
  } catch {
    // Sin almacenamiento, el cambio dura lo que dure la pestaña.
  }
  for (const oyente of oyentes) oyente();
}

function suscribir(oyente: () => void): () => void {
  oyentes.add(oyente);
  // Otra pestaña del mismo navegador cambió la preferencia: esta la sigue.
  const alGuardarEnOtra = (evento: StorageEvent) => {
    if (evento.key !== CLAVE) return;
    actual = leerPosicion();
    oyente();
  };
  window.addEventListener('storage', alGuardarEnOtra);
  return () => {
    oyentes.delete(oyente);
    window.removeEventListener('storage', alGuardarEnOtra);
  };
}

export function usePosicionDelMenu(): PosicionDelMenu {
  return useSyncExternalStore(suscribir, () => actual);
}
