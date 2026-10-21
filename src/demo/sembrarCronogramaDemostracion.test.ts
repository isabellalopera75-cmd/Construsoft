import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { listarPresupuestos } from '../infraestructura/basedatos/presupuesto.js';
import { VERSION_TERMINOS_DE_PRUEBA, clienteDePrueba, CARPETA_LEGAL_DE_PRUEBA, type Cuenta } from '../pruebas/clienteHttp.js';
import { construirServidor } from '../http/servidor.js';
import { sembrarCronogramaDemostracion, type Pedir, type ResumenDemoCronograma } from './sembrarCronogramaDemostracion.js';

/*
 * DEMO-003 (bitácora del producto, 21 de octubre de 2026): un edificio de
 * cinco pisos, activo, con su cronograma completo, su línea base «Contrato» y
 * una desviación contra ella.
 */

let app: FastifyInstance;
const { otraIp, registrar } = clienteDePrueba(() => app);

before(async () => {
  app = await construirServidor({ carpetaLegal: CARPETA_LEGAL_DE_PRUEBA, secretoSesion: randomBytes(32).toString('hex'), versionTerminos: VERSION_TERMINOS_DE_PRUEBA });
});
after(async () => {
  await app.close();
});

describe('el proyecto de demostración con cronograma (DEMO-003)', () => {
  let duena: Cuenta;
  let pedir: Pedir;
  let resumen: ResumenDemoCronograma;
  let vista: Record<string, any>;

  before(async () => {
    duena = await registrar('Constructora Demostración Cronograma', '900001005-5', 'demo.cronograma@construsoft.test');
    pedir = async (metodo, url, cuerpo) => {
      const r = await app.inject({ method: metodo, url, remoteAddress: otraIp(), headers: { cookie: duena.cookie }, ...(cuerpo === undefined ? {} : { payload: cuerpo as object }) });
      if (r.statusCode >= 300) throw new Error(`${metodo} ${url} → ${r.statusCode}: ${r.body}`);
      return r.json<Record<string, any>>();
    };
    resumen = await sembrarCronogramaDemostracion(duena.contexto, pedir);
    vista = await pedir('GET', `/api/presupuestos/${resumen.presupuestoId}/cronograma?lineaBase=${resumen.lineaBaseId}`);
  });

  test('DEMO-003 queda activo, por EDT, con sus once capítulos y sus 32 ítems', async () => {
    const demo = (await listarPresupuestos(duena.contexto)).find((p) => p.codigo === 'DEMO-003')!;
    assert.deepEqual([demo.estado, demo.nombre, demo.modoEstructura], ['ACTIVO', 'Edificio Mirador del Valle, 5 pisos', 'WBS']);
    assert.ok(Number(demo.valorTotal) > 0);
    assert.equal(vista.capitulos.length, 11);
    assert.equal(vista.actividades.filter((a: { tipo: string }) => a.tipo === 'ITEM').length, 32);
  });

  test('el cronograma empieza el martes 3 de noviembre en el calendario de lunes a sábado, sin nada por programar ni ciclos', () => {
    assert.equal(vista.cronograma.fechaInicio, '2026-11-03');
    assert.equal(vista.calendarios.obra.nombre, 'Lunes a sábado medio día');
    assert.equal(vista.calendarios.obra.semana[5].length, 1, 'el sábado, medio día');
    assert.ok(vista.calendarios.obra.excepciones.some((e: { fecha: string }) => e.fecha === '2026-12-08'), 'con los festivos de Colombia');
    assert.deepEqual(vista.revision.sinProgramar, []);
    // Las relaciones son las de la bitácora, ni una más: el inicio no tiene
    // predecesora, y seis actividades quedan sin sucesora, como allí se dejaron.
    const nombres = (ids: string[]) => ids.map((id) => vista.actividades.find((a: { id: string }) => a.id === id).nombre).sort();
    assert.deepEqual(nombres(vista.revision.sinPredecesora), ['Inicio del proyecto']);
    assert.deepEqual(nombres(vista.revision.sinSucesora), [
      'Campamento y bodega',
      'Cerramiento provisional en lámina',
      'Dinteles y columnetas',
      'Entrega de cimentación',
      'Escaleras en concreto',
      'Fin del proyecto',
      'Red sanitaria y de aguas lluvias',
    ]);
  });

  test('los hitos y trámites con sus códigos y grupos, y las relaciones de la bitácora', () => {
    const porNombre = (nombre: string) => vista.actividades.find((a: { nombre: string }) => a.nombre === nombre);
    assert.deepEqual(
      ['Inicio del proyecto', 'Fin del proyecto', 'Licencia de construcción', 'Fabricación de ventanería', 'Curado de losa de cubierta'].map((n) => porNombre(n).codigo),
      ['H-001', 'H-002', 'T-001', 'T-002', 'T-003'],
    );
    assert.deepEqual(vista.grupos.map((g: { nombre: string }) => g.nombre), ['Licencias y trámites', 'Suministros']);
    assert.equal(porNombre('Licencia de construcción').usaCorrido, true);
    assert.deepEqual(porNombre('Fin del proyecto').restriccion, { tipo: 'FIN_ANTES', fecha: '2027-09-30' });
    assert.equal(vista.dependencias.length, 46);
  });

  test('el director de obra dura lo que el proyecto, en días enteros', (t) => {
    t.diagnostic(JSON.stringify({ ...resumen, presupuestoId: undefined, cronogramaId: undefined, lineaBaseId: undefined }));
    const director = vista.actividades.find((a: { nombre: string }) => a.nombre === 'Director de obra');
    assert.match(resumen.directorDias, /^\d+$/);
    assert.equal(director.duracionManualDias, `${resumen.directorDias}.0`);
  });

  test('la línea base «Contrato» y, contra ella, el muro con tres cuadrillas: el proyecto se alarga y aparece el aviso de la administración', () => {
    assert.equal(vista.lineaBase.nombre, 'Contrato');
    assert.equal(vista.actividades.find((a: { nombre: string }) => a.nombre === 'Muro en bloque #5').cuadrillas, 3);
    assert.ok(resumen.aviso, 'sin aviso de la administración');
    assert.ok(Number(resumen.aviso.diasDeMas) > 0);
    assert.equal(vista.avisos.administracion.lineaBaseId, resumen.lineaBaseId);
  });

  test('correrlo dos veces no duplica nada: la segunda se niega y dice por qué', async () => {
    await assert.rejects(sembrarCronogramaDemostracion(duena.contexto, pedir), /DEMO-003 ya existe/);
  });
});
