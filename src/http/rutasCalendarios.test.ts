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

/** El calendario con que nace toda empresa (D-86): no hay ruta que lo cree. */
async function calendarioInicial(cuenta: Cuenta): Promise<string> {
  return comoSuperusuario(async (c) => {
    const { rows } = await c.query<{ id: string }>('SELECT id FROM app.calendario WHERE tenant_id = $1 AND por_defecto', [cuenta.contexto.tenantId]);
    return rows[0]!.id;
  });
}

async function listaDeColombia(): Promise<string> {
  return comoSuperusuario(async (c) => (await c.query<{ id: string }>("SELECT id FROM plataforma.lista_festivos WHERE pais = 'CO'")).rows[0]!.id);
}

const VACIO: { inicio: string; fin: string }[] = [];
const OCHO_HORAS = [{ inicio: '07:00', fin: '12:00' }, { inicio: '13:00', fin: '16:00' }];
/** Lunes a viernes de 8 h y sábado de 7:00 a 11:00: 44 horas. */
const LUNES_A_SABADO = [OCHO_HORAS, OCHO_HORAS, OCHO_HORAS, OCHO_HORAS, OCHO_HORAS, [{ inicio: '07:00', fin: '11:00' }], VACIO];

describe('calendarios de la empresa: crear, editar y eliminar (CONTRATO §19.3)', () => {
  let duena: Cuenta;

  before(async () => {
    duena = await registrar('Constructora Calendarios', '900000970-0', 'calendarios.duena@construsoft.test');
  });

  test('crear: la semana de siete días, sus totales y «1 día = X h»; nace sin la marca de por defecto', async () => {
    const r = await llamar('POST', '/api/configuracion/calendarios', duena.cookie, { nombre: 'Lunes a sábado', horasPorDia: '8.8', semana: LUNES_A_SABADO });
    assert.equal(r.estado, 201, r.crudo);
    assert.deepEqual(
      { ...r.cuerpo, id: undefined },
      {
        id: undefined,
        nombre: 'Lunes a sábado',
        tipo: 'EMPRESA',
        horasPorDia: '8.80',
        porDefecto: false,
        semana: LUNES_A_SABADO,
        horasDia: ['8.0', '8.0', '8.0', '8.0', '8.0', '4.0', '0.0'],
        horasSemana: '44.0',
        excepciones: [],
        festivos: { origen: null, hasta: null },
      },
    );
  });

  test('un turno que cruza la medianoche se guarda en dos días, con 24:00 al final del primero', async () => {
    const noche = [[{ inicio: '20:00', fin: '24:00' }], [{ inicio: '00:00', fin: '04:00' }], VACIO, VACIO, VACIO, VACIO, VACIO];
    const r = await llamar('POST', '/api/configuracion/calendarios', duena.cookie, { nombre: 'Nocturno', horasPorDia: '8', semana: noche });
    assert.equal(r.estado, 201, r.crudo);
    assert.deepEqual([r.cuerpo.semana, r.cuerpo.horasDia.slice(0, 2), r.cuerpo.horasSemana], [noche, ['4.0', '4.0'], '8.0']);
  });

  test('editar reemplaza la semana entera y el nombre', async () => {
    const creado = await llamar('POST', '/api/configuracion/calendarios', duena.cookie, { nombre: 'Para editar', horasPorDia: '8', semana: LUNES_A_SABADO });
    const semana = [OCHO_HORAS, OCHO_HORAS, VACIO, VACIO, VACIO, VACIO, VACIO];
    const r = await llamar('PUT', `/api/configuracion/calendarios/${creado.cuerpo.id}`, duena.cookie, { nombre: 'Editado', horasPorDia: '10', semana });
    assert.equal(r.estado, 200, r.crudo);
    assert.deepEqual([r.cuerpo.id, r.cuerpo.nombre, r.cuerpo.horasPorDia, r.cuerpo.semana, r.cuerpo.horasSemana], [creado.cuerpo.id, 'Editado', '10.00', semana, '16.0']);
  });

  test('el nombre: vacío es 422, y repetido en la empresa (sin distinguir mayúsculas) es 409, los dos en nombre', async () => {
    await llamar('POST', '/api/configuracion/calendarios', duena.cookie, { nombre: 'Turno único', horasPorDia: '8', semana: LUNES_A_SABADO });
    const repetido = await llamar('POST', '/api/configuracion/calendarios', duena.cookie, { nombre: '  TURNO ÚNICO ', horasPorDia: '8', semana: LUNES_A_SABADO });
    assert.deepEqual([repetido.estado, repetido.cuerpo.campo], [409, 'nombre'], repetido.crudo);
    const vacio = await llamar('POST', '/api/configuracion/calendarios', duena.cookie, { nombre: '  ', horasPorDia: '8', semana: LUNES_A_SABADO });
    assert.deepEqual([vacio.estado, vacio.cuerpo.campo], [422, 'nombre']);
  });

  test('«1 día = X h» va de más de 0 a 24, con hasta dos decimales: lo demás es 422 en horasPorDia', async () => {
    for (const horasPorDia of ['0', '24.5', '8.125', 'ocho', 8]) {
      const r = await llamar('POST', '/api/configuracion/calendarios', duena.cookie, { nombre: `Malo ${String(horasPorDia)}`, horasPorDia, semana: LUNES_A_SABADO });
      assert.deepEqual([r.estado, r.cuerpo.campo], [422, 'horasPorDia'], String(horasPorDia));
    }
  });

  test('una semana mal formada es 422 en semana: seis días, media hora partida, al revés o cruzada', async () => {
    const malas = [
      LUNES_A_SABADO.slice(0, 6),
      [[{ inicio: '07:15', fin: '12:00' }], VACIO, VACIO, VACIO, VACIO, VACIO, VACIO],
      [[{ inicio: '12:00', fin: '07:00' }], VACIO, VACIO, VACIO, VACIO, VACIO, VACIO],
      [[{ inicio: '07:00', fin: '12:00' }, { inicio: '11:30', fin: '14:00' }], VACIO, VACIO, VACIO, VACIO, VACIO, VACIO],
      [[{ inicio: '24:30', fin: '25:00' }], VACIO, VACIO, VACIO, VACIO, VACIO, VACIO],
      'todos los días',
    ];
    for (const [i, semana] of malas.entries()) {
      const r = await llamar('POST', '/api/configuracion/calendarios', duena.cookie, { nombre: `Semana mala ${i}`, horasPorDia: '8', semana });
      assert.deepEqual([r.estado, r.cuerpo.campo], [422, 'semana'], `caso ${i}: ${r.crudo}`);
    }
  });

  test('por defecto: marcar otro le quita la marca al anterior y responde la lista', async () => {
    const otro = await llamar('POST', '/api/configuracion/calendarios', duena.cookie, { nombre: 'El nuevo por defecto', horasPorDia: '8', semana: LUNES_A_SABADO });
    const r = await llamar('POST', `/api/configuracion/calendarios/${otro.cuerpo.id}/por-defecto`, duena.cookie);
    assert.equal(r.estado, 200, r.crudo);
    const marcados = r.cuerpo.calendarios.filter((c: { porDefecto: boolean }) => c.porDefecto);
    assert.deepEqual(marcados.map((c: { id: string }) => c.id), [otro.cuerpo.id]);
    const resumen = r.cuerpo.calendarios.find((c: { id: string }) => c.id === otro.cuerpo.id);
    assert.deepEqual(resumen, { id: otro.cuerpo.id, nombre: 'El nuevo por defecto', horasPorDia: '8.00', horasSemana: '44.0', porDefecto: true });
  });

  test('eliminar: el de por defecto no (422 sin campo); otro sí, y después ya no existe', async () => {
    const empresa = await registrar('Constructora Calendarios Eliminar', '900000971-1', 'calendarios.eliminar@construsoft.test');
    const inicial = await calendarioInicial(empresa);
    const elDeDefecto = await llamar('DELETE', `/api/configuracion/calendarios/${inicial}`, empresa.cookie);
    assert.equal(elDeDefecto.estado, 422, elDeDefecto.crudo);
    assert.equal(elDeDefecto.cuerpo.campo, undefined);

    const otro = await llamar('POST', '/api/configuracion/calendarios', empresa.cookie, { nombre: 'Se va', horasPorDia: '8', semana: LUNES_A_SABADO });
    assert.equal((await llamar('DELETE', `/api/configuracion/calendarios/${otro.cuerpo.id}`, empresa.cookie)).estado, 204);
    const yaNo = await llamar('PUT', `/api/configuracion/calendarios/${otro.cuerpo.id}`, empresa.cookie, { nombre: 'X', horasPorDia: '8', semana: LUNES_A_SABADO });
    assert.equal(yaNo.estado, 404);
  });
});

