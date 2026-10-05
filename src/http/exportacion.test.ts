import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import ExcelJS from 'exceljs';
import { activarPresupuesto } from '../infraestructura/basedatos/cicloDeVida.js';
import { crearPresupuesto, editarPorcentajes } from '../infraestructura/basedatos/presupuesto.js';
import { agregarCapitulo, agregarSubcapitulo } from '../infraestructura/basedatos/edt.js';
import { agregarActividad } from '../infraestructura/basedatos/actividad.js';
import { formatearNumero, redondear, type FormatoNumerico } from '../comun/formatoNumerico.js';
import { armarPresupuestoDeReferencia, type PresupuestoDeReferencia } from '../pruebas/presupuestoDeReferencia.js';
import { vencerSuscripcion } from '../pruebas/superusuario.js';
import { textoDePdf } from '../pruebas/textoDePdf.js';
import { VERSION_TERMINOS_DE_PRUEBA, clienteDePrueba, type Cuenta, CARPETA_LEGAL_DE_PRUEBA } from '../pruebas/clienteHttp.js';
import { construirServidor } from './servidor.js';

let app: FastifyInstance;
const { pedir, registrar, asistenteCon } = clienteDePrueba(() => app);

before(async () => {
  app = await construirServidor({ carpetaLegal: CARPETA_LEGAL_DE_PRUEBA, secretoSesion: randomBytes(32).toString('hex'), versionTerminos: VERSION_TERMINOS_DE_PRUEBA });
});
after(async () => {
  await app.close();
});

