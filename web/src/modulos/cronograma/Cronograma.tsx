import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { conConsulta, ErrorDeApi, pedir } from '../../api/cliente.ts';
import type { FilaDePresupuesto } from '../../api/tipos.ts';
import type { CalendarioResumen, Grupo, SinCronograma, VistaCronograma } from '../../api/tiposCronograma.ts';
import { BotonVolver } from '../../cascaron/Cascaron.tsx';
import { useAvisos } from '../../componentes/Avisos.tsx';
import { Campo } from '../../componentes/Campo.tsx';
import { Confirmacion } from '../../componentes/Confirmacion.tsx';
import { Icono } from '../../componentes/Icono.tsx';
import { InsigniaDeEstado } from '../../componentes/Insignia.tsx';
import { ControlDeNiveles, nivelDe, plegadosHasta } from '../../componentes/Niveles.tsx';
import { Pestanas } from '../../componentes/Pestanas.tsx';
import { formatearFechaYHora } from '../../fechas.ts';
import { formatearNumero } from '../../formato.ts';
import { useSesion } from '../../sesion.tsx';
import { resumenDeCalendario } from '../calendarios/Calendarios.tsx';
import { Curvas } from './Curvas.tsx';
import { AgregarActividad, CalendarioDeLaObra, CambiarFechaDeInicio, Exportar, FormularioDeGrupo, LineasBase } from './Dialogos.tsx';
import { cicloDe, hayVista, mensaje, type Escribir } from './escritura.ts';
import { armarFilas, nivelesDelCronograma } from './filas.ts';
import { ANCHOS_INICIALES, Gantt, type Anchos, type Escala } from './Gantt.tsx';
import { PanelDeActividad } from './PanelDeActividad.tsx';
import { contarRevision, Revision } from './Revision.tsx';
import { dias, fechaConDia, fechaCorta, hoy } from './tiempo.ts';

/*
 * La pantalla del cronograma (07 §6, CONTRATO §19). Uno por proyecto (D-82):
 * se entra desde la mesa y se vuelve a ella.
 *
 * Toda escritura pasa por `escribir`, que lleva la versión que se está viendo
 * y reemplaza la vista por la que responde el servidor, ya recalculada. Si
 * otra persona cambió el cronograma en el medio (409), se muestra la versión
 * nueva y el cambio rechazado queda en una franja para volver a aplicarlo con
 * un clic (07 §6.9): nadie pisa el trabajo de otro sin saberlo, y nadie pierde
 * lo que hizo.
 *
 * Leer puede recalcular (D-91): si el presupuesto cambió, el GET tarda lo que
 * tarde el cálculo. Si pasa de un instante, se dice «recalculando».
 */

type Pestana = 'gantt' | 'curvas' | 'revision';
const UMBRAL_LENTO_MS = 400;

function leerPreferencia(clave: string): string | null {
  try { return window.localStorage.getItem(clave); } catch { return null; }
}
function guardarPreferencia(clave: string, valor: string): void {
  try { window.localStorage.setItem(clave, valor); } catch { /* sin almacenamiento, no se recuerda */ }
}

interface Rechazado {
  descripcion: string;
  mensaje: string;
  rehacer: () => Promise<unknown>;
}

