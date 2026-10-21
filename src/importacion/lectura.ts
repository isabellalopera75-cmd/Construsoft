import ExcelJS from 'exceljs';
import { cifraDeCelda, valorDeCelda } from './celdas.js';
import {
  COLUMNAS_APU,
  COLUMNAS_COMPOSICION,
  COLUMNAS_FESTIVOS,
  COLUMNAS_RECURSOS,
  HOJA_APU,
  HOJA_COMPOSICION,
  HOJA_FESTIVOS,
  HOJA_RECURSOS,
  MAXIMO_DE_FILAS,
  TIPOS,
} from './plantillas.js';

/*
 * Leer y validar un archivo de importación (CONTRATO §10). Valida TODO el
 * archivo y junta todos los errores, no solo el primero: la persona corrige
 * de una vez. `fila` es el número que Excel muestra a la izquierda, contando
 * el encabezado; `columna`, el título de la plantilla, o null si el error es
 * de la fila entera. La base sigue siendo el respaldo de cada regla.
 */

export interface ErrorDeFila {
  hoja: string;
  fila: number;
  columna: string | null;
  mensaje: string;
}

/** El archivo entero no sirve: no es un .xlsx, le falta una hoja, o es demasiado grande. */
export class ArchivoNoValido extends Error {
  constructor(
    mensaje: string,
    readonly demasiadoGrande = false,
  ) {
    super(mensaje);
  }
}

export interface UnidadDisponible {
  id: string;
  simbolo: string;
}

export interface RecursoAImportar {
  fila: number;
  nombre: string;
  tipo: (typeof TIPOS)[number][1];
  unidadId: string;
  /** Qué precio llenó la persona: decide cuál calcula la base. */
  viaCaptura: 'BASE' | 'TOTAL';
  precio: string;
  ivaPct: string;
}

export interface LineaAImportar {
  fila: number;
  recursoId: string;
  cantidad: string;
  rendimiento: string;
  desperdicioPct: string;
}

export interface ApuAImportar {
  fila: number;
  nombre: string;
  unidadId: string;
  lineas: LineaAImportar[];
}

export interface RecursoDisponible {
  id: string;
  codigo: string;
  tipo: string;
}

async function abrir(archivo: Buffer): Promise<ExcelJS.Workbook> {
  // Un .xlsx es un ZIP: empieza por «PK». Lo demás ni se intenta abrir.
  if (archivo.length < 4 || archivo.subarray(0, 2).toString('latin1') !== 'PK') {
    throw new ArchivoNoValido('El archivo no es un Excel (.xlsx). Descargue la plantilla, llénela y súbala sin cambiarle el formato.');
  }
  const libro = new ExcelJS.Workbook();
  try {
    await libro.xlsx.load(archivo as never);
  } catch {
    throw new ArchivoNoValido('El archivo no se pudo abrir como Excel (.xlsx). Guárdelo de nuevo desde Excel y vuelva a subirlo.');
  }
  return libro;
}

/** La hoja con sus encabezados en su lugar, y las filas con algo escrito. */
function hojaDeLaPlantilla(libro: ExcelJS.Workbook, nombre: string, columnas: readonly string[]) {
  const hoja = libro.getWorksheet(nombre);
  if (!hoja) {
    throw new ArchivoNoValido(`El archivo no trae la hoja «${nombre}». Descargue la plantilla y llene esa hoja.`);
  }
  const titulos = columnas.map((_, i) => valorDeCelda(hoja.getRow(1).getCell(i + 1)));
  if (columnas.some((columna, i) => String(titulos[i] ?? '').toLowerCase() !== columna.toLowerCase())) {
    throw new ArchivoNoValido(
      `La hoja «${nombre}» no tiene las columnas de la plantilla (${columnas.join(', ')}). Descargue la plantilla de nuevo.`,
    );
  }
  const filas: { numero: number; valores: (string | number | null)[] }[] = [];
  for (let numero = 2; numero <= hoja.rowCount; numero += 1) {
    const valores = columnas.map((_, i) => valorDeCelda(hoja.getRow(numero).getCell(i + 1)));
    if (valores.every((v) => v === null)) continue;
    filas.push({ numero, valores });
  }
  if (filas.length > MAXIMO_DE_FILAS) {
    throw new ArchivoNoValido(
      `La hoja «${nombre}» tiene ${filas.length} filas y el máximo es ${MAXIMO_DE_FILAS}. Divida el archivo en varios y súbalos por separado.`,
      true,
    );
  }
  return filas;
}

type Celda = string | number | null;

