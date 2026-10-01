import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { registrarEmpresa, type ContextoTenant } from '../infraestructura/basedatos/contextoTenant.js';
import { activarPresupuesto } from '../infraestructura/basedatos/cicloDeVida.js';
import { listarVersiones } from '../infraestructura/basedatos/versiones.js';
import {
  leerPresupuestoParaExportar,
  leerVersionParaExportar,
  type DocumentoExportable,
} from '../infraestructura/basedatos/exportacion.js';
import { armarPresupuestoDeReferencia } from '../pruebas/presupuestoDeReferencia.js';
import { generarExcel, type Logo } from './excel.js';

/** Un PNG de 1 × 1 píxel: basta para comprobar que el logo entra. */
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

async function abrir(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(buffer as unknown as ArrayBuffer);
  return libro;
}

/** Todas las celdas con valor, como texto, para buscar lo que no tiene que estar. */
function textos(hoja: ExcelJS.Worksheet): string[] {
  const salida: string[] = [];
  hoja.eachRow((fila) => fila.eachCell((celda) => salida.push(String(celda.text))));
  return salida;
}

/** La fila cuyo primer valor es exactamente `clave`. */
function fila(hoja: ExcelJS.Worksheet, clave: string): ExcelJS.Row {
  let encontrada: ExcelJS.Row | undefined;
  hoja.eachRow((f) => {
    if (f.getCell(1).text === clave) encontrada = f;
  });
  assert.ok(encontrada, `no hay fila «${clave}»`);
  return encontrada;
}

