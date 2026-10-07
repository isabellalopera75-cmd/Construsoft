import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { cifraDeCelda } from './celdas.js';
import { generarPlantillaDeApu, generarPlantillaDeRecursos } from './plantillas.js';
import { ArchivoNoValido, leerArchivoDeApu, leerArchivoDeRecursos } from './lectura.js';

const UNIDADES = [
  { id: 'u-kg', simbolo: 'Kg' },
  { id: 'u-m3', simbolo: 'm³' },
  { id: 'u-jr', simbolo: 'Jr' },
];
const CATALOGO = [
  { id: 'r-concreto', codigo: 'MAT-0001', tipo: 'MATERIAL' },
  { id: 'r-oficial', codigo: 'PER-0001', tipo: 'PERSONAL' },
];

/** La plantilla real, con filas escritas desde la fila 2 en la hoja dada. */
async function llenar(plantilla: Buffer, hojas: Record<string, unknown[][]>): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(plantilla as never);
  for (const [nombre, filas] of Object.entries(hojas)) {
    const hoja = libro.getWorksheet(nombre)!;
    filas.forEach((fila, i) => fila.forEach((valor, j) => (hoja.getCell(i + 2, j + 1).value = valor as ExcelJS.CellValue)));
  }
  return Buffer.from(await libro.xlsx.writeBuffer());
}

describe('cifraDeCelda: las cifras de Excel sin coma flotante (CONTRATO §10.2)', () => {
  test('el doble se lee por su representación corta y se redondea una vez a seis decimales', () => {
    assert.deepEqual(cifraDeCelda(0.1, 18), { texto: '0.100000' });
    assert.deepEqual(cifraDeCelda(0.1 + 0.2, 18), { texto: '0.300000' });
    assert.deepEqual(cifraDeCelda(1.0000005, 18), { texto: '1.000001' });
    assert.deepEqual(cifraDeCelda(1e-7, 18), { texto: '0.000000' });
    assert.deepEqual(cifraDeCelda(595000, 18), { texto: '595000.000000' });
    assert.deepEqual(cifraDeCelda('12.5', 18), { texto: '12.500000' });
  });

  test('lo que no es una cifra no negativa con las cifras enteras de su columna es un error', () => {
    for (const [valor, enteros] of [['doce mil', 18], ['1.500,50', 18], [-1, 18], ['-3', 18], [1000, 3], [Number.NaN, 18]] as const) {
      assert.ok('error' in cifraDeCelda(valor, enteros), String(valor));
    }
  });
});

describe('leerArchivoDeRecursos (CONTRATO §10.3)', () => {
  test('cada fila válida sale con su vía de captura deducida del precio que se llenó', async () => {
    const archivo = await llenar(await generarPlantillaDeRecursos(['Kg', 'm³']), {
      Recursos: [
        ['Cemento gris', 'Material', 'Kg', 30000, 19, null],
        ['Concreto 3000', 'material', 'M³', null, null, 595000],
      ],
    });
    const { recursos, errores } = await leerArchivoDeRecursos(archivo, UNIDADES);
    assert.deepEqual(errores, []);
    assert.deepEqual(recursos, [
      { fila: 2, nombre: 'Cemento gris', tipo: 'MATERIAL', unidadId: 'u-kg', viaCaptura: 'BASE', precio: '30000.000000', ivaPct: '19.000000' },
      { fila: 3, nombre: 'Concreto 3000', tipo: 'MATERIAL', unidadId: 'u-m3', viaCaptura: 'TOTAL', precio: '595000.000000', ivaPct: '0.000000' },
    ]);
  });

  test('todos los errores del archivo, con hoja, fila de Excel y columna; las filas vacías no cuentan', async () => {
    const archivo = await llenar(await generarPlantillaDeRecursos(['Kg']), {
      Recursos: [
        ['Bien', 'Equipo', 'Kg', 100, null, null],
        [null, null, null, null, null, null],
        ['Dos precios', 'Material', 'Kg', 100, 19, 119],
        ['Sin precio', 'Material', 'Kg', null, null, null],
        ['Unidad mala', 'Material', 'mts', 100, null, null],
        [null, 'Herramienta', 'Kg', 'doce mil', null, null],
      ],
    });
    const { recursos, errores } = await leerArchivoDeRecursos(archivo, UNIDADES);
    assert.deepEqual(recursos.map((r) => r.nombre), ['Bien']);
    assert.deepEqual(
      errores.map((e) => [e.fila, e.columna]),
      [
        [4, null],
        [5, null],
        [6, 'Unidad'],
        [7, 'Nombre'],
        [7, 'Tipo'],
        [7, 'Precio base (sin IVA)'],
      ],
    );
    assert.match(errores[0]!.mensaje, /uno solo de los dos precios/);
    assert.match(errores[2]!.mensaje, /«mts» no existe/);
    assert.ok(errores.every((e) => e.hoja === 'Recursos'));
  });

  test('un archivo que no es un .xlsx, o sin la hoja, o con otras columnas, no se lee', async () => {
    await assert.rejects(leerArchivoDeRecursos(Buffer.from('nombre;tipo\n'), UNIDADES), ArchivoNoValido);
    const otro = new ExcelJS.Workbook();
    otro.addWorksheet('Hoja1').addRow(['Nombre', 'Tipo']);
    await assert.rejects(leerArchivoDeRecursos(Buffer.from(await otro.xlsx.writeBuffer()), UNIDADES), /no trae la hoja «Recursos»/);
    const columnasMovidas = new ExcelJS.Workbook();
    columnasMovidas.addWorksheet('Recursos').addRow(['Tipo', 'Nombre']);
    await assert.rejects(leerArchivoDeRecursos(Buffer.from(await columnasMovidas.xlsx.writeBuffer()), UNIDADES), /no tiene las columnas/);
  });
});

