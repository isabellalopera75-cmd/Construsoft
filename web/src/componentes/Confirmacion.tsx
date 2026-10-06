import { useState, type ReactNode } from 'react';
import { ErrorDeApi } from '../api/cliente.ts';
import { Campo } from './Campo.tsx';
import { Capa } from './Capa.tsx';

/*
 * Confirmar algo que no se deshace (DISENO §8, «Diálogos»): el texto dice qué
 * va a pasar, no «¿está seguro?», y el botón dice qué hace.
 *
 * Si la acción pide un texto obligatorio —la justificación de reabrir, el
 * motivo de eliminar o de guardar una versión—, el campo va adentro y el
 * botón no envía sin él.
 */

interface Props {
  titulo: string;
  children: ReactNode;
  /** El botón: «Activar proyecto», «Eliminar presupuesto». */
  textoConfirmar: string;
  textoEnviando?: string;
  peligroso?: boolean;
  /** Un texto obligatorio que viaja con la acción. */
  pideTexto?: { etiqueta: string; ayuda?: string; campo: string; vacio: string };
  alConfirmar: (texto: string) => Promise<void>;
  alCerrar: () => void;
}

export function Confirmacion({
  titulo,
  children,
  textoConfirmar,
  textoEnviando = 'Un momento…',
  peligroso = false,
  pideTexto,
  alConfirmar,
  alCerrar,
}: Props) {
  const [texto, setTexto] = useState('');
  const [errorDelCampo, setErrorDelCampo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function confirmar() {
    if (enviando) return;
    if (pideTexto && texto.trim() === '') {
      setErrorDelCampo(pideTexto.vacio);
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      await alConfirmar(texto.trim());
    } catch (e) {
      setEnviando(false);
      if (e instanceof ErrorDeApi && pideTexto && e.campo === pideTexto.campo) setErrorDelCampo(e.message);
      else setError(e instanceof ErrorDeApi ? e.message : 'Algo falló y no se hizo el cambio. Intente de nuevo.');
    }
  }

  return (
    <Capa
      titulo={titulo}
      alCerrar={alCerrar}
      hayCambios={texto.trim() !== ''}
      error={error}
      alEnviar={() => void confirmar()}
      acciones={(cerrar) => (
        <>
          <button type="button" className="boton boton-secundario" onClick={cerrar} disabled={enviando}>
            Cancelar
          </button>
          <button type="submit" className={`boton ${peligroso ? 'boton-peligroso' : 'boton-principal'}`} disabled={enviando}>
            {enviando ? textoEnviando : textoConfirmar}
          </button>
        </>
      )}
    >
      <div className="texto-de-dialogo">{children}</div>
      {pideTexto ? (
        <Campo etiqueta={pideTexto.etiqueta} {...(pideTexto.ayuda ? { ayuda: pideTexto.ayuda } : {})} error={errorDelCampo}>
          {(a) => (
            <textarea
              {...a}
              rows={3}
              value={texto}
              onChange={(e) => {
                setTexto(e.target.value);
                if (errorDelCampo) setErrorDelCampo(null);
              }}
            />
          )}
        </Campo>
      ) : null}
    </Capa>
  );
}
