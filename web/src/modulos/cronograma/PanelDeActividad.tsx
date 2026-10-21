import { useEffect, useState, type FormEvent } from 'react';
import { ErrorDeApi } from '../../api/cliente.ts';
import type { Actividad, Dependencia, TipoDeRelacion, TipoDeRestriccion, VistaCronograma } from '../../api/tiposCronograma.ts';
import { Buscador } from '../../componentes/Buscador.tsx';
import { Campo } from '../../componentes/Campo.tsx';
import { Confirmacion } from '../../componentes/Confirmacion.tsx';
import { Icono } from '../../componentes/Icono.tsx';
import { PanelLateral } from '../../componentes/PanelLateral.tsx';
import { paraEditar, soloCifra } from '../../entrada.ts';
import { formatearNumero } from '../../formato.ts';
import { useSesion } from '../../sesion.tsx';
import { cicloDe, mensaje, yaAtendido, type Escribir } from './escritura.ts';
import { esHito, esHitoOTramite, NOMBRE_DE_RELACION, NOMBRE_DE_RESTRICCION, NOMBRE_DE_TIPO, principalesPosibles, secundariasPosibles, ventanaInvertida } from './filas.ts';
import { dias, diasParaEditar, entero, esNegativo, fechaConDia, fechaYHora, leerDias } from './tiempo.ts';

/*
 * El panel de una actividad (RF-PRG-02, RF-PRG-04): no modal, al lado del
 * Gantt, para que la barra que se está editando siga a la vista. Lo que se
 * puede cambiar depende del tipo (CONTRATO §19.6): de una actividad del
 * presupuesto, las cuadrillas, la duración manual y las restricciones; su
 * nombre y su número son los del ítem.
 *
 * Cada «Guardar» manda solo lo que cambió, y la respuesta es el cronograma
 * entero ya recalculado: las fechas de este panel cambian solas.
 */

interface Props {
  actividad: Actividad;
  vista: VistaCronograma;
  escribir: Escribir;
  alSeleccionar: (id: string) => void;
  alCerrar: () => void;
}

