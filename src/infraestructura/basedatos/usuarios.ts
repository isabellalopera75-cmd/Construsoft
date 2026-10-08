import { CODIGOS_PERMISO, ejecutarConPermiso, type ClienteEnContexto, type CodigoPermiso, type ContextoTenant } from './contextoTenant.js';
import { ErrorParaElUsuario } from './errorParaElUsuario.js';

/*
 * Usuarios y roles (02 §11.4, CONTRATO §11). Todo pide USUARIOS.GESTIONAR.
 *
 * Lo que la base ya defiende se queda en la base y su mensaje llega tal cual:
 * el límite de usuarios y de roles del plan (RN-11), el último administrador
 * activo (D-29), la coherencia de la matriz de permisos (RF-CFG-25, D-59,
 * D-70), los permisos no delegables y los roles del sistema que no se borran.
 * Aquí viven las reglas del contrato que la base no cubre: el correo que solo
 * se corrige mientras la cuenta está PENDIENTE, no revocarse a sí mismo, el rol
 * Administrador que no se edita, el Asistente que no se renombra, y el rol con
 * usuarios que no se borra.
 */

export type EstadoUsuario = 'PENDIENTE' | 'ACTIVO' | 'REVOCADO';
export type TipoRol = 'ADMIN' | 'ASISTENTE' | 'PERSONALIZADO';

export interface Usuario {
  id: string;
  nombre: string;
  email: string;
  estado: EstadoUsuario;
  rolId: string;
  rolNombre: string;
  rolTipo: TipoRol;
  creadoEn: Date;
  ultimoAcceso: Date | null;
  /** Cuándo vence el enlace de activación vigente, si hay uno. */
  activacionVenceEn: Date | null;
  esUsted: boolean;
}

export interface Rol {
  id: string;
  nombre: string;
  tipo: TipoRol;
  permisos: CodigoPermiso[];
  /** Cuántos usuarios lo tienen, revocados incluidos. */
  usuarios: number;
}

export interface PanelDeUsuarios {
  plan: { codigo: 'PERSONAL' | 'EMPRESARIAL'; maxUsuarios: number | null; rolesPersonalizados: boolean };
  usuarios: Usuario[];
  roles: Rol[];
  permisos: { codigo: CodigoPermiso; modulo: string; accion: string; descripcion: string }[];
}

export interface DatosUsuario {
  nombre: string;
  email: string;
  rolId: string;
}

export interface DatosRol {
  nombre: string;
  permisos: CodigoPermiso[];
}

const SELECT_USUARIO = `
  SELECT u.id, u.nombre, u.email::text AS email, u.estado, u.rol_id, r.nombre AS rol_nombre, r.tipo AS rol_tipo,
         u.creado_en, u.ultimo_acceso,
         (SELECT max(t.expira_en) FROM app.token_recuperacion t
           WHERE t.usuario_id = u.id AND t.proposito = 'ACTIVACION'
             AND t.usado_en IS NULL AND t.anulado_en IS NULL AND t.expira_en > now()) AS activacion_vence_en,
         u.id = $1 AS es_usted
    FROM app.usuario u JOIN app.rol r ON r.id = u.rol_id`;

interface FilaUsuario {
  id: string;
  nombre: string;
  email: string;
  estado: EstadoUsuario;
  rol_id: string;
  rol_nombre: string;
  rol_tipo: TipoRol;
  creado_en: Date;
  ultimo_acceso: Date | null;
  activacion_vence_en: Date | null;
  es_usted: boolean;
}

const aUsuario = (f: FilaUsuario): Usuario => ({
  id: f.id,
  nombre: f.nombre,
  email: f.email,
  estado: f.estado,
  rolId: f.rol_id,
  rolNombre: f.rol_nombre,
  rolTipo: f.rol_tipo,
  creadoEn: f.creado_en,
  ultimoAcceso: f.ultimo_acceso,
  activacionVenceEn: f.activacion_vence_en,
  esUsted: f.es_usted,
});

const SELECT_ROL = `
  SELECT r.id, r.nombre, r.tipo,
         COALESCE(array_agg(rp.permiso_codigo ORDER BY array_position($1::text[], rp.permiso_codigo))
                  FILTER (WHERE rp.permiso_codigo IS NOT NULL), '{}') AS permisos,
         (SELECT count(*) FROM app.usuario u WHERE u.rol_id = r.id)::integer AS usuarios
    FROM app.rol r LEFT JOIN app.rol_permiso rp ON rp.rol_id = r.id`;

