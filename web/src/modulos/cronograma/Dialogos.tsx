import { useEffect, useState } from 'react';
import { conConsulta, ErrorDeApi, pedir } from '../../api/cliente.ts';
import type { EstadoPresupuesto } from '../../api/tipos.ts';
import type { CalendarioResumen, LineaBaseResumen, TipoDeActividad, VistaCronograma } from '../../api/tiposCronograma.ts';
import { Campo } from '../../componentes/Campo.tsx';
import { Capa } from '../../componentes/Capa.tsx';
import { Confirmacion } from '../../componentes/Confirmacion.tsx';
import { Icono } from '../../componentes/Icono.tsx';
import { soloCifra } from '../../entrada.ts';
import { formatearFecha, formatearFechaYHora } from '../../fechas.ts';
import { useSesion } from '../../sesion.tsx';
import { CapaDeCalendario } from '../calendarios/CapaDeCalendario.tsx';
import { resumenDeCalendario } from '../calendarios/Calendarios.tsx';
import { mensaje, yaAtendido, type Escribir } from './escritura.ts';
import { fechaConDia, leerDias } from './tiempo.ts';

/* Las capas del cronograma: crear hitos y subgrupos, la fecha de inicio, el
   calendario de la obra, las líneas base y la exportación. */

// --- Un hito o un trámite (RF-PRG-03) ---------------------------------------------