describe('excepciones y festivos de un calendario de la empresa (CONTRATO §19.3)', () => {
  let duena: Cuenta;
  let calendario: string;

  before(async () => {
    duena = await registrar('Constructora Excepciones', '900000972-2', 'excepciones.duena@construsoft.test');
    calendario = await calendarioInicial(duena);
  });

  test('una fecha con horario propio, una sin tramos (no laborable) y quitarla', async () => {
    const media = await llamar('PUT', `/api/configuracion/calendarios/${calendario}/excepciones/2026-12-24`, duena.cookie, {
      motivo: 'Media jornada',
      tramos: [{ inicio: '07:00', fin: '12:00' }],
    });
    assert.equal(media.estado, 200, media.crudo);
    const libre = await llamar('PUT', `/api/configuracion/calendarios/${calendario}/excepciones/2026-12-26`, duena.cookie, { motivo: null, tramos: [] });
    assert.deepEqual(libre.cuerpo.excepciones, [
      { fecha: '2026-12-24', motivo: 'Media jornada', tramos: [{ inicio: '07:00', fin: '12:00' }], horas: '5.0' },
      { fecha: '2026-12-26', motivo: null, tramos: [], horas: '0.0' },
    ]);

    const otraVez = await llamar('PUT', `/api/configuracion/calendarios/${calendario}/excepciones/2026-12-24`, duena.cookie, { motivo: 'Jornada completa', tramos: OCHO_HORAS });
    assert.deepEqual(otraVez.cuerpo.excepciones[0], { fecha: '2026-12-24', motivo: 'Jornada completa', tramos: OCHO_HORAS, horas: '8.0' });

    const quitada = await llamar('DELETE', `/api/configuracion/calendarios/${calendario}/excepciones/2026-12-26`, duena.cookie);
    assert.equal(quitada.estado, 200, quitada.crudo);
    assert.deepEqual(quitada.cuerpo.excepciones.map((e: { fecha: string }) => e.fecha), ['2026-12-24']);
  });

  test('tramos de una excepción mal formados son 422 en tramos; una fecha que no es fecha, 422 en fecha', async () => {
    const cruzados = await llamar('PUT', `/api/configuracion/calendarios/${calendario}/excepciones/2026-12-28`, duena.cookie, {
      motivo: null,
      tramos: [{ inicio: '07:00', fin: '12:00' }, { inicio: '08:00', fin: '09:00' }],
    });
    assert.deepEqual([cruzados.estado, cruzados.cuerpo.campo], [422, 'tramos']);
    const sinFecha = await llamar('PUT', `/api/configuracion/calendarios/${calendario}/excepciones/2026-02-30`, duena.cookie, { motivo: null, tramos: [] });
    assert.deepEqual([sinFecha.estado, sinFecha.cuerpo.campo], [422, 'fecha']);
  });

  test('copiar los festivos de Colombia: cada uno queda no laborable, sin pisar lo que ya había, con su origen y su último año', async () => {
    // El 8 de diciembre de 2026 es festivo; la empresa decidió trabajarlo antes de copiar.
    await llamar('PUT', `/api/configuracion/calendarios/${calendario}/excepciones/2026-12-08`, duena.cookie, { motivo: 'Se trabaja', tramos: OCHO_HORAS });
    const lista = await listaDeColombia();
    const r = await llamar('POST', `/api/configuracion/calendarios/${calendario}/festivos`, duena.cookie, { listaId: lista, propia: false });
    assert.equal(r.estado, 200, r.crudo);
    assert.ok(r.cuerpo.copiados > 80, `copiados: ${r.cuerpo.copiados}`);
    assert.deepEqual(r.cuerpo.calendario.festivos.origen, { tipo: 'PLATAFORMA', id: lista, nombre: 'Festivos de Colombia' });
    // La lista es de toda la plataforma y la prueba del panel la extiende en
    // paralelo: el último año es 2030 o uno posterior, nunca menos.
    assert.ok(r.cuerpo.calendario.festivos.hasta >= 2030, String(r.cuerpo.calendario.festivos.hasta));
    const ocho = r.cuerpo.calendario.excepciones.find((e: { fecha: string }) => e.fecha === '2026-12-08');
    assert.deepEqual([ocho.motivo, ocho.horas], ['Se trabaja', '8.0']);
    const navidad = r.cuerpo.calendario.excepciones.find((e: { fecha: string }) => e.fecha === '2026-12-25');
    assert.deepEqual([navidad.tramos, navidad.horas], [[], '0.0']);
  });
});

