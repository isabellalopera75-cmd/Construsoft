import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Todos los archivos de prueba corren contra la misma construsoft_test en la
 * misma corrida, y el correo y el NIT son únicos en la base. Si dos archivos
 * usan el mismo, el que corre segundo falla con un 409 que no tiene nada que
 * ver con lo que prueba. Pasó dos veces; esta prueba lo vuelve imposible.
 */
/** Literales que no se guardan en la base y por eso pueden repetirse: el contacto de los términos. */
const NO_SE_GUARDAN = new Set(['legal@construsoft.test']);

test('ningún correo ni NIT de prueba se repite entre dos archivos de prueba', () => {
  const archivos: string[] = [];
  const recorrer = (dir: string) => {
    for (const nombre of readdirSync(dir)) {
      const ruta = join(dir, nombre);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else if (ruta.endsWith('.test.ts')) archivos.push(ruta);
    }
  };
  recorrer('src');

  const donde = new Map<string, Set<string>>();
  for (const archivo of archivos) {
    const fuente = readFileSync(archivo, 'utf8');
    const literales = [
      ...fuente.matchAll(/'([a-z0-9._-]+@construsoft\.test)'/g),
      ...fuente.matchAll(/'(\d{9}-\d)'/g),
    ].map((m) => m[1]!);
    for (const literal of literales.filter((l) => !NO_SE_GUARDAN.has(l))) {
      if (!donde.has(literal)) donde.set(literal, new Set());
      donde.get(literal)!.add(archivo.split('\\').join('/'));
    }
  }
  const repetidos = [...donde].filter(([, en]) => en.size > 1).map(([literal, en]) => `${literal} en ${[...en].join(' y ')}`);
  assert.deepEqual(repetidos, []);
});