/** Las celdas de una fila, sin huecos: lo que no está es null. */
function completas(valores: (string | number | null)[], cuantas: number): (string | number | null)[] {
  return Array.from({ length: cuantas }, (_, i) => valores[i] ?? null);
}

function unidadPorSimbolo(unidades: UnidadDisponible[], simbolo: string): UnidadDisponible | undefined {
  // D-31: los símbolos no se distinguen por mayúsculas («Kg» y «kg» son el mismo).
  return unidades.find((u) => u.simbolo.toLowerCase() === simbolo.toLowerCase());
}

/** Un recurso del catálogo, por su nombre: no puede haber dos con el mismo. */
export interface NombreExistente {
  nombre: string;
  codigo: string;
}

/** Decisión del dueño, 7 de octubre de 2026: mismo nombre sin importar mayúsculas ni espacios de los bordes. */
const llaveDeNombre = (nombre: string) => nombre.trim().toLowerCase();

export async function leerArchivoDeRecursos(
  archivo: Buffer,
  unidades: UnidadDisponible[],
  existentes: NombreExistente[] = [],
): Promise<{ recursos: RecursoAImportar[]; errores: ErrorDeFila[] }> {
  const filas = hojaDeLaPlantilla(await abrir(archivo), HOJA_RECURSOS, COLUMNAS_RECURSOS);
  const delCatalogo = new Map(existentes.map((e) => [llaveDeNombre(e.nombre), e]));
  const filaDelNombre = new Map<string, number>();
  const recursos: RecursoAImportar[] = [];
  const errores: ErrorDeFila[] = [];
  const [cNombre, cTipo, cUnidad, cBase, cIva, cTotal] = COLUMNAS_RECURSOS;

  if (filas.length === 0) {
    throw new ArchivoNoValido(`La hoja «${HOJA_RECURSOS}» no trae ninguna fila: escriba los recursos desde la fila 2.`);
  }
  for (const { numero, valores } of filas) {
    const error = (columna: string | null, mensaje: string) => errores.push({ hoja: HOJA_RECURSOS, fila: numero, columna, mensaje });
    const antes = errores.length;
    const [nombre, tipo, unidad, base, iva, total] = completas(valores, 6) as [Celda, Celda, Celda, Celda, Celda, Celda];

    if (nombre === null) error(cNombre, 'Escriba el nombre.');
    else {
      const llave = llaveDeNombre(String(nombre));
      const existente = delCatalogo.get(llave);
      if (existente) {
        error(cNombre, `Ya existe un recurso llamado «${existente.nombre}» (${existente.codigo}). Cambie el nombre o quite la fila.`);
      } else if (filaDelNombre.has(llave)) {
        error(cNombre, `Esta fila repite el nombre de la fila ${filaDelNombre.get(llave)}: no puede haber dos recursos con el mismo nombre.`);
      } else filaDelNombre.set(llave, numero);
    }
    const tipoValor = tipo === null ? undefined : TIPOS.find(([etiqueta]) => etiqueta.toLowerCase() === String(tipo).toLowerCase())?.[1];
    if (!tipoValor) error(cTipo, tipo === null ? 'Elija el tipo de la lista desplegable.' : `«${tipo}» no es un tipo: elija uno de la lista desplegable.`);
    const unidadValor = unidad === null ? undefined : unidadPorSimbolo(unidades, String(unidad));
    if (!unidadValor) {
      error(cUnidad, unidad === null ? 'Elija la unidad de la lista desplegable.' : `La unidad «${unidad}» no existe en su empresa. Elija una de la lista desplegable.`);
    }

    let viaCaptura: 'BASE' | 'TOTAL' | null = null;
    let precio: string | null = null;
    if (base !== null && total !== null) error(null, 'Escriba uno solo de los dos precios, no los dos.');
    else if (base === null && total === null) error(null, 'Escriba uno de los dos precios: el base (sin IVA) o el total (con IVA).');
    else {
      viaCaptura = base !== null ? 'BASE' : 'TOTAL';
      const cifra = cifraDeCelda((base ?? total)!, 18);
      if ('error' in cifra) error(viaCaptura === 'BASE' ? cBase : cTotal, `El precio ${cifra.error}`);
      else precio = cifra.texto;
    }
    let ivaPct = '0.000000';
    if (iva !== null) {
      const cifra = cifraDeCelda(iva, 3);
      if ('error' in cifra) error(cIva, `El IVA ${cifra.error}`);
      else ivaPct = cifra.texto;
    }

    if (errores.length === antes) {
      recursos.push({ fila: numero, nombre: String(nombre), tipo: tipoValor!, unidadId: unidadValor!.id, viaCaptura: viaCaptura!, precio: precio!, ivaPct });
    }
  }
  return { recursos, errores };
}

