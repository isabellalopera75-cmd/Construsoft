import type { ActividadDeMesa, Mesa, NodoDeMesa } from '../../api/tipos.ts';

/*
 * El árbol de la mesa se arma acá a partir de los dos arreglos planos
 * (CONTRATO §4.1): se agrupa por padreId —o nodoId, para una actividad— y se
 * ordena por `posicion`, que manda el servidor. Nunca se ordena por el texto
 * del código: «1.10» iría antes de «1.2».
 *
 * Nodos y actividades comparten el contador de su padre (D-42), así que bajo
 * un mismo padre se intercalan por esa misma posición.
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
  for (const lista of hijos.values()) lista.sort((a, b) => posicionDe(a) - posicionDe(b));
  return { raices, hijos };
}

export function posicionDe(hijo: Hijo): number {
  return hijo.tipo === 'nodo' ? hijo.nodo.posicion : hijo.actividad.posicion;
}

/** Cuántos hermanos tiene una fila, contándose: el tope para «bajar». */
export function cuantosHermanos(arbol: Arbol, padreId: string | null): number {
  return padreId === null ? arbol.raices.length : (arbol.hijos.get(padreId)?.length ?? 0);
}

