import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARPETA_LEGAL, leerTerminos } from './terminos.js';
import { CARPETA_LEGAL_DE_PRUEBA } from '../pruebas/clienteHttp.js';

const CONTACTO = 'legal@construsoft.test';
const VERSION_REAL = 'PROVISIONAL-2026-09-25';

describe('los términos de legal/<VERSION_TERMINOS>/legal.html (04 §8.6)', () => {
  test('el borrador que está en el repositorio: los cuatro documentos completos, en su orden', () => {
    const documentos = leerTerminos(VERSION_REAL, CONTACTO);
    assert.deepEqual(
      documentos.map((d) => [d.id, d.titulo]),
      [
        ['privacidad', 'Política de Tratamiento de Datos Personales'],
        ['terminos', 'Términos y Condiciones'],
        ['cookies', 'Política de Cookies'],
        ['reembolsos', 'Política de Reembolsos'],
      ],
    );
    // El largo real del contenido, no un resumen: cada uno trae sus apartados.
    for (const d of documentos) assert.ok((d.html.match(/<h3>/g) ?? []).length >= 3, `${d.id} trae sus apartados`);
  });

  test('provisional: cada documento EMPIEZA por el aviso, para que quien muestre uno solo muestre también el aviso', () => {
    for (const d of leerTerminos(VERSION_REAL, CONTACTO)) {
      assert.match(d.html, /^<p class="aviso-borrador" role="note">/, d.id);
      const aviso = d.html.slice(0, d.html.indexOf('</p>'));
      assert.match(aviso, /no ha pasado por revisión legal/);
      assert.match(aviso, /no es para uso real/);
      assert.match(aviso, /legal@construsoft\.test/);
    }
  });

  test('una versión revisada se sirve sin aviso', () => {
    for (const d of leerTerminos('terminos-2026-10-01', null, CARPETA_LEGAL_DE_PRUEBA)) {
      assert.doesNotMatch(d.html, /aviso-borrador/, d.id);
    }
  });

  test('el contacto se escapa: viene del entorno y termina dentro de HTML', () => {
    const [d] = leerTerminos(VERSION_REAL, '<b>x</b>');
    assert.match(d!.html, /&lt;b&gt;x&lt;\/b&gt;/);
  });

  test('no se cuela nada fuera de los documentos: ni scripts, ni comentarios, ni el título suelto', () => {
    for (const d of leerTerminos(VERSION_REAL, CONTACTO)) assert.doesNotMatch(d.html, /<script|<!--|<h2>/i, d.id);
  });

  test('una versión sin su carpeta no arranca, y el mensaje dice qué archivo falta', () => {
    assert.throws(() => leerTerminos('2027-01-01', null), /legal[\\/]2027-01-01[\\/]legal\.html/);
  });

  test('el nombre de la versión es un nombre de carpeta, nunca una ruta', () => {
    for (const version of ['../prototipo', 'a/b', '..', '.oculta', '']) {
      assert.throws(() => leerTerminos(version, null), /no sirve como nombre de carpeta/, version);
    }
  });

  test('si al texto le falta un documento, no arranca: una página de términos a medias no se sirve', () => {
    const original = readFileSync(join(fileURLToPath(CARPETA_LEGAL), VERSION_REAL, 'legal.html'), 'utf8');
    const carpeta = mkdtempSync(join(tmpdir(), 'terminos-'));
    mkdirSync(join(carpeta, 'v1'));
    writeFileSync(join(carpeta, 'v1', 'legal.html'), original.replace(/<article class="legal-doc" id="cookies">[\s\S]*?<\/article>/, ''));
    assert.throws(() => leerTerminos('v1', CONTACTO, carpeta), /cookies/);
  });
});
