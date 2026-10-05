import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ejecutarConPermiso,
  registrarEmpresa,
  type ClienteEnContexto,
  type EmpresaRegistrada,
} from './contextoTenant.js';
import {
  actualizarDatosEmpresa,
  actualizarPreferencias,
  crearUnidad,
  actualizarUnidad,
  eliminarUnidad,
  leerDatosEmpresa,
  leerPreferencias,
  leerSuscripcion,
  listarUnidades,
} from './configuracionEmpresa.js';
import { comoSuperusuario, vencerSuscripcion } from '../../pruebas/superusuario.js';
import { crearRecurso } from './recurso.js';

/**
 * Mismo patrón de fixtures que contextoTenant.test.ts, repetido acá a
 * propósito en vez de importado: cada archivo de prueba de este proyecto es
 * autocontenido (autenticacion.test.ts y contextoTenant.test.ts ya lo hacen
 * así), y email/NIT son distintos de los que usan los demás archivos porque
 * todos pueden correr contra la misma construsoft_test en la misma corrida.
 */
async function registrarEmpresaDePrueba(
  razonSocial: string,
  nit: string,
  email: string,
): Promise<EmpresaRegistrada> {
  return registrarEmpresa({
    razonSocial,
    nit,
    plan: 'EMPRESARIAL',
    adminNombre: `Admin de ${razonSocial}`,
    adminEmail: email,
    adminHash: 'hash_de_prueba_no_real',
    versionTerminos: 'terminos-de-prueba',
  });
}

/**
 * El nombre dice lo que es —montaje de escenario, no el caso bajo prueba—,
 * no un comentario aparte: quien lea una prueba que la usa no confunde
 * USUARIOS.GESTIONAR (el permiso que pasa por dentro, porque el
 * administrador ya lo tiene) con el permiso que esa prueba está afirmando.
 */
async function montarEscenarioComoAdmin<T>(
  empresa: EmpresaRegistrada,
  operacion: (cliente: ClienteEnContexto) => Promise<T>,
): Promise<T> {
  return ejecutarConPermiso(
    { tenantId: empresa.tenantId, usuarioId: empresa.usuarioId },
    'USUARIOS.GESTIONAR',
    operacion,
  );
}

/** El rol Asistente nace con fn_alta_tenant sin ningún permiso (D-44): el fixture "sin permiso" listo para usar. */
async function crearAsistente(
  empresa: EmpresaRegistrada,
  email: string,
  nombre: string,
): Promise<string> {
  return montarEscenarioComoAdmin(empresa, async (cliente) => {
    const { rows: roles } = await cliente.query<{ id: string }>(
      `SELECT id FROM app.rol WHERE tenant_id = $1 AND tipo = 'ASISTENTE'`,
      [empresa.tenantId],
    );
    const rolAsistenteId = roles[0]!.id;
    const { rows } = await cliente.query<{ id: string }>(
      `INSERT INTO app.usuario (tenant_id, rol_id, nombre, email, password_hash, estado)
       VALUES ($1, $2, $3, $4, 'hash_de_prueba_no_real', 'ACTIVO')
       RETURNING id`,
      [empresa.tenantId, rolAsistenteId, nombre, email],
    );
    return rows[0]!.id;
  });
}

