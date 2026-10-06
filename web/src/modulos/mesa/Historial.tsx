import { useEffect, useMemo, useState } from 'react';
import { conConsulta, ErrorDeApi, pedir } from '../../api/cliente.ts';
import type { Evento, TipoEvento } from '../../api/tipos.ts';
import { PanelLateral } from '../../componentes/PanelLateral.tsx';
import { formatearFechaYHora, paraAtributo } from '../../fechas.ts';

/*
 * 02 §10.2 · El historial de cambios, en un panel lateral, del más reciente al
 * más antiguo, con filtros por fechas, tipo de evento y usuario.
 *
 * Lo escribe la base (D-45) y no se edita: el panel no ofrece ningún control
 * sobre un evento, ni siquiera al Administrador.
 *
 * Los usuarios del filtro salen de los eventos de ese presupuesto: no hay —ni
 * hace falta— una lista de usuarios de la empresa para esto.
 */

/** Las descripciones de app.tipo_evento, en palabras de quien lee. */
export const NOMBRES_DE_EVENTO: Record<TipoEvento, string> = {
  CAMBIO_ESTADO: 'Cambio de estado',
  REAPERTURA: 'Reapertura',
  ITEM_AGREGADO: 'Actividad agregada',
  ITEM_ELIMINADO: 'Actividad eliminada',
  CANTIDAD_MODIFICADA: 'Cantidad modificada',
  PRECIO_MODIFICADO: 'Precio unitario modificado',
  CAPITULO_AGREGADO: 'Capítulo agregado',
  CAPITULO_ELIMINADO: 'Capítulo eliminado',
  AIU_MODIFICADO: 'AIU o IVA modificados',
  PRESUPUESTO_ARCHIVADO: 'Archivado',
  PRESUPUESTO_DESARCHIVADO: 'Desarchivado',
  PRESUPUESTO_ELIMINADO: 'Eliminado',
  PRESUPUESTO_DUPLICADO: 'Duplicado',
  RECURSO_MODIFICADO: 'Recurso modificado',
  APU_VERSIONADO: 'Versión nueva de APU',
  ADMIN_RESTABLECIDO: 'Administrador designado',
};

export function Historial({ presupuestoId, alCerrar, version }: { presupuestoId: string; alCerrar: () => void; version: number }) {
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [tipo, setTipo] = useState<TipoEvento | ''>('');
  const [usuarioId, setUsuarioId] = useState('');
  const [eventos, setEventos] = useState<Evento[] | null>(null);
  const [usuarios, setUsuarios] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    setError(null);
    // Las fechas del filtro son días completos en la zona de quien mira: desde
    // la medianoche del primero hasta el último instante del segundo.
    const ruta = conConsulta(`/api/presupuestos/${encodeURIComponent(presupuestoId)}/historial`, {
      desde: desde ? new Date(`${desde}T00:00:00`).toISOString() : undefined,
      hasta: hasta ? new Date(`${hasta}T23:59:59.999`).toISOString() : undefined,
      tipo: tipo || undefined,
      usuarioId: usuarioId || undefined,
    });
    pedir<{ eventos: Evento[] }>(ruta)
      .then((r) => {
        if (!vigente) return;
        setEventos(r.eventos);
        // Se acumulan: filtrar por un usuario no tiene que borrar a los demás del desplegable.
        setUsuarios((antes) => {
          const nuevo = new Map(antes);
          for (const e of r.eventos) if (e.usuarioId && e.usuarioNombre) nuevo.set(e.usuarioId, e.usuarioNombre);
          return nuevo;
        });
      })
      .catch((e: unknown) => {
        if (vigente) setError(e instanceof ErrorDeApi ? e.message : 'No se pudo leer el historial.');
      });
    return () => {
      vigente = false;
    };
  }, [presupuestoId, desde, hasta, tipo, usuarioId, version]);

  const listaDeUsuarios = useMemo(() => [...usuarios.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es')), [usuarios]);
  const hayFiltros = desde !== '' || hasta !== '' || tipo !== '' || usuarioId !== '';

  return (
    <PanelLateral titulo="Historial de cambios" alCerrar={alCerrar}>
      <div className="filtros-de-historial">
        <div className="fila-de-campos">
          <div className="campo">
            <label htmlFor="historial-desde">Desde</label>
            <input id="historial-desde" type="date" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} />
          </div>
          <div className="campo">
            <label htmlFor="historial-hasta">Hasta</label>
            <input id="historial-hasta" type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} />
          </div>
        </div>
        <div className="campo">
          <label htmlFor="historial-tipo">Tipo de evento</label>
          <select id="historial-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoEvento | '')}>
            <option value="">Todos</option>
            {(Object.keys(NOMBRES_DE_EVENTO) as TipoEvento[]).map((t) => <option key={t} value={t}>{NOMBRES_DE_EVENTO[t]}</option>)}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="historial-usuario">Usuario</label>
          <select id="historial-usuario" value={usuarioId} onChange={(e) => setUsuarioId(e.target.value)}>
            <option value="">Todos</option>
            {listaDeUsuarios.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
          </select>
        </div>
        {hayFiltros ? (
          <button type="button" className="boton boton-secundario" onClick={() => { setDesde(''); setHasta(''); setTipo(''); setUsuarioId(''); }}>
            Quitar filtros
          </button>
        ) : null}
      </div>

      {error ? <p className="aviso-error" role="alert"><span>{error}</span></p> : null}
      {eventos === null && !error ? <p className="campo-ayuda">Cargando el historial…</p> : null}
      {eventos && eventos.length === 0 ? (
        <p className="campo-ayuda">{hayFiltros ? 'Ningún evento coincide con los filtros.' : 'Todavía no hay eventos en este presupuesto.'}</p>
      ) : null}
      {eventos && eventos.length > 0 ? (
        <ol className="lista-de-eventos">
          {eventos.map((e) => (
            <li key={e.id} className="evento">
              <div className="evento-cabecera">
                <span className="evento-tipo">{NOMBRES_DE_EVENTO[e.tipoEvento] ?? e.tipoEvento}</span>
                <time dateTime={paraAtributo(e.ocurridoEn)}>{formatearFechaYHora(e.ocurridoEn)}</time>
              </div>
              <p className="evento-descripcion">{e.descripcion}</p>
              {e.valorAnterior !== null || e.valorNuevo !== null ? (
                <p className="evento-cambio">
                  <span className="evento-antes">{e.valorAnterior ?? '—'}</span>
                  <span aria-hidden="true"> → </span>
                  <span className="solo-lectores"> cambió a </span>
                  <span className="evento-despues">{e.valorNuevo ?? '—'}</span>
                </p>
              ) : null}
              {e.justificacion ? <p className="evento-justificacion">«{e.justificacion}»</p> : null}
              <p className="dato-de-apoyo">{e.usuarioNombre ?? 'Sistema'}</p>
            </li>
          ))}
        </ol>
      ) : null}
    </PanelLateral>
  );
}
