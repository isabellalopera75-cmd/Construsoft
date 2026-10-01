import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import type { DocumentoExportable } from '../infraestructura/basedatos/exportacion.js';
import type { Logo } from './excel.js';
import { etiquetaDeVersion, filasDeLaOferta, formatearFecha, lineasDelPie, type FilaOferta } from './filas.js';
import { formatearNumero } from './formatoNumerico.js';

/*
 * Las fuentes VIAJAN dentro del PDF. Con las estándar (Helvetica), el
 * documento solo dice «dibujá el carácter 0xB3 de una Helvetica» y cada visor
 * la reemplaza por la que tenga: en uno salía m³ y en otro m, y ninguna prueba
 * de texto podía verlo, porque el texto estaba bien. Incrustada, la fuente
 * que dibuja es siempre la misma, y un carácter que no tenga se delata como
 * el glifo 0 (.notdef), cosa que sí se puede probar.
 *
 * DejaVu Sans Condensed: licencia Bitstream Vera, libre de redistribuir con su
 * aviso (fuentes/LICENSE-DejaVu.txt). Cubre el español, los superíndices de
 * las unidades y los símbolos de la oferta.
 */
const FUENTE_NORMAL = fileURLToPath(new URL('./fuentes/DejaVuSansCondensed.ttf', import.meta.url));
const FUENTE_NEGRITA = fileURLToPath(new URL('./fuentes/DejaVuSansCondensed-Bold.ttf', import.meta.url));

const MARGEN = 40;
/** Alto reservado al pie de cada página para «Página i de n». */
const RESERVA_NUMERACION = 18;
const ALTO_TITULOS = 14;
const ALTO_LINEA_PIE = 14;
/** Cuántas filas de la tabla acompañan al pie si este no cabe: nunca queda solo en una hoja. */
const FILAS_QUE_ACOMPANAN_AL_PIE = 3;

/** Columnas de la tabla: x, ancho y alineación. Carta, 612 puntos de ancho. */
const COLUMNAS = [
  { titulo: 'Ítem', x: 40, ancho: 42, alinear: 'left' },
  { titulo: 'Descripción', x: 84, ancho: 206, alinear: 'left' },
  { titulo: 'Unidad', x: 292, ancho: 40, alinear: 'left' },
  { titulo: 'Cantidad', x: 334, ancho: 62, alinear: 'right' },
  { titulo: 'Precio unitario', x: 398, ancho: 80, alinear: 'right' },
  { titulo: 'Total', x: 480, ancho: 92, alinear: 'right' },
] as const;

/** Estilos por nivel (RF-PRE-30): el capítulo con fondo y negrita, el subcapítulo en negrita, la actividad normal. */
function estiloDe(fila: FilaOferta): { fuente: 'Normal' | 'Negrita'; tamano: number; fondo: string | null } {
  if (fila.tipo === 'actividad') return { fuente: 'Normal', tamano: 8, fondo: null };
  if (fila.nivel === 1) return { fuente: 'Negrita', tamano: 9, fondo: '#E6E6E6' };
  return { fuente: 'Negrita', tamano: 8, fondo: null };
}

interface FilaMedida {
  fila: FilaOferta;
  alto: number;
}

/**
 * Reparte las filas en páginas ANTES de dibujar, para poder decidir dos cosas
 * que dibujando de corrido no se pueden decidir:
 *
 *  · un capítulo no queda solo al pie de una página, lejos de su primera fila;
 *  · el pie financiero no queda huérfano en una hoja sola: si no cabe después
 *    de la última fila, se lleva consigo las últimas filas de la tabla.
 */
