import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUTA_BORRADOR, leerBorrador } from './terminos.js';

const CONTACTO = 'legal@construsoft.test';

describe('términos provisionales: el borrador de prototipo/legal.html con su aviso (04 §8.6)', () => {
  const documentos = leerBorrador(RUTA_BORRADOR, CONTACTO);

  test('sirve los cuatro documentos completos, en el orden del borrador', () => {
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

  test('cada documento EMPIEZA por el aviso: quien muestre uno solo, muestra también el aviso', () => {
    for (const d of documentos) {
      assert.match(d.html, /^<p class="aviso-borrador" role="note">/, d.id);
      const aviso = d.html.slice(0, d.html.indexOf('</p>'));
      assert.match(aviso, /no ha pasado por revisión legal/);
      assert.match(aviso, /no es para uso real/);
      assert.match(aviso, /legal@construsoft\.test/);
    }
  });

  test('el contacto se escapa: viene del entorno y termina dentro de HTML', () => {
    const [d] = leerBorrador(RUTA_BORRADOR, '<b>x</b>');
    assert.match(d!.html, /&lt;b&gt;x&lt;\/b&gt;/);
  });

  test('no se cuela nada del prototipo fuera de los documentos: ni scripts, ni comentarios, ni el título suelto', () => {
    for (const d of documentos) {
      assert.doesNotMatch(d.html, /<script|<!--|<h2>/i, d.id);
    }
  });

  test('si al borrador le falta un documento, no arranca: una página de términos a medias no se sirve', () => {
    const original = readFileSync(fileURLToPath(RUTA_BORRADOR), 'utf8');
    const sinCookies = original.replace(/<article class="legal-doc" id="cookies">[\s\S]*?<\/article>/, '');
    const ruta = join(mkdtempSync(join(tmpdir(), 'terminos-')), 'legal.html');
    writeFileSync(ruta, sinCookies);
    assert.throws(() => leerBorrador(ruta, CONTACTO), /cookies/);
  });
});