export function Cronograma({ presupuestoId }: { presupuestoId: string }) {
  const { puede, puedeEscribir, arranque } = useSesion();
  const formato = arranque.formatoNumerico;
  const { avisar } = useAvisos();
  const [proyecto, setProyecto] = useState<FilaDePresupuesto | null>(null);
  const [vista, setVista] = useState<VistaCronograma | null>(null);
  const [sinCronograma, setSinCronograma] = useState(false);
  const [falla, setFalla] = useState<{ mensaje: string; noExiste: boolean } | null>(null);
  const [lento, setLento] = useState(false);
  const [guardando, setGuardando] = useState(0);
  const [rechazado, setRechazado] = useState<Rechazado | null>(null);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [ciclo, setCiclo] = useState<ReadonlySet<string>>(new Set());
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [pestana, setPestana] = useState<Pestana>('gantt');
  const [plegados, setPlegados] = useState<ReadonlySet<string>>(new Set());
  const [anchos, setAnchos] = useState<Anchos>(ANCHOS_INICIALES);
  const [escala, setEscalaEstado] = useState<Escala>(() => {
    const e = leerPreferencia('cronograma.escala');
    return e === 'DIA' || e === 'SEMANA' || e === 'MES' ? e : 'SEMANA';
  });
  const claveBase = `cronograma.lineaBase.${presupuestoId}`;
  const [lineaBase, setLineaBaseEstado] = useState<string | null>(() => {
    const g = leerPreferencia(claveBase);
    return g === null || g === 'ninguna' ? null : g;
  });
  const [dialogo, setDialogo] = useState<
    | { tipo: 'agregar' | 'grupo-nuevo' | 'fecha' | 'calendario' | 'lineas-base' | 'exportar' }
    | { tipo: 'grupo'; grupo: Grupo }
    | { tipo: 'borrar-grupo'; grupo: Grupo }
    | null
  >(null);

  const vistaActual = useRef<VistaCronograma | null>(null);
  vistaActual.current = vista;
  const lineaBaseActual = useRef(lineaBase);
  lineaBaseActual.current = lineaBase;

  const setEscala = (e: Escala) => { setEscalaEstado(e); guardarPreferencia('cronograma.escala', e); };
  const setLineaBase = (id: string | null) => { setLineaBaseEstado(id); guardarPreferencia(claveBase, id ?? 'ninguna'); };

  const poner = useCallback((v: VistaCronograma) => {
    setVista(v);
    setSinCronograma(false);
    setSeleccion((s) => (s && v.actividades.some((a) => a.id === s) ? s : null));
  }, []);

  // --- Leer -------------------------------------------------------------------------
  const leer = useCallback(async (base: string | null) => {
    const reloj = window.setTimeout(() => setLento(true), UMBRAL_LENTO_MS);
    try {
      const [p, v] = await Promise.all([
        pedir<FilaDePresupuesto>(`/api/presupuestos/${encodeURIComponent(presupuestoId)}`),
        pedir<VistaCronograma | SinCronograma>(conConsulta(`/api/presupuestos/${encodeURIComponent(presupuestoId)}/cronograma`, { lineaBase: base ?? undefined })),
      ]);
      setProyecto(p);
      setFalla(null);
      if (v.cronograma === null) {
        setVista(null);
        setSinCronograma(true);
        return;
      }
      const vc = v as VistaCronograma;
      // La línea base guardada en este navegador puede ya no existir.
      if (base && !vc.lineasBase.some((l) => l.id === base)) {
        setLineaBase(null);
        return;
      }
      // Sin elección guardada, se muestra la primera que se guardó: suele ser la del contrato.
      if (!base && leerPreferencia(claveBase) === null && vc.lineasBase.length > 0) {
        const primera = [...vc.lineasBase].sort((a, b) => (a.guardadaEn < b.guardadaEn ? -1 : 1))[0];
        if (primera) { setLineaBase(primera.id); return; }
      }
      poner(vc);
    } catch (e) {
      if (e instanceof ErrorDeApi && e.estado === 401) return;
      setFalla({ mensaje: mensaje(e, 'No se pudo abrir el cronograma.'), noExiste: e instanceof ErrorDeApi && e.estado === 404 });
    } finally {
      window.clearTimeout(reloj);
      setLento(false);
    }
    // claveBase sale de presupuestoId.
  }, [presupuestoId, poner]);

  useEffect(() => { void leer(lineaBase); }, [leer, lineaBase]);

  // --- Escribir (CONTRATO §19.1) -------------------------------------------------------
  const escribir: Escribir = useCallback(async function escribirCambio(descripcion, metodo, ruta, cuerpo = {}) {
    const actual = vistaActual.current;
    if (!actual) throw new ErrorDeApi(0, 'El cronograma todavía no se ha cargado.');
    const version = actual.cronograma.version;
    // La línea base que se está mirando viaja también en las escrituras, para
    // que la respuesta la traiga (CONTRATO §19.6, 21 de octubre de 2026).
    const url = conConsulta(ruta, { lineaBase: lineaBaseActual.current ?? undefined, version: metodo === 'DELETE' ? String(version) : undefined });
    setGuardando((n) => n + 1);
    setErrorGeneral(null);
    try {
      const nueva = await pedir<VistaCronograma>(url, metodo === 'DELETE' ? { metodo } : { metodo, cuerpo: { ...cuerpo, version } });
      poner(nueva);
      setRechazado(null);
      setCiclo(new Set());
      return nueva;
    } catch (e) {
      if (e instanceof ErrorDeApi && e.estado === 409 && hayVista(e.cuerpo)) {
        poner(e.cuerpo.cronograma);
        setRechazado({ descripcion, mensaje: e.message, rehacer: () => escribirCambio(descripcion, metodo, ruta, cuerpo) });
      } else if (e instanceof ErrorDeApi && e.estado === 422 && e.campo === undefined) {
        // Cerrado mientras tanto, u otra regla sin campo: se dice y se relee.
        setErrorGeneral(e.message);
        void leer(lineaBaseActual.current);
      } else {
        const c = cicloDe(e);
        if (c) setCiclo(new Set(c));
      }
      throw e;
    } finally {
      setGuardando((n) => n - 1);
    }
  }, [poner, leer]);

  const filas = useMemo(() => (vista ? armarFilas(vista, plegados) : []), [vista, plegados]);
  const niveles = useMemo(() => (vista ? nivelesDelCronograma(vista) : { nodos: [], niveles: 1 }), [vista]);
  const actividad = vista && seleccion ? vista.actividades.find((a) => a.id === seleccion) ?? null : null;

  // --- Sin proyecto, sin cronograma, cargando -------------------------------------------
  if (falla) {
    return (
      <div className="cronograma cronograma-suelto">
        <div className="encabezado-con-volver">
          <BotonVolver a={{ pantalla: 'mesa', id: presupuestoId }} nombre="Mesa de trabajo" />
          <h1>{falla.noExiste ? 'Ese proyecto no existe' : 'No se pudo abrir el cronograma'}</h1>
        </div>
        <p className="aviso-error" role="alert"><Icono nombre="aviso" /><span>{falla.mensaje}</span></p>
        {falla.noExiste ? null : <button type="button" className="boton boton-secundario" onClick={() => void leer(lineaBase)}>Reintentar</button>}
      </div>
    );
  }
  if (!proyecto || (!vista && !sinCronograma)) {
    return (
      <div className="cronograma cronograma-suelto" aria-busy="true">
        <div className="encabezado-con-volver">
          <BotonVolver a={{ pantalla: 'mesa', id: presupuestoId }} nombre="Mesa de trabajo" />
          <h1>Cronograma</h1>
        </div>
        {lento ? <p className="recalculando" role="status"><Icono nombre="reloj" />Recalculando el cronograma con los cambios del presupuesto…</p> : null}
        <div className="gantt-esqueleto" />
      </div>
    );
  }
  if (sinCronograma || !vista) {
    return <CrearCronograma proyecto={proyecto} alCrear={(v) => { poner(v); avisar('Cronograma creado. Ahora defina las relaciones entre las actividades.'); }} />;
  }

  // --- La pantalla --------------------------------------------------------------------------
  const k = vista.cronograma;
  const editable = k.editable;
  const obra = vista.calendarios.obra;
  const pendientes = contarRevision(vista.revision);
  const alternarPlegado = (clave: string) => setPlegados((p) => { const n = new Set(p); if (n.has(clave)) n.delete(clave); else n.add(clave); return n; });
  const irA = (id: string) => { setPestana('gantt'); setSeleccion(id); };

  return (
    <div className="cronograma" data-panel={actividad && pestana === 'gantt' ? 'abierto' : 'cerrado'}>
      {/* Compacta, en dos renglones (pedido del dueño, 22 de octubre de 2026):
          cada renglón que se ahorra aquí es una actividad más en el Gantt. */}
      <header className="tarjeta encabezado-de-cronograma">
        <div className="encabezado-de-cronograma-arriba">
          <BotonVolver a={{ pantalla: 'mesa', id: proyecto.id }} nombre="Mesa de trabajo" />
          <span className="codigo-de-mesa">{proyecto.codigo}</span>
          <InsigniaDeEstado estado={proyecto.estado} />
          <h1 className="titulo-de-cronograma">Cronograma <span className="titulo-de-cronograma-proyecto">· {proyecto.nombre}</span></h1>
          <span className="recalculando" role="status" aria-live="polite">
            {guardando > 0 || lento ? <><Icono nombre="reloj" tamano={16} />Recalculando…</> : null}
          </span>
          <div className="encabezado-de-cronograma-pestanas">
            <Pestanas<Pestana>
              etiqueta="Vistas del cronograma"
              idBase="pestana-crono"
              actual={pestana}
              alCambiar={setPestana}
              pestanas={[
                { id: 'gantt', nombre: 'Gantt' },
                { id: 'curvas', nombre: 'Curvas S' },
                { id: 'revision', nombre: 'Revisión', conteo: pendientes > 0 ? pendientes : undefined },
              ]}
            />
          </div>
          <div className="fila-de-botones encabezado-de-cronograma-botones">
            <button type="button" className="boton boton-secundario" onClick={() => setDialogo({ tipo: 'lineas-base' })}>
              <Icono nombre="bandera" tamano={16} />
              Líneas base{vista.lineasBase.length > 0 ? <span className="pestana-conteo">{vista.lineasBase.length}</span> : null}
            </button>
            {puede('PRESUPUESTOS.EXPORTAR') ? (
              <button type="button" className="boton boton-secundario" onClick={() => setDialogo({ tipo: 'exportar' })}>
                <Icono nombre="descargar" tamano={16} />
                Exportar
              </button>
            ) : null}
          </div>
        </div>
        <dl className="datos-de-mesa">
          <div>
            <dt>Inicio</dt>
            <dd>
              {fechaConDia(k.fechaInicio)}
              {editable ? <button type="button" className="boton-texto" onClick={() => setDialogo({ tipo: 'fecha' })}>Cambiar</button> : null}
            </dd>
          </div>
          <div><dt>Fin</dt><dd>{fechaConDia(k.fin)}</dd></div>
          <div><dt>Duración</dt><dd className="cifra-en-texto">{dias(k.duracionDias, formato)} días</dd></div>
          <div>
            <dt>Calendario de la obra</dt>
            <dd>
              <span title={resumenDeCalendario(obra, formato)}>{obra.nombre}</span>
              <button type="button" className="boton-texto" onClick={() => setDialogo({ tipo: 'calendario' })}>{editable ? 'Ver y editar' : 'Ver'}</button>
            </dd>
          </div>
        </dl>
      </header>

      <Franjas
        vista={vista}
        cerrado={proyecto.estado === 'CERRADO'}
        rechazado={rechazado}
        errorGeneral={errorGeneral}
        puedeCerrarAviso={puedeEscribir('PRESUPUESTOS.EDITAR')}
        alDescartarRechazo={() => setRechazado(null)}
        alQuitarError={() => setErrorGeneral(null)}
        alCerrarAviso={async () => {
          await pedir<void>(`/api/cronogramas/${k.id}/aviso/cerrar`, { metodo: 'POST', cuerpo: {} });
          setVista((v) => (v ? { ...v, avisos: { ...v.avisos, presupuesto: null } } : v));
        }}
        alCopiarFestivos={() => setDialogo({ tipo: 'calendario' })}
        alIr={irA}
      />

      {/* Las herramientas del Gantt suben al renglón que tenían las pestañas, y
          las pestañas a la cabecera, al lado de «Líneas base» (pedido del
          dueño, 23 de octubre de 2026): un renglón más para las actividades. */}
      <div className="fila-de-herramientas">
        {pestana === 'gantt' ? (
          <div className="barra-del-gantt">
            <div className="conmutador" role="group" aria-label="Escala de tiempo">
              {(['DIA', 'SEMANA', 'MES'] as const).map((e) => (
                <button key={e} type="button" className="conmutador-opcion" aria-pressed={escala === e} onClick={() => setEscala(e)}>{e === 'DIA' ? 'Día' : e === 'SEMANA' ? 'Semana' : 'Mes'}</button>
              ))}
            </div>
            <label className="etiqueta-en-linea">
              Línea base
              <select value={lineaBase ?? ''} onChange={(e) => setLineaBase(e.target.value === '' ? null : e.target.value)}>
                <option value="">Ninguna</option>
                {vista.lineasBase.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
              </select>
            </label>
            <ControlDeNiveles niveles={niveles.niveles} actual={nivelDe(niveles.nodos, plegados, niveles.niveles)} alElegir={(n) => setPlegados(plegadosHasta(niveles.nodos, n))} />
            {editable ? (
              <>
                {/* Solo el icono; el nombre al pasar el mouse (pedido del dueño, 23 de octubre de 2026). */}
                <button type="button" className="boton-icono boton-de-herramienta" aria-label="Agregar subgrupo" title="Agregar subgrupo" onClick={() => setDialogo({ tipo: 'grupo-nuevo' })}>
                  <Icono nombre="carpeta" tamano={16} />
                </button>
                <button type="button" className="boton-icono boton-de-herramienta boton-de-herramienta-principal" aria-label="Agregar hito o trámite" title="Agregar hito o trámite" onClick={() => setDialogo({ tipo: 'agregar' })}>
                  <Icono nombre="rombo" tamano={16} />
                </button>
              </>
            ) : null}
          </div>
        ) : null}
        <AvisoDeAdministracion vista={vista} />
      </div>
      <div id="pestana-crono-panel" role="tabpanel" aria-labelledby={`pestana-crono-${pestana}`} className="panel-de-pestana panel-de-cronograma">
        {pestana === 'gantt' ? (
          <>
            <Leyenda conBase={vista.lineaBase !== null} />
            <Gantt
              vista={vista}
              anchos={anchos}
              alCambiarAncho={(c, w) => setAnchos((a) => (a[c] === w ? a : { ...a, [c]: w }))}
              conPanel={actividad !== null}
              filas={filas}
              escala={escala}
              seleccion={seleccion}
              ciclo={ciclo}
              plegados={plegados}
              alPlegar={alternarPlegado}
              alSeleccionar={setSeleccion}
              accionesDeGrupo={editable ? (g, primero, ultimo) => (
                <>
                  <button type="button" className="boton-icono boton-mini" aria-label={`Subir el subgrupo ${g.nombre}`} title="Subir" disabled={primero} onClick={() => void escribir(`Subir «${g.nombre}»`, 'PUT', `/api/cronogramas/${k.id}/grupos/${g.id}/posicion`, { posicion: g.orden - 1 }).catch(() => undefined)}><Icono nombre="subir" tamano={14} /></button>
                  <button type="button" className="boton-icono boton-mini" aria-label={`Bajar el subgrupo ${g.nombre}`} title="Bajar" disabled={ultimo} onClick={() => void escribir(`Bajar «${g.nombre}»`, 'PUT', `/api/cronogramas/${k.id}/grupos/${g.id}/posicion`, { posicion: g.orden + 1 }).catch(() => undefined)}><Icono nombre="bajar" tamano={14} /></button>
                  <button type="button" className="boton-icono boton-mini" aria-label={`Renombrar el subgrupo ${g.nombre}`} title="Renombrar" onClick={() => setDialogo({ tipo: 'grupo', grupo: g })}><Icono nombre="editar" tamano={14} /></button>
                  <button type="button" className="boton-icono boton-mini boton-icono-peligro" aria-label={`Eliminar el subgrupo ${g.nombre}`} title="Eliminar" onClick={() => setDialogo({ tipo: 'borrar-grupo', grupo: g })}><Icono nombre="basura" tamano={14} /></button>
                </>
              ) : undefined}
            />
          </>
        ) : null}
        {pestana === 'curvas' ? <Curvas cronogramaId={k.id} lineaBaseId={lineaBase} version={k.version} /> : null}
        {pestana === 'revision' ? <Revision vista={vista} alIr={irA} /> : null}
      </div>

      {actividad && pestana === 'gantt' ? (
        <PanelDeActividad key={actividad.id} actividad={actividad} vista={vista} escribir={escribir} alSeleccionar={setSeleccion} alCerrar={() => setSeleccion(null)} />
      ) : null}

      {dialogo?.tipo === 'agregar' ? <AgregarActividad vista={vista} escribir={escribir} alCerrar={() => setDialogo(null)} alCrear={(id) => { setDialogo(null); if (id) setSeleccion(id); }} /> : null}
      {dialogo?.tipo === 'grupo-nuevo' ? <FormularioDeGrupo vista={vista} grupo={null} escribir={escribir} alCerrar={() => setDialogo(null)} /> : null}
      {dialogo?.tipo === 'grupo' ? <FormularioDeGrupo vista={vista} grupo={dialogo.grupo} escribir={escribir} alCerrar={() => setDialogo(null)} /> : null}
      {dialogo?.tipo === 'borrar-grupo' ? (
        <Confirmacion
          titulo={`Eliminar el subgrupo «${dialogo.grupo.nombre}»`}
          textoConfirmar="Eliminar subgrupo"
          textoEnviando="Eliminando…"
          peligroso
          alCerrar={() => setDialogo(null)}
          alConfirmar={async () => {
            await escribir(`Eliminar «${dialogo.grupo.nombre}»`, 'DELETE', `/api/cronogramas/${k.id}/grupos/${dialogo.grupo.id}`);
            setDialogo(null);
          }}
        >
          <p>Se eliminará el subgrupo «{dialogo.grupo.nombre}». Si tiene hitos o trámites, el sistema no lo permitirá: muévalos a otro subgrupo o elimínelos antes.</p>
        </Confirmacion>
      ) : null}
      {dialogo?.tipo === 'fecha' ? <CambiarFechaDeInicio vista={vista} escribir={escribir} alCerrar={() => setDialogo(null)} /> : null}
      {dialogo?.tipo === 'calendario' ? <CalendarioDeLaObra vista={vista} escribir={escribir} alCerrar={() => setDialogo(null)} /> : null}
      {dialogo?.tipo === 'lineas-base' ? (
        <LineasBase
          vista={vista}
          estado={proyecto.estado}
          mostrada={lineaBase}
          escribir={escribir}
          alCerrar={() => setDialogo(null)}
          alConflicto={(e) => { if (hayVista(e.cuerpo)) poner(e.cuerpo.cronograma); }}
          alCambiar={(aviso, mostrar) => {
            if (aviso) avisar(aviso);
            if (mostrar !== undefined && mostrar !== lineaBase) setLineaBase(mostrar);
            else void leer(lineaBase);
          }}
        />
      ) : null}
      {dialogo?.tipo === 'exportar' ? <Exportar vista={vista} lineaBase={lineaBase} alCerrar={() => setDialogo(null)} /> : null}
    </div>
  );
}

// --- Las franjas de arriba ------------------------------------------------------------------

interface PropsFranjas {
  vista: VistaCronograma;
  cerrado: boolean;
  rechazado: Rechazado | null;
  errorGeneral: string | null;
  puedeCerrarAviso: boolean;
  alDescartarRechazo: () => void;
  alQuitarError: () => void;
  alCerrarAviso: () => Promise<void>;
  alCopiarFestivos: () => void;
  alIr: (id: string) => void;
}

/**
 * El aviso de la administración (D-93) en un solo renglón, al lado de las
 * pestañas (pedido del dueño, 22 de octubre de 2026): la obra termina más
 * tarde que la línea base y la administración del presupuesto no cambió.
 * Si no cabe, se corta con puntos suspensivos y el texto entero queda en el
 * título; en pantalla angosta baja debajo de las pestañas.
 */
function AvisoDeAdministracion({ vista }: { vista: VistaCronograma }) {
  const formato = useSesion().arranque.formatoNumerico;
  const adm = vista.avisos.administracion;
  if (!adm) return null;
  const nombreBase = vista.lineasBase.find((l) => l.id === adm.lineaBaseId)?.nombre ?? vista.lineaBase?.nombre ?? '';
  const texto = `Termina ${dias(adm.diasDeMas, formato)} días después que «${nombreBase}» (${fechaCorta(adm.finLineaBase)} → ${fechaCorta(adm.finActual)}): la administración del presupuesto sigue igual.`;
  return (
    <p className="aviso-de-administracion" role="note" title={texto}>
      <Icono nombre="reloj" tamano={16} />
      <span>{texto}</span>
    </p>
  );
}

function Franjas({ vista, cerrado, rechazado, errorGeneral, puedeCerrarAviso, alDescartarRechazo, alQuitarError, alCerrarAviso, alCopiarFestivos, alIr }: PropsFranjas) {
  const { arranque } = useSesion();
  const formato = arranque.formatoNumerico;
  const [rehaciendo, setRehaciendo] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [errorAviso, setErrorAviso] = useState<string | null>(null);
  const p = vista.avisos.presupuesto;
  const f = vista.avisos.festivos;
  const d = (t: string) => dias(t, formato);
  const lista = (xs: { id: string; codigo: string; nombre: string }[]) => (
    <ul className="lista-en-franja">
      {xs.map((x) => <li key={x.id}><button type="button" className="enlace-de-actividad" onClick={() => alIr(x.id)}><span className="cifra-codigo">{x.codigo}</span> {x.nombre}</button></li>)}
    </ul>
  );

  return (
    <>
      {cerrado ? (
        <p className="franja-de-estado" role="note"><Icono nombre="candado" /><span>El proyecto está Cerrado: el cronograma es de solo lectura.</span></p>
      ) : null}
      {errorGeneral ? (
        <div className="aviso-error" role="alert">
          <Icono nombre="aviso" />
          <span>{errorGeneral}</span>
          <button type="button" className="boton-icono" aria-label="Cerrar aviso" onClick={alQuitarError}><Icono nombre="cerrar" /></button>
        </div>
      ) : null}
      {rechazado ? (
        <div className="franja franja-conflicto" role="alert">
          <Icono nombre="aviso" />
          <div className="franja-texto">
            <p className="franja-titulo">{rechazado.mensaje}</p>
            <p>Su cambio era: <strong>{rechazado.descripcion}</strong>. Revise la versión nueva y, si sigue valiendo, vuelva a aplicarlo.</p>
          </div>
          <div className="fila-de-botones">
            <button type="button" className="boton boton-secundario" onClick={alDescartarRechazo} disabled={rehaciendo}>Descartar mi cambio</button>
            <button
              type="button"
              className="boton boton-secundario"
              disabled={rehaciendo}
              onClick={async () => {
                setRehaciendo(true);
                try { await rechazado.rehacer(); } catch { /* el rechazo nuevo ya quedó en su lugar */ } finally { setRehaciendo(false); }
              }}
            >
              {rehaciendo ? 'Aplicando…' : 'Aplicar mi cambio de nuevo'}
            </button>
          </div>
        </div>
      ) : null}
      {p ? (
        <div className="franja franja-presupuesto" role="region" aria-label="El presupuesto cambió">
          <Icono nombre="presupuestos" />
          <div className="franja-texto">
            <p className="franja-titulo">El presupuesto cambió desde el último cálculo</p>
            <p className="dato-de-apoyo">Último cambio del presupuesto: <time dateTime={p.ultimoCambio}>{formatearFechaYHora(p.ultimoCambio)}</time>. El cronograma ya se recalculó.</p>
            <dl className="franja-cambios">
              {p.entraron.length > 0 ? <div><dt>Entraron, sin relaciones <span className="pestana-conteo">{p.entraron.length}</span></dt><dd>{lista(p.entraron)}</dd></div> : null}
              {p.salieron.length > 0 ? <div><dt>Salieron <span className="pestana-conteo">{p.salieron.length}</span></dt><dd>{lista(p.salieron)}</dd></div> : null}
              {p.duracionesCambiadas.length > 0 ? (
                <div>
                  <dt>Cambiaron de duración <span className="pestana-conteo">{p.duracionesCambiadas.length}</span></dt>
                  <dd>
                    <ul className="lista-en-franja">
                      {p.duracionesCambiadas.map((x) => (
                        <li key={x.id} className="cambio-de-duracion"><button type="button" className="enlace-de-actividad" onClick={() => alIr(x.id)}><span className="cifra-codigo">{x.codigo}</span> {x.nombre}</button><span className="cifra-en-texto">{d(x.antesDias)} → {d(x.ahoraDias)} días</span></li>
                      ))}
                    </ul>
                  </dd>
                </div>
              ) : null}
              {p.finAntes !== p.finAhora ? <div><dt>Fin del proyecto</dt><dd>{fechaConDia(p.finAntes)} → {fechaConDia(p.finAhora)}</dd></div> : null}
              {p.valorTotalAntes !== p.valorTotalAhora ? <div><dt>Valor total</dt><dd className="cifra-en-texto">{formatearNumero(p.valorTotalAntes, formato)} → {formatearNumero(p.valorTotalAhora, formato)}</dd></div> : null}
            </dl>
            {errorAviso ? <p className="campo-error" role="alert">{errorAviso}</p> : null}
          </div>
          {puedeCerrarAviso ? (
            <button
              type="button"
              className="boton boton-secundario"
              disabled={cerrando}
              onClick={async () => {
                setCerrando(true);
                setErrorAviso(null);
                try { await alCerrarAviso(); } catch (e) { setErrorAviso(mensaje(e, 'No se cerró el aviso.')); } finally { setCerrando(false); }
              }}
            >
              {cerrando ? 'Cerrando…' : 'Entendido, cerrar aviso'}
            </button>
          ) : null}
        </div>
      ) : null}
      {f ? (
        <div className="franja franja-aviso" role="note">
          <Icono nombre="calendario" />
          <p className="franja-texto">
            El proyecto termina el {fechaConDia(f.finDelProyecto)}, y el calendario de la obra tiene festivos solo hasta {f.hasta}: los días de después no descuentan festivos.
          </p>
          {vista.cronograma.editable ? <button type="button" className="boton boton-secundario" onClick={alCopiarFestivos}>Copiar festivos</button> : null}
        </div>
      ) : null}
      {/* El aviso de la administración no va aquí: va en el renglón de las
          pestañas (AvisoDeAdministracion), y el Gantt gana un renglón. */}
    </>
  );
}

function Leyenda({ conBase }: { conBase: boolean }) {
  return (
    <ul className="leyenda leyenda-gantt" aria-label="Leyenda del Gantt">
      <li><span className="leyenda-barra" data-tipo="normal" />Actividad</li>
      <li><span className="leyenda-barra" data-tipo="critica" />Crítica (holgura ≤ 0)</li>
      <li><span className="leyenda-barra" data-tipo="ADMINISTRACION" />Administración</li>
      <li><span className="leyenda-barra" data-tipo="resumen" />Capítulo o grupo</li>
      <li><span className="leyenda-rombo" data-tipo="HITO_INICIO" />Hito de inicio</li>
      <li><span className="leyenda-rombo" data-tipo="HITO_FIN" />Hito de fin</li>
      {conBase ? <li><span className="leyenda-barra" data-tipo="base" />Línea base</li> : null}
      <li><span className="leyenda-barra" data-tipo="mitad" />Termina a mitad de jornada</li>
      <li><span className="leyenda-barra" data-tipo="no-laborable" />No laborable</li>
    </ul>
  );
}

// --- Crear el cronograma (RF-PRG-01) ------------------------------------------------------------

function CrearCronograma({ proyecto, alCrear }: { proyecto: FilaDePresupuesto; alCrear: (v: VistaCronograma) => void }) {
  const { puedeEscribir, arranque } = useSesion();
  const formato = arranque.formatoNumerico;
  const puedeCrear = puedeEscribir('PRESUPUESTOS.EDITAR') && proyecto.estado !== 'CERRADO';
  const [calendarios, setCalendarios] = useState<CalendarioResumen[] | null>(null);
  const [fecha, setFecha] = useState(hoy());
  const [calendarioId, setCalendarioId] = useState('');
  const [errores, setErrores] = useState<{ fechaInicio?: string; calendarioId?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!puedeCrear) return;
    pedir<{ calendarios: CalendarioResumen[] }>('/api/calendarios')
      .then((r) => { setCalendarios(r.calendarios); setCalendarioId(r.calendarios.find((c) => c.porDefecto)?.id ?? r.calendarios[0]?.id ?? ''); })
      .catch((e: unknown) => setError(mensaje(e, 'No se pudieron leer los calendarios de la empresa.')));
  }, [puedeCrear]);

  async function crear() {
    if (enviando) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) { setErrores({ fechaInicio: 'Elija la fecha de inicio de la obra.' }); return; }
    setEnviando(true);
    setError(null);
    try {
      alCrear(await pedir<VistaCronograma>(`/api/presupuestos/${encodeURIComponent(proyecto.id)}/cronograma`, { metodo: 'POST', cuerpo: { fechaInicio: fecha, ...(calendarioId ? { calendarioId } : {}) } }));
    } catch (e) {
      setEnviando(false);
      if (e instanceof ErrorDeApi && (e.campo === 'fechaInicio' || e.campo === 'calendarioId')) setErrores({ [e.campo]: e.message });
      else setError(mensaje(e, 'No se creó el cronograma. Intente de nuevo.'));
    }
  }

  return (
    <div className="cronograma cronograma-suelto">
      <div className="encabezado-con-volver">
        <BotonVolver a={{ pantalla: 'mesa', id: proyecto.id }} nombre="Mesa de trabajo" />
        <h1>Cronograma <span className="titulo-de-cronograma-proyecto">· {proyecto.codigo} {proyecto.nombre}</span></h1>
      </div>
      <section className="tarjeta crear-cronograma">
        <h2>Este proyecto todavía no tiene cronograma</h2>
        <p>
          Al crearlo nace con una actividad por cada ítem del presupuesto, con los capítulos como barras resumen, la tarea «Administración y
          supervisión de obra» y los hitos de inicio y fin del proyecto. Nace sin relaciones: las define usted.
        </p>
        <p className="dato-de-apoyo">La duración de cada actividad sale del rendimiento de su APU. El calendario elegido se copia al proyecto: cambiar el de la empresa después no lo mueve.</p>
        {puedeCrear ? (
          <form className="formulario" noValidate onSubmit={(e) => { e.preventDefault(); void crear(); }}>
            <div className="fila-de-campos">
              <Campo etiqueta="Fecha de inicio de la obra" error={errores.fechaInicio}>
                {(a) => <input {...a} type="date" value={fecha} onChange={(e) => { setFecha(e.target.value); setErrores({}); }} />}
              </Campo>
              <Campo etiqueta="Calendario" error={errores.calendarioId}>
                {(a) => (
                  <select {...a} value={calendarioId} disabled={calendarios === null} onChange={(e) => setCalendarioId(e.target.value)}>
                    {calendarios === null ? <option value="">Cargando…</option> : null}
                    {(calendarios ?? []).map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.porDefecto ? ' (por defecto)' : ''} · {resumenDeCalendario(c, formato)}</option>)}
                  </select>
                )}
              </Campo>
            </div>
            {error ? <p className="aviso-error" role="alert"><Icono nombre="aviso" /><span>{error}</span></p> : null}
            <div className="fila-de-botones fila-izquierda">
              <button type="submit" className="boton boton-principal" disabled={enviando || calendarios === null}>
                <Icono nombre="gantt" />
                {enviando ? 'Calculando…' : 'Crear cronograma'}
              </button>
            </div>
          </form>
        ) : (
          <p className="nota-de-capa"><Icono nombre="candado" tamano={18} /><span>{proyecto.estado === 'CERRADO' ? 'El proyecto está Cerrado: ya no se le puede crear un cronograma.' : 'Su rol puede ver los cronogramas, pero no crearlos.'}</span></p>
        )}
      </section>
    </div>
  );
}