export async function leerArchivoDeApu(
  archivo: Buffer,
  unidades: UnidadDisponible[],
  catalogo: RecursoDisponible[],
  existentes: NombreExistente[] = [],
): Promise<{ apus: ApuAImportar[]; errores: ErrorDeFila[] }> {
  const delCatalogo = new Map(existentes.map((e) => [llaveDeNombre(e.nombre), e]));
  const filaDelNombre = new Map<string, number>();
  const libro = await abrir(archivo);
  const filasApu = hojaDeLaPlantilla(libro, HOJA_APU, COLUMNAS_APU);
  const filasComposicion = hojaDeLaPlantilla(libro, HOJA_COMPOSICION, COLUMNAS_COMPOSICION);
  if (filasApu.length === 0) {
    throw new ArchivoNoValido(`La hoja «${HOJA_APU}» no trae ningún APU: escríbalos desde la fila 2.`);
  }
  const errores: ErrorDeFila[] = [];
  const [cClave, cNombre, cUnidad] = COLUMNAS_APU;
  const [cClaveApu, cCodigo, cCantidad, cRendimiento, cDesperdicio] = COLUMNAS_COMPOSICION;

  // Los APU, por clave. La clave solo une las dos hojas y no se guarda.
  const porClave = new Map<string, ApuAImportar & { valido: boolean }>();
  for (const { numero, valores } of filasApu) {
    const error = (columna: string | null, mensaje: string) => errores.push({ hoja: HOJA_APU, fila: numero, columna, mensaje });
    const [clave, nombre, unidad] = completas(valores, 3) as [Celda, Celda, Celda];
    let valido = true;
    if (clave === null) {
      error(cClave, 'Escriba la clave del APU (A1, A2…): es la que une esta fila con sus líneas de la hoja Composición.');
      continue;
    }
    const llave = String(clave).toLowerCase();
    if (porClave.has(llave)) {
      error(cClave, `La clave «${clave}» ya la usa la fila ${porClave.get(llave)!.fila}: cada APU necesita una clave distinta.`);
      continue;
    }
    if (nombre === null) {
      error(cNombre, 'Escriba el nombre de la actividad.');
      valido = false;
    } else {
      const llaveNombre = llaveDeNombre(String(nombre));
      const existente = delCatalogo.get(llaveNombre);
      if (existente) {
        error(cNombre, `Ya existe un APU llamado «${existente.nombre}» (${existente.codigo}). Cambie el nombre o quite la fila.`);
        valido = false;
      } else if (filaDelNombre.has(llaveNombre)) {
        error(cNombre, `Esta fila repite el nombre de la fila ${filaDelNombre.get(llaveNombre)}: no puede haber dos APU con el mismo nombre.`);
        valido = false;
      } else filaDelNombre.set(llaveNombre, numero);
    }
    const unidadValor = unidad === null ? undefined : unidadPorSimbolo(unidades, String(unidad));
    if (!unidadValor) {
      error(cUnidad, unidad === null ? 'Elija la unidad de la lista desplegable.' : `La unidad «${unidad}» no existe en su empresa. Elija una de la lista desplegable.`);
      valido = false;
    }
    porClave.set(llave, { fila: numero, nombre: String(nombre ?? ''), unidadId: unidadValor?.id ?? '', lineas: [], valido });
  }

  const recursoPorCodigo = new Map(catalogo.map((r) => [r.codigo.toLowerCase(), r]));
  for (const { numero, valores } of filasComposicion) {
    const error = (columna: string | null, mensaje: string) => errores.push({ hoja: HOJA_COMPOSICION, fila: numero, columna, mensaje });
    const antes = errores.length;
    const [clave, codigo, cantidad, rendimiento, desperdicio] = completas(valores, 5) as [Celda, Celda, Celda, Celda, Celda];

    const apu = clave === null ? undefined : porClave.get(String(clave).toLowerCase());
    if (!apu) {
      error(cClaveApu, clave === null ? 'Escriba la clave del APU al que pertenece esta línea.' : `La clave «${clave}» no está en la hoja APU.`);
    }
    // Un código de otra empresa y uno que no existe dan el mismo error (RN-01):
    // el catálogo que llega aquí ya es solo el de esta empresa.
    const recurso = codigo === null ? undefined : recursoPorCodigo.get(String(codigo).toLowerCase());
    if (!recurso) {
      error(cCodigo, codigo === null ? 'Escriba el código del recurso.' : `El recurso «${codigo}» no existe en su empresa. Búsquelo en la hoja Recursos.`);
    }
    const factor = (valor: string | number | null, columna: string, nombre: string): string | null => {
      if (valor === null) return '1.000000';
      const cifra = cifraDeCelda(valor, 18);
      if ('error' in cifra) {
        error(columna, `${nombre} ${cifra.error}`);
        return null;
      }
      if (!/[1-9]/.test(cifra.texto)) {
        error(columna, `${nombre} no puede ser cero. El mínimo es 0.000001.`);
        return null;
      }
      return cifra.texto;
    };
    const cantidadTexto = factor(cantidad, cCantidad, 'La cantidad');
    const rendimientoTexto = factor(rendimiento, cRendimiento, 'El rendimiento');
    let desperdicioTexto = '0.000000';
    if (desperdicio !== null) {
      const cifra = cifraDeCelda(desperdicio, 3);
      if ('error' in cifra) error(cDesperdicio, `El desperdicio ${cifra.error}`);
      else if (/[1-9]/.test(cifra.texto) && recurso && recurso.tipo !== 'MATERIAL') {
        error(cDesperdicio, `El recurso «${codigo}» no es un material: el desperdicio solo aplica a materiales.`);
      } else desperdicioTexto = cifra.texto;
    }

    if (errores.length === antes) {
      apu!.lineas.push({ fila: numero, recursoId: recurso!.id, cantidad: cantidadTexto!, rendimiento: rendimientoTexto!, desperdicioPct: desperdicioTexto });
    } else if (apu) apu.valido = false;
  }

  // D-21: un APU sin líneas no tiene costo directo.
  for (const apu of porClave.values()) {
    if (apu.lineas.length === 0 && apu.valido) {
      apu.valido = false;
      errores.push({ hoja: HOJA_APU, fila: apu.fila, columna: null, mensaje: 'Este APU no tiene líneas en la hoja Composición: todo APU necesita al menos una (D-21).' });
    }
  }
  errores.sort((a, b) => (a.hoja === b.hoja ? a.fila - b.fila : a.hoja === HOJA_APU ? -1 : 1));
  const apus = [...porClave.values()].filter((a) => a.valido).map(({ valido: _, ...apu }) => apu);
  return { apus, errores };
}

