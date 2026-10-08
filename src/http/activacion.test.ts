import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { ejecutarConPermiso } from '../infraestructura/basedatos/contextoTenant.js';
import { prepararEnlaceDeActivacion } from '../dueno/enlaceDeActivacion.js';
import { prepararEnlaceDeRecuperacion } from '../dueno/enlaceDeRecuperacion.js';
import { VERSION_TERMINOS_DE_PRUEBA, CARPETA_LEGAL_DE_PRUEBA, clienteDePrueba } from '../pruebas/clienteHttp.js';
import { construirServidor } from './servidor.js';

let app: FastifyInstance;
const { otraIp, ingresar, registrar } = clienteDePrueba(() => app);

before(async () => {
  app = await construirServidor({ carpetaLegal: CARPETA_LEGAL_DE_PRUEBA, secretoSesion: randomBytes(32).toString('hex'), versionTerminos: VERSION_TERMINOS_DE_PRUEBA });
});
after(async () => {
  await app.close();
});

const activar = (token: string, contrasena: string) =>
  app.inject({ method: 'POST', url: '/api/activacion', remoteAddress: otraIp(), payload: { token, contrasena } });

describe('POST /api/activacion (CONTRATO §11.4)', () => {
  test('el invitado elige su contraseña, queda ACTIVO e ingresa; el enlace no sirve dos veces', async () => {
    const duena = await registrar('Constructora Activacion HTTP', '900000396-6', 'activacion.admin@construsoft.test');
    await ejecutarConPermiso(duena.contexto, 'USUARIOS.GESTIONAR', async (c) => {
      const { rows } = await c.query<{ id: string }>(`SELECT id FROM app.rol WHERE tenant_id = $1 AND tipo = 'ASISTENTE'`, [duena.contexto.tenantId]);
      await c.query(`INSERT INTO app.usuario (tenant_id, rol_id, nombre, email) VALUES ($1, $2, 'Ciro', 'activacion.ciro@construsoft.test')`, [
        duena.contexto.tenantId,
        rows[0]!.id,
      ]);
    });
    const { token } = await prepararEnlaceDeActivacion('activacion.ciro@construsoft.test');

    const corta = await activar(token, 'corta');
    assert.deepEqual([corta.statusCode, corta.json<{ campo?: string }>().campo], [422, 'contrasena']);
    assert.equal((await activar(token, 'mi-clave-propia-1')).statusCode, 204);
    assert.equal((await ingresar('activacion.ciro@construsoft.test', 'mi-clave-propia-1')).statusCode, 200);
    assert.equal((await activar(token, 'otra-clave-propia-2')).statusCode, 422);
  });

  test('un enlace de recuperación no activa, y responde lo mismo que uno inexistente', async () => {
    const duena = await registrar('Constructora Activacion Cruce', '900000397-7', 'activacion.cruce@construsoft.test');
    const { token } = await prepararEnlaceDeRecuperacion(duena.email);
    const cruzado = await activar(token, 'cualquier-clave-1');
    const inexistente = await activar('token-que-no-existe-en-ninguna-parte-000000', 'cualquier-clave-1');
    assert.deepEqual([cruzado.statusCode, cruzado.body], [inexistente.statusCode, inexistente.body]);
    assert.equal(cruzado.statusCode, 422);
  });
});