describe('CONFIG.EMPRESA', () => {
  let empresaA: EmpresaRegistrada;
  let asistenteId: string;

  before(async () => {
    empresaA = await registrarEmpresaDePrueba(
      'Constructora Config A',
      '900000020-0',
      'noe@construsoft.test',
    );
    asistenteId = await crearAsistente(empresaA, 'noelia@construsoft.test', 'Noelia Asistente');
  });

  test('con el permiso: leer y actualizar funcionan, y el cambio se refleja en la siguiente lectura', async () => {
    const contexto = { tenantId: empresaA.tenantId, usuarioId: empresaA.usuarioId };

    const antes = await leerDatosEmpresa(contexto);
    assert.equal(antes.razonSocial, 'Constructora Config A');
    assert.equal(antes.logoRuta, null);

    await actualizarDatosEmpresa(contexto, {
      ...antes,
      direccion: 'Cra 10 # 20-30',
      telefono: '3001234567',
      logoRuta: 'empresas/logo-config-a.png',
    });

    const despues = await leerDatosEmpresa(contexto);
    assert.equal(despues.direccion, 'Cra 10 # 20-30');
    assert.equal(despues.telefono, '3001234567');
    assert.equal(despues.logoRuta, 'empresas/logo-config-a.png');
    // Lo que la actualización no tocó sigue igual.
    assert.equal(despues.razonSocial, antes.razonSocial);
    assert.equal(despues.nit, antes.nit);
  });

  test('sin CONFIG.EMPRESA: ni leer ni actualizar corren', async () => {
    const contextoAsistente = { tenantId: empresaA.tenantId, usuarioId: asistenteId };

    await assert.rejects(leerDatosEmpresa(contextoAsistente), /CONFIG\.EMPRESA/);
    await assert.rejects(
      actualizarDatosEmpresa(contextoAsistente, {
        razonSocial: 'no debería aplicarse',
        nit: '000',
        logoRuta: null,
        direccion: null,
        telefono: null,
        emailRecuperacion: null,
      }),
      /CONFIG\.EMPRESA/,
    );

    // La comprobación de verdad: el rechazo no dejó rastro en la base.
    const sigueIgual = await leerDatosEmpresa({
      tenantId: empresaA.tenantId,
      usuarioId: empresaA.usuarioId,
    });
    assert.notEqual(sigueIgual.razonSocial, 'no debería aplicarse');
  });

  test('aislamiento: el permiso de una empresa no alcanza para leer ni tocar los datos de otra', async () => {
    const empresaB = await registrarEmpresaDePrueba(
      'Constructora Config B',
      '900000021-1',
      'oto@construsoft.test',
    );

    // El administrador de B tiene CONFIG.EMPRESA de verdad, pero en SU
    // PROPIA empresa. Mezclado con el tenant de A, RLS esconde su fila de
    // app.usuario y fn_exigir_permiso falla cerrado.
    await assert.rejects(
      leerDatosEmpresa({ tenantId: empresaA.tenantId, usuarioId: empresaB.usuarioId }),
      /no existe en esta empresa/,
    );

    // Y en su propia empresa, a B no le pasó nada.
    const datosB = await leerDatosEmpresa({
      tenantId: empresaB.tenantId,
      usuarioId: empresaB.usuarioId,
    });
    assert.equal(datosB.razonSocial, 'Constructora Config B');
  });
});

