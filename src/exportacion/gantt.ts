import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import type { FormatoNumerico } from '../comun/formatoNumerico.js';
import { compilarCalendario } from '../cronograma/calendarioCompilado.js';
import { definicionDe } from '../cronograma/recalculo.js';
import { aMinutos, fechaDeDia, MINUTOS_POR_DIA } from '../cronograma/tiempo.js';
import type { ActividadEnVista, VistaCronograma } from '../cronograma/vista.js';
import type { Logo } from './excel.js';

/*
 * RF-PRG-10 · El Gantt en PDF: la tabla y las barras como en pantalla (07
 * §6.6), con la línea base escogida. Carta apaisada. A la izquierda la tabla
 * (código, actividad, duración, inicio y fin); a la derecha la escala de
 * tiempo. Si la obra no cabe a lo ancho en la escala pedida, el tiempo sigue en
 * otra página, como imprime P6, y la tabla se repite: cada hoja se lee sola.
 *
 * Las fuentes van incrustadas, como en la oferta (pdf.ts). Función pura: la
 * vista ya calculada, el encabezado de la empresa y el formato adentro, bytes
 * afuera. Sin compresión: las pruebas leen lo que dice.
 */

const FUENTE_NORMAL = fileURLToPath(new URL('./fuentes/DejaVuSansCondensed.ttf', import.meta.url));
const FUENTE_NEGRITA = fileURLToPath(new URL('./fuentes/DejaVuSansCondensed-Bold.ttf', import.meta.url));

const ANCHO = 792;
const ALTO = 612;
const MARGEN = 30;
const ALTO_FILA = 14;
const ALTO_ESCALA = 24;
const INICIO_TIEMPO = 404;
const FIN_TIEMPO = ANCHO - MARGEN;
const COLUMNAS = [
  { titulo: 'Código', x: MARGEN, ancho: 50, alinear: 'left' },
  { titulo: 'Actividad', x: 82, ancho: 178, alinear: 'left' },
  { titulo: 'Días', x: 262, ancho: 30, alinear: 'right' },
  { titulo: 'Inicio', x: 296, ancho: 50, alinear: 'left' },
  { titulo: 'Fin', x: 350, ancho: 50, alinear: 'left' },
] as const;

const COLOR = {
  barra: '#2E6DB4',
  critica: '#C0392B',
  administracion: '#8C8C8C',
  capitulo: '#222222',
  lineaBase: '#E0A800',
  hitoInicio: '#2E7D32',
  hitoFin: '#222222',
  noLaborable: '#EFEFEF',
  relacion: '#666666',
  mitadDeJornada: '#F39C12',
};

/** Puntos por día de cada escala: un día legible por día, una semana por semana, un mes por mes. */
const PUNTOS_POR_DIA = { DIA: 12, SEMANA: 4, MES: 1.6 } as const;
export type EscalaDelGantt = keyof typeof PUNTOS_POR_DIA;

export interface DatosDelGantt {
  vista: VistaCronograma;
  empresa: { razonSocial: string; nit: string | null };
  presupuesto: { codigo: string; nombre: string };
  formato: FormatoNumerico;
  escala: EscalaDelGantt;
  logo: Logo | null;
}

