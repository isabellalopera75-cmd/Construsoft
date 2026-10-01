/*
 * Lectura de los PDF que genera este proyecto con pdfkit SIN comprimir. Solo
 * para las pruebas, y solo para esos PDF: evita sumar una dependencia de
 * lectura de PDF. Entiende las dos formas en que pdfkit escribe texto:
 *
 *  · Fuentes estándar (Helvetica…): bytes WinAnsi en hexadecimal dentro de TJ.
 *  · Fuentes TrueType incrustadas: identificadores de glifo de dos bytes
 *    (Identity-H) y una tabla ToUnicode por fuente para volver al carácter.
 *
 * La segunda es la que importa: con la fuente dentro del PDF, lo que se
 * dibuja ya no depende del visor, y un carácter que la fuente no tiene se
 * delata solo, como el glifo 0 (.notdef). Eso sí se puede probar.
 */

/** WinAnsi en 0x80–0x9F, donde difiere de latin1 (el TextDecoder de Node no siempre lo respeta). */
const WINANSI_80_9F: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ',
  0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“',
  0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›',
  0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};

interface Fuente {
  /** Glifo → texto, de la tabla ToUnicode. Null en las fuentes estándar, que van en WinAnsi. */
  aUnicode: Map<number, string> | null;
}

interface PdfLeido {
  /** Una lista de corridas de texto por página, en el orden en que se dibujaron. */
  paginas: string[][];
  /** Cuántas veces se dibujó el glifo 0 (.notdef) de una fuente incrustada: un carácter sin glifo. */
  glifosFaltantes: number;
  /** Cuántos programas de fuente TrueType viajan dentro del PDF. */
  fuentesIncrustadas: number;
  /** Cuántas fuentes estándar se referencian sin incrustar: las dibuja el visor con lo que tenga. */
  fuentesSinIncrustar: number;
  /** Cuántas imágenes se dibujan (operador «/I1 Do»), no cuántos objetos imagen hay. */
  imagenes: number;
}

function objetos(texto: string): Map<number, string> {
  const salida = new Map<number, string>();
  for (const m of texto.matchAll(/(\d+) 0 obj\b([\s\S]*?)\bendobj/g)) salida.set(Number(m[1]), m[2]!);
  return salida;
}

function flujo(objeto: string): string {
  const inicio = objeto.indexOf('stream');
  const fin = objeto.lastIndexOf('endstream');
  return inicio < 0 || fin < 0 ? '' : objeto.slice(inicio + 'stream'.length, fin);
}

function hexAUnicode(conEspacios: string): string {
  // Una ligadura (la «fi» de «Edificio») mapea a varios caracteres: <0066 0069>.
  const hex = conEspacios.replace(/\s+/g, '');
  let salida = '';
  for (let i = 0; i < hex.length; i += 4) salida += String.fromCharCode(Number.parseInt(hex.slice(i, i + 4), 16));
  return salida;
}

/** La tabla ToUnicode: bfchar (<g> <u>) y bfrange (<a> <b> <u> o <a> <b> [<u1> <u2> …]). */
function leerToUnicode(cmap: string): Map<number, string> {
  const tabla = new Map<number, string>();
  for (const bloque of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const par of bloque[1]!.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F\s]+)>/g)) {
      tabla.set(Number.parseInt(par[1]!, 16), hexAUnicode(par[2]!));
    }
  }
  for (const bloque of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const r of bloque[1]!.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(\[[^\]]*\]|<[0-9a-fA-F]+>)/g)) {
      const desde = Number.parseInt(r[1]!, 16);
      const hasta = Number.parseInt(r[2]!, 16);
      if (r[3]!.startsWith('[')) {
        [...r[3]!.matchAll(/<([0-9a-fA-F\s]+)>/g)].forEach((u, i) => tabla.set(desde + i, hexAUnicode(u[1]!)));
      } else {
        const base = Number.parseInt(r[3]!.slice(1, -1), 16);
        for (let g = desde; g <= hasta; g += 1) tabla.set(g, String.fromCharCode(base + g - desde));
      }
    }
  }
  return tabla;
}

export function leerPdf(pdf: Buffer): PdfLeido {
  const texto = pdf.toString('latin1');
  const objs = objetos(texto);
  const ref = (s: string | undefined) => (s === undefined ? undefined : objs.get(Number(s)));

  const raiz = [...objs.values()].find((o) => /\/Type \/Pages\b/.test(o))!;
  const hijos = [...raiz.match(/\/Kids \[([^\]]*)\]/)![1]!.matchAll(/(\d+) 0 R/g)].map((m) => m[1]!);

  let glifosFaltantes = 0;
  const paginas = hijos.map((id) => {
    const pagina = ref(id)!;
    const recursos = pagina.match(/\/Resources (\d+) 0 R/) ? ref(pagina.match(/\/Resources (\d+) 0 R/)![1]) ?? '' : pagina;
    const fuentes = new Map<string, Fuente>();
    const dicFuentes = recursos.match(/\/Font\s*<<([\s\S]*?)>>/)?.[1] ?? '';
    for (const f of dicFuentes.matchAll(/\/(\w+) (\d+) 0 R/g)) {
      const fuente = ref(f[2]) ?? '';
      const toUnicode = fuente.match(/\/ToUnicode (\d+) 0 R/)?.[1];
      fuentes.set(f[1]!, { aUnicode: toUnicode ? leerToUnicode(flujo(ref(toUnicode) ?? '')) : null });
    }

    const contenido = flujo(ref(pagina.match(/\/Contents (\d+) 0 R/)![1]) ?? '');
    const corridas: string[] = [];
    let actual: Fuente = { aUnicode: null };
    for (const op of contenido.matchAll(/\/(\w+) [\d.]+ Tf|\[((?:<[0-9a-fA-F]*>|[\s\d.-])*)\]\s*TJ/g)) {
      if (op[1]) {
        actual = fuentes.get(op[1]) ?? { aUnicode: null };
        continue;
      }
      const hex = [...op[2]!.matchAll(/<([0-9a-fA-F]*)>/g)].map((m) => m[1]).join('');
      if (actual.aUnicode) {
        let corrida = '';
        for (let i = 0; i < hex.length; i += 4) {
          const glifo = Number.parseInt(hex.slice(i, i + 4), 16);
          if (glifo === 0) glifosFaltantes += 1;
          corrida += actual.aUnicode.get(glifo) ?? '�';
        }
        corridas.push(corrida);
      } else {
        corridas.push([...Buffer.from(hex, 'hex')].map((b) => WINANSI_80_9F[b] ?? String.fromCharCode(b)).join(''));
      }
    }
    return corridas;
  });

  return {
    paginas,
    glifosFaltantes,
    fuentesIncrustadas: (texto.match(/\/FontFile2 \d+ 0 R/g) ?? []).length,
    fuentesSinIncrustar: (texto.match(/\/Subtype \/Type1\b/g) ?? []).length,
    imagenes: (texto.match(/\/I\d+ Do\b/g) ?? []).length,
  };
}

/** Todo el texto del PDF, una corrida por operador TJ, en orden. */
export function textoDePdf(pdf: Buffer): string[] {
  return leerPdf(pdf).paginas.flat();
}

/** Cuántas imágenes se dibujan: un PNG con canal alfa trae además su máscara, que no es otro logo. */
export function imagenesDePdf(pdf: Buffer): number {
  return leerPdf(pdf).imagenes;
}
