import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { ejecutarConPermiso } from '../infraestructura/basedatos/contextoTenant.js';
import { crearPresupuesto } from '../infraestructura/basedatos/presupuesto.js';
import { agregarCapitulo, agregarSubcapitulo, eliminarNivel, moverEnEdt } from '../infraestructura/basedatos/edt.js';
import { agregarActividad, eliminarActividad } from '../infraestructura/basedatos/actividad.js';
import { activarPresupuesto } from '../infraestructura/basedatos/cicloDeVida.js';
import { armarPresupuestoDeReferencia, type PresupuestoDeReferencia } from '../pruebas/presupuestoDeReferencia.js';
import { vencerSuscripcion } from '../pruebas/superusuario.js';
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

interface Mesa {
  cabecera: Record<string, unknown> & { editable: boolean };
  nodos: { id: string; padreId: string | null; codigoWbs: string; nivel: number; posicion: number; nombre: string; clasificacion: string; montoAcumulado: string; incidenciaPct: string | null }[];
  actividades: { id: string; nodoId: string; codigoItem: string; posicion: number; codigoApu: string; descripcion: string; cantidad: string; costoTotal: string }[];
  pie: Record<string, unknown>;
}

const mesaDe = async (id: string, cookie: string) => {
  const r = await pedir(`/api/presupuestos/${id}/mesa`, cookie);
  return { estado: r.statusCode, cuerpo: r.json<Mesa & { mensaje?: string }>() };
};

/** Recorre el JSON entero: un número solo puede ser nivel o posicion. El dinero viaja como texto (contrato §1.1). */
function numerosFueraDeLugar(valor: unknown, clave = ''): string[] {
  if (typeof valor === 'number') return clave === 'nivel' || clave === 'posicion' ? [] : [clave];
  if (Array.isArray(valor)) return valor.flatMap((v) => numerosFueraDeLugar(v, clave));
  if (valor && typeof valor === 'object') return Object.entries(valor).flatMap(([k, v]) => numerosFueraDeLugar(v, k));
  return [];
}

