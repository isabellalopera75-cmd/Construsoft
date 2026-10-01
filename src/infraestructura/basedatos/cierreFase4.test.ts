import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { registrarEmpresa, type ContextoTenant } from './contextoTenant.js';
import { actualizarRecurso } from './recurso.js';
import { leerPresupuesto } from './presupuesto.js';
import { cambiarCantidad, leerActividades } from './actividad.js';
import { activarPresupuesto, eliminarPresupuesto, reabrirPresupuesto } from './cicloDeVida.js';
import { leerVersion, listarVersiones } from './versiones.js';
import { listarHistorial } from './historial.js';
import { duplicarPresupuesto, leerPieConApuVigentes, listarApusDesactualizados } from './duplicar.js';
import { armarPresupuestoDeReferencia, type PresupuestoDeReferencia } from '../../pruebas/presupuestoDeReferencia.js';

/**
 * El hito de la fase 4: el ciclo de vida completo sobre el presupuesto de
 * referencia (06 §8), de principio a fin y en orden. Cada cifra esperada está
 * calculada a mano, fuera de la base:
 *
 *   · Línea base: 180.590.155.
 *   · El oficial sube de 120.000 a 130.000 → el concreto pasa a
 *     1 × 1 × 1,05 × 595.000 + 2 × 0,05 × 130.000 = 637.750, +1.000 por m³.
 *     La línea base NO se mueve.
 *   · Reapertura y excavación de 120 a 130 m³ (+385.000 de costo directo), sin
 *     tocar el concreto: CD 105.875.000 → A 10.587.500, I 5.293.750,
 *     U 5.293.750, IVA 1.005.812,5 → 181.055.812,5.
 *   · Copia con los APU al día: CD 105.975.000 → A 10.597.500, I 5.298.750,
 *     U 5.298.750, IVA 1.006.762,5 → 181.176.762,5.
 */

let contexto: ContextoTenant;
let referencia: PresupuestoDeReferencia;
let id: string;

const valor = async (presupuestoId: string) => (await leerPresupuesto(contexto, presupuestoId))!.valorTotal;

describe('cierre de la fase 4: el ciclo de vida del presupuesto de referencia', () => {
  before(async () => {
    const empresa = await registrarEmpresa({
      razonSocial: 'Constructora El Retiro Ciclo',
      nit: '900000081-1',
      plan: 'EMPRESARIAL',
      adminNombre: 'Ingeniera del ciclo',
      adminEmail: 'cierre4.retiro@construsoft.test',
      adminHash: 'hash_de_prueba_no_real',
      versionTerminos: 'terminos-de-prueba',
    });
    contexto = { tenantId: empresa.tenantId, usuarioId: empresa.usuarioId };
    referencia = await armarPresupuestoDeReferencia(contexto, 'PRE-RETIRO-CICLO');
    id = referencia.presupuestoId;
  });

  test('1 · activar congela la línea base en 180.590.155 y la guarda como versión 1', async () => {
    await activarPresupuesto(contexto, id);
    assert.equal(await valor(id), '180590155.000000');
    const [v1] = await listarVersiones(contexto, id);
    assert.deepEqual([v1!.numero, v1!.disparador, v1!.valorTotal], [1, 'ABIERTO_A_ACTIVO', '180590155.000000']);
  });

  test('2 · subir el precio de un recurso no mueve la línea base ni un céntimo; el concreto queda desactualizado', async () => {
    await actualizarRecurso(contexto, referencia.oficial.id, {
      ...referencia.oficial,
      precioBase: '130000',
      precioTotal: '130000',
    });
    assert.equal(await valor(id), '180590155.000000');
    assert.deepEqual(
      (await listarApusDesactualizados(contexto, id)).map((d) => [d.descripcion, d.precioEnElPresupuesto, d.precioVigente]),
      [['Concreto 3000 PSI para zapatas', '636750.000000', '637750.000000']],
    );
  });

  test('3 · reabrir con justificación, corregir una cantidad y reactivar: la versión 3 es la nueva línea base', async () => {
    await reabrirPresupuesto(contexto, id, 'El estudio de suelos pidió excavar diez metros cúbicos más');
    await cambiarCantidad(contexto, referencia.actividades['Excavación manual']!.id, '130');
    await activarPresupuesto(contexto, id);

    assert.equal(await valor(id), '181055812.500000');
    assert.deepEqual(
      (await listarVersiones(contexto, id)).map((v) => [v.numero, v.disparador, v.estado, v.valorTotal, v.motivo]),
      [
        [1, 'ABIERTO_A_ACTIVO', 'ACTIVO', '180590155.000000', null],
        [2, 'ACTIVO_A_ABIERTO', 'ACTIVO', '180590155.000000', 'El estudio de suelos pidió excavar diez metros cúbicos más'],
        [3, 'ABIERTO_A_ACTIVO', 'ACTIVO', '181055812.500000', null],
      ],
    );
    // El concreto sigue en la versión que tenía: reabrir no reapunta nada por su cuenta.
    const concreto = (await leerActividades(contexto, id)).find((a) => a.descripcion === 'Concreto 3000 PSI para zapatas')!;
    assert.equal(concreto.precioUnitario, '636750.000000');
  });

  test('4 · la línea base original sigue consultable, intacta, en la versión 1', async () => {
    const [v1] = await listarVersiones(contexto, id);
    const foto = (await leerVersion(contexto, v1!.id))!.fotografia;
    assert.equal(foto.presupuesto.totales.valorTotal, '180590155.000000');
    assert.equal(
      foto.items.find((i) => i.descripcion === 'Excavación manual')!.cantidad,
      '120.000000',
    );
  });

  test('5 · el historial cuenta la historia completa: quince eventos, los cuatro últimos en orden', async () => {
    const eventos = await listarHistorial(contexto, id);
    assert.equal(eventos.length, 15);
    assert.deepEqual(
      eventos.slice(0, 4).map((e) => [e.tipoEvento, e.justificacion]),
      [
        ['CAMBIO_ESTADO', null],
        ['CANTIDAD_MODIFICADA', null],
        ['REAPERTURA', 'El estudio de suelos pidió excavar diez metros cúbicos más'],
        ['CAMBIO_ESTADO', null],
      ],
    );
  });

  test('6 · el diálogo de duplicar anticipa 181.176.762,5, la copia actualizada guarda exactamente eso, y el original no se mueve', async () => {
    const despues = (await leerPieConApuVigentes(contexto, id))!;
    assert.equal(despues.valorTotal, '181176762.500000');

    const copia = await duplicarPresupuesto(contexto, id, { codigo: 'PRE-RETIRO-2027', actualizarApu: true });
    assert.equal(await valor(copia), despues.valorTotal);
    assert.equal((await leerPresupuesto(contexto, copia))!.estado, 'ABIERTO');
    assert.equal(await valor(id), '181055812.500000');

    // 7 · El original fue activado: no se elimina. La copia nunca lo fue: sí, con motivo.
    await assert.rejects(eliminarPresupuesto(contexto, id, 'Ya hay copia'), /fue activado alguna vez/);
    await eliminarPresupuesto(contexto, copia, 'La copia era solo para comparar precios');
    assert.equal(await leerPresupuesto(contexto, copia), null);
    assert.equal(await valor(id), '181055812.500000');
  });
});
