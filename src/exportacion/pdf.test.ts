import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { registrarEmpresa, type ContextoTenant } from '../infraestructura/basedatos/contextoTenant.js';
import { activarPresupuesto } from '../infraestructura/basedatos/cicloDeVida.js';
import { listarVersiones } from '../infraestructura/basedatos/versiones.js';
import {
  leerPresupuestoParaExportar,
  leerVersionParaExportar,
  type DocumentoExportable,
} from '../infraestructura/basedatos/exportacion.js';
import { armarPresupuestoDeReferencia } from '../pruebas/presupuestoDeReferencia.js';
import { imagenesDePdf, textoDePdf } from '../pruebas/textoDePdf.js';
import type { Logo } from './excel.js';
import { generarPdf } from './pdf.js';

const PNG_MINIMO: Logo = {
  bytes: Uint8Array.from(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    ),
  ),
  tipo: 'png',
};

let vivo: DocumentoExportable;
let version1: DocumentoExportable;

describe('PDF corporativo de la oferta (RF-PRE-30/31, RF-VER-07, RNF-20, 02 §9.5)', () => {
  before(async () => {
    const empresa = await registrarEmpresa({
      razonSocial: 'Constructora PDF',
      nit: '900000170-0',
      plan: 'EMPRESARIAL',
      adminNombre: 'Admin del PDF',
      adminEmail: 'pdf.admin@construsoft.test',
      adminHash: 'hash_de_prueba_no_real',
    });
    const contexto: ContextoTenant = { tenantId: empresa.tenantId, usuarioId: empresa.usuarioId };
    const { presupuestoId } = await armarPresupuestoDeReferencia(contexto, 'PDF-RETIRO');
    vivo = (await leerPresupuestoParaExportar(contexto, presupuestoId))!;
    await activarPresupuesto(contexto, presupuestoId);
    const [v1] = await listarVersiones(contexto, presupuestoId);
    version1 = (await leerVersionParaExportar(contexto, v1!.id))!;
  });

  test('es un PDF, con la empresa congelada en el encabezado: razón social y NIT', async () => {
    const pdf = await generarPdf(vivo, null);
    assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-');
    const texto = textoDePdf(pdf);
    assert.ok(texto.includes('Constructora PDF'));
    assert.ok(texto.includes('NIT 900000170-0'));
    assert.ok(texto.includes('PDF-RETIRO — Casa campestre El Retiro'));
  });

  test('la EDT en el orden de la oferta, con los importes formateados con los separadores de la empresa', async () => {
    const texto = textoDePdf(await generarPdf(vivo, null));
    const orden = ['PRELIMINARES', 'Topografía y replanteo', 'Director de obra', 'CIMENTACIÓN', 'Concreto 3000 PSI para zapatas', 'ESTRUCTURA', 'Formaleta metálica'];
    const posiciones = orden.map((t) => texto.indexOf(t));
    assert.ok(posiciones.every((p) => p >= 0), `falta alguno de ${orden.join(', ')}`);
    assert.deepEqual([...posiciones].sort((a, b) => a - b), posiciones);
    for (const importe of ['63.675.000,00', '636.750,00', '100,00', '68.295.000,00', '53.000.000,00']) {
      assert.ok(texto.includes(importe), `falta ${importe}`);
    }
  });

  test('el pie financiero cierra en 180.590.155,00 con sus porcentajes visibles (RF-PRE-22/43)', async () => {
    const texto = textoDePdf(await generarPdf(vivo, null));
    for (const t of [
      'Administración (10,00 %)',
      '10.549.000,00',
      'IVA sobre la utilidad (19,00 %)',
      '1.002.155,00',
      'VALOR TOTAL',
      '180.590.155,00',
    ]) {
      assert.ok(texto.includes(t), `falta ${t}`);
    }
  });

  test('sin el desglose de los APU (RF-PRE-31)', async () => {
    assert.doesNotMatch(textoDePdf(await generarPdf(vivo, null)).join(' | '), /Concreto premezclado|Oficial de obra|Recurso ·/);
  });

  test('una versión dice su número; el estado actual no dice ninguno (RF-VER-07)', async () => {
    assert.ok(textoDePdf(await generarPdf(version1, null)).includes('Versión 1'));
    assert.ok(!textoDePdf(await generarPdf(vivo, null)).some((t) => t.startsWith('Versión')));
  });

  test('el logo entra cuando lo hay; sin él el documento igual se genera (RNF-20)', async () => {
    assert.equal(imagenesDePdf(await generarPdf(vivo, PNG_MINIMO)), 1);
    assert.equal(imagenesDePdf(await generarPdf(vivo, null)), 0);
  });

  test('con cero decimales de vista, sin coma ni decimales: redondeo una sola vez, al exportar', async () => {
    const texto = textoDePdf(await generarPdf({ ...vivo, formato: { ...vivo.formato, decimalesVista: 0 } }, null));
    assert.ok(texto.includes('180.590.155'));
    assert.ok(!texto.includes('180.590.155,00'));
  });
});
