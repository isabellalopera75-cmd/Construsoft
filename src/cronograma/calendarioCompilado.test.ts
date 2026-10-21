import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { compilarCalendario, ErrorDeCalendario, type DefinicionDeCalendario } from './calendarioCompilado.js';
import { aMinutos, deMinutos } from './tiempo.js';

/*
 * El calendario visto por el motor (D-81): siguiente instante laborable y
 * sumar N minutos laborables, también negativos, más lo que necesitan las
 * holguras y las curvas. Todo en minutos, sin redondear fechas (RN-27).
 * El 2 de noviembre de 2026 es lunes.
 */

const OCHO_HORAS = [{ inicio: '07:00', fin: '12:00' }, { inicio: '13:00', fin: '16:00' }];
const LUNES_A_VIERNES: DefinicionDeCalendario = { semana: [OCHO_HORAS, OCHO_HORAS, OCHO_HORAS, OCHO_HORAS, OCHO_HORAS, [], []], excepciones: [] };
const HORIZONTE = { desde: '2026-01-01', hasta: '2031-12-31' };
const m = aMinutos;

describe('el calendario de lunes a viernes, de 7:00 a 12:00 y de 13:00 a 16:00', () => {
  const cal = compilarCalendario(LUNES_A_VIERNES, HORIZONTE);

  test('el siguiente instante laborable: dentro de un tramo es el mismo; en el almuerzo, la noche o el fin de semana, el próximo inicio', () => {
    const casos: [string, string][] = [
      ['2026-11-02T10:00', '2026-11-02T10:00'],
      ['2026-11-02T06:00', '2026-11-02T07:00'],
      ['2026-11-02T12:00', '2026-11-02T13:00'],
      ['2026-11-06T16:00', '2026-11-09T07:00'],
      ['2026-11-07T09:00', '2026-11-09T07:00'],
    ];
    for (const [desde, esperado] of casos) assert.equal(deMinutos(cal.siguienteInstanteLaborable(m(desde))), esperado, desde);
  });

  test('el cierre laborable anterior: dentro de un tramo es el mismo; en el almuerzo o el fin de semana, el último cierre', () => {
    const casos: [string, string][] = [
      ['2026-11-02T10:00', '2026-11-02T10:00'],
      ['2026-11-02T12:00', '2026-11-02T12:00'],
      ['2026-11-02T12:30', '2026-11-02T12:00'],
      ['2026-11-09T07:00', '2026-11-06T16:00'],
      ['2026-11-08T23:00', '2026-11-06T16:00'],
    ];
    for (const [desde, esperado] of casos) assert.equal(deMinutos(cal.anteriorCierreLaborable(m(desde))), esperado, desde);
  });

  test('sumar horas: un fin queda al cierre del último tramo trabajado, no en el siguiente inicio (RN-27)', () => {
    assert.equal(deMinutos(cal.sumarMinutosLaborables(m('2026-11-02T07:00'), 8 * 60)), '2026-11-02T16:00');
    assert.equal(deMinutos(cal.sumarMinutosLaborables(m('2026-11-02T07:00'), 5 * 60)), '2026-11-02T12:00');
    assert.equal(deMinutos(cal.sumarMinutosLaborables(m('2026-11-02T10:00'), 3 * 60)), '2026-11-02T14:00');
    // RN-26: 6 jornales de 8 h son 48 h: la semana entera y el lunes siguiente.
    assert.equal(deMinutos(cal.sumarMinutosLaborables(m('2026-11-02T07:00'), 48 * 60)), '2026-11-09T16:00');
    assert.equal(deMinutos(cal.sumarMinutosLaborables(m('2026-11-02T07:00'), 0)), '2026-11-02T07:00');
  });

  test('restar horas: un inicio queda al empezar el primer tramo trabajado, no en el cierre anterior', () => {
    assert.equal(deMinutos(cal.sumarMinutosLaborables(m('2026-11-09T16:00'), -8 * 60)), '2026-11-09T07:00');
    assert.equal(deMinutos(cal.sumarMinutosLaborables(m('2026-11-09T16:00'), -48 * 60)), '2026-11-02T07:00');
    assert.equal(deMinutos(cal.sumarMinutosLaborables(m('2026-11-03T07:00'), -60)), '2026-11-02T15:00');
    assert.equal(deMinutos(cal.sumarMinutosLaborables(m('2026-11-02T14:00'), -3 * 60)), '2026-11-02T10:00');
  });

  test('los minutos laborables entre dos instantes, en cualquier orden', () => {
    assert.equal(cal.minutosLaborablesEntre(m('2026-11-02T07:00'), m('2026-11-03T07:00')), 480);
    assert.equal(cal.minutosLaborablesEntre(m('2026-11-06T15:00'), m('2026-11-09T08:00')), 120);
    assert.equal(cal.minutosLaborablesEntre(m('2026-11-09T08:00'), m('2026-11-06T15:00')), -120);
  });

  test('los minutos de cada día entre dos instantes, para repartir el costo (RN-36)', () => {
    assert.deepEqual(cal.minutosPorDia(m('2026-11-02T10:00'), m('2026-11-03T12:00')), [
      { fecha: '2026-11-02', minutos: 300 },
      { fecha: '2026-11-03', minutos: 300 },
    ]);
    assert.deepEqual(cal.minutosPorDia(m('2026-11-06T13:00'), m('2026-11-09T09:00')), [
      { fecha: '2026-11-06', minutos: 180 },
      { fecha: '2026-11-09', minutos: 120 },
    ]);
  });

  test('el cierre de la jornada es el fin del último tramo del día: terminar a las 12:00 es terminar a mitad de jornada', () => {
    assert.equal(cal.esCierreDeJornada(m('2026-11-02T16:00')), true);
    assert.equal(cal.esCierreDeJornada(m('2026-11-02T12:00')), false);
    assert.equal(cal.esCierreDeJornada(m('2026-11-02T15:00')), false);
  });

  test('el comienzo y el cierre de la jornada de una fecha; en un día no laborable, el siguiente comienzo y el cierre anterior (A7)', () => {
    assert.equal(deMinutos(cal.comienzoDeJornada('2026-11-04')), '2026-11-04T07:00');
    assert.equal(deMinutos(cal.cierreDeJornada('2026-11-04')), '2026-11-04T16:00');
    assert.equal(deMinutos(cal.comienzoDeJornada('2026-11-07')), '2026-11-09T07:00');
    assert.equal(deMinutos(cal.cierreDeJornada('2026-11-07')), '2026-11-06T16:00');
  });
});