const usuarioNoExiste = () => new ErrorParaElUsuario('Ese usuario no existe en su empresa.', 'NO_EXISTE');
const rolNoExiste = () => new ErrorParaElUsuario('Ese rol no existe en su empresa.', 'NO_EXISTE');

async function leerUsuario(cliente: ClienteEnContexto, contexto: ContextoTenant, id: string): Promise<Usuario | null> {
  const { rows } = await cliente.query<FilaUsuario>(`${SELECT_USUARIO} WHERE u.id = $2`, [contexto.usuarioId, id]);
  return rows[0] ? aUsuario(rows[0]) : null;
}

async function leerRol(cliente: ClienteEnContexto, id: string): Promise<Rol | null> {
  const { rows } = await cliente.query<Rol>(`${SELECT_ROL} WHERE r.id = $2 GROUP BY r.id`, [CODIGOS_PERMISO, id]);
  return rows[0] ?? null;
}

/** Un rol de esta empresa, o el error del campo: uno ajeno y uno inexistente se ven igual (RN-01). */
async function exigirRol(cliente: ClienteEnContexto, rolId: string): Promise<{ tipo: TipoRol }> {
  const { rows } = await cliente.query<{ tipo: TipoRol }>('SELECT tipo FROM app.rol WHERE id = $1', [rolId]);
  if (!rows[0]) throw new ErrorParaElUsuario('Ese rol no existe en su empresa. Elija uno de la lista.', 'RECHAZADO', 'rolId');
  return rows[0];
}

/** El correo es único en todo ConstruSoft (app.usuario.email UNIQUE), y el mensaje no dice de qué empresa. */
async function conCorreoUnico<T>(operacion: () => Promise<T>): Promise<T> {
  try {
    return await operacion();
  } catch (error) {
    if ((error as { code?: string; constraint?: string }).constraint === 'usuario_email_key') {
      throw new ErrorParaElUsuario(
        'Ese correo ya tiene una cuenta en ConstruSoft. Cada correo pertenece a una sola empresa: use otro.',
        'RECHAZADO',
        'email',
      );
    }
    throw error;
  }
}

/** El nombre del rol es único en la empresa (UNIQUE (tenant_id, nombre)). */
async function conNombreDeRolUnico<T>(nombre: string, operacion: () => Promise<T>): Promise<T> {
  try {
    return await operacion();
  } catch (error) {
    if ((error as { code?: string }).code === '23505' && /nombre/.test((error as { constraint?: string }).constraint ?? '')) {
      throw new ErrorParaElUsuario(`Ya existe un rol llamado «${nombre}» en su empresa. Use otro nombre.`, 'RECHAZADO', 'nombre');
    }
    throw error;
  }
}

async function escribirPermisos(cliente: ClienteEnContexto, contexto: ContextoTenant, rolId: string, permisos: CodigoPermiso[]) {
  // La lista es la COMPLETA: se reemplaza en la misma transacción, y la
  // coherencia de la matriz (diferida) mira solo el resultado final.
  await cliente.query('DELETE FROM app.rol_permiso WHERE rol_id = $1', [rolId]);
  for (const permiso of new Set(permisos)) {
    await cliente.query('INSERT INTO app.rol_permiso (tenant_id, rol_id, permiso_codigo) VALUES ($1, $2, $3)', [
      contexto.tenantId,
      rolId,
      permiso,
    ]);
  }
}

// --- La lectura única de la pestaña (CONTRATO §11.1) ------------------------------

