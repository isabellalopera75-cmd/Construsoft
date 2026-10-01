import type { FormatoNumerico } from '../infraestructura/basedatos/contextoTenant.js';
import type { FotografiaPresupuesto } from '../infraestructura/basedatos/versiones.js';
import { formatearNumero } from './formatoNumerico.js';

/**
 * Una fila de la oferta tal como la imprimen el Excel y el PDF: un capítulo
 * (o subcapítulo) con su monto acumulado, o una actividad con su unidad,
 * cantidad, precio y costo. Los importes siguen siendo el texto de la
 * fotografía; el redondeo de presentación lo aplica cada renderizador.
 */
export interface FilaOferta {
  tipo: 'capitulo' | 'actividad';
  codigo: string;
  /** 1 el capítulo; 2 lo que cuelga de él; y así hacia abajo. */
  nivel: number;
  descripcion: string;
  unidad: string | null;
  cantidad: string | null;
  precioUnitario: string | null;
  total: string;
}

/** «1.2.10» → [1, 2, 10]. Leído como enteros, el 1.10 va después del 1.9. */
function comoEnteros(codigo: string): number[] {
  return codigo.split('.').map((parte) => Number.parseInt(parte, 10));
}

/** Orden de la oferta: lexicográfico sobre enteros, y el prefijo primero («1.2» antes que «1.2.1»). */
function compararCodigos(a: string, b: string): number {
  const x = comoEnteros(a);
  const y = comoEnteros(b);
  for (let i = 0; i < Math.min(x.length, y.length); i += 1) {
    if (x[i] !== y[i]) return x[i]! - y[i]!;
  }
  return x.length - y.length;
}

/**
 * La fotografía trae capítulos y actividades en dos listas; la oferta los
 * lleva intercalados. Ordenar es todo lo que hace esta función: no suma ni
 * calcula, y el nivel de una actividad es el de su número de ítem (D-42), que
 * la base ya derivó. El capítulo se numera «1.0» y su primer hijo «1.1»: como
 * ningún hijo lleva el índice 0, comparar [1, 0] con [1, 1] deja al capítulo
 * delante de lo que cuelga de él.
 */
export function filasDeLaOferta(fotografia: FotografiaPresupuesto): FilaOferta[] {
  const capitulos: FilaOferta[] = fotografia.capitulos.map((c) => ({
    tipo: 'capitulo',
    codigo: c.codigoWbs,
    nivel: c.nivel,
    descripcion: c.nombre,
    unidad: null,
    cantidad: null,
    precioUnitario: null,
    total: c.montoAcumulado,
  }));
  const actividades: FilaOferta[] = fotografia.items.map((i) => ({
    tipo: 'actividad',
    codigo: i.codigoItem,
    nivel: comoEnteros(i.codigoItem).length,
    descripcion: i.descripcion,
    unidad: i.unidad,
    cantidad: i.cantidad,
    precioUnitario: i.precioUnitario,
    total: i.costoTotal,
  }));
  return [...capitulos, ...actividades].sort((a, b) => compararCodigos(a.codigo, b.codigo));
}

/** Una línea del pie financiero: el concepto, con su porcentaje visible cuando lo tiene, y el importe en texto. */
export interface LineaDelPie {
  concepto: string;
  valor: string;
  destacado: boolean;
}

/**
 * El pie financiero en el orden de la mesa de trabajo (02 §8.6, RF-PRE-22/43):
 * el AIU pegado al costo directo, el IVA debajo de la utilidad y el costo
 * indirecto al final. Los importes son los de la fotografía; ninguno se
 * calcula aquí. El Excel y el PDF lo toman de este único sitio, para que las
 * dos exportaciones no digan nunca conceptos distintos.
 */
export function lineasDelPie(fotografia: FotografiaPresupuesto, formato: FormatoNumerico): LineaDelPie[] {
  const p = fotografia.presupuesto;
  const t = p.totales;
  const pct = (valor: string) => `${formatearNumero(valor, formato)} %`;
  return [
    { concepto: 'Total costo directo', valor: t.costoDirecto, destacado: false },
    { concepto: `Administración (${pct(p.aiu.a)})`, valor: t.administracion, destacado: false },
    { concepto: `Imprevistos (${pct(p.aiu.i)})`, valor: t.imprevistos, destacado: false },
    { concepto: `Utilidad (${pct(p.aiu.u)})`, valor: t.utilidad, destacado: false },
    { concepto: 'AIU', valor: t.aiu, destacado: false },
    { concepto: `IVA sobre la utilidad (${pct(p.ivaUtilidadPct)})`, valor: t.iva, destacado: false },
    { concepto: 'Total costo indirecto', valor: t.costoIndirecto, destacado: false },
    { concepto: 'VALOR TOTAL', valor: t.valorTotal, destacado: true },
  ];
}