export function AgregarActividad({ vista, escribir, alCerrar, alCrear }: { vista: VistaCronograma; escribir: Escribir; alCerrar: () => void; alCrear: (id: string | null) => void }) {
  const { arranque } = useSesion();
  const formato = arranque.formatoNumerico;
  const [tipo, setTipo] = useState<TipoDeActividad>('HITO_FIN');
  const [nombre, setNombre] = useState('');
  const [codigo, setCodigo] = useState('');
  const [grupoId, setGrupoId] = useState('');
  const [duracion, setDuracion] = useState('');
  const [corrido, setCorrido] = useState(true);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar() {
    if (enviando) return;
    const faltan: Record<string, string> = {};
    if (nombre.trim() === '') faltan['nombre'] = 'Escriba el nombre.';
    if (codigo.trim() !== '' && /^[\d.]+$/.test(codigo.trim())) faltan['codigo'] = 'Un código solo de cifras y puntos es el de un ítem del presupuesto. Use letras, como H-003 o T-010.';
    let dur: string | null = null;
    if (tipo === 'SIN_COSTO' && duracion.trim() !== '') {
      const l = leerDias(duracion, { nombre: 'la duración' });
      if ('error' in l) faltan['duracionManualDias'] = l.error;
      else dur = l.valor;
    }
    setErrores(faltan);
    if (Object.keys(faltan).length > 0) return;
    setEnviando(true);
    setError(null);
    const antes = new Set(vista.actividades.map((a) => a.id));
    try {
      const nueva = await escribir(`Agregar «${nombre.trim()}»`, 'POST', `/api/cronogramas/${vista.cronograma.id}/actividades`, {
        tipo,
        nombre: nombre.trim(),
        ...(codigo.trim() === '' ? {} : { codigo: codigo.trim() }),
        ...(grupoId === '' ? {} : { grupoId }),
        ...(tipo === 'SIN_COSTO' ? { usaCorrido: corrido, ...(dur === null ? {} : { duracionManualDias: dur }) } : {}),
      });
      alCrear(nueva.actividades.find((a) => !antes.has(a.id))?.id ?? null);
    } catch (e) {
      setEnviando(false);
      if (yaAtendido(e)) { alCerrar(); return; }
      if (e instanceof ErrorDeApi && e.campo) setErrores({ [e.campo]: e.message });
      else setError(mensaje(e, 'No se agregó. Intente de nuevo.'));
    }
  }

  const TIPOS: { id: TipoDeActividad; nombre: string; ayuda: string }[] = [
    { id: 'HITO_INICIO', nombre: 'Hito de inicio', ayuda: 'Dura cero y cae al empezar la jornada: una orden de inicio, una entrega de terreno.' },
    { id: 'HITO_FIN', nombre: 'Hito de fin', ayuda: 'Dura cero y cae al cerrar la jornada: una entrega, una fecha del contrato.' },
    { id: 'SIN_COSTO', nombre: 'Trámite o espera, sin costo', ayuda: 'Licencias, plazos de proveedores, curados, fabricación. Ocupa tiempo y no tiene costo.' },
  ];

  return (
    <Capa
      titulo="Agregar hito o trámite"
      alCerrar={alCerrar}
      hayCambios={nombre !== '' || codigo !== '' || duracion !== ''}
      error={error}
      alEnviar={() => void enviar()}
      acciones={(cerrar) => (
        <>
          <button type="button" className="boton boton-secundario" onClick={cerrar} disabled={enviando}>Cancelar</button>
          <button type="submit" className="boton boton-principal" disabled={enviando}>{enviando ? 'Recalculando…' : 'Agregar'}</button>
        </>
      )}
    >
      <fieldset className="campo lista-de-opciones">
        <legend className="etiqueta">Qué es</legend>
        {TIPOS.map((t) => (
          <label key={t.id} className="opcion-con-detalle">
            <input type="radio" name="tipo-de-actividad" checked={tipo === t.id} onChange={() => setTipo(t.id)} />
            <span><span>{t.nombre}</span><span className="dato-de-apoyo">{t.ayuda}</span></span>
          </label>
        ))}
      </fieldset>
      <div className="fila-de-campos fila-codigo-nombre">
        <Campo etiqueta="Código (opcional)" ayuda={tipo === 'SIN_COSTO' ? 'Vacío: el siguiente T-nnn.' : 'Vacío: el siguiente H-nnn.'} error={errores['codigo']}>
          {(a) => <input {...a} autoComplete="off" spellCheck={false} value={codigo} onChange={(e) => setCodigo(e.target.value)} />}
        </Campo>
        <Campo etiqueta="Nombre" error={errores['nombre']}>
          {(a) => <input {...a} autoComplete="off" value={nombre} onChange={(e) => setNombre(e.target.value)} />}
        </Campo>
      </div>
      {vista.grupos.length > 0 ? (
        <Campo etiqueta="Subgrupo" error={errores['grupoId']}>
          {(a) => (
            <select {...a} value={grupoId} onChange={(e) => setGrupoId(e.target.value)}>
              <option value="">Hitos y trámites (sin subgrupo)</option>
              {[...vista.grupos].sort((x, y) => x.orden - y.orden).map((g) => <option key={g.id} value={g.id}>{g.nombre}</option>)}
            </select>
          )}
        </Campo>
      ) : null}
      {tipo === 'SIN_COSTO' ? (
        <>
          <Campo etiqueta={`Duración (días${corrido ? ' corridos' : ''})`} ayuda="Con un decimal como máximo. Vacía, dura cero." error={errores['duracionManualDias']}>
            {(a) => <input {...a} className="campo-cifra-corto" inputMode="decimal" autoComplete="off" value={duracion} onChange={(e) => setDuracion(soloCifra(e.target.value, formato.separadorDecimal))} />}
          </Campo>
          <label className="casilla">
            <input type="checkbox" checked={corrido} onChange={(e) => setCorrido(e.target.checked)} />
            <span>Corre todos los días, 24 horas, aunque no se trabaje</span>
          </label>
        </>
      ) : null}
      <p className="campo-ayuda">Nace sin relaciones: agréguele predecesoras y sucesoras en su panel.</p>
    </Capa>
  );
}

// --- Un subgrupo de «Hitos y trámites» ---------------------------------------------------

