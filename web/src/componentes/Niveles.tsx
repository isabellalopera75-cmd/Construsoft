import { useId } from 'react';
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
  return (
    <div className="control-de-niveles">
      <span className="control-de-niveles-etiqueta" id={id}>Nivel</span>
      <div className="conmutador" role="group" aria-labelledby={id}>
        {lista.map((n) => (
          <button
            key={n}
            type="button"
            className="conmutador-opcion conmutador-cifra"
            aria-pressed={actual === n}
            title={n === niveles ? `Nivel ${n}: todo, con las actividades` : `Nivel ${n}`}
            onClick={() => alElegir(n)}
          >
            {n}
          </button>
        ))}
      </div>
      <button type="button" className="boton boton-secundario boton-chico-texto" onClick={() => alElegir(niveles)}>
        <Icono nombre="expandir" tamano={16} />
        Expandir todo
      </button>
      <button type="button" className="boton boton-secundario boton-chico-texto" onClick={() => alElegir(1)}>
        <Icono nombre="contraer" tamano={16} />
        Contraer todo
      </button>
    </div>
  );
}
