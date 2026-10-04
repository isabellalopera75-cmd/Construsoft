import { readFileSync } from 'node:fs';

/*
 * Términos provisionales (04 §8.6). Mientras los textos no hayan pasado por un
 * abogado, la página de términos sirve el BORRADOR de prototipo/legal.html,
 * con un aviso que va DENTRO de cada documento, como su primer elemento: la
 * pantalla que muestre uno solo muestra también el aviso, y no hay un campo
 * aparte que se pueda olvidar de pintar.
 *
 * El borrador se lee del prototipo y no se copia: dos copias del mismo texto
 * legal terminan diciendo cosas distintas. Si le falta un documento, la API
 * no arranca.
 */

export const RUTA_BORRADOR = new URL('../../prototipo/legal.html', import.meta.url);

/** Los cuatro documentos, en el orden en que los presenta el borrador. */
const DOCUMENTOS = ['privacidad', 'terminos', 'cookies', 'reembolsos'] as const;

export interface DocumentoLegal {
  id: (typeof DOCUMENTOS)[number];
  titulo: string;
  /** HTML del documento sin su título; empieza siempre por el aviso. */
  html: string;
}

function escaparHtml(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function aviso(contacto: string): string {
  return (
    '<p class="aviso-borrador" role="note"><strong>Borrador: este texto no ha pasado por revisión legal.</strong> ' +
    'Es una base de trabajo que todavía no revisó un abogado, y los campos entre corchetes están sin llenar. ' +
    'Esta instalación no es para uso real: no registre en ella datos de una empresa ni de personas. ' +
    `Para cualquier consulta, escriba a ${escaparHtml(contacto)}.</p>`
  );
}

export function leerBorrador(ruta: URL | string, contacto: string): DocumentoLegal[] {
  const fuente = readFileSync(ruta, 'utf8');
  return DOCUMENTOS.map((id) => {
    const articulo = new RegExp(`<article class="legal-doc" id="${id}">([\\s\\S]*?)</article>`).exec(fuente);
    const titulo = articulo && /<h2>([\s\S]*?)<\/h2>/.exec(articulo[1]!);
    if (!articulo || !titulo) {
      throw new Error(
        `El borrador de los términos (${String(ruta)}) no trae el documento «${id}». ` +
          'La API no arranca con una página de términos a medias.',
      );
    }
    const cuerpo = articulo[1]!.replace(titulo[0], '').trim();
    return { id, titulo: titulo[1]!.trim(), html: `${aviso(contacto)}\n${cuerpo}` };
  });
}
