import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Los términos y la política de datos que acepta quien registra una empresa
 * (04 §7, §8.6). Viven en legal/<VERSION_TERMINOS>/legal.html: la carpeta se
 * llama EXACTAMENTE como la versión que publica la API, y la API no arranca
 * si esa carpeta o su archivo no existen. Es registro legal: la Ley 1581 pide
 * poder reconstruir el texto exacto que una persona aceptó, y la base guarda
 * la versión aceptada, así que la carpeta de una versión no se edita nunca;
 * un texto nuevo es una carpeta nueva.
 *
 * Mientras la versión sea PROVISIONAL-<fecha> —un borrador que no pasó por un
 * abogado—, cada documento lleva un aviso como su PRIMER elemento: la
 * pantalla que muestre uno solo muestra también el aviso, y no hay un campo
 * aparte que se pueda olvidar de pintar.
 */

export const CARPETA_LEGAL = new URL('../../legal/', import.meta.url);

/** Un nombre de carpeta y nada más: ni barras, ni «..», ni ocultos. */
const NOMBRE_DE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Los cuatro documentos, en el orden en que los presenta el borrador. */
const DOCUMENTOS = ['privacidad', 'terminos', 'cookies', 'reembolsos'] as const;

export interface DocumentoLegal {
  id: (typeof DOCUMENTOS)[number];
  titulo: string;
  /** HTML del documento sin su título; si la versión es provisional, empieza por el aviso. */
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

/**
 * Los cuatro documentos de una versión. Con `contactoProvisional` —solo para
 * una versión PROVISIONAL-— cada uno empieza por el aviso de borrador.
 */
export function leerTerminos(
  version: string,
  contactoProvisional: string | null,
  carpeta: URL | string = CARPETA_LEGAL,
): DocumentoLegal[] {
  if (!NOMBRE_DE_VERSION.test(version) || version.includes('..')) {
    throw new Error(`VERSION_TERMINOS=«${version}» no sirve como nombre de carpeta de legal/: use letras, números, puntos y guiones.`);
  }
  const ruta = join(typeof carpeta === 'string' ? carpeta : fileURLToPath(carpeta), version, 'legal.html');
  if (!existsSync(ruta)) {
    throw new Error(
      `No existe ${ruta}: la versión de los términos que nombra VERSION_TERMINOS no tiene su texto. ` +
        'La API no arranca publicando una versión que nadie puede leer.',
    );
  }
  const fuente = readFileSync(ruta, 'utf8');
  return DOCUMENTOS.map((id) => {
    const articulo = new RegExp(String.raw`<article class="legal-doc" id="${id}">([\s\S]*?)</article>`).exec(fuente);
    const titulo = articulo && /<h2>([\s\S]*?)<\/h2>/.exec(articulo[1]!);
    if (!articulo || !titulo) {
      throw new Error(`Los términos de ${ruta} no traen el documento «${id}». La API no arranca con una página de términos a medias.`);
    }
    const cuerpo = articulo[1]!.replace(titulo[0], '').trim();
    return {
      id,
      titulo: titulo[1]!.trim(),
      html: contactoProvisional === null ? cuerpo : `${aviso(contactoProvisional)}\n${cuerpo}`,
    };
  });
}
