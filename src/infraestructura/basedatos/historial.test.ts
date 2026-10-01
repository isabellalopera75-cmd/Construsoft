import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ejecutarConPermiso,
  registrarEmpresa,
  type ClienteEnContexto,
  type ContextoTenant,
  type EmpresaRegistrada,
} from './contextoTenant.js';
import { actualizarRecurso, crearRecurso, type Recurso } from './recurso.js';
import { crearApu, type Apu } from './apu.js';
import {
  archivarPresupuesto,
  crearPresupuesto,
  desarchivarPresupuesto,
  editarPorcentajes,
} from './presupuesto.js';
import { agregarCapitulo } from './edt.js';
import { agregarActividad, cambiarCantidad, eliminarActividad } from './actividad.js';
import { activarPresupuesto, reabrirPresupuesto } from './cicloDeVida.js';
import { listarHistorial, TIPOS_EVENTO, type Evento } from './historial.js';

const esperar = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

let empresa: EmpresaRegistrada;
let admin: ContextoTenant;
let colaborador: ContextoTenant;
let sinPermisos: ContextoTenant;
let recurso: Recurso;
let apu: Apu;
let presupuestoId: string;
let otroPresupuestoId: string;
let antesDeLaActivacion: Date;

async function comoAdministrador<T>(permiso: 'USUARIOS.GESTIONAR' | 'CONFIG.PREFERENCIAS', operacion: (c: ClienteEnContexto) => Promise<T>) {
  return ejecutarConPermiso(admin, permiso, operacion);
}

/** Un usuario con rol propio: PRESUPUESTOS.VER y EDITAR, más APU.VER que D-59 exige. */
async function crearColaborador(): Promise<string> {
  return comoAdministrador('USUARIOS.GESTIONAR', async (cliente) => {
    const { rows: roles } = await cliente.query<{ id: string }>(
      `INSERT INTO app.rol (tenant_id, nombre, tipo) VALUES ($1, 'Presupuestador', 'PERSONALIZADO') RETURNING id`,
      [empresa.tenantId],
    );
    for (const codigo of ['PRESUPUESTOS.VER', 'PRESUPUESTOS.EDITAR', 'APU.VER']) {
      await cliente.query('INSERT INTO app.rol_permiso (tenant_id, rol_id, permiso_codigo) VALUES ($1, $2, $3)', [
        empresa.tenantId,
        roles[0]!.id,
        codigo,
      ]);
    }
    const { rows } = await cliente.query<{ id: string }>(
      `INSERT INTO app.usuario (tenant_id, rol_id, nombre, email, password_hash, estado)
       VALUES ($1, $2, 'Pablo Presupuestador', 'historial.pablo@construsoft.test', 'x', 'ACTIVO') RETURNING id`,
      [empresa.tenantId, roles[0]!.id],
    );
    return rows[0]!.id;
  });
}

async function crearAsistenteSinPermisos(): Promise<string> {
  return comoAdministrador('USUARIOS.GESTIONAR', async (cliente) => {
    const { rows: roles } = await cliente.query<{ id: string }>(
      `SELECT id FROM app.rol WHERE tenant_id = $1 AND tipo = 'ASISTENTE'`,
      [empresa.tenantId],
    );
    const { rows } = await cliente.query<{ id: string }>(
      `INSERT INTO app.usuario (tenant_id, rol_id, nombre, email, password_hash, estado)
       VALUES ($1, $2, 'Asistente sin permisos', 'historial.asistente@construsoft.test', 'x', 'ACTIVO') RETURNING id`,
      [empresa.tenantId, roles[0]!.id],
    );
    return rows[0]!.id;
  });
}

const tipos = (eventos: Evento[]) => eventos.map((e) => e.tipoEvento);

