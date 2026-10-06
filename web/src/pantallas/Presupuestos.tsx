import { useEffect, useRef, useState } from 'react';
import { conConsulta, ErrorDeApi, pedir } from '../api/cliente.ts';
import type { EstadoPresupuesto, FilaDePresupuesto } from '../api/tipos.ts';
import { BotonVolver } from '../cascaron/Cascaron.tsx';
import { Icono } from '../componentes/Icono.tsx';
import { InsigniaDeEstado } from '../componentes/Insignia.tsx';
import { formatearFecha, formatearFechaYHora, paraAtributo } from '../fechas.ts';
import { formatearNumero } from '../formato.ts';
import { enlaceA, ir } from '../navegacion.ts';
import { useSesion } from '../sesion.tsx';
import { CrearPresupuesto } from './CrearPresupuesto.tsx';

/*
 * 02 §7 · Vista maestra de presupuestos.
 *
 * Buscar y filtrar los hace el servidor (CONTRATO §3.2): la búsqueda por nombre
 * pasa por fn_buscar_presupuesto, que usa el índice (CLAUDE.md, regla 5), y el
 * orden de las filas es el que llega. La pantalla no filtra ni ordena por su
 * cuenta.
 */

type Carga =
  | { fase: 'cargando'; anteriores: FilaDePresupuesto[] | null }
  | { fase: 'lista'; filas: FilaDePresupuesto[] }
  | { fase: 'error'; mensaje: string };

const ESPERA_AL_ESCRIBIR_MS = 250;

