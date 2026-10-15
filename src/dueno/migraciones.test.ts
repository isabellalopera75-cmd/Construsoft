import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { huella, leerNombreDeArchivo, planDeMigracion, type ArchivoDeMigracion } from './migraciones.js';

/*
 * CONTRATO §18.1 (D-77): qué migraciones faltan y si alguna ya aplicada
 * cambió. La parte que decide es pura; la que corre psql es aparte.
 */

const archivo = (numero: number, nombre: string, contenido = `-- ${nombre}\n`): ArchivoDeMigracion => ({
  numero,
  nombre,
  ruta: `docs/migraciones/${String(numero).padStart(4, '0')}-${nombre}.sql`,
  huella: huella(contenido),
});

describe('leerNombreDeArchivo', () => {
  test('toma el número y el nombre de «0001-parametros-del-ciclo.sql»', () => {
    assert.deepEqual(leerNombreDeArchivo('0001-parametros-del-ciclo.sql'), { numero: 1, nombre: 'parametros-del-ciclo' });
  });

  test('el archivo para revertir no es una migración, y lo que no sigue el patrón tampoco', () => {
    assert.equal(leerNombreDeArchivo('0001-parametros-del-ciclo.revertir.sql'), null);
    assert.equal(leerNombreDeArchivo('LEEME.md'), null);
    assert.equal(leerNombreDeArchivo('1-corta.sql'), null);
  });
});

describe('huella', () => {
  test('es el sha256 en hexadecimal, y no cambia con los fines de línea de Windows (core.autocrlf)', () => {
    assert.match(huella('SELECT 1;\n'), /^[0-9a-f]{64}$/);
    assert.equal(huella('BEGIN;\r\nSELECT 1;\r\n'), huella('BEGIN;\nSELECT 1;\n'));
    assert.notEqual(huella('SELECT 1;\n'), huella('SELECT 2;\n'));
  });
});

describe('planDeMigracion', () => {
  const uno = archivo(1, 'parametros-del-ciclo');
  const dos = archivo(2, 'renumeracion-por-rama');

  test('una base recién cargada (solo la 0) aplica todas, en orden', () => {
    const plan = planDeMigracion([{ numero: 0, sha256: null }], [dos, uno]);
    assert.deepEqual(plan, { aplicar: [uno, dos], cambiadas: [], sinHuella: [], faltanArchivos: [] });
  });

  test('las aplicadas con su huella no se repiten', () => {
    const plan = planDeMigracion([{ numero: 0, sha256: null }, { numero: 1, sha256: uno.huella }], [uno, dos]);
    assert.deepEqual(plan.aplicar, [dos]);
    assert.deepEqual(plan.cambiadas, []);
  });

  test('una migración publicada que alguien editó se detecta: no se aplica nada', () => {
    const editada = archivo(1, 'parametros-del-ciclo', '-- otra cosa\n');
    const plan = planDeMigracion([{ numero: 0, sha256: null }, { numero: 1, sha256: uno.huella }], [editada, dos]);
    assert.deepEqual(plan.cambiadas, [editada]);
  });

  test('una aplicada sin huella (la puso el reseteo o una mano) se anota, no se reaplica', () => {
    const plan = planDeMigracion([{ numero: 0, sha256: null }, { numero: 1, sha256: null }], [uno, dos]);
    assert.deepEqual([plan.aplicar, plan.sinHuella], [[dos], [uno]]);
  });

  test('una aplicada en la base cuyo archivo ya no está se informa', () => {
    const plan = planDeMigracion([{ numero: 0, sha256: null }, { numero: 1, sha256: uno.huella }, { numero: 2, sha256: dos.huella }], [uno]);
    assert.deepEqual(plan.faltanArchivos, [2]);
  });
});
