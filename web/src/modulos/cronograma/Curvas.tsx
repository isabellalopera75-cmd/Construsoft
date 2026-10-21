import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { conConsulta, ErrorDeApi, pedir } from '../../api/cliente.ts';
import type { Curvas as DatosDeCurvas, Granularidad, Periodo } from '../../api/tiposCronograma.ts';
import { Icono } from '../../componentes/Icono.tsx';
import { formatearNumero } from '../../formato.ts';
import { useSesion } from '../../sesion.tsx';
import { fechaCorta, mesCorto, diaDe } from './tiempo.ts';

/*
 * Las dos curvas S (RF-PRG-08, D-88): facturación y costo acumulados por
 * semana o por mes, y las de la línea base que se está mirando, punteadas en
 * el mismo tono. La diferencia entre las dos es lo que el contratista tiene
 * que financiar.
 *
 * EL DINERO LO REPARTE LA BASE (CONTRATO §19.7). Las cifras de la tabla y del
 * globo son el texto del servidor, formateado. Para DIBUJAR hace falta una
 * posición, y la única conversión a número de esta pantalla está en
 * `aproximar`: sirve para poner un punto en el plano, no se muestra, no se
 * suma y no se guarda.
 *
 * Los colores: facturación en terracota y costo en azul, validados con la
 * herramienta de la guía de gráficos sobre los dos fondos de los dos temas
 * (separación para daltonismo de 23,8 en oscuro y 25,1 en claro, con 8 de
 * objetivo). El nombre de cada serie va siempre en la leyenda y al final de la
 * línea, en color de texto: el color no es la única señal.
 */

/** Solo para dibujar. Ver el comentario de arriba. */
function aproximar(texto: string): number {
  // eslint-disable-next-line no-restricted-globals -- posición en el plano de la curva, no una cifra que se muestre
  return parseFloat(texto);
}

const ALTO = 320;
const MARGEN = { arriba: 16, derecha: 112, abajo: 36, izquierda: 64 };

interface Serie {
  clave: string;
  nombre: string;
  clase: 'facturacion' | 'costo';
  base: boolean;
  puntos: { periodo: string; valor: string }[];
}

export function Curvas({ cronogramaId, lineaBaseId, version }: { cronogramaId: string; lineaBaseId: string | null; version: number }) {
  const { arranque } = useSesion();
  const formato = arranque.formatoNumerico;
  const [granularidad, setGranularidad] = useState<Granularidad>('MES');
  const [datos, setDatos] = useState<DatosDeCurvas | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tabla, setTabla] = useState(false);

  useEffect(() => {
    let vigente = true;
    setError(null);
    pedir<DatosDeCurvas>(conConsulta(`/api/cronogramas/${cronogramaId}/curvas`, { granularidad, lineaBase: lineaBaseId ?? undefined }))
      .then((d) => vigente && setDatos(d))
      .catch((e: unknown) => vigente && setError(e instanceof ErrorDeApi ? e.message : 'No se pudieron leer las curvas.'));
    return () => { vigente = false; };
    // La versión: una edición del cronograma mueve las curvas.
  }, [cronogramaId, lineaBaseId, granularidad, version]);

  const nombrePeriodo = (p: string) => (granularidad === 'MES' ? mesCorto(diaDe(p)) : `Semana del ${fechaCorta(p)}`);

  return (
    <section className="curvas" aria-labelledby="titulo-curvas">
      <div className="curvas-cabecera">
        <div>
          <h2 id="titulo-curvas" className="titulo-de-bloque">Curvas S</h2>
          <p className="campo-ayuda">Lo acumulado en cada periodo. La facturación lleva el AIU y el IVA según lo ejecutado; el costo, el directo, los indirectos y la administración.</p>
        </div>
        <div className="conmutador" role="group" aria-label="Periodo">
          {(['SEMANA', 'MES'] as const).map((g) => (
            <button key={g} type="button" className="conmutador-opcion" aria-pressed={granularidad === g} onClick={() => setGranularidad(g)}>{g === 'MES' ? 'Por mes' : 'Por semana'}</button>
          ))}
        </div>
      </div>
      {error ? <p className="aviso-error" role="alert"><Icono nombre="aviso" /><span>{error}</span></p> : null}
      {!datos && !error ? <div className="curvas-esqueleto" aria-busy="true" /> : null}
      {datos ? (
        datos.periodos.length === 0 ? (
          <p className="vacio">Todavía no hay costo repartido: el cronograma no tiene actividades con costo.</p>
        ) : (
          <>
            <dl className="datos-de-mesa curvas-totales">
              <div><dt>Facturación total</dt><dd className="cifra">{formatearNumero(datos.totales.facturacion, formato)}</dd></div>
              <div><dt>Costo total</dt><dd className="cifra">{formatearNumero(datos.totales.costo, formato)}</dd></div>
              {datos.lineaBase ? <div><dt>Línea base</dt><dd>«{datos.lineaBase.nombre}», punteada</dd></div> : null}
            </dl>
            <Grafico datos={datos} nombrePeriodo={nombrePeriodo} />
            <button type="button" className="boton boton-secundario boton-chico-texto" aria-expanded={tabla} onClick={() => setTabla(!tabla)}>
              <Icono nombre="rejilla" tamano={16} />
              {tabla ? 'Ocultar la tabla' : 'Ver las cifras en una tabla'}
            </button>
            {tabla ? <TablaDeCurvas datos={datos} nombrePeriodo={nombrePeriodo} /> : null}
          </>
        )
      ) : null}
    </section>
  );
}