describe('Excel de la oferta (RF-PRE-29/31, RF-VER-07, 02 §9.5)', () => {
  before(async () => {
    const empresa = await registrarEmpresa({
      razonSocial: 'Constructora Excel',
      nit: '900000160-0',
      plan: 'EMPRESARIAL',
      adminNombre: 'Admin del Excel',
      adminEmail: 'excel.admin@construsoft.test',
      adminHash: 'hash_de_prueba_no_real',
      versionTerminos: 'terminos-de-prueba',
    });
    const contexto: ContextoTenant = { tenantId: empresa.tenantId, usuarioId: empresa.usuarioId };
    const { presupuestoId } = await armarPresupuestoDeReferencia(contexto, 'XLS-RETIRO');
    vivo = (await leerPresupuestoParaExportar(contexto, presupuestoId))!;
    await activarPresupuesto(contexto, presupuestoId);
    const [v1] = await listarVersiones(contexto, presupuestoId);
    version1 = (await leerVersionParaExportar(contexto, v1!.id))!;
  });

  test('una sola hoja, en el orden de la oferta: capítulos y actividades intercalados', async () => {
    const libro = await abrir(await generarExcel(vivo, null));
    assert.equal(libro.worksheets.length, 1);
    const hoja = libro.worksheets[0]!;
    const codigos = textos(hoja).filter((t) => /^\d+\.\d+$/.test(t));
    assert.deepEqual(codigos, ['1.0', '1.1', '1.2', '1.3', '2.0', '2.1', '2.2', '3.0', '3.1', '3.2']);
  });

  test('agrupamiento nativo por nivel, con el resumen arriba: el capítulo encima de lo que cuelga de él', async () => {
    const hoja = (await abrir(await generarExcel(vivo, null))).worksheets[0]!;
    assert.deepEqual(
      ['1.0', '1.1', '2.0', '2.2'].map((c) => fila(hoja, c).outlineLevel ?? 0),
      [0, 1, 0, 1],
    );
    assert.equal(hoja.properties.outlineProperties?.summaryBelow, false);
  });

  test('valores numéricos planos, sin una sola fórmula, con los decimales de la empresa', async () => {
    const hoja = (await abrir(await generarExcel(vivo, null))).worksheets[0]!;
    const concreto = fila(hoja, '2.2');
    assert.deepEqual(
      [2, 3, 4, 5, 6].map((c) => concreto.getCell(c).value),
      ['Concreto 3000 PSI para zapatas', 'm³', 100, 636750, 63675000],
    );
    assert.equal(fila(hoja, '2.0').getCell(6).value, 68295000);
    assert.equal(concreto.getCell(6).numFmt, '#,##0.00');
    hoja.eachRow((f) =>
      f.eachCell((celda) => assert.notEqual(celda.type, ExcelJS.ValueType.Formula, `fórmula en ${celda.address}`)),
    );
  });

  test('el pie financiero completo, en el orden decidido por el dueño, cierra en 180.590.155 (D-28)', async () => {
    const hoja = (await abrir(await generarExcel(vivo, null))).worksheets[0]!;
    assert.deepEqual(
      [
        'Total costo indirecto',
        'Total costo directo',
        'Administración (10,00 %)',
        'Imprevistos (5,00 %)',
        'Utilidad (5,00 %)',
        'AIU',
        'IVA (19,00 %)',
        'VALOR TOTAL',
      ].map((concepto) => fila(hoja, concepto).getCell(6).value),
      [53000000, 105490000, 10549000, 5274500, 5274500, 21098000, 1002155, 180590155],
    );
    // El orden lo fija la posición en la hoja: Administración inmediatamente debajo del costo directo.
    const filaDe = (concepto: string) => fila(hoja, concepto).number;
    assert.deepEqual(
      ['Total costo indirecto', 'Total costo directo', 'Administración (10,00 %)', 'Imprevistos (5,00 %)', 'Utilidad (5,00 %)', 'AIU', 'IVA (19,00 %)', 'VALOR TOTAL'].map(
        (c, i, todos) => (i === 0 ? 1 : filaDe(c) - filaDe(todos[i - 1]!)),
      ),
      [1, 1, 1, 1, 1, 1, 1, 1],
    );
  });

  test('sin el desglose de los APU: ni sus recursos ni sus rendimientos llegan al archivo (RF-PRE-31)', async () => {
    const todo = textos((await abrir(await generarExcel(vivo, null))).worksheets[0]!).join(' | ');
    assert.doesNotMatch(todo, /Concreto premezclado|Oficial de obra|Recurso ·/);
  });

  test('el encabezado lleva razón social, NIT y, en una versión, su número (RNF-20, RF-VER-07)', async () => {
    const delVivo = textos((await abrir(await generarExcel(vivo, null))).worksheets[0]!);
    const deLaVersion = textos((await abrir(await generarExcel(version1, null))).worksheets[0]!);
    assert.ok(delVivo.includes('Constructora Excel'));
    assert.ok(delVivo.includes('NIT 900000160-0'));
    assert.ok(deLaVersion.some((t) => /^Versión 1 · \d{2}\/\d{2}\/\d{4}$/.test(t)), 'la versión no dice su propia fecha');
    const deFebrero = structuredClone(version1);
    deFebrero.fotografia.generada.en = '2027-02-15T03:00:00+00:00';
    assert.ok(textos((await abrir(await generarExcel(deFebrero, null))).worksheets[0]!).includes('Versión 1 · 14/02/2027'));
    assert.ok(!delVivo.some((t) => t.startsWith('Versión')));
  });

  test('el logo entra cuando lo hay, y sin él el archivo igual se genera (RNF-20)', async () => {
    assert.equal((await abrir(await generarExcel(vivo, PNG_MINIMO))).worksheets[0]!.getImages().length, 1);
    assert.equal((await abrir(await generarExcel(vivo, null))).worksheets[0]!.getImages().length, 0);
  });

  test('con cero decimales de vista el valor se redondea una sola vez, al exportar', async () => {
    const sinDecimales = { ...vivo, formato: { ...vivo.formato, decimalesVista: 0 } };
    const hoja = (await abrir(await generarExcel(sinDecimales, null))).worksheets[0]!;
    const total = fila(hoja, 'VALOR TOTAL').getCell(6);
    assert.deepEqual([total.value, total.numFmt], [180590155, '#,##0']);
    assert.equal(fila(hoja, 'Administración (10 %)').getCell(6).value, 10549000);
  });
});