type Fila =
  | { tipo: 'titulo'; texto: string }
  | { tipo: 'capitulo'; codigo: string; nombre: string; nivel: number; inicio: string | null; fin: string | null; dias: string | null }
  | { tipo: 'actividad'; actividad: ActividadEnVista };

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const corta = (fechaHora: string | null) => (fechaHora === null ? '' : `${fechaHora.slice(8, 10)}/${fechaHora.slice(5, 7)}/${fechaHora.slice(2, 4)}`);
const larga = (fechaHora: string) => `${fechaHora.slice(8, 10)}/${fechaHora.slice(5, 7)}/${fechaHora.slice(0, 4)}`;
const numeroDeCodigo = (codigo: string) => codigo.split('.').map(Number);
const compararCodigos = (a: string, b: string) => {
  const [x, y] = [numeroDeCodigo(a), numeroDeCodigo(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const d = (x[i] ?? -1) - (y[i] ?? -1);
    if (d !== 0) return d;
  }
  return 0;
};

/** Las filas en el orden de la pantalla (§19.5): la EDT con sus capítulos, las que ya no están, la administración, y hitos y trámites. */
function filasDelGantt(vista: VistaCronograma): Fila[] {
  const delPresupuesto = vista.actividades.filter((a) => a.tipo === 'ITEM' && a.enPresupuesto);
  const edt: { codigo: string; fila: Fila }[] = [
    ...vista.capitulos.map((k) => ({
      codigo: k.codigo,
      fila: { tipo: 'capitulo' as const, codigo: k.codigo, nombre: k.nombre, nivel: k.nivel, inicio: k.inicio, fin: k.fin, dias: k.duracionDias },
    })),
    ...delPresupuesto.map((a) => ({ codigo: a.codigo, fila: { tipo: 'actividad' as const, actividad: a } })),
  ].sort((a, b) => compararCodigos(a.codigo, b.codigo));
  const filas: Fila[] = edt.map((x) => x.fila);
  for (const a of vista.actividades) if (a.tipo === 'ITEM' && !a.enPresupuesto) filas.push({ tipo: 'actividad', actividad: a });
  for (const a of vista.actividades) if (a.tipo === 'ADMINISTRACION') filas.push({ tipo: 'actividad', actividad: a });
  const tramites = vista.actividades.filter((a) => a.tipo === 'HITO_INICIO' || a.tipo === 'HITO_FIN' || a.tipo === 'SIN_COSTO');
  if (tramites.length > 0 || vista.grupos.length > 0) {
    filas.push({ tipo: 'titulo', texto: 'Hitos y trámites' });
    for (const a of tramites.filter((x) => x.grupoId === null)) filas.push({ tipo: 'actividad', actividad: a });
    for (const g of vista.grupos) {
      filas.push({ tipo: 'titulo', texto: g.nombre });
      for (const a of tramites.filter((x) => x.grupoId === g.id)) filas.push({ tipo: 'actividad', actividad: a });
    }
  }
  return filas;
}

export async function generarGanttPdf(datos: DatosDelGantt): Promise<Buffer> {
  const { vista, empresa, presupuesto, formato, escala, logo } = datos;
  const dias = (texto: string | null) => (texto === null ? '' : texto.replace('.', formato.separadorDecimal));
  const titulo = `${presupuesto.codigo} — ${presupuesto.nombre} · Cronograma`;
  const lineaBase = vista.lineaBase;
  const enLineaBase = new Map((lineaBase?.actividades ?? []).map((x) => [x.actividadId, x]));

  // --- La ventana de tiempo de toda la obra, en días enteros -----------------------
  const instantes = [
    ...vista.actividades.flatMap((a) => [a.inicio, a.fin]),
    ...(lineaBase?.actividades ?? []).flatMap((x) => [x.inicio, x.fin]),
  ].map(aMinutos);
  const primerDia = Math.floor(Math.min(...instantes) / MINUTOS_POR_DIA);
  const ultimoDia = Math.floor((Math.max(...instantes) - 1) / MINUTOS_POR_DIA);
  const puntos = PUNTOS_POR_DIA[escala];
  const diasPorHoja = Math.floor((FIN_TIEMPO - INICIO_TIEMPO) / puntos);
  const ventanas: number[] = [];
  for (let d = primerDia; d <= ultimoDia; d += diasPorHoja) ventanas.push(d);

  // El sombreado de lo no laborable, solo por día: en semanas o meses no se leería.
  const obra = compilarCalendario(definicionDe(vista.calendarios.obra), { desde: fechaDeDia(primerDia - 1), hasta: fechaDeDia(ultimoDia + diasPorHoja + 1) });
  const noLaborable = (dia: number) => obra.minutosLaborablesEntre(dia * MINUTOS_POR_DIA, (dia + 1) * MINUTOS_POR_DIA) === 0;

  const pdf = new PDFDocument({ size: [ANCHO, ALTO], margin: MARGEN, compress: false, bufferPages: true, autoFirstPage: false, info: { Title: titulo, Author: empresa.razonSocial } });
  pdf.registerFont('Normal', FUENTE_NORMAL);
  pdf.registerFont('Negrita', FUENTE_NEGRITA);
  const trozos: Buffer[] = [];
  pdf.on('data', (trozo: Buffer) => trozos.push(trozo));
  const terminado = new Promise<Buffer>((resolver) => pdf.on('end', () => resolver(Buffer.concat(trozos))));
  const texto = (t: string, x: number, y: number, fuente: 'Normal' | 'Negrita', tamano: number, opciones: PDFKit.Mixins.TextOptions = {}) =>
    pdf.font(fuente).fontSize(tamano).fillColor('black').text(t, x, y, { lineBreak: false, ...opciones });

  /** El encabezado de toda hoja: quién emite, qué cronograma es y, si hay, contra qué línea base. */
  const encabezado = (): number => {
    let x = MARGEN;
    if (logo) {
      pdf.image(Buffer.from(logo.bytes), MARGEN, MARGEN - 4, { fit: [70, 30] });
      x = MARGEN + 78;
    }
    texto(empresa.razonSocial, x, MARGEN - 4, 'Negrita', 10);
    texto(`NIT ${empresa.nit ?? ''}`, x, MARGEN + 8, 'Normal', 7);
    texto(titulo, INICIO_TIEMPO - 120, MARGEN - 4, 'Negrita', 9);
    texto(
      `Inicio ${larga(vista.cronograma.inicio)} · Fin ${larga(vista.cronograma.fin)} · ${dias(vista.cronograma.duracionDias)} días`,
      INICIO_TIEMPO - 120,
      MARGEN + 8,
      'Normal',
      7,
    );
    if (lineaBase) texto(`Línea base «${lineaBase.nombre}»`, INICIO_TIEMPO - 120, MARGEN + 18, 'Normal', 7);
    return MARGEN + 34;
  };

  const filas = filasDelGantt(vista);
  const altoUtil = ALTO - MARGEN - 16 - (MARGEN + 34 + ALTO_ESCALA);
  const filasPorHoja = Math.max(1, Math.floor(altoUtil / ALTO_FILA));
  const tandas: Fila[][] = [];
  for (let i = 0; i < filas.length; i += filasPorHoja) tandas.push(filas.slice(i, i + filasPorHoja));

  for (const tanda of tandas) {
    for (const desde of ventanas) {
      pdf.addPage({ size: [ANCHO, ALTO], margin: MARGEN });
      const yEscala = encabezado();
      const hasta = desde + diasPorHoja;
      const xDe = (minuto: number) => INICIO_TIEMPO + ((minuto - desde * MINUTOS_POR_DIA) / MINUTOS_POR_DIA) * puntos;
      const recortar = (x: number) => Math.min(FIN_TIEMPO, Math.max(INICIO_TIEMPO, x));
      const yFilas = yEscala + ALTO_ESCALA;
      const yFin = yFilas + tanda.length * ALTO_FILA;

      // --- La escala: meses arriba; abajo, días o el lunes de cada semana ---
      for (let d = desde; d < hasta; d += 1) {
        const fecha = fechaDeDia(d);
        const x = INICIO_TIEMPO + (d - desde) * puntos;
        if (escala === 'DIA' && noLaborable(d)) pdf.save().rect(x, yFilas, puntos, yFin - yFilas).fill(COLOR.noLaborable).restore();
        if (fecha.endsWith('-01') || d === desde) {
          texto(`${MESES[Number(fecha.slice(5, 7)) - 1]} ${fecha.slice(0, 4)}`, x + 1, yEscala, 'Negrita', 6);
          pdf.save().moveTo(x, yEscala).lineTo(x, yFin).lineWidth(0.4).strokeColor('#BBBBBB').stroke().restore();
        }
        if (escala === 'DIA') texto(fecha.slice(8, 10), x, yEscala + 12, 'Normal', 5, { width: puntos, align: 'center' });
        if (escala === 'SEMANA' && new Date(`${fecha}T00:00Z`).getUTCDay() === 1) texto(fecha.slice(8, 10), x, yEscala + 12, 'Normal', 5);
      }
      for (const c of COLUMNAS) texto(c.titulo, c.x, yEscala + 12, 'Negrita', 7, { width: c.ancho, align: c.alinear });
      pdf.save().moveTo(MARGEN, yFilas - 1).lineTo(FIN_TIEMPO, yFilas - 1).lineWidth(0.6).strokeColor('#000000').stroke().restore();

      // --- Las filas ---
      const filaDe = new Map<string, number>();
      tanda.forEach((fila, i) => {
        const y = yFilas + i * ALTO_FILA;
        if (fila.tipo === 'titulo') {
          texto(fila.texto, MARGEN, y + 3, 'Negrita', 7);
          return;
        }
        if (fila.tipo === 'capitulo') {
          const sangria = (fila.nivel - 1) * 6;
          texto(fila.codigo, MARGEN, y + 3, 'Negrita', 7, { width: COLUMNAS[0].ancho });
          texto(fila.nombre, COLUMNAS[1].x + sangria, y + 3, 'Negrita', 7, { width: COLUMNAS[1].ancho - sangria, ellipsis: true });
          texto(dias(fila.dias), COLUMNAS[2].x, y + 3, 'Negrita', 7, { width: COLUMNAS[2].ancho, align: 'right' });
          texto(corta(fila.inicio), COLUMNAS[3].x, y + 3, 'Negrita', 7);
          texto(corta(fila.fin), COLUMNAS[4].x, y + 3, 'Negrita', 7);
          if (fila.inicio && fila.fin) {
            const [x0, x1] = [recortar(xDe(aMinutos(fila.inicio))), recortar(xDe(aMinutos(fila.fin)))];
            if (x1 > x0) pdf.save().rect(x0, y + 4, x1 - x0, 3).fill(COLOR.capitulo).restore();
          }
          return;
        }
        const a = fila.actividad;
        filaDe.set(a.id, y);
        const sangria = a.tipo === 'ITEM' ? 6 : 0;
        texto(a.codigo, MARGEN, y + 3, 'Normal', 7, { width: COLUMNAS[0].ancho });
        texto(a.nombre, COLUMNAS[1].x + sangria, y + 3, 'Normal', 7, { width: COLUMNAS[1].ancho - sangria, ellipsis: true });
        texto(dias(a.duracionDias), COLUMNAS[2].x, y + 3, 'Normal', 7, { width: COLUMNAS[2].ancho, align: 'right' });
        texto(corta(a.inicio), COLUMNAS[3].x, y + 3, 'Normal', 7);
        texto(corta(a.fin), COLUMNAS[4].x, y + 3, 'Normal', 7);

        const base = enLineaBase.get(a.id);
        if (base) {
          const [x0, x1] = [recortar(xDe(aMinutos(base.inicio))), recortar(xDe(aMinutos(base.fin)))];
          if (x1 > x0) pdf.save().rect(x0, y + 10, x1 - x0, 2).fill(COLOR.lineaBase).restore();
        }
        const inicio = xDe(aMinutos(a.inicio));
        if (a.tipo === 'HITO_INICIO' || a.tipo === 'HITO_FIN') {
          if (inicio >= INICIO_TIEMPO && inicio <= FIN_TIEMPO) {
            const yc = y + 6;
            pdf.save().polygon([inicio, yc - 4], [inicio + 4, yc], [inicio, yc + 4], [inicio - 4, yc]).fill(a.tipo === 'HITO_INICIO' ? COLOR.hitoInicio : COLOR.hitoFin).restore();
          }
          return;
        }
        const [x0, x1] = [recortar(inicio), recortar(xDe(aMinutos(a.fin)))];
        if (x1 > x0) {
          const color = a.tipo === 'ADMINISTRACION' ? COLOR.administracion : a.critica ? COLOR.critica : COLOR.barra;
          pdf.save().rect(x0, y + 3, x1 - x0, 6).fill(color).restore();
          // RN-27: la barra que termina a mitad de jornada lleva su marca al final.
          if (a.finAMitadDeJornada && xDe(aMinutos(a.fin)) <= FIN_TIEMPO) pdf.save().rect(x1 - 1.5, y + 2, 1.5, 8).fill(COLOR.mitadDeJornada).restore();
        }
      });

      // --- Las relaciones que tienen sus dos puntas en esta hoja ---
      for (const d of vista.dependencias) {
        const [yp, ys] = [filaDe.get(d.predecesoraId), filaDe.get(d.sucesoraId)];
        if (yp === undefined || ys === undefined) continue;
        const p = vista.actividades.find((a) => a.id === d.predecesoraId)!;
        const s = vista.actividades.find((a) => a.id === d.sucesoraId)!;
        const xp = xDe(aMinutos(d.tipo === 'FC' || d.tipo === 'FF' ? p.fin : p.inicio));
        const xs = xDe(aMinutos(d.tipo === 'FC' || d.tipo === 'CC' ? s.inicio : s.fin));
        if (Math.max(xp, xs) < INICIO_TIEMPO || Math.min(xp, xs) > FIN_TIEMPO) continue;
        const codo = recortar(Math.max(xp, Math.min(xs, xp + 4)));
        pdf
          .save()
          .moveTo(recortar(xp), yp + 6)
          .lineTo(codo, yp + 6)
          .lineTo(codo, ys + 6)
          .lineTo(recortar(xs), ys + 6)
          .lineWidth(0.5)
          .strokeColor(COLOR.relacion)
          .stroke()
          .restore();
      }
    }
  }

  // «Página i de n», cuando ya se sabe cuántas son.
  const { start, count } = pdf.bufferedPageRange();
  for (let i = start; i < start + count; i += 1) {
    pdf.switchToPage(i);
    texto(`Página ${i - start + 1} de ${count}`, MARGEN, ALTO - MARGEN - 10, 'Normal', 7, { width: ANCHO - 2 * MARGEN, align: 'right' });
  }
  pdf.end();
  return terminado;
}