function series(datos: DatosDeCurvas): Serie[] {
  const de = (ps: Periodo[], campo: 'facturacionAcumulada' | 'costoAcumulado') => ps.map((p) => ({ periodo: p.periodo, valor: p[campo] }));
  const s: Serie[] = [
    { clave: 'f', nombre: 'Facturación', clase: 'facturacion', base: false, puntos: de(datos.periodos, 'facturacionAcumulada') },
    { clave: 'c', nombre: 'Costo', clase: 'costo', base: false, puntos: de(datos.periodos, 'costoAcumulado') },
  ];
  if (datos.lineaBase) {
    s.push({ clave: 'fb', nombre: 'Facturación, línea base', clase: 'facturacion', base: true, puntos: de(datos.lineaBase.periodos, 'facturacionAcumulada') });
    s.push({ clave: 'cb', nombre: 'Costo, línea base', clase: 'costo', base: true, puntos: de(datos.lineaBase.periodos, 'costoAcumulado') });
  }
  return s;
}

/** Marcas limpias del eje: 0, 50, 100, 150… en millones. */
function marcas(maximo: number): number[] {
  if (maximo <= 0) return [0];
  const bruto = maximo / 4;
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  const paso = [1, 2, 2.5, 5, 10].map((m) => m * potencia).find((p) => p >= bruto) ?? bruto;
  const salida: number[] = [];
  for (let v = 0; v <= maximo + paso * 0.001; v += paso) salida.push(v);
  if ((salida.at(-1) ?? 0) < maximo) salida.push((salida.at(-1) ?? 0) + paso);
  return salida;
}