function repartir(filas: FilaMedida[], altoPrimera: number, altoSiguientes: number, altoPie: number): FilaMedida[][] {
  const paginas: FilaMedida[][] = [[]];
  let libre = altoPrimera;
  filas.forEach((medida, i) => {
    const siguiente = filas[i + 1];
    const necesita = medida.alto + (medida.fila.tipo === 'capitulo' && siguiente ? siguiente.alto : 0);
    if (necesita > libre && paginas.at(-1)!.length > 0) {
      paginas.push([]);
      libre = altoSiguientes;
    }
    paginas.at(-1)!.push(medida);
    libre -= medida.alto;
  });

  if (altoPie > libre) {
    const ultima = paginas.at(-1)!;
    const llevadas = ultima.splice(Math.max(0, ultima.length - FILAS_QUE_ACOMPANAN_AL_PIE));
    paginas.push(llevadas);
    if (ultima.length === 0) paginas.splice(paginas.length - 2, 1);
  }
  return paginas;
}

/**
 * RF-PRE-30 · El PDF corporativo de la oferta (02 §9.5): logo y NIT de la
 * empresa tal como quedaron en la fotografía (D-28, D-64), fecha de
 * elaboración, y la EDT en una tabla jerárquica con estilos por nivel. Los
 * importes van con los separadores y los decimales de la empresa
 * (RF-CFG-14/15), redondeados una sola vez aquí.
 *
 * Cada página repite quién emite y qué presupuesto es, y los títulos de las
 * columnas, y dice «Página i de n»: una hoja suelta de la oferta tiene que
 * poder leerse sola.
 *
 * Función pura, como generarExcel: fotografía, formato y logo adentro, bytes
 * afuera. El desglose de los APU no está en la fotografía, así que no puede
 * aparecer (RF-PRE-31). Sin compresión: las pruebas leen lo que dice.
 */
