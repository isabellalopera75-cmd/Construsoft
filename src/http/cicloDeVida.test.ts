import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { crearPresupuesto } from '../infraestructura/basedatos/presupuesto.js';
import { activarPresupuesto } from '../infraestructura/basedatos/cicloDeVida.js';
import { armarPresupuestoDeReferencia, type PresupuestoDeReferencia } from '../pruebas/presupuestoDeReferencia.js';
import { vencerSuscripcion } from '../pruebas/superusuario.js';
import { VERSION_TERMINOS_DE_PRUEBA, CARPETA_LEGAL_DE_PRUEBA, clienteDePrueba, type Cuenta } from '../pruebas/clienteHttp.js';
import { construirServidor } from './servidor.js';

let app: FastifyInstance;
const { otraIp, registrar, asistenteCon } = clienteDePrueba(() => app);

before(async () => {
  app = await construirServidor({
    carpetaLegal: CARPETA_LEGAL_DE_PRUEBA,
    secretoSesion: randomBytes(32).toString('hex'),
    versionTerminos: VERSION_TERMINOS_DE_PRUEBA,
  });
});
after(async () => {
  await app.close();
});

async function llamar(metodo: 'GET' | 'POST' | 'PUT', url: string, cookie: string | undefined, cuerpo?: unknown) {
  const r = await app.inject({
    method: metodo,
    url,
    remoteAddress: otraIp(),
    ...(cookie ? { headers: { cookie } } : {}),
    ...(cuerpo === undefined ? {} : { payload: cuerpo as object }),
  });
  const json = r.body === '' ? {} : r.json<Record<string, unknown>>();
  return { estado: r.statusCode, cuerpo: json as Record<string, any>, crudo: r.body };
}

describe('el ciclo de vida del presupuesto (02 §9): activar, reabrir, cerrar', () => {
  let duena: Cuenta;
  let ref: PresupuestoDeReferencia;

  before(async () => {
    duena = await registrar('Constructora Ciclo', '900000380-0', 'ciclo.http.admin@construsoft.test');
    ref = await armarPresupuestoDeReferencia(duena.contexto, 'CIC-REF');
  });

  test('activar: la mesa queda ACTIVA y no editable, con la línea base como versión 1', async () => {
    const r = await llamar('POST', `/api/presupuestos/${ref.presupuestoId}/activar`, duena.cookie);
    assert.equal(r.estado, 200, r.crudo);
    assert.deepEqual([r.cuerpo.cabecera.estado, r.cuerpo.cabecera.editable, r.cuerpo.pie.valorTotal], ['ACTIVO', false, '180590155.000000']);
    const versiones = (await llamar('GET', `/api/presupuestos/${ref.presupuestoId}/versiones`, duena.cookie)).cuerpo.versiones;
    assert.deepEqual(versiones.map((v: { numero: number; disparador: string }) => [v.numero, v.disparador]), [[1, 'ABIERTO_A_ACTIVO']]);
  });

  test('reabrir exige la justificación escrita; con ella vuelve a ABIERTO y la reapertura queda en el historial', async () => {
    const sin = await llamar('POST', `/api/presupuestos/${ref.presupuestoId}/reabrir`, duena.cookie, { justificacion: '  ' });
    assert.deepEqual([sin.estado, sin.cuerpo.campo], [422, 'justificacion']);
    const r = await llamar('POST', `/api/presupuestos/${ref.presupuestoId}/reabrir`, duena.cookie, { justificacion: 'El cliente pidió ajustar la cimentación' });
    assert.deepEqual([r.estado, r.cuerpo.cabecera.estado, r.cuerpo.cabecera.editable], [200, 'ABIERTO', true]);
    const historial = await llamar('GET', `/api/presupuestos/${ref.presupuestoId}/historial?tipo=REAPERTURA`, duena.cookie);
    assert.deepEqual(
      historial.cuerpo.eventos.map((e: { tipoEvento: string; justificacion: string; usuarioNombre: string }) => [e.tipoEvento, e.justificacion, e.usuarioNombre]),
      [['REAPERTURA', 'El cliente pidió ajustar la cimentación', 'Admin de Constructora Ciclo']],
    );
  });

  test('cerrar es terminal: un CERRADO no se reabre', async () => {
    await llamar('POST', `/api/presupuestos/${ref.presupuestoId}/activar`, duena.cookie);
    const cerrado = await llamar('POST', `/api/presupuestos/${ref.presupuestoId}/cerrar`, duena.cookie);
    assert.deepEqual([cerrado.estado, cerrado.cuerpo.cabecera.estado], [200, 'CERRADO']);
    const reabrir = await llamar('POST', `/api/presupuestos/${ref.presupuestoId}/reabrir`, duena.cookie, { justificacion: 'Retomar la obra' });
    assert.equal(reabrir.estado, 422);
  });

  test('un presupuesto sin actividades no se activa, y el mensaje lo dice (D-20)', async () => {
    const vacio = await crearPresupuesto(duena.contexto, { codigo: 'CIC-VACIO', nombre: 'Vacío', ubicacion: 'x', modoEstructura: 'WBS' });
    const r = await llamar('POST', `/api/presupuestos/${vacio.id}/activar`, duena.cookie);
    assert.equal(r.estado, 422);
    assert.match(r.cuerpo.mensaje, /no tiene ninguna actividad/);
  });

  test('cambiar de estado es solo del Administrador: con ver y editar, 403', async () => {
    const editor = await asistenteCon(duena, 'ciclo.http.editor@construsoft.test', ['PRESUPUESTOS.VER', 'PRESUPUESTOS.EDITAR', 'APU.VER']);
    const p = await armarPresupuestoDeReferencia(duena.contexto, 'CIC-EDITOR');
    const r = await llamar('POST', `/api/presupuestos/${p.presupuestoId}/activar`, editor);
    assert.equal(r.estado, 403);
    assert.match(r.cuerpo.mensaje, /PRESUPUESTOS\.ESTADO/);
  });
});