export function PanelDeActividad({ actividad: a, vista, escribir, alSeleccionar, alCerrar }: Props) {
  const { arranque } = useSesion();
  const formato = arranque.formatoNumerico;
  const editable = vista.cronograma.editable;
  const k = vista.cronograma.id;
  const base = vista.lineaBase?.actividades.find((x) => x.actividadId === a.id) ?? null;
  const [borrando, setBorrando] = useState(false);
  const [errorDeOrden, setErrorDeOrden] = useState<string | null>(null);

  const hermanos = esHitoOTramite(a) ? vista.actividades.filter((x) => esHitoOTramite(x) && x.grupoId === a.grupoId).sort((x, y) => x.orden - y.orden) : [];
  const posicion = hermanos.findIndex((x) => x.id === a.id) + 1;
  const borrable = esHitoOTramite(a) || (a.tipo === 'ITEM' && !a.enPresupuesto);

  async function mover(paso: 1 | -1) {
    setErrorDeOrden(null);
    try {
      await escribir(`Mover ${a.codigo}`, 'PUT', `/api/cronogramas/${k}/actividades/${a.id}/posicion`, { posicion: posicion + paso });
    } catch (e) {
      if (!yaAtendido(e)) setErrorDeOrden(mensaje(e, 'No se movió la actividad.'));
    }
  }

  return (
    <PanelLateral titulo={`${a.codigo} · ${a.nombre}`} alCerrar={alCerrar}>
      <div className="panel-de-actividad">
        <p className="panel-de-actividad-tipo">
          <span className="insignia">{NOMBRE_DE_TIPO[a.tipo]}</span>
          {a.critica ? <span className="insignia insignia-critica">Crítica</span> : null}
          {a.tipo === 'ITEM' && !a.enPresupuesto ? <span className="insignia insignia-aviso">Ya no está en el presupuesto</span> : null}
        </p>
        {a.tipo === 'ITEM' && !a.enPresupuesto ? (
          <p className="nota-de-capa"><Icono nombre="aviso" tamano={18} /><span>Su ítem salió del presupuesto. Se deja aquí para que vea qué cadena se rompe: revise sus relaciones y elimínela cuando termine.</span></p>
        ) : null}
        {a.tipo === 'ADMINISTRACION' ? (
          <p className="dato-de-apoyo">Va del inicio de la primera actividad del presupuesto al fin de la última, sin contar hitos ni trámites. No lleva relaciones ni restricciones, y su costo es la administración del AIU.</p>
        ) : null}

        <Fechas a={a} formato={formato} />
        {base ? (
          <dl className="datos-de-panel">
            <div><dt>Línea base «{vista.lineaBase?.nombre}»</dt><dd>{fechaConDia(base.inicio)} a {fechaConDia(base.fin)}</dd></div>
            <div><dt>Variación del fin</dt><dd className="cifra-en-texto" data-negativa={base.variacionFinDias !== null && !esNegativo(base.variacionFinDias) && /[1-9]/.test(base.variacionFinDias) ? 'si' : 'no'} title="Positiva: termina más tarde que en la línea base">{variacion(base.variacionFinDias, formato)}</dd></div>
          </dl>
        ) : null}

        <Datos key={a.id} a={a} vista={vista} editable={editable} escribir={escribir} />

        {a.tipo !== 'ADMINISTRACION' ? <Relaciones a={a} vista={vista} editable={editable} escribir={escribir} alSeleccionar={alSeleccionar} /> : null}

        {editable && (hermanos.length > 1 || borrable) ? (
          <div className="panel-de-actividad-pie">
            {hermanos.length > 1 ? (
              <span className="fila-de-botones fila-izquierda">
                <button type="button" className="boton boton-secundario boton-chico-texto" disabled={posicion <= 1} onClick={() => void mover(-1)}><Icono nombre="subir" tamano={16} />Subir</button>
                <button type="button" className="boton boton-secundario boton-chico-texto" disabled={posicion >= hermanos.length} onClick={() => void mover(1)}><Icono nombre="bajar" tamano={16} />Bajar</button>
              </span>
            ) : <span />}
            {borrable ? (
              <button type="button" className="boton boton-peligroso boton-chico-texto" onClick={() => setBorrando(true)}>
                <Icono nombre="basura" tamano={16} />
                Eliminar
              </button>
            ) : null}
          </div>
        ) : null}
        {errorDeOrden ? <p className="aviso-error" role="alert"><Icono nombre="aviso" /><span>{errorDeOrden}</span></p> : null}
      </div>

      {borrando ? (
        <Confirmacion
          titulo={`Eliminar ${a.codigo} · ${a.nombre}`}
          textoConfirmar="Eliminar actividad"
          textoEnviando="Eliminando…"
          peligroso
          alCerrar={() => setBorrando(false)}
          alConfirmar={async () => {
            try {
              await escribir(`Eliminar ${a.codigo}`, 'DELETE', `/api/cronogramas/${k}/actividades/${a.id}`);
              setBorrando(false);
              alCerrar();
            } catch (e) {
              if (yaAtendido(e)) { setBorrando(false); return; }
              throw e;
            }
          }}
        >
          <p>
            Se eliminará del cronograma con sus {relacionesDe(vista, a.id)} relaciones.
            {a.tipo === 'ITEM' ? ' El presupuesto no cambia: el ítem ya había salido de él.' : ''}
          </p>
        </Confirmacion>
      ) : null}
    </PanelLateral>
  );
}

function relacionesDe(vista: VistaCronograma, id: string): number {
  return vista.dependencias.filter((d) => d.predecesoraId === id || d.sucesoraId === id).length;
}

function variacion(texto: string | null, formato: { separadorDecimal: string }): string {
  if (texto === null) return '—';
  if (!/[1-9]/.test(texto)) return 'Sin variación';
  const v = texto.replace('.', formato.separadorDecimal);
  return esNegativo(texto) ? `${v.slice(1)} días antes` : `${v} días después`;
}