describe('CONFIG.PREFERENCIAS', () => {
  let empresaC: EmpresaRegistrada;
  let asistenteId: string;

  before(async () => {
    empresaC = await registrarEmpresaDePrueba(
      'Constructora Config C',
      '900000022-2',
      'paula@construsoft.test',
    );
    asistenteId = await crearAsistente(empresaC, 'patricia@construsoft.test', 'Patricia Asistente');
  });

  test('con el permiso: leer y actualizar preferencias, y el cambio se refleja', async () => {
    const contexto = { tenantId: empresaC.tenantId, usuarioId: empresaC.usuarioId };

    const antes = await leerPreferencias(contexto);
    assert.equal(antes.monedaBase, 'COP');
    assert.equal(antes.separadorMiles, '.');
    assert.equal(antes.separadorDecimal, ',');
    assert.equal(antes.decimalesVista, 2);

    await actualizarPreferencias(contexto, {
      ...antes,
      separadorMiles: ' ',
      separadorDecimal: '.',
      decimalesVista: 0,
      notifVencimiento: false,
    });

    const despues = await leerPreferencias(contexto);
    assert.equal(despues.separadorMiles, ' ');
    assert.equal(despues.separadorDecimal, '.');
    assert.equal(despues.decimalesVista, 0);
    assert.equal(despues.notifVencimiento, false);
    // No se tocó, sigue igual.
    assert.equal(despues.notifCambioEstado, antes.notifCambioEstado);
  });

  test('separadores iguales: la base lo rechaza tal cual (CHECK de la tabla)', async () => {
    const contexto = { tenantId: empresaC.tenantId, usuarioId: empresaC.usuarioId };
    const actuales = await leerPreferencias(contexto);
    await assert.rejects(
      actualizarPreferencias(contexto, { ...actuales, separadorMiles: '.', separadorDecimal: '.' }),
      /configuracion_empresa/,
    );
  });

  test('sin CONFIG.PREFERENCIAS: ni leer preferencias ni las operaciones de unidades corren', async () => {
    const contextoAsistente = { tenantId: empresaC.tenantId, usuarioId: asistenteId };

    await assert.rejects(leerPreferencias(contextoAsistente), /CONFIG\.PREFERENCIAS/);
    await assert.rejects(listarUnidades(contextoAsistente), /CONFIG\.PREFERENCIAS/);
    await assert.rejects(
      crearUnidad(contextoAsistente, { simbolo: 'xx', descripcion: 'no debería crearse' }),
      /CONFIG\.PREFERENCIAS/,
    );

    const unidades = await listarUnidades({
      tenantId: empresaC.tenantId,
      usuarioId: empresaC.usuarioId,
    });
    assert.ok(!unidades.some((unidad) => unidad.simbolo === 'xx'));
  });

  test('unidades de medida: crear, listar y eliminar', async () => {
    const contexto = { tenantId: empresaC.tenantId, usuarioId: empresaC.usuarioId };

    // 'plg' no está entre las doce unidades estándar que fn_alta_tenant ya
    // precargó (D-15: m, m², m³, Kg, Und, Hr, Jr, Glb, Gal, Lt, Ms, X).
    const creada = await crearUnidad(contexto, { simbolo: 'plg', descripcion: 'Pulgada' });
    assert.ok(creada.id);

    const unidades = await listarUnidades(contexto);
    assert.ok(unidades.some((unidad) => unidad.id === creada.id && unidad.simbolo === 'plg'));

    await eliminarUnidad(contexto, creada.id);
    const despuesDeEliminar = await listarUnidades(contexto);
    assert.ok(!despuesDeEliminar.some((unidad) => unidad.id === creada.id));
  });

  test('el símbolo repetido sin distinguir mayúsculas lo rechaza la base (D-31)', async () => {
    const contexto = { tenantId: empresaC.tenantId, usuarioId: empresaC.usuarioId };
    await crearUnidad(contexto, { simbolo: 'Pza', descripcion: 'Pieza' });
    await assert.rejects(
      crearUnidad(contexto, { simbolo: 'pza', descripcion: 'pieza duplicada' }),
      /ux_unidad_simbolo/,
    );
  });

  test('editar una unidad: símbolo y descripción, con la misma validación de duplicado (02 §11.6)', async () => {
    const contexto = { tenantId: empresaC.tenantId, usuarioId: empresaC.usuarioId };
    const creada = await crearUnidad(contexto, { simbolo: 'cm', descripcion: 'Centimetro' });
    const editada = await actualizarUnidad(contexto, creada.id, { simbolo: 'cm', descripcion: 'Centímetro' });
    assert.deepEqual(editada, { id: creada.id, simbolo: 'cm', descripcion: 'Centímetro' });
    await assert.rejects(actualizarUnidad(contexto, creada.id, { simbolo: 'KG', descripcion: 'x' }), /ux_unidad_simbolo/);
    assert.equal(await actualizarUnidad(contexto, '01900000-0000-7000-8000-000000000000', { simbolo: 'z', descripcion: 'z' }), null);
  });

  test('una unidad en uso no se elimina, y el mensaje dice dónde: no es una llave foránea rota', async () => {
    const contexto = { tenantId: empresaC.tenantId, usuarioId: empresaC.usuarioId };
    const unidad = await crearUnidad(contexto, { simbolo: 'rollo', descripcion: 'Rollo' });
    await crearRecurso(contexto, {
      nombre: 'Malla', tipo: 'MATERIAL', unidadId: unidad.id, precioBase: '1', ivaPct: '0', precioTotal: '1', viaCaptura: 'BASE',
    });
    await assert.rejects(eliminarUnidad(contexto, unidad.id), /«rollo» está en uso en 1 recurso/);
    assert.ok((await listarUnidades(contexto)).some((u) => u.id === unidad.id));
  });

  test('aislamiento: las preferencias y unidades de una empresa no se tocan desde otra', async () => {
    const empresaD = await registrarEmpresaDePrueba(
      'Constructora Config D',
      '900000023-3',
      'quique@construsoft.test',
    );

    await assert.rejects(
      leerPreferencias({ tenantId: empresaC.tenantId, usuarioId: empresaD.usuarioId }),
      /no existe en esta empresa/,
    );

    // Una unidad creada en D no aparece al listar desde C, aunque los dos
    // administradores tengan CONFIG.PREFERENCIAS, cada uno en su empresa.
    const unidadD = await crearUnidad(
      { tenantId: empresaD.tenantId, usuarioId: empresaD.usuarioId },
      { simbolo: 'ton', descripcion: 'Tonelada' },
    );
    const unidadesDesdeC = await listarUnidades({
      tenantId: empresaC.tenantId,
      usuarioId: empresaC.usuarioId,
    });
    assert.ok(!unidadesDesdeC.some((unidad) => unidad.id === unidadD.id));
  });
});

