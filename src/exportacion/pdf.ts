import PDFDocument from 'pdfkit';
import type { DocumentoExportable } from '../infraestructura/basedatos/exportacion.js';
import type { Logo } from './excel.js';
import { filasDeLaOferta, lineasDelPie, type FilaOferta } from './filas.js';
import { formatearNumero } from './formatoNumerico.js';

const MARGEN = 40;

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
function estiloDe(fila: FilaOferta): { fuente: string; tamano: number; fondo: string | null } {
  if (fila.tipo === 'actividad') return { fuente: 'Helvetica', tamano: 8, fondo: null };
  if (fila.nivel === 1) return { fuente: 'Helvetica-Bold', tamano: 9, fondo: '#E6E6E6' };
  return { fuente: 'Helvetica-Bold', tamano: 8, fondo: null };
}

/**
 * RF-PRE-30 · El PDF corporativo de la oferta (02 §9.5): logo y NIT de la
 * empresa en el encabezado, tal como quedaron en la fotografía (D-28, D-64),
 * y la EDT en una tabla jerárquica con estilos por nivel. Los importes van con
 * los separadores y los decimales de la empresa (RF-CFG-14/15), redondeados
 * una sola vez aquí.
 *
 * Función pura, como generarExcel: fotografía, formato y logo adentro, bytes
 * afuera. El desglose de los APU no está en la fotografía, así que no puede
 * aparecer (RF-PRE-31). Sin compresión: el documento es texto y tablas, y así
 * las pruebas pueden leer lo que dice.
 */
export async function generarPdf(documento: DocumentoExportable, logo: Logo | null): Promise<Buffer> {
  const { fotografia, formato, numeroVersion } = documento;
  const p = fotografia.presupuesto;
  const numero = (texto: string | null) => (texto === null ? '' : formatearNumero(texto, formato));

  const pdf = new PDFDocument({
    size: 'LETTER',
    margin: MARGEN,
    compress: false,
    info: { Title: `${p.codigo} — ${p.nombre}`, Author: fotografia.empresa.razonSocial },
  });
  const trozos: Buffer[] = [];
  pdf.on('data', (trozo: Buffer) => trozos.push(trozo));
  const terminado = new Promise<Buffer>((resolver) => pdf.on('end', () => resolver(Buffer.concat(trozos))));

  // Encabezado: el logo a la izquierda y los datos a la derecha de él.
  let xTexto = MARGEN;
  if (logo) {
    pdf.image(Buffer.from(logo.bytes), MARGEN, MARGEN, { fit: [110, 50] });
    xTexto = MARGEN + 120;
  }
  pdf.font('Helvetica-Bold').fontSize(14).text(fotografia.empresa.razonSocial, xTexto, MARGEN, { lineBreak: false });
  pdf.font('Helvetica').fontSize(9).text(`NIT ${fotografia.empresa.nit ?? ''}`, xTexto, MARGEN + 18, { lineBreak: false });
  pdf.font('Helvetica-Bold').fontSize(11).text(`${p.codigo} — ${p.nombre}`, MARGEN, MARGEN + 62, { lineBreak: false });
  pdf.font('Helvetica').fontSize(9).text(p.ubicacion, MARGEN, MARGEN + 78, { lineBreak: false });
  pdf.text(`Estado: ${p.estado}   ·   Moneda: ${p.moneda}`, MARGEN, MARGEN + 91, { lineBreak: false });
  if (numeroVersion !== null) {
    pdf.font('Helvetica-Bold').text(`Versión ${numeroVersion}`, MARGEN, MARGEN + 104, { lineBreak: false });
  }

  let y = MARGEN + 126;
  const limite = pdf.page.height - MARGEN;

  const titulos = () => {
    pdf.font('Helvetica-Bold').fontSize(8);
    for (const c of COLUMNAS) pdf.text(c.titulo, c.x, y, { width: c.ancho, align: c.alinear, lineBreak: false });
    y += 14;
    pdf.moveTo(MARGEN, y - 3).lineTo(pdf.page.width - MARGEN, y - 3).stroke();
  };
  const saltoSiHaceFalta = (alto: number) => {
    if (y + alto > limite) {
      pdf.addPage();
      y = MARGEN;
      titulos();
    }
  };

  titulos();
  for (const fila of filasDeLaOferta(fotografia)) {
    const estilo = estiloDe(fila);
    const sangria = (fila.nivel - 1) * 8;
    const descripcion = COLUMNAS[1];
    pdf.font(estilo.fuente).fontSize(estilo.tamano);
    const alto = Math.max(
      12,
      pdf.heightOfString(fila.descripcion, { width: descripcion.ancho - sangria }) + 4,
    );
    saltoSiHaceFalta(alto);
    if (estilo.fondo) {
      pdf.save().rect(MARGEN, y - 2, pdf.page.width - 2 * MARGEN, alto).fill(estilo.fondo).restore();
      pdf.fillColor('black');
    }
    pdf.font(estilo.fuente).fontSize(estilo.tamano);
    const celdas = [fila.codigo, fila.descripcion, fila.unidad ?? '', numero(fila.cantidad), numero(fila.precioUnitario), numero(fila.total)];
    COLUMNAS.forEach((c, i) => {
      const esDescripcion = i === 1;
      pdf.text(celdas[i]!, c.x + (esDescripcion ? sangria : 0), y, {
        width: c.ancho - (esDescripcion ? sangria : 0),
        align: c.alinear,
        lineBreak: esDescripcion,
      });
    });
    y += alto;
  }

  // Pie financiero (02 §8.6), del mismo sitio que el del Excel.
  y += 10;
  for (const linea of lineasDelPie(fotografia, formato)) {
    saltoSiHaceFalta(14);
    pdf.font(linea.destacado ? 'Helvetica-Bold' : 'Helvetica').fontSize(linea.destacado ? 10 : 9);
    pdf.text(linea.concepto, 300, y, { width: 178, align: 'right', lineBreak: false });
    pdf.text(numero(linea.valor), 480, y, { width: 92, align: 'right', lineBreak: false });
    y += 14;
  }

  pdf.end();
  return terminado;
}