describe('exportar la oferta en PDF y Excel (02 §9.5, RF-PRE-29/30)', () => {
  let duena: Cuenta;
  let referencia: PresupuestoDeReferencia;

  before(async () => {
    duena = await registrar('Constructora Exporta HTTP', '900000360-0', 'exporta.http@construsoft.test');
    referencia = await armarPresupuestoDeReferencia(duena.contexto, 'EXP-HTTP');
  });

  test('el presupuesto vivo en PDF: el archivo, su nombre y la cifra de la referencia adentro', async () => {
    const r = await pedir(`/api/presupuestos/${referencia.presupuestoId}/exportar?formato=pdf`, duena.cookie);
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.headers['content-type'], 'application/pdf');
    assert.match(String(r.headers['content-disposition']), /^attachment; filename="EXP-HTTP\.pdf"/);
    assert.equal(r.rawPayload.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.match(textoDePdf(r.rawPayload).join(' '), /180\.590\.155/);
  });

  test('el presupuesto vivo en Excel', async () => {
    const r = await pedir(`/api/presupuestos/${referencia.presupuestoId}/exportar?formato=xlsx`, duena.cookie);
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.headers['content-type'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.match(String(r.headers['content-disposition']), /filename="EXP-HTTP\.xlsx"/);
    assert.equal(r.rawPayload.subarray(0, 2).toString('latin1'), 'PK');
  });

  test('sin formato, o uno que no existe: 422 en formato', async () => {
    for (const url of [`/api/presupuestos/${referencia.presupuestoId}/exportar`, `/api/presupuestos/${referencia.presupuestoId}/exportar?formato=doc`]) {
      const r = await pedir(url, duena.cookie);
      assert.deepEqual([r.statusCode, r.json<{ campo?: string }>().campo], [422, 'formato'], url);
    }
  });

  test('las versiones: el listado del 02 §10.1, y cada una se exporta con su número en el nombre', async () => {
    const p = await armarPresupuestoDeReferencia(duena.contexto, 'EXP-VER');
    await activarPresupuesto(duena.contexto, p.presupuestoId);
    const lista = await pedir(`/api/presupuestos/${p.presupuestoId}/versiones`, duena.cookie);
    assert.equal(lista.statusCode, 200, lista.body);
    const [v1] = lista.json<{ versiones: { id: string; numero: number; valorTotal: string; estado: string }[] }>().versiones;
    assert.deepEqual([v1!.numero, v1!.valorTotal, v1!.estado], [1, '180590155.000000', 'ACTIVO']);

    const r = await pedir(`/api/versiones/${v1!.id}/exportar?formato=pdf`, duena.cookie);
    assert.equal(r.statusCode, 200, r.body);
    assert.match(String(r.headers['content-disposition']), /filename="EXP-VER - Version 1\.pdf"; filename\*=UTF-8''EXP-VER%20-%20Versi%C3%B3n%201\.pdf/);
    assert.match(textoDePdf(r.rawPayload).join(' '), /Versión 1/);
  });

  test('sin PRESUPUESTOS.EXPORTAR: ver no alcanza para exportar', async () => {
    const lector = await asistenteCon(duena, 'exporta.lector@construsoft.test', ['PRESUPUESTOS.VER']);
    const r = await pedir(`/api/presupuestos/${referencia.presupuestoId}/exportar?formato=pdf`, lector);
    assert.equal(r.statusCode, 403);
    assert.match(r.json<{ mensaje: string }>().mensaje, /PRESUPUESTOS\.EXPORTAR/);
    assert.equal((await pedir(`/api/presupuestos/${referencia.presupuestoId}/versiones`, lector)).statusCode, 200);
  });

  test('con la suscripción vencida se exporta igual: los datos son de la empresa (D-65)', async () => {
    const vencida = await registrar('Constructora Exporta Vencida', '900000361-1', 'exporta.vencida@construsoft.test');
    const p = await armarPresupuestoDeReferencia(vencida.contexto, 'EXP-V');
    await vencerSuscripcion(vencida.contexto.tenantId);
    assert.equal((await pedir(`/api/presupuestos/${p.presupuestoId}/exportar?formato=pdf`, vencida.cookie)).statusCode, 200);
  });
});

interface MesaLeida {
  nodos: { codigoWbs: string; nombre: string; montoAcumulado: string }[];
  actividades: { codigoItem: string; descripcion: string; unidadSimbolo: string; cantidad: string; precioUnitario: string; costoTotal: string }[];
  pie: Record<'costoIndirecto' | 'costoDirecto' | 'administracion' | 'imprevistos' | 'utilidad' | 'aiu' | 'iva' | 'valorTotal', string> & {
    porcentajes: { a: string; i: string; u: string; iva: string };
  };
}

/** Las ocho líneas del pie como las rotulan el PDF y el Excel, con el valor que tiene la base. */
function pieEsperado(m: MesaLeida, f: FormatoNumerico): [string, string][] {
  const pct = (v: string) => `${formatearNumero(v, f)} %`;
  return [
    ['Total costo indirecto', m.pie.costoIndirecto],
    ['Total costo directo', m.pie.costoDirecto],
    [`Administración (${pct(m.pie.porcentajes.a)})`, m.pie.administracion],
    [`Imprevistos (${pct(m.pie.porcentajes.i)})`, m.pie.imprevistos],
    [`Utilidad (${pct(m.pie.porcentajes.u)})`, m.pie.utilidad],
    ['AIU', m.pie.aiu],
    [`IVA (${pct(m.pie.porcentajes.iva)})`, m.pie.iva],
    ['VALOR TOTAL', m.pie.valorTotal],
  ];
}

describe('las cifras de los archivos son las de la base, línea por línea (02 §9.5)', () => {
  test('un presupuesto con decimales en cantidades y porcentajes: el PDF y el Excel dicen exactamente lo que dice la mesa', async () => {
    const duena = await registrar('Constructora Cifras', '900000364-4', 'exporta.cifras@construsoft.test');
    const ref = await armarPresupuestoDeReferencia(duena.contexto, 'EXP-REF2');
    const apu = (d: string) => ref.actividades[d]!.apuId;
    const p = await crearPresupuesto(duena.contexto, { codigo: 'EXP-CIFRAS', nombre: 'Cifras', ubicacion: 'Envigado', modoEstructura: 'WBS' });
    const pre = await agregarCapitulo(duena.contexto, p.id, { nombre: 'PRELIMINARES', clasificacion: 'INDIRECTO' });
    await agregarActividad(duena.contexto, pre.id, apu('Director de obra'), '2.5');
    const obra = await agregarCapitulo(duena.contexto, p.id, { nombre: 'OBRA', clasificacion: 'DIRECTO' });
    await agregarActividad(duena.contexto, obra.id, ref.concreto.id, '12.345');
    const muros = await agregarSubcapitulo(duena.contexto, obra.id, { nombre: 'Muros' });
    await agregarActividad(duena.contexto, muros.id, apu('Acero de refuerzo 60.000 PSI'), '1037.125');
    await agregarActividad(duena.contexto, muros.id, apu('Formaleta metálica'), '0.5');
    await editarPorcentajes(duena.contexto, p.id, { aiuAdministracion: '7.5', aiuImprevistos: '3.25', aiuUtilidad: '6', ivaUtilidadPct: '19' });

    const mesa = (await pedir(`/api/presupuestos/${p.id}/mesa`, duena.cookie)).json<MesaLeida>();
    const formato = (await pedir('/api/sesion', duena.cookie)).json<{ formatoNumerico: FormatoNumerico }>().formatoNumerico;
    const f = (v: string) => formatearNumero(v, formato);

    // El PDF: cada fila es una secuencia de textos en el orden de las columnas.
    const pdf = textoDePdf((await pedir(`/api/presupuestos/${p.id}/exportar?formato=pdf`, duena.cookie)).rawPayload);
    const desde = (primero: string, cuantos: number) => pdf.slice(pdf.indexOf(primero), pdf.indexOf(primero) + cuantos);
    for (const n of mesa.nodos) assert.deepEqual(desde(n.codigoWbs, 3), [n.codigoWbs, n.nombre, f(n.montoAcumulado)]);
    for (const a of mesa.actividades) {
      assert.deepEqual(desde(a.codigoItem, 6), [a.codigoItem, a.descripcion, a.unidadSimbolo, f(a.cantidad), f(a.precioUnitario), f(a.costoTotal)]);
    }
    for (const [rotulo, valor] of pieEsperado(mesa, formato)) assert.deepEqual(desde(rotulo, 2), [rotulo, f(valor)]);

    // El Excel: los valores son números en la columna del total, redondeados una vez a los decimales de la empresa.
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load((await pedir(`/api/presupuestos/${p.id}/exportar?formato=xlsx`, duena.cookie)).rawPayload as never);
    const hoja = libro.worksheets[0]!;
    const filaDe = (primeraColumna: string) => {
      let encontrada: ExcelJS.Row | undefined;
      hoja.eachRow((fila) => {
        if (fila.getCell(1).value === primeraColumna) encontrada = fila;
      });
      assert.ok(encontrada, `el Excel no tiene la fila ${primeraColumna}`);
      return encontrada!;
    };
    const numero = (v: string) => Number(redondear(v, formato.decimalesVista));
    for (const a of mesa.actividades) {
      const fila = filaDe(a.codigoItem);
      assert.deepEqual(
        [fila.getCell(2).value, fila.getCell(4).value, fila.getCell(5).value, fila.getCell(6).value],
        [a.descripcion, numero(a.cantidad), numero(a.precioUnitario), numero(a.costoTotal)],
      );
    }
    for (const n of mesa.nodos) assert.equal(filaDe(n.codigoWbs).getCell(6).value, numero(n.montoAcumulado));
    for (const [rotulo, valor] of pieEsperado(mesa, formato)) assert.equal(filaDe(rotulo).getCell(6).value, numero(valor), rotulo);
  });
});

describe('aislamiento: no se exporta ni se lista lo de otra empresa (RN-01)', () => {
  test('presupuesto y versión de B responden el mismo 404 que lo inexistente', async () => {
    const a = await registrar('Constructora Exporta A', '900000362-2', 'exporta.http.a@construsoft.test');
    const b = await registrar('Constructora Exporta B', '900000363-3', 'exporta.http.b@construsoft.test');
    const deB = await armarPresupuestoDeReferencia(b.contexto, 'EXP-B');
    await activarPresupuesto(b.contexto, deB.presupuestoId);
    const versionDeB = (await pedir(`/api/presupuestos/${deB.presupuestoId}/versiones`, b.cookie)).json<{ versiones: { id: string }[] }>().versiones[0]!.id;

    for (const plantilla of ['/api/presupuestos/ID/exportar?formato=pdf', '/api/presupuestos/ID/versiones', '/api/versiones/ID/exportar?formato=pdf']) {
      const idDeB = plantilla.startsWith('/api/versiones') ? versionDeB : deB.presupuestoId;
      const ajeno = await pedir(plantilla.replace('ID', idDeB), a.cookie);
      assert.equal(ajeno.statusCode, 404, `${plantilla}: ${ajeno.body}`);
      for (const id of ['01900000-0000-7000-8000-000000000000', 'no-es-un-id']) {
        const otro = await pedir(plantilla.replace('ID', id), a.cookie);
        assert.deepEqual([otro.statusCode, otro.body], [ajeno.statusCode, ajeno.body], `${plantilla} con ${id}`);
      }
    }
  });
});
