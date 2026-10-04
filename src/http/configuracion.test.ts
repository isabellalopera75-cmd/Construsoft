import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { leerConfiguracion } from './configuracion.js';

const base = { SESSION_SECRET: 'una-clave-de-pruebas-larga' };

describe('configuración del arranque: términos provisionales y proxy (04 §7, §8)', () => {
  test('con términos de verdad arranca sin nada más', () => {
    const c = leerConfiguracion({ ...base, VERSION_TERMINOS: '2026-11-15' });
    assert.deepEqual({ version: c.versionTerminos, provisional: c.terminosProvisionales }, { version: '2026-11-15', provisional: false });
  });

  test('con una versión PROVISIONAL- se niega a arrancar si nadie lo autorizó por escrito', () => {
    assert.throws(
      () => leerConfiguracion({ ...base, VERSION_TERMINOS: 'PROVISIONAL-2026-10-01', CONTACTO_TERMINOS: 'a@b.co' }),
      /TERMINOS_PROVISIONALES=si/,
    );
    // Cualquier otro valor tampoco: tiene que ser exactamente «si».
    assert.throws(
      () =>
        leerConfiguracion({
          ...base,
          VERSION_TERMINOS: 'PROVISIONAL-2026-10-01',
          TERMINOS_PROVISIONALES: 'true',
          CONTACTO_TERMINOS: 'a@b.co',
        }),
      /TERMINOS_PROVISIONALES=si/,
    );
  });

  test('con TERMINOS_PROVISIONALES=si arranca, y entonces exige a quién escribirle', () => {
    assert.throws(
      () => leerConfiguracion({ ...base, VERSION_TERMINOS: 'PROVISIONAL-2026-10-01', TERMINOS_PROVISIONALES: 'si' }),
      /CONTACTO_TERMINOS/,
    );
    const c = leerConfiguracion({
      ...base,
      VERSION_TERMINOS: 'PROVISIONAL-2026-10-01',
      TERMINOS_PROVISIONALES: 'si',
      CONTACTO_TERMINOS: 'legal@construsoft.test',
    });
    assert.equal(c.terminosProvisionales, true);
  });

  test('una autorización sin versión provisional no hace nada: no hay forma de arrancar «por las dudas» en modo provisional', () => {
    const c = leerConfiguracion({ ...base, VERSION_TERMINOS: '2026-11-15', TERMINOS_PROVISIONALES: 'si' });
    assert.equal(c.terminosProvisionales, false);
  });

  test('sin SESSION_SECRET ni VERSION_TERMINOS no arranca', () => {
    assert.throws(() => leerConfiguracion({ VERSION_TERMINOS: '2026-11-15' }), /SESSION_SECRET/);
    assert.throws(() => leerConfiguracion({ ...base }), /VERSION_TERMINOS/);
  });

  test('el proxy de confianza es una lista de direcciones o subredes; «true» se rechaza por nombre', () => {
    assert.equal(leerConfiguracion({ ...base, VERSION_TERMINOS: 'v' }).proxiesDeConfianza, null);
    assert.deepEqual(
      leerConfiguracion({ ...base, VERSION_TERMINOS: 'v', PROXIES_DE_CONFIANZA: '10.0.0.5, 172.16.0.0/12' }).proxiesDeConfianza,
      ['10.0.0.5', '172.16.0.0/12'],
    );
    assert.throws(() => leerConfiguracion({ ...base, VERSION_TERMINOS: 'v', PROXIES_DE_CONFIANZA: 'true' }), /cualquier X-Forwarded-For/);
  });
});