describe('cabecera, estructura, versión manual, archivar, duplicar y eliminar (02 §7.1, §9.4, §9.6, §9.7, §10.1)', () => {
  let duena: Cuenta;

  before(async () => {
    duena = await registrar('Constructora Ciclo Dos', '900000381-1', 'ciclo2.admin@construsoft.test');
  });

  test('editar la cabecera y la estructura; el código repetido marca el campo', async () => {
    const p = await crearPresupuesto(duena.contexto, { codigo: 'CAB-1', nombre: 'Uno', ubicacion: 'Bello', modoEstructura: 'ITEMS' });
    await crearPresupuesto(duena.contexto, { codigo: 'CAB-OCUPADO', nombre: 'Otro', ubicacion: 'x', modoEstructura: 'ITEMS' });
    const r = await llamar('PUT', `/api/presupuestos/${p.id}/cabecera`, duena.cookie, { codigo: 'CAB-1B', nombre: 'Uno bis', ubicacion: 'Bello, Antioquia' });
    assert.deepEqual([r.estado, r.cuerpo.cabecera.codigo, r.cuerpo.cabecera.nombre, r.cuerpo.cabecera.ubicacion], [200, 'CAB-1B', 'Uno bis', 'Bello, Antioquia']);
    const repetido = await llamar('PUT', `/api/presupuestos/${p.id}/cabecera`, duena.cookie, { codigo: 'CAB-OCUPADO', nombre: 'x', ubicacion: 'x' });
    assert.deepEqual([repetido.estado, repetido.cuerpo.campo], [409, 'codigo']);
    const modo = await llamar('PUT', `/api/presupuestos/${p.id}/estructura`, duena.cookie, { modoEstructura: 'WBS' });
    assert.deepEqual([modo.estado, modo.cuerpo.cabecera.modoEstructura], [200, 'WBS']);
  });

  test('guardar una versión manual exige el motivo, y la versión se consulta entera en solo lectura', async () => {
    const p = await armarPresupuestoDeReferencia(duena.contexto, 'VER-MAN');
    const sin = await llamar('POST', `/api/presupuestos/${p.presupuestoId}/versiones`, duena.cookie, { motivo: '' });
    assert.deepEqual([sin.estado, sin.cuerpo.campo], [422, 'motivo']);
    const r = await llamar('POST', `/api/presupuestos/${p.presupuestoId}/versiones`, duena.cookie, { motivo: 'Antes de negociar' });
    assert.deepEqual([r.estado, r.cuerpo.numero, r.cuerpo.tipo, r.cuerpo.motivo], [201, 1, 'MANUAL', 'Antes de negociar']);
    const version = await llamar('GET', `/api/versiones/${r.cuerpo.id}`, duena.cookie);
    assert.deepEqual([version.estado, version.cuerpo.fotografia.presupuesto.totales.valorTotal], [200, '180590155.000000']);
  });

  test('archivar lo saca de la vista maestra sin cambiar su estado; desarchivar lo devuelve', async () => {
    const p = await crearPresupuesto(duena.contexto, { codigo: 'ARCH-1', nombre: 'Licitación perdida', ubicacion: 'x', modoEstructura: 'ITEMS' });
    const codigos = async (url: string) => ((await llamar('GET', url, duena.cookie)).cuerpo as unknown as { codigo: string }[]).map((x) => x.codigo);
    const r = await llamar('POST', `/api/presupuestos/${p.id}/archivar`, duena.cookie);
    assert.deepEqual([r.estado, r.cuerpo.estado, typeof r.cuerpo.archivadoEn], [200, 'ABIERTO', 'string']);
    assert.ok(!(await codigos('/api/presupuestos')).includes('ARCH-1'));
    assert.ok((await codigos('/api/presupuestos?archivados=true')).includes('ARCH-1'));
    await llamar('POST', `/api/presupuestos/${p.id}/desarchivar`, duena.cookie);
    assert.ok((await codigos('/api/presupuestos')).includes('ARCH-1'));
  });

  test('duplicar: el diálogo muestra el antes y el después, y la copia nace ABIERTA con el código nuevo', async () => {
    const p = await armarPresupuestoDeReferencia(duena.contexto, 'DUP-ORIGEN');
    await activarPresupuesto(duena.contexto, p.presupuestoId);
    const dialogo = await llamar('GET', `/api/presupuestos/${p.presupuestoId}/duplicacion`, duena.cookie);
    assert.equal(dialogo.estado, 200, dialogo.crudo);
    assert.deepEqual([dialogo.cuerpo.apusDesactualizados, dialogo.cuerpo.valorTotalActual, dialogo.cuerpo.valorTotalConApuVigentes], [[], '180590155.000000', '180590155.000000']);

    const r = await llamar('POST', `/api/presupuestos/${p.presupuestoId}/duplicar`, duena.cookie, { codigo: 'DUP-COPIA', actualizarApu: false });
    assert.equal(r.estado, 201, r.crudo);
    const copia = await llamar('GET', `/api/presupuestos/${r.cuerpo.id}/mesa`, duena.cookie);
    assert.deepEqual([copia.cuerpo.cabecera.codigo, copia.cuerpo.cabecera.estado, copia.cuerpo.pie.valorTotal], ['DUP-COPIA', 'ABIERTO', '180590155.000000']);
    const repetido = await llamar('POST', `/api/presupuestos/${p.presupuestoId}/duplicar`, duena.cookie, { codigo: 'DUP-COPIA', actualizarApu: false });
    assert.deepEqual([repetido.estado, repetido.cuerpo.campo], [409, 'codigo']);
  });

  test('eliminar: solo lo que nunca se activó, con motivo; lo activado se archiva', async () => {
    const nunca = await crearPresupuesto(duena.contexto, { codigo: 'ELI-1', nombre: 'Borrador', ubicacion: 'x', modoEstructura: 'ITEMS' });
    const sinMotivo = await llamar('POST', `/api/presupuestos/${nunca.id}/eliminar`, duena.cookie, { motivo: '' });
    assert.deepEqual([sinMotivo.estado, sinMotivo.cuerpo.campo], [422, 'motivo']);
    assert.equal((await llamar('POST', `/api/presupuestos/${nunca.id}/eliminar`, duena.cookie, { motivo: 'Se creó por error' })).estado, 204);
    assert.equal((await llamar('GET', `/api/presupuestos/${nunca.id}`, duena.cookie)).estado, 404);

    const activado = await armarPresupuestoDeReferencia(duena.contexto, 'ELI-ACT');
    await activarPresupuesto(duena.contexto, activado.presupuestoId);
    const r = await llamar('POST', `/api/presupuestos/${activado.presupuestoId}/eliminar`, duena.cookie, { motivo: 'Ya no sirve' });
    assert.equal(r.estado, 422);
    assert.match(r.cuerpo.mensaje, /Archívelo/);
  });
});