function Grafico({ datos, nombrePeriodo }: { datos: DatosDeCurvas; nombrePeriodo: (p: string) => string }) {
  const { arranque } = useSesion();
  const formato = arranque.formatoNumerico;
  const marco = useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = useState(720);
  const [activo, setActivo] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = marco.current;
    if (!el) return;
    const medir = () => setAncho(Math.max(320, el.clientWidth));
    medir();
    const o = new ResizeObserver(medir);
    o.observe(el);
    return () => o.disconnect();
  }, []);

  const todas = series(datos);
  // El eje de tiempo junta los periodos de hoy y los de la línea base.
  const periodos = [...new Set(todas.flatMap((s) => s.puntos.map((p) => p.periodo)))].sort();
  const indice = new Map(periodos.map((p, i) => [p, i]));
  const maximo = Math.max(...todas.flatMap((s) => s.puntos.map((p) => aproximar(p.valor))), 0);
  const ticks = marcas(maximo);
  const tope = ticks.at(-1) ?? 1;
  const anchoPlano = ancho - MARGEN.izquierda - MARGEN.derecha;
  const altoPlano = ALTO - MARGEN.arriba - MARGEN.abajo;
  const paso = periodos.length > 1 ? anchoPlano / (periodos.length - 1) : 0;
  const px = (i: number) => MARGEN.izquierda + (periodos.length > 1 ? i * paso : anchoPlano / 2);
  const py = (v: number) => MARGEN.arriba + altoPlano - (v / tope) * altoPlano;
  const millones = (v: number) => `${formatearNumero(String(Math.round(v / 1e5) / 10), { ...formato, decimalesVista: v >= 1e7 || v === 0 ? 0 : 1 })} M`;
  const cadaCuanto = Math.max(1, Math.ceil(periodos.length / Math.max(1, Math.floor(anchoPlano / 72))));

  // Las etiquetas del final de las dos curvas de hoy, separadas si se tocan.
  const finales = todas.filter((s) => !s.base).map((s) => {
    const ult = s.puntos.at(-1);
    return { s, y: ult ? py(aproximar(ult.valor)) : 0, x: ult ? px(indice.get(ult.periodo) ?? 0) : 0 };
  }).sort((a, b) => a.y - b.y);
  for (let i = 1; i < finales.length; i += 1) {
    const prev = finales[i - 1];
    const act = finales[i];
    if (prev && act && act.y - prev.y < 16) act.y = prev.y + 16;
  }

  function alMover(clientX: number) {
    const el = marco.current;
    if (!el || periodos.length === 0) return;
    const x = clientX - el.getBoundingClientRect().left;
    const i = periodos.length > 1 ? Math.round((x - MARGEN.izquierda) / paso) : 0;
    setActivo(Math.min(periodos.length - 1, Math.max(0, i)));
  }

  const enActivo = activo === null ? null : periodos[activo];
  const valorEn = (s: Serie, p: string) => s.puntos.find((x) => x.periodo === p)?.valor ?? null;

  return (
    <div className="grafico-de-curvas">
      <ul className="leyenda" aria-label="Series">
        {todas.map((s) => (
          <li key={s.clave}><span className="leyenda-muestra" data-serie={s.clase} data-base={s.base ? 'si' : 'no'} />{s.nombre}</li>
        ))}
      </ul>
      <div
        ref={marco}
        className="grafico-de-curvas-plano"
        tabIndex={0}
        role="img"
        aria-label={`Curvas S acumuladas: ${datos.periodos.length} periodos. Use las flechas para recorrerlos; la tabla tiene todas las cifras.`}
        onPointerMove={(e) => alMover(e.clientX)}
        onPointerLeave={() => setActivo(null)}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
          e.preventDefault();
          setActivo((a) => Math.min(periodos.length - 1, Math.max(0, (a ?? -1) + (e.key === 'ArrowRight' ? 1 : -1))));
        }}
        onBlur={() => setActivo(null)}
      >
        <svg width={ancho} height={ALTO} aria-hidden="true">
          {ticks.map((t) => (
            <g key={t}>
              <line className="curvas-rejilla" x1={MARGEN.izquierda} x2={ancho - MARGEN.derecha} y1={py(t)} y2={py(t)} />
              <text className="curvas-eje" x={MARGEN.izquierda - 8} y={py(t)} dy="0.32em" textAnchor="end">{millones(t)}</text>
            </g>
          ))}
          {periodos.map((p, i) => (i % cadaCuanto === 0 ? (
            <text key={p} className="curvas-eje" x={px(i)} y={ALTO - MARGEN.abajo + 20} textAnchor="middle">{nombrePeriodo(p).replace('Semana del ', '')}</text>
          ) : null))}
          {todas.map((s) => (
            <path
              key={s.clave}
              className="curva"
              data-serie={s.clase}
              data-base={s.base ? 'si' : 'no'}
              d={s.puntos.map((p, j) => `${j === 0 ? 'M' : 'L'}${px(indice.get(p.periodo) ?? 0)} ${py(aproximar(p.valor))}`).join(' ')}
            />
          ))}
          {finales.map(({ s, x, y }) => (
            <text key={s.clave} className="curvas-etiqueta" x={x + 8} y={y} dy="0.32em">{s.nombre}</text>
          ))}
          {activo !== null ? (
            <>
              <line className="curvas-cursor" x1={px(activo)} x2={px(activo)} y1={MARGEN.arriba} y2={MARGEN.arriba + altoPlano} />
              {todas.map((s) => {
                const v = enActivo ? valorEn(s, enActivo) : null;
                return v === null ? null : <circle key={s.clave} className="curvas-punto" data-serie={s.clase} cx={px(activo)} cy={py(aproximar(v))} r={4} />;
              })}
            </>
          ) : null}
        </svg>
        {activo !== null && enActivo ? (
          <div className="globo-de-curvas" role="status" style={{ left: Math.min(px(activo) + 12, ancho - 260), top: MARGEN.arriba }}>
            <p className="globo-de-curvas-titulo">{nombrePeriodo(enActivo)}</p>
            <dl>
              {todas.map((s) => {
                const v = valorEn(s, enActivo);
                return (
                  <div key={s.clave}>
                    <dt><span className="leyenda-muestra" data-serie={s.clase} data-base={s.base ? 'si' : 'no'} />{s.nombre}</dt>
                    <dd className="cifra">{v === null ? '—' : formatearNumero(v, formato)}</dd>
                  </div>
                );
              })}
            </dl>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TablaDeCurvas({ datos, nombrePeriodo }: { datos: DatosDeCurvas; nombrePeriodo: (p: string) => string }) {
  const { arranque } = useSesion();
  const formato = arranque.formatoNumerico;
  const base = new Map((datos.lineaBase?.periodos ?? []).map((p) => [p.periodo, p]));
  const periodos = [...new Set([...datos.periodos.map((p) => p.periodo), ...base.keys()])].sort();
  const hoy = new Map(datos.periodos.map((p) => [p.periodo, p]));
  const f = (t: string | undefined) => (t === undefined ? <span className="dato-de-apoyo">—</span> : formatearNumero(t, formato));
  return (
    <div className="tabla-con-desplazamiento">
      <table className="tabla tabla-densa">
        <caption className="solo-lectores">Curvas S, periodo por periodo</caption>
        <thead>
          <tr>
            <th scope="col">Periodo</th>
            <th scope="col" className="cifra">Facturación</th>
            <th scope="col" className="cifra">Acumulada</th>
            <th scope="col" className="cifra">Costo</th>
            <th scope="col" className="cifra">Acumulado</th>
            {datos.lineaBase ? <th scope="col" className="cifra">Facturación acumulada, línea base</th> : null}
            {datos.lineaBase ? <th scope="col" className="cifra">Costo acumulado, línea base</th> : null}
          </tr>
        </thead>
        <tbody>
          {periodos.map((p) => {
            const h = hoy.get(p);
            const b = base.get(p);
            return (
              <tr key={p}>
                <th scope="row">{nombrePeriodo(p)}</th>
                <td className="cifra">{f(h?.facturacion)}</td>
                <td className="cifra">{f(h?.facturacionAcumulada)}</td>
                <td className="cifra">{f(h?.costo)}</td>
                <td className="cifra">{f(h?.costoAcumulado)}</td>
                {datos.lineaBase ? <td className="cifra">{f(b?.facturacionAcumulada)}</td> : null}
                {datos.lineaBase ? <td className="cifra">{f(b?.costoAcumulado)}</td> : null}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            <td className="cifra">{formatearNumero(datos.totales.facturacion, formato)}</td>
            <td />
            <td className="cifra">{formatearNumero(datos.totales.costo, formato)}</td>
            <td />
            {datos.lineaBase ? <><td /><td /></> : null}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