describe('GET /api/presupuestos/:id/mesa: la lectura única de la mesa de trabajo (contrato §4.1)', () => {
  let duena: Cuenta;
  let referencia: PresupuestoDeReferencia;

  before(async () => {
    duena = await registrar('Constructora Mesa', '900000300-0', 'mesa.admin@construsoft.test');
    referencia = await armarPresupuestoDeReferencia(duena.contexto, 'MESA-RETIRO');
  });

  test('el presupuesto de referencia completo, en una sola respuesta, cierra en $180.590.155', async () => {
    const { estado, cuerpo } = await mesaDe(referencia.presupuestoId, duena.cookie);
    assert.equal(estado, 200);

    const { fechaElaboracion, fechaModificacion, id, ...cabecera } = cuerpo.cabecera;
    assert.equal(id, referencia.presupuestoId);
    assert.deepEqual(cabecera, {
      codigo: 'MESA-RETIRO',
      nombre: 'Casa campestre El Retiro',
      ubicacion: 'El Retiro, Antioquia',
      moneda: 'COP',
      estado: 'ABIERTO',
      modoEstructura: 'ITEMS',
      editable: true,
    });
    // Instantes ISO completos, no fechas sueltas: son timestamptz.
    for (const f of [fechaElaboracion, fechaModificacion]) assert.match(String(f), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/);

    assert.deepEqual(
      cuerpo.nodos.map((n) => [n.codigoWbs, n.posicion, n.nivel, n.nombre, n.clasificacion, n.padreId]),
      [
        ['1.0', 1, 1, 'PRELIMINARES', 'INDIRECTO', null],
        ['2.0', 2, 1, 'CIMENTACIÓN', 'DIRECTO', null],
        ['3.0', 3, 1, 'ESTRUCTURA', 'DIRECTO', null],
      ],
    );
    const preliminares = cuerpo.nodos[0]!;
    assert.equal(preliminares.montoAcumulado, '53000000.000000');

    assert.equal(cuerpo.actividades.length, 7);
    const capituloDe = new Map(cuerpo.nodos.map((n) => [n.id, n.codigoWbs]));
    assert.deepEqual(
      cuerpo.actividades.map((a) => [capituloDe.get(a.nodoId), a.codigoItem, a.posicion, a.descripcion]),
      [
        ['1.0', '1.1', 1, 'Topografía y replanteo'],
        ['1.0', '1.2', 2, 'Estudio de suelos'],
        ['1.0', '1.3', 3, 'Director de obra'],
        ['2.0', '2.1', 1, 'Excavación manual'],
        ['2.0', '2.2', 2, 'Concreto 3000 PSI para zapatas'],
        ['3.0', '3.1', 1, 'Acero de refuerzo 60.000 PSI'],
        ['3.0', '3.2', 2, 'Formaleta metálica'],
      ],
    );
    const concreto = cuerpo.actividades[4]!;
    assert.deepEqual(
      { cantidad: concreto.cantidad, costoTotal: concreto.costoTotal, codigoApu: concreto.codigoApu },
      { cantidad: '100.000000', costoTotal: '63675000.000000', codigoApu: referencia.concreto.codigo },
    );

    assert.deepEqual(cuerpo.pie, {
      costoIndirecto: '53000000.000000',
      costoDirecto: '105490000.000000',
      administracion: '10549000.000000',
      imprevistos: '5274500.000000',
      utilidad: '5274500.000000',
      aiu: '21098000.000000',
      iva: '1002155.000000',
      valorTotal: '180590155.000000',
      porcentajes: { a: '10.000000', i: '5.000000', u: '5.000000', iva: '19.000000' },
      aiuEnCero: false,
      sinBaseAiu: false,
    });

    assert.deepEqual(numerosFueraDeLugar(cuerpo), []);
  });

  test('posicion es la que acepta fn_mover_en_edt: mover cada hermano a su propia posición no cambia nada', async () => {
    const p = await crearPresupuesto(duena.contexto, { codigo: 'MESA-EMPATE', nombre: 'Empate', ubicacion: 'Rionegro', modoEstructura: 'WBS' });
    const capitulo = await agregarCapitulo(duena.contexto, p.id, { nombre: 'OBRA', clasificacion: 'DIRECTO' });
    await agregarActividad(duena.contexto, capitulo.id, referencia.concreto.id, '1');
    await agregarActividad(duena.contexto, capitulo.id, referencia.concreto.id, '2');
    // Un subcapítulo pedido con el MISMO orden que la primera actividad: la
    // base lo resuelve al renumerar, con el nodo primero.
    await ejecutarConPermiso(duena.contexto, 'PRESUPUESTOS.EDITAR', (c) =>
      c.query(
        `INSERT INTO app.wbs_nodo (tenant_id, presupuesto_id, padre_id, nombre, orden) VALUES ($1, $2, $3, 'EMPATADO', 1)`,
        [duena.contexto.tenantId, p.id, capitulo.id],
      ),
    );

    const { cuerpo } = await mesaDe(p.id, duena.cookie);
    const hijos = [
      ...cuerpo.nodos.filter((n) => n.padreId === capitulo.id).map((n) => [n.posicion, n.nombre]),
      ...cuerpo.actividades.filter((a) => a.nodoId === capitulo.id).map((a) => [a.posicion, a.cantidad]),
    ].sort((x, y) => Number(x[0]) - Number(y[0]));
    assert.deepEqual(hijos, [
      [1, 'EMPATADO'],
      [2, '1.000000'],
      [3, '2.000000'],
    ]);

    // Mover cada hermano a la posición que la mesa dice que tiene no cambia nada.
    const codigos = (m: Mesa) => [...m.nodos.map((n) => `${n.id}:${n.codigoWbs}`), ...m.actividades.map((a) => `${a.id}:${a.codigoItem}`)].sort();
    const antes = codigos(cuerpo);
    for (const x of [...cuerpo.nodos, ...cuerpo.actividades]) await moverEnEdt(duena.contexto, x.id, x.posicion);
    assert.deepEqual(codigos((await mesaDe(p.id, duena.cookie)).cuerpo), antes);
  });

  // El desempate de posicion (es_nodo DESC) no se puede observar mientras se
  // cumpla este invariante: después de cada sentencia, los orden de los hijos
  // de un mismo padre —nodos y actividades juntos— son exactamente 1 a n, sin
  // huecos ni repetidos, porque fn_renumerar_wbs los normaliza. Se prueba el
  // invariante y no el desempate: el día que la renumeración deje de
  // normalizar, esta prueba falla y señala ese lugar, y entonces el desempate
  // de la mesa empieza a importar.
  const ordenesPorPadre = (presupuestoId: string) =>
    ejecutarConPermiso(duena.contexto, 'PRESUPUESTOS.VER', async (c) => {
      const { rows } = await c.query<{ padre: string | null; ordenes: number[]; codigos: string[] }>(
        `SELECT padre, array_agg(orden ORDER BY orden, codigo) AS ordenes, array_agg(codigo ORDER BY orden, codigo) AS codigos
           FROM (SELECT n.padre_id AS padre, n.orden, n.codigo_wbs AS codigo FROM app.wbs_nodo n WHERE n.presupuesto_id = $1
                 UNION ALL
                 SELECT i.wbs_nodo_id, i.orden, i.codigo_item FROM app.presupuesto_item i WHERE i.presupuesto_id = $1) h
          GROUP BY padre`,
        [presupuestoId],
      );
      return rows;
    });
  const exigirInvariante = async (presupuestoId: string, despuesDe: string) => {
    for (const { padre, ordenes, codigos } of await ordenesPorPadre(presupuestoId)) {
      const esperado = Array.from({ length: ordenes.length }, (_, k) => k + 1);
      assert.deepEqual(
        ordenes,
        esperado,
        `después de ${despuesDe}, los hijos de ${padre ?? 'la raíz'} quedaron con orden ${ordenes.join(',')} y códigos ${codigos.join(' ')}`,
      );
    }
  };

  test('invariante: tras cada sentencia, los orden de los hermanos son exactamente 1 a n', async () => {
    const p = await crearPresupuesto(duena.contexto, { codigo: 'MESA-INV', nombre: 'Invariante', ubicacion: 'Envigado', modoEstructura: 'WBS' });
    const obra = await agregarCapitulo(duena.contexto, p.id, { nombre: 'OBRA', clasificacion: 'DIRECTO' });
    const a1 = await agregarActividad(duena.contexto, obra.id, referencia.concreto.id, '1');
    await agregarActividad(duena.contexto, obra.id, referencia.concreto.id, '2');
    await agregarCapitulo(duena.contexto, p.id, { nombre: 'ADMINISTRACIÓN', clasificacion: 'INDIRECTO' });
    await exigirInvariante(p.id, 'agregar al final');

    // Un orden pedido explícitamente: uno empatado con a1 y otro con hueco.
    const conOrden = (nombre: string, orden: number) =>
      ejecutarConPermiso(duena.contexto, 'PRESUPUESTOS.EDITAR', (c) =>
        c.query(`INSERT INTO app.wbs_nodo (tenant_id, presupuesto_id, padre_id, nombre, orden) VALUES ($1, $2, $3, $4, $5)`, [
          duena.contexto.tenantId,
          p.id,
          obra.id,
          nombre,
          orden,
        ]),
      );
    await conOrden('EMPATADO', 1);
    await exigirInvariante(p.id, 'insertar con un orden repetido');
    await conOrden('LEJANO', 40);
    await exigirInvariante(p.id, 'insertar con un orden que deja hueco');

    await moverEnEdt(duena.contexto, a1.id, 4);
    await exigirInvariante(p.id, 'mover una actividad');
    await eliminarActividad(duena.contexto, a1.id);
    await exigirInvariante(p.id, 'eliminar una actividad del medio');
  });

  // D-69. fn_renumerar_wbs numeraba en dos pasadas y la de actividades leía
  // los orden que la de nodos ya había reescrito: al borrar S de [S, X, T],
  // T y X quedaban con el mismo código. La precondición con dientes es un
  // subárbol LIMPIO —nada movido antes— con [nodo, actividad, nodo]: un
  // árbol ya movido deshace la configuración y la prueba pasaría también con
  // el esquema roto.
  test(
    'invariante al borrar el primer nodo de un subárbol limpio [nodo, actividad, nodo] (D-69)',
    async () => {
      const p = await crearPresupuesto(duena.contexto, { codigo: 'MESA-INV2', nombre: 'Invariante 2', ubicacion: 'Sabaneta', modoEstructura: 'WBS' });
      const c = await agregarCapitulo(duena.contexto, p.id, { nombre: 'C', clasificacion: 'DIRECTO' });
      const s = await agregarSubcapitulo(duena.contexto, c.id, { nombre: 'S' });
      await agregarActividad(duena.contexto, c.id, referencia.concreto.id, '1');
      await agregarSubcapitulo(duena.contexto, c.id, { nombre: 'T' });
      await exigirInvariante(p.id, 'armar [S, X, T]');
      await eliminarNivel(duena.contexto, s.id);
      await exigirInvariante(p.id, 'borrar S de [S, X, T]');
    },
  );

  test('con solo PRESUPUESTOS.VER se lee entera, y editable es false', async () => {
    const cookie = await asistenteCon(duena, 'mesa.lector@construsoft.test', ['PRESUPUESTOS.VER']);
    const { estado, cuerpo } = await mesaDe(referencia.presupuestoId, cookie);
    assert.equal(estado, 200);
    assert.equal(cuerpo.cabecera.editable, false);
    assert.equal(cuerpo.pie.valorTotal, '180590155.000000');
  });

  test('sin PRESUPUESTOS.VER: 403 con el nombre del permiso que falta', async () => {
    const cookie = await asistenteCon(duena, 'mesa.sinver@construsoft.test', ['APU.VER']);
    const { estado, cuerpo } = await mesaDe(referencia.presupuestoId, cookie);
    assert.equal(estado, 403);
    assert.match(cuerpo.mensaje!, /PRESUPUESTOS\.VER/);
  });

  test('sin sesión: 401', async () => {
    assert.equal((await pedir(`/api/presupuestos/${referencia.presupuestoId}/mesa`)).statusCode, 401);
  });

  test('un presupuesto ACTIVO se lee, y no es editable', async () => {
    const p = await armarPresupuestoDeReferencia(duena.contexto, 'MESA-ACTIVO');
    await activarPresupuesto(duena.contexto, p.presupuestoId);
    const { estado, cuerpo } = await mesaDe(p.presupuestoId, duena.cookie);
    assert.deepEqual([estado, cuerpo.cabecera.estado, cuerpo.cabecera.editable], [200, 'ACTIVO', false]);
  });
});