function Fechas({ a, formato }: { a: Actividad; formato: { separadorDecimal: string; separadorMiles: string; decimalesVista: number } }) {
  const hito = esHito(a);
  // RN-28: de un hito se muestra solo el día.
  const cuando = (fh: string | null) => (fh === null ? '—' : hito ? fechaConDia(fh) : fechaYHora(fh));
  return (
    <dl className="datos-de-panel">
      <div><dt>{hito ? 'Fecha' : 'Inicio'}</dt><dd>{cuando(a.inicio)}</dd></div>
      {hito ? null : <div><dt>Fin</dt><dd>{cuando(a.fin)}{a.finAMitadDeJornada ? <span className="dato-de-apoyo"> · termina a mitad de jornada</span> : null}</dd></div>}
      {a.tipo === 'ADMINISTRACION' ? null : (
        <>
          <div><dt>{hito ? 'Fecha tardía' : 'Inicio tardío'}</dt><dd>{cuando(a.inicioTardio)}</dd></div>
          {hito ? null : <div><dt>Fin tardío</dt><dd>{cuando(a.finTardio)}</dd></div>}
          <div>
            <dt>Holgura total</dt>
            <dd className="cifra-en-texto" data-negativa={esNegativo(a.holguraTotalDias) ? 'si' : 'no'}>
              {dias(a.holguraTotalDias, formato)} días
              {esNegativo(a.holguraTotalDias) ? <span className="dato-de-apoyo"> · una restricción que la lógica no cumple</span> : null}
            </dd>
          </div>
          <div><dt>Holgura libre</dt><dd className="cifra-en-texto">{dias(a.holguraLibreDias, formato)} días</dd></div>
        </>
      )}
      {hito ? null : <div><dt>Duración</dt><dd className="cifra-en-texto">{dias(a.duracionDias, formato)} días{a.usaCorrido ? ' corridos' : ''}</dd></div>}
      {a.tipo === 'ITEM' || a.tipo === 'ADMINISTRACION' ? <div><dt>Costo</dt><dd className="cifra-en-texto">{formatearNumero(a.costo, formato)}</dd></div> : null}
    </dl>
  );
}

// --- Los datos que se editan ---------------------------------------------------------

interface Forma {
  nombre: string;
  codigo: string;
  cuadrillas: string;
  manual: string;
  usaCorrido: boolean;
  grupoId: string;
  rTipo: TipoDeRestriccion | '';
  rFecha: string;
  sTipo: TipoDeRestriccion | '';
  sFecha: string;
}

function formaDe(a: Actividad, separadorDecimal: string): Forma {
  return {
    nombre: a.nombre,
    codigo: a.codigo,
    cuadrillas: String(a.cuadrillas),
    manual: diasParaEditar(a.duracionManualDias, { separadorDecimal, separadorMiles: '', decimalesVista: 1 }),
    usaCorrido: a.usaCorrido,
    grupoId: a.grupoId ?? '',
    rTipo: a.restriccion?.tipo ?? '',
    rFecha: a.restriccion?.fecha ?? '',
    sTipo: a.restriccionSecundaria?.tipo ?? '',
    sFecha: a.restriccionSecundaria?.fecha ?? '',
  };
}

