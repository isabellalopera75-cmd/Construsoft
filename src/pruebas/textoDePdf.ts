/**
 * WinAnsi (windows-1252) en el tramo 0x80–0x9F, que es donde difiere de
 * latin1. No se usa TextDecoder('windows-1252'): según cómo esté compilado
 * Node, decodifica como latin1 y convierte el «—» (0x97) en un carácter de
 * control invisible, y la prueba fallaría sin que el PDF tuviera la culpa.
 */
const WINANSI_80_9F: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ',
  0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“',
  0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›',
  0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};

function decodificarWinAnsi(bytes: Buffer): string {
  return [...bytes].map((b) => WINANSI_80_9F[b] ?? String.fromCharCode(b)).join('');
}

/**
 * El texto de un PDF generado por pdfkit SIN comprimir, una corrida por
 * operador TJ, en el orden en que se dibujó. Solo sirve para las pruebas, y
 * solo para lo que genera este proyecto: pdfkit escribe el texto de las
 * fuentes estándar como cadenas hexadecimales en WinAnsi dentro de operadores
 * TJ —[<4869> 20 <6a61>] TJ—, así que basta con juntar los trozos de cada TJ
 * y decodificarlos. Evita sumar una dependencia de lectura de PDF solo para
 * las pruebas.
 */
export function textoDePdf(pdf: Buffer): string[] {
  const contenido = pdf.toString('latin1');
  const corridas: string[] = [];
  for (const operador of contenido.matchAll(/\[((?:<[0-9a-fA-F]*>|[\s\d.-])*)\]\s*TJ/g)) {
    const hex = [...operador[1]!.matchAll(/<([0-9a-fA-F]*)>/g)].map((m) => m[1]).join('');
    corridas.push(decodificarWinAnsi(Buffer.from(hex, 'hex')));
  }
  return corridas;
}

/**
 * Cuántas imágenes se DIBUJAN en el PDF (operador «/I1 Do»). No se cuentan
 * los objetos imagen: un PNG con canal alfa trae además su máscara (SMask),
 * que es otro objeto imagen y no otro logo.
 */
export function imagenesDePdf(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/I\d+ Do\b/g) ?? []).length;
}