describe('calendarios: permiso y aislamiento', () => {
  test('sin CONFIG.PREFERENCIAS no se escribe: 403', async () => {
    const duena = await registrar('Constructora Calendarios Permiso', '900000973-3', 'calendarios.permiso@construsoft.test');
    const sinPermiso = await asistenteCon(duena, 'calendarios.sinpermiso@construsoft.test', ['PRESUPUESTOS.VER']);
    const r = await llamar('POST', '/api/configuracion/calendarios', sinPermiso, { nombre: 'No', horasPorDia: '8', semana: LUNES_A_SABADO });
    assert.equal(r.estado, 403, r.crudo);
  });

  test('el calendario de otra empresa no existe: editarlo, marcarlo, eliminarlo o tocar sus excepciones es 404', async () => {
    const a = await registrar('Constructora Calendarios A', '900000974-4', 'calendarios.a@construsoft.test');
    const b = await registrar('Constructora Calendarios B', '900000975-5', 'calendarios.b@construsoft.test');
    const deA = await calendarioInicial(a);
    const lista = await listaDeColombia();
    for (const [metodo, url, cuerpo] of [
      ['PUT', `/api/configuracion/calendarios/${deA}`, { nombre: 'Robado', horasPorDia: '8', semana: LUNES_A_SABADO }],
      ['POST', `/api/configuracion/calendarios/${deA}/por-defecto`, undefined],
      ['DELETE', `/api/configuracion/calendarios/${deA}`, undefined],
      ['PUT', `/api/configuracion/calendarios/${deA}/excepciones/2026-12-24`, { motivo: null, tramos: [] }],
      ['DELETE', `/api/configuracion/calendarios/${deA}/excepciones/2026-12-24`, undefined],
      ['POST', `/api/configuracion/calendarios/${deA}/festivos`, { listaId: lista, propia: false }],
      ['PUT', '/api/configuracion/calendarios/no-es-un-id', { nombre: 'X', horasPorDia: '8', semana: LUNES_A_SABADO }],
    ] as const) {
      const r = await llamar(metodo, url, b.cookie, cuerpo);
      assert.equal(r.estado, 404, `${metodo} ${url}: ${r.crudo}`);
    }
    const intacto = await comoSuperusuario(async (c) => (await c.query('SELECT nombre, por_defecto FROM app.calendario WHERE id = $1', [deA])).rows[0]);
    assert.deepEqual(intacto, { nombre: 'Lunes a viernes', por_defecto: true });
  });
});
