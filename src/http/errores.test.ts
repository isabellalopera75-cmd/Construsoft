import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ErrorParaElUsuario } from '../infraestructura/basedatos/errorParaElUsuario.js';
import { esNegacionDePermiso, traducirError } from './errores.js';

/** Un error como los que entrega el controlador pg: código SQLSTATE, mensaje y, a veces, la restricción. */
function errorDeLaBase(code: string, message = 'mensaje de la base', constraint?: string) {
  return Object.assign(new Error(message), { code, constraint });
}

describe('traducirError: el único lugar donde un rechazo se vuelve HTTP (04 §8.4, D-66)', () => {
  test('la tabla de SQLSTATE de fn_exigir_permiso, código por código', () => {
    const tabla = ['CS000', 'CS001', 'CS002', 'CS003', 'CS004', 'CS005'].map((codigo) => {
      const r = traducirError(errorDeLaBase(codigo, `texto de ${codigo}`));
      return [codigo, r.estado, r.borrarCookie];
    });
    assert.deepEqual(tabla, [
      ['CS000', 500, false],
      ['CS001', 401, true],
      ['CS002', 401, true],
      ['CS003', 403, true],
      ['CS004', 403, false],
      ['CS005', 402, false],
    ]);
  });

  test('esNegacionDePermiso: «no puede» es el rol sin el permiso o la suscripción sin escritura; nada más', () => {
    const clasificados = ['CS000', 'CS001', 'CS002', 'CS003', 'CS004', 'CS005', 'P0001', '23505'].map((codigo) => [
      codigo,
      esNegacionDePermiso(errorDeLaBase(codigo)),
    ]);
    assert.deepEqual(clasificados, [
      ['CS000', false],
      ['CS001', false],
      ['CS002', false],
      ['CS003', false],
      ['CS004', true],
      ['CS005', true],
      ['P0001', false],
      ['23505', false],
    ]);
    assert.equal(esNegacionDePermiso(new Error('sin código')), false);
  });

  test('CS000 es un error de programación: al usuario no le llega el texto de la base', () => {
    const r = traducirError(errorDeLaBase('CS000', 'El permiso «X» no existe en el catálogo'));
    assert.doesNotMatch(r.mensaje, /catálogo/);
  });

  test('CS003, CS004 y CS005 llegan con el mensaje de la base, que ya dice qué pasó y qué hacer', () => {
    for (const codigo of ['CS003', 'CS004', 'CS005']) {
      assert.equal(traducirError(errorDeLaBase(codigo, `explicación de ${codigo}`)).mensaje, `explicación de ${codigo}`);
    }
  });

  test('una regla de negocio de un disparador (P0001) es 422 con su mensaje tal cual (02 §2)', () => {
    assert.deepEqual(
      traducirError(errorDeLaBase('P0001', 'El presupuesto está en estado ACTIVO: la línea base es de solo lectura')),
      { estado: 422, mensaje: 'El presupuesto está en estado ACTIVO: la línea base es de solo lectura', borrarCookie: false },
    );
  });

  test('un código repetido es 409 con un mensaje para personas, no el de PostgreSQL', () => {
    const r = traducirError(
      errorDeLaBase('23505', 'llave duplicada viola restricción de unicidad «presupuesto_tenant_id_codigo_key»', 'presupuesto_tenant_id_codigo_key'),
    );
    assert.equal(r.estado, 409);
    assert.match(r.mensaje, /Ya existe un presupuesto con ese código/);
  });

  test('los errores para el usuario de la capa de datos: NO_EXISTE es 404, RECHAZADO es 422, con su mensaje', () => {
    assert.deepEqual(traducirError(new ErrorParaElUsuario('No está.', 'NO_EXISTE')), {
      estado: 404,
      mensaje: 'No está.',
      borrarCookie: false,
    });
    assert.equal(traducirError(new ErrorParaElUsuario('Venció.', 'RECHAZADO')).estado, 422);
  });

  test('cualquier otro error es 500 y no muestra su texto: puede llevar detalles internos', () => {
    const r = traducirError(new TypeError('Cannot read properties of undefined (reading "id")'));
    assert.equal(r.estado, 500);
    assert.doesNotMatch(r.mensaje, /undefined/);
  });

  test('ningún otro archivo del código traduce un SQLSTATE CS00x: si aparece en dos sitios, ya se rompió', () => {
    const archivos: string[] = [];
    const recorrer = (dir: string) => {
      for (const nombre of readdirSync(dir)) {
        const ruta = join(dir, nombre);
        if (statSync(ruta).isDirectory()) recorrer(ruta);
        else if (ruta.endsWith('.ts') && !ruta.endsWith('.test.ts')) archivos.push(ruta);
      }
    };
    recorrer('src');
    const conCodigos = archivos.filter((ruta) => /\bCS00\d\b/.test(readFileSync(ruta, 'utf8')));
    assert.deepEqual(conCodigos.map((r) => r.replace(/\\/g, '/')), ['src/http/errores.ts']);
  });
});