describe('CONFIG.SUSCRIPCION', () => {
  let empresaE: EmpresaRegistrada;
  let asistenteId: string;

  before(async () => {
    empresaE = await registrarEmpresaDePrueba(
      'Constructora Config E',
      '900000024-4',
      'renata@construsoft.test',
    );
    asistenteId = await crearAsistente(empresaE, 'ramiro@construsoft.test', 'Ramiro Asistente');
  });

  test('con el permiso: lee el plan de prueba que fn_alta_tenant creó, sin pagos todavía', async () => {
    const suscripcion = await leerSuscripcion({
      tenantId: empresaE.tenantId,
      usuarioId: empresaE.usuarioId,
    });
    assert.equal(suscripcion.plan, 'EMPRESARIAL');
    assert.equal(suscripcion.estado, 'EN_PRUEBA');
    assert.deepEqual(suscripcion.pagos, []);
  });

  test('la fecha de vencimiento viaja como texto aaaa-mm-dd, y los días restantes los calcula la base', async () => {
    const s = await leerSuscripcion({ tenantId: empresaE.tenantId, usuarioId: empresaE.usuarioId });
    assert.match(s.venceEl!, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(typeof s.diasRestantes, 'number');
  });

  test('una suscripción vencida se consulta: estado VENCIDA, no un error (02 §11.3)', async () => {
    const vencida = await registrarEmpresaDePrueba('Constructora Config Vencida', '900000027-7', 'vencida.config@construsoft.test');
    await vencerSuscripcion(vencida.tenantId);
    const s = await leerSuscripcion({ tenantId: vencida.tenantId, usuarioId: vencida.usuarioId });
    assert.deepEqual([s.estado, s.plan], ['VENCIDA', 'EMPRESARIAL']);
    assert.ok(s.diasRestantes! < 0);
  });

  test('una suscripción cancelada se consulta: estado CANCELADA, no un error', async () => {
    const cancelada = await registrarEmpresaDePrueba('Constructora Config Cancelada', '900000028-8', 'cancelada.config@construsoft.test');
    await comoSuperusuario((c) => c.query(`UPDATE plataforma.suscripcion SET estado = 'CANCELADA', cancelada_en = now() WHERE tenant_id = $1`, [cancelada.tenantId]));
    const s = await leerSuscripcion({ tenantId: cancelada.tenantId, usuarioId: cancelada.usuarioId });
    assert.equal(s.estado, 'CANCELADA');
  });

  test('sin CONFIG.SUSCRIPCION: no puede consultarla', async () => {
    await assert.rejects(
      leerSuscripcion({ tenantId: empresaE.tenantId, usuarioId: asistenteId }),
      /CONFIG\.SUSCRIPCION/,
    );
  });

  test('aislamiento: no ve la suscripción de otra empresa', async () => {
    const empresaF = await registrarEmpresaDePrueba(
      'Constructora Config F',
      '900000025-5',
      'sofia@construsoft.test',
    );

    await assert.rejects(
      leerSuscripcion({ tenantId: empresaE.tenantId, usuarioId: empresaF.usuarioId }),
      /no existe en esta empresa/,
    );

    const propia = await leerSuscripcion({
      tenantId: empresaF.tenantId,
      usuarioId: empresaF.usuarioId,
    });
    assert.equal(propia.plan, 'EMPRESARIAL');
  });
});
