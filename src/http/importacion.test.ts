import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import ExcelJS from 'exceljs';
import type { FastifyInstance } from 'fastify';
import { crearRecurso } from '../infraestructura/basedatos/recurso.js';
import { vencerSuscripcion } from '../pruebas/superusuario.js';
import { VERSION_TERMINOS_DE_PRUEBA, CARPETA_LEGAL_DE_PRUEBA, clienteDePrueba, type Cuenta } from '../pruebas/clienteHttp.js';
import { construirServidor } from './servidor.js';

let app: FastifyInstance;
const { otraIp, pedir, registrar, asistenteCon } = clienteDePrueba(() => app);

before(async () => {
  app = await construirServidor({ carpetaLegal: CARPETA_LEGAL_DE_PRUEBA, secretoSesion: randomBytes(32).toString('hex'), versionTerminos: VERSION_TERMINOS_DE_PRUEBA });
});
after(async () => {
  await app.close();
});

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function subir(url: string, cookie: string, archivo: Buffer, tipo = XLSX) {
  const r = await app.inject({ method: 'POST', url, remoteAddress: otraIp(), headers: { cookie, 'content-type': tipo }, payload: archivo });
  return { estado: r.statusCode, cuerpo: r.json<{ mensaje?: string; creados?: number; errores?: { hoja: string; fila: number; columna: string | null; mensaje: string }[] }>(), crudo: r.body };
}

/** Descarga la plantilla por la API y escribe filas desde la fila 2. */
async function plantillaLlena(url: string, cookie: string, hojas: Record<string, unknown[][]>): Promise<Buffer> {
  const r = await pedir(url, cookie);
  assert.equal(r.statusCode, 200, r.body);
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(r.rawPayload as never);
  for (const [nombre, filas] of Object.entries(hojas)) {
    const hoja = libro.getWorksheet(nombre)!;
    filas.forEach((fila, i) => fila.forEach((valor, j) => (hoja.getCell(i + 2, j + 1).value = valor as ExcelJS.CellValue)));
  }
  return Buffer.from(await libro.xlsx.writeBuffer());
}

const nombres = async (cookie: string, url: string, clave: string) =>
  ((await pedir(url, cookie)).json<Record<string, { nombre: string }[]>>()[clave] ?? []).map((x) => x.nombre).sort();

