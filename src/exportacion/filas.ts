import type { FormatoNumerico } from '../infraestructura/basedatos/contextoTenant.js';
import type { DocumentoExportable } from '../infraestructura/basedatos/exportacion.js';
import type { FotografiaPresupuesto } from '../infraestructura/basedatos/versiones.js';
import { formatearNumero } from '../comun/formatoNumerico.js';

/**
 * Una fila de la oferta tal como la imprimen el Excel y el PDF: un capítulo
 * (o subcapítulo) con su monto acumulado, o una actividad con su unidad,
 * cantidad, precio y costo. Los importes siguen siendo el texto de la
 * fotografía; el redondeo de presentación lo aplica cada renderizador.
 */
export interface FilaOferta {
  tipo: 'capitulo' | 'actividad';
  /** El número del capítulo, o el código del APU de la actividad (CONTRATO §16). */
  codigo: string;
  /** 1 el capítulo; 2 lo que cuelga de él; y así hacia abajo. */
  nivel: number;
  descripcion: string;
  unidad: string | null;
  cantidad: string | null;
  precioUnitario: string | null;
  total: string;
}

/** «01.02.10» → [1, 2, 10]. Leído como enteros, el 1.10 va después del 1.9, con ceros o sin ellos. */
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
 * lleva intercalados, en el orden de la mesa. No suma ni calcula.
 *
 * El orden sale de los códigos que la base ya derivó: el del capítulo y el
 * número de ítem de la actividad (D-42), que se sigue derivando aunque no se
 * muestre. Desde D-75 los subcapítulos ocupan las primeras posiciones bajo su
 * padre y las actividades las siguientes, así que ordenar esos códigos da el
 * orden de la mesa. Una versión aprobada antes de D-75 conserva sus códigos
 * —«1.0», la actividad antes que el subcapítulo— y con ellos su orden (RN-04):
 * comparar [1, 0] con [1, 1] deja al capítulo delante de sus hijos.
 *
 * Lo que se muestra es otra cosa: la actividad se identifica por el código de
 * su APU (CONTRATO §16), y su nivel es el de su capítulo más uno.
 */
export function filasDeLaOferta(fotografia: FotografiaPresupuesto): FilaOferta[] {
  const nivelDe = new Map(fotografia.capitulos.map((c) => [c.id, c.nivel]));
  const capitulos = fotografia.capitulos.map((c) => ({
    orden: c.codigoWbs,
    fila: {
      tipo: 'capitulo' as const,
      codigo: c.codigoWbs,
      nivel: c.nivel,
      descripcion: c.nombre,
      unidad: null,
      cantidad: null,
      precioUnitario: null,
      total: c.montoAcumulado,
    },
  }));
  const actividades = fotografia.items.map((i) => ({
    orden: i.codigoItem,
    fila: {
      tipo: 'actividad' as const,
      codigo: i.codigoApu,
      nivel: (nivelDe.get(i.wbsNodoId) ?? comoEnteros(i.codigoWbsPadre).length) + 1,
      descripcion: i.descripcion,
      unidad: i.unidad,
      cantidad: i.cantidad,
      precioUnitario: i.precioUnitario,
      total: i.costoTotal,
    },
  }));
  return [...capitulos, ...actividades].sort((a, b) => compararCodigos(a.orden, b.orden)).map((x) => x.fila);
}

/** Una línea del pie financiero: el concepto, con su porcentaje visible cuando lo tiene, y el importe en texto. */
export interface LineaDelPie {
  concepto: string;
  valor: string;
  destacado: boolean;
}

/**
 * El pie financiero de las exportaciones, en el orden que decidió el dueño del
 * producto: los dos costos juntos al principio —el indirecto arriba— y debajo
 * del costo directo, inmediatamente, la Administración que se calcula sobre
 * él, de modo que el cliente verifica el porcentaje mirando el renglón de
 * arriba. Los importes son los de la fotografía; ninguno se calcula aquí. El
 * Excel y el PDF lo toman de este único sitio, para que las dos exportaciones
 * no digan nunca conceptos distintos.
 */
export function lineasDelPie(fotografia: FotografiaPresupuesto, formato: FormatoNumerico): LineaDelPie[] {
  const p = fotografia.presupuesto;
  const t = p.totales;
  const pct = (valor: string) => `${formatearNumero(valor, formato)} %`;
  return [
    { concepto: 'Total costo indirecto', valor: t.costoIndirecto, destacado: false },
    { concepto: 'Total costo directo', valor: t.costoDirecto, destacado: false },
    { concepto: `Administración (${pct(p.aiu.a)})`, valor: t.administracion, destacado: false },
    { concepto: `Imprevistos (${pct(p.aiu.i)})`, valor: t.imprevistos, destacado: false },
    { concepto: `Utilidad (${pct(p.aiu.u)})`, valor: t.utilidad, destacado: false },
    { concepto: 'AIU', valor: t.aiu, destacado: false },
    { concepto: `IVA (${pct(p.ivaUtilidadPct)})`, valor: t.iva, destacado: false },
    { concepto: 'VALOR TOTAL', valor: t.valorTotal, destacado: true },
  ];
}

const FECHA_COLOMBIA = new Intl.DateTimeFormat('es-CO', {
  timeZone: 'America/Bogota',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/**
 * Una marca de tiempo de la fotografía como fecha del documento, dd/mm/aaaa
 * en la hora de Colombia: las 22:30 del 30 de septiembre en Bogotá son ya el
 * 1 de octubre en UTC, y la oferta tiene que decir 30.
 */
export function formatearFecha(marca: string): string {
  return FECHA_COLOMBIA.format(new Date(marca));
}

/**
 * «Versión 3 · 14/02/2027»: el número y la fecha de la PROPIA versión, la que
 * quedó congelada en su fotografía. La fecha de elaboración es la del
 * presupuesto y no cambia al reabrir; la de la versión responde «¿de cuándo
 * son estos precios?», que es lo primero que pregunta quien recibe una
 * versión reabierta. Null cuando se exporta el estado actual, que no es una
 * versión.
 */
export function etiquetaDeVersion(documento: DocumentoExportable): string | null {
  return documento.numeroVersion === null
    ? null
    : `Versión ${documento.numeroVersion} · ${formatearFecha(documento.fotografia.generada.en)}`;
}
