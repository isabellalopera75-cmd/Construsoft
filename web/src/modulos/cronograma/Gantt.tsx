import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Actividad, ActividadDeLineaBase, Calendario, Grupo, VistaCronograma } from '../../api/tiposCronograma.ts';
import { Icono } from '../../componentes/Icono.tsx';
import { useSesion } from '../../sesion.tsx';
import type { Fila } from './filas.ts';
import { diaDe, diaDeLaSemana, diaDelMes, dias, esNegativo, fechaDe, fechaTabla, fechaYHora, mesCorto, mesSiguiente, minutos, minutosDelDia, primeroDelMes } from './tiempo.ts';

/*
 * El Gantt (07 §6.6, RF-PRG-06): la tabla de actividades a la izquierda y las
 * barras a la derecha, en un solo desplazamiento. La tabla queda fija al
 * correr el tiempo de lado, y la escala fija al bajar.
 *
 * DIBUJA SOLO LAS FILAS VISIBLES (RNF-29). Con 1.500 actividades, pintar
 * todas las filas y sus 3.000 flechas a la vez es lo que hace saltar el
 * desplazamiento. Se pintan las que caben en la ventana y unas de margen, y
 * las flechas que cruzan ese tramo. Por eso el alto de la fila es una cifra
 * de aquí y no un token: el cálculo de qué fila cae dónde la necesita, y se
 * le pasa al CSS como variable para que los dos digan lo mismo.
 *
 * De solo lectura (07 §6.6): no se arrastran barras. Un clic en una barra o en
 * una fila la selecciona, y se edita en el panel.
 *
 * La posición es el tiempo real: una barra que termina a las 16:00 llega a dos
 * tercios de su día. Las fechas se cortan del texto (tiempo.ts), nunca pasan
 * por Date.
 */

export type Escala = 'DIA' | 'SEMANA' | 'MES';

/*
 * Las columnas de la tabla se ajustan arrastrando el borde derecho de su
 * encabezado (pedido del dueño, 22 de octubre de 2026). El ancho vive en el
 * estado de la pantalla mientras se está en ella; no se guarda.
 */
export type Columna = 'codigo' | 'actividad' | 'dias' | 'inicio' | 'fin' | 'holgura';
export type Anchos = Record<Columna, number>;
const COLUMNAS: { clave: Columna; nombre: string }[] = [
  { clave: 'codigo', nombre: 'Código' },
  { clave: 'actividad', nombre: 'Actividad' },
  { clave: 'dias', nombre: 'Días' },
  { clave: 'inicio', nombre: 'Inicio' },
  { clave: 'fin', nombre: 'Fin' },
  { clave: 'holgura', nombre: 'Holgura' },
];
export const ANCHOS_INICIALES: Anchos = { codigo: 76, actividad: 236, dias: 52, inicio: 82, fin: 82, holgura: 72 };
const ANCHOS_MINIMOS: Anchos = { codigo: 48, actividad: 120, dias: 44, inicio: 64, fin: 64, holgura: 52 };
const ANCHO_MAXIMO = 640;
const limitar = (c: Columna, ancho: number) => Math.round(Math.min(ANCHO_MAXIMO, Math.max(ANCHOS_MINIMOS[c], ancho)));

/*
 * El alto del Gantt llega hasta el fondo de la ventana (pedido del dueño, 22 de
 * octubre de 2026): así su barra de desplazamiento de lado se ve siempre, sin
 * bajar la página. Con poco espacio arriba, no baja de este mínimo.
 *
 * Con el panel de una actividad abierto (una franja fija al pie), la página
 * sube hasta que el Gantt queda bajo la barra superior, y el Gantt ocupa lo
 * que queda entre la barra y el panel. Si no, con la cabecera y las pestañas
 * arriba, entre ellas y el panel no quedaría casi nada.
 */
const ALTO_MINIMO = 320;
const ALTO_MINIMO_CON_PANEL = 200;
const AIRE = 8;

