import { useEffect, useState, type ReactNode } from 'react';
import { ErrorDeApi, pedir } from '../../api/cliente.ts';
import { Icono } from '../../componentes/Icono.tsx';

/* Las piezas que comparten las pestañas de Configuración. */

/** Carga una pestaña con su propio estado de carga y error. */
export function useLectura<T>(ruta: string): { datos: T | null; error: string | null; releer: () => void; poner: (d: T) => void } {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vez, setVez] = useState(0);
  useEffect(() => {
    let vigente = true;
    pedir<T>(ruta)
      .then((d) => vigente && (setDatos(d), setError(null)))
      .catch((e: unknown) => {
        if (vigente && !(e instanceof ErrorDeApi && e.estado === 401)) setError(e instanceof ErrorDeApi ? e.message : 'No se pudo leer esta sección.');
      });
    return () => {
      vigente = false;
    };
  }, [ruta, vez]);
  return { datos, error, releer: () => setVez((n) => n + 1), poner: setDatos };
}

export function Seccion({ titulo, children, ayuda }: { titulo: string; children: ReactNode; ayuda?: string }) {
  return (
    <section className="tarjeta seccion-de-config">
      <h2>{titulo}</h2>
      {ayuda ? <p className="campo-ayuda">{ayuda}</p> : null}
      {children}
    </section>
  );
}

export function ErrorDeSeccion({ mensaje, alReintentar }: { mensaje: string; alReintentar: () => void }) {
  return (
    <div className="aviso-error" role="alert">
      <Icono nombre="aviso" />
      <span>{mensaje}</span>
      <button type="button" className="boton boton-secundario" onClick={alReintentar}>Reintentar</button>
    </div>
  );
}

