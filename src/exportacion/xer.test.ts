import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Calendario } from '../infraestructura/basedatos/calendarios.js';
import { aWindows1252, datosDelCalendario } from './xer.js';

/*
 * Las dos piezas del XER que no dependen del cronograma (CONTRATO §19.9): el
 * calendario en el formato de P6 y el texto en Windows-1252.
 */

const jornada = [{ inicio: '07:00', fin: '12:00' }, { inicio: '13:00', fin: '16:00' }];
const calendario = (excepciones: Calendario['excepciones'], semana: Calendario['semana']): Calendario => ({
  id: '00000000-0000-0000-0000-000000000001',
  nombre: 'Prueba',
  tipo: 'OBRA',
  horasPorDia: '8.00',
  porDefecto: false,
  semana,
  horasDia: [],
  horasSemana: '40.00',
  excepciones,
  festivos: { origen: null, hasta: null },
});
const SALTO = '\x7f\x7f';

describe('el calendario del XER', () => {
  test('una excepción no laborable lleva su fecha como número de Excel: el 1 de enero de 2010 es 40179', () => {
    const datos = datosDelCalendario(calendario([{ fecha: '2010-01-01', motivo: 'Año nuevo', tramos: [], horas: '0' }], [jornada, [], [], [], [], [], []]));
    assert.ok(datos.endsWith(`  (0||Exceptions()(${SALTO}    (0||0(d|40179)())))))`), datos.slice(-80));
  });

  test('una excepción laborable lleva sus horas, y una semana sin excepciones cierra vacía', () => {
    const conHoras = datosDelCalendario(calendario([{ fecha: '2026-12-26', motivo: null, tramos: [{ inicio: '08:00', fin: '12:00' }], horas: '4' }], [[], [], [], [], [], [], []]));
    assert.ok(conHoras.includes(`(0||0(d|46382)(${SALTO}      (0||0(s|08:00|f|12:00)())))`), conHoras);
    const sinExcepciones = datosDelCalendario(calendario([], [jornada, jornada, jornada, jornada, jornada, [], []]));
    assert.ok(sinExcepciones.endsWith(`  (0||VIEW(ShowTotal|N)())${SALTO}  (0||Exceptions()())))`), sinExcepciones.slice(-80));
  });

  test('el lunes del sistema es el día 2 de P6, el domingo el 1; la medianoche del final es 00:00', () => {
    const corrido = [{ inicio: '00:00', fin: '24:00' }];
    const datos = datosDelCalendario(calendario([], [jornada, [], [], [], [], [], corrido]));
    assert.ok(datos.includes(`    (0||1()(${SALTO}      (0||0(s|00:00|f|00:00)())))${SALTO}    (0||2()(${SALTO}      (0||0(s|07:00|f|12:00)())`), datos);
    assert.ok(datos.includes(`    (0||3()())${SALTO}`));
  });
});

describe('el texto del XER en Windows-1252', () => {
  test('lo que cabe va en un byte; lo que no, sin la marca que no existe, y si ni así, «?»', () => {
    assert.deepEqual([...aWindows1252('m² €—ñ')], [0x6d, 0xb2, 0x20, 0x80, 0x97, 0xf1]);
    assert.equal(aWindows1252('Gödel ő ✓ 😀').toString('latin1'), 'G\xf6del o ? ?');
    // Una tilde suelta (NFD) se junta con su letra antes de convertir.
    assert.deepEqual([...aWindows1252('é')], [0xe9]);
  });
});
