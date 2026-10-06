import { useState } from 'react';
import { ErrorDeApi } from '../../api/cliente.ts';
import type { PresupuestoVinculado } from '../../api/tipos.ts';
import { Capa } from '../../componentes/Capa.tsx';

/*
 * La pregunta del 02 §5.3 y §6.4: al editar un recurso o un APU que está en
 * presupuestos ABIERTOS, ¿se actualizan? Una casilla por presupuesto, todas
 * marcadas al abrir. «Sí» reapunta los marcados; «No, solo para nuevos» no
 * reapunta ninguno. Con las dos respuestas el catálogo queda con el valor
 * nuevo (D-22): lo único que decide la respuesta es qué presupuestos se mueven.
 */

interface Props {
  titulo: string;
  pregunta: string;
  explicacion: string;
  presupuestos: PresupuestoVinculado[];
  alResponder: (elegidos: string[]) => Promise<void>;
  alCerrar: () => void;
}

export function ElegirPresupuestos({ titulo, pregunta, explicacion, presupuestos, alResponder, alCerrar }: Props) {
  const [marcados, setMarcados] = useState<Set<string>>(() => new Set(presupuestos.map((p) => p.id)));
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function responder(elegidos: string[]) {
    setEnviando(true);
    setError(null);
    try {
      await alResponder(elegidos);
    } catch (e) {
      setEnviando(false);
      setError(e instanceof ErrorDeApi ? e.message : 'Algo falló y no se guardó. Intente de nuevo.');
    }
  }

  return (
    <Capa
      titulo={titulo}
      alCerrar={alCerrar}
      hayCambios={false}
      error={error}
      acciones={() => (
        <>
          <button type="button" className="boton boton-secundario" disabled={enviando} onClick={() => void responder([])}>
            No, solo para nuevos
          </button>
          <button
            type="button"
            className="boton boton-principal"
            disabled={enviando || marcados.size === 0}
            onClick={() => void responder(presupuestos.filter((p) => marcados.has(p.id)).map((p) => p.id))}
          >
            {enviando ? 'Guardando…' : `Sí, actualizar ${marcados.size === presupuestos.length ? 'todos' : `${marcados.size}`}`}
          </button>
        </>
      )}
    >
      <p className="texto-de-dialogo"><strong>{pregunta}</strong></p>
      <fieldset className="grupo-sin-borde">
        <legend className="solo-lectores">Proyectos abiertos que lo usan</legend>
        <ul className="lista-de-casillas">
          {presupuestos.map((p) => (
            <li key={p.id}>
              <label className="casilla">
                <input
                  type="checkbox"
                  checked={marcados.has(p.id)}
                  onChange={(e) =>
                    setMarcados((m) => {
                      const nuevo = new Set(m);
                      if (e.target.checked) nuevo.add(p.id);
                      else nuevo.delete(p.id);
                      return nuevo;
                    })
                  }
                />
                <span>
                  <span className="cifra-codigo">{p.codigo}</span> {p.nombre}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <p className="campo-ayuda">{explicacion}</p>
    </Capa>
  );
}
