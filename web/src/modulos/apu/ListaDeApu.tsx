import { useEffect, useRef, useState } from 'react';
import { conConsulta, ErrorDeApi, pedir } from '../../api/cliente.ts';
import type { ApuDeLista, Unidad } from '../../api/tipos.ts';
import { useAvisos } from '../../componentes/Avisos.tsx';
import { BotonVolver } from '../../cascaron/Cascaron.tsx';
import { Icono } from '../../componentes/Icono.tsx';
import { formatearNumero } from '../../formato.ts';
import { useSesion } from '../../sesion.tsx';
import { TablaEsqueleto } from '../comun/TablaEsqueleto.tsx';
import { FormularioDeApu } from './FormularioDeApu.tsx';

/*
 * 02 §6.1 · Vista maestra de APU: el inventario completo, incluidos los
 * inactivos, con búsqueda en tiempo real por nombre o código y filtro por
 * unidad. Abrir uno CONSULTA; editar es un botón adentro (02 §6.3).
 */

const ESPERA_MS = 250;

export function ListaDeApu() {
  const { arranque, puedeEscribir } = useSesion();
  const { avisar } = useAvisos();
  const formato = arranque.formatoNumerico;
  const [texto, setTexto] = useState('');
  const [textoBuscado, setTextoBuscado] = useState('');
  const [unidadId, setUnidadId] = useState('');
  const [unidades, setUnidades] = useState<Unidad[]>([]);
  const [filas, setFilas] = useState<ApuDeLista[] | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);
  const [abierto, setAbierto] = useState<{ id?: string } | null>(null);

  useEffect(() => {
    pedir<{ unidades: Unidad[] }>(conConsulta('/api/unidades', { para: 'APU' }))
      .then((r) => setUnidades(r.unidades))
      .catch(() => setUnidades([]));
  }, []);

  useEffect(() => {
    const espera = window.setTimeout(() => setTextoBuscado(texto.trim()), ESPERA_MS);
    return () => window.clearTimeout(espera);
  }, [texto]);

  const ultima = useRef(0);
  useEffect(() => {
    const esta = ++ultima.current;
    setCargando(true);
    pedir<{ apus: ApuDeLista[] }>(conConsulta('/api/apus', { texto: textoBuscado, unidadId: unidadId || undefined }))
      .then((r) => {
        if (esta !== ultima.current) return;
        setFilas(r.apus);
        setError(null);
        setCargando(false);
      })
      .catch((e: unknown) => {
        if (esta !== ultima.current || (e instanceof ErrorDeApi && e.estado === 401)) return;
        setError(e instanceof ErrorDeApi ? e.message : 'No se pudo leer el inventario de APU.');
        setCargando(false);
      });
  }, [textoBuscado, unidadId, intento]);

  const releer = () => setIntento((n) => n + 1);
  const hayFiltros = textoBuscado !== '' || unidadId !== '';

  return (
    <>
      <div className="encabezado-de-pantalla">
        <div className="encabezado-con-volver">
          <BotonVolver a={{ pantalla: 'inicio' }} nombre="Inicio" />
          <h1>APU</h1>
          <p className="bajada">Análisis de precios unitarios: cuánto cuesta ejecutar una unidad de cada actividad</p>
        </div>
        {puedeEscribir('APU.CREAR') ? (
          <button type="button" className="boton boton-principal" onClick={() => setAbierto({})}>
            <Icono nombre="mas" />
            Crear Nuevo APU
          </button>
        ) : null}
      </div>

      <div className="barra-de-filtros" role="search">
        <div className="campo campo-buscar">
          <label htmlFor="buscar-apu">Buscar por nombre o código</label>
          <div className="control-con-icono">
            <Icono nombre="buscar" />
            <input id="buscar-apu" type="search" autoComplete="off" value={texto} onChange={(e) => setTexto(e.target.value)} />
          </div>
        </div>
        <div className="campo">
          <label htmlFor="filtro-unidad-apu">Unidad de medida</label>
          <select id="filtro-unidad-apu" value={unidadId} onChange={(e) => setUnidadId(e.target.value)}>
            <option value="">Todas</option>
            {unidades.map((u) => <option key={u.id} value={u.id}>{u.simbolo} · {u.descripcion}</option>)}
          </select>
        </div>
      </div>

      {error ? (
        <div className="aviso-error" role="alert">
          <Icono nombre="aviso" />
          <span>{error}</span>
          <button type="button" className="boton boton-secundario" onClick={releer}>Reintentar</button>
        </div>
      ) : filas === null ? (
        <TablaEsqueleto texto="Cargando los APU…" />
      ) : filas.length === 0 ? (
        <div className="vacio">
          {hayFiltros ? (
            <>
              <p className="vacio-titulo">Ningún APU coincide con la búsqueda.</p>
              <p>Pruebe con otra parte del nombre o del código, o quite el filtro de unidad.</p>
            </>
          ) : (
            <>
              <p className="vacio-titulo">Todavía no hay APU.</p>
              <p>
                {puedeEscribir('APU.CREAR')
                  ? 'Un APU se arma con recursos del catálogo. Empiece con «Crear Nuevo APU».'
                  : 'Cuando alguien de su empresa cree uno, aparecerá aquí.'}
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="tarjeta tarjeta-tabla" aria-busy={cargando}>
          <table className="tabla tabla-apu">
            <caption className="solo-lectores">APU</caption>
            <thead>
              <tr>
                <th scope="col">Código</th>
                <th scope="col">Actividad</th>
                <th scope="col">Unidad</th>
                <th scope="col">Estado</th>
                <th scope="col" className="cifra">Costo directo</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((a) => (
                <tr key={a.id} className="fila-que-abre" onClick={(e) => {
                  if ((e.target as HTMLElement).closest('button')) return;
                  setAbierto({ id: a.id });
                }}>
                  <td className="col-codigo">
                    <button type="button" className="enlace-de-fila" onClick={() => setAbierto({ id: a.id })}>{a.codigo}</button>
                  </td>
                  <td className="col-nombre">{a.nombre}</td>
                  <td>{a.unidadSimbolo}</td>
                  <td>
                    <span className="insignia" data-estado={a.activo ? 'ACTIVO' : 'CERRADO'}>{a.activo ? 'Activo' : 'Inactivo'}</span>
                  </td>
                  <td className="cifra">{formatearNumero(a.costoDirecto, formato)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {abierto ? (
        <FormularioDeApu
          apuId={abierto.id}
          alCerrar={() => setAbierto(null)}
          alGuardar={(_a, aviso) => {
            setAbierto(null);
            avisar(aviso);
            releer();
          }}
          alCambiar={(aviso) => {
            avisar(aviso);
            releer();
          }}
        />
      ) : null}
    </>
  );
}
