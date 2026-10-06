import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icono } from './Icono.tsx';

/*
 * La capa superpuesta: el esqueleto de este producto (DISENO §8, 02 §2).
 *
 * Crear y editar nunca cambian de pantalla: abren una capa encima. Está hecha
 * sobre <dialog> con showModal(), que ya trae del navegador tres de las reglas
 * de DISENO §8 y no hay que reimplementarlas:
 *   - lo de atrás queda inerte: el foco no puede salir de la capa;
 *   - la capa va en la capa superior del navegador, encima de todo;
 *   - varias abiertas se apilan, y la de arriba es la que recibe el teclado.
 *
 * Lo que se agrega acá:
 *   - Escape cierra solo la de arriba, y si tiene cambios sin guardar, pregunta.
 *   - Cada capa pregunta por SUS cambios: cerrar la de recursos no toca lo
 *     escrito en la del APU de abajo (02 §6.2).
 *   - Al cerrarse, el foco vuelve al control que la abrió.
 *   - El error de la operación va arriba, con role="alert".
 *
 * Se abre al montarse y se cierra al desmontarse: quien la usa decide si
 * existe, y la capa no guarda un «abierta» propio que pueda desincronizarse.
 */

interface Props {
  titulo: string;
  /** Cerrar sin guardar. Lo llaman la X, el Escape y «Cancelar». */
  alCerrar: () => void;
  /** Si es verdadero, cerrar pregunta antes de descartar. */
  hayCambios: boolean;
  /** El error de la operación —no el de un campo—, que va arriba. */
  error?: string | null;
  /**
   * Los botones de abajo. El principal dice qué hace: «Guardar APU», no
   * «Aceptar». Reciben `cerrar`, que es lo mismo que la X: si hay cambios,
   * pregunta. Un «Cancelar» lo usa y no tiene que reimplementar la pregunta.
   */
  acciones: (cerrar: () => void) => ReactNode;
  children: ReactNode;
  /** El formulario que envuelve el contenido, para que Enter envíe. */
  alEnviar?: () => void;
}

export function Capa({ titulo, alCerrar, hayCambios, error = null, acciones, children, alEnviar }: Props) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const idTitulo = useId();
  const [confirmando, setConfirmando] = useState(false);
  const botonSeguir = useRef<HTMLButtonElement>(null);
  const zonaDeError = useRef<HTMLDivElement>(null);

  // Las funciones cambian en cada render; el efecto de montaje lee la última.
  const ultimo = useRef({ hayCambios, alCerrar, confirmando });
  ultimo.current = { hayCambios, alCerrar, confirmando };

  useEffect(() => {
    const elemento = dialogo.current;
    if (!elemento) return;
    // Quien la abrió, para devolverle el foco al cerrar.
    const abridor = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    elemento.showModal();
    // showModal() enfoca el primer control del diálogo, que es la X de la
    // cabecera. El foco va al primer campo del formulario: es donde se empieza
    // a escribir. Sin campos, se queda en la X.
    elemento.querySelector<HTMLElement>('.capa-cuerpo :is(input, select, textarea):not([disabled])')?.focus();
    return () => {
      elemento.close();
      if (abridor?.isConnected) abridor.focus();
    };
  }, []);

  useEffect(() => {
    if (confirmando) botonSeguir.current?.focus();
  }, [confirmando]);

  // Un error nuevo de la operación se lleva el desplazamiento arriba, para que
  // quien está al final del formulario lo vea; role="alert" lo anuncia.
  useEffect(() => {
    if (error) zonaDeError.current?.scrollIntoView({ block: 'nearest' });
  }, [error]);

  function intentarCerrar() {
    const { hayCambios: cambios, alCerrar: cerrar, confirmando: preguntando } = ultimo.current;
    if (preguntando) {
      // Escape sobre la pregunta es «no, sigo editando», nunca «descartar».
      setConfirmando(false);
      return;
    }
    if (cambios) setConfirmando(true);
    else cerrar();
  }

  const contenido = (
    <>
      <div className="capa-cuerpo">
        <div ref={zonaDeError}>
          {error ? (
            <p className="aviso-error" role="alert">
              <Icono nombre="aviso" />
              <span>{error}</span>
            </p>
          ) : null}
        </div>
        {children}
      </div>
      <div className="capa-pie">
        {confirmando ? (
          <div className="capa-pregunta" role="group" aria-label="Cambios sin guardar">
            <p>Tiene cambios sin guardar. Si cierra ahora, se pierden.</p>
            <div className="fila-de-botones">
              <button type="button" className="boton boton-peligroso" onClick={() => ultimo.current.alCerrar()}>
                Descartar cambios
              </button>
              <button type="button" ref={botonSeguir} className="boton boton-secundario" onClick={() => setConfirmando(false)}>
                Seguir editando
              </button>
            </div>
          </div>
        ) : (
          <div className="fila-de-botones">{acciones(intentarCerrar)}</div>
        )}
      </div>
    </>
  );

  return (
    <dialog
      ref={dialogo}
      className="capa"
      aria-labelledby={idTitulo}
      // Escape se maneja acá y no se deja al navegador: el navegador cerraría
      // el diálogo sin preguntar, y desde Chrome 120 un segundo Escape cierra
      // aunque se cancele el evento. stopPropagation: Escape cierra solo la
      // capa de arriba, nunca la pila (DISENO §8).
      onKeyDown={(evento) => {
        if (evento.key !== 'Escape') return;
        evento.preventDefault();
        evento.stopPropagation();
        intentarCerrar();
      }}
      onCancel={(evento) => {
        evento.preventDefault();
        intentarCerrar();
      }}
    >
      <div className="capa-cabecera">
        <h2 id={idTitulo}>{titulo}</h2>
        <button type="button" className="boton-icono" aria-label="Cerrar sin guardar" onClick={intentarCerrar}>
          <Icono nombre="cerrar" />
        </button>
      </div>
      {alEnviar ? (
        <form
          className="capa-formulario"
          noValidate
          onSubmit={(evento) => {
            evento.preventDefault();
            if (!confirmando) alEnviar();
          }}
        >
          {contenido}
        </form>
      ) : (
        <div className="capa-formulario">{contenido}</div>
      )}
    </dialog>
  );
}