export function FormularioDeGrupo({ vista, grupo, escribir, alCerrar }: { vista: VistaCronograma; grupo: { id: string; nombre: string } | null; escribir: Escribir; alCerrar: () => void }) {
  const [nombre, setNombre] = useState(grupo?.nombre ?? '');
  const [errorNombre, setErrorNombre] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  async function enviar() {
    if (enviando) return;
    if (nombre.trim() === '') { setErrorNombre('Escriba el nombre del subgrupo.'); return; }
    setEnviando(true);
    setError(null);
    try {
      const base = `/api/cronogramas/${vista.cronograma.id}/grupos`;
      if (grupo) await escribir(`Renombrar el subgrupo «${grupo.nombre}»`, 'PATCH', `${base}/${grupo.id}`, { nombre: nombre.trim() });
      else await escribir(`Crear el subgrupo «${nombre.trim()}»`, 'POST', base, { nombre: nombre.trim() });
      alCerrar();
    } catch (e) {
      setEnviando(false);
      if (yaAtendido(e)) { alCerrar(); return; }
      if (e instanceof ErrorDeApi && e.campo === 'nombre') setErrorNombre(e.message);
      else setError(mensaje(e, 'No se guardó el subgrupo.'));
    }
  }
  return (
    <Capa
      titulo={grupo ? `Renombrar «${grupo.nombre}»` : 'Agregar subgrupo'}
      alCerrar={alCerrar}
      hayCambios={nombre !== (grupo?.nombre ?? '')}
      error={error}
      alEnviar={() => void enviar()}
      acciones={(cerrar) => (
        <>
          <button type="button" className="boton boton-secundario" onClick={cerrar} disabled={enviando}>Cancelar</button>
          <button type="submit" className="boton boton-principal" disabled={enviando}>{enviando ? 'Guardando…' : grupo ? 'Guardar nombre' : 'Agregar subgrupo'}</button>
        </>
      )}
    >
      <Campo etiqueta="Nombre del subgrupo" ayuda="Por ejemplo: Licencias, Suministros, Entregas. Los subgrupos son de un solo nivel." error={errorNombre}>
        {(a) => <input {...a} autoComplete="off" value={nombre} onChange={(e) => { setNombre(e.target.value); setErrorNombre(null); }} />}
      </Campo>
    </Capa>
  );
}

// --- La fecha de inicio ------------------------------------------------------------------

export function CambiarFechaDeInicio({ vista, escribir, alCerrar }: { vista: VistaCronograma; escribir: Escribir; alCerrar: () => void }) {
  const [fecha, setFecha] = useState(vista.cronograma.fechaInicio);
  const [errorFecha, setErrorFecha] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  async function enviar() {
    if (enviando) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) { setErrorFecha('Elija la fecha de inicio.'); return; }
    setEnviando(true);
    try {
      await escribir('Cambiar la fecha de inicio', 'PATCH', `/api/cronogramas/${vista.cronograma.id}`, { fechaInicio: fecha });
      alCerrar();
    } catch (e) {
      setEnviando(false);
      if (yaAtendido(e)) { alCerrar(); return; }
      if (e instanceof ErrorDeApi && e.campo === 'fechaInicio') setErrorFecha(e.message);
      else setError(mensaje(e, 'No se cambió la fecha.'));
    }
  }
  return (
    <Capa
      titulo="Fecha de inicio del cronograma"
      alCerrar={alCerrar}
      hayCambios={fecha !== vista.cronograma.fechaInicio}
      error={error}
      alEnviar={() => void enviar()}
      acciones={(cerrar) => (
        <>
          <button type="button" className="boton boton-secundario" onClick={cerrar} disabled={enviando}>Cancelar</button>
          <button type="submit" className="boton boton-principal" disabled={enviando || fecha === vista.cronograma.fechaInicio}>{enviando ? 'Recalculando…' : 'Cambiar fecha'}</button>
        </>
      )}
    >
      <Campo etiqueta="Fecha de inicio" ayuda="Ninguna actividad empieza antes. Si cae en un día no laborable, la obra arranca el siguiente momento laborable. Queda en el historial." error={errorFecha}>
        {(a) => <input {...a} type="date" value={fecha} onChange={(e) => { setFecha(e.target.value); setErrorFecha(null); }} />}
      </Campo>
    </Capa>
  );
}

// --- El calendario de la obra (D-86) ---------------------------------------------------------