describe('la mesa con la suscripción vencida: se lee, y no es editable (D-65)', () => {
  test('200 con editable false, aunque el presupuesto esté Abierto y el rol pueda editar', async () => {
    const vencida = await registrar('Constructora Mesa Vencida', '900000301-1', 'mesa.vencida@construsoft.test');
    const p = await crearPresupuesto(vencida.contexto, { codigo: 'MESA-V', nombre: 'Vencido', ubicacion: 'Medellín', modoEstructura: 'WBS' });
    await vencerSuscripcion(vencida.contexto.tenantId);
    const { estado, cuerpo } = await mesaDe(p.id, vencida.cookie);
    assert.deepEqual([estado, cuerpo.cabecera.estado, cuerpo.cabecera.editable], [200, 'ABIERTO', false]);
  });
});

describe('aislamiento: la mesa de otra empresa no existe (RN-01)', () => {
  test('un id de B, uno inexistente y uno que no es un id responden el mismo 404', async () => {
    const a = await registrar('Constructora Mesa A', '900000302-2', 'mesa.a@construsoft.test');
    const b = await registrar('Constructora Mesa B', '900000303-3', 'mesa.b@construsoft.test');
    const deB = await armarPresupuestoDeReferencia(b.contexto, 'MESA-B');

    const respuestas = await Promise.all(
      [deB.presupuestoId, '01900000-0000-7000-8000-000000000000', 'no-es-un-id'].map(async (id) => {
        const r = await pedir(`/api/presupuestos/${id}/mesa`, a.cookie);
        return [r.statusCode, r.body];
      }),
    );
    assert.equal(respuestas[0]![0], 404);
    assert.deepEqual(respuestas[1], respuestas[0]);
    assert.deepEqual(respuestas[2], respuestas[0]);
    assert.doesNotMatch(String(respuestas[0]![1]), /180590155|MESA-B/);
  });
});
