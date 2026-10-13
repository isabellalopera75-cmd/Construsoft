import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { FotografiaPresupuesto } from '../infraestructura/basedatos/versiones.js';
import { filasDeLaOferta } from './filas.js';

type Capitulo = [codigoWbs: string, nivel: number, nombre: string, monto: string];
type Item = [codigoItem: string, padre: string, codigoApu: string, descripcion: string, total: string];

/** Una fotografía mínima en EDT. El id de cada capítulo es su código, para colgarle las actividades. */
function fotografia(capitulos: Capitulo[], items: Item[]): FotografiaPresupuesto {
  return {
    schema: 5,
    presupuesto: {} as FotografiaPresupuesto['presupuesto'],
    empresa: { razonSocial: 'X', nit: '1', logoRuta: null },
    capitulos: capitulos.map(([codigoWbs, nivel, nombre, monto]) => ({
      id: codigoWbs,
      codigoWbs,
      padreCodigo: null,
      nivel,
      nombre,
      clasificacion: 'DIRECTO' as const,
      montoAcumulado: monto,
      incidenciaPct: null,
    })),
    items: items.map(([codigoItem, padre, codigoApu, descripcion, total]) => ({
      id: codigoItem,
      wbsNodoId: padre,
      codigoItem,
      codigoWbsPadre: padre,
      codigoApu,
      descripcion,
      unidad: 'm³',
      cantidad: '1.000000',
      precioUnitario: total,
      costoTotal: total,
      apuVersionId: 'v',
    })),
    generada: {} as FotografiaPresupuesto['generada'],
  };
}

/**
 * D-75: los subcapítulos primero, el capítulo sin «.0». El capítulo 10 está
 * para que el orden por texto falle si alguien lo intenta. Desordenadas a
 * propósito: el orden lo pone filasDeLaOferta, no quien arma la foto.
 */
const conD75 = () =>
  fotografia(
    [
      ['10', 1, 'DÉCIMO', '5.000000'],
      ['1', 1, 'PRIMERO', '30.000000'],
      ['1.1', 2, 'Subcapítulo', '20.000000'],
      ['2', 1, 'SEGUNDO', '0.000000'],
    ],
    [
      ['1.2', '1', 'APU-0007', 'Actividad directa del capítulo', '10.000000'],
      ['10.1', '10', 'APU-0012', 'Actividad del décimo', '5.000000'],
      ['1.1.1', '1.1', 'APU-0003', 'Actividad del subcapítulo', '20.000000'],
    ],
  );

describe('filasDeLaOferta: capítulos y actividades en el orden de la mesa (CONTRATO §16)', () => {
  test('el orden de la mesa: subcapítulos antes que las actividades directas, y el 10 después del 2', () => {
    assert.deepEqual(
      filasDeLaOferta(conD75()).map((f) => [f.tipo, f.codigo, f.nivel, f.descripcion]),
      [
        ['capitulo', '1', 1, 'PRIMERO'],
        ['capitulo', '1.1', 2, 'Subcapítulo'],
        ['actividad', 'APU-0003', 3, 'Actividad del subcapítulo'],
        ['actividad', 'APU-0007', 2, 'Actividad directa del capítulo'],
        ['capitulo', '2', 1, 'SEGUNDO'],
        ['capitulo', '10', 1, 'DÉCIMO'],
        ['actividad', 'APU-0012', 2, 'Actividad del décimo'],
      ],
    );
  });

  test('con ceros a la izquierda el orden es el mismo: «02» antes que «10»', () => {
    const foto = fotografia(
      [
        ['10', 1, 'DÉCIMO', '1.000000'],
        ['02', 1, 'SEGUNDO', '1.000000'],
        ['02.01', 2, 'Sub', '1.000000'],
      ],
      [['02.02', '02', 'APU-0001', 'Directa', '1.000000']],
    );
    assert.deepEqual(filasDeLaOferta(foto).map((f) => f.codigo), ['02', '02.01', 'APU-0001', '10']);
  });

  test('una versión aprobada antes de D-75 conserva su numeración y su orden (RN-04)', () => {
    const anterior = fotografia(
      [
        ['1.0', 1, 'PRIMERO', '30.000000'],
        ['1.2', 2, 'Subcapítulo', '20.000000'],
      ],
      [
        ['1.2.1', '1.2', 'APU-0003', 'Actividad del subcapítulo', '20.000000'],
        ['1.1', '1.0', 'APU-0007', 'Actividad colgada del capítulo', '10.000000'],
      ],
    );
    assert.deepEqual(
      filasDeLaOferta(anterior).map((f) => [f.codigo, f.nivel]),
      [
        ['1.0', 1],
        ['APU-0007', 2],
        ['1.2', 2],
        ['APU-0003', 3],
      ],
    );
  });

  test('los capítulos no llevan unidad, cantidad ni precio; las actividades sí', () => {
    const [capitulo, , actividad] = filasDeLaOferta(conD75());
    assert.deepEqual([capitulo!.unidad, capitulo!.cantidad, capitulo!.precioUnitario], [null, null, null]);
    assert.deepEqual([actividad!.unidad, actividad!.cantidad, actividad!.precioUnitario], ['m³', '1.000000', '20.000000']);
  });
});