describe('importar recursos desde Excel (CONTRATO §10.3)', () => {
  let duena: Cuenta;

  before(async () => {
    duena = await registrar('Constructora Importa', '900000390-0', 'importa.admin@construsoft.test');
  });

  test('la plantilla: un .xlsx con Instrucciones, Recursos y la lista de unidades de la empresa', async () => {
    const r = await pedir('/api/recursos/plantilla', duena.cookie);
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.headers['content-type'], XLSX);
    assert.match(String(r.headers['content-disposition']), /Plantilla de recursos\.xlsx/);
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(r.rawPayload as never);
    assert.deepEqual(libro.worksheets.map((h) => h.name), ['Instrucciones', 'Recursos', 'Listas']);
    const listas = libro.getWorksheet('Listas')!;
    assert.ok([...Array(12).keys()].map((i) => listas.getCell(i + 1, 2).value).includes('m³'));
  });

  test('todo entra: el código lo pone la base y el precio que falta lo calcula ella con el IVA', async () => {
    const archivo = await plantillaLlena('/api/recursos/plantilla', duena.cookie, {
      Recursos: [
        ['Cemento gris 50 kg', 'Material', 'Kg', 30000, 19, null],
        ['Oficial', 'Personal', 'Jr', null, null, 120000],
        ['Arena', 'Material', 'm³', null, 19, 119],
      ],
    });
    const r = await subir('/api/recursos/importar', duena.cookie, archivo);
    assert.deepEqual([r.estado, r.cuerpo], [201, { creados: 3 }], r.crudo);
    const lista = (await pedir('/api/recursos', duena.cookie)).json<{ recursos: { nombre: string; codigo: string; precioBase: string; precioTotal: string; viaCaptura: string }[] }>().recursos;
    const por = Object.fromEntries(lista.map((x) => [x.nombre, x]));
    assert.deepEqual([por['Cemento gris 50 kg']!.precioTotal, por['Cemento gris 50 kg']!.viaCaptura], ['35700.000000', 'BASE']);
    assert.deepEqual([por['Arena']!.precioBase, por['Arena']!.viaCaptura], ['100.000000', 'TOTAL']);
    assert.ok(lista.every((x) => /\d/.test(x.codigo)));
  });

  test('todo o nada: una fila mala y no entra ninguna, con todos los errores por hoja, fila y columna', async () => {
    const antes = await nombres(duena.cookie, '/api/recursos', 'recursos');
    const archivo = await plantillaLlena('/api/recursos/plantilla', duena.cookie, {
      Recursos: [
        ['Bloque', 'Material', 'Und', 2500, 19, null],
        ['Dos precios', 'Material', 'Und', 100, 19, 119],
        ['Unidad inventada', 'Material', 'mts', 100, null, null],
      ],
    });
    const r = await subir('/api/recursos/importar', duena.cookie, archivo);
    assert.equal(r.estado, 422, r.crudo);
    assert.match(r.cuerpo.mensaje!, /2 errores y no se importó nada/);
    assert.deepEqual(r.cuerpo.errores!.map((e) => [e.hoja, e.fila, e.columna]), [
      ['Recursos', 3, null],
      ['Recursos', 4, 'Unidad'],
    ]);
    assert.deepEqual(await nombres(duena.cookie, '/api/recursos', 'recursos'), antes);
  });

  test('un rechazo de la base dentro de la transacción vuelve como error de su fila, y no entra nada', async () => {
    const antes = await nombres(duena.cookie, '/api/recursos', 'recursos');
    // El precio base cabe; el total, con 999 % de IVA, desborda numeric(24,6).
    const archivo = await plantillaLlena('/api/recursos/plantilla', duena.cookie, {
      Recursos: [
        ['Bien', 'Equipo', 'Und', 10, null, null],
        ['Desborda', 'Material', 'Und', '999999999999999999', 999, null],
      ],
    });
    const r = await subir('/api/recursos/importar', duena.cookie, archivo);
    assert.equal(r.estado, 422, r.crudo);
    assert.deepEqual(r.cuerpo.errores!.map((e) => [e.hoja, e.fila]), [['Recursos', 3]]);
    assert.match(r.cuerpo.errores![0]!.mensaje, /demasiado grande/);
    assert.deepEqual(await nombres(duena.cookie, '/api/recursos', 'recursos'), antes);
  });

  test('un nombre que ya existe en el catálogo, o que se repite en el archivo, es error de su fila', async () => {
    const antes = await nombres(duena.cookie, '/api/recursos', 'recursos');
    const archivo = await plantillaLlena('/api/recursos/plantilla', duena.cookie, {
      Recursos: [
        ['CEMENTO GRIS 50 KG', 'Material', 'Kg', 30000, 19, null],
        ['Ladrillo tolete', 'Material', 'Und', 900, 19, null],
        ['ladrillo TOLETE ', 'Material', 'Und', 950, 19, null],
      ],
    });
    const r = await subir('/api/recursos/importar', duena.cookie, archivo);
    assert.equal(r.estado, 422, r.crudo);
    assert.deepEqual(r.cuerpo.errores!.map((e) => [e.fila, e.columna]), [
      [2, 'Nombre'],
      [4, 'Nombre'],
    ]);
    assert.match(r.cuerpo.errores![0]!.mensaje, /Ya existe un recurso llamado «Cemento gris 50 kg»/);
    assert.match(r.cuerpo.errores![1]!.mensaje, /repite el nombre de la fila 3/);
    assert.deepEqual(await nombres(duena.cookie, '/api/recursos', 'recursos'), antes);
  });

  test('lo que no es un .xlsx es 422 sin lista; más de 2 MB es 413', async () => {
    const texto = await subir('/api/recursos/importar', duena.cookie, Buffer.from('nombre;tipo\nCemento;Material\n'), 'text/csv');
    assert.equal(texto.estado, 422);
    assert.equal(texto.cuerpo.errores, undefined);
    assert.match(texto.cuerpo.mensaje!, /no es un Excel/);
    const grande = await subir('/api/recursos/importar', duena.cookie, Buffer.alloc(2 * 1024 * 1024 + 1, 1));
    assert.equal(grande.estado, 413);
    assert.match(grande.cuerpo.mensaje!, /2 MB/);
  });

  test('sin RECURSOS.CREAR: ni la plantilla ni la importación (403); sin sesión, 401', async () => {
    const lector = await asistenteCon(duena, 'importa.lector@construsoft.test', ['RECURSOS.VER']);
    assert.equal((await pedir('/api/recursos/plantilla', lector)).statusCode, 403);
    const archivo = await plantillaLlena('/api/recursos/plantilla', duena.cookie, { Recursos: [['X', 'Material', 'Kg', 1, null, null]] });
    const r = await subir('/api/recursos/importar', lector, archivo);
    assert.equal(r.estado, 403);
    assert.match(r.cuerpo.mensaje!, /RECURSOS\.CREAR/);
    assert.equal((await pedir('/api/recursos/plantilla')).statusCode, 401);
  });
});

