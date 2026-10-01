import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { registrarEmpresa, type ContextoTenant } from '../infraestructura/basedatos/contextoTenant.js';
import { cambiarCantidad } from '../infraestructura/basedatos/actividad.js';
import { activarPresupuesto, reabrirPresupuesto } from '../infraestructura/basedatos/cicloDeVida.js';
import { listarVersiones } from '../infraestructura/basedatos/versiones.js';
import { leerVersionParaExportar, type DocumentoExportable } from '../infraestructura/basedatos/exportacion.js';
import { armarPresupuestoDeReferencia } from '../pruebas/presupuestoDeReferencia.js';
import { textoDePdf } from '../pruebas/textoDePdf.js';
import { generarExcel } from './excel.js';
import { generarPdf } from './pdf.js';

/**
 * El hito de la fase 5: el presupuesto de referencia (06 §8) exportado desde
 * sus versiones. La versión 1 es la línea base original (180.590.155, la
 * excavación en 120 m³). La 3 es la que quedó tras reabrir y pasar la
 * excavación a 130 m³ (181.055.812,5, cifra calculada a mano en el cierre de
 * la fase 4). Cada documento tiene que decir lo suyo y no lo del otro.
 */

let version1: DocumentoExportable;
let version3: DocumentoExportable;

/** Las seis celdas de la fila de una actividad, tal como las dibujó el PDF. */
function filaDelPdf(texto: string[], descripcion: string): string[] {
  const i = texto.indexOf(descripcion);
  assert.ok(i > 0, `no está «${descripcion}»`);
  return texto.slice(i - 1, i + 5);
}

async function valorTotalDelExcel(documento: DocumentoExportable): Promise<unknown> {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load((await generarExcel(documento, null)) as unknown as ArrayBuffer);
  let valor: unknown;
  libro.worksheets[0]!.eachRow((f) => {
    if (f.getCell(1).text === 'VALOR TOTAL') valor = f.getCell(6).value;
  });
  return valor;
}

describe('cierre de la fase 5: el presupuesto de referencia exportado desde sus versiones', () => {
  before(async () => {
    const empresa = await registrarEmpresa({
      razonSocial: 'Constructora El Retiro Exporta',
      nit: '900000082-2',
      plan: 'EMPRESARIAL',
      adminNombre: 'Ingeniera de las exportaciones',
      adminEmail: 'cierre5.retiro@construsoft.test',
      adminHash: 'hash_de_prueba_no_real',
    });
    const contexto: ContextoTenant = { tenantId: empresa.tenantId, usuarioId: empresa.usuarioId };
    const referencia = await armarPresupuestoDeReferencia(contexto, 'PRE-RETIRO-EXPORTA');
    const id = referencia.presupuestoId;

    await activarPresupuesto(contexto, id);
    await reabrirPresupuesto(contexto, id, 'El estudio de suelos pidió excavar diez metros cúbicos más');
    await cambiarCantidad(contexto, referencia.actividades['Excavación manual']!.id, '130');
    await activarPresupuesto(contexto, id);

    const versiones = await listarVersiones(contexto, id);
    assert.deepEqual(versiones.map((v) => v.numero), [1, 2, 3]);
    version1 = (await leerVersionParaExportar(contexto, versiones[0]!.id))!;
    version3 = (await leerVersionParaExportar(contexto, versiones[2]!.id))!;
  });

  test('el PDF de la versión 1 dice «Versión 1», cierra en 180.590.155,00 y trae la excavación en 120 m³', async () => {
    const texto = textoDePdf(await generarPdf(version1, null));
    assert.ok(texto.some((t) => t.startsWith('Versión 1 · ')));
    assert.ok(texto.includes('180.590.155,00'));
    assert.deepEqual(filaDelPdf(texto, 'Excavación manual'), [
      '2.1',
      'Excavación manual',
      'm³',
      '120,00',
      '38.500,00',
      '4.620.000,00',
    ]);
  });

  test('el PDF de la versión 3 dice «Versión 3», cierra en 181.055.812,50 y trae la excavación en 130 m³', async () => {
    const texto = textoDePdf(await generarPdf(version3, null));
    assert.ok(texto.some((t) => t.startsWith('Versión 3 · ')));
    assert.ok(texto.includes('181.055.812,50'));
    assert.deepEqual(filaDelPdf(texto, 'Excavación manual'), [
      '2.1',
      'Excavación manual',
      'm³',
      '130,00',
      '38.500,00',
      '5.005.000,00',
    ]);
  });

  test('los dos PDF no dicen lo mismo: ninguno trae el número, la cifra ni la cantidad del otro', async () => {
    const uno = textoDePdf(await generarPdf(version1, null));
    const tres = textoDePdf(await generarPdf(version3, null));
    assert.ok(!uno.some((t) => t.startsWith('Versión 3')), 'la versión 1 dice ser la 3');
    assert.ok(!tres.some((t) => t.startsWith('Versión 1')), 'la versión 3 dice ser la 1');
    for (const ajeno of ['181.055.812,50', '130,00', '5.005.000,00']) {
      assert.ok(!uno.includes(ajeno), `la versión 1 trae «${ajeno}»`);
    }
    for (const ajeno of ['180.590.155,00', '120,00', '4.620.000,00']) {
      assert.ok(!tres.includes(ajeno), `la versión 3 trae «${ajeno}»`);
    }
  });

  test('el Excel de cada versión cierra en su propio valor total', async () => {
    assert.equal(await valorTotalDelExcel(version1), 180590155);
    assert.equal(await valorTotalDelExcel(version3), 181055812.5);
  });
});