describe('las excepciones mandan sobre el día de la semana', () => {
  const cal = compilarCalendario(
    {
      ...LUNES_A_VIERNES,
      excepciones: [
        { fecha: '2026-11-02', tramos: [] },
        { fecha: '2026-11-07', tramos: [{ inicio: '07:00', fin: '12:00' }] },
      ],
    },
    HORIZONTE,
  );

  test('un festivo no se trabaja y un sábado marcado sí, en sus tramos', () => {
    assert.equal(deMinutos(cal.siguienteInstanteLaborable(m('2026-11-02T06:00'))), '2026-11-03T07:00');
    assert.equal(deMinutos(cal.siguienteInstanteLaborable(m('2026-11-06T16:00'))), '2026-11-07T07:00');
    assert.equal(deMinutos(cal.sumarMinutosLaborables(m('2026-11-06T13:00'), 5 * 60)), '2026-11-07T09:00');
    assert.equal(cal.esCierreDeJornada(m('2026-11-07T12:00')), true);
  });
});

describe('turnos que cruzan la medianoche y el calendario corrido', () => {
  test('de 20:00 a 24:00 y de 00:00 a 04:00 al día siguiente: seis horas desde las 20:00 terminan a las 2:00', () => {
    const noche: DefinicionDeCalendario = {
      semana: [[{ inicio: '20:00', fin: '24:00' }], [{ inicio: '00:00', fin: '04:00' }, { inicio: '20:00', fin: '24:00' }], [], [], [], [], []],
      excepciones: [],
    };
    const cal = compilarCalendario(noche, HORIZONTE);
    assert.equal(deMinutos(cal.sumarMinutosLaborables(m('2026-11-02T20:00'), 6 * 60)), '2026-11-03T02:00');
    assert.deepEqual(cal.minutosPorDia(m('2026-11-02T20:00'), m('2026-11-03T02:00')), [
      { fecha: '2026-11-02', minutos: 240 },
      { fecha: '2026-11-03', minutos: 120 },
    ]);
  });

  test('el corrido trabaja las 24 horas de los 7 días: una espera de 7 días son 168 horas', () => {
    const corrido: DefinicionDeCalendario = { semana: Array.from({ length: 7 }, () => [{ inicio: '00:00', fin: '24:00' }]), excepciones: [] };
    const cal = compilarCalendario(corrido, HORIZONTE);
    assert.equal(deMinutos(cal.sumarMinutosLaborables(m('2026-11-04T16:00'), 168 * 60)), '2026-11-11T16:00');
    assert.equal(deMinutos(cal.siguienteInstanteLaborable(m('2026-11-07T03:00'))), '2026-11-07T03:00');
  });
});

describe('lo que el calendario no puede responder', () => {
  test('un calendario sin ninguna hora laborable, o una cuenta que se sale del horizonte, es un error con su motivo', () => {
    assert.throws(() => compilarCalendario({ semana: Array.from({ length: 7 }, () => []), excepciones: [] }, HORIZONTE), ErrorDeCalendario);
    const cal = compilarCalendario(LUNES_A_VIERNES, { desde: '2026-11-01', hasta: '2026-11-30' });
    assert.throws(() => cal.sumarMinutosLaborables(m('2026-11-02T07:00'), 1000 * 60), ErrorDeCalendario);
  });
});
