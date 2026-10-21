import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { comoSuperusuario } from '../pruebas/superusuario.js';
import { VERSION_TERMINOS_DE_PRUEBA, clienteDePrueba, type Cuenta, CARPETA_LEGAL_DE_PRUEBA } from '../pruebas/clienteHttp.js';
import { construirServidor } from './servidor.js';

let app: FastifyInstance;
const { otraIp, registrar, asistenteCon } = clienteDePrueba(() => app);

before(async () => {
  app = await construirServidor({ carpetaLegal: CARPETA_LEGAL_DE_PRUEBA, secretoSesion: randomBytes(32).toString('hex'), versionTerminos: VERSION_TERMINOS_DE_PRUEBA });
});
after(async () => {
  await app.close();
});

async function llamar(metodo: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, cookie: string | undefined, cuerpo?: unknown) {
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

const FERIA = [
  { fecha: '2026-08-07', nombre: 'Feria de las Flores' },
  { fecha: '2027-08-06', nombre: null },
];

describe('listas propias de festivos: crear, reemplazar y eliminar (CONTRATO §19.4)', () => {
  let duena: Cuenta;

  before(async () => {
    duena = await registrar('Constructora Festivos', '900000976-6', 'festivos.duena@construsoft.test');
  });

  test('crear la lista con sus fechas, ordenadas, y reemplazarlas enteras', async () => {
    const r = await llamar('POST', '/api/configuracion/festivos', duena.cookie, { nombre: 'Feria de Medellín', fechas: [FERIA[1], FERIA[0]] });
    assert.equal(r.estado, 201, r.crudo);
    assert.deepEqual({ ...r.cuerpo, id: undefined }, { id: undefined, nombre: 'Feria de Medellín', fechas: FERIA });

    const otra = [{ fecha: '2028-08-04', nombre: 'Feria 2028' }];
    const reemplazada = await llamar('PUT', `/api/configuracion/festivos/${r.cuerpo.id}`, duena.cookie, { nombre: 'Feria', fechas: otra });
    assert.equal(reemplazada.estado, 200, reemplazada.crudo);
    assert.deepEqual(reemplazada.cuerpo, { id: r.cuerpo.id, nombre: 'Feria', fechas: otra });
  });

  test('una fecha repetida es 422 en fechas; una que no es fecha, también; un nombre repetido es 409 en nombre', async () => {
    const repetida = await llamar('POST', '/api/configuracion/festivos', duena.cookie, { nombre: 'Repetida', fechas: [FERIA[0], { fecha: '2026-08-07', nombre: 'Otra vez' }] });
    assert.deepEqual([repetida.estado, repetida.cuerpo.campo], [422, 'fechas'], repetida.crudo);
    const mala = await llamar('POST', '/api/configuracion/festivos', duena.cookie, { nombre: 'Mala', fechas: [{ fecha: '2026-02-30', nombre: null }] });
    assert.deepEqual([mala.estado, mala.cuerpo.campo], [422, 'fechas'], mala.crudo);

    await llamar('POST', '/api/configuracion/festivos', duena.cookie, { nombre: 'Lista única', fechas: [] });
    const nombre = await llamar('POST', '/api/configuracion/festivos', duena.cookie, { nombre: ' LISTA ÚNICA ', fechas: [] });
    assert.deepEqual([nombre.estado, nombre.cuerpo.campo], [409, 'nombre'], nombre.crudo);
    const vacio = await llamar('POST', '/api/configuracion/festivos', duena.cookie, { nombre: ' ', fechas: [] });
    assert.deepEqual([vacio.estado, vacio.cuerpo.campo], [422, 'nombre']);
  });

  test('eliminar la lista no toca el calendario que la copió: conserva las fechas y olvida de dónde salieron', async () => {
    const lista = await llamar('POST', '/api/configuracion/festivos', duena.cookie, { nombre: 'Para copiar', fechas: FERIA });
    const calendario = await comoSuperusuario(
      async (c) => (await c.query<{ id: string }>('SELECT id FROM app.calendario WHERE tenant_id = $1 AND por_defecto', [duena.contexto.tenantId])).rows[0]!.id,
    );
    const copia = await llamar('POST', `/api/configuracion/calendarios/${calendario}/festivos`, duena.cookie, { listaId: lista.cuerpo.id, propia: true });
    assert.deepEqual([copia.estado, copia.cuerpo.copiados, copia.cuerpo.calendario.festivos], [200, 2, { origen: { tipo: 'PROPIA', id: lista.cuerpo.id, nombre: 'Para copiar' }, hasta: 2027 }]);

    assert.equal((await llamar('DELETE', `/api/configuracion/festivos/${lista.cuerpo.id}`, duena.cookie)).estado, 204);
    assert.equal((await llamar('PUT', `/api/configuracion/festivos/${lista.cuerpo.id}`, duena.cookie, { nombre: 'X', fechas: [] })).estado, 404);
    const despues = await comoSuperusuario(async (c) =>
      (await c.query('SELECT festivos_propia_id, festivos_hasta, (SELECT count(*)::int FROM app.calendario_excepcion e WHERE e.calendario_id = k.id) AS fechas FROM app.calendario k WHERE id = $1', [calendario])).rows[0],
    );
    assert.deepEqual(despues, { festivos_propia_id: null, festivos_hasta: 2027, fechas: 2 });
  });
});

describe('listas propias de festivos: permiso y aislamiento (D-90)', () => {
  test('sin CONFIG.PREFERENCIAS no se escribe: 403', async () => {
    const duena = await registrar('Constructora Festivos Permiso', '900000977-7', 'festivos.permiso@construsoft.test');
    const sinPermiso = await asistenteCon(duena, 'festivos.sinpermiso@construsoft.test', ['PRESUPUESTOS.VER']);
    assert.equal((await llamar('POST', '/api/configuracion/festivos', sinPermiso, { nombre: 'No', fechas: [] })).estado, 403);
  });

  test('la lista propia de otra empresa no existe: ni se edita, ni se elimina, ni se copia a un calendario', async () => {
    const a = await registrar('Constructora Festivos A', '900000978-8', 'festivos.a@construsoft.test');
    const b = await registrar('Constructora Festivos B', '900000979-9', 'festivos.b@construsoft.test');
    const deA = await llamar('POST', '/api/configuracion/festivos', a.cookie, { nombre: 'Privada de A', fechas: FERIA });
    assert.equal((await llamar('PUT', `/api/configuracion/festivos/${deA.cuerpo.id}`, b.cookie, { nombre: 'Robada', fechas: [] })).estado, 404);
    assert.equal((await llamar('DELETE', `/api/configuracion/festivos/${deA.cuerpo.id}`, b.cookie)).estado, 404);
    assert.equal((await llamar('DELETE', '/api/configuracion/festivos/no-es-un-id', b.cookie)).estado, 404);

    const calendarioDeB = await comoSuperusuario(
      async (c) => (await c.query<{ id: string }>('SELECT id FROM app.calendario WHERE tenant_id = $1 AND por_defecto', [b.contexto.tenantId])).rows[0]!.id,
    );
    const copia = await llamar('POST', `/api/configuracion/calendarios/${calendarioDeB}/festivos`, b.cookie, { listaId: deA.cuerpo.id, propia: true });
    assert.equal(copia.estado, 422, copia.crudo);
    const intacta = await comoSuperusuario(async (c) => (await c.query('SELECT nombre FROM app.lista_festivos_propia WHERE id = $1', [deA.cuerpo.id])).rows[0]);
    assert.deepEqual(intacta, { nombre: 'Privada de A' });
  });
});
