import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ErrorDeApi } from '../api/cliente.ts';
import { Icono } from './Icono.tsx';

/*
 * Un buscador con lista desplegable, con el patrón «combobox» de la WAI-ARIA:
 * el foco se queda en el campo, las flechas recorren las opciones y Enter
 * elige. Lo usan «+ Agregar Actividad» de la mesa (02 §8.3) y el vínculo de
 * recursos del APU (02 §6.2).
 *
 * Busca el servidor, no la pantalla: la búsqueda por nombre pasa por las
 * funciones fn_buscar_* que usan el índice (CLAUDE.md, regla 5).
 *
 * Al final de la lista puede ir una acción —«+ Crear Nuevo APU»— para cuando
 * lo buscado no existe. Se ofrece siempre que haya texto, no solo cuando no
 * hay resultados: que aparezcan parecidos no quiere decir que esté el que se
 * buscaba.
 */

interface Props<T> {
  etiqueta: string;
  /** Visible arriba del campo o solo para lectores. */
  etiquetaVisible?: boolean;
  buscar: (texto: string) => Promise<T[]>;
  clave: (opcion: T) => string;
  pintar: (opcion: T) => ReactNode;
  alElegir: (opcion: T) => void;
  accionExtra?: { texto: (buscado: string) => string; alElegir: (buscado: string) => void } | undefined;
  ayuda?: string;
  deshabilitada?: (opcion: T) => string | null;
  idDelCampo?: string;
}

const ESPERA_MS = 220;

export function Buscador<T>({
  etiqueta,
  etiquetaVisible = true,
  buscar,
  clave,
  pintar,
  alElegir,
  accionExtra,
  ayuda,
  deshabilitada,
  idDelCampo,
}: Props<T>) {
  const idBase = useId();
  const idCampo = idDelCampo ?? `${idBase}-campo`;
  const idLista = `${idBase}-lista`;
  const [texto, setTexto] = useState('');
  const [opciones, setOpciones] = useState<T[]>([]);
  const [estado, setEstado] = useState<'quieto' | 'buscando' | 'listo' | 'error'>('quieto');
  const [mensajeError, setMensajeError] = useState('');
  const [abierta, setAbierta] = useState(false);
  const [activa, setActiva] = useState(-1);
  const ultima = useRef(0);
  const buscarActual = useRef(buscar);
  buscarActual.current = buscar;

  useEffect(() => {
    const buscado = texto.trim();
    if (buscado === '') {
      setOpciones([]);
      setEstado('quieto');
      return;
    }
    const esta = ++ultima.current;
    setEstado('buscando');
    const espera = window.setTimeout(() => {
      buscarActual
        .current(buscado)
        .then((encontradas) => {
          if (esta !== ultima.current) return;
          setOpciones(encontradas);
          setEstado('listo');
          setActiva(encontradas.length > 0 ? 0 : -1);
        })
        .catch((e: unknown) => {
          if (esta !== ultima.current) return;
          setEstado('error');
          setMensajeError(e instanceof ErrorDeApi ? e.message : 'No se pudo buscar. Intente de nuevo.');
        });
    }, ESPERA_MS);
    return () => window.clearTimeout(espera);
  }, [texto]);

  const conExtra = accionExtra !== undefined && texto.trim() !== '';
  const total = opciones.length + (conExtra ? 1 : 0);

  function elegir(i: number) {
    const opcion = opciones[i];
    if (opcion !== undefined) {
      if (deshabilitada?.(opcion)) return;
      alElegir(opcion);
      setTexto('');
      setAbierta(false);
      return;
    }
    if (conExtra && i === opciones.length) {
      accionExtra.alElegir(texto.trim());
      setAbierta(false);
    }
  }

  const mostrarLista = abierta && texto.trim() !== '';

  return (
    <div className="buscador campo">
      <label htmlFor={idCampo} className={etiquetaVisible ? undefined : 'solo-lectores'}>
        {etiqueta}
      </label>
      <div className="control-con-icono">
        <Icono nombre="buscar" />
        <input
          id={idCampo}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-expanded={mostrarLista}
          aria-controls={idLista}
          aria-autocomplete="list"
          aria-activedescendant={mostrarLista && activa >= 0 ? `${idBase}-op-${activa}` : undefined}
          aria-describedby={ayuda ? `${idBase}-ayuda` : undefined}
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            setAbierta(true);
          }}
          onFocus={() => setAbierta(true)}
          onBlur={() => window.setTimeout(() => setAbierta(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setAbierta(true);
              setActiva((a) => (total === 0 ? -1 : (a + 1) % total));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActiva((a) => (total === 0 ? -1 : (a - 1 + total) % total));
            } else if (e.key === 'Enter') {
              if (mostrarLista && activa >= 0) {
                e.preventDefault();
                elegir(activa);
              }
            } else if (e.key === 'Escape' && mostrarLista) {
              // La primera Escape cierra la lista; la siguiente es de la capa.
              e.preventDefault();
              e.stopPropagation();
              setAbierta(false);
            }
          }}
        />
      </div>
      {ayuda ? <p id={`${idBase}-ayuda`} className="campo-ayuda">{ayuda}</p> : null}
      <ul id={idLista} role="listbox" aria-label={etiqueta} className="buscador-lista" hidden={!mostrarLista}>
        {estado === 'buscando' && opciones.length === 0 ? <li className="buscador-nota" role="presentation">Buscando…</li> : null}
        {estado === 'error' ? <li className="buscador-nota" role="presentation">{mensajeError}</li> : null}
        {estado === 'listo' && opciones.length === 0 ? (
          <li className="buscador-nota" role="presentation">Nada coincide con «{texto.trim()}».</li>
        ) : null}
        {opciones.map((opcion, i) => {
          const motivo = deshabilitada?.(opcion) ?? null;
          return (
            <li
              key={clave(opcion)}
              id={`${idBase}-op-${i}`}
              role="option"
              aria-selected={i === activa}
              aria-disabled={motivo ? true : undefined}
              className="buscador-opcion"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => elegir(i)}
              onMouseEnter={() => setActiva(i)}
            >
              {pintar(opcion)}
              {motivo ? <span className="dato-de-apoyo">{motivo}</span> : null}
            </li>
          );
        })}
        {conExtra ? (
          <li
            id={`${idBase}-op-${opciones.length}`}
            role="option"
            aria-selected={activa === opciones.length}
            className="buscador-opcion buscador-extra"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => elegir(opciones.length)}
            onMouseEnter={() => setActiva(opciones.length)}
          >
            <Icono nombre="mas" />
            {accionExtra.texto(texto.trim())}
          </li>
        ) : null}
      </ul>
    </div>
  );
}
