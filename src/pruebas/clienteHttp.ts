import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { ejecutarConPermiso, type ContextoTenant } from '../infraestructura/basedatos/contextoTenant.js';
import { autenticar } from '../infraestructura/basedatos/autenticacion.js';
import { hashearContrasena } from '../http/contrasenas.js';
import { NOMBRE_COOKIE } from '../http/sesion.js';

/*
 * Lo que comparten las pruebas de la API: registrar una empresa por HTTP,
 * ingresar, pedir con cookie. Cada archivo de pruebas construye su propio
 * servidor y se lo pasa a clienteDePrueba.
 */

export const VERSION_TERMINOS_DE_PRUEBA = 'terminos-2026-10-01';

/**
 * La carpeta legal de las pruebas: textos SINTÉTICOS, una carpeta por
 * versión que usan las pruebas. El registro legal de verdad (legal/) no lleva
 * versiones inventadas para probar.
 */
export const CARPETA_LEGAL_DE_PRUEBA = fileURLToPath(new URL('./legal/', import.meta.url));

export interface Cuenta {
  email: string;
  contrasena: string;
  cookie: string;
  contexto: ContextoTenant;
}

export function cookieDe(respuesta: LightMyRequestResponse): string | undefined {
  const c = respuesta.cookies.find((x) => x.name === NOMBRE_COOKIE);
  return c && c.value !== '' ? `${NOMBRE_COOKIE}=${c.value}` : undefined;
}

export function borraLaCookie(respuesta: LightMyRequestResponse): boolean {
  const c = respuesta.cookies.find((x) => x.name === NOMBRE_COOKIE);
  return c !== undefined && (c.value === '' || (c.expires !== undefined && c.expires.getTime() <= Date.now()));
}

/** `servidor` es una función porque el servidor se construye en un before(), después de importar esto. */
export function clienteDePrueba(servidor: () => FastifyInstance) {
  let ipSecuencia = 0;
  /** Cada petición usa su propia IP: el límite por IP de una prueba no contamina a otra. */
  const otraIp = () => `10.0.${Math.floor(ipSecuencia / 250)}.${(ipSecuencia++ % 250) + 1}`;

  const ingresar = (email: string, contrasena: string, ip = otraIp()) =>
    servidor().inject({ method: 'POST', url: '/api/sesion', remoteAddress: ip, payload: { email, contrasena } });

  const pedir = (url: string, cookie?: string) =>
    servidor().inject({ method: 'GET', url, remoteAddress: otraIp(), ...(cookie ? { headers: { cookie } } : {}) });

  async function registrar(razonSocial: string, nit: string, email: string, contrasena = 'contrasena-segura-1'): Promise<Cuenta> {
    const r = await servidor().inject({
      method: 'POST',
      url: '/api/registro',
      remoteAddress: otraIp(),
      payload: {
        nombre: `Admin de ${razonSocial}`,
        email,
        contrasena,
        razonSocial,
        nit,
        plan: 'EMPRESARIAL',
        aceptaTerminos: true,
        versionTerminos: VERSION_TERMINOS_DE_PRUEBA,
      },
    });
    assert.equal(r.statusCode, 201, r.body);
    const yo = (await autenticar(email))!;
    return { email, contrasena, cookie: cookieDe(r)!, contexto: { tenantId: yo.tenantId, usuarioId: yo.usuarioId } };
  }

  /**
   * Un usuario de la misma empresa con un rol PROPIO y exactamente los
   * permisos que se le pasan, ya con sesión abierta. Devuelve su cookie. El
   * rol es suyo y no el ASISTENTE de la empresa: si dos usuarios compartieran
   * rol, los permisos de uno se le sumarían al otro.
   */
  async function asistenteCon(cuenta: Cuenta, email: string, permisos: string[]): Promise<string> {
    const contrasena = 'contrasena-segura-1';
    const hash = await hashearContrasena(contrasena);
    await ejecutarConPermiso(cuenta.contexto, 'USUARIOS.GESTIONAR', async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO app.rol (tenant_id, nombre, tipo) VALUES ($1, $2, 'PERSONALIZADO') RETURNING id`,
        [cuenta.contexto.tenantId, `Rol de ${email}`],
      );
      for (const permiso of permisos) {
        await c.query(`INSERT INTO app.rol_permiso (tenant_id, rol_id, permiso_codigo) VALUES ($1, $2, $3)`, [
          cuenta.contexto.tenantId,
          rows[0]!.id,
          permiso,
        ]);
      }
      await c.query(
        `INSERT INTO app.usuario (tenant_id, rol_id, nombre, email, password_hash, estado) VALUES ($1, $2, 'Asistente', $3, $4, 'ACTIVO')`,
        [cuenta.contexto.tenantId, rows[0]!.id, email, hash],
      );
    });
    const r = await ingresar(email, contrasena);
    assert.equal(r.statusCode, 200, r.body);
    return cookieDe(r)!;
  }

  return { otraIp, ingresar, pedir, registrar, asistenteCon };
}
