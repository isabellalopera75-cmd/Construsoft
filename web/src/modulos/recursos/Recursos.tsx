import { useEffect, useRef, useState } from 'react';
import { conConsulta, ErrorDeApi, pedir } from '../../api/cliente.ts';
import type { Recurso, TipoRecurso, Unidad } from '../../api/tipos.ts';
import { useAvisos } from '../../componentes/Avisos.tsx';
import { BotonVolver } from '../../cascaron/Cascaron.tsx';
import { Icono } from '../../componentes/Icono.tsx';
import { Pestanas } from '../../componentes/Pestanas.tsx';
import { leerCifra, soloCifra } from '../../entrada.ts';
import { formatearNumero } from '../../formato.ts';
import { useSesion } from '../../sesion.tsx';
import { FormularioDeRecurso, NOMBRES_DE_TIPO } from './FormularioDeRecurso.tsx';
import { ImportarExcel } from '../comun/ImportarExcel.tsx';
import { TablaEsqueleto } from '../comun/TablaEsqueleto.tsx';

/*
 * 02 §5.1 · Vista maestra de Recursos.
 *
 * Cuatro pestañas fijas y «Todos los recursos». Escribir en el buscador ROMPE
 * la pestaña: se muestran todos los recursos relacionados sin importar su
 * tipo. Eso es la pantalla dejando de mandar `tipo` cuando hay texto (CONTRATO
 * §5), no un filtro que se hace acá.
 */

type Pestana = TipoRecurso | 'TODOS';

const PESTANAS: { id: Pestana; nombre: string }[] = [
  { id: 'MATERIAL', nombre: 'Materiales' },
  { id: 'EQUIPO', nombre: 'Equipos' },
  { id: 'PERSONAL', nombre: 'Personal' },
  { id: 'ACTIVIDAD_TODO_COSTO', nombre: 'Actividades (todo costo)' },
  { id: 'TODOS', nombre: 'Todos los recursos' },
];

const ESPERA_MS = 250;

type Capa = { tipo: 'crear'; tipoInicial?: TipoRecurso } | { tipo: 'editar'; recurso: Recurso } | null;

