import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

/*
 * Los avisos breves de «ya está»: «Versión 3 guardada», «Presupuesto
 * archivado». No son errores —esos van en la capa o junto al campo— y no
 * piden respuesta: aparecen, se anuncian a quien usa lector y se van solos.
 */

interface ContextoDeAvisos {
  avisar: (texto: string) => void;
}

const Contexto = createContext<ContextoDeAvisos>({ avisar: () => undefined });

export function useAvisos(): ContextoDeAvisos {
  return useContext(Contexto);
}

const DURACION_MS = 5000;

export function ProveedorDeAvisos({ children }: { children: ReactNode }) {
  const [texto, setTexto] = useState<string | null>(null);
  const reloj = useRef<number | undefined>(undefined);

  const avisar = useCallback((nuevo: string) => {
    window.clearTimeout(reloj.current);
    setTexto(nuevo);
    reloj.current = window.setTimeout(() => setTexto(null), DURACION_MS);
  }, []);

  return (
    <Contexto.Provider value={{ avisar }}>
      {children}
      {/* La región existe siempre: un lector solo anuncia cambios en una
          región viva que ya estaba en la página. */}
      <div className="aviso-breve" role="status" aria-live="polite" data-visible={texto ? 'si' : 'no'}>
        {texto}
      </div>
    </Contexto.Provider>
  );
}