function Datos({ a, vista, editable, escribir }: { a: Actividad; vista: VistaCronograma; editable: boolean; escribir: Escribir }) {
  const { arranque } = useSesion();
  const formato = arranque.formatoNumerico;
  const [f, setF] = useState<Forma>(() => formaDe(a, formato.separadorDecimal));
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const inicial = formaDe(a, formato.separadorDecimal);
  const sucio = JSON.stringify(f) !== JSON.stringify(inicial);

  // Si la vista cambió por otro lado (otra edición, un 409) y aquí no hay nada
  // escrito, el formulario toma los valores nuevos.
  useEffect(() => {
    if (!sucio) setF(formaDe(a, formato.separadorDecimal));
    // Solo cuando llega otra actividad del servidor, no a cada tecla.
  }, [a]);

  const es = (...tipos: Actividad['tipo'][]) => tipos.includes(a.tipo);
  const conNombre = es('HITO_INICIO', 'HITO_FIN', 'SIN_COSTO', 'ADMINISTRACION');
  const conManual = es('ITEM', 'SIN_COSTO');
  const conRestriccion = es('ITEM', 'HITO_INICIO', 'HITO_FIN', 'SIN_COSTO');
  const principales = principalesPosibles(a);
  const secundarias = secundariasPosibles(a, f.rTipo === '' ? null : f.rTipo);
  const poner = (cambio: Partial<Forma>) => {
    setF((x) => {
      const y = { ...x, ...cambio };
      // Una principal que ya no admite la secundaria la quita (RN-30).
      const posibles = secundariasPosibles(a, y.rTipo === '' ? null : y.rTipo);
      if (y.sTipo !== '' && !posibles.includes(y.sTipo)) y.sTipo = '';
      return y;
    });
    setErrores({});
  };

  if (!editable) return a.restriccion ? <Restricciones a={a} /> : null;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (enviando || !sucio) return;
    const cuerpo: Record<string, unknown> = {};
    const faltan: Record<string, string> = {};
    if (conNombre && f.nombre !== inicial.nombre) {
      if (f.nombre.trim() === '') faltan['nombre'] = 'Escriba el nombre.';
      cuerpo['nombre'] = f.nombre.trim();
    }
    if (conNombre && f.codigo !== inicial.codigo) {
      if (f.codigo.trim() === '') faltan['codigo'] = 'Escriba el código.';
      else if (/^[\d.]+$/.test(f.codigo.trim())) faltan['codigo'] = 'Un código solo de cifras y puntos es el de un ítem del presupuesto. Use letras, como H-003 o T-010.';
      cuerpo['codigo'] = f.codigo.trim();
    }
    if (a.tipo === 'ITEM' && f.cuadrillas !== inicial.cuadrillas) {
      if (!/^\d+$/.test(f.cuadrillas) || !/[1-9]/.test(f.cuadrillas)) faltan['cuadrillas'] = 'Las cuadrillas son un número entero desde 1.';
      else cuerpo['cuadrillas'] = entero(f.cuadrillas.replace(/^0+/, ''));
    }
    if (conManual && f.manual !== inicial.manual) {
      if (f.manual.trim() === '') cuerpo['duracionManualDias'] = null;
      else {
        const l = leerDias(f.manual, { nombre: 'la duración' });
        if ('error' in l) faltan['duracionManualDias'] = l.error;
        else cuerpo['duracionManualDias'] = l.valor;
      }
    }
    if (a.tipo === 'SIN_COSTO' && f.usaCorrido !== inicial.usaCorrido) cuerpo['usaCorrido'] = f.usaCorrido;
    if (esHitoOTramite(a) && f.grupoId !== inicial.grupoId) cuerpo['grupoId'] = f.grupoId === '' ? null : f.grupoId;
    if (conRestriccion && (f.rTipo !== inicial.rTipo || f.rFecha !== inicial.rFecha)) {
      if (f.rTipo === '') cuerpo['restriccion'] = null;
      else if (f.rTipo !== 'LO_MAS_TARDE' && f.rFecha === '') faltan['restriccion.fecha'] = 'Elija la fecha de la restricción.';
      else cuerpo['restriccion'] = { tipo: f.rTipo, fecha: f.rTipo === 'LO_MAS_TARDE' ? null : f.rFecha };
    }
    if (conRestriccion && (f.sTipo !== inicial.sTipo || f.sFecha !== inicial.sFecha || 'restriccion' in cuerpo)) {
      if (f.sTipo === '') { if (inicial.sTipo !== '') cuerpo['restriccionSecundaria'] = null; }
      else if (f.sFecha === '') faltan['restriccionSecundaria.fecha'] = 'Elija la fecha de la restricción secundaria.';
      else cuerpo['restriccionSecundaria'] = { tipo: f.sTipo, fecha: f.sFecha };
    }
    if (f.rTipo !== '' && f.sTipo !== '') {
      const invertida = ventanaInvertida({ tipo: f.rTipo, fecha: f.rFecha || null }, { tipo: f.sTipo, fecha: f.sFecha || null });
      if (invertida) faltan['restriccionSecundaria.fecha'] = invertida;
    }
    setErrores(faltan);
    if (Object.keys(faltan).length > 0) return;
    setEnviando(true);
    setError(null);
    try {
      await escribir(`Cambios en ${a.codigo}`, 'PATCH', `/api/cronogramas/${vista.cronograma.id}/actividades/${a.id}`, cuerpo);
    } catch (err) {
      if (yaAtendido(err)) return;
      if (err instanceof ErrorDeApi && err.campo) setErrores({ [err.campo]: err.message });
      else setError(mensaje(err, 'No se guardó el cambio. Intente de nuevo.'));
    } finally {
      setEnviando(false);
    }
  }

  const calculada = a.tipo === 'ITEM' ? explicarCalculada(a, formato) : null;

  return (
    <form className="formulario panel-de-actividad-datos" onSubmit={(e) => void enviar(e)} noValidate>
      <h3 className="titulo-de-bloque">Datos</h3>
      {conNombre ? (
        <div className="fila-de-campos fila-codigo-nombre">
          <Campo etiqueta="Código" error={errores['codigo']}>
            {(x) => <input {...x} autoComplete="off" spellCheck={false} value={f.codigo} onChange={(e) => poner({ codigo: e.target.value })} />}
          </Campo>
          <Campo etiqueta="Nombre" error={errores['nombre']}>
            {(x) => <input {...x} autoComplete="off" value={f.nombre} onChange={(e) => poner({ nombre: e.target.value })} />}
          </Campo>
        </div>
      ) : null}
      {a.tipo === 'ITEM' ? (
        <>
          <p className="dato-de-apoyo">{calculada}</p>
          <Campo etiqueta="Cuadrillas" ayuda="Es la palanca para acortar: con dos cuadrillas, la mitad del tiempo." error={errores['cuadrillas']}>
            {(x) => <input {...x} className="campo-cifra-corto" inputMode="numeric" autoComplete="off" value={f.cuadrillas} onChange={(e) => poner({ cuadrillas: e.target.value.replace(/\D/g, '') })} />}
          </Campo>
        </>
      ) : null}
      {conManual ? (
        <Campo
          etiqueta={`Duración ${a.tipo === 'ITEM' ? 'manual ' : ''}(días${f.usaCorrido ? ' corridos' : ''})`}
          ayuda={a.tipo === 'ITEM' ? 'Si la escribe, manda sobre la calculada. Vacía, vale la calculada.' : 'Con un decimal como máximo.'}
          error={errores['duracionManualDias']}
        >
          {(x) => <input {...x} className="campo-cifra-corto" inputMode="decimal" autoComplete="off" value={f.manual} onChange={(e) => poner({ manual: soloCifra(e.target.value, formato.separadorDecimal) })} />}
        </Campo>
      ) : null}
      {a.tipo === 'SIN_COSTO' ? (
        <label className="casilla">
          <input type="checkbox" checked={f.usaCorrido} onChange={(e) => poner({ usaCorrido: e.target.checked })} />
          <span>Corre todos los días, 24 horas (curados, fabricación, trámites)</span>
        </label>
      ) : null}
      {esHitoOTramite(a) && vista.grupos.length > 0 ? (
        <Campo etiqueta="Subgrupo" error={errores['grupoId']}>
          {(x) => (
            <select {...x} value={f.grupoId} onChange={(e) => poner({ grupoId: e.target.value })}>
              <option value="">Hitos y trámites (sin subgrupo)</option>
              {[...vista.grupos].sort((p, q) => p.orden - q.orden).map((g) => <option key={g.id} value={g.id}>{g.nombre}</option>)}
            </select>
          )}
        </Campo>
      ) : null}

      {conRestriccion ? (
        <fieldset className="grupo-de-restricciones">
          <legend className="titulo-de-bloque">Restricciones</legend>
          <div className="fila-de-campos">
            <Campo etiqueta="Principal" error={errores['restriccion.tipo']}>
              {(x) => (
                <select {...x} value={f.rTipo} onChange={(e) => poner({ rTipo: e.target.value as TipoDeRestriccion | '' })}>
                  <option value="">Sin restricción</option>
                  {principales.map((t) => <option key={t} value={t}>{NOMBRE_DE_RESTRICCION[t]}</option>)}
                </select>
              )}
            </Campo>
            {f.rTipo !== '' && f.rTipo !== 'LO_MAS_TARDE' ? (
              <Campo etiqueta="Fecha" error={errores['restriccion.fecha']}>
                {(x) => <input {...x} type="date" value={f.rFecha} onChange={(e) => poner({ rFecha: e.target.value })} />}
              </Campo>
            ) : null}
          </div>
          {secundarias.length > 0 ? (
            <div className="fila-de-campos">
              <Campo etiqueta="Secundaria" error={errores['restriccionSecundaria.tipo']}>
                {(x) => (
                  <select {...x} value={f.sTipo} onChange={(e) => poner({ sTipo: e.target.value as TipoDeRestriccion | '' })}>
                    <option value="">Sin restricción</option>
                    {secundarias.map((t) => <option key={t} value={t}>{NOMBRE_DE_RESTRICCION[t]}</option>)}
                  </select>
                )}
              </Campo>
              {f.sTipo !== '' ? (
                <Campo etiqueta="Fecha" error={errores['restriccionSecundaria.fecha']}>
                  {(x) => <input {...x} type="date" value={f.sFecha} onChange={(e) => poner({ sFecha: e.target.value })} />}
                </Campo>
              ) : null}
            </div>
          ) : f.rTipo !== '' ? <p className="dato-de-apoyo">«{NOMBRE_DE_RESTRICCION[f.rTipo]}» no admite restricción secundaria.</p> : null}
          <p className="campo-ayuda">Las de inicio toman el comienzo de la jornada y las de fin, el cierre. Las obligatorias pasan por encima de la lógica.</p>
        </fieldset>
      ) : null}

      {error ? <p className="aviso-error" role="alert"><Icono nombre="aviso" /><span>{error}</span></p> : null}
      <div className="fila-de-botones fila-izquierda">
        <button type="submit" className="boton boton-principal" disabled={enviando || !sucio}>{enviando ? 'Recalculando…' : 'Guardar cambios'}</button>
        {sucio ? <button type="button" className="boton boton-secundario" disabled={enviando} onClick={() => { setF(inicial); setErrores({}); }}>Deshacer</button> : null}
      </div>
    </form>
  );
}

