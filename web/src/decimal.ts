/*
 * Aritmética decimal EXACTA, sobre enteros grandes. Sin coma flotante en
 * ningún punto: el dinero es numeric(24,6) y en coma flotante 1,005 vale
 * 1,00499… (04 §4.1).
 *
 * La regla 1.1 del contrato es que la interfaz no hace cuentas. Este módulo
 * existe para sus dos excepciones, y para nada más:
 *
 *   1. El precio complementario del recurso (RF-REC-09, CONTRATO §5). Lo
 *      calcula la pantalla porque el usuario lo ve cambiar mientras escribe, y
 *      la base lo verifica con round(…, 6): tiene que dar EXACTAMENTE lo mismo,
 *      con el mismo redondeo a la mitad alejándose del cero.
 *   2. Las vistas previas que el 02 §2 pide «en tiempo real»: el subtotal de
 *      una línea de APU, el costo de una actividad mientras se escribe la
 *      cantidad, el pie mientras se escriben los porcentajes. Son
 *      previsualizaciones y se muestran como tales: «la cifra que vale es la
 *      que confirma el servidor al guardar». Ninguna se envía.
 *
 * Una cifra que viene del servidor se muestra tal cual llega; no pasa por acá.
 */

/** n × 10^-escala. */
interface Decimal {
  readonly n: bigint;
  readonly escala: number;
}

const FORMA = /^(-)?(\d+)(?:\.(\d+))?$/;

export function leer(texto: string): Decimal {
  const m = FORMA.exec(texto.trim());
  if (!m) throw new Error(`«${texto}» no es un decimal con punto.`);
  const [, signo, entera = '0', fraccion = ''] = m;
  const n = BigInt(entera + fraccion);
  return { n: signo ? -n : n, escala: fraccion.length };
}

function potencia(e: number): bigint {
  return 10n ** BigInt(e);
}

function alinear(a: Decimal, b: Decimal): [bigint, bigint, number] {
  const escala = Math.max(a.escala, b.escala);
  return [a.n * potencia(escala - a.escala), b.n * potencia(escala - b.escala), escala];
}

export function sumar(a: Decimal, b: Decimal): Decimal {
  const [x, y, escala] = alinear(a, b);
  return { n: x + y, escala };
}

export function multiplicar(a: Decimal, b: Decimal): Decimal {
  return { n: a.n * b.n, escala: a.escala + b.escala };
}

/** Divide un entero por otro redondeando a la mitad alejándose del cero, como round() de PostgreSQL. */
function dividirRedondeando(numerador: bigint, denominador: bigint): bigint {
  if (denominador === 0n) throw new Error('División por cero.');
  const negativo = numerador < 0n !== denominador < 0n;
  const num = numerador < 0n ? -numerador : numerador;
  const den = denominador < 0n ? -denominador : denominador;
  let q = num / den;
  if ((num % den) * 2n >= den) q += 1n;
  return negativo ? -q : q;
}

export function redondear(a: Decimal, decimales: number): Decimal {
  if (a.escala <= decimales) return a;
  return { n: dividirRedondeando(a.n, potencia(a.escala - decimales)), escala: decimales };
}

/** a / b, redondeado a `decimales` sobre el cociente EXACTO. */
export function dividir(a: Decimal, b: Decimal, decimales: number): Decimal {
  // a/b = (a.n / 10^a.e) / (b.n / 10^b.e); se escala por 10^decimales.
  const numerador = a.n * potencia(b.escala + decimales);
  const denominador = b.n * potencia(a.escala);
  return { n: dividirRedondeando(numerador, denominador), escala: decimales };
}

export function esCero(a: Decimal): boolean {
  return a.n === 0n;
}

export function comparar(a: Decimal, b: Decimal): -1 | 0 | 1 {
  const [x, y] = alinear(a, b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Texto canónico con punto decimal y exactamente `decimales` cifras: lo que entiende la API. */
export function aTexto(a: Decimal, decimales = 6): string {
  const r = redondear(a, decimales);
  const n = r.n * potencia(decimales - r.escala);
  const negativo = n < 0n;
  const digitos = (negativo ? -n : n).toString().padStart(decimales + 1, '0');
  const entera = digitos.slice(0, digitos.length - decimales);
  const fraccion = digitos.slice(digitos.length - decimales);
  return `${negativo ? '-' : ''}${entera}${decimales > 0 ? `.${fraccion}` : ''}`;
}

const CIEN: Decimal = { n: 100n, escala: 0 };
const UNO: Decimal = { n: 1n, escala: 0 };

/** 1 + pct/100, exacto. */
export function factorDePorcentaje(pct: Decimal): Decimal {
  return sumar(UNO, dividirExacto(pct, CIEN));
}

/** Dividir por 100 es exacto: corre la escala dos lugares. */
function dividirExacto(a: Decimal, cien: Decimal): Decimal {
  if (cien.n !== 100n || cien.escala !== 0) throw new Error('Solo se divide exacto por 100.');
  return { n: a.n, escala: a.escala + 2 };
}

/** a × pct / 100, exacto. */
export function porcentajeDe(a: Decimal, pct: Decimal): Decimal {
  return multiplicar(a, dividirExacto(pct, CIEN));
}

/*
 * RF-REC-09 y ck_recurso_precios_cuadran (esquema, app.recurso):
 *   vía BASE:  precio_total = round(precio_base  * (1 + iva_pct/100), 6)
 *   vía TOTAL: precio_base  = round(precio_total / (1 + iva_pct/100), 6)
 */
export function totalDesdeBase(base: string, iva: string): string {
  return aTexto(redondear(multiplicar(leer(base), factorDePorcentaje(leer(iva))), 6));
}

export function baseDesdeTotal(total: string, iva: string): string {
  return aTexto(dividir(leer(total), factorDePorcentaje(leer(iva)), 6));
}
