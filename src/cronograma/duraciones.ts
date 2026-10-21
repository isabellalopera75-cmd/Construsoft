/*
 * Las conversiones entre lo que guarda la base (cantidades, rendimientos y
 * horas como numeric) y lo que usa el motor (minutos enteros) o muestra la
 * pantalla (días con un decimal). Todas con racionales exactos sobre BigInt:
 * en coma flotante 0,1 ÷ 0,3 × 8 h × 60 da 160,00000000000003, y redondear
 * hacia arriba lo vuelve 161 minutos. Son tiempos, no dinero: el dinero no
 * pasa por aquí.
 */

/** "12.5" → [125n, 10n]. Admite el signo. */
function racional(texto: string): [bigint, bigint] {
  const negativo = texto.startsWith('-');
  const [entera, decimales = ''] = texto.replace(/^[-+]/, '').split('.');
  const numerador = BigInt(`${entera}${decimales}` || '0');
  return [negativo ? -numerador : numerador, 10n ** BigInt(decimales.length)];
}

/** ⌈a / b⌉ con b > 0. */
function techo(a: bigint, b: bigint): bigint {
  return a >= 0n ? (a + b - 1n) / b : -(-a / b);
}

/** a / b redondeado a la mitad alejándose del cero, con b > 0: el round() de PostgreSQL. */
function redondeo(a: bigint, b: bigint): bigint {
  const absoluto = (2n * (a < 0n ? -a : a) + b) / (2n * b);
  return a < 0n ? -absoluto : absoluto;
}

/**
 * Minutos de la duración calculada (07 §6.1, RN-25, RN-26): cantidad ÷
 * rendimiento × horas por jornal ÷ cuadrillas, al minuto hacia arriba (A6).
 * Sin rendimiento no hay duración calculada: null.
 */
export function minutosCalculados(cantidad: string, rendimiento: string | null, horasPorJornal: string, cuadrillas: number): number | null {
  if (rendimiento === null) return null;
  const [c, cd] = racional(cantidad);
  const [r, rd] = racional(rendimiento);
  const [h, hd] = racional(horasPorJornal);
  // (c/cd) × (h/hd) × 60 ÷ ((r/rd) × cuadrillas)
  return Number(techo(c * h * 60n * rd, cd * hd * r * BigInt(cuadrillas)));
}

/** Minutos a días del calendario, con un decimal: "5.1" (CONTRATO §19.1). */
export function diasDeMinutos(minutos: number, horasPorDia: string): string {
  const [h, hd] = racional(horasPorDia);
  const decimas = redondeo(BigInt(minutos) * 10n * hd, 60n * h);
  const absoluto = decimas < 0n ? -decimas : decimas;
  return `${decimas < 0n ? '-' : ''}${absoluto / 10n}.${absoluto % 10n}`;
}

/** Días escritos por la persona, a horas para guardar: exacto, con cuatro decimales como numeric(12,4). */
export function horasDeDias(dias: string, horasPorDia: string): string {
  const [d, dd] = racional(dias);
  const [h, hd] = racional(horasPorDia);
  // Un decimal por dos decimales cabe en cuatro sin redondear.
  const diezmilesimas = (d * h * 10_000n) / (dd * hd);
  const absoluto = diezmilesimas < 0n ? -diezmilesimas : diezmilesimas;
  return `${diezmilesimas < 0n ? '-' : ''}${absoluto / 10_000n}.${String(absoluto % 10_000n).padStart(4, '0')}`;
}

/** Las horas de una duración manual, a minutos hacia arriba, como la calculada (A6). */
export function minutosDeDuracionManual(horas: string): number {
  const [h, hd] = racional(horas);
  return Number(techo(h * 60n, hd));
}

/** Las horas de un desfase, a minutos redondeados a la mitad alejándose del cero: puede ser negativo. */
export function minutosDeDesfase(horas: string): number {
  const [h, hd] = racional(horas);
  return Number(redondeo(h * 60n, hd));
}