function explicarCalculada(a: Actividad, formato: { separadorDecimal: string; separadorMiles: string; decimalesVista: number }): string {
  if (a.rendimiento === null) return 'El APU de esta actividad no tiene rendimiento: escriba la duración a mano, o póngale rendimiento al APU.';
  const cuadrillas = a.cuadrillas === 1 ? '1 cuadrilla' : `${a.cuadrillas} cuadrillas`;
  return `Calculada: ${dias(a.duracionCalculadaDias, formato)} días. Son ${formatearNumero(a.cantidad, formato)} ${a.unidad ?? ''} a ${paraEditar(a.rendimiento, formato)} por jornal, con ${cuadrillas}.`;
}

function Restricciones({ a }: { a: Actividad }) {
  const r = (x: Actividad['restriccion']) => (x ? `${NOMBRE_DE_RESTRICCION[x.tipo]}${x.fecha ? ` ${fechaConDia(x.fecha)}` : ''}` : null);
  return (
    <dl className="datos-de-panel">
      <div><dt>Restricción</dt><dd>{r(a.restriccion)}</dd></div>
      {a.restriccionSecundaria ? <div><dt>Secundaria</dt><dd>{r(a.restriccionSecundaria)}</dd></div> : null}
    </dl>
  );
}

// --- Las relaciones (RF-PRG-04) ------------------------------------------------------------