export function Presupuestos() {
  const { arranque, puedeEscribir } = useSesion();
  const formato = arranque.formatoNumerico;

  const [texto, setTexto] = useState('');
  const [textoBuscado, setTextoBuscado] = useState('');
  const [estado, setEstado] = useState<EstadoPresupuesto | ''>('');
  const [archivados, setArchivados] = useState(false);
  const [carga, setCarga] = useState<Carga>({ fase: 'cargando', anteriores: null });
  const [intento, setIntento] = useState(0);
  const [creando, setCreando] = useState(false);
  const [vista, setVista] = useState<Vista>(vistaGuardada);

  // Escribir no dispara una petición por tecla: espera a que la persona pare.
  useEffect(() => {
    const espera = window.setTimeout(() => setTextoBuscado(texto.trim()), ESPERA_AL_ESCRIBIR_MS);
    return () => window.clearTimeout(espera);
  }, [texto]);

  const ultimaPeticion = useRef(0);
  useEffect(() => {
    // Si llegan dos respuestas, vale la de la última petición, no la última en
    // llegar: una búsqueda lenta no puede pisar a una más nueva.
    const esta = ++ultimaPeticion.current;
    setCarga((c) => ({ fase: 'cargando', anteriores: c.fase === 'lista' ? c.filas : c.fase === 'cargando' ? c.anteriores : null }));
    const ruta = conConsulta('/api/presupuestos', {
      texto: textoBuscado,
      estado: estado === '' ? undefined : estado,
      archivados: archivados ? 'true' : undefined,
    });
    pedir<FilaDePresupuesto[]>(ruta)
      .then((filas) => {
        if (esta !== ultimaPeticion.current) return;
        setCarga({ fase: 'lista', filas });
      })
      .catch((e: unknown) => {
        if (esta !== ultimaPeticion.current) return;
        // Un 401 ya lo atiende el cliente: lleva al ingreso.
        if (e instanceof ErrorDeApi && e.estado === 401) return;
        setCarga({ fase: 'error', mensaje: e instanceof ErrorDeApi ? e.message : 'Algo falló al leer la lista.' });
      });
  }, [textoBuscado, estado, archivados, intento]);

  const hayFiltros = textoBuscado !== '' || estado !== '';
  const filas = carga.fase === 'lista' ? carga.filas : carga.fase === 'cargando' ? carga.anteriores : null;
  const puedeCrear = puedeEscribir('PRESUPUESTOS.CREAR');

  function limpiarFiltros() {
    setTexto('');
    setTextoBuscado('');
    setEstado('');
  }

  return (
    <>
      <div className="encabezado-de-pantalla">
        <div className="encabezado-con-volver">
          <BotonVolver a={{ pantalla: 'inicio' }} nombre="Inicio" />
          <h1>Proyectos</h1>
        </div>
        {puedeCrear ? (
          <button type="button" className="boton boton-principal" onClick={() => setCreando(true)}>
            <Icono nombre="mas" />
            Crear Nuevo Proyecto
          </button>
        ) : null}
      </div>

      <div className="barra-de-filtros" role="search">
        <div className="campo campo-buscar">
          <label htmlFor="buscar-presupuesto">Buscar por nombre o código</label>
          <div className="control-con-icono">
            <Icono nombre="buscar" />
            <input
              id="buscar-presupuesto"
              type="search"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              autoComplete="off"
            />
          </div>
        </div>
        <div className="campo">
          <label htmlFor="filtro-estado">Estado</label>
          <select id="filtro-estado" value={estado} onChange={(e) => setEstado(e.target.value as EstadoPresupuesto | '')}>
            <option value="">Todos</option>
            <option value="ABIERTO">Abierto</option>
            <option value="ACTIVO">Activo</option>
            <option value="CERRADO">Cerrado</option>
          </select>
        </div>
        <label className="casilla">
          <input type="checkbox" checked={archivados} onChange={(e) => setArchivados(e.target.checked)} />
          <span>Ver archivados</span>
        </label>
      </div>

      <div className="conmutador-de-vista" role="group" aria-label="Cómo mostrar los proyectos">
        {(['tarjetas', 'lista'] as const).map((v) => (
          <button key={v} type="button" className="boton boton-secundario boton-chico-texto" aria-pressed={vista === v}
                  onClick={() => { setVista(v); guardarVista(v); }}>
            <Icono nombre={v === 'tarjetas' ? 'rejilla' : 'menu'} tamano={16} />
            {v === 'tarjetas' ? 'Tarjetas' : 'Lista'}
          </button>
        ))}
      </div>

      {/* Anuncia el resultado a quien usa lector, sin robarle el foco. */}
      <p className="solo-lectores" role="status" aria-live="polite">
        {carga.fase === 'lista' ? describirResultado(carga.filas.length, archivados) : ''}
      </p>

      {carga.fase === 'error' ? (
        <div className="aviso-error" role="alert">
          <Icono nombre="aviso" />
          <span>{carga.mensaje}</span>
          <button type="button" className="boton boton-secundario" onClick={() => setIntento((n) => n + 1)}>
            Reintentar
          </button>
        </div>
      ) : filas === null ? (
        <TablaEsqueleto />
      ) : filas.length === 0 && carga.fase === 'lista' ? (
        <Vacio archivados={archivados} hayFiltros={hayFiltros} puedeCrear={puedeCrear} alLimpiar={limpiarFiltros} />
      ) : vista === 'tarjetas' ? (
        <ul className="rejilla-de-proyectos" aria-busy={carga.fase === 'cargando'} aria-label={archivados ? 'Proyectos archivados' : 'Proyectos'}>
          {filas.map((p) => <TarjetaDeProyecto key={p.id} proyecto={p} />)}
        </ul>
      ) : (
        <div className="tarjeta tarjeta-tabla" aria-busy={carga.fase === 'cargando'}>
          <table className="tabla tabla-presupuestos">
            <caption className="solo-lectores">
              {archivados ? 'Proyectos archivados' : 'Proyectos'}
            </caption>
            <thead>
              <tr>
                <th scope="col">Código</th>
                <th scope="col">Nombre del proyecto</th>
                <th scope="col" className="col-secundaria">Ubicación</th>
                <th scope="col" className="col-secundaria">Moneda</th>
                <th scope="col" className="col-secundaria">Elaboración</th>
                <th scope="col" className="col-secundaria">Última modificación</th>
                <th scope="col">Estado</th>
                <th scope="col" className="cifra">Valor total</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((p) => (
                // La fila entera abre la mesa con el ratón; el teclado y el
                // lector llegan por el enlace del código, que es el control real.
                <tr key={p.id} className="fila-que-abre" onClick={(e) => {
                  if ((e.target as HTMLElement).closest('a')) return;
                  ir({ pantalla: 'mesa', id: p.id });
                }}>
                  <td className="col-codigo">
                    <a href={enlaceA({ pantalla: 'mesa', id: p.id })}>{p.codigo}</a>
                  </td>
                  <td className="col-nombre">
                    {p.nombre}
                    {p.archivadoEn ? (
                      <span className="dato-de-apoyo">
                        Archivado el <time dateTime={paraAtributo(p.archivadoEn)}>{formatearFecha(p.archivadoEn)}</time>
                      </span>
                    ) : null}
                  </td>
                  <td className="col-secundaria">{p.ubicacion}</td>
                  <td className="col-secundaria">{p.moneda}</td>
                  <td className="col-secundaria">
                    <time dateTime={paraAtributo(p.fechaElaboracion)} title={formatearFechaYHora(p.fechaElaboracion)}>
                      {formatearFecha(p.fechaElaboracion)}
                    </time>
                  </td>
                  <td className="col-secundaria">
                    <time dateTime={paraAtributo(p.fechaModificacion)} title={formatearFechaYHora(p.fechaModificacion)}>
                      {formatearFecha(p.fechaModificacion)}
                    </time>
                  </td>
                  <td><InsigniaDeEstado estado={p.estado} /></td>
                  <td className="cifra">{formatearNumero(p.valorTotal, formato)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creando ? (
        <CrearPresupuesto
          alCerrar={() => setCreando(false)}
          alCrear={(id) => {
            setCreando(false);
            // 02 §7.1: «cierra el pop-out y redirige de inmediato a la mesa».
            ir({ pantalla: 'mesa', id });
          }}
        />
      ) : null}
    </>
  );
}

/*
 * Tarjetas por defecto (decisión del dueño, 6 de octubre de 2026): con muchos
 * proyectos, una lista de filas iguales cansa. La lista sigue a un clic para
 * quien quiera comparar cifras en columna. La elección se recuerda en este
 * navegador; si el almacenamiento no está, vuelve a tarjetas.
 */
type Vista = 'tarjetas' | 'lista';
const CLAVE_VISTA = 'construsoft.vistaProyectos';

function vistaGuardada(): Vista {
  try {
    return window.localStorage.getItem(CLAVE_VISTA) === 'lista' ? 'lista' : 'tarjetas';
  } catch {
    return 'tarjetas';
  }
}

function guardarVista(v: Vista) {
  try {
    window.localStorage.setItem(CLAVE_VISTA, v);
  } catch {
    // Sin almacenamiento, la elección dura lo que dure la pestaña.
  }
}

/** Un proyecto como tarjeta: la tarjeta entera es el enlace a su mesa. */
function TarjetaDeProyecto({ proyecto: p }: { proyecto: FilaDePresupuesto }) {
  const { arranque } = useSesion();
  return (
    <li>
      <a className="tarjeta-de-proyecto" href={enlaceA({ pantalla: 'mesa', id: p.id })} data-estado={p.estado}>
        <span className="tarjeta-de-proyecto-arriba">
          <span className="cifra-codigo">{p.codigo}</span>
          <InsigniaDeEstado estado={p.estado} />
        </span>
        <span className="tarjeta-de-proyecto-nombre">{p.nombre}</span>
        <span className="tarjeta-de-proyecto-lugar">{p.ubicacion}</span>
        <span className="tarjeta-de-proyecto-valor">
          <span className="etiqueta-chica">Valor total</span>
          <span className="cifra">{p.moneda} {formatearNumero(p.valorTotal, arranque.formatoNumerico)}</span>
        </span>
        <span className="tarjeta-de-proyecto-pie">
          <span>
            Modificado el <time dateTime={paraAtributo(p.fechaModificacion)}>{formatearFecha(p.fechaModificacion)}</time>
          </span>
          {p.archivadoEn ? (
            <span>
              Archivado el <time dateTime={paraAtributo(p.archivadoEn)}>{formatearFecha(p.archivadoEn)}</time>
            </span>
          ) : (
            <span>{p.modoEstructura === 'WBS' ? 'Por EDT' : 'Por ítems'}</span>
          )}
        </span>
      </a>
    </li>
  );
}

function describirResultado(n: number, archivados: boolean): string {
  const que = archivados ? (n === 1 ? 'proyecto archivado' : 'proyectos archivados') : n === 1 ? 'proyecto' : 'proyectos';
  return n === 0 ? `Ningún ${archivados ? 'proyecto archivado' : 'proyecto'}.` : `${n} ${que}.`;
}

function Vacio({
  archivados,
  hayFiltros,
  puedeCrear,
  alLimpiar,
}: {
  archivados: boolean;
  hayFiltros: boolean;
  puedeCrear: boolean;
  alLimpiar: () => void;
}) {
  // Un vacío dice por qué está vacío y qué hacer (DISENO §8).
  if (hayFiltros) {
    return (
      <div className="vacio">
        <p className="vacio-titulo">Ningún proyecto coincide con la búsqueda.</p>
        <p>Pruebe con otra parte del nombre o del código, o quite el filtro de estado.</p>
        <button type="button" className="boton boton-secundario" onClick={alLimpiar}>
          Quitar la búsqueda y los filtros
        </button>
      </div>
    );
  }
  if (archivados) {
    return (
      <div className="vacio">
        <p className="vacio-titulo">No hay proyectos archivados.</p>
        <p>Un proyecto se archiva desde su mesa de trabajo, con «Archivar proyecto».</p>
      </div>
    );
  }
  return (
    <div className="vacio">
      <p className="vacio-titulo">Todavía no hay proyectos.</p>
      <p>
        {puedeCrear
          ? 'Empiece el primero con «Crear Nuevo Proyecto», arriba a la derecha.'
          : 'Cuando alguien de su empresa cree uno, aparecerá aquí.'}
      </p>
    </div>
  );
}

/** Mientras llega la primera respuesta: la forma de la tabla, sin datos (DISENO §9). */
function TablaEsqueleto() {
  return (
    <div className="tarjeta tarjeta-tabla" aria-busy="true">
      <p className="solo-lectores">Cargando los proyectos…</p>
      <div className="esqueleto" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="esqueleto-fila">
            <span /><span /><span /><span />
          </div>
        ))}
      </div>
    </div>
  );
}
