import ExcelJS from 'exceljs';
import type { DocumentoExportable } from '../infraestructura/basedatos/exportacion.js';
import { etiquetaDeVersion, filasDeLaOferta, formatearFecha, lineasDelPie } from './filas.js';
import { redondear } from './formatoNumerico.js';

/** Los bytes del logo y su formato: los trae el almacenamiento de objetos (D-30), no la base. */
export interface Logo {
  bytes: Uint8Array;
  tipo: 'png' | 'jpeg';
}

const COLUMNAS = ['Ítem', 'Descripción', 'Unidad', 'Cantidad', 'Precio unitario', 'Total'];

/**
 * Un importe listo para una celda numérica de Excel. Es el único Number() del
 * exportador y no tiene alternativa: Excel guarda cada celda numérica como
 * doble precisión. Por eso se redondea ANTES, sobre el texto, a los decimales
 * de la empresa (06 §2.2), y solo entonces se convierte. Excel representa
 * exactos los importes con dos decimales hasta del orden de diez billones.
 */
function celda(texto: string, decimales: number): number {
  return Number(redondear(texto, decimales));
}

function formatoDeCelda(decimales: number): string {
  return decimales === 0 ? '#,##0' : `#,##0.${'0'.repeat(decimales)}`;
}

/**
 * RF-PRE-29 · El Excel de la oferta (02 §9.5): una sola hoja, ordenada por la
 * EDT, con el agrupamiento nativo de Excel por nivel —los controles (+ / −)
 * contraen y expanden capítulos— y valores numéricos planos, sin fórmulas.
 *
 * Es una función pura: fotografía, formato y logo adentro, bytes afuera. No
 * toca la base ni el almacenamiento. Lo que no está en la fotografía —el
 * desglose de los APU— no puede salir aquí (RF-PRE-31).
 *
 * Los separadores de miles y decimales los pone el Excel de quien abre el
 * archivo: una celda numérica no admite los de la empresa sin volverse texto,
 * y el 02 pide valores numéricos. Los decimales sí son los de la empresa, en
 * el formato de cada celda.
 */
export async function generarExcel(documento: DocumentoExportable, logo: Logo | null): Promise<Buffer> {
  const { fotografia, formato } = documento;
  const p = fotografia.presupuesto;
  const d = formato.decimalesVista;
  const formatoNumero = formatoDeCelda(d);

  const libro = new ExcelJS.Workbook();
  // summaryBelow = false: el capítulo está ENCIMA de lo que agrupa. Con el valor
  // por defecto Excel toma como resumen la fila de abajo y el (+) queda corrido.
  const hoja = libro.addWorksheet('Presupuesto', {
    properties: { outlineProperties: { summaryBelow: false, summaryRight: false } },
  });
  hoja.columns = [{ width: 10 }, { width: 50 }, { width: 10 }, { width: 14 }, { width: 18 }, { width: 20 }];

  // Encabezado: la empresa como quedó en la fotografía (D-28, D-64) y el presupuesto.
  hoja.addRow([fotografia.empresa.razonSocial]).font = { bold: true, size: 14 };
  hoja.addRow([`NIT ${fotografia.empresa.nit ?? ''}`]);
  hoja.addRow([`${p.codigo} — ${p.nombre}`]).font = { bold: true };
  hoja.addRow([p.ubicacion]);
  hoja.addRow([`Estado: ${p.estado}`, '', `Moneda: ${p.moneda}`]);
  hoja.addRow([`Fecha de elaboración: ${formatearFecha(p.fechaElaboracion)}`]);
  const version = etiquetaDeVersion(documento);
  if (version !== null) hoja.addRow([version]).font = { bold: true };
  hoja.addRow([]);

  if (logo) {
    const imagen = libro.addImage({ buffer: Buffer.from(logo.bytes) as never, extension: logo.tipo });
    hoja.addImage(imagen, { tl: { col: 4, row: 0 }, ext: { width: 160, height: 60 } });
  }

  const titulos = hoja.addRow(COLUMNAS);
  titulos.font = { bold: true };

  for (const f of filasDeLaOferta(fotografia)) {
    const fila = hoja.addRow([
      f.codigo,
      f.descripcion,
      f.unidad ?? '',
      f.cantidad === null ? '' : celda(f.cantidad, d),
      f.precioUnitario === null ? '' : celda(f.precioUnitario, d),
      celda(f.total, d),
    ]);
    fila.outlineLevel = f.nivel - 1;
    if (f.tipo === 'capitulo') fila.font = { bold: true };
    for (const c of [4, 5, 6]) fila.getCell(c).numFmt = formatoNumero;
  }

  // Pie financiero (D-28, 02 §8.6), del mismo sitio que el del PDF.
  hoja.addRow([]);
  for (const linea of lineasDelPie(fotografia, formato)) {
    const fila = hoja.addRow([linea.concepto, '', '', '', '', celda(linea.valor, d)]);
    fila.getCell(6).numFmt = formatoNumero;
    if (linea.destacado) fila.font = { bold: true };
  }

  return Buffer.from(await libro.xlsx.writeBuffer());
}