export interface FestivoAImportar {
  fecha: string;
  nombre: string | null;
}

/**
 * La fecha de una celda: una fecha de Excel (exceljs la entrega como Date en
 * UTC) o un texto AAAA-MM-DD que exista en el calendario. Un número suelto no
 * vale: sin el formato de fecha, nadie sabe que 45000 es el 15 de marzo.
 */
function fechaDeCelda(valor: string | number): string | null {
  if (typeof valor !== 'string') return null;
  const texto = /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(valor) ? valor.slice(0, 10) : valor;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return null;
  const [a, m, d] = texto.split('-').map(Number);
  return new Date(Date.UTC(a!, m! - 1, d!)).toISOString().slice(0, 10) === texto ? texto : null;
}

export async function leerArchivoDeFestivos(archivo: Buffer): Promise<{ fechas: FestivoAImportar[]; errores: ErrorDeFila[] }> {
  const filas = hojaDeLaPlantilla(await abrir(archivo), HOJA_FESTIVOS, COLUMNAS_FESTIVOS);
  if (filas.length === 0) {
    throw new ArchivoNoValido(`La hoja «${HOJA_FESTIVOS}» no trae ninguna fecha: escríbalas desde la fila 2.`);
  }
  const [cFecha] = COLUMNAS_FESTIVOS;
  const filaDeLaFecha = new Map<string, number>();
  const fechas: FestivoAImportar[] = [];
  const errores: ErrorDeFila[] = [];
  for (const { numero, valores } of filas) {
    const error = (mensaje: string) => errores.push({ hoja: HOJA_FESTIVOS, fila: numero, columna: cFecha, mensaje });
    const [fecha, nombre] = completas(valores, 2) as [Celda, Celda];
    if (fecha === null) {
      error('Escriba la fecha.');
      continue;
    }
    const texto = fechaDeCelda(fecha);
    if (!texto) error(`«${fecha}» no es una fecha. Escríbala como fecha de Excel o como 2026-08-07.`);
    else if (filaDeLaFecha.has(texto)) error(`La fecha ${texto} ya está en la fila ${filaDeLaFecha.get(texto)}: no puede repetirse.`);
    else {
      filaDeLaFecha.set(texto, numero);
      fechas.push({ fecha: texto, nombre: nombre === null ? null : String(nombre) });
    }
  }
  return { fechas, errores };
}
