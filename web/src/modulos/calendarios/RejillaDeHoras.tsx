import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useSesion } from '../../sesion.tsx';
import { BLOQUES, contar, horaDeBloque, horasDeBloques, type Dia } from './tramos.ts';

/*
 * La tabla de un calendario: días por horas, en bloques de 30 minutos, donde
 * se marca qué se trabaja (07 §6.2, RF-CFG-29). Es la de P6.
 *
 * Con el mouse se pinta arrastrando: el primer bloque decide si se marca o se
 * desmarca, y el resto del arrastre hace lo mismo. Con el teclado es una
 * cuadrícula: una sola celda en el orden del tabulador, las flechas mueven,
 * Inicio y Fin van al principio y al final del día, y Espacio o Enter cambian
 * el bloque. Cada celda dice su día, su media hora y si se trabaja, así que un
 * lector de pantalla no depende del color.
 */

interface Fila {
  etiqueta: string;
  dia: Dia;
}

interface Props {
  titulo: string;
  filas: Fila[];
  alCambiar?: ((fila: number, dia: Dia) => void) | undefined;
  /** Sin alCambiar, o con esto, la tabla solo se mira. */
  soloLectura?: boolean;
}

export function RejillaDeHoras({ titulo, filas, alCambiar, soloLectura = false }: Props) {
  const decimal = useSesion().arranque.formatoNumerico.separadorDecimal;
  const quieta = soloLectura || !alCambiar;
  const [foco, setFoco] = useState<[number, number]>([0, 14]);
  const pintando = useRef<{ fila: number; valor: boolean } | null>(null);
  const rejilla = useRef<HTMLDivElement>(null);

  function poner(fila: number, bloque: number, valor: boolean) {
    const f = filas[fila];
    if (!f || !alCambiar || f.dia[bloque] === valor) return;
    const nuevo = [...f.dia];
    nuevo[bloque] = valor;
    alCambiar(fila, nuevo);
  }

  function enfocar(fila: number, bloque: number) {
    setFoco([fila, bloque]);
    window.requestAnimationFrame(() => rejilla.current?.querySelector<HTMLElement>(`[data-celda="${fila}-${bloque}"]`)?.focus());
  }

  function alTeclear(e: KeyboardEvent, fila: number, bloque: number) {
    const mover: Record<string, [number, number]> = {
      ArrowRight: [fila, Math.min(BLOQUES - 1, bloque + 1)],
      ArrowLeft: [fila, Math.max(0, bloque - 1)],
      ArrowDown: [Math.min(filas.length - 1, fila + 1), bloque],
      ArrowUp: [Math.max(0, fila - 1), bloque],
      Home: [fila, 0],
      End: [fila, BLOQUES - 1],
    };
    const destino = mover[e.key];
    if (destino) {
      e.preventDefault();
      enfocar(destino[0], destino[1]);
      return;
    }
    if ((e.key === ' ' || e.key === 'Enter') && !quieta) {
      e.preventDefault();
      poner(fila, bloque, !(filas[fila]?.dia[bloque] ?? false));
    }
  }

  function alApretar(e: PointerEvent, fila: number, bloque: number) {
    if (quieta || e.button !== 0) return;
    e.preventDefault();
    const valor = !(filas[fila]?.dia[bloque] ?? false);
    pintando.current = { fila, valor };
    setFoco([fila, bloque]);
    poner(fila, bloque, valor);
    // El arrastre sigue aunque el puntero salga de la celda.
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }

  function alPasar(e: PointerEvent, fila: number, bloque: number) {
    const p = pintando.current;
    if (!p || (e.buttons & 1) === 0) {
      pintando.current = null;
      return;
    }
    // Se pinta en la fila donde está el puntero: arrastrar en diagonal pinta varios días.
    poner(fila, bloque, p.valor);
  }

  return (
    <div className="rejilla-de-horas-marco">
      <div
        ref={rejilla}
        className="rejilla-de-horas"
        role="grid"
        aria-label={titulo}
        aria-readonly={quieta}
        data-quieta={quieta ? 'si' : 'no'}
        onPointerUp={() => (pintando.current = null)}
        onPointerLeave={() => (pintando.current = null)}
      >
        <div role="row" className="rejilla-fila rejilla-encabezado">
          <span role="columnheader" className="rejilla-dia">Día</span>
          {Array.from({ length: BLOQUES / 2 }, (_, h) => (
            <span key={h} role="columnheader" className="rejilla-hora" aria-label={`${horaDeBloque(h * 2)} a ${horaDeBloque(h * 2 + 2)}`}>
              {h}
            </span>
          ))}
          <span role="columnheader" className="rejilla-total">Horas</span>
        </div>
        {filas.map((f, i) => (
          <div role="row" className="rejilla-fila" key={f.etiqueta}>
            <span role="rowheader" className="rejilla-dia">{f.etiqueta}</span>
            {f.dia.map((marcado, b) => (
              <span
                key={b}
                role="gridcell"
                data-celda={`${i}-${b}`}
                className="rejilla-celda"
                data-marcada={marcado ? 'si' : 'no'}
                data-hora-entera={b % 2 === 0 ? 'si' : 'no'}
                aria-selected={marcado}
                aria-label={`${f.etiqueta}, ${horaDeBloque(b)} a ${horaDeBloque(b + 1)}: ${marcado ? 'se trabaja' : 'no se trabaja'}`}
                tabIndex={foco[0] === i && foco[1] === b ? 0 : -1}
                onKeyDown={(e) => alTeclear(e, i, b)}
                onPointerDown={(e) => alApretar(e, i, b)}
                onPointerEnter={(e) => alPasar(e, i, b)}
                onFocus={() => setFoco([i, b])}
              />
            ))}
            <span role="gridcell" className="rejilla-total cifra">{horasDeBloques(contar(f.dia)).replace('.', decimal)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
