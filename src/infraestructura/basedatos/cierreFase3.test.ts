import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { registrarEmpresa, type ContextoTenant } from './contextoTenant.js';
import type { Apu } from './apu.js';
import { crearPresupuesto, editarPorcentajes, leerPresupuesto } from './presupuesto.js';
import { agregarCapitulo, leerEdt } from './edt.js';
import { agregarActividad, leerActividades } from './actividad.js';
import { armarPresupuestoDeReferencia } from '../../pruebas/presupuestoDeReferencia.js';

/**
 * El hito de la fase 3 (CLAUDE.md, «Antes de dar algo por terminado»): el
 * presupuesto de referencia del documento 06 §8 —Casa campestre El Retiro—
 * construido desde cero con los módulos de la mesa de trabajo, sin una sola
 * fila escrita a mano, tiene que cerrar exactamente en $180.590.155. El
 * armado vive en src/pruebas/presupuestoDeReferencia.ts, compartido con los
 * cierres de las fases siguientes.
 */

let contexto: ContextoTenant;

describe('cierre de la fase 3: el presupuesto de referencia (06 §8)', () => {
  let presupuestoId: string;
  let concreto: Apu;

  before(async () => {
    const empresa = await registrarEmpresa({
      razonSocial: 'Constructora El Retiro',
      nit: '900000080-0',
      plan: 'EMPRESARIAL',
      adminNombre: 'Ingeniera de El Retiro',
      adminEmail: 'cierre.retiro@construsoft.test',
      adminHash: 'hash_de_prueba_no_real',
      versionTerminos: 'terminos-de-prueba',
    });
    contexto = { tenantId: empresa.tenantId, usuarioId: empresa.usuarioId };
    const referencia = await armarPresupuestoDeReferencia(contexto, 'PRE-RETIRO');
    presupuestoId = referencia.presupuestoId;
    concreto = referencia.concreto;
  });

  test('06 §8.2 · el APU del concreto cuesta exactamente 636.750 por m³', () => {
    assert.equal(concreto.costoDirecto, '636750.000000');
  });

  test('06 §8.3 · cada actividad con su número de ítem y su costo total', async () => {
    assert.deepEqual(
      (await leerActividades(contexto, presupuestoId)).map((a) => [a.codigoItem, a.descripcion, a.costoTotal]),
      [
        ['1.1', 'Topografía y replanteo', '3200000.000000'],
        ['1.2', 'Estudio de suelos', '4800000.000000'],
        ['1.3', 'Director de obra', '45000000.000000'],
        ['2.1', 'Excavación manual', '4620000.000000'],
        ['2.2', 'Concreto 3000 PSI para zapatas', '63675000.000000'],
        ['3.1', 'Acero de refuerzo 60.000 PSI', '30825000.000000'],
        ['3.2', 'Formaleta metálica', '6370000.000000'],
      ],
    );
  });

  test('06 §8.4 · el pie financiero cierra en $180.590.155', async () => {
    const p = (await leerPresupuesto(contexto, presupuestoId))!;
    assert.deepEqual(
      {
        costoDirecto: p.totalCostoDirecto,
        administracion: p.totalAdministracion,
        imprevistos: p.totalImprevistos,
        utilidad: p.totalUtilidad,
        aiu: p.totalAiu,
        iva: p.totalIva,
        costoIndirecto: p.totalCostoIndirecto,
        valorTotal: p.valorTotal,
        sinBaseAiu: p.sinBaseAiu,
      },
      {
        costoDirecto: '105490000.000000',
        administracion: '10549000.000000',
        imprevistos: '5274500.000000',
        utilidad: '5274500.000000',
        aiu: '21098000.000000',
        iva: '1002155.000000',
        costoIndirecto: '53000000.000000',
        valorTotal: '180590155.000000',
        sinBaseAiu: false,
      },
    );
  });

  test('06 §8.5 · montos e incidencias: 50,24 % el indirecto, 64,74 % y 35,26 % los directos', async () => {
    const edt = await leerEdt(contexto, presupuestoId);
    assert.deepEqual(
      edt.map((n) => [n.codigoWbs, n.nombre, n.clasificacion, n.montoAcumulado]),
      [
        ['1.0', 'PRELIMINARES', 'INDIRECTO', '53000000.000000'],
        ['2.0', 'CIMENTACIÓN', 'DIRECTO', '68295000.000000'],
        ['3.0', 'ESTRUCTURA', 'DIRECTO', '37195000.000000'],
      ],
    );
    // Precisión completa, sin redondear (06 §2.2): la pantalla redondea al mostrar.
    // 53.000.000 ÷ 105.490.000 × 100 = 50,2417…  ·  68.295.000 ÷ … = 64,7407…  ·  37.195.000 ÷ … = 35,2592…
    assert.match(edt[0]!.incidenciaPct!, /^50\.2417/);
    assert.match(edt[1]!.incidenciaPct!, /^64\.7407/);
    assert.match(edt[2]!.incidenciaPct!, /^35\.2592/);
  });

  test('06 §9 caso 13b · solo capítulos indirectos: incidencia null, no un error ni un cero; y el aviso de RF-PRE-36', async () => {
    const soloIndirectos = await crearPresupuesto(contexto, {
      codigo: 'PRE-SOLO-INDIRECTOS',
      nombre: 'Interventoría mal clasificada',
      ubicacion: 'El Retiro, Antioquia',
      modoEstructura: 'ITEMS',
    });
    const capitulo = await agregarCapitulo(contexto, soloIndirectos.id, {
      nombre: 'EQUIPO PROFESIONAL',
      clasificacion: 'INDIRECTO',
    });
    const director = (await leerActividades(contexto, presupuestoId)).find((a) => a.descripcion === 'Director de obra')!;
    await agregarActividad(contexto, capitulo.id, director.apuId, '6');
    const p = (await editarPorcentajes(contexto, soloIndirectos.id, {
      aiuAdministracion: '10',
      aiuImprevistos: '5',
      aiuUtilidad: '5',
      ivaUtilidadPct: '19',
    }))!;

    assert.deepEqual(
      (await leerEdt(contexto, soloIndirectos.id)).map((n) => [n.codigoWbs, n.montoAcumulado, n.incidenciaPct]),
      [['1.0', '45000000.000000', null]],
    );
    assert.deepEqual(
      { cd: p.totalCostoDirecto, aiu: p.totalAiu, total: p.valorTotal, sinBaseAiu: p.sinBaseAiu },
      { cd: '0.000000', aiu: '0.000000', total: '45000000.000000', sinBaseAiu: true },
    );
  });
});
