import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ContadorDeIntentos } from './limiteIntentos.js';

const MINUTO = 60_000;

describe('ContadorDeIntentos: ventana deslizante en memoria', () => {
  function contador(maximo = 5) {
    let ahora = 1_000_000;
    const c = new ContadorDeIntentos({ maximo, ventanaMs: 15 * MINUTO, ahora: () => ahora });
    return { c, avanzar: (ms: number) => (ahora += ms), ahora: () => ahora };
  }

  test('cuatro fallos no bloquean; el quinto sí, hasta que el más viejo salga de la ventana', () => {
    const { c, avanzar, ahora } = contador();
    for (let i = 0; i < 4; i += 1) {
      c.registrarFallo('correo:a@a.co');
      avanzar(MINUTO);
    }
    assert.equal(c.bloqueadoHasta('correo:a@a.co'), null);
    const primero = ahora() - 4 * MINUTO;
    c.registrarFallo('correo:a@a.co');
    assert.equal(c.bloqueadoHasta('correo:a@a.co'), primero + 15 * MINUTO);
  });

  test('el bloqueo se levanta solo cuando los fallos viejos salen de la ventana', () => {
    const { c, avanzar } = contador();
    for (let i = 0; i < 5; i += 1) c.registrarFallo('k');
    assert.notEqual(c.bloqueadoHasta('k'), null);
    avanzar(15 * MINUTO);
    assert.equal(c.bloqueadoHasta('k'), null);
  });

  test('reiniciar borra los fallos de esa clave y de ninguna otra', () => {
    const { c } = contador();
    for (let i = 0; i < 5; i += 1) {
      c.registrarFallo('correo:a@a.co');
      c.registrarFallo('ip:1.2.3.4');
    }
    c.reiniciar('correo:a@a.co');
    assert.equal(c.bloqueadoHasta('correo:a@a.co'), null);
    assert.notEqual(c.bloqueadoHasta('ip:1.2.3.4'), null);
  });

  test('las claves no se mezclan: los fallos de un correo no bloquean otro', () => {
    const { c } = contador();
    for (let i = 0; i < 5; i += 1) c.registrarFallo('correo:a@a.co');
    assert.equal(c.bloqueadoHasta('correo:b@b.co'), null);
  });
});