const ALTO_FILA = 32;
const MARGEN_FILAS = 12;
const PX_POR_DIA: Record<Escala, number> = { DIA: 28, SEMANA: 9, MES: 3 };
const HOLGURA_DIAS: Record<Escala, number> = { DIA: 4, SEMANA: 10, MES: 20 };

interface Props {
  vista: VistaCronograma;
  anchos: Anchos;
  alCambiarAncho: (columna: Columna, ancho: number) => void;
  /** Con el panel de una actividad abierto al pie de la pantalla. */
  conPanel: boolean;
  filas: Fila[];
  escala: Escala;
  seleccion: string | null;
  ciclo: ReadonlySet<string>;
  plegados: ReadonlySet<string>;
  alPlegar: (clave: string) => void;
  alSeleccionar: (id: string) => void;
  accionesDeGrupo?: ((g: Grupo, primero: boolean, ultimo: boolean) => ReactNode) | undefined;
}

export function Gantt({ vista, anchos, alCambiarAncho, conPanel, filas, escala, seleccion, ciclo, plegados, alPlegar, alSeleccionar, accionesDeGrupo }: Props) {
  const { arranque } = useSesion();
  const formato = arranque.formatoNumerico;
  const marco = useRef<HTMLDivElement>(null);
  const [ventana, setVentana] = useState({ arriba: 0, alto: 600 });
  const [altoMaximo, setAltoMaximo] = useState<number | null>(null);
  const enfocar = useRef(false);

  // --- El tramo de tiempo que se dibuja ---------------------------------------
  const inicioSemana = (vista.cronograma.inicioSemana ?? 1) - 1;
  const { desde, hasta } = useMemo(() => {
    let a = diaDe(vista.cronograma.inicio);
    let b = diaDe(vista.cronograma.fin);
    for (const x of vista.lineaBase?.actividades ?? []) {
      a = Math.min(a, diaDe(x.inicio));
      b = Math.max(b, diaDe(x.fin));
    }
    a -= HOLGURA_DIAS[escala];
    b += HOLGURA_DIAS[escala];
    if (escala === 'MES') {
      a = primeroDelMes(a);
      b = mesSiguiente(b) - 1;
    } else {
      a -= (diaDeLaSemana(a) - inicioSemana + 7) % 7;
      b += 6 - ((diaDeLaSemana(b) - inicioSemana + 7) % 7);
    }
    return { desde: a, hasta: b };
  }, [vista, escala, inicioSemana]);
  const px = PX_POR_DIA[escala];
  const anchoTiempo = (hasta - desde + 1) * px;
  // Estable mientras no cambie la escala: así las filas que no cambian no se vuelven a pintar al desplazar.
  const x = useCallback((fechaHora: string) => ((minutos(fechaHora) - desde * 1440) / 1440) * px, [desde, px]);

  // --- Qué filas se ven ------------------------------------------------------------
  useLayoutEffect(() => {
    const el = marco.current;
    if (!el) return;
    const medir = () => setVentana({ arriba: el.scrollTop, alto: el.clientHeight });
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(el);
    return () => observador.disconnect();
  }, []);

  // El alto: desde donde empieza el Gantt hasta el fondo de la ventana, menos
  // lo que la página deja debajo de él. Se mide en la página, no en la
  // ventana, para que no cambie al desplazarla; y otra vez si cambia algo de
  // arriba (una franja que aparece) o el tamaño de la ventana.
  useLayoutEffect(() => {
    const el = marco.current;
    const contenido = document.getElementById('contenido');
    if (!el) return;
    const altoDe = (selector: string) => document.querySelector(selector)?.getBoundingClientRect().height ?? 0;
    const medir = () => {
      const caja = el.getBoundingClientRect();
      if (conPanel) {
        const libre = Math.floor(window.innerHeight - altoDe('.barra-superior') - altoDe('.panel-inferior') - 2 * AIRE);
        setAltoMaximo(Math.max(ALTO_MINIMO_CON_PANEL, libre));
        return;
      }
      const debajo = contenido ? Math.max(0, contenido.getBoundingClientRect().bottom - caja.bottom) : 0;
      const libre = Math.floor(window.innerHeight - (caja.top + window.scrollY) - debajo);
      setAltoMaximo(Math.max(ALTO_MINIMO, libre));
    };
    medir();
    window.addEventListener('resize', medir);
    const observador = new ResizeObserver(medir);
    if (contenido) observador.observe(contenido);
    return () => {
      window.removeEventListener('resize', medir);
      observador.disconnect();
    };
  }, [conPanel]);

  // Al abrir el panel, la página sube hasta dejar el Gantt bajo la barra
  // superior. Solo al abrirlo: cambiar de actividad con el panel abierto no
  // mueve la página.
  useEffect(() => {
    const el = marco.current;
    if (!conPanel || !el) return;
    const barra = document.querySelector('.barra-superior')?.getBoundingClientRect().height ?? 0;
    const destino = el.getBoundingClientRect().top + window.scrollY - barra - AIRE;
    window.requestAnimationFrame(() => window.scrollTo({ top: Math.max(0, destino), behavior: 'smooth' }));
  }, [conPanel]);

  const columnas = COLUMNAS.map((c) => anchos[c.clave]);
  const anchoTabla = columnas.reduce((s, w) => s + w, 0);

  const indice = useMemo(() => {
    const m = new Map<string, number>();
    filas.forEach((f, i) => { if (f.clase === 'actividad') m.set(f.actividad.id, i); });
    return m;
  }, [filas]);

  const primera = Math.max(0, Math.floor(ventana.arriba / ALTO_FILA) - MARGEN_FILAS);
  const ultima = Math.min(filas.length - 1, Math.ceil((ventana.arriba + ventana.alto) / ALTO_FILA) + MARGEN_FILAS);

  // La fila elegida desde afuera (la lista de revisión) se trae a la vista.
  useEffect(() => {
    if (!seleccion) return;
    const i = indice.get(seleccion);
    const el = marco.current;
    if (i === undefined || !el) return;
    const top = i * ALTO_FILA;
    const cabecera = 56;
    if (top < el.scrollTop || top + ALTO_FILA > el.scrollTop + el.clientHeight - cabecera) el.scrollTop = Math.max(0, top - el.clientHeight / 3);
    if (enfocar.current) {
      enfocar.current = false;
      window.requestAnimationFrame(() => el.querySelector<HTMLElement>(`[data-fila="${seleccion}"] .gantt-nombre-boton`)?.focus());
    }
  }, [seleccion, indice]);

  const moverSeleccion = useCallback((desdeId: string, paso: 1 | -1) => {
    const i = indice.get(desdeId);
    if (i === undefined) return;
    for (let j = i + paso; j >= 0 && j < filas.length; j += paso) {
      const f = filas[j];
      if (f?.clase === 'actividad') {
        enfocar.current = true;
        alSeleccionar(f.actividad.id);
        return;
      }
    }
  }, [indice, filas, alSeleccionar]);

  // --- El tiempo no laborable (07 §6.6) ----------------------------------------------
  const sombras = useMemo(() => (escala === 'MES' ? [] : sombrear(vista.calendarios.obra, desde, hasta, escala)), [vista.calendarios.obra, desde, hasta, escala]);

  const lineaBase = useMemo(() => new Map((vista.lineaBase?.actividades ?? []).map((a) => [a.actividadId, a])), [vista.lineaBase]);
  const porId = useMemo(() => new Map(vista.actividades.map((a) => [a.id, a])), [vista.actividades]);

  // --- Las flechas que cruzan lo visible -----------------------------------------------
  const flechas = useMemo(() => {
    const salida: { id: string; d: string; critica: boolean }[] = [];
    for (const d of vista.dependencias) {
      const i = indice.get(d.predecesoraId);
      const j = indice.get(d.sucesoraId);
      const p = porId.get(d.predecesoraId);
      const s = porId.get(d.sucesoraId);
      if (i === undefined || j === undefined || !p || !s) continue;
      if (Math.max(i, j) < primera || Math.min(i, j) > ultima) continue;
      const desdeFin = d.tipo === 'FC' || d.tipo === 'FF';
      const alFin = d.tipo === 'FF' || d.tipo === 'CF';
      const x1 = desdeFin ? x(p.fin) : x(p.inicio);
      const x2 = alFin ? x(s.fin) : x(s.inicio);
      const y1 = i * ALTO_FILA + ALTO_FILA / 2;
      const y2 = j * ALTO_FILA + ALTO_FILA / 2;
      salida.push({ id: d.id, d: trazo(x1, y1, x2, y2, desdeFin, alFin), critica: p.critica && s.critica });
    }
    return salida;
  }, [vista.dependencias, indice, porId, primera, ultima, x]);

  const visibles: { f: Fila; i: number }[] = [];
  for (let i = primera; i <= ultima; i += 1) {
    const f = filas[i];
    if (f) visibles.push({ f, i });
  }

  return (
    <div
      ref={marco}
      className="gantt"
      style={{
        ['--alto-fila-gantt' as string]: `${ALTO_FILA}px`,
        ['--ancho-tabla-gantt' as string]: `${anchoTabla}px`,
        ['--columnas-gantt' as string]: columnas.map((w) => `${w}px`).join(' '),
        ...(altoMaximo === null ? {} : { maxHeight: altoMaximo }),
      }}
      onScroll={(e) => {
        const el = e.currentTarget;
        setVentana((v) => (v.arriba === el.scrollTop ? v : { arriba: el.scrollTop, alto: el.clientHeight }));
      }}
      role="table"
      aria-label="Cronograma: actividades y fechas"
      aria-rowcount={filas.length + 1}
      data-escala={escala}
    >
      <div className="gantt-lienzo" style={{ width: `calc(var(--ancho-tabla-gantt) + ${anchoTiempo}px)` }}>
        <div className="gantt-cabecera" role="rowgroup">
          <div className="gantt-fila-cabecera" role="row" aria-rowindex={1}>
            <div className="gantt-celdas gantt-celdas-cabecera">
              {COLUMNAS.map((c) => (
                <span
                  key={c.clave}
                  role="columnheader"
                  className={c.clave === 'dias' || c.clave === 'holgura' ? 'gantt-encabezado cifra' : 'gantt-encabezado'}
                  title={c.clave === 'holgura' ? 'Holgura total, en días' : undefined}
                >
                  {c.nombre}
                  <AsaDeColumna
                    nombre={c.nombre}
                    ancho={anchos[c.clave]}
                    minimo={ANCHOS_MINIMOS[c.clave]}
                    alCambiar={(w) => alCambiarAncho(c.clave, limitar(c.clave, w))}
                    alReiniciar={() => alCambiarAncho(c.clave, ANCHOS_INICIALES[c.clave])}
                  />
                </span>
              ))}
            </div>
            <Escala desde={desde} hasta={hasta} escala={escala} px={px} inicioSemana={inicioSemana} />
          </div>
        </div>

        <div className="gantt-cuerpo" role="rowgroup" style={{ height: filas.length * ALTO_FILA }}>
          <div className="gantt-capas" aria-hidden="true" style={{ width: anchoTiempo }}>
            {sombras.map((s) => <span key={s.desde} className="gantt-no-laborable" style={{ left: s.x, width: s.ancho }} />)}
            <svg className="gantt-flechas" width={anchoTiempo} height={filas.length * ALTO_FILA}>
              <defs>
                <marker id="gantt-punta" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0 0 L8 4 L0 8 z" className="gantt-punta" />
                </marker>
                <marker id="gantt-punta-critica" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0 0 L8 4 L0 8 z" className="gantt-punta gantt-punta-critica" />
                </marker>
              </defs>
              {flechas.map((f) => (
                <path key={f.id} d={f.d} className="gantt-flecha" data-critica={f.critica ? 'si' : 'no'} markerEnd={f.critica ? 'url(#gantt-punta-critica)' : 'url(#gantt-punta)'} />
              ))}
            </svg>
          </div>

          {visibles.map(({ f, i }) => (
            <FilaDelGantt
              key={f.clave}
              f={f}
              i={i}
              x={x}
              formato={formato}
              seleccionada={f.clase === 'actividad' && f.actividad.id === seleccion}
              enCiclo={f.clase === 'actividad' && ciclo.has(f.actividad.id)}
              plegada={plegados.has(f.clave)}
              base={f.clase === 'actividad' ? lineaBase.get(f.actividad.id) : undefined}
              alPlegar={alPlegar}
              alSeleccionar={alSeleccionar}
              alMover={moverSeleccion}
              accionesDeGrupo={accionesDeGrupo}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// --- El borde que ajusta el ancho de una columna ------------------------------------------

/**
 * Se arrastra con el mouse o el dedo; con el teclado, las flechas lo mueven de
 * a 8 px (32 con Mayús). Doble clic vuelve al ancho de siempre.
 */
function AsaDeColumna({ nombre, ancho, minimo, alCambiar, alReiniciar }: { nombre: string; ancho: number; minimo: number; alCambiar: (w: number) => void; alReiniciar: () => void }) {
  const arrastre = useRef<{ x: number; ancho: number } | null>(null);
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={`Ancho de la columna ${nombre}`}
      aria-valuenow={ancho}
      aria-valuemin={minimo}
      aria-valuemax={ANCHO_MAXIMO}
      tabIndex={0}
      className="gantt-asa"
      title="Arrastre para cambiar el ancho. Doble clic: el ancho de siempre."
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        arrastre.current = { x: e.clientX, ancho };
      }}
      onPointerMove={(e) => {
        const a = arrastre.current;
        if (a) alCambiar(a.ancho + e.clientX - a.x);
      }}
      onPointerUp={() => { arrastre.current = null; }}
      onPointerCancel={() => { arrastre.current = null; }}
      onDoubleClick={alReiniciar}
      onKeyDown={(e) => {
        const paso = e.shiftKey ? 32 : 8;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          alCambiar(ancho + (e.key === 'ArrowRight' ? paso : -paso));
        }
      }}
    />
  );
}

// --- Una fila ------------------------------------------------------------------------

interface PropsFila {
  f: Fila;
  i: number;
  x: (fh: string) => number;
  formato: { separadorDecimal: string; separadorMiles: string; decimalesVista: number };
  seleccionada: boolean;
  enCiclo: boolean;
  plegada: boolean;
  base: ActividadDeLineaBase | undefined;
  alPlegar: (clave: string) => void;
  alSeleccionar: (id: string) => void;
  alMover: (desde: string, paso: 1 | -1) => void;
  accionesDeGrupo?: ((g: Grupo, primero: boolean, ultimo: boolean) => ReactNode) | undefined;
}

const FilaDelGantt = memo(function FilaDelGantt({ f, i, x, formato, seleccionada, enCiclo, plegada, base, alPlegar, alSeleccionar, alMover, accionesDeGrupo }: PropsFila) {
  const sangria = { ['--nivel' as string]: f.nivel };
  const plegar = (clave: string, nombre: string, plegable: boolean) =>
    plegable ? (
      <button type="button" className="gantt-plegar" aria-expanded={!plegada} aria-label={`${plegada ? 'Desplegar' : 'Plegar'} ${nombre}`} onClick={() => alPlegar(clave)}>
        <Icono nombre={plegada ? 'desplegar' : 'bajar'} tamano={16} />
      </button>
    ) : <span className="gantt-plegar-vacio" />;

  if (f.clase === 'capitulo') {
    const c = f.capitulo;
    return (
      <div className="gantt-fila" role="row" aria-rowindex={i + 2} data-clase="capitulo" style={{ top: i * ALTO_FILA }}>
        <div className="gantt-celdas">
          <span role="cell" className="gantt-codigo">{plegar(c.id, `el capítulo ${c.codigo}`, f.plegable)}<span className="cifra-codigo">{c.codigo}</span></span>
          <span role="cell" className="gantt-nombre" style={sangria}><span className="gantt-nombre-texto" title={c.nombre}>{c.nombre}</span></span>
          <span role="cell" className="cifra">{dias(c.duracionDias, formato)}</span>
          <span role="cell" className="gantt-fecha">{c.inicio ? fechaTabla(c.inicio) : '—'}</span>
          <span role="cell" className="gantt-fecha">{c.fin ? fechaTabla(c.fin) : '—'}</span>
          <span role="cell" />
        </div>
        <div className="gantt-barras" aria-hidden="true">
          {c.inicio && c.fin ? <Resumen x1={x(c.inicio)} x2={x(c.fin)} /> : null}
        </div>
      </div>
    );
  }

  if (f.clase === 'titulo' || f.clase === 'grupo') {
    const nombre = f.clase === 'titulo' ? f.texto : f.grupo.nombre;
    return (
      <div className="gantt-fila" role="row" aria-rowindex={i + 2} data-clase={f.clase} style={{ top: i * ALTO_FILA }}>
        <div className="gantt-celdas">
          <span role="cell" className="gantt-codigo">{plegar(f.clave, nombre, f.plegable)}</span>
          <span role="cell" className="gantt-nombre" style={sangria}>
            <span className="gantt-nombre-texto" title={nombre}>{nombre}</span>
            {f.clase === 'grupo' && accionesDeGrupo ? <span className="gantt-acciones-de-grupo">{accionesDeGrupo(f.grupo, f.primero, f.ultimo)}</span> : null}
          </span>
          <span role="cell" />
          <span role="cell" className="gantt-fecha">{f.inicio ? fechaTabla(f.inicio) : ''}</span>
          <span role="cell" className="gantt-fecha">{f.fin ? fechaTabla(f.fin) : ''}</span>
          <span role="cell" />
        </div>
        <div className="gantt-barras" aria-hidden="true">
          {f.inicio && f.fin ? <Resumen x1={x(f.inicio)} x2={x(f.fin)} /> : null}
        </div>
      </div>
    );
  }

  const a = f.actividad;
  const hito = a.tipo === 'HITO_INICIO' || a.tipo === 'HITO_FIN';
  const descripcion = `${a.codigo} ${a.nombre}`;
  return (
    <div
      className="gantt-fila"
      role="row"
      aria-rowindex={i + 2}
      aria-selected={seleccionada}
      data-clase="actividad"
      data-fila={a.id}
      data-seleccionada={seleccionada ? 'si' : 'no'}
      data-ciclo={enCiclo ? 'si' : 'no'}
      style={{ top: i * ALTO_FILA }}
      onClick={() => alSeleccionar(a.id)}
    >
      <div className="gantt-celdas">
        <span role="cell" className="gantt-codigo"><span className="gantt-plegar-vacio" /><span className="cifra-codigo">{a.codigo}</span></span>
        <span role="cell" className="gantt-nombre" style={sangria}>
          <button
            type="button"
            className="gantt-nombre-boton"
            title={a.nombre}
            onClick={(e) => { e.stopPropagation(); alSeleccionar(a.id); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                alMover(a.id, e.key === 'ArrowDown' ? 1 : -1);
              }
            }}
          >
            {hito ? <Icono nombre="rombo" tamano={14} /> : null}
            <span className="gantt-nombre-texto">{a.nombre}</span>
          </button>
          {a.tipo === 'ITEM' && !a.enPresupuesto ? <span className="insignia insignia-aviso">Ya no está</span> : null}
          {a.usaCorrido ? <span className="marca-chica" title="Calendario corrido: 24 horas, todos los días">24 h</span> : null}
          {enCiclo ? <span className="solo-lectores">, forma parte del círculo</span> : null}
        </span>
        <span role="cell" className="cifra" title={a.duracionManualDias !== null ? 'Duración escrita a mano' : undefined}>
          {dias(a.duracionDias, formato)}{a.duracionManualDias !== null ? <span className="marca-manual" aria-label=", escrita a mano">*</span> : null}
        </span>
        <span role="cell" className="gantt-fecha" title={fechaYHora(a.inicio)}>{fechaTabla(a.inicio)}</span>
        <span role="cell" className="gantt-fecha" title={fechaYHora(a.fin)}>{fechaTabla(a.fin)}</span>
        <span role="cell" className="cifra" data-negativa={esNegativo(a.holguraTotalDias) ? 'si' : 'no'} data-critica={a.critica ? 'si' : 'no'}>
          {a.holguraTotalDias === null ? <span className="dato-de-apoyo">—</span> : dias(a.holguraTotalDias, formato)}
          {a.critica ? <span className="solo-lectores">, crítica</span> : null}
        </span>
      </div>
      <div className="gantt-barras" aria-hidden="true" title={`${descripcion} · ${fechaYHora(a.inicio)} a ${fechaYHora(a.fin)}`}>
        {base ? <BarraDeBase x1={x(base.inicio)} x2={x(base.fin)} cero={base.inicio === base.fin} /> : null}
        {hito ? <Rombo x={x(a.inicio)} tipo={a.tipo} critica={a.critica} /> : <Barra a={a} x1={x(a.inicio)} x2={x(a.fin)} />}
      </div>
    </div>
  );
});

