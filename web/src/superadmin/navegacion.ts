import { useEffect, useState } from 'react';

/*
 * Las direcciones del panel, después del «#» como en la aplicación de las
 * empresas (navegacion.ts). El panel vive en /superadmin/, así que «#/» es su
 * resumen y no el inicio de una empresa.
 */

export type RutaDePlataforma =
  | { pantalla: 'resumen' }
  | { pantalla: 'empresas' }
  | { pantalla: 'empresa'; id: string }
  | { pantalla: 'pagos' }
  | { pantalla: 'bitacora' }
  | { pantalla: 'no-existe' };

export function leerRuta(hash: string): RutaDePlataforma {
  const [camino = ''] = hash.replace(/^#/, '').split('?');
  const partes = camino.split('/').filter((p) => p !== '');
  const [primera, segunda] = partes;
  if (partes.length === 0) return { pantalla: 'resumen' };
  if (primera === 'empresas' && partes.length === 1) return { pantalla: 'empresas' };
  if (primera === 'empresas' && segunda !== undefined && partes.length === 2) return { pantalla: 'empresa', id: decodeURIComponent(segunda) };
  if (primera === 'pagos' && partes.length === 1) return { pantalla: 'pagos' };
  if (primera === 'bitacora' && partes.length === 1) return { pantalla: 'bitacora' };
  return { pantalla: 'no-existe' };
}

export function enlaceA(ruta: RutaDePlataforma): string {
  switch (ruta.pantalla) {
    case 'resumen': return '#/';
    case 'empresas': return '#/empresas';
    case 'empresa': return `#/empresas/${encodeURIComponent(ruta.id)}`;
    case 'pagos': return '#/pagos';
    case 'bitacora': return '#/bitacora';
    case 'no-existe': return '#/';
  }
}

export function useRuta(): RutaDePlataforma {
  const [ruta, setRuta] = useState(() => leerRuta(window.location.hash));
  useEffect(() => {
    const alCambiar = () => {
      setRuta(leerRuta(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', alCambiar);
    return () => window.removeEventListener('hashchange', alCambiar);
  }, []);
  return ruta;
}