export async function leerPanelDeUsuarios(contexto: ContextoTenant): Promise<PanelDeUsuarios> {
  return ejecutarConPermiso(contexto, 'USUARIOS.GESTIONAR', async (cliente) => {
    const { rows: planes } = await cliente.query<{ codigo: 'PERSONAL' | 'EMPRESARIAL'; max_usuarios: number | null; roles_personalizados: boolean }>(
      `SELECT p.codigo, p.max_usuarios, p.roles_personalizados
         FROM plataforma.suscripcion s JOIN plataforma.plan p ON p.id = s.plan_id
        WHERE s.tenant_id = $1
        ORDER BY (s.estado IN ('EN_PRUEBA','ACTIVA')) DESC, s.fecha_vencimiento DESC
        LIMIT 1`,
      [contexto.tenantId],
    );
    const { rows: usuarios } = await cliente.query<FilaUsuario>(
      `${SELECT_USUARIO}
        ORDER BY CASE u.estado WHEN 'ACTIVO' THEN 0 WHEN 'PENDIENTE' THEN 1 ELSE 2 END, lower(u.nombre)`,
      [contexto.usuarioId],
    );
    const { rows: roles } = await cliente.query<Rol>(
      `${SELECT_ROL}
        GROUP BY r.id
        ORDER BY CASE r.tipo WHEN 'ADMIN' THEN 0 WHEN 'ASISTENTE' THEN 1 ELSE 2 END, lower(r.nombre)`,
      [CODIGOS_PERMISO],
    );
    // PRESUPUESTOS.ESTADO no es delegable: es del Administrador y no se ofrece.
    const { rows: permisos } = await cliente.query<PanelDeUsuarios['permisos'][number]>(
      `SELECT codigo, modulo, accion, descripcion FROM app.permiso
        WHERE codigo <> 'PRESUPUESTOS.ESTADO'
        ORDER BY array_position($1::text[], codigo)`,
      [CODIGOS_PERMISO],
    );
    const plan = planes[0]!;
    return {
      plan: { codigo: plan.codigo, maxUsuarios: plan.max_usuarios, rolesPersonalizados: plan.roles_personalizados },
      usuarios: usuarios.map(aUsuario),
      roles,
      permisos,
    };
  });
}

// --- Usuarios (CONTRATO §11.2) -----------------------------------------------------

/** Invitar no fija contraseña (D-7): la cuenta nace PENDIENTE hasta que consuma su enlace. */
export async function invitarUsuario(contexto: ContextoTenant, datos: DatosUsuario): Promise<Usuario> {
  return ejecutarConPermiso(contexto, 'USUARIOS.GESTIONAR', async (cliente) => {
    await exigirRol(cliente, datos.rolId);
    const id = await conCorreoUnico(async () => {
      const { rows } = await cliente.query<{ id: string }>(
        `INSERT INTO app.usuario (tenant_id, rol_id, nombre, email) VALUES ($1, $2, $3, $4) RETURNING id`,
        [contexto.tenantId, datos.rolId, datos.nombre, datos.email],
      );
      return rows[0]!.id;
    });
    return (await leerUsuario(cliente, contexto, id))!;
  });
}

export async function editarUsuario(contexto: ContextoTenant, id: string, datos: DatosUsuario): Promise<Usuario> {
  return ejecutarConPermiso(contexto, 'USUARIOS.GESTIONAR', async (cliente) => {
    const actual = await leerUsuario(cliente, contexto, id);
    if (!actual) throw usuarioNoExiste();
    if (actual.email.toLowerCase() !== datos.email.toLowerCase() && actual.estado !== 'PENDIENTE') {
      throw new ErrorParaElUsuario(
        'El correo de una cuenta que ya ingresó es su identidad y no se cambia. Si la persona cambió de correo, invítela con el nuevo.',
        'RECHAZADO',
        'email',
      );
    }
    const rolNuevo = await exigirRol(cliente, datos.rolId);
    // D-29 lo defiende la base; aquí se adelanta para nombrar el campo.
    if (actual.estado === 'ACTIVO' && actual.rolTipo === 'ADMIN' && rolNuevo.tipo !== 'ADMIN') {
      const { rows } = await cliente.query<{ otros: number }>(
        `SELECT count(*)::integer AS otros FROM app.usuario u JOIN app.rol r ON r.id = u.rol_id
          WHERE u.id <> $1 AND u.estado = 'ACTIVO' AND r.tipo = 'ADMIN'`,
        [id],
      );
      if (rows[0]!.otros === 0) {
        throw new ErrorParaElUsuario(
          `«${actual.nombre}» es el único administrador activo de la empresa. Designe otro administrador antes de cambiarle el rol.`,
          'RECHAZADO',
          'rolId',
        );
      }
    }
    await conCorreoUnico(() =>
      cliente.query('UPDATE app.usuario SET nombre = $2, email = $3, rol_id = $4 WHERE id = $1', [id, datos.nombre, datos.email, datos.rolId]),
    );
    return (await leerUsuario(cliente, contexto, id))!;
  });
}

