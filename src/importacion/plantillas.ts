import ExcelJS from 'exceljs';

/*
 * Las plantillas de importación (CONTRATO §10.3 y §10.4). Las columnas viven
 * aquí y las lee el mismo módulo que valida: la plantilla y el lector no
 * pueden desalinearse. Las listas desplegables salen de una hoja oculta,
 * «Listas», con los tipos y las unidades de la empresa al momento de
 * descargar.
 */

export const MAXIMO_DE_FILAS = 2000;

export const HOJA_RECURSOS = 'Recursos';
export const COLUMNAS_RECURSOS = ['Nombre', 'Tipo', 'Unidad', 'Precio base (sin IVA)', 'IVA %', 'Precio total (con IVA)'] as const;

export const HOJA_APU = 'APU';
export const COLUMNAS_APU = ['Clave', 'Nombre de la actividad', 'Unidad'] as const;
export const HOJA_COMPOSICION = 'Composición';
export const COLUMNAS_COMPOSICION = ['Clave del APU', 'Código del recurso', 'Cantidad', 'Rendimiento', 'Desperdicio %'] as const;
export const HOJA_CATALOGO = 'Recursos';
const COLUMNAS_CATALOGO = ['Código', 'Nombre', 'Tipo', 'Unidad', 'Precio total'] as const;

/** Los cuatro tipos, como los ve la persona y como los guarda la base. */
export const TIPOS: readonly (readonly [string, 'MATERIAL' | 'EQUIPO' | 'PERSONAL' | 'ACTIVIDAD_TODO_COSTO'])[] = [
  ['Material', 'MATERIAL'],
  ['Equipo', 'EQUIPO'],
  ['Personal', 'PERSONAL'],
  ['Actividad a todo costo', 'ACTIVIDAD_TODO_COSTO'],
];

function instrucciones(libro: ExcelJS.Workbook, lineas: string[]): void {
  const hoja = libro.addWorksheet('Instrucciones');
  hoja.getColumn(1).width = 110;
  for (const linea of lineas) hoja.addRow([linea]);
  hoja.getRow(1).font = { bold: true, size: 13 };
}

function encabezado(hoja: ExcelJS.Worksheet, columnas: readonly string[], anchos: number[]): void {
  hoja.addRow([...columnas]).font = { bold: true };
  anchos.forEach((ancho, i) => (hoja.getColumn(i + 1).width = ancho));
  hoja.views = [{ state: 'frozen', ySplit: 1 }];
}

/** La hoja oculta que sostiene las listas: A, los tipos; B, las unidades. */
function listas(libro: ExcelJS.Workbook, unidades: string[]): { tipos: string; unidades: string } {
  const hoja = libro.addWorksheet('Listas', { state: 'veryHidden' });
  TIPOS.forEach(([etiqueta], i) => (hoja.getCell(i + 1, 1).value = etiqueta));
  unidades.forEach((simbolo, i) => (hoja.getCell(i + 1, 2).value = simbolo));
  return {
    tipos: `Listas!$A$1:$A$${TIPOS.length}`,
    unidades: `Listas!$B$1:$B$${Math.max(unidades.length, 1)}`,
  };
}

function lista(hoja: ExcelJS.Worksheet, columna: string, rango: string, que: string): void {
  // exceljs lo implementa pero sus tipos no lo declaran.
  (hoja as unknown as { dataValidations: { add(rango: string, validacion: object): void } }).dataValidations.add(`${columna}2:${columna}${MAXIMO_DE_FILAS + 1}`, {
    type: 'list',
    allowBlank: true,
    formulae: [rango],
    showErrorMessage: true,
    errorTitle: 'Valor no válido',
    error: `Elija ${que} de la lista desplegable.`,
  });
}

export async function generarPlantillaDeRecursos(unidades: string[]): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  instrucciones(libro, [
    'Importar recursos desde Excel',
    '',
    `Llene la hoja «${HOJA_RECURSOS}»: una fila por recurso, desde la fila 2. Hasta ${MAXIMO_DE_FILAS} filas.`,
    'Nombre, Tipo y Unidad son obligatorios. Tipo y Unidad se eligen de la lista desplegable.',
    'Escriba UNO solo de los dos precios: el base (sin IVA) o el total (con IVA). El otro lo calcula el sistema con el IVA.',
    'Si llena los dos, la fila se rechaza aunque cuadren: no hay forma de saber cuál capturó.',
    'IVA % vacío es 0 %. Las cifras van como números, sin el signo $ ni puntos de miles.',
    '',
    'La importación solo crea recursos nuevos; no modifica los que ya existen. El código lo asigna el sistema.',
    'Si alguna fila tiene un error, no se importa nada y se le dice cuál corregir: hoja, fila y columna.',
  ]);
  const hoja = libro.addWorksheet(HOJA_RECURSOS);
  encabezado(hoja, COLUMNAS_RECURSOS, [42, 24, 12, 22, 10, 24]);
  const rangos = listas(libro, unidades);
  lista(hoja, 'B', rangos.tipos, 'el tipo');
  lista(hoja, 'C', rangos.unidades, 'la unidad');
  return Buffer.from(await libro.xlsx.writeBuffer());
}

export interface RecursoDelCatalogo {
  codigo: string;
  nombre: string;
  tipo: string;
  unidadSimbolo: string;
  precioTotal: string;
}

export async function generarPlantillaDeApu(unidades: string[], catalogo: RecursoDelCatalogo[]): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  instrucciones(libro, [
    'Importar APU desde Excel',
    '',
    `Hoja «${HOJA_APU}»: una fila por APU. La Clave la pone usted (A1, A2…): solo sirve para unir las dos hojas y no se guarda.`,
    `Hoja «${HOJA_COMPOSICION}»: una fila por línea del APU, con la Clave del APU al que pertenece y el código del recurso.`,
    `Los códigos de los recursos están en la hoja «${HOJA_CATALOGO}», que es de consulta: no se importa.`,
    'Cantidad: cuántas unidades del recurso intervienen a la vez (2 oficiales, 1 mezcladora). Si la deja vacía, es 1.',
    'Rendimiento: cuánto consume UNA unidad del recurso por cada unidad de obra (0,05 jornal por m³). Si lo deja vacío, es 1.',
    'No son lo mismo: si los confunde, el APU sale inflado sin que nada avise. Ninguno de los dos admite cero.',
    'Desperdicio % solo para recursos de tipo Material; vacío es 0 %.',
    'Todo APU necesita al menos una línea. Los recursos tienen que existir antes de importar el APU.',
    '',
    'La importación solo crea APU nuevos. Si alguna fila tiene un error, no se importa nada y se le dice cuál corregir.',
  ]);
  const apu = libro.addWorksheet(HOJA_APU);
  encabezado(apu, COLUMNAS_APU, [10, 50, 12]);
  const composicion = libro.addWorksheet(HOJA_COMPOSICION);
  encabezado(composicion, COLUMNAS_COMPOSICION, [14, 20, 12, 14, 14]);
  const consulta = libro.addWorksheet(HOJA_CATALOGO);
  encabezado(consulta, COLUMNAS_CATALOGO, [14, 50, 24, 10, 18]);
  for (const r of catalogo) {
    const etiqueta = TIPOS.find(([, valor]) => valor === r.tipo)?.[0] ?? r.tipo;
    consulta.addRow([r.codigo, r.nombre, etiqueta, r.unidadSimbolo, Number(r.precioTotal)]);
  }
  const rangos = listas(libro, unidades);
  lista(apu, 'C', rangos.unidades, 'la unidad');
  return Buffer.from(await libro.xlsx.writeBuffer());
}
