import { useLayoutEffect, useRef, type InputHTMLAttributes } from 'react';
import { soloCifra } from '../entrada.ts';

/*
 * Un campo de precio o de monto que muestra los separadores de miles mientras
 * se escribe (pedido del dueño, 13 de octubre de 2026): se lee «142.577» y no
 * «142577».
 *
 * Los miles son SOLO de la pantalla. El valor que guarda quien usa el campo
 * sigue siendo el de siempre —dígitos y a lo sumo un separador decimal, lo que
 * deja `soloCifra`—, así que `leerCifra` y la API no cambian: a la API llega
 * «142577» (regla 1.1). Por eso el separador de miles que se escribe a mano se
 * descarta igual que antes, y el campo lo vuelve a poner donde va.
 *
 * El cursor se conserva: se cuenta cuántas cifras quedaban a su izquierda y se
 * lo pone después de esa misma cantidad en el texto con miles. Sin esto, cada
 * tecla lo mandaría al final.
 */

export interface SeparadoresDeCifra {
  separadorMiles: string;
  separadorDecimal: string;
}

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'inputMode'> & {
  /** Dígitos y a lo sumo un separador decimal, sin miles: lo que deja `soloCifra`. */
  valor: string;
  alCambiar: (valor: string) => void;
  formato: SeparadoresDeCifra;
};

/** «1234567,5» → «1.234.567,5», con los separadores de la empresa. */
export function conMiles(valor: string, formato: SeparadoresDeCifra): string {
  const i = valor.indexOf(formato.separadorDecimal);
  const entera = i === -1 ? valor : valor.slice(0, i);
  const resto = i === -1 ? '' : valor.slice(i);
  return entera.replace(/\B(?=(\d{3})+(?!\d))/g, formato.separadorMiles) + resto;
}

/** Cuántas cifras (y separador decimal) hay antes de la posición dada. */
function significativos(texto: string, hasta: number, decimal: string): number {
  let n = 0;
  for (const c of texto.slice(0, hasta)) if ((c >= '0' && c <= '9') || c === decimal) n += 1;
  return n;
}

/** La posición en `texto` justo después del significativo número `n`. */
function posicionTras(texto: string, n: number, decimal: string): number {
  if (n === 0) return 0;
  let vistos = 0;
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto.charAt(i);
    if ((c >= '0' && c <= '9') || c === decimal) vistos += 1;
    if (vistos === n) return i + 1;
  }
  return texto.length;
}

export function CampoDeCifra({ valor, alCambiar, formato, ...resto }: Props) {
  const campo = useRef<HTMLInputElement>(null);
  const cursor = useRef<number | null>(null);
  const visible = conMiles(valor, formato);

  useLayoutEffect(() => {
    const el = campo.current;
    if (el === null || cursor.current === null || document.activeElement !== el) return;
    el.setSelectionRange(cursor.current, cursor.current);
    cursor.current = null;
  });

  return (
    <input
      {...resto}
      ref={campo}
      inputMode="decimal"
      autoComplete="off"
      value={visible}
      onChange={(e) => {
        const escrito = e.target.value;
        const antes = significativos(escrito, e.target.selectionStart ?? escrito.length, formato.separadorDecimal);
        const nuevo = soloCifra(escrito, formato.separadorDecimal);
        cursor.current = posicionTras(conMiles(nuevo, formato), antes, formato.separadorDecimal);
        alCambiar(nuevo);
      }}
    />
  );
}