/** Revocar deja la fila (trazabilidad) y corta en la petición siguiente, por fn_exigir_permiso. */
export async function revocarUsuario(contexto: ContextoTenant, id: string): Promise<Usuario> {
  return ejecutarConPermiso(contexto, 'USUARIOS.GESTIONAR', async (cliente) => {
    if (!(await leerUsuario(cliente, contexto, id))) throw usuarioNoExiste();
    if (id === contexto.usuarioId) {
      throw new ErrorParaElUsuario('No puede retirarse el acceso a sí mismo. Pídaselo a otro administrador.', 'RECHAZADO');
    }
    await cliente.query(`UPDATE app.usuario SET estado = 'REVOCADO' WHERE id = $1 AND estado <> 'REVOCADO'`, [id]);
    return (await leerUsuario(cliente, contexto, id))!;
  });
}

/** Restituir: ACTIVO a quien ya tenía contraseña, PENDIENTE a quien nunca la fijó. Cuenta para el límite del plan. */
export async function restituirUsuario(contexto: ContextoTenant, id: string): Promise<Usuario> {
  return ejecutarConPermiso(contexto, 'USUARIOS.GESTIONAR', async (cliente) => {
    if (!(await leerUsuario(cliente, contexto, id))) throw usuarioNoExiste();
    await cliente.query(
      `UPDATE app.usuario
          SET estado = CASE WHEN password_hash IS NULL THEN 'PENDIENTE' ELSE 'ACTIVO' END
        WHERE id = $1 AND estado = 'REVOCADO'`,
      [id],
    );
    return (await leerUsuario(cliente, contexto, id))!;
  });
}

// --- Roles (CONTRATO §11.3) ----------------------------------------------------------

/** Siempre PERSONALIZADO: los de sistema nacen con la empresa (D-44). El plan lo vigila la base (RN-11). */
export async function crearRol(contexto: ContextoTenant, datos: DatosRol): Promise<Rol> {
  return ejecutarConPermiso(contexto, 'USUARIOS.GESTIONAR', async (cliente) => {
    const id = await conNombreDeRolUnico(datos.nombre, async () => {
      const { rows } = await cliente.query<{ id: string }>(
        `INSERT INTO app.rol (tenant_id, nombre, tipo) VALUES ($1, $2, 'PERSONALIZADO') RETURNING id`,
        [contexto.tenantId, datos.nombre],
      );
      return rows[0]!.id;
    });
    await escribirPermisos(cliente, contexto, id, datos.permisos);
    return (await leerRol(cliente, id))!;
  });
}

export async function editarRol(contexto: ContextoTenant, id: string, datos: DatosRol): Promise<Rol> {
  return ejecutarConPermiso(contexto, 'USUARIOS.GESTIONAR', async (cliente) => {
    const actual = await leerRol(cliente, id);
    if (!actual) throw rolNoExiste();
    if (actual.tipo === 'ADMIN') {
      throw new ErrorParaElUsuario('El rol Administrador tiene todos los permisos y no se modifica.', 'RECHAZADO');
    }
    if (actual.tipo === 'ASISTENTE' && datos.nombre !== actual.nombre) {
      throw new ErrorParaElUsuario('El rol Asistente es del sistema y no se renombra; sus permisos sí se editan.', 'RECHAZADO', 'nombre');
    }
    if (datos.nombre !== actual.nombre) {
      await conNombreDeRolUnico(datos.nombre, () => cliente.query('UPDATE app.rol SET nombre = $2 WHERE id = $1', [id, datos.nombre]));
    }
    await escribirPermisos(cliente, contexto, id, datos.permisos);
    return (await leerRol(cliente, id))!;
  });
}

/** Un rol con usuarios, aunque estén revocados, no se borra; los del sistema los defiende la base. */
export async function eliminarRol(contexto: ContextoTenant, id: string): Promise<void> {
  await ejecutarConPermiso(contexto, 'USUARIOS.GESTIONAR', async (cliente) => {
    const rol = await leerRol(cliente, id);
    if (!rol) throw rolNoExiste();
    if (rol.usuarios > 0) {
      const cuantos = rol.usuarios === 1 ? 'lo tiene 1 usuario' : `lo tienen ${rol.usuarios} usuarios`;
      throw new ErrorParaElUsuario(`El rol «${rol.nombre}» ${cuantos}. Cámbielos de rol antes de eliminarlo.`, 'RECHAZADO');
    }
    await cliente.query('DELETE FROM app.rol WHERE id = $1', [id]);
  });
}