export async function generarPdf(documento: DocumentoExportable, logo: Logo | null): Promise<Buffer> {
  const { fotografia, formato } = documento;
  const version = etiquetaDeVersion(documento);
  const p = fotografia.presupuesto;
  const numero = (texto: string | null) => (texto === null ? '' : formatearNumero(texto, formato));
  const titulo = `${p.codigo} — ${p.nombre}`;

  const pdf = new PDFDocument({
    size: 'LETTER',
    margin: MARGEN,
    compress: false,
    bufferPages: true,
    info: { Title: titulo, Author: fotografia.empresa.razonSocial },
  });
  pdf.registerFont('Normal', FUENTE_NORMAL);
  pdf.registerFont('Negrita', FUENTE_NEGRITA);
  const trozos: Buffer[] = [];
  pdf.on('data', (trozo: Buffer) => trozos.push(trozo));
  const terminado = new Promise<Buffer>((resolver) => pdf.on('end', () => resolver(Buffer.concat(trozos))));

  const linea = (texto: string, x: number, y: number, fuente: 'Normal' | 'Negrita', tamano: number) =>
    pdf.font(fuente).fontSize(tamano).text(texto, x, y, { lineBreak: false });

  /** Encabezado completo de la primera página. Devuelve dónde empieza la tabla. */
  const encabezadoCompleto = (): number => {
    let x = MARGEN;
    if (logo) {
      pdf.image(Buffer.from(logo.bytes), MARGEN, MARGEN, { fit: [110, 50] });
      x = MARGEN + 120;
    }
    linea(fotografia.empresa.razonSocial, x, MARGEN, 'Negrita', 14);
    linea(`NIT ${fotografia.empresa.nit ?? ''}`, x, MARGEN + 18, 'Normal', 9);
    linea(titulo, MARGEN, MARGEN + 62, 'Negrita', 11);
    linea(p.ubicacion, MARGEN, MARGEN + 78, 'Normal', 9);
    linea(`Estado: ${p.estado}   ·   Moneda: ${p.moneda}`, MARGEN, MARGEN + 91, 'Normal', 9);
    linea(`Fecha de elaboración: ${formatearFecha(p.fechaElaboracion)}`, MARGEN, MARGEN + 104, 'Normal', 9);
    if (version !== null) linea(version, MARGEN, MARGEN + 117, 'Negrita', 9);
    return MARGEN + 139;
  };

  /** Encabezado corto de las páginas siguientes: quién emite y qué presupuesto es. */
  const encabezadoCorto = (): number => {
    linea(fotografia.empresa.razonSocial, MARGEN, MARGEN, 'Negrita', 9);
    linea(titulo, MARGEN, MARGEN + 12, 'Normal', 8);
    if (version !== null) linea(version, 440, MARGEN + 12, 'Negrita', 8);
    return MARGEN + 32;
  };

  const titulosDeColumnas = (y: number): number => {
    pdf.font('Negrita').fontSize(8);
    for (const c of COLUMNAS) pdf.text(c.titulo, c.x, y, { width: c.ancho, align: c.alinear, lineBreak: false });
    pdf.moveTo(MARGEN, y + ALTO_TITULOS - 3).lineTo(pdf.page.width - MARGEN, y + ALTO_TITULOS - 3).stroke();
    return y + ALTO_TITULOS;
  };

  // Medir antes de dibujar: el reparto en páginas depende de los altos.
  const filas: FilaMedida[] = filasDeLaOferta(fotografia).map((fila) => {
    const estilo = estiloDe(fila);
    const sangria = (fila.nivel - 1) * 8;
    pdf.font(estilo.fuente).fontSize(estilo.tamano);
    const alto = Math.max(12, pdf.heightOfString(fila.descripcion, { width: COLUMNAS[1].ancho - sangria }) + 4);
    return { fila, alto };
  });
  const pie = lineasDelPie(fotografia, formato);
  const fondo = pdf.page.height - MARGEN - RESERVA_NUMERACION;
  const inicioPrimera = encabezadoCompleto() + ALTO_TITULOS;
  const altoPrimera = fondo - inicioPrimera;
  const altoSiguientes = fondo - (MARGEN + 32 + ALTO_TITULOS);
  const altoPie = 10 + pie.length * ALTO_LINEA_PIE;

  const paginas = repartir(filas, altoPrimera, altoSiguientes, altoPie);

  paginas.forEach((enEsta, i) => {
    let y: number;
    if (i === 0) {
      y = titulosDeColumnas(inicioPrimera - ALTO_TITULOS);
    } else {
      pdf.addPage();
      y = titulosDeColumnas(encabezadoCorto());
    }
    for (const { fila, alto } of enEsta) {
      const estilo = estiloDe(fila);
      const sangria = (fila.nivel - 1) * 8;
      if (estilo.fondo) {
        pdf.save().rect(MARGEN, y - 2, pdf.page.width - 2 * MARGEN, alto).fill(estilo.fondo).restore();
        pdf.fillColor('black');
      }
      pdf.font(estilo.fuente).fontSize(estilo.tamano);
      const celdas = [fila.codigo, fila.descripcion, fila.unidad ?? '', numero(fila.cantidad), numero(fila.precioUnitario), numero(fila.total)];
      COLUMNAS.forEach((c, k) => {
        const esDescripcion = k === 1;
        pdf.text(celdas[k]!, c.x + (esDescripcion ? sangria : 0), y, {
          width: c.ancho - (esDescripcion ? sangria : 0),
          align: c.alinear,
          lineBreak: esDescripcion,
        });
      });
      y += alto;
    }

    // Pie financiero (02 §8.6), del mismo sitio que el del Excel, en la última página.
    if (i === paginas.length - 1) {
      y += 10;
      for (const l of pie) {
        pdf.font(l.destacado ? 'Negrita' : 'Normal').fontSize(l.destacado ? 10 : 9);
        pdf.text(l.concepto, 300, y, { width: 178, align: 'right', lineBreak: false });
        pdf.text(numero(l.valor), 480, y, { width: 92, align: 'right', lineBreak: false });
        y += ALTO_LINEA_PIE;
      }
    }
  });

  // «Página i de n», cuando ya se sabe cuántas son.
  const { start, count } = pdf.bufferedPageRange();
  for (let i = start; i < start + count; i += 1) {
    pdf.switchToPage(i);
    pdf.font('Normal').fontSize(8).text(`Página ${i - start + 1} de ${count}`, MARGEN, pdf.page.height - MARGEN - 10, {
      width: pdf.page.width - 2 * MARGEN,
      align: 'right',
      lineBreak: false,
    });
  }

  pdf.end();
  return terminado;
}
