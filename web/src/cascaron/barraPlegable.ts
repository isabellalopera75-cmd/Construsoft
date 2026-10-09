import { useEffect, useState } from 'react';

/*
 * La barra lateral plegable (decisión del dueño, 9 de octubre de 2026), para
 * los dos marcos: el de las empresas y el del superadministrador. La elección
 * se recuerda en el navegador; entre 641 y 1024 px va siempre plegada porque
 * abierta no cabe, y ahí no se ofrece el botón.
 */

const CLAVE_BARRA = 'construsoft.barraPlegada';

function leerPreferencia(): boolean {
  try {
    return window.localStorage.getItem(CLAVE_BARRA) === 'si';
  } catch {
    return false;
  }
}

function guardarPreferencia(plegada: boolean): void {
  try {
    window.localStorage.setItem(CLAVE_BARRA, plegada ? 'si' : 'no');
  } catch {
    // Sin almacenamiento, la barra se pliega igual; solo no se recuerda.
  }
}

/** ¿La ventana mide entre 641 y 1024 px? Ahí la barra va siempre plegada. */
function useVentanaMediana(): boolean {
  const consulta = '(min-width: 641px) and (max-width: 1024px)';
  const [mediana, setMediana] = useState(() => window.matchMedia(consulta).matches);
  useEffect(() => {
    const lista = window.matchMedia(consulta);
    const alCambiar = () => setMediana(lista.matches);
    lista.addEventListener('change', alCambiar);
    return () => lista.removeEventListener('change', alCambiar);
  }, []);
  return mediana;
}

export function useBarraPlegable(): { plegada: boolean; mediana: boolean; alternarBarra: () => void } {
  const [preferida, setPreferida] = useState(leerPreferencia);
  const mediana = useVentanaMediana();
  return {
    plegada: mediana || preferida,
    mediana,
    alternarBarra: () => {
      const nueva = !preferida;
      setPreferida(nueva);
      guardarPreferencia(nueva);
    },
  };
}
