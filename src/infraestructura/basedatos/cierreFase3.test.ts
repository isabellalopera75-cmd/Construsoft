import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ejecutarConPermiso,
  registrarEmpresa,
  type ContextoTenant,
  type EmpresaRegistrada,
} from './contextoTenant.js';
import { crearRecurso, type Recurso } from './recurso.js';
import { crearApu, type Apu } from './apu.js';
import { crearPresupuesto, editarPorcentajes, leerPresupuesto } from './presupuesto.js';
import { agregarCapitulo, leerEdt } from './edt.js';
import { agregarActividad, leerActividades } from './actividad.js';

/**
 * El hito de la fase 3 (CLAUDE.md, «Antes de dar algo por terminado»): el
 * presupuesto de referencia del documento 06 §8 —Casa campestre El Retiro—
 * construido desde cero con los módulos de la mesa de trabajo, sin una sola
 * fila escrita a mano, tiene que cerrar exactamente en $180.590.155.
 *
 * Solo el concreto tiene composición documentada (06 §8.2) y se arma con ella:
 * es el que ejercita D-1 (precio con IVA, desperdicio, cantidad × rendimiento).
 * Para las demás actividades el documento da el valor y la cantidad; su APU es
 * un solo recurso cuyo precio es el precio unitario que resulta.
 */

let empresa: EmpresaRegistrada;
let contexto: ContextoTenant;

async function unidad(simbolo: string): Promise<string> {
  return ejecutarConPermiso(contexto, 'CONFIG.PREFERENCIAS', async (cliente) => {
    const { rows } = await cliente.query<{ id: string }>(
      'SELECT id FROM app.unidad_medida WHERE tenant_id = $1 AND simbolo = $2',
      [empresa.tenantId, simbolo],
    );
    return rows[0]!.id;
  });
}

async function recursoSinIva(nombre: string, simbolo: string, precio: string): Promise<Recurso> {
  return crearRecurso(contexto, {
    nombre,
    tipo: 'PERSONAL',
    unidadId: await unidad(simbolo),
    precioBase: precio,
    ivaPct: '0',
    precioTotal: precio,
    viaCaptura: 'BASE',
  });
}

/** Un APU de un solo recurso: su costo directo es el precio unitario de la actividad. */
async function apuDePrecio(nombre: string, simbolo: string, precio: string): Promise<Apu> {
  const recurso = await recursoSinIva(`Recurso · ${nombre}`, simbolo, precio);
  return crearApu(contexto, {
    nombre,
    unidadId: await unidad(simbolo),
    lineas: [{ recursoId: recurso.id, cantidad: '1', rendimiento: '1', desperdicioPct: '0' }],
  });
}

describe('cierre de la fase 3: el presupuesto de referencia (06 §8)', () => {
  let presupuestoId: string;
  let concreto: Apu;

  before(async () => {
    empresa = await registrarEmpresa({
      razonSocial: 'Constructora El Retiro',
      nit: '900000080-0',
      plan: 'EMPRESARIAL',
      adminNombre: 'Ingeniera de El Retiro',
      adminEmail: 'cierre.retiro@construsoft.test',
      adminHash: 'hash_de_prueba_no_real',
    });
    contexto = { tenantId: empresa.tenantId, usuarioId: empresa.usuarioId };

    // 06 §8.1 · Los dos recursos documentados.
    const premezclado = await crearRecurso(contexto, {
      nombre: 'Concreto premezclado 3000 PSI',
      tipo: 'MATERIAL',
      unidadId: await unidad('m³'),
      precioBase: '500000',
      ivaPct: '19',
      precioTotal: '595000',
      viaCaptura: 'BASE',
    });
    const oficial = await recursoSinIva('Oficial de obra', 'Jr', '120000');

    // 06 §8.2 · 1 × 1,00 × 1,05 × 595.000 + 2 × 0,05 × 1 × 120.000 = 636.750.
    concreto = await crearApu(contexto, {
      nombre: 'Concreto 3000 PSI para zapatas',
      unidadId: await unidad('m³'),
      lineas: [
        { recursoId: premezclado.id, cantidad: '1', rendimiento: '1', desperdicioPct: '5' },
        { recursoId: oficial.id, cantidad: '2', rendimiento: '0.05', desperdicioPct: '0' },
      ],
    });

    const topografia = await apuDePrecio('Topografía y replanteo', 'Glb', '3200000');
    const suelos = await apuDePrecio('Estudio de suelos', 'Glb', '4800000');
    const director = await apuDePrecio('Director de obra', 'Ms', '7500000');
    const excavacion = await apuDePrecio('Excavación manual', 'm³', '38500');
    const acero = await apuDePrecio('Acero de refuerzo 60.000 PSI', 'Kg', '6850');
    const formaleta = await apuDePrecio('Formaleta metálica', 'm²', '18200');

    // 06 §8.3 · Casa campestre El Retiro, por ítems: capítulo → actividad.
    const presupuesto = await crearPresupuesto(contexto, {
      codigo: 'PRE-RETIRO',
      nombre: 'Casa campestre El Retiro',
      ubicacion: 'El Retiro, Antioquia',
      modoEstructura: 'ITEMS',
    });
    presupuestoId = presupuesto.id;

    const preliminares = await agregarCapitulo(contexto, presupuestoId, {
      nombre: 'PRELIMINARES',
      clasificacion: 'INDIRECTO',
    });
    await agregarActividad(contexto, preliminares.id, topografia.id, '1');
    await agregarActividad(contexto, preliminares.id, suelos.id, '1');
    await agregarActividad(contexto, preliminares.id, director.id, '6');

    const cimentacion = await agregarCapitulo(contexto, presupuestoId, {
      nombre: 'CIMENTACIÓN',
      clasificacion: 'DIRECTO',
    });
    await agregarActividad(contexto, cimentacion.id, excavacion.id, '120');
    await agregarActividad(contexto, cimentacion.id, concreto.id, '100');

    const estructura = await agregarCapitulo(contexto, presupuestoId, {
      nombre: 'ESTRUCTURA',
      clasificacion: 'DIRECTO',
    });
    await agregarActividad(contexto, estructura.id, acero.id, '4500');
    await agregarActividad(contexto, estructura.id, formaleta.id, '350');

    // 06 §8.4 · AIU 10/5/5 e IVA 19 % sobre la utilidad.
    await editarPorcentajes(contexto, presupuestoId, {
      aiuAdministracion: '10',
      aiuImprevistos: '5',
      aiuUtilidad: '5',
      ivaUtilidadPct: '19',
    });
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