function Barra({ a, x1, x2 }: { a: Actividad; x1: number; x2: number }) {
  return (
    <span
      className="gantt-barra"
      data-tipo={a.tipo}
      data-critica={a.critica ? 'si' : 'no'}
      style={{ left: x1, width: Math.max(2, x2 - x1) }}
    >
      {a.finAMitadDeJornada ? <span className="gantt-mitad" /> : null}
    </span>
  );
}

function Rombo({ x, tipo, critica }: { x: number; tipo: Actividad['tipo']; critica: boolean }) {
  return <span className="gantt-rombo" data-tipo={tipo} data-critica={critica ? 'si' : 'no'} style={{ left: x }} />;
}

function Resumen({ x1, x2 }: { x1: number; x2: number }) {
  return <span className="gantt-resumen" style={{ left: x1, width: Math.max(2, x2 - x1) }} />;
}

function BarraDeBase({ x1, x2, cero }: { x1: number; x2: number; cero: boolean }) {
  return cero ? <span className="gantt-base-hito" style={{ left: x1 }} /> : <span className="gantt-base" style={{ left: x1, width: Math.max(2, x2 - x1) }} />;
}

/**
 * La flecha en codo, como la dibuja P6. Sale por el fin o el inicio de la
 * predecesora y entra por el inicio o el fin de la sucesora, según el tipo.
 * Si no hay lugar para bajar derecho, da la vuelta por entre las dos filas.
 */