export function CalendarioDeLaObra({ vista, escribir, alCerrar }: { vista: VistaCronograma; escribir: Escribir; alCerrar: () => void }) {
  const { arranque } = useSesion();
  const formato = arranque.formatoNumerico;
  const editable = vista.cronograma.editable;
  const base = `/api/cronogramas/${vista.cronograma.id}/calendario-obra`;
  const [calendarios, setCalendarios] = useState<CalendarioResumen[] | null>(null);
  const [elegido, setElegido] = useState('');
  const [reemplazando, setReemplazando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editable) return;
    pedir<{ calendarios: CalendarioResumen[] }>('/api/calendarios').then((r) => setCalendarios(r.calendarios)).catch(() => setCalendarios([]));
  }, [editable]);

  const atender = async (descripcion: string, metodo: 'PUT' | 'DELETE' | 'POST', ruta: string, cuerpo?: Record<string, unknown>) => {
    try {
      return await escribir(descripcion, metodo, ruta, cuerpo);
    } catch (e) {
      if (yaAtendido(e)) alCerrar();
      throw e;
    }
  };

  const elegidoNombre = calendarios?.find((c) => c.id === elegido)?.nombre ?? '';
  return (
    <>
      <CapaDeCalendario
        calendario={vista.calendarios.obra}
        editable={editable}
        nota="Es la copia de este proyecto: cambiarla recalcula el cronograma y no toca el calendario de la empresa. Los cambios de calendario quedan en el historial."
        alCerrar={alCerrar}
        alGuardarSemana={async (d) => { await atender('Editar el calendario de la obra', 'PUT', base, { ...d }); }}
        alGuardarExcepcion={async (fecha, motivo, tramos) => { await atender(`Excepción del ${fechaConDia(fecha)}`, 'PUT', `${base}/excepciones/${fecha}`, { motivo, tramos }); }}
        alQuitarExcepcion={async (fecha) => { await atender(`Quitar la excepción del ${fechaConDia(fecha)}`, 'DELETE', `${base}/excepciones/${fecha}`); }}
        alCopiarFestivos={async (listaId, propia) => {
          const antes = vista.calendarios.obra.excepciones.length;
          const nueva = await atender('Copiar festivos al calendario de la obra', 'POST', `${base}/festivos`, { listaId, propia });
          return nueva.calendarios.obra.excepciones.length - antes;
        }}
        pie={editable ? (
          <div className="reemplazar-calendario">
            <p className="bloque-de-precio-titulo">Reemplazarlo por un calendario de la empresa</p>
            <p className="campo-ayuda">El de la obra se cambia por una copia nueva del elegido: se pierden las excepciones y los cambios hechos aquí.</p>
            <div className="fila-de-campos fila-reemplazar">
              <Campo etiqueta="Calendario de la empresa">
                {(a) => (
                  <select {...a} value={elegido} disabled={calendarios === null} onChange={(e) => setElegido(e.target.value)}>
                    <option value="">{calendarios === null ? 'Cargando…' : 'Elija uno'}</option>
                    {(calendarios ?? []).map((c) => <option key={c.id} value={c.id}>{c.nombre} · {resumenDeCalendario(c, formato)}</option>)}
                  </select>
                )}
              </Campo>
              <button type="button" className="boton boton-secundario" disabled={elegido === ''} onClick={() => setReemplazando(true)}>Reemplazar</button>
            </div>
            {error ? <p className="aviso-error" role="alert"><Icono nombre="aviso" /><span>{error}</span></p> : null}
          </div>
        ) : null}
      />
      {reemplazando ? (
        <Confirmacion
          titulo="Reemplazar el calendario de la obra"
          textoConfirmar="Reemplazar calendario"
          textoEnviando="Recalculando…"
          alCerrar={() => setReemplazando(false)}
          alConfirmar={async () => {
            try {
              await escribir(`Reemplazar el calendario por «${elegidoNombre}»`, 'PUT', `/api/cronogramas/${vista.cronograma.id}/calendario`, { calendarioId: elegido });
              setReemplazando(false);
              setElegido('');
            } catch (e) {
              setReemplazando(false);
              if (yaAtendido(e)) { alCerrar(); return; }
              setError(mensaje(e, 'No se reemplazó el calendario.'));
            }
          }}
        >
          <p>El calendario de la obra pasa a ser una copia de «{elegidoNombre}». Las excepciones que tiene hoy se pierden, y el cronograma se recalcula con las horas nuevas.</p>
        </Confirmacion>
      ) : null}
    </>
  );
}