const TIPOS: TipoDeRelacion[] = ['FC', 'CC', 'FF', 'CF'];

function Relaciones({ a, vista, editable, escribir, alSeleccionar }: { a: Actividad; vista: VistaCronograma; editable: boolean; escribir: Escribir; alSeleccionar: (id: string) => void }) {
  const porId = new Map(vista.actividades.map((x) => [x.id, x]));
  const predecesoras = vista.dependencias.filter((d) => d.sucesoraId === a.id);
  const sucesoras = vista.dependencias.filter((d) => d.predecesoraId === a.id);
  return (
    <section className="relaciones" aria-labelledby={`rel-${a.id}`}>
      <h3 className="titulo-de-bloque" id={`rel-${a.id}`}>Relaciones</h3>
      <ListaDeRelaciones titulo="Predecesoras" vacio="Sin predecesoras: arranca en la fecha de inicio del cronograma." lado="pred" deps={predecesoras} porId={porId} a={a} vista={vista} editable={editable} escribir={escribir} alSeleccionar={alSeleccionar} />
      <ListaDeRelaciones titulo="Sucesoras" vacio="Sin sucesoras: se mide contra el fin del proyecto." lado="suc" deps={sucesoras} porId={porId} a={a} vista={vista} editable={editable} escribir={escribir} alSeleccionar={alSeleccionar} />
    </section>
  );
}

interface PropsLista {
  titulo: string;
  vacio: string;
  lado: 'pred' | 'suc';
  deps: Dependencia[];
  porId: Map<string, Actividad>;
  a: Actividad;
  vista: VistaCronograma;
  editable: boolean;
  escribir: Escribir;
  alSeleccionar: (id: string) => void;
}

function ListaDeRelaciones({ titulo, vacio, lado, deps, porId, a, vista, editable, escribir, alSeleccionar }: PropsLista) {
  const { arranque } = useSesion();
  const formato = arranque.formatoNumerico;
  const [agregando, setAgregando] = useState(false);
  return (
    <div className="lista-de-relaciones">
      <div className="lista-de-relaciones-cabecera">
        <h4>{titulo} {deps.length > 0 ? <span className="pestana-conteo">{deps.length}</span> : null}</h4>
        {editable && !agregando ? (
          <button type="button" className="boton boton-secundario boton-chico-texto" onClick={() => setAgregando(true)}>
            <Icono nombre="enlace" tamano={16} />
            Agregar
          </button>
        ) : null}
      </div>
      {deps.length === 0 && !agregando ? <p className="dato-de-apoyo">{vacio}</p> : null}
      <ul>
        {deps.map((d) => {
          const otra = porId.get(lado === 'pred' ? d.predecesoraId : d.sucesoraId);
          return otra ? <Relacion key={d.id} d={d} otra={otra} vista={vista} editable={editable} escribir={escribir} alSeleccionar={alSeleccionar} formato={formato} /> : null;
        })}
      </ul>
      {agregando ? <NuevaRelacion lado={lado} a={a} vista={vista} escribir={escribir} alCerrar={() => setAgregando(false)} /> : null}
    </div>
  );
}

