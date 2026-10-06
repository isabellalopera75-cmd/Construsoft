import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import {
  CODIGOS_PERMISO,
  type ClienteEnContexto,
  type CodigoPermiso,
  actualizarHashAlIngresar,
  consumirTokenRecuperacion,
  ejecutarConPermiso,
  emitirTokenRecuperacion,
  leerArranqueDeSesion,
  registrarEmpresa,
  selloVigente,
} from './contextoTenant.js';
import { autenticar, resolverToken } from './autenticacion.js';
import { comoSuperusuario, vencerSuscripcion } from '../../pruebas/superusuario.js';

/**
 * Fixtures de esta prueba: dos empresas reales, registradas con
 * registrarEmpresa — la función bajo prueba en la otra mitad de este
 * archivo. Hasta D-51, fn_alta_tenant devolvía solo el tenant_id y sembrar
 * necesitaba un rol SUPERUSER aparte para resolver el usuario_id del
 * administrador sin que RLS se metiera en el medio. Ya no: los tres ids
 * salen de la misma llamada, así que el fixture usa el mismo camino que
 * usaría la aplicación real.
 *
 * Valores fijos, no sufijos aleatorios: construsoft_test se rehace desde
 * cero antes de cada suite (scripts/resetear-base-pruebas.sh, enganchado
 * como pretest), así que no hay nada previo con qué chocar en un UNIQUE. No
 * se usa app.fn_eliminar_tenant para "limpiar" — exige 10 días de prueba
 * vencida (D-14, RF-SAD-13) a propósito, y esta base desechable resuelve el
 * problema sin tocar esa puerta.
 *
 * Email/NIT distintos de los que usa autenticacion.test.ts: ambos archivos
 * pueden correr contra la misma construsoft_test en la misma corrida.
 */
interface EmpresaDePrueba {
  tenantId: string;
  usuarioId: string;
  rolAdminId: string;
  razonSocial: string;
  email: string;
}

async function registrarEmpresaDePrueba(
  razonSocial: string,
  nit: string,
  email: string,
): Promise<EmpresaDePrueba> {
  const alta = await registrarEmpresa({
    razonSocial,
    nit,
    plan: 'EMPRESARIAL',
    adminNombre: `Admin de ${razonSocial}`,
    adminEmail: email,
    adminHash: 'hash_de_prueba_no_real',
    versionTerminos: 'terminos-de-prueba',
  });
  return { ...alta, razonSocial, email };
}

/**
 * Todas las operaciones de preparación de este archivo las hace el propio
 * administrador de la empresa, que gracias a fn_alta_tenant nace con los 18
 * permisos. El nombre dice lo que es: montaje de escenario, no el caso bajo
 * prueba. Antes se llamaba comoAdmin, y a través de ese nombre neutro
 * declaraba USUARIOS.GESTIONAR como si fuera parte de la aserción —quien
 * leyera la prueba no podía distinguir "esto exige ese permiso" de "esto es
 * ruido de montaje"—. USUARIOS.GESTIONAR sigue siendo el permiso que pasa
 * por dentro (el administrador ya lo tiene, y es de los 18 el más cercano a
 * lo que estas fixtures hacen), pero ya no hace falta leer el cuerpo de la
 * función para saber que es incidental.
 */
async function montarEscenarioComoAdmin<T>(
  empresa: EmpresaDePrueba,
  operacion: (cliente: ClienteEnContexto) => Promise<T>,
): Promise<T> {
  return ejecutarConPermiso(
    { tenantId: empresa.tenantId, usuarioId: empresa.usuarioId },
    'USUARIOS.GESTIONAR',
    operacion,
  );
}

/**
 * El rol Asistente nace con fn_alta_tenant sin ningún permiso (comentario de
 * la propia función, RN-11/§9 documento 01): es el fixture "sin permiso"
 * listo para usar, sin tocar la base a mano. Devuelve el id del usuario
 * ACTIVO que queda con ese rol.
 */