// --- Las líneas base (RF-PRG-09) -------------------------------------------------------------

interface PropsLineas {
  vista: VistaCronograma;
  estado: EstadoPresupuesto;
  mostrada: string | null;
  escribir: Escribir;
  /** Guardar una línea base no es una entrada (§19.8): no responde con la vista. */
  alCambiar: (aviso: string, mostrar?: string | null) => void;
  /** El 409 de «el presupuesto cambió» o «otra persona», con la vista nueva. */
  alConflicto: (e: ErrorDeApi) => void;
  alCerrar: () => void;
}

export function LineasBase({ vista, estado, mostrada, alCambiar, alConflicto, alCerrar }: PropsLineas) {
  const { puedeEscribir } = useSesion();
  const puedeGuardar = puedeEscribir('PRESUPUESTOS.EDITAR') && estado === 'ACTIVO';
  const [nombre, setNombre] = useState('');
  const [errorNombre, setErrorNombre] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [reemplazar, setReemplazar] = useState<{ id: string; mensaje: string } | null>(null);
  const [borrando, setBorrando] = useState<LineaBaseResumen | null>(null);
  const lista = vista.lineasBase;

  async function guardar() {
    if (enviando) return;
    if (nombre.trim() === '') { setErrorNombre('Escriba el nombre de la línea base: Contrato, Reprogramación 1…'); return; }
    setEnviando(true);
    setError(null);
    try {
      const r = await pedir<{ lineaBase: LineaBaseResumen }>(`/api/cronogramas/${vista.cronograma.id}/lineas-base`, { metodo: 'POST', cuerpo: { version: vista.cronograma.version, nombre: nombre.trim() } });
      setNombre('');
      alCambiar(`Línea base «${r.lineaBase.nombre}» guardada.`, r.lineaBase.id);
    } catch (e) {
      if (e instanceof ErrorDeApi && e.estado === 409) {
        const id = (e.cuerpo as { lineaBaseId?: unknown } | null)?.lineaBaseId;
        if (typeof id === 'string') setReemplazar({ id, mensaje: e.message });
        else { alConflicto(e); setError(e.message); }
      } else if (e instanceof ErrorDeApi && e.campo === 'nombre') setErrorNombre(e.message);
      else setError(mensaje(e, 'No se guardó la línea base.'));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <Capa
        titulo="Líneas base"
        alCerrar={alCerrar}
        hayCambios={nombre.trim() !== ''}
        error={error}
        {...(puedeGuardar ? { alEnviar: () => void guardar() } : {})}
        acciones={(cerrar) => (
          <>
            <button type="button" className="boton boton-secundario" onClick={cerrar}>Cerrar</button>
            {puedeGuardar ? <button type="submit" className="boton boton-principal" disabled={enviando}>{enviando ? 'Guardando…' : 'Guardar línea base'}</button> : null}
          </>
        )}
      >
        <p className="texto-de-dialogo">
          Una línea base es la foto del cronograma: fechas, duraciones y las dos curvas. Así lo planeado no cambia cuando se toca el presupuesto, y se compara contra lo de hoy en el Gantt y en las curvas.
        </p>
        {puedeGuardar ? (
          <Campo etiqueta="Nombre de la línea base nueva" ayuda="Se guarda lo que está viendo ahora." error={errorNombre}>
            {(a) => <input {...a} autoComplete="off" value={nombre} onChange={(e) => { setNombre(e.target.value); setErrorNombre(null); }} />}
          </Campo>
        ) : (
          <p className="nota-de-capa"><Icono nombre="candado" tamano={18} /><span>{estado === 'ACTIVO' ? 'Su rol no guarda líneas base.' : 'Las líneas base se guardan, se reemplazan y se eliminan solo con el proyecto Activo: es lo aprobado.'}</span></p>
        )}
        {lista.length === 0 ? (
          <p className="dato-de-apoyo">Todavía no hay líneas base.</p>
        ) : (
          <ul className="lista-de-lineas-base">
            {lista.map((l) => (
              <li key={l.id} data-mostrada={l.id === mostrada ? 'si' : 'no'}>
                <span className="lista-de-lineas-base-nombre">
                  <Icono nombre="bandera" tamano={18} />
                  {l.nombre}
                  {l.id === mostrada ? <span className="insignia">En el Gantt</span> : null}
                </span>
                <span className="dato-de-apoyo">
                  Guardada el <time dateTime={l.guardadaEn} title={formatearFechaYHora(l.guardadaEn)}>{formatearFecha(l.guardadaEn)}</time>
                  {l.guardadaPor ? ` por ${l.guardadaPor}` : ''} · termina el {fechaConDia(l.fin)}
                </span>
                <span className="fila-de-botones fila-izquierda">
                  {l.id === mostrada ? null : <button type="button" className="boton boton-secundario boton-chico-texto" onClick={() => alCambiar('', l.id)}>Mostrar en el Gantt</button>}
                  {puedeGuardar ? <button type="button" className="boton boton-peligroso boton-chico-texto" onClick={() => setBorrando(l)}>Eliminar</button> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Capa>
      {reemplazar ? (
        <Confirmacion
          titulo="Reemplazar la línea base"
          textoConfirmar="Reemplazar línea base"
          textoEnviando="Guardando…"
          peligroso
          alCerrar={() => setReemplazar(null)}
          alConfirmar={async () => {
            try {
              const r = await pedir<{ lineaBase: LineaBaseResumen }>(`/api/lineas-base/${reemplazar.id}/reemplazar`, { metodo: 'POST', cuerpo: { version: vista.cronograma.version } });
              setReemplazar(null);
              setNombre('');
              alCambiar(`Línea base «${r.lineaBase.nombre}» reemplazada.`, r.lineaBase.id);
            } catch (e) {
              if (e instanceof ErrorDeApi && e.estado === 409) { setReemplazar(null); alConflicto(e); setError(e.message); return; }
              throw e;
            }
          }}
        >
          <p>{reemplazar.mensaje} La foto guardada se cambia por la de ahora; la anterior no se puede recuperar. Queda en el historial.</p>
        </Confirmacion>
      ) : null}
      {borrando ? (
        <Confirmacion
          titulo={`Eliminar la línea base «${borrando.nombre}»`}
          textoConfirmar="Eliminar línea base"
          textoEnviando="Eliminando…"
          peligroso
          alCerrar={() => setBorrando(null)}
          alConfirmar={async () => {
            await pedir<void>(`/api/lineas-base/${borrando.id}`, { metodo: 'DELETE' });
            setBorrando(null);
            alCambiar(`Línea base «${borrando.nombre}» eliminada.`, borrando.id === mostrada ? null : mostrada);
          }}
        >
          <p>Se eliminará la foto «{borrando.nombre}», con sus fechas y sus curvas. No se puede deshacer, y queda en el historial.</p>
        </Confirmacion>
      ) : null}
    </>
  );
}

// --- Exportar (RF-PRG-10, RF-PRG-11) ------------------------------------------------------------

type Formato = 'pdf' | 'xml' | 'xer';

export function Exportar({ vista, lineaBase, alCerrar }: { vista: VistaCronograma; lineaBase: string | null; alCerrar: () => void }) {
  const [formato, setFormato] = useState<Formato>('pdf');
  const [escala, setEscala] = useState<'DIA' | 'SEMANA' | 'MES'>('SEMANA');
  const [base, setBase] = useState(lineaBase ?? '');
  const [costo, setCosto] = useState(false);
  const [p6, setP6] = useState<{ id: string; nombre: string }[] | null>(null);
  const [versionP6, setVersionP6] = useState('');

  useEffect(() => {
    pedir<{ versiones: { id: string; nombre: string }[] }>('/api/exportacion/p6').then((r) => { setP6(r.versiones); setVersionP6(r.versiones[0]?.id ?? ''); }).catch(() => setP6([]));
  }, []);

  const ruta = `/api/cronogramas/${vista.cronograma.id}/exportar`;
  const enlace =
    formato === 'pdf' ? conConsulta(ruta, { formato: 'pdf', escala, lineaBase: base || undefined })
      : formato === 'xml' ? conConsulta(ruta, { formato: 'xml', costo: costo ? 'true' : 'false' })
        : conConsulta(ruta, { formato: 'xer', p6: versionP6, costo: costo ? 'true' : 'false' });
  // El XER no se ofrece mientras no haya versiones de P6 (CONTRATO §19.9).
  const conXer = (p6?.length ?? 0) > 0;

  return (
    <Capa
      titulo="Exportar el cronograma"
      alCerrar={alCerrar}
      hayCambios={false}
      acciones={(cerrar) => (
        <>
          <button type="button" className="boton boton-secundario" onClick={cerrar}>Cerrar</button>
          <a className="boton boton-principal" href={enlace} download onClick={() => window.setTimeout(alCerrar, 300)}>
            <Icono nombre="descargar" />
            Descargar
          </a>
        </>
      )}
    >
      <fieldset className="campo lista-de-opciones">
        <legend className="etiqueta">Formato</legend>
        <label className="opcion-con-detalle">
          <input type="radio" name="formato" checked={formato === 'pdf'} onChange={() => setFormato('pdf')} />
          <span><span>PDF del Gantt</span><span className="dato-de-apoyo">Para imprimir o enviar: la tabla y las barras como en pantalla.</span></span>
        </label>
        <label className="opcion-con-detalle">
          <input type="radio" name="formato" checked={formato === 'xml'} onChange={() => setFormato('xml')} />
          <span><span>MS Project (XML)</span><span className="dato-de-apoyo">Para Project 2010 en adelante.</span></span>
        </label>
        {conXer ? (
          <label className="opcion-con-detalle">
            <input type="radio" name="formato" checked={formato === 'xer'} onChange={() => setFormato('xer')} />
            <span><span>Primavera P6 (XER)</span><span className="dato-de-apoyo">Para la versión de P6 que elija.</span></span>
          </label>
        ) : null}
      </fieldset>

      {formato === 'pdf' ? (
        <div className="fila-de-campos">
          <Campo etiqueta="Escala de tiempo">
            {(a) => (
              <select {...a} value={escala} onChange={(e) => setEscala(e.target.value as 'DIA' | 'SEMANA' | 'MES')}>
                <option value="DIA">Por día</option>
                <option value="SEMANA">Por semana</option>
                <option value="MES">Por mes</option>
              </select>
            )}
          </Campo>
          <Campo etiqueta="Línea base">
            {(a) => (
              <select {...a} value={base} onChange={(e) => setBase(e.target.value)}>
                <option value="">Sin línea base</option>
                {vista.lineasBase.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
              </select>
            )}
          </Campo>
        </div>
      ) : (
        <>
          {formato === 'xer' ? (
            <Campo etiqueta="Versión de P6">
              {(a) => (
                <select {...a} value={versionP6} onChange={(e) => setVersionP6(e.target.value)}>
                  {(p6 ?? []).map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
                </select>
              )}
            </Campo>
          ) : null}
          <label className="casilla">
            <input type="checkbox" checked={costo} onChange={(e) => setCosto(e.target.checked)} />
            <span>Incluir el costo de cada actividad</span>
          </label>
          {formato === 'xml' ? (
            <div className="nota-de-capa">
              <Icono nombre="aviso" tamano={18} />
              <div>
                <p>Project no sabe representar todo lo del cronograma. Al abrir el archivo:</p>
                <ul>
                  <li>cada actividad queda con una sola restricción; la secundaria se conserva solo si es «fin en o antes de», como fecha límite;</li>
                  <li>la administración sale como una tarea normal, y sus fechas ya no se mueven solas con la obra.</li>
                </ul>
                <p>Para abrirlo hace falta MS Project.</p>
              </div>
            </div>
          ) : null}
        </>
      )}
    </Capa>
  );
}
