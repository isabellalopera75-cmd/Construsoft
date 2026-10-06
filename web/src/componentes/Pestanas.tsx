import { useRef, type KeyboardEvent } from 'react';

/*
 * Pestañas con el patrón de la WAI-ARIA: una sola pestaña está en el orden del
 * tabulador, y las flechas, Inicio y Fin se mueven entre ellas. Cada pestaña
 * puede llevar un conteo («Materiales 10»).
 */

export interface Pestana<T extends string> {
  id: T;
  nombre: string;
  conteo?: number | undefined;
}

interface Props<T extends string> {
  etiqueta: string;
  pestanas: readonly Pestana<T>[];
  actual: T;
  alCambiar: (id: T) => void;
  /** Prefijo de los id, para enlazar cada pestaña con su panel. */
  idBase: string;
}

export function Pestanas<T extends string>({ etiqueta, pestanas, actual, alCambiar, idBase }: Props<T>) {
  const lista = useRef<HTMLDivElement>(null);

  function alTeclear(evento: KeyboardEvent) {
    const i = pestanas.findIndex((p) => p.id === actual);
    let siguiente: number | null = null;
    if (evento.key === 'ArrowRight') siguiente = (i + 1) % pestanas.length;
    if (evento.key === 'ArrowLeft') siguiente = (i - 1 + pestanas.length) % pestanas.length;
    if (evento.key === 'Home') siguiente = 0;
    if (evento.key === 'End') siguiente = pestanas.length - 1;
    if (siguiente === null) return;
    evento.preventDefault();
    const destino = pestanas[siguiente];
    if (!destino) return;
    alCambiar(destino.id);
    window.requestAnimationFrame(() => lista.current?.querySelector<HTMLElement>(`#${idBase}-${destino.id}`)?.focus());
  }

  return (
    <div className="pestanas" role="tablist" aria-label={etiqueta} ref={lista} onKeyDown={alTeclear}>
      {pestanas.map((p) => (
        <button
          key={p.id}
          type="button"
          role="tab"
          id={`${idBase}-${p.id}`}
          aria-selected={p.id === actual}
          aria-controls={`${idBase}-panel`}
          tabIndex={p.id === actual ? 0 : -1}
          className="pestana"
          onClick={() => alCambiar(p.id)}
        >
          <span>{p.nombre}</span>
          {p.conteo === undefined ? null : <span className="pestana-conteo">{p.conteo}</span>}
        </button>
      ))}
    </div>
  );
}