describe('ciclo de vida con la suscripción vencida: solo lectura (D-65)', () => {
  test('activar responde 402; el historial se lee', async () => {
    const vencida = await registrar('Constructora Ciclo Vencida', '900000382-2', 'ciclo.http.vencida@construsoft.test');
    const p = await armarPresupuestoDeReferencia(vencida.contexto, 'CIC-V');
    await vencerSuscripcion(vencida.contexto.tenantId);
    assert.equal((await llamar('POST', `/api/presupuestos/${p.presupuestoId}/activar`, vencida.cookie)).estado, 402);
    assert.equal((await llamar('GET', `/api/presupuestos/${p.presupuestoId}/historial`, vencida.cookie)).estado, 200);
  });
});

describe('aislamiento: el ciclo de vida de otra empresa no existe (RN-01)', () => {
  test('cada ruta con un id de B responde lo mismo que con uno inexistente o uno que no es un id, y B queda intacta', async () => {
    const a = await registrar('Constructora Ciclo A', '900000383-3', 'ciclo.http.a@construsoft.test');
    const b = await registrar('Constructora Ciclo B', '900000384-4', 'ciclo.http.b@construsoft.test');
    const deB = await armarPresupuestoDeReferencia(b.contexto, 'CIC-B');
    const versionDeB = (await llamar('POST', `/api/presupuestos/${deB.presupuestoId}/versiones`, b.cookie, { motivo: 'De B' })).cuerpo.id;
    const inexistente = '01900000-0000-7000-8000-000000000000';

    const rutas: [('GET' | 'POST' | 'PUT'), string, unknown][] = [
      ['POST', '/api/presupuestos/ID/activar', undefined],
      ['POST', '/api/presupuestos/ID/cerrar', undefined],
      ['POST', '/api/presupuestos/ID/reabrir', { justificacion: 'x' }],
      ['PUT', '/api/presupuestos/ID/cabecera', { codigo: 'X', nombre: 'x', ubicacion: 'x' }],
      ['PUT', '/api/presupuestos/ID/estructura', { modoEstructura: 'WBS' }],
      ['POST', '/api/presupuestos/ID/versiones', { motivo: 'x' }],
      ['POST', '/api/presupuestos/ID/archivar', undefined],
      ['POST', '/api/presupuestos/ID/desarchivar', undefined],
      ['GET', '/api/presupuestos/ID/duplicacion', undefined],
      ['POST', '/api/presupuestos/ID/duplicar', { codigo: 'X', actualizarApu: false }],
      ['POST', '/api/presupuestos/ID/eliminar', { motivo: 'x' }],
      ['GET', '/api/presupuestos/ID/historial', undefined],
      ['GET', '/api/versiones/VID', undefined],
    ];
    for (const [metodo, plantilla, cuerpo] of rutas) {
      const url = (id: string) => plantilla.replace('ID', id).replace('VID', id);
      const ajeno = await llamar(metodo, plantilla.includes('VID') ? url(versionDeB) : url(deB.presupuestoId), a.cookie, cuerpo);
      assert.equal(ajeno.estado, 404, `${metodo} ${plantilla}: ${ajeno.crudo}`);
      for (const id of [inexistente, 'no-es-un-id']) {
        const otro = await llamar(metodo, url(id), a.cookie, cuerpo);
        assert.deepEqual([otro.estado, otro.crudo], [ajeno.estado, ajeno.crudo], `${metodo} ${plantilla} con ${id}`);
      }
    }
    const mesaDeB = (await llamar('GET', `/api/presupuestos/${deB.presupuestoId}/mesa`, b.cookie)).cuerpo;
    assert.deepEqual([mesaDeB.cabecera.estado, mesaDeB.cabecera.codigo, mesaDeB.pie.valorTotal], ['ABIERTO', 'CIC-B', '180590155.000000']);
  });
});