describe('historial de cambios del presupuesto (RF-HIS-01..04)', () => {
  /*
   * Doce eventos en este presupuesto, en este orden: dos capítulos, tres
   * actividades (una del colaborador), una cantidad (del colaborador), el AIU,
   * una actividad eliminada, archivar y desarchivar, activar y reabrir. Y
   * eventos que NO son de este presupuesto: un capítulo de otro presupuesto y
   * el precio de un recurso, que no cuelga de ningún proyecto.
   */
  before(async () => {
    empresa = await registrarEmpresa({
      razonSocial: 'Constructora Historial',
      nit: '900000120-0',
      plan: 'EMPRESARIAL',
      adminNombre: 'Hilda Admin',
      adminEmail: 'historial.admin@construsoft.test',
      adminHash: 'hash_de_prueba_no_real',
      versionTerminos: 'terminos-de-prueba',
    });
    admin = { tenantId: empresa.tenantId, usuarioId: empresa.usuarioId };
    colaborador = { tenantId: empresa.tenantId, usuarioId: await crearColaborador() };
    sinPermisos = { tenantId: empresa.tenantId, usuarioId: await crearAsistenteSinPermisos() };

    const unidad = await comoAdministrador('CONFIG.PREFERENCIAS', async (cliente) => {
      const { rows } = await cliente.query<{ id: string }>(
        `SELECT id FROM app.unidad_medida WHERE tenant_id = $1 AND simbolo = 'Und'`,
        [empresa.tenantId],
      );
      return rows[0]!.id;
    });
    recurso = await crearRecurso(admin, {
      nombre: 'Servicio de mil',
      tipo: 'PERSONAL',
      unidadId: unidad,
      precioBase: '1000',
      ivaPct: '0',
      precioTotal: '1000',
      viaCaptura: 'BASE',
    });
    apu = await crearApu(admin, {
      nombre: 'Actividad de mil',
      unidadId: unidad,
      lineas: [{ recursoId: recurso.id, cantidad: '1', rendimiento: '1', desperdicioPct: '0' }],
    });

    const presupuesto = await crearPresupuesto(admin, {
      codigo: 'HIS-1',
      nombre: 'Con historial',
      ubicacion: 'Medellín',
      modoEstructura: 'ITEMS',
    });
    presupuestoId = presupuesto.id;
    const obra = await agregarCapitulo(admin, presupuestoId, { nombre: 'OBRA', clasificacion: 'DIRECTO' });
    await agregarCapitulo(admin, presupuestoId, { nombre: 'ESTUDIOS', clasificacion: 'INDIRECTO' });
    await agregarActividad(admin, obra.id, apu.id, '1');
    const aEliminar = await agregarActividad(admin, obra.id, apu.id, '2');
    const delColaborador = await agregarActividad(colaborador, obra.id, apu.id, '1');
    await cambiarCantidad(colaborador, delColaborador.id, '5');
    await editarPorcentajes(admin, presupuestoId, {
      aiuAdministracion: '10',
      aiuImprevistos: '5',
      aiuUtilidad: '5',
      ivaUtilidadPct: '19',
    });
    await eliminarActividad(admin, aEliminar.id);
    await archivarPresupuesto(admin, presupuestoId);
    await desarchivarPresupuesto(admin, presupuestoId);
    await esperar(5);
    antesDeLaActivacion = new Date();
    await esperar(5);
    await activarPresupuesto(admin, presupuestoId);
    await reabrirPresupuesto(admin, presupuestoId, 'El cliente amplió el alcance');

    const otro = await crearPresupuesto(admin, {
      codigo: 'HIS-2',
      nombre: 'Otro',
      ubicacion: 'Medellín',
      modoEstructura: 'ITEMS',
    });
    otroPresupuestoId = otro.id;
    await agregarCapitulo(admin, otroPresupuestoId, { nombre: 'AJENO', clasificacion: 'DIRECTO' });
    await actualizarRecurso(admin, recurso.id, { ...recurso, precioBase: '1100', precioTotal: '1100' });
  });

  test('los tipos de evento de TypeScript son exactamente los del catálogo app.tipo_evento', async () => {
    const catalogo = await ejecutarConPermiso(admin, 'PRESUPUESTOS.VER', async (cliente) => {
      const { rows } = await cliente.query<{ codigo: string }>('SELECT codigo FROM app.tipo_evento ORDER BY codigo');
      return rows.map((r) => r.codigo);
    });
    assert.deepEqual([...TIPOS_EVENTO].sort(), catalogo);
  });

  test('sin filtros: los doce de este presupuesto, del más reciente al más antiguo, sin los de otro presupuesto ni el del recurso', async () => {
    assert.deepEqual(tipos(await listarHistorial(admin, presupuestoId)), [
      'REAPERTURA',
      'CAMBIO_ESTADO',
      'PRESUPUESTO_DESARCHIVADO',
      'PRESUPUESTO_ARCHIVADO',
      'ITEM_ELIMINADO',
      'AIU_MODIFICADO',
      'CANTIDAD_MODIFICADA',
      'ITEM_AGREGADO',
      'ITEM_AGREGADO',
      'ITEM_AGREGADO',
      'CAPITULO_AGREGADO',
      'CAPITULO_AGREGADO',
    ]);
  });

  test('cada línea trae autor, justificación y el valor anterior frente al nuevo (RF-HIS-02)', async () => {
    const eventos = await listarHistorial(admin, presupuestoId);
    const reapertura = eventos.find((e) => e.tipoEvento === 'REAPERTURA')!;
    assert.deepEqual(
      [reapertura.usuarioNombre, reapertura.justificacion, reapertura.valorAnterior, reapertura.valorNuevo],
      ['Hilda Admin', 'El cliente amplió el alcance', { estado: 'ACTIVO' }, { estado: 'ABIERTO' }],
    );
    const cantidad = eventos.find((e) => e.tipoEvento === 'CANTIDAD_MODIFICADA')!;
    assert.deepEqual(
      [cantidad.usuarioNombre, cantidad.valorAnterior, cantidad.valorNuevo],
      ['Pablo Presupuestador', { cantidad: '1.000000' }, { cantidad: '5.000000' }],
    );
    assert.match(cantidad.id, /^\d+$/);
    assert.ok(cantidad.ocurridoEn instanceof Date);
  });

  test('filtra por tipo: tres actividades agregadas de doce eventos (RF-HIS-04)', async () => {
    assert.equal((await listarHistorial(admin, presupuestoId, { tipo: 'ITEM_AGREGADO' })).length, 3);
  });

  test('filtra por usuario: dos del colaborador, diez de la administradora (RF-HIS-04)', async () => {
    assert.deepEqual(tipos(await listarHistorial(admin, presupuestoId, { usuarioId: colaborador.usuarioId })), [
      'CANTIDAD_MODIFICADA',
      'ITEM_AGREGADO',
    ]);
    assert.equal((await listarHistorial(admin, presupuestoId, { usuarioId: admin.usuarioId })).length, 10);
  });

  test('filtra por fechas, desde inclusivo y hasta exclusivo: dos desde la activación, diez antes (RF-HIS-04)', async () => {
    assert.deepEqual(tipos(await listarHistorial(admin, presupuestoId, { desde: antesDeLaActivacion })), [
      'REAPERTURA',
      'CAMBIO_ESTADO',
    ]);
    assert.equal((await listarHistorial(admin, presupuestoId, { hasta: antesDeLaActivacion })).length, 10);
  });

  test('los filtros se combinan: del colaborador y de tipo ITEM_AGREGADO, uno', async () => {
    assert.equal(
      (await listarHistorial(admin, presupuestoId, { tipo: 'ITEM_AGREGADO', usuarioId: colaborador.usuarioId })).length,
      1,
    );
  });

  test('el historial no se edita ni se borra: la aplicación no tiene con qué (02 §10.2)', async () => {
    await assert.rejects(
      ejecutarConPermiso(admin, 'PRESUPUESTOS.EDITAR', (cliente) =>
        cliente.query(`UPDATE app.evento_auditoria SET descripcion = 'retocado' WHERE presupuesto_id = $1`, [
          presupuestoId,
        ]),
      ),
      /permiso denegado|permission denied/,
    );
    await assert.rejects(
      ejecutarConPermiso(admin, 'PRESUPUESTOS.EDITAR', (cliente) =>
        cliente.query('DELETE FROM app.evento_auditoria WHERE presupuesto_id = $1', [presupuestoId]),
      ),
      /permiso denegado|permission denied/,
    );
    assert.equal((await listarHistorial(admin, presupuestoId)).length, 12);
  });

  test('sin PRESUPUESTOS.VER no se lee el historial', async () => {
    await assert.rejects(listarHistorial(sinPermisos, presupuestoId), /PRESUPUESTOS\.VER/);
  });

  test('aislamiento: otra empresa no ve el historial de este presupuesto', async () => {
    const empresaB = await registrarEmpresa({
      razonSocial: 'Constructora Historial B',
      nit: '900000121-1',
      plan: 'PERSONAL',
      adminNombre: 'Admin B',
      adminEmail: 'historial.b@construsoft.test',
      adminHash: 'hash_de_prueba_no_real',
      versionTerminos: 'terminos-de-prueba',
    });
    assert.deepEqual(
      await listarHistorial({ tenantId: empresaB.tenantId, usuarioId: empresaB.usuarioId }, presupuestoId),
      [],
    );
    assert.equal((await listarHistorial(admin, otroPresupuestoId)).length, 1);
  });
});
