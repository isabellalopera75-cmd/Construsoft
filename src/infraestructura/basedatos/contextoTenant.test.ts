import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { consumirTokenRecuperacion, ejecutarComoTenant, registrarEmpresa } from './contextoTenant.js';
import { autenticar, resolverToken } from './autenticacion.js';

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
  });
  return { ...alta, razonSocial, email };
}

let empresaA: EmpresaDePrueba;
let empresaB: EmpresaDePrueba;

describe('ejecutarComoTenant', () => {
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

  test('cada empresa ve su propia razón social y ninguna otra (RN-01)', async () => {
    const vistaDesdeA = await ejecutarComoTenant(
      { tenantId: empresaA.tenantId, usuarioId: empresaA.usuarioId },
      async (cliente) => {
        const { rows } = await cliente.query<{ razon_social: string }>(
          'SELECT razon_social FROM plataforma.tenant',
        );
        return rows;
      },
    );
    assert.deepEqual(vistaDesdeA.map((f) => f.razon_social), [empresaA.razonSocial]);

    const vistaDesdeB = await ejecutarComoTenant(
      { tenantId: empresaB.tenantId, usuarioId: empresaB.usuarioId },
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
    const usuarioVisto = await ejecutarComoTenant(
      { tenantId: empresaA.tenantId, usuarioId: empresaA.usuarioId },
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
      ejecutarComoTenant(
        { tenantId: empresaA.tenantId, usuarioId: empresaA.usuarioId },
        async () => {
          throw new Error('falla deliberada de la prueba');
        },
      ),
      /falla deliberada de la prueba/,
    );

    // Si el cliente hubiera quedado sin liberar, este segundo llamado se
    // colgaría esperando una conexión libre del pool en vez de resolver.
    const siguePudiendoConsultar = await ejecutarComoTenant(
      { tenantId: empresaA.tenantId, usuarioId: empresaA.usuarioId },
      async (cliente) => {
        const { rows } = await cliente.query('SELECT 1 AS ok');
        return rows[0]!.ok;
      },
    );
    assert.equal(siguePudiendoConsultar, 1);
  });

  test('rechaza un tenantId que no es UUID en vez de mandarlo a la base', async () => {
    await assert.rejects(
      ejecutarComoTenant(
        { tenantId: 'no-es-un-uuid', usuarioId: empresaA.usuarioId },
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

    const filaUsuario = await ejecutarComoTenant(
      { tenantId: empresa.tenantId, usuarioId: empresa.usuarioId },
      async (cliente) => {
        const { rows } = await cliente.query<{ nombre: string; rol_id: string }>(
          'SELECT nombre, rol_id FROM app.usuario WHERE id = $1',
          [empresa.usuarioId],
        );
        return rows[0];
      },
    );

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

  test('propaga el error de la base tal cual (NIT vacío, D-34)', async () => {
    await assert.rejects(
      registrarEmpresa({
        razonSocial: 'Constructora Sin NIT',
        nit: '',
        plan: 'EMPRESARIAL',
        adminNombre: 'Nadie',
        adminEmail: 'nadie@construsoft.test',
        adminHash: 'hash_de_prueba_no_real',
      }),
      /NIT de la empresa es obligatorio/,
    );
  });
});

describe('el problema que este wrapper existe para evitar', () => {
  test(
    'un cliente del pool de app_login sin pasar por el wrapper no ve nada, sin ningún error que lo explique',
    async () => {
      // A propósito NO se importa ejecutarComoTenant acá: este pool es
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
    'el módulo no expone el pool ni un query suelto: solo ejecutarComoTenant, registrarEmpresa y consumirTokenRecuperacion',
    async () => {
      const modulo = await import('./contextoTenant.js');
      assert.deepEqual(Object.keys(modulo).sort(), [
        'consumirTokenRecuperacion',
        'ejecutarComoTenant',
        'registrarEmpresa',
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

  /** Inserta un token real con ejecutarComoTenant, como lo haría la aplicación real al emitirlo. */
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
    return ejecutarComoTenant({ tenantId: empresa.tenantId, usuarioId: empresa.usuarioId }, async (cliente) => {
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
    const vistoDesdeY = await ejecutarComoTenant(
      { tenantId: empresaY.tenantId, usuarioId: empresaY.usuarioId },
      (cliente) => cliente.query('SELECT 1 FROM app.token_recuperacion WHERE id = $1', [tokenId]),
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
    await ejecutarComoTenant({ tenantId: empresaY.tenantId, usuarioId: empresaY.usuarioId }, (cliente) =>
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
    const invitadoId = await ejecutarComoTenant(
      { tenantId: empresaX.tenantId, usuarioId: empresaX.usuarioId },
      async (cliente) => {
        const { rows } = await cliente.query<{ id: string }>(
          `INSERT INTO app.usuario (tenant_id, rol_id, nombre, email)
           VALUES ($1, $2, 'Hugo Invitado', $3)
           RETURNING id`,
          [empresaX.tenantId, empresaX.rolAdminId, email],
        );
        return rows[0]!.id;
      },
    );
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