function Relacion({ d, otra, vista, editable, escribir, alSeleccionar, formato }: { d: Dependencia; otra: Actividad; vista: VistaCronograma; editable: boolean; escribir: Escribir; alSeleccionar: (id: string) => void; formato: { separadorDecimal: string } }) {
  const [tipo, setTipo] = useState<TipoDeRelacion>(d.tipo);
  const [desfase, setDesfase] = useState(d.desfaseDias.replace('.', formato.separadorDecimal));
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const original = d.desfaseDias.replace('.', formato.separadorDecimal);
  const sucio = tipo !== d.tipo || desfase !== original;
  const ruta = `/api/cronogramas/${vista.cronograma.id}/dependencias/${d.id}`;

  useEffect(() => {
    setTipo(d.tipo);
    setDesfase(d.desfaseDias.replace('.', formato.separadorDecimal));
  }, [d, formato.separadorDecimal]);

  async function guardar() {
    const cuerpo: Record<string, unknown> = {};
    if (tipo !== d.tipo) cuerpo['tipo'] = tipo;
    if (desfase !== original) {
      const l = leerDias(desfase, { negativo: true, nombre: 'el desfase' });
      if ('error' in l) { setError(l.error); return; }
      cuerpo['desfaseDias'] = l.valor;
    }
    setEnviando(true);
    setError(null);
    try {
      await escribir(`Relación con ${otra.codigo}`, 'PATCH', ruta, cuerpo);
    } catch (e) {
      if (!yaAtendido(e)) setError(mensaje(e, 'No se guardó la relación.'));
    } finally {
      setEnviando(false);
    }
  }

  async function quitar() {
    setEnviando(true);
    setError(null);
    try {
      await escribir(`Quitar la relación con ${otra.codigo}`, 'DELETE', ruta);
    } catch (e) {
      if (!yaAtendido(e)) setError(mensaje(e, 'No se quitó la relación.'));
      setEnviando(false);
    }
  }

  return (
    <li className="relacion">
      <button type="button" className="enlace-de-actividad" onClick={() => alSeleccionar(otra.id)} title="Ir a esta actividad">
        <span className="cifra-codigo">{otra.codigo}</span>
        <span className="relacion-nombre">{otra.nombre}</span>
      </button>
      {editable ? (
        <span className="relacion-controles">
          <select aria-label={`Tipo de relación con ${otra.codigo}`} value={tipo} onChange={(e) => setTipo(e.target.value as TipoDeRelacion)}>
            {TIPOS.map((t) => <option key={t} value={t} title={NOMBRE_DE_RELACION[t]}>{t}</option>)}
          </select>
          <input aria-label={`Desfase con ${otra.codigo}, en días`} className="campo-desfase" inputMode="decimal" autoComplete="off" value={desfase} onChange={(e) => setDesfase(e.target.value.replace(/[^\d,.-]/g, ''))} />
          <span className="dato-de-apoyo" aria-hidden="true">d</span>
          {sucio ? <button type="button" className="boton boton-secundario boton-chico-texto" disabled={enviando} onClick={() => void guardar()}>Guardar</button> : null}
          <button type="button" className="boton-icono boton-chico boton-icono-peligro" aria-label={`Quitar la relación con ${otra.codigo}`} title="Quitar" disabled={enviando} onClick={() => void quitar()}>
            <Icono nombre="cerrar" tamano={16} />
          </button>
        </span>
      ) : (
        <span className="dato-de-apoyo">{d.tipo}{/[1-9]/.test(d.desfaseDias) ? ` ${d.desfaseDias.startsWith('-') ? '' : '+'}${d.desfaseDias.replace('.', formato.separadorDecimal)} d` : ''}</span>
      )}
      {error ? <p className="campo-error" role="alert">{error}</p> : null}
    </li>
  );
}

