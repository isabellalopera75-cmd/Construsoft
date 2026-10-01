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
import { imagenesDePdf, leerPdf, textoDePdf } from '../pruebas/textoDePdf.js';
import { presupuestoLargo } from '../pruebas/presupuestoLargo.js';
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
      'IVA (19,00 %)',
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

  test('las fuentes viajan dentro del PDF y todo carácter tiene su glifo: m³ y m² se dibujan, no dependen del visor', async () => {
    const leido = leerPdf(await generarPdf(vivo, null));
    assert.ok(leido.fuentesIncrustadas >= 2, `fuentes incrustadas: ${leido.fuentesIncrustadas}`);
    assert.equal(leido.fuentesSinIncrustar, 0);
    assert.equal(leido.glifosFaltantes, 0);
    const texto = leido.paginas.flat();
    for (const unidad of ['m³', 'm²', 'Glb', 'Ms', 'Kg']) assert.ok(texto.includes(unidad), `falta la unidad ${unidad}`);
  });

  test('el detector de glifos faltantes funciona: un carácter que la fuente no tiene se delata como .notdef', async () => {
    const conAjeno = structuredClone(vivo);
    conAjeno.fotografia.items[0]!.descripcion = 'Excavación 漢';
    assert.ok(leerPdf(await generarPdf(conAjeno, null)).glifosFaltantes > 0);
  });

  test('el encabezado trae la fecha de elaboración, en la hora de Colombia', async () => {
    const tarde = structuredClone(vivo);
    // 03:30 del 1 de octubre en UTC son las 22:30 del 30 de septiembre en Bogotá.
    tarde.fotografia.presupuesto.fechaElaboracion = '2026-10-01T03:30:00+00:00';
    assert.ok(textoDePdf(await generarPdf(tarde, null)).includes('Fecha de elaboración: 30/09/2026'));
  });
});

describe('PDF de un presupuesto largo: la paginación', () => {
  test('ochenta actividades en varias páginas, cada una exactamente una vez y en orden', async () => {
    const paginas = leerPdf(await generarPdf(presupuestoLargo(), null)).paginas;
    assert.ok(paginas.length >= 3, `páginas: ${paginas.length}`);
    const actividades = paginas.flat().filter((t) => /^\d+\.(?!0$)\d+$/.test(t));
    const esperadas = [1, 2, 3, 4, 5].flatMap((c) => Array.from({ length: 16 }, (_, a) => `${c}.${a + 1}`));
    assert.deepEqual(actividades, esperadas);
  });

  test('cada página repite quién emite, qué presupuesto es y los títulos de las columnas, y dice «Página i de n»', async () => {
    const paginas = leerPdf(await generarPdf(presupuestoLargo(), null)).paginas;
    paginas.forEach((pagina, i) => {
      for (const t of ['Constructora Paginación SAS', 'PRE-LARGO — Edificio de prueba de paginación', 'Ítem', 'Descripción', 'Precio unitario', `Página ${i + 1} de ${paginas.length}`]) {
        assert.ok(pagina.includes(t), `la página ${i + 1} no trae «${t}»`);
      }
    });
  });

  test('el pie nunca queda huérfano ni partido, para cualquier largo entre 40 y 90 actividades', async () => {
    // Un solo largo deja el corte de página donde cae por suerte. Recorriendo
    // cincuenta largos, alguno pone el corte justo antes del pie.
    for (let n = 40; n <= 90; n += 1) {
      const paginas = leerPdf(await generarPdf(presupuestoLargo(n), null)).paginas;
      const conPie = paginas.filter((p) => p.includes('VALOR TOTAL') || p.includes('Total costo indirecto'));
      assert.equal(conPie.length, 1, `con ${n} actividades el pie quedó partido en ${conPie.length} páginas`);
      assert.ok(
        conPie[0]!.some((t) => /^\d+\.\d+$/.test(t)),
        `con ${n} actividades la página del pie no trae ninguna fila de la EDT`,
      );
    }
  });
});
