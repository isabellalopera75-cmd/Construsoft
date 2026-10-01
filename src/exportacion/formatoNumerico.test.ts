import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ejecutarConPermiso, registrarEmpresa, type ContextoTenant } from '../infraestructura/basedatos/contextoTenant.js';
import { formatearNumero, redondear } from './formatoNumerico.js';

const COLOMBIA = { separadorMiles: '.', separadorDecimal: ',', decimalesVista: 2 };

describe('redondear: el redondeo de presentación, sobre texto', () => {
  test('a la mitad, hacia arriba; los empates no se pierden por coma flotante', () => {
    assert.equal(redondear('0.005', 2), '0.01');
    assert.equal(redondear('1.005', 2), '1.01'); // en coma flotante 1.005 es 1.00499… y daría 1.00
    assert.equal(redondear('0.004999', 2), '0.00');
    assert.equal(redondear('2.5', 0), '3');
    assert.equal(redondear('1002155.000000', 0), '1002155');
  });

  test('el acarreo atraviesa los nueves y crece un dígito', () => {
    assert.equal(redondear('0.995', 2), '1.00');
    assert.equal(redondear('999999.995', 2), '1000000.00');
    assert.equal(redondear('9.95', 1), '10.0');
  });

  test('24 dígitos sin pérdida: lo que Number() no puede representar', () => {
    assert.equal(redondear('999999999999999999.995000', 2), '1000000000000000000.00');
    assert.equal(redondear('123456789012345678.994999', 2), '123456789012345678.99');
  });

  test('un texto que no es un número no se adivina: se rechaza', () => {
    assert.throws(() => redondear('1,5', 2), /no es un número/);
    assert.throws(() => redondear('NaN', 2), /no es un número/);
    assert.throws(() => redondear('', 2), /no es un número/);
  });
});

describe('formatearNumero: separadores y decimales de la empresa (RF-CFG-14/15)', () => {
  test('la cifra de referencia con los separadores colombianos', () => {
    assert.equal(formatearNumero('180590155.000000', COLOMBIA), '180.590.155,00');
    assert.equal(formatearNumero('180590155.000000', { ...COLOMBIA, decimalesVista: 0 }), '180.590.155');
  });

  test('otros separadores y un decimal', () => {
    assert.equal(
      formatearNumero('1002155.000000', { separadorMiles: ',', separadorDecimal: '.', decimalesVista: 1 }),
      '1,002,155.0',
    );
    assert.equal(formatearNumero('999.500000', COLOMBIA), '999,50');
    assert.equal(formatearNumero('0.000000', COLOMBIA), '0,00');
  });

  test('null es el guion de RF-PRE-37: nunca «0», nunca «NaN»', () => {
    assert.equal(formatearNumero(null, COLOMBIA), '—');
  });
});

describe('redondear es exactamente el round() de PostgreSQL', () => {
  let contexto: ContextoTenant;

  before(async () => {
    const empresa = await registrarEmpresa({
      razonSocial: 'Constructora Redondeo',
      nit: '900000140-0',
      plan: 'PERSONAL',
      adminNombre: 'Admin del redondeo',
      adminEmail: 'redondeo.admin@construsoft.test',
      adminHash: 'hash_de_prueba_no_real',
    });
    contexto = { tenantId: empresa.tenantId, usuarioId: empresa.usuarioId };
  });

  test('los casos borde, con 0, 1 y 2 decimales, dan lo mismo que la base', async () => {
    const valores = [
      '0',
      '0.5',
      '1.5',
      '2.5',
      '0.005',
      '0.015',
      '1.005',
      '0.995',
      '0.994999',
      '9.95',
      '99.995',
      '999999.995',
      '0.000001',
      '1002155.000000',
      '180590155.000000',
      '181055812.500000',
      '50.24172907384586216703',
      '64.74073371883590861693',
      '35.25926628116409138307',
      '999999999999999999.995000',
      '123456789012345678.994999',
    ];
    const deLaBase = await ejecutarConPermiso(contexto, 'PRESUPUESTOS.VER', async (cliente) => {
      const { rows } = await cliente.query<{ valor: string; d: number; redondeado: string }>(
        `SELECT v AS valor, d, round(v::numeric, d)::text AS redondeado
           FROM unnest($1::text[]) AS v, generate_series(0, 2) AS d`,
        [valores],
      );
      return rows;
    });
    assert.equal(deLaBase.length, valores.length * 3);
    for (const fila of deLaBase) {
      assert.equal(redondear(fila.valor, fila.d), fila.redondeado, `round(${fila.valor}, ${fila.d})`);
    }
  });
});
