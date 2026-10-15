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

/**
 * Una tarjeta de Configuración. `accion` va arriba a la derecha, frente al
 * título (el botón principal de la tarjeta o una cifra destacada).
 */
export function Seccion({ titulo, children, ayuda, accion }: { titulo: string; children?: ReactNode; ayuda?: string; accion?: ReactNode }) {
  return (
    <section className="tarjeta seccion-de-config">
      {accion ? (
        <div className="seccion-de-config-cabecera">
          <div>
            <h2>{titulo}</h2>
            {ayuda ? <p className="campo-ayuda">{ayuda}</p> : null}
          </div>
          {accion}
        </div>
      ) : (
        <>
          <h2>{titulo}</h2>
          {ayuda ? <p className="campo-ayuda">{ayuda}</p> : null}
        </>
      )}
      {children}
    </section>
  );
}

/*
 * La organización de Configuración (pedido del dueño, 15 de octubre de 2026):
 * arriba, una tarjeta a lo ancho que resume la pestaña en fichas; debajo, las
 * tarjetas de trabajo en dos columnas. Las fichas solo muestran datos que la
 * pestaña ya tiene: resumen, no información nueva.
 */
export function Fichas({ datos }: { datos: { etiqueta: string; valor: ReactNode }[] }) {
  return (
    <dl className="fichas-de-config">
      {datos.map((d) => (
        <div key={d.etiqueta} className="ficha-de-config">
          <dt>{d.etiqueta}</dt>
          <dd>{d.valor}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Dos columnas cuando hay ancho; una sola en una ventana angosta. */
export function DosColumnas({ children }: { children: ReactNode }) {
  return <div className="config-dos-columnas">{children}</div>;
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