describe('importar APU desde Excel (CONTRATO §10.4)', () => {
  let duena: Cuenta;
  let codigoConcreto: string;
  let codigoOficial: string;

  before(async () => {
    duena = await registrar('Constructora Importa APU', '900000391-1', 'importa.apu@construsoft.test');
    const unidades = (await pedir('/api/unidades', duena.cookie)).json<{ unidades: { id: string; simbolo: string }[] }>().unidades;
    const u = Object.fromEntries(unidades.map((x) => [x.simbolo, x.id]));
    codigoConcreto = (await crearRecurso(duena.contexto, { nombre: 'Concreto premezclado', tipo: 'MATERIAL', unidadId: u['m³']!, precioBase: '500000', ivaPct: '19', precioTotal: '595000', viaCaptura: 'BASE' })).codigo;
    codigoOficial = (await crearRecurso(duena.contexto, { nombre: 'Oficial', tipo: 'PERSONAL', unidadId: u['Jr']!, precioBase: '120000', ivaPct: '0', precioTotal: '120000', viaCaptura: 'BASE' })).codigo;
  });

  test('la plantilla trae el catálogo de recursos de la empresa como consulta', async () => {
    const r = await pedir('/api/apus/plantilla', duena.cookie);
    assert.equal(r.statusCode, 200, r.body);
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(r.rawPayload as never);
    assert.deepEqual(libro.worksheets.map((h) => h.name), ['Instrucciones', 'APU', 'Composición', 'Recursos', 'Listas']);
    const codigos = [2, 3].map((fila) => libro.getWorksheet('Recursos')!.getCell(fila, 1).value).sort();
    assert.deepEqual(codigos, [codigoConcreto, codigoOficial].sort());
  });

  test('el APU del 06 §8.2 entra con su composición, y su costo directo lo calcula la base: 636.750', async () => {
    const archivo = await plantillaLlena('/api/apus/plantilla', duena.cookie, {
      APU: [['A1', 'Concreto 3000 PSI para zapatas', 'm³']],
      Composición: [
        ['A1', codigoConcreto, 1, 1, 5],
        ['A1', codigoOficial, 2, 0.05, null],
      ],
    });
    const r = await subir('/api/apus/importar', duena.cookie, archivo);
    assert.deepEqual([r.estado, r.cuerpo], [201, { creados: 1 }], r.crudo);
    const apus = (await pedir('/api/apus', duena.cookie)).json<{ apus: { nombre: string; costoDirecto: string }[] }>().apus;
    assert.deepEqual(apus.map((a) => [a.nombre, a.costoDirecto]), [['Concreto 3000 PSI para zapatas', '636750.000000']]);
  });

  test('un código de recurso de otra empresa da el mismo error que uno que no existe (RN-01), y no entra nada', async () => {
    const otra = await registrar('Constructora Importa B', '900000392-2', 'importa.b@construsoft.test');
    const unidadesB = (await pedir('/api/unidades', otra.cookie)).json<{ unidades: { id: string; simbolo: string }[] }>().unidades;
    // Los códigos son una secuencia por empresa (REC-0001, REC-0002…): el
    // primer recurso de B se llama igual que el de A. El tercero de B no
    // existe en A, que tiene dos.
    let deB = { codigo: '' };
    for (let i = 1; i <= 3; i += 1) {
      deB = await crearRecurso(otra.contexto, { nombre: `De B ${i}`, tipo: 'MATERIAL', unidadId: unidadesB[0]!.id, precioBase: '1', ivaPct: '0', precioTotal: '1', viaCaptura: 'BASE' });
    }
    const conCodigo = async (codigo: string) =>
      subir('/api/apus/importar', duena.cookie, await plantillaLlena('/api/apus/plantilla', duena.cookie, {
        APU: [['A1', 'Con recurso ajeno', 'm³']],
        Composición: [['A1', codigo, 1, 1, null]],
      }));
    assert.ok(![codigoConcreto, codigoOficial].includes(deB.codigo));
    const ajeno = await conCodigo(deB.codigo);
    const inexistente = await conCodigo('NO-EXISTE');
    assert.equal(ajeno.estado, 422);
    assert.deepEqual(
      ajeno.cuerpo.errores!.map((e) => [e.hoja, e.fila, e.columna, e.mensaje.replace(deB.codigo, 'X')]),
      inexistente.cuerpo.errores!.map((e) => [e.hoja, e.fila, e.columna, e.mensaje.replace('NO-EXISTE', 'X')]),
    );
    assert.deepEqual(await nombres(duena.cookie, '/api/apus', 'apus'), ['Concreto 3000 PSI para zapatas']);
  });

  test('sin APU.CREAR: 403; con la suscripción vencida: 402', async () => {
    const lector = await asistenteCon(duena, 'importa.apu.lector@construsoft.test', ['APU.VER', 'RECURSOS.VER']);
    assert.equal((await pedir('/api/apus/plantilla', lector)).statusCode, 403);
    const vencida = await registrar('Constructora Importa Vencida', '900000393-3', 'importa.vencida@construsoft.test');
    await vencerSuscripcion(vencida.contexto.tenantId);
    assert.equal((await pedir('/api/apus/plantilla', vencida.cookie)).statusCode, 402);
  });
});
