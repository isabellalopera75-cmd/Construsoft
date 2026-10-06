import type { FormatoNumerico } from './api/tipos.ts';

/*
 * Lo que la persona escribe en un campo de cifra, convertido al texto que
 * entiende la API —«1234.5», punto decimal, sin separador de miles— y al
 * revés. Ninguna conversión pasa por Number.
 *
 * Al escribir se acepta como separador decimal tanto la coma como el punto:
 * en Colombia se escribe con coma, pero mucha gente teclea el punto del
 * teclado numérico. Lo que NO se acepta es el separador de miles: «1.500»
 * sería ambiguo —¿mil quinientos o uno coma cinco?— y un precio leído al revés
 * es peor que un error que pide escribirlo sin puntos.
 */

export type Lectura = { valor: string } | { error: string };

export function leerCifra(texto: string, opciones: { decimales?: number; permitirCero?: boolean; nombre: string }): Lectura {
  const { decimales = 6, permitirCero = true, nombre } = opciones;
  const limpio = texto.trim().replace(/\s/g, '');
  if (limpio === '') return { error: `Escriba ${nombre}.` };
  const separadores = limpio.match(/[.,]/g) ?? [];
  if (separadores.length > 1) {
    return { error: `Escriba ${nombre} sin separador de miles: por ejemplo 1500 o 1500,25.` };
  }
  const canonico = limpio.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(canonico)) {
    return { error: `${mayuscula(nombre)} solo admite números, con coma o punto decimal.` };
  }
  const fraccion = canonico.split('.')[1] ?? '';
  if (fraccion.length > decimales) {
    return {
      error:
        decimales === 0
          ? `${mayuscula(nombre)} va sin decimales.`
          : `${mayuscula(nombre)} admite hasta ${decimales} decimales.`,
    };
  }
  if (!permitirCero && !/[1-9]/.test(canonico)) {
    return { error: `${mayuscula(nombre)} no puede ser cero. El mínimo es 0,000001.` };
  }
  return { valor: canonico.replace(/^0+(?=\d)/, '') };
}

/**
 * Un decimal del servidor («19.000000») como valor inicial de un campo: sin
 * ceros de cola y con el separador decimal de la empresa. Es una presentación
 * para editar, no la cifra formateada de una tabla.
 */
export function paraEditar(canonico: string, formato: FormatoNumerico): string {
  const [entera = '0', fraccion = ''] = canonico.split('.');
  const recortada = fraccion.replace(/0+$/, '');
  return recortada === '' ? entera : `${entera}${formato.separadorDecimal}${recortada}`;
}

function mayuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
