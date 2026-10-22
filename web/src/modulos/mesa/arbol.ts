import type { ActividadDeMesa, Mesa, NodoDeMesa } from '../../api/tipos.ts';
import type { NodoPlegable } from '../../componentes/Niveles.tsx';

/*
 * El árbol de la mesa se arma acá a partir de los dos arreglos planos
 * (CONTRATO §4.1): se agrupa por padreId —o nodoId, para una actividad— y se
 * ordena por `posicion`, que manda el servidor. Nunca se ordena por el texto
 * del código: «1.10» iría antes de «1.2».
 *
 * Nodos y actividades comparten el contador de su padre (D-42), pero desde
 * D-75 (13 de octubre de 2026) los subcapítulos van siempre primero y las
 * actividades directas después. El servidor ya los manda así; se ordena aquí
 * también para que la pantalla no dependa de eso.
 */

export type Hijo = { tipo: 'nodo'; nodo: NodoDeMesa } | { tipo: 'actividad'; actividad: ActividadDeMesa };

export interface Arbol {
  raices: NodoDeMesa[];
  hijos: Map<string, Hijo[]>;
}

export function armarArbol(mesa: Mesa): Arbol {
  const hijos = new Map<string, Hijo[]>();
  const agregar = (padre: string, hijo: Hijo) => {
    const lista = hijos.get(padre);
    if (lista) lista.push(hijo);
    else hijos.set(padre, [hijo]);
  };
  const raices: NodoDeMesa[] = [];
  for (const nodo of mesa.nodos) {
    if (nodo.padreId === null) raices.push(nodo);
    else agregar(nodo.padreId, { tipo: 'nodo', nodo });
  }
  for (const actividad of mesa.actividades) agregar(actividad.nodoId, { tipo: 'actividad', actividad });

  raices.sort((a, b) => a.posicion - b.posicion);
  for (const lista of hijos.values()) lista.sort((a, b) => grupo(a) - grupo(b) || posicionDe(a) - posicionDe(b));
  return { raices, hijos };
}

const grupo = (hijo: Hijo) => (hijo.tipo === 'nodo' ? 0 : 1);

export function posicionDe(hijo: Hijo): number {
  return hijo.tipo === 'nodo' ? hijo.nodo.posicion : hijo.actividad.posicion;
}

/**
 * D-75 · Entre qué posiciones se puede mover una fila: un subcapítulo entre los
 * subcapítulos de su padre (1 … n), una actividad entre las actividades
 * (n + 1 … total). Las posiciones son las del contador compartido.
 */
export interface Limites {
  primera: number;
  ultima: number;
}

export function limitesDe(arbol: Arbol, padreId: string | null, tipo: Hijo['tipo']): Limites {
  if (padreId === null) return { primera: 1, ultima: arbol.raices.length };
  const hijos = arbol.hijos.get(padreId) ?? [];
  const nodos = hijos.filter((h) => h.tipo === 'nodo').length;
  return tipo === 'nodo' ? { primera: 1, ultima: nodos } : { primera: nodos + 1, ultima: hijos.length };
}


/**
 * Las filas que se pliegan, con su profundidad (1 es el capítulo de primer
 * nivel), y cuántos niveles tiene la mesa contando las actividades
 * (componentes/Niveles.tsx).
 */
export function nivelesDeLaMesa(arbol: Arbol): { nodos: NodoPlegable[]; niveles: number } {
  const nodos: NodoPlegable[] = [];
  let niveles = 1;
  const recorrer = (nodo: NodoDeMesa, profundidad: number) => {
    const hijos = arbol.hijos.get(nodo.id) ?? [];
    niveles = Math.max(niveles, profundidad);
    if (hijos.length > 0) nodos.push({ clave: nodo.id, profundidad });
    for (const h of hijos) {
      if (h.tipo === 'nodo') recorrer(h.nodo, profundidad + 1);
      else niveles = Math.max(niveles, profundidad + 1);
    }
  };
  for (const raiz of arbol.raices) recorrer(raiz, 1);
  return { nodos, niveles };
}