async function crearAsistente(
  empresa: EmpresaDePrueba,
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

let empresaA: EmpresaDePrueba;
let empresaB: EmpresaDePrueba;

describe('ejecutarConPermiso — el motor común (transacción, contexto, rollback)', () => {
  before(async () => {
    empresaA = await registrarEmpresaDePrueba(
      'Constructora Test A',
      '900000001-1',
      'ana@construsoft.test',
    );
    empresaB = await registrarEmpresaDePrueba(
      'Constructora Test B',
      '800000002-2',
      'beto@construsoft.test',
    );
  });

  // Este describe prueba a ejecutarConPermiso mismo (vía el motor que
  // comparte con ejecutarSinPermiso), así que lo llama directo con un
  // permiso real y explícito — RECURSOS.VER, sin significado especial acá
  // más que "uno que el administrador realmente tiene" — en vez de esconderlo
  // detrás de un helper de fixture, que es para cuando el permiso NO es parte
  // de lo que la prueba afirma.
  test('cada empresa ve su propia razón social y ninguna otra (RN-01)', async () => {
    const vistaDesdeA = await ejecutarConPermiso(
      { tenantId: empresaA.tenantId, usuarioId: empresaA.usuarioId },
      'RECURSOS.VER',
      async (cliente) => {
        const { rows } = await cliente.query<{ razon_social: string }>(
          'SELECT razon_social FROM plataforma.tenant',
        );
        return rows;
      },
    );
    assert.deepEqual(vistaDesdeA.map((f) => f.razon_social), [empresaA.razonSocial]);

    const vistaDesdeB = await ejecutarConPermiso(
      { tenantId: empresaB.tenantId, usuarioId: empresaB.usuarioId },
      'RECURSOS.VER',
      async (cliente) => {
        const { rows } = await cliente.query<{ razon_social: string }>(
          'SELECT razon_social FROM plataforma.tenant',
        );
        return rows;
      },
    );
    assert.deepEqual(vistaDesdeB.map((f) => f.razon_social), [empresaB.razonSocial]);
  });

  test('fija app.usuario_id: fn_usuario_actual() devuelve exactamente el usuarioId del contexto', async () => {
    const usuarioVisto = await ejecutarConPermiso(
      { tenantId: empresaA.tenantId, usuarioId: empresaA.usuarioId },
      'RECURSOS.VER',
      async (cliente) => {
        const { rows } = await cliente.query<{ fn_usuario_actual: string }>(
          'SELECT app.fn_usuario_actual()',
        );
        return rows[0]!.fn_usuario_actual;
      },
    );
    assert.equal(usuarioVisto, empresaA.usuarioId);
  });

  test('hace ROLLBACK si la operación lanza, y libera el cliente de todos modos', async () => {
    await assert.rejects(
      ejecutarConPermiso(
        { tenantId: empresaA.tenantId, usuarioId: empresaA.usuarioId },
        'RECURSOS.VER',
        async () => {
          throw new Error('falla deliberada de la prueba');
        },
      ),
      /falla deliberada de la prueba/,
    );

    // Si el cliente hubiera quedado sin liberar, este segundo llamado se
    // colgaría esperando una conexión libre del pool en vez de resolver.
    const siguePudiendoConsultar = await ejecutarConPermiso(
      { tenantId: empresaA.tenantId, usuarioId: empresaA.usuarioId },
      'RECURSOS.VER',
      async (cliente) => {
        const { rows } = await cliente.query('SELECT 1 AS ok');
        return rows[0]!.ok;
      },
    );
    assert.equal(siguePudiendoConsultar, 1);
  });

  test('rechaza un tenantId que no es UUID en vez de mandarlo a la base', async () => {
    await assert.rejects(
      ejecutarConPermiso(
        { tenantId: 'no-es-un-uuid', usuarioId: empresaA.usuarioId },
        'RECURSOS.VER',
        async () => {
          throw new Error('no debería llegar a ejecutar la operación');
        },
      ),
      /tenantId/,
    );
  });
});

describe('registrarEmpresa', () => {
  test('devuelve los tres ids reales y coherentes entre sí (D-51)', async () => {
    const empresa = await registrarEmpresaDePrueba(
      'Constructora Test C',
      '900000004-4',
      'diego@construsoft.test',
    );

    const filaUsuario = await montarEscenarioComoAdmin(empresa, async (cliente) => {
      const { rows } = await cliente.query<{ nombre: string; rol_id: string }>(
        'SELECT nombre, rol_id FROM app.usuario WHERE id = $1',
        [empresa.usuarioId],
      );
      return rows[0];
    });

    assert.ok(filaUsuario);
    assert.equal(filaUsuario.nombre, 'Admin de Constructora Test C');
    assert.equal(filaUsuario.rol_id, empresa.rolAdminId);
  });

  // Esto es lo que reemplaza al paso en dos tiempos (registrar y después
  // llamar a autenticar para descubrir la identidad): ya no hace falta.
  // Esta prueba no ejercita ese camino — confirma que, aparte, el correo
  // recién registrado funciona con el camino real de login, sin relación
  // con cómo registrarEmpresa obtuvo sus ids.
  test('el correo registrado se autentica después con el mismo tenantId/usuarioId', async () => {
    const empresa = await registrarEmpresaDePrueba(
      'Constructora Test D',
      '900000005-5',
      'elena@construsoft.test',
    );

    const resultado = await autenticar(empresa.email);

    assert.ok(resultado);
    assert.equal(resultado.tenantId, empresa.tenantId);
    assert.equal(resultado.usuarioId, empresa.usuarioId);
    assert.equal(resultado.estado, 'ACTIVO');
  });

  test('deja firmada la aceptación de los términos, con su versión, en la misma transacción del alta (Ley 1581, 04 §7)', async () => {
    const empresa = await registrarEmpresaDePrueba('Constructora Test Terminos', '900000018-8', 'teresa@construsoft.test');
    const fila = await comoSuperusuario(async (cliente) => {
      const { rows } = await cliente.query<{ acepto: boolean; version: string }>(
        `SELECT acepto_terminos_en IS NOT NULL AS acepto, version_terminos AS version
           FROM plataforma.tenant WHERE id = $1`,
        [empresa.tenantId],
      );
      return rows[0];
    });
    assert.deepEqual(fila, { acepto: true, version: 'terminos-de-prueba' });
  });

  test('sin versión de términos no hay empresa: se rechaza antes de tocar la base', async () => {
    await assert.rejects(
      registrarEmpresa({
        razonSocial: 'Constructora Sin Terminos',
        nit: '900000019-9',
        plan: 'EMPRESARIAL',
        adminNombre: 'Nadie',
        adminEmail: 'sin.terminos@construsoft.test',
        adminHash: 'hash_de_prueba_no_real',
        versionTerminos: '   ',
      }),
      /aceptación de los términos/,
    );
    assert.equal(await autenticar('sin.terminos@construsoft.test'), null);
  });

  test('propaga el error de la base tal cual (NIT vacío, D-34)', async () => {
    await assert.rejects(
      registrarEmpresa({
        razonSocial: 'Constructora Sin NIT',
        nit: '',
        plan: 'EMPRESARIAL',
        adminNombre: 'Nadie',
        adminEmail: 'nadie@construsoft.test',
        adminHash: 'hash_de_prueba_no_real',
        versionTerminos: 'terminos-de-prueba',
      }),
      /NIT de la empresa es obligatorio/,
    );
  });
});

/**
 * Los tres verificadores que CLAUDE.md exige en cero antes de dar algo por
 * terminado. Hasta D-54 ninguno corría en esta suite: fn_verificar_rls solo
 * se ejecutaba al cargar el esquema, y ese NOTICE no hace fallar nada.
 *
 * Pool propio y sin contexto de empresa, a propósito: leen el catálogo de
 * PostgreSQL, no datos de un inquilino, y ninguno de los 18 permisos
 * describe "verificar el esquema" — pasarlos por ejecutarConPermiso sería
 * inventarles un permiso de relleno. Se comprueban con la conexión de la
 * aplicación porque es la que de verdad corre en producción; que devuelvan
 * cero no depende del rol que pregunta.
 *
 * deepEqual contra [] y no .length === 0: si falla, el mensaje muestra la
 * tabla o la función culpable y por qué.
 */
describe('verificadores del esquema: cero filas', () => {
  async function consultarVerificador(funcion: string): Promise<unknown[]> {
    const pool = new Pool({
      host: process.env.APP_DB_HOST,
      port: Number(process.env.APP_DB_PORT ?? 5432),
      database: process.env.APP_DB_NAME,
      user: process.env.APP_DB_USER,
      password: process.env.APP_DB_PASSWORD,
    });
    try {
      const { rows } = await pool.query(`SELECT * FROM app.${funcion}()`);
      return rows;
    } finally {
      await pool.end();
    }
  }

  test('fn_verificar_rls: ninguna tabla de inquilino sin aislamiento', async () => {
    assert.deepEqual(await consultarVerificador('fn_verificar_rls'), []);
  });

  test('fn_verificar_funciones: ninguna función SECURITY DEFINER de superusuario ni ejecutable por PUBLIC (D-54)', async () => {
    assert.deepEqual(await consultarVerificador('fn_verificar_funciones'), []);
  });

  test('fn_verificar_roles_login: ninguna conexión puede vestirse de un rol con BYPASSRLS (D-50)', async () => {
    assert.deepEqual(await consultarVerificador('fn_verificar_roles_login'), []);
  });
});

describe('el problema que este wrapper existe para evitar', () => {
  test(
    'un cliente del pool de app_login sin pasar por el wrapper no ve nada, sin ningún error que lo explique',
    async () => {
      // A propósito NO se usa ejecutarConPermiso/montarEscenarioComoAdmin acá: este pool es
      // "suelto", tal como lo describe el pedido original. Nunca fija
      // app.tenant_id. RLS con FORCE hace que el WHERE ni siquiera importe:
      // devuelve cero filas en silencio, aunque sí exista una empresa A.
      const poolSuelto = new Pool({
        host: process.env.APP_DB_HOST,
        port: Number(process.env.APP_DB_PORT ?? 5432),
        database: process.env.APP_DB_NAME,
        user: process.env.APP_DB_USER,
        password: process.env.APP_DB_PASSWORD,
      });
      try {
        const { rows } = await poolSuelto.query('SELECT razon_social FROM plataforma.tenant');
        assert.deepEqual(rows, []);
      } finally {
        await poolSuelto.end();
      }
    },
  );

  test(
    'el módulo no expone el pool ni el motor sin permiso: nada de ejecutarComoTenant ni ejecutarSinPermiso entre sus exports',
    async () => {
      const modulo = await import('./contextoTenant.js');
      assert.deepEqual(Object.keys(modulo).sort(), [
        'CODIGOS_PERMISO',
        'actualizarHashAlIngresar',
        'consumirTokenRecuperacion',
        'ejecutarConPermiso',
        'emitirTokenRecuperacion',
        'leerArranqueDeSesion',
        'leerMiCuenta',
        'registrarEmpresa',
        'selloVigente',
      ]);
    },
  );
});

/**
 * Fixtures propias: dos empresas más, para probar el aislamiento entre
 * inquilinos sobre tokens (no reutiliza empresaA/empresaB de arriba para no
 * depender del orden de ejecución de los describe de este archivo).
 */
describe('consumirTokenRecuperacion', () => {
  let empresaX: EmpresaDePrueba;
  let empresaY: EmpresaDePrueba;

  before(async () => {
    empresaX = await registrarEmpresaDePrueba(
      'Constructora Test X',
      '900000008-8',
      'fabio@construsoft.test',
    );
    empresaY = await registrarEmpresaDePrueba(
      'Constructora Test Y',
      '900000009-9',
      'gina@construsoft.test',
    );
  });

  /** Inserta un token real como lo haría la aplicación real al emitirlo: el administrador actuando. */
  async function emitirToken(
    empresa: EmpresaDePrueba,
    usuarioId: string,
    proposito: 'ACTIVACION' | 'RECUPERACION',
    tokenHash: string,
  ): Promise<string> {
    // La vigencia máxima difiere por propósito (ck_token_vigencia): 30
    // minutos para RECUPERACION, 72 horas para ACTIVACION. Usar 72 horas para
    // los dos violaría el CHECK en cuanto el propósito fuera RECUPERACION.
    const vigencia = proposito === 'RECUPERACION' ? '10 minutes' : '72 hours';
    return montarEscenarioComoAdmin(empresa, async (cliente) => {
      const { rows } = await cliente.query<{ id: string }>(
        `INSERT INTO app.token_recuperacion (tenant_id, usuario_id, proposito, token_hash, expira_en)
         VALUES ($1, $2, $3, $4, now() + $5::interval)
         RETURNING id`,
        [empresa.tenantId, usuarioId, proposito, tokenHash, vigencia],
      );
      return rows[0]!.id;
    });
  }

  test('un token emitido por la empresa X no se puede resolver como de la empresa Y ni usarse desde ahí', async () => {
    const tokenHash = 'TOK_CROSS_TENANT';
    const tokenId = await emitirToken(empresaX, empresaX.usuarioId, 'RECUPERACION', tokenHash);

    const resuelto = await resolverToken(tokenHash);
    assert.ok(resuelto);
    assert.equal(resuelto.tenantId, empresaX.tenantId);
    assert.notEqual(resuelto.tenantId, empresaY.tenantId);

    // Aunque la empresa Y conociera el id real del token (por ejemplo, por un
    // ataque de fuerza bruta sobre ids consecutivos), RLS le impide verlo:
    // cero filas, no un error que confirme que el id existe en otra empresa.
    const vistoDesdeY = await montarEscenarioComoAdmin(empresaY, (cliente) =>
      cliente.query('SELECT 1 FROM app.token_recuperacion WHERE id = $1', [tokenId]),
    );
    assert.equal(vistoDesdeY.rowCount, 0);

    const resultado = await consumirTokenRecuperacion(tokenHash, 'nuevo_hash_cross_tenant');
    assert.equal(resultado.tenantId, empresaX.tenantId);
    assert.equal(resultado.usuarioId, empresaX.usuarioId);
  });

  test('el mismo token no funciona dos veces', async () => {
    const tokenHash = 'TOK_UN_SOLO_USO';
    await emitirToken(empresaY, empresaY.usuarioId, 'RECUPERACION', tokenHash);

    await consumirTokenRecuperacion(tokenHash, 'primer_hash_valido');
    await assert.rejects(
      consumirTokenRecuperacion(tokenHash, 'segundo_hash_no_deberia_aplicarse'),
      /ya fue usado/,
    );
  });

  test('un token expirado no funciona (vencimiento fabricado, no esperado)', async () => {
    const tokenHash = 'TOK_EXPIRADO';
    const tokenId = await emitirToken(empresaY, empresaY.usuarioId, 'RECUPERACION', tokenHash);

    // Fabrica el vencimiento sin esperar las 72 horas reales: mueve
    // expira_en justo después de creado_en (sigue cumpliendo el CHECK
    // expira_en > creado_en), y para cuando el test siguiente llegue a
    // consumirTokenRecuperacion ya pasó más de un milisegundo real.
    await montarEscenarioComoAdmin(empresaY, (cliente) =>
      cliente.query(
        `UPDATE app.token_recuperacion
            SET expira_en = creado_en + interval '1 millisecond'
          WHERE id = $1`,
        [tokenId],
      ),
    );

    await assert.rejects(
      consumirTokenRecuperacion(tokenHash, 'hash_no_deberia_aplicarse'),
      /expiró/,
    );
  });

  test('emitir un token nuevo para el mismo usuario y propósito deja inservible el anterior', async () => {
    const tokenViejo = 'TOK_VIEJO';
    const tokenNuevo = 'TOK_NUEVO';
    await emitirToken(empresaX, empresaX.usuarioId, 'RECUPERACION', tokenViejo);
    await emitirToken(empresaX, empresaX.usuarioId, 'RECUPERACION', tokenNuevo);

    await assert.rejects(
      consumirTokenRecuperacion(tokenViejo, 'hash_no_deberia_aplicarse'),
      /ya no es válido/,
    );

    const resultado = await consumirTokenRecuperacion(tokenNuevo, 'hash_valido_recuperacion');
    assert.equal(resultado.usuarioId, empresaX.usuarioId);
  });

  test('después de activar, el usuario inicia sesión con su contraseña nueva y el tenantId/usuarioId correctos', async () => {
    const email = 'hugo@construsoft.test';
    const invitadoId = await montarEscenarioComoAdmin(empresaX, async (cliente) => {
      const { rows } = await cliente.query<{ id: string }>(
        `INSERT INTO app.usuario (tenant_id, rol_id, nombre, email)
         VALUES ($1, $2, 'Hugo Invitado', $3)
         RETURNING id`,
        [empresaX.tenantId, empresaX.rolAdminId, email],
      );
      return rows[0]!.id;
    });
    const tokenHash = 'TOK_ACTIVACION_HUGO';
    await emitirToken(empresaX, invitadoId, 'ACTIVACION', tokenHash);

    const nuevoHash = 'hash_de_hugo_nuevo';
    const resultado = await consumirTokenRecuperacion(tokenHash, nuevoHash);
    assert.equal(resultado.tenantId, empresaX.tenantId);
    assert.equal(resultado.usuarioId, invitadoId);

    const sesion = await autenticar(email);
    assert.ok(sesion);
    assert.equal(sesion.estado, 'ACTIVO');
    assert.equal(sesion.passwordHash, nuevoHash);
    assert.equal(sesion.tenantId, empresaX.tenantId);
    assert.equal(sesion.usuarioId, invitadoId);
  });
});

describe('ejecutarConPermiso — la comprobación de permiso', () => {
  let empresaP: EmpresaDePrueba;
  let asistenteId: string;

  before(async () => {
    empresaP = await registrarEmpresaDePrueba(
      'Constructora Test P',
      '900000010-0',
      'irene@construsoft.test',
    );
    asistenteId = await crearAsistente(empresaP, 'irma@construsoft.test', 'Irma Asistente');
  });

  test('con el permiso: la operación corre y devuelve su resultado', async () => {
    const resultado = await ejecutarConPermiso(
      { tenantId: empresaP.tenantId, usuarioId: empresaP.usuarioId },
      'RECURSOS.VER',
      async () => 'ok-admin',
    );
    assert.equal(resultado, 'ok-admin');
  });

  test('sin el permiso: rechaza antes de correr la operación, con un mensaje que nombra el código que falta', async () => {
    let corrioLaOperacion = false;
    await assert.rejects(
      ejecutarConPermiso(
        { tenantId: empresaP.tenantId, usuarioId: asistenteId },
        'RECURSOS.VER',
        async () => {
          corrioLaOperacion = true;
          return 'no debería llegar acá';
        },
      ),
      /RECURSOS\.VER/,
    );
    assert.equal(corrioLaOperacion, false);
  });

  test('una cuenta que no está ACTIVA no actúa aunque su rol tenga el permiso', async () => {
    // Le doy el rol Administrador a propósito —los 18 permisos— para que el
    // rechazo no pueda confundirse con "falta el permiso": un invitado nace
    // PENDIENTE (D-7) y solo pasa a ACTIVO al consumir su enlace, así que
    // esto tiene que fallar por el estado, no por el rol.
    const invitadoId = await montarEscenarioComoAdmin(empresaP, async (cliente) => {
      const { rows } = await cliente.query<{ id: string }>(
        `INSERT INTO app.usuario (tenant_id, rol_id, nombre, email)
         VALUES ($1, $2, 'Invitado Pendiente', 'pendiente@construsoft.test')
         RETURNING id`,
        [empresaP.tenantId, empresaP.rolAdminId],
      );
      return rows[0]!.id;
    });

    let corrioLaOperacion = false;
    await assert.rejects(
      ejecutarConPermiso(
        { tenantId: empresaP.tenantId, usuarioId: invitadoId },
        'RECURSOS.VER',
        async () => {
          corrioLaOperacion = true;
        },
      ),
      /PENDIENTE/,
    );
    assert.equal(corrioLaOperacion, false);
  });

  test('otorgar el permiso puntual alcanza para que la misma acción funcione después', async () => {
    await montarEscenarioComoAdmin(empresaP, (cliente) =>
      cliente.query(
        `INSERT INTO app.rol_permiso (tenant_id, rol_id, permiso_codigo)
         SELECT tenant_id, rol_id, 'RECURSOS.VER' FROM app.usuario WHERE id = $1`,
        [asistenteId],
      ),
    );

    const resultado = await ejecutarConPermiso(
      { tenantId: empresaP.tenantId, usuarioId: asistenteId },
      'RECURSOS.VER',
      async () => 'ok-asistente',
    );
    assert.equal(resultado, 'ok-asistente');
  });

  test('aislamiento: el permiso de una empresa no habilita nada en otra, aunque el usuario sea real', async () => {
    const empresaQ = await registrarEmpresaDePrueba(
      'Constructora Test Q',
      '900000011-1',
      'julia@construsoft.test',
    );

    // El administrador de Q tiene RECURSOS.VER de verdad (fn_alta_tenant le
    // da los 18), pero en SU PROPIA empresa. Mezclado con el tenant de P —el
    // error de "confused deputy" que ejecutarConPermiso no puede cometer—,
    // RLS esconde por completo su fila de app.usuario: fn_exigir_permiso no
    // encuentra ningún usuario con ese id en esta empresa y lo dice así, sin
    // mencionar el permiso — no "encuentra al usuario equivocado".
    let corrioLaOperacion = false;
    await assert.rejects(
      ejecutarConPermiso(
        { tenantId: empresaP.tenantId, usuarioId: empresaQ.usuarioId },
        'RECURSOS.VER',
        async () => {
          corrioLaOperacion = true;
        },
      ),
      /no existe en esta empresa/,
    );
    assert.equal(corrioLaOperacion, false);

    // Y en su propia empresa Q sigue teniendo el permiso intacto: el rechazo
    // de arriba fue por la mezcla, no porque algo se lo haya borrado.
    const resultado = await ejecutarConPermiso(
      { tenantId: empresaQ.tenantId, usuarioId: empresaQ.usuarioId },
      'RECURSOS.VER',
      async () => 'ok-Q-en-su-propia-empresa',
    );
    assert.equal(resultado, 'ok-Q-en-su-propia-empresa');
  });
});

describe('leerArranqueDeSesion', () => {
  let empresaR: EmpresaDePrueba;
  let asistenteId: string;

  const formatoPorDefecto = { separadorMiles: '.', separadorDecimal: ',', decimalesVista: 2 };

  before(async () => {
    empresaR = await registrarEmpresaDePrueba(
      'Constructora Test R',
      '900000012-2',
      'karla@construsoft.test',
    );
    asistenteId = await crearAsistente(empresaR, 'karina@construsoft.test', 'Karina Asistente');
  });

  test('el administrador ve los 18 permisos que fn_alta_tenant le dio, y el formato numérico por defecto', async () => {
    const arranque = await leerArranqueDeSesion({
      tenantId: empresaR.tenantId,
      usuarioId: empresaR.usuarioId,
    });
    assert.deepEqual([...arranque.permisos].sort(), [...CODIGOS_PERMISO].sort());
    assert.deepEqual(arranque.formatoNumerico, formatoPorDefecto);
    assert.deepEqual(
      { usuario: arranque.usuarioNombre, empresa: arranque.razonSocial },
      { usuario: 'Admin de Constructora Test R', empresa: 'Constructora Test R' },
    );
  });

  test('la moneda de la empresa viaja en el arranque: la necesita quien crea un presupuesto sin ver las preferencias (D-6)', async () => {
    const delAsistente = await leerArranqueDeSesion({ tenantId: empresaR.tenantId, usuarioId: asistenteId });
    assert.equal(delAsistente.monedaBase, 'COP');
  });

  test('trae el estado de la suscripción tal como lo da la base: en prueba, con sus días (D-65)', async () => {
    const { suscripcion } = await leerArranqueDeSesion({ tenantId: empresaR.tenantId, usuarioId: empresaR.usuarioId });
    assert.ok(suscripcion);
    const { venceEl, ...resto } = suscripcion;
    assert.match(venceEl, /^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(resto, { estado: 'EN_PRUEBA', soloLectura: false, diasRestantes: 15, planCodigo: 'EMPRESARIAL' });
  });

  test('vencida, la base dice solo lectura y la interfaz no tiene que calcular nada (D-65)', async () => {
    const empresa = await registrarEmpresaDePrueba('Constructora Test Vencida', '900000015-5', 'vera@construsoft.test');
    await vencerSuscripcion(empresa.tenantId);
    const { suscripcion } = await leerArranqueDeSesion({ tenantId: empresa.tenantId, usuarioId: empresa.usuarioId });
    assert.deepEqual(
      { estado: suscripcion?.estado, soloLectura: suscripcion?.soloLectura, dias: suscripcion?.diasRestantes },
      { estado: 'VENCIDA', soloLectura: true, dias: -1 },
    );
  });

  test('un asistente recién creado no ve ningún permiso, pero sí ve el formato numérico de su empresa (D-44)', async () => {
    const arranque = await leerArranqueDeSesion({
      tenantId: empresaR.tenantId,
      usuarioId: asistenteId,
    });
    assert.deepEqual(arranque.permisos, []);
    assert.deepEqual(arranque.formatoNumerico, formatoPorDefecto);
  });

  test('lee en vivo: otorgar un permiso y cambiar el formato se reflejan en la siguiente llamada, sin sesión de por medio', async () => {
    const antes = await leerArranqueDeSesion({ tenantId: empresaR.tenantId, usuarioId: asistenteId });
    assert.deepEqual(antes.permisos, []);
    assert.deepEqual(antes.formatoNumerico, formatoPorDefecto);

    await montarEscenarioComoAdmin(empresaR, (cliente) =>
      cliente.query(
        `INSERT INTO app.rol_permiso (tenant_id, rol_id, permiso_codigo)
         SELECT tenant_id, rol_id, 'APU.VER' FROM app.usuario WHERE id = $1`,
        [asistenteId],
      ),
    );
    await montarEscenarioComoAdmin(empresaR, (cliente) =>
      cliente.query(
        `UPDATE app.configuracion_empresa
            SET separador_miles = ' ', separador_decimal = '.', decimales_vista = 0
          WHERE tenant_id = $1`,
        [empresaR.tenantId],
      ),
    );

    const despues = await leerArranqueDeSesion({ tenantId: empresaR.tenantId, usuarioId: asistenteId });
    assert.deepEqual(despues.permisos, ['APU.VER']);
    assert.deepEqual(despues.formatoNumerico, {
      separadorMiles: ' ',
      separadorDecimal: '.',
      decimalesVista: 0,
    });
  });
});

describe('CODIGOS_PERMISO', () => {
  test('coincide con app.permiso en los dos sentidos', async () => {
    const empresaS = await registrarEmpresaDePrueba(
      'Constructora Test S',
      '900000013-3',
      'lucia@construsoft.test',
    );

    const codigosEnLaBase = await ejecutarConPermiso(
      { tenantId: empresaS.tenantId, usuarioId: empresaS.usuarioId },
      'RECURSOS.VER',
      async (cliente) => {
        const { rows } = await cliente.query<{ codigo: string }>(
          'SELECT codigo FROM app.permiso ORDER BY codigo',
        );
        return rows.map((fila) => fila.codigo);
      },
    );

    const codigosDeMas = CODIGOS_PERMISO.filter((codigo) => !codigosEnLaBase.includes(codigo));
    const codigosQueFaltan = codigosEnLaBase.filter(
      (codigo) => !(CODIGOS_PERMISO as readonly string[]).includes(codigo),
    );

    assert.deepEqual(codigosDeMas, [], 'CODIGOS_PERMISO tiene códigos que ya no existen en app.permiso');
    assert.deepEqual(codigosQueFaltan, [], 'app.permiso tiene códigos que CODIGOS_PERMISO no conoce');
  });

  test('un código que no está en el catálogo es un error de programación, no de autorización', async () => {
    const empresaT = await registrarEmpresaDePrueba(
      'Constructora Test T',
      '900000014-4',
      'mario@construsoft.test',
    );

    // El elenco a CodigoPermiso es deliberado: TypeScript ya impide pasar un
    // código inventado —para eso existe CODIGOS_PERMISO—, así que la única
    // forma de ejercitar esta rama es forzarlo, tal como se vería si el tipo
    // y app.permiso llegaran a desalinearse de verdad.
    await assert.rejects(
      ejecutarConPermiso(
        { tenantId: empresaT.tenantId, usuarioId: empresaT.usuarioId },
        'RECURSOS.CODIGO_QUE_NO_EXISTE' as CodigoPermiso,
        async () => 'no debería llegar acá',
      ),
      /error de programación/,
    );
  });
});

describe('selloVigente y actualizarHashAlIngresar (D-67, 04 §8.1 y §8.2)', () => {
  let empresa: EmpresaDePrueba;

  before(async () => {
    empresa = await registrarEmpresaDePrueba('Constructora Test Sello', '900000016-6', 'selena@construsoft.test');
  });

  const contexto = () => ({ tenantId: empresa.tenantId, usuarioId: empresa.usuarioId });

  test('el sello que entrega el ingreso vale tal cual: la comparación es exacta, con microsegundos', async () => {
    const { credencialesEn } = (await autenticar(empresa.email))!;
    assert.match(credencialesEn, /^\d+\.\d{6}$/);
    assert.equal(await selloVigente(contexto(), credencialesEn), true);
  });

  test('un sello que difiere en un microsegundo ya no vale: por eso el sello no viaja como Date', async () => {
    const { credencialesEn } = (await autenticar(empresa.email))!;
    const unoMas = (BigInt(credencialesEn.replace('.', '')) + 1n).toString();
    const corrido = `${unoMas.slice(0, -6)}.${unoMas.slice(-6)}`;
    assert.equal(await selloVigente(contexto(), corrido), false);
  });

  test('rehacer el hash al ingresar mueve el sello: el viejo deja de valer y el nuevo es el que devuelve', async () => {
    const viejo = (await autenticar(empresa.email))!.credencialesEn;
    const nuevo = await actualizarHashAlIngresar(contexto(), 'hash_rehecho_de_prueba');
    assert.notEqual(nuevo, viejo);
    assert.equal(await selloVigente(contexto(), viejo), false);
    assert.equal(await selloVigente(contexto(), nuevo), true);
    assert.equal((await autenticar(empresa.email))!.credencialesEn, nuevo);
  });

  test('aislamiento: desde otra empresa el sello de este usuario no existe', async () => {
    const otra = await registrarEmpresaDePrueba('Constructora Test Sello B', '900000017-7', 'sebastian@construsoft.test');
    const { credencialesEn } = (await autenticar(empresa.email))!;
    assert.equal(await selloVigente({ tenantId: otra.tenantId, usuarioId: empresa.usuarioId }, credencialesEn), false);
  });
});

describe('emitirTokenRecuperacion: el enlace que entrega el dueño a mano (04 §8.5)', () => {
  test('el token emitido lo consume la recuperación, vence en 30 minutos, y emitir otro anula el anterior', async () => {
    const empresa = await registrarEmpresaDePrueba('Constructora Test Emitir', '900000019-9', 'emitir.token@construsoft.test');
    const contexto = { tenantId: empresa.tenantId, usuarioId: empresa.usuarioId };

    const primero = await emitirTokenRecuperacion(contexto, 'a'.repeat(64));
    const minutos = (Date.parse(primero.expiraEn) - Date.now()) / 60000;
    assert.ok(minutos > 29 && minutos <= 30, `vence en ${minutos} minutos`);

    await emitirTokenRecuperacion(contexto, 'b'.repeat(64));
    await assert.rejects(consumirTokenRecuperacion('a'.repeat(64), 'hash_nuevo_no_real'));
    await consumirTokenRecuperacion('b'.repeat(64), 'hash_nuevo_no_real');
  });
});
