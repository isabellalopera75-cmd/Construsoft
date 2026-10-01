import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { FotografiaPresupuesto } from '../infraestructura/basedatos/versiones.js';
import { filasDeLaOferta } from './filas.js';

/** Una fotografía mínima en EDT, con el capítulo 10 para que el orden por texto falle si alguien lo intenta. */
function fotografia(): FotografiaPresupuesto {
  const capitulo = (codigoWbs: string, nivel: number, nombre: string, monto: string) => ({
    id: codigoWbs,
    codigoWbs,
    padreCodigo: null,
    nivel,
    nombre,
    clasificacion: 'DIRECTO' as const,
    montoAcumulado: monto,
    incidenciaPct: null,
  });
  const item = (codigoItem: string, padre: string, descripcion: string, total: string) => ({
    id: codigoItem,
    wbsNodoId: padre,
    codigoItem,
    codigoWbsPadre: padre,
    codigoApu: 'APU-1',
    descripcion,
    unidad: 'm³',
    cantidad: '1.000000',
    precioUnitario: total,
    costoTotal: total,
    apuVersionId: 'v',
  });
  return {
    schema: 5,
    presupuesto: {} as FotografiaPresupuesto['presupuesto'],
    empresa: { razonSocial: 'X', nit: '1', logoRuta: null },
    // Desordenadas a propósito: el orden lo pone filasDeLaOferta, no quien arma la foto.
    capitulos: [
      capitulo('10.0', 1, 'DÉCIMO', '5.000000'),
      capitulo('1.0', 1, 'PRIMERO', '30.000000'),
      capitulo('1.2', 2, 'Subcapítulo', '20.000000'),
      capitulo('2.0', 1, 'SEGUNDO', '0.000000'),
    ],
    items: [
      item('1.2.1', '1.2', 'Actividad del subcapítulo', '20.000000'),
      item('10.1', '10.0', 'Actividad del décimo', '5.000000'),
      item('1.1', '1.0', 'Actividad colgada del capítulo', '10.000000'),
    ],
    generada: {} as FotografiaPresupuesto['generada'],
  };
}

describe('filasDeLaOferta: capítulos y actividades intercalados en el orden de la oferta', () => {
  test('por número leído como enteros: el 10 va después del 2, y cada actividad bajo su nivel', () => {
    assert.deepEqual(
      filasDeLaOferta(fotografia()).map((f) => [f.tipo, f.codigo, f.nivel, f.descripcion, f.total]),
      [
        ['capitulo', '1.0', 1, 'PRIMERO', '30.000000'],
        ['actividad', '1.1', 2, 'Actividad colgada del capítulo', '10.000000'],
        ['capitulo', '1.2', 2, 'Subcapítulo', '20.000000'],
        ['actividad', '1.2.1', 3, 'Actividad del subcapítulo', '20.000000'],
        ['capitulo', '2.0', 1, 'SEGUNDO', '0.000000'],
        ['capitulo', '10.0', 1, 'DÉCIMO', '5.000000'],
        ['actividad', '10.1', 2, 'Actividad del décimo', '5.000000'],
      ],
    );
  });

  test('los capítulos no llevan unidad, cantidad ni precio; las actividades sí', () => {
    const [capitulo, actividad] = filasDeLaOferta(fotografia());
    assert.deepEqual([capitulo!.unidad, capitulo!.cantidad, capitulo!.precioUnitario], [null, null, null]);
    assert.deepEqual([actividad!.unidad, actividad!.cantidad, actividad!.precioUnitario], ['m³', '1.000000', '10.000000']);
  });
});
