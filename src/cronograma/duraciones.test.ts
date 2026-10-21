import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { diasDeHoras, diasDeMinutos, horasDeDias, minutosCalculados, minutosDeDesfase, minutosDeDuracionManual } from './duraciones.js';

describe('la duración calculada: cantidad ÷ rendimiento × horas por jornal ÷ cuadrillas (07 §6.1)', () => {
  test('el ejemplo del 07: 30 m³ a 5 m³ por jornal, con jornal de 8 h, son 48 h; con dos cuadrillas, 24', () => {
    assert.equal(minutosCalculados('30.000000', '5.0000', '8.00', 1), 48 * 60);
    assert.equal(minutosCalculados('30.000000', '5.0000', '8.00', 2), 24 * 60);
  });

  test('se redondea al minuto hacia arriba (A6), y la cuenta es exacta: 0,1 ÷ 0,3 × 8 h son 160 minutos, no 161', () => {
    assert.equal(minutosCalculados('30.000000', '7.0000', '8.00', 1), 2058);
    assert.equal(minutosCalculados('0.100000', '0.3000', '8.00', 1), 160);
  });

  test('sin rendimiento no hay duración calculada; con cantidad cero, dura cero', () => {
    assert.equal(minutosCalculados('30.000000', null, '8.00', 1), null);
    assert.equal(minutosCalculados('0.000000', '5.0000', '8.00', 1), 0);
  });
});

describe('días y horas (CONTRATO §19.1)', () => {
  test('los días van con un decimal, redondeados a la mitad alejándose del cero, en el factor del calendario', () => {
    const casos: [number, string, string][] = [
      [2880, '8.00', '6.0'],
      // RN-26: 48 h en un calendario de 9,5 h por día son 5,1 días.
      [2880, '9.50', '5.1'],
      [30, '8.00', '0.1'],
      [24, '8.00', '0.1'],
      [23, '8.00', '0.0'],
      [-240, '8.00', '-0.5'],
      [-24, '8.00', '-0.1'],
      [0, '8.00', '0.0'],
      [10080, '24.00', '7.0'],
    ];
    for (const [minutos, factor, esperado] of casos) assert.equal(diasDeMinutos(minutos, factor), esperado, `${minutos} min a ${factor} h`);
  });

  test('las horas guardadas, a días con un decimal: 48,45 h de 9,5 h son 5,1 días; −4 h de 8 h, −0,5', () => {
    assert.equal(diasDeHoras('48.4500', '9.50'), '5.1');
    assert.equal(diasDeHoras('-4.0000', '8.00'), '-0.5');
    assert.equal(diasDeHoras('0.0000', '24.00'), '0.0');
    assert.equal(diasDeHoras('0.4000', '8.00'), '0.1');
  });

  test('lo que se escribe en días se guarda en horas, sin redondear: 5,1 días de 9,5 h son 48,45 h', () => {
    assert.equal(horasDeDias('5.1', '9.50'), '48.4500');
    assert.equal(horasDeDias('-0.5', '8.00'), '-4.0000');
    assert.equal(horasDeDias('0.1', '8.33'), '0.8330');
  });

  test('las horas guardadas, a minutos: la duración manual hacia arriba (A6); el desfase a la mitad alejándose del cero', () => {
    assert.equal(minutosDeDuracionManual('48.4500'), 2907);
    assert.equal(minutosDeDuracionManual('0.8330'), 50);
    assert.equal(minutosDeDesfase('0.8330'), 50);
    assert.equal(minutosDeDesfase('-0.8330'), -50);
    assert.equal(minutosDeDesfase('0.0083'), 0);
    assert.equal(minutosDeDesfase('-4.0000'), -240);
  });
});
