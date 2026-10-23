import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Icono } from './Icono.tsx';

/*
 * Ver la estructura hasta un nivel (pedido del dueño, 22 de octubre de 2026),
 * en la mesa y en el cronograma. Es como los niveles de esquema de Excel o de
 * Project: el nivel N muestra las filas que están a N niveles o menos de la
 * raíz. Los capítulos de primer nivel son el 1; lo que cuelga de ellos, el 2;
 * y así. Las actividades cuentan como un nivel más que su capítulo, así que el
 * último nivel lo muestra todo.
 *
 * Cuántos niveles hay sale de la estructura: con capítulos, subcapítulos y
 * actividades son tres; sin subcapítulos, dos.
 *
 * Todo vive en el estado de la pantalla: elegir un nivel es calcular qué filas
 * quedan plegadas. No llama a la API ni guarda nada.
 */

/** Una fila que se puede plegar, con su profundidad: 1 es la raíz. */
export interface NodoPlegable {
  clave: string;
  profundidad: number;
}

/** Lo que queda plegado al ver hasta el nivel n: todo nodo a n niveles o más. */
export function plegadosHasta(nodos: readonly NodoPlegable[], n: number): Set<string> {
  return new Set(nodos.filter((x) => x.profundidad >= n).map((x) => x.clave));
}

/** El nivel que muestran unos plegados, o null si no coinciden con ninguno. */
export function nivelDe(nodos: readonly NodoPlegable[], plegados: ReadonlySet<string>, niveles: number): number | null {
  const iguales = (a: Set<string>) => a.size === plegados.size && [...a].every((x) => plegados.has(x));
  for (let n = 1; n <= niveles; n += 1) if (iguales(plegadosHasta(nodos, n))) return n;
  return null;
}

interface Props {
  /** Cuántos niveles tiene la estructura, contando las actividades. */
  niveles: number;
  /** El nivel que se ve, o null si el usuario plegó o desplegó filas a mano. */
  actual: number | null;
  alElegir: (n: number) => void;
}

export function ControlDeNiveles({ niveles, actual, alElegir }: Props) {
  const id = useId();
  if (niveles < 2) return null;
  const lista = Array.from({ length: niveles }, (_, i) => i + 1);
  // Un select nativo (pedido del dueño, 23 de octubre de 2026): «Nivel 1 ⌄».
  // Con filas plegadas a mano no hay nivel: el select muestra un guion.
  return (
    <div className="control-de-niveles">
      <label className="selector-de-nivel" htmlFor={id}>
        <span className="selector-de-nivel-etiqueta">Nivel</span>
        <select
          id={id}
          value={actual === null ? '' : String(actual)}
          onChange={(e) => {
            const n = lista.find((x) => String(x) === e.target.value);
            if (n !== undefined) alElegir(n);
          }}
        >
          {actual === null ? <option value="" disabled>—</option> : null}
          {lista.map((n) => <option key={n} value={String(n)} title={n === niveles ? "Todo, con las actividades" : undefined}>{n}</option>)}
        </select>
        <Icono nombre="bajar" tamano={14} />
      </label>
      <MenuDeEstructura alExpandir={() => alElegir(niveles)} alContraer={() => alElegir(1)} />
    </div>
  );
}

/*
 * El menú de los tres puntos: «Expandir todo» y «Contraer todo». Es un menú
 * de verdad para el teclado y el lector de pantalla: las flechas recorren las
 * opciones, Escape lo cierra y devuelve el foco al botón, y un clic afuera lo
 * cierra.
 */
function MenuDeEstructura({ alExpandir, alContraer }: { alExpandir: () => void; alContraer: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!abierto) return;
    raiz.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const afuera = (e: PointerEvent) => {
      if (!(e.target instanceof Node) || !raiz.current?.contains(e.target)) setAbierto(false);
    };
    document.addEventListener('pointerdown', afuera);
    return () => document.removeEventListener('pointerdown', afuera);
  }, [abierto]);

  const cerrar = () => {
    setAbierto(false);
    boton.current?.focus();
  };
  const elegir = (accion: () => void) => {
    accion();
    cerrar();
  };

  function alTeclear(e: KeyboardEvent<HTMLDivElement>) {
    const items = [...(raiz.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = items.findIndex((x) => x === document.activeElement);
    const ir = (j: number) => items[(j + items.length) % items.length]?.focus();
    if (e.key === 'ArrowDown') { e.preventDefault(); ir(i + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); ir(i - 1); }
    else if (e.key === 'Home') { e.preventDefault(); ir(0); }
    else if (e.key === 'End') { e.preventDefault(); ir(items.length - 1); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(); }
    else if (e.key === 'Tab') setAbierto(false);
  }

  return (
    <div className="menu-de-estructura" ref={raiz}>
      <button
        ref={boton}
        type="button"
        className="boton-icono boton-de-menu"
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-controls={abierto ? id : undefined}
        aria-label="Más opciones de la estructura"
        title="Expandir o contraer todo"
        onClick={() => setAbierto((a) => !a)}
      >
        <Icono nombre="masOpciones" tamano={16} />
      </button>
      {abierto ? (
        <div id={id} role="menu" aria-label="Más opciones de la estructura" className="menu-desplegable" onKeyDown={alTeclear}>
          <button type="button" role="menuitem" tabIndex={-1} onClick={() => elegir(alExpandir)}>
            <Icono nombre="expandir" tamano={14} />
            Expandir todo
          </button>
          <button type="button" role="menuitem" tabIndex={-1} onClick={() => elegir(alContraer)}>
            <Icono nombre="contraer" tamano={14} />
            Contraer todo
          </button>
        </div>
      ) : null}
    </div>
  );
}
