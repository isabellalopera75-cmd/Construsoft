import { useSyncExternalStore } from 'react';

/*
 * El tamaño de la letra de toda la aplicación (pedido del dueño, 23 de octubre
 * de 2026): chica, mediana o grande. Cada quien lo elige en Configuración ›
 * Mi cuenta › Mi pantalla, y se ve en el acto, sin «Guardar».
 *
 * Cambia el tamaño de la letra raíz del <html> (`data-letra`), y como las
 * letras y los espacios de tokens.css van en rem, todo se agranda o se achica
 * junto. Grande es el tamaño de antes del 23 de octubre; mediana, un punto
 * menos, es la de partida, porque el dueño pidió la letra más chica en
 * general; chica, dos puntos menos.
 *
 * Se recuerda en este navegador, como el tema y la posición del menú: es una
 * comodidad de pantalla, no un dato de la cuenta.
 */

export type TamanoDeLetra = 'chica' | 'mediana' | 'grande';

const CLAVE = 'construsoft.letra';

function leer(): TamanoDeLetra {
  try {
    const v = window.localStorage.getItem(CLAVE);
    return v === 'chica' || v === 'grande' ? v : 'mediana';
  } catch {
    return 'mediana';
  }
}

let actual: TamanoDeLetra = leer();
const oyentes = new Set<() => void>();

function aplicar(t: TamanoDeLetra): void {
  document.documentElement.dataset['letra'] = t;
}

export function cambiarTamanoDeLetra(t: TamanoDeLetra): void {
  actual = t;
  aplicar(t);
  try {
    window.localStorage.setItem(CLAVE, t);
  } catch {
    // Sin almacenamiento, el cambio dura lo que dure la pestaña.
  }
  for (const oyente of oyentes) oyente();
}

/** Se llama antes de pintar nada, para que la letra no cambie de golpe. */
export function restaurarTamanoDeLetra(): void {
  aplicar(actual);
}

function suscribir(oyente: () => void): () => void {
  oyentes.add(oyente);
  // Otra pestaña del mismo navegador lo cambió: esta la sigue.
  const alGuardarEnOtra = (evento: StorageEvent) => {
    if (evento.key !== CLAVE) return;
    actual = leer();
    aplicar(actual);
    oyente();
  };
  window.addEventListener('storage', alGuardarEnOtra);
  return () => {
    oyentes.delete(oyente);
    window.removeEventListener('storage', alGuardarEnOtra);
  };
}

export function useTamanoDeLetra(): TamanoDeLetra {
  return useSyncExternalStore(suscribir, () => actual);
}