function trazo(x1: number, y1: number, x2: number, y2: number, desdeFin: boolean, alFin: boolean): string {
  const sx = desdeFin ? x1 + 6 : x1 - 6;
  const lx = alFin ? x2 + 6 : x2 - 6;
  if (desdeFin === alFin) {
    // FF sale y entra por la derecha; CC, por la izquierda: siempre cabe.
    const c = desdeFin ? Math.max(sx, lx) : Math.min(sx, lx);
    return `M${x1} ${y1} H${c} V${y2} H${x2}`;
  }
  const directo = desdeFin ? x2 >= sx : x2 <= sx;
  if (directo) return `M${x1} ${y1} H${sx} V${y2} H${x2}`;
  const medio = y2 > y1 ? y2 - ALTO_FILA / 2 : y2 + ALTO_FILA / 2;
  return `M${x1} ${y1} H${sx} V${medio} H${lx} V${y2} H${x2}`;
}

// --- La escala de tiempo ---------------------------------------------------------------

function Escala({ desde, hasta, escala, px, inicioSemana }: { desde: number; hasta: number; escala: Escala; px: number; inicioSemana: number }) {
  const arriba: { clave: number; x: number; ancho: number; texto: string }[] = [];
  const abajo: { clave: number; x: number; ancho: number; texto: string }[] = [];
  if (escala === 'MES') {
    for (let d = primeroDelMes(desde); d <= hasta; d = mesSiguiente(d)) {
      const fin = mesSiguiente(d);
      abajo.push({ clave: d, x: (d - desde) * px, ancho: (fin - d) * px, texto: mesCorto(d).slice(0, -5) });
      if (fechaDe(d).slice(5, 7) === '01' || d === primeroDelMes(desde)) arriba.push({ clave: d, x: (d - desde) * px, ancho: 0, texto: fechaDe(d).slice(0, 4) });
    }
  } else {
    for (let d = primeroDelMes(desde); d <= hasta; d = mesSiguiente(d)) {
      const ini = Math.max(d, desde);
      arriba.push({ clave: d, x: (ini - desde) * px, ancho: (Math.min(mesSiguiente(d), hasta + 1) - ini) * px, texto: mesCorto(d) });
    }
    if (escala === 'DIA') {
      for (let d = desde; d <= hasta; d += 1) abajo.push({ clave: d, x: (d - desde) * px, ancho: px, texto: String(diaDelMes(d)) });
    } else {
      for (let d = desde; d <= hasta; d += 1) if (diaDeLaSemana(d) === inicioSemana) abajo.push({ clave: d, x: (d - desde) * px, ancho: 7 * px, texto: String(diaDelMes(d)) });
    }
  }
  return (
    <div className="gantt-escala" aria-hidden="true">
      <div className="gantt-escala-arriba">
        {arriba.map((m) => <span key={m.clave} style={{ left: m.x, width: m.ancho || undefined }}>{m.texto}</span>)}
      </div>
      <div className="gantt-escala-abajo">
        {abajo.map((m) => <span key={m.clave} style={{ left: m.x, width: m.ancho }} data-semana={escala === 'DIA' && diaDeLaSemana(m.clave) === inicioSemana ? 'si' : 'no'}>{m.texto}</span>)}
      </div>
    </div>
  );
}