function NuevaRelacion({ lado, a, vista, escribir, alCerrar }: { lado: 'pred' | 'suc'; a: Actividad; vista: VistaCronograma; escribir: Escribir; alCerrar: () => void }) {
  const [otra, setOtra] = useState<Actividad | null>(null);
  const [tipo, setTipo] = useState<TipoDeRelacion>('FC');
  const [desfase, setDesfase] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const ya = new Set(vista.dependencias.filter((d) => (lado === 'pred' ? d.sucesoraId === a.id : d.predecesoraId === a.id)).map((d) => (lado === 'pred' ? d.predecesoraId : d.sucesoraId)));
  const candidatas = vista.actividades.filter((x) => x.id !== a.id && x.tipo !== 'ADMINISTRACION');

  async function agregar() {
    if (!otra || enviando) return;
    const l = leerDias(desfase, { negativo: true, nombre: 'el desfase' });
    if ('error' in l) { setError(l.error); return; }
    setEnviando(true);
    setError(null);
    const predecesoraId = lado === 'pred' ? otra.id : a.id;
    const sucesoraId = lado === 'pred' ? a.id : otra.id;
    try {
      await escribir(`Relación ${lado === 'pred' ? `${otra.codigo} → ${a.codigo}` : `${a.codigo} → ${otra.codigo}`}`, 'POST', `/api/cronogramas/${vista.cronograma.id}/dependencias`, { predecesoraId, sucesoraId, tipo, desfaseDias: l.valor });
      alCerrar();
    } catch (e) {
      setEnviando(false);
      if (yaAtendido(e)) return;
      // Un círculo: la pantalla ya marcó sus filas en el Gantt; aquí va el texto.
      setError(cicloDe(e) ? `${mensaje(e, '')} Las actividades del círculo quedaron marcadas en la tabla.` : mensaje(e, 'No se agregó la relación.'));
    }
  }

  const normal = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return (
    <div className="nueva-relacion">
      {otra ? (
        <p className="nueva-relacion-elegida">
          <span className="cifra-codigo">{otra.codigo}</span> {otra.nombre}
          <button type="button" className="boton-icono boton-chico" aria-label="Elegir otra actividad" onClick={() => setOtra(null)}><Icono nombre="cerrar" tamano={16} /></button>
        </p>
      ) : (
        <Buscador<Actividad>
          etiqueta={lado === 'pred' ? 'Predecesora: busque por código o nombre' : 'Sucesora: busque por código o nombre'}
          buscar={async (texto) => {
            const t = normal(texto);
            return candidatas.filter((x) => normal(x.codigo).includes(t) || normal(x.nombre).includes(t)).slice(0, 20);
          }}
          clave={(x) => x.id}
          deshabilitada={(x) => (ya.has(x.id) ? 'Ya está relacionada' : null)}
          pintar={(x) => (
            <span className="opcion-de-busqueda">
              <span className="cifra-codigo">{x.codigo}</span>
              <span className="opcion-de-busqueda-nombre">{x.nombre}</span>
            </span>
          )}
          alElegir={setOtra}
        />
      )}
      <div className="fila-de-campos fila-de-relacion">
        <Campo etiqueta="Tipo">
          {(x) => (
            <select {...x} value={tipo} onChange={(e) => setTipo(e.target.value as TipoDeRelacion)}>
              {TIPOS.map((t) => <option key={t} value={t}>{NOMBRE_DE_RELACION[t]}</option>)}
            </select>
          )}
        </Campo>
        <Campo etiqueta="Desfase (días)">
          {(x) => <input {...x} className="campo-desfase" inputMode="decimal" autoComplete="off" value={desfase} onChange={(e) => setDesfase(e.target.value.replace(/[^\d,.-]/g, ''))} />}
        </Campo>
      </div>
      <p className="campo-ayuda">El desfase va negativo para traslapar, y se cuenta en el calendario de la sucesora.</p>
      {error ? <p className="aviso-error" role="alert"><Icono nombre="aviso" /><span>{error}</span></p> : null}
      <div className="fila-de-botones fila-izquierda">
        <button type="button" className="boton boton-secundario" disabled={enviando} onClick={alCerrar}>Cancelar</button>
        <button type="button" className="boton boton-secundario" disabled={!otra || enviando} onClick={() => void agregar()}>{enviando ? 'Recalculando…' : lado === 'pred' ? 'Agregar predecesora' : 'Agregar sucesora'}</button>
      </div>
    </div>
  );
}
