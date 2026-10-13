import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { msHastaLaProximaPurga, programarPurgaDiaria } from './purgaDiaria.js';

/*
 * La hora de la purga (CONTRATO §15.5): una vez al día, después de la
 * medianoche de Bogotá. Bogotá no tiene horario de verano: es UTC−5 siempre,
 * así que las 00:05 de allá son las 05:05 UTC.
 */

const HORA = 60 * 60 * 1000;
const MINUTO = 60 * 1000;

describe('msHastaLaProximaPurga', () => {
  test('antes de las 00:05 de Bogotá, espera a las de ese mismo día', () => {
    // 23:00 del 11 en Bogotá = 04:00 UTC del 12.
    assert.equal(msHastaLaProximaPurga(new Date('2026-10-12T04:00:00Z')), HORA + 5 * MINUTO);
  });

  test('pasadas las 00:05 de Bogotá, espera a las del día siguiente', () => {
    // 00:06 del 12 en Bogotá.
    assert.equal(msHastaLaProximaPurga(new Date('2026-10-12T05:06:00Z')), 24 * HORA - MINUTO);
  });

  test('justo a las 00:05 no corre dos veces: la próxima es mañana', () => {
    assert.equal(msHastaLaProximaPurga(new Date('2026-10-12T05:05:00Z')), 24 * HORA);
  });

  test('el mediodía UTC es la madrugada de Bogotá del día siguiente, no la de hoy', () => {
    assert.equal(msHastaLaProximaPurga(new Date('2026-12-31T12:00:00Z')), 17 * HORA + 5 * MINUTO);
  });
});

describe('programarPurgaDiaria', () => {
  test('un fallo se avisa y no detiene la purga de los días siguientes', async () => {
    const esperas: number[] = [];
    const pendientes: (() => void)[] = [];
    const avisos: string[] = [];
    let corridas = 0;
    const detener = programarPurgaDiaria({
      purgar: async () => {
        corridas += 1;
        if (corridas === 1) throw new Error('la base no respondió');
        return [{ tenantId: 't', razonSocial: 'Constructora Vieja', motivo: 'pasaron 60 días' }];
      },
      avisar: (texto) => avisos.push(texto),
      ahora: () => new Date('2026-10-12T04:00:00Z'),
      esperar: (ms, hacer) => {
        esperas.push(ms);
        pendientes.push(hacer);
        return () => undefined;
      },
    });
    assert.deepEqual(esperas, [HORA + 5 * MINUTO]);

    pendientes.shift()!();
    await new Promise((r) => setImmediate(r));
    pendientes.shift()!();
    await new Promise((r) => setImmediate(r));

    assert.equal(corridas, 2);
    assert.equal(esperas.length, 3, 'después de cada corrida programa la siguiente');
    assert.match(avisos.join('\n'), /la base no respondió/);
    assert.match(avisos.join('\n'), /Constructora Vieja/);
    detener();
  });
});