// --- El sombreado del tiempo no laborable --------------------------------------------------

function sombrear(cal: Calendario, desde: number, hasta: number, escala: Escala): { desde: number; x: number; ancho: number }[] {
  const px = PX_POR_DIA[escala];
  const excepciones = new Map(cal.excepciones.map((e) => [e.fecha, e.tramos]));
  const minutosDe = (tramos: { inicio: string; fin: string }[]) => tramos.reduce((s, t) => s + minutosDelDia(t.fin) - minutosDelDia(t.inicio), 0);
  const jornadaLarga = Math.max(...cal.semana.map(minutosDe));
  const salida: { desde: number; x: number; ancho: number }[] = [];
  let abierto: number | null = null;
  const cerrar = (hastaDia: number) => {
    if (abierto !== null) salida.push({ desde: abierto, x: (abierto - desde) * px, ancho: (hastaDia - abierto) * px });
    abierto = null;
  };
  for (let d = desde; d <= hasta; d += 1) {
    const tramos = excepciones.get(fechaDe(d)) ?? cal.semana[diaDeLaSemana(d)] ?? [];
    if (tramos.length === 0) {
      if (abierto === null) abierto = d;
      continue;
    }
    cerrar(d);
    // La tarde del sábado: un día más corto que la jornada larga se sombrea
    // desde que termina su último tramo. Solo por día, donde se alcanza a leer.
    if (escala === 'DIA' && minutosDe(tramos) < jornadaLarga) {
      const ultimo = tramos.reduce((m, t) => Math.max(m, minutosDelDia(t.fin)), 0);
      salida.push({ desde: d + ultimo / 1440, x: (d - desde + ultimo / 1440) * px, ancho: ((1440 - ultimo) / 1440) * px });
    }
  }
  cerrar(hasta + 1);
  return salida;
}