describe('leerArchivoDeApu (CONTRATO §10.4)', () => {
  const plantilla = () =>
    generarPlantillaDeApu(['Kg', 'm³'], [{ codigo: 'MAT-0001', nombre: 'Concreto', tipo: 'MATERIAL', unidadSimbolo: 'm³', precioTotal: '595000.000000' }]);

  test('los APU con sus líneas unidas por la clave; cantidad y rendimiento vacíos son 1', async () => {
    const archivo = await llenar(await plantilla(), {
      APU: [['A1', 'Concreto para zapatas', 'm³']],
      Composición: [
        ['A1', 'MAT-0001', 1, 1, 5],
        ['a1', 'per-0001', 2, 0.05, null],
        ['A1', 'MAT-0001', null, null, null],
      ],
    });
    const { apus, errores } = await leerArchivoDeApu(archivo, UNIDADES, CATALOGO);
    assert.deepEqual(errores, []);
    assert.deepEqual(apus, [
      {
        fila: 2,
        nombre: 'Concreto para zapatas',
        unidadId: 'u-m3',
        lineas: [
          { fila: 2, recursoId: 'r-concreto', cantidad: '1.000000', rendimiento: '1.000000', desperdicioPct: '5.000000' },
          { fila: 3, recursoId: 'r-oficial', cantidad: '2.000000', rendimiento: '0.050000', desperdicioPct: '0.000000' },
          { fila: 4, recursoId: 'r-concreto', cantidad: '1.000000', rendimiento: '1.000000', desperdicioPct: '0.000000' },
        ],
      },
    ]);
  });

  test('clave repetida, línea sin APU, recurso inexistente, cero, desperdicio fuera de material y APU sin líneas', async () => {
    const archivo = await llenar(await plantilla(), {
      APU: [
        ['A1', 'Bien', 'm³'],
        ['A1', 'Repetida', 'm³'],
        ['A2', 'Sin líneas', 'Kg'],
      ],
      Composición: [
        ['A1', 'MAT-0001', 1, 1, null],
        ['A9', 'MAT-0001', 1, 1, null],
        ['A1', 'NO-EXISTE', 1, 1, null],
        ['A1', 'MAT-0001', 1, 0, null],
        ['A1', 'PER-0001', 1, 1, 3],
      ],
    });
    const { apus, errores } = await leerArchivoDeApu(archivo, UNIDADES, CATALOGO);
    assert.deepEqual(
      errores.map((e) => [e.hoja, e.fila, e.columna]),
      [
        ['APU', 3, 'Clave'],
        ['APU', 4, null],
        ['Composición', 3, 'Clave del APU'],
        ['Composición', 4, 'Código del recurso'],
        ['Composición', 5, 'Rendimiento'],
        ['Composición', 6, 'Desperdicio %'],
      ],
    );
    assert.match(errores[0]!.mensaje, /ya la usa la fila 2/);
    assert.match(errores[1]!.mensaje, /no tiene líneas/);
    assert.match(errores[4]!.mensaje, /no puede ser cero/);
    assert.match(errores[5]!.mensaje, /no es un material/);
    assert.deepEqual(apus, []);
  });
});