export function Recursos() {
  const { arranque, puedeEscribir } = useSesion();
  const { avisar } = useAvisos();
  const formato = arranque.formatoNumerico;

  const [pestana, setPestana] = useState<Pestana>('TODOS');
  const [texto, setTexto] = useState('');
  const [textoBuscado, setTextoBuscado] = useState('');
  const [unidadId, setUnidadId] = useState('');
  const [precioMin, setPrecioMin] = useState('');
  const [precioMax, setPrecioMax] = useState('');
  const [rango, setRango] = useState<{ min?: string; max?: string; error?: string }>({});
  const [unidades, setUnidades] = useState<Unidad[]>([]);
  const [filas, setFilas] = useState<Recurso[] | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);
  const [capa, setCapa] = useState<Capa>(null);
  const [importando, setImportando] = useState(false);

  useEffect(() => {
    pedir<{ unidades: Unidad[] }>('/api/unidades').then((r) => setUnidades(r.unidades)).catch(() => setUnidades([]));
  }, []);

  useEffect(() => {
    const espera = window.setTimeout(() => setTextoBuscado(texto.trim()), ESPERA_MS);
    return () => window.clearTimeout(espera);
  }, [texto]);

  // El rango se valida al escribir, pero viaja solo cuando es una cifra.
  useEffect(() => {
    const espera = window.setTimeout(() => {
      const nuevo: typeof rango = {};
      for (const [clave, valor] of [['min', precioMin], ['max', precioMax]] as const) {
        if (valor.trim() === '') continue;
        const l = leerCifra(valor, { nombre: 'el precio' });
        if ('error' in l) nuevo.error = l.error;
        else nuevo[clave] = l.valor;
      }
      setRango(nuevo);
    }, ESPERA_MS);
    return () => window.clearTimeout(espera);
  }, [precioMin, precioMax]);

  const ultima = useRef(0);
  useEffect(() => {
    if (rango.error) return;
    const esta = ++ultima.current;
    setCargando(true);
    const ruta = conConsulta('/api/recursos', {
      // Con texto, la pestaña se rompe: no se manda el tipo (02 §5.1).
      tipo: textoBuscado === '' && pestana !== 'TODOS' ? pestana : undefined,
      texto: textoBuscado,
      unidadId: unidadId || undefined,
      precioMin: rango.min,
      precioMax: rango.max,
    });
    pedir<{ recursos: Recurso[] }>(ruta)
      .then((r) => {
        if (esta !== ultima.current) return;
        setFilas(r.recursos);
        setError(null);
        setCargando(false);
      })
      .catch((e: unknown) => {
        if (esta !== ultima.current || (e instanceof ErrorDeApi && e.estado === 401)) return;
        setError(e instanceof ErrorDeApi ? e.message : 'No se pudo leer el catálogo de recursos.');
        setCargando(false);
      });
  }, [pestana, textoBuscado, unidadId, rango, intento]);

  const pestanaRota = textoBuscado !== '';
  const puedeCrear = puedeEscribir('RECURSOS.CREAR');
  const nombrePestana = PESTANAS.find((p) => p.id === pestana)?.nombre ?? '';
  const hayFiltros = textoBuscado !== '' || unidadId !== '' || precioMin !== '' || precioMax !== '';

  return (
    <>
      <div className="encabezado-de-pantalla">
        <div className="encabezado-con-volver">
          <BotonVolver a={{ pantalla: 'inicio' }} nombre="Inicio" />
          <h1>Recursos</h1>
          <p className="bajada">Catálogo maestro de materiales, equipos, personal y actividades a todo costo</p>
        </div>
        <div className="acciones-de-encabezado">
          {puedeCrear ? (
            <button type="button" className="boton boton-secundario" onClick={() => setImportando(true)}>
              <Icono nombre="subirArchivo" />
              Importar desde Excel
            </button>
          ) : null}
          {puedeCrear ? (
            <button type="button" className="boton boton-principal" onClick={() => setCapa({ tipo: 'crear' })}>
              <Icono nombre="mas" />
              Crear Nuevo Recurso
            </button>
          ) : null}
        </div>
      </div>

      <div className="barra-de-filtros" role="search">
        <div className="campo campo-buscar">
          <label htmlFor="buscar-recurso">Buscar por código o nombre, en todos los tipos</label>
          <div className="control-con-icono">
            <Icono nombre="buscar" />
            <input id="buscar-recurso" type="search" autoComplete="off" value={texto} onChange={(e) => setTexto(e.target.value)} />
          </div>
        </div>
        <div className="campo">
          <label htmlFor="filtro-unidad">Unidad</label>
          <select id="filtro-unidad" value={unidadId} onChange={(e) => setUnidadId(e.target.value)}>
            <option value="">Todas</option>
            {unidades.map((u) => <option key={u.id} value={u.id}>{u.simbolo}</option>)}
          </select>
        </div>
        <div className="campo campo-rango">
          <span className="etiqueta" id="etiqueta-rango">Precio total</span>
          <div className="control-rango" role="group" aria-labelledby="etiqueta-rango">
            <label className="etiqueta-en-linea">
              Desde
              <input inputMode="decimal" value={precioMin} onChange={(e) => setPrecioMin(soloCifra(e.target.value, formato.separadorDecimal))} />
            </label>
            <label className="etiqueta-en-linea">
              hasta
              <input inputMode="decimal" value={precioMax} onChange={(e) => setPrecioMax(soloCifra(e.target.value, formato.separadorDecimal))} />
            </label>
          </div>
          {rango.error ? <p className="campo-error" role="alert">{rango.error}</p> : null}
        </div>
      </div>

      <div className="fila-de-pestanas" data-rota={pestanaRota ? 'si' : undefined}>
        <Pestanas
          etiqueta="Tipo de recurso"
          idBase="pestana-recursos"
          pestanas={PESTANAS}
          actual={pestana}
          alCambiar={(p) => {
            setPestana(p);
            // Elegir una pestaña con la búsqueda escrita no haría nada visible:
            // la búsqueda la rompe. Se limpia para que la pestaña se vea.
            if (texto !== '') {
              setTexto('');
              setTextoBuscado('');
            }
          }}
        />
        {pestana !== 'TODOS' && !pestanaRota && puedeCrear ? (
          <button type="button" className="boton boton-secundario" onClick={() => setCapa({ tipo: 'crear', tipoInicial: pestana })}>
            <Icono nombre="mas" />
            {`Crear en ${nombrePestana}`}
          </button>
        ) : null}
      </div>
      {pestanaRota ? (
        <p className="nota-de-filtro" role="status">
          Mostrando resultados de todos los tipos para «{textoBuscado}». Borre la búsqueda para volver a la pestaña.
        </p>
      ) : null}

      <div id="pestana-recursos-panel" role="tabpanel" aria-labelledby={`pestana-recursos-${pestana}`}>
        {error ? (
          <div className="aviso-error" role="alert">
            <Icono nombre="aviso" />
            <span>{error}</span>
            <button type="button" className="boton boton-secundario" onClick={() => setIntento((n) => n + 1)}>Reintentar</button>
          </div>
        ) : filas === null ? (
          <TablaEsqueleto texto="Cargando los recursos…" />
        ) : filas.length === 0 ? (
          <div className="vacio">
            {hayFiltros ? (
              <>
                <p className="vacio-titulo">Ningún recurso coincide con la búsqueda.</p>
                <p>Pruebe con otra parte del nombre o del código, o quite los filtros de unidad y precio.</p>
              </>
            ) : (
              <>
                <p className="vacio-titulo">{pestana === 'TODOS' ? 'Todavía no hay recursos.' : `Todavía no hay recursos en ${nombrePestana}.`}</p>
                <p>
                  {puedeCrear
                    ? 'Los recursos son la base de todo: sin ellos no se arma un APU. Empiece con «Crear Nuevo Recurso».'
                    : 'Cuando alguien de su empresa cree uno, aparecerá aquí.'}
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="tarjeta tarjeta-tabla" aria-busy={cargando}>
            <table className="tabla tabla-recursos">
              <caption className="solo-lectores">Recursos</caption>
              <thead>
                <tr>
                  <th scope="col">Código</th>
                  <th scope="col">Nombre</th>
                  <th scope="col" className="col-secundaria">Tipo</th>
                  <th scope="col">Unidad</th>
                  <th scope="col" className="cifra col-secundaria">Precio base</th>
                  <th scope="col" className="cifra col-secundaria">IVA %</th>
                  <th scope="col" className="cifra">Precio total</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((r) => (
                  <tr key={r.id} className="fila-que-abre" onClick={(e) => {
                    if ((e.target as HTMLElement).closest('button')) return;
                    setCapa({ tipo: 'editar', recurso: r });
                  }}>
                    <td className="col-codigo">
                      <button type="button" className="enlace-de-fila" onClick={() => setCapa({ tipo: 'editar', recurso: r })}>
                        {r.codigo}
                      </button>
                    </td>
                    <td className="col-nombre">
                      {r.nombre}
                      {!r.activo ? <span className="dato-de-apoyo">Inactivo</span> : null}
                    </td>
                    <td className="col-secundaria">{NOMBRES_DE_TIPO[r.tipo]}</td>
                    <td>{r.unidadSimbolo}</td>
                    <td className="cifra col-secundaria">{formatearNumero(r.precioBase, formato)}</td>
                    <td className="cifra col-secundaria">{formatearNumero(r.ivaPct, formato)}</td>
                    <td className="cifra">{formatearNumero(r.precioTotal, formato)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {importando ? (
        <ImportarExcel
          titulo="Importar recursos desde Excel"
          que="recursos"
          rutaPlantilla="/api/recursos/plantilla"
          rutaImportar="/api/recursos/importar"
          instrucciones={
            <>
              Una fila por recurso: nombre, tipo y unidad (de las listas desplegables) y <strong>uno solo</strong> de los dos
              precios —sin IVA o con IVA—; el otro lo calcula el sistema. IVA vacío es 0 %. El código no se escribe: lo
              asigna el sistema.
            </>
          }
          alCerrar={() => setImportando(false)}
          alImportar={(n) => {
            setImportando(false);
            avisar(n === 1 ? 'Se importó 1 recurso.' : `Se importaron ${n} recursos.`);
            setIntento((x) => x + 1);
          }}
        />
      ) : null}

      {capa ? (
        <FormularioDeRecurso
          recurso={capa.tipo === 'editar' ? capa.recurso : undefined}
          tipoInicial={capa.tipo === 'crear' ? capa.tipoInicial : undefined}
          alCerrar={() => setCapa(null)}
          alGuardar={(_r, aviso) => {
            setCapa(null);
            avisar(aviso);
            setIntento((n) => n + 1);
          }}
          alEliminar={(r) => {
            setCapa(null);
            avisar(`Recurso ${r.codigo} eliminado.`);
            setIntento((n) => n + 1);
          }}
        />
      ) : null}
    </>
  );
}
