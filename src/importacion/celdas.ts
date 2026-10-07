import type ExcelJS from 'exceljs';
import { redondear } from '../comun/formatoNumerico.js';

/*
 * Leer una celda de Excel sin creerle a la coma flotante (CONTRATO §10.2).
 * Excel guarda los números como dobles: 0,1 es 0,1000000000000000055…. La
 * celda se convierte a texto decimal y se redondea UNA vez, a seis
 * decimales y a la mitad alejándose del cero —el round() de PostgreSQL—, con
 * el mismo redondeador que el PDF y la interfaz. Desde ahí la cifra sigue
 * como texto, igual que cualquier otra (contrato §1.1).
 */

/** Lo que trae una celda, ya sin fórmulas, enlaces ni texto enriquecido. */
export function valorDeCelda(celda: ExcelJS.Cell): string | number | null {
  const v = celda.value;
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim();
  if (typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if ('result' in v) {
      const r = (v as { result?: unknown }).result;
      return typeof r === 'number' ? r : r === undefined || r === null ? null : String(r).trim() || null;
    }
    if ('richText' in v) return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join('').trim() || null;
    if ('text' in v) return String((v as { text: unknown }).text).trim() || null;
  }
  return String(v).trim() || null;
}

export type Cifra = { texto: string } | { error: string };

/**
 * Una cifra no negativa, como texto con seis decimales. Acepta un número de
 * Excel o un texto escrito con punto decimal («12.5»); cualquier otra cosa
 * —«doce mil», «1.500,50», un negativo— es un error con su motivo.
 * `enteros` es la parte entera que admite la columna de la base: 18 para
 * app.dinero y app.cantidad, 3 para app.porcentaje.
 */
export function cifraDeCelda(valor: string | number, enteros: number): Cifra {
  let texto: string;
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) return { error: 'no es una cifra.' };
    // String() da la representación más corta del doble («0.1», no
    // «0.1000000000000000055»); solo cae en notación científica en los
    // extremos, y ahí toFixed(20) da los dígitos que hacen falta.
    texto = /e/i.test(String(valor)) ? valor.toFixed(20) : String(valor);
  } else {
    if (!/^-?\d+(\.\d+)?$/.test(valor)) {
      return { error: `«${valor}» no es una cifra: escríbala como número, con punto decimal si lleva decimales.` };
    }
    texto = valor;
  }
  if (texto.startsWith('-')) return { error: 'no puede ser negativa.' };
  const redondeado = redondear(texto, 6);
  const [entera] = redondeado.split('.');
  if (entera!.replace(/^0+(?=\d)/, '').length > enteros) return { error: `es demasiado grande: admite hasta ${enteros} cifras enteras.` };
  return { texto: redondeado };
}
