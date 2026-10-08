import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { CODIGOS_PERMISO } from '../infraestructura/basedatos/contextoTenant.js';
import { prepararEnlaceDeActivacion } from '../dueno/enlaceDeActivacion.js';
import { vencerSuscripcion } from '../pruebas/superusuario.js';
import { VERSION_TERMINOS_DE_PRUEBA, CARPETA_LEGAL_DE_PRUEBA, clienteDePrueba, cookieDe, type Cuenta } from '../pruebas/clienteHttp.js';
import { construirServidor } from './servidor.js';

let app: FastifyInstance;
const { otraIp, registrar, asistenteCon } = clienteDePrueba(() => app);

before(async () => {
  app = await construirServidor({ carpetaLegal: CARPETA_LEGAL_DE_PRUEBA, secretoSesion: randomBytes(32).toString('hex'), versionTerminos: VERSION_TERMINOS_DE_PRUEBA });
});
after(async () => {
  await app.close();
});

interface Usuario {
  id: string;
  nombre: string;
  email: string;
  estado: string;
  rolId: string;
  rolNombre: string;
  rolTipo: string;
  creadoEn: string;
  ultimoAcceso: string | null;
  activacionVenceEn: string | null;
  esUsted: boolean;
}
interface Rol {
  id: string;
  nombre: string;
  tipo: string;
  permisos: string[];
  usuarios: number;
}
interface Panel {
  plan: { codigo: string; maxUsuarios: number | null; rolesPersonalizados: boolean };
  usuarios: Usuario[];
  roles: Rol[];
  permisos: { codigo: string; modulo: string; accion: string; descripcion: string }[];
}

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

const panelDe = async (cookie: string) => (await llamar('GET', '/api/usuarios', cookie)).cuerpo as unknown as Panel;
const rolDe = (p: Panel, tipo: string) => p.roles.find((r) => r.tipo === tipo)!;

describe('el panel de usuarios (CONTRATO §11.1)', () => {
  test('una sola lectura: el plan, los usuarios, los roles y el catálogo sin PRESUPUESTOS.ESTADO', async () => {
    const duena = await registrar('Constructora Usuarios', '900000400-0', 'usuarios.admin@construsoft.test');
    const r = await llamar('GET', '/api/usuarios', duena.cookie);
    assert.equal(r.estado, 200, r.crudo);
    const p = r.cuerpo as unknown as Panel;
    assert.deepEqual(p.plan, { codigo: 'EMPRESARIAL', maxUsuarios: null, rolesPersonalizados: true });
    assert.deepEqual(
      p.usuarios.map((u) => [u.email, u.estado, u.rolTipo, u.esUsted]),
      [['usuarios.admin@construsoft.test', 'ACTIVO', 'ADMIN', true]],
    );
    assert.deepEqual(p.roles.map((x) => [x.nombre, x.tipo, x.usuarios]), [
      ['Administrador', 'ADMIN', 1],
      ['Asistente', 'ASISTENTE', 0],
    ]);
    assert.ok(!p.permisos.some((x) => x.codigo === 'PRESUPUESTOS.ESTADO'));
    assert.deepEqual(p.permisos.map((x) => x.codigo), CODIGOS_PERMISO.filter((c) => c !== 'PRESUPUESTOS.ESTADO'));
  });
});

describe('usuarios: invitar, editar, revocar y restituir (CONTRATO §11.2)', () => {
  let duena: Cuenta;
  let asistente: Rol;

  before(async () => {
    duena = await registrar('Constructora Invita', '900000401-1', 'invita.admin@construsoft.test');
    asistente = rolDe(await panelDe(duena.cookie), 'ASISTENTE');
  });

  test('invitar crea un PENDIENTE sin contraseña; el panel muestra cuándo vence su enlace', async () => {
    const r = await llamar('POST', '/api/usuarios', duena.cookie, { nombre: 'Dora', email: 'invita.dora@construsoft.test', rolId: asistente.id });
    assert.equal(r.estado, 201, r.crudo);
    assert.deepEqual([r.cuerpo.estado, r.cuerpo.rolTipo, r.cuerpo.activacionVenceEn, r.cuerpo.esUsted], ['PENDIENTE', 'ASISTENTE', null, false]);
    await prepararEnlaceDeActivacion('invita.dora@construsoft.test');
    const dora = (await panelDe(duena.cookie)).usuarios.find((u) => u.email === 'invita.dora@construsoft.test')!;
    assert.match(String(dora.activacionVenceEn), /^\d{4}-\d{2}-\d{2}T/);
  });

  test('el correo es único en todo ConstruSoft: repetido es 422 en email, sin decir de qué empresa', async () => {
    await registrar('Constructora Otra', '900000402-2', 'invita.otra@construsoft.test');
    const r = await llamar('POST', '/api/usuarios', duena.cookie, { nombre: 'X', email: 'INVITA.OTRA@construsoft.test', rolId: asistente.id });
    assert.deepEqual([r.estado, r.cuerpo.campo], [422, 'email'], r.crudo);
    assert.match(r.cuerpo.mensaje, /Cada correo pertenece a una sola empresa/);
    assert.doesNotMatch(r.cuerpo.mensaje, /Otra/);
  });

  test('el correo se edita solo mientras está PENDIENTE; el nombre y el rol, siempre', async () => {
    const creado = (await llamar('POST', '/api/usuarios', duena.cookie, { nombre: 'Eva', email: 'invita.eva@construsoft.test', rolId: asistente.id })).cuerpo;
    const corregido = await llamar('PUT', `/api/usuarios/${creado.id}`, duena.cookie, { nombre: 'Eva Ruiz', email: 'invita.eva2@construsoft.test', rolId: asistente.id });
    assert.deepEqual([corregido.estado, corregido.cuerpo.email, corregido.cuerpo.nombre], [200, 'invita.eva2@construsoft.test', 'Eva Ruiz']);

    const { token } = await prepararEnlaceDeActivacion('invita.eva2@construsoft.test');
    assert.equal((await app.inject({ method: 'POST', url: '/api/activacion', remoteAddress: otraIp(), payload: { token, contrasena: 'clave-de-eva-1' } })).statusCode, 204);
    const tarde = await llamar('PUT', `/api/usuarios/${creado.id}`, duena.cookie, { nombre: 'Eva Ruiz', email: 'invita.eva3@construsoft.test', rolId: asistente.id });
    assert.deepEqual([tarde.estado, tarde.cuerpo.campo], [422, 'email'], tarde.crudo);
  });

  test('revocar corta en la petición siguiente; restituir devuelve ACTIVO a quien tenía contraseña y PENDIENTE a quien no', async () => {
    const cookieDeFabio = await asistenteCon(duena, 'invita.fabio@construsoft.test', ['PRESUPUESTOS.VER']);
    const fabio = (await panelDe(duena.cookie)).usuarios.find((u) => u.email === 'invita.fabio@construsoft.test')!;
    const revocado = await llamar('POST', `/api/usuarios/${fabio.id}/revocar`, duena.cookie);
    assert.deepEqual([revocado.estado, revocado.cuerpo.estado], [200, 'REVOCADO'], revocado.crudo);
    assert.equal((await llamar('GET', '/api/presupuestos', cookieDeFabio)).estado, 403);
    const restituido = await llamar('POST', `/api/usuarios/${fabio.id}/restituir`, duena.cookie);
    assert.deepEqual([restituido.estado, restituido.cuerpo.estado], [200, 'ACTIVO']);

    const gina = (await llamar('POST', '/api/usuarios', duena.cookie, { nombre: 'Gina', email: 'invita.gina@construsoft.test', rolId: asistente.id })).cuerpo;
    await llamar('POST', `/api/usuarios/${gina.id}/revocar`, duena.cookie);
    assert.equal((await llamar('POST', `/api/usuarios/${gina.id}/restituir`, duena.cookie)).cuerpo.estado, 'PENDIENTE');
  });

  test('nadie se revoca a sí mismo, y el único administrador activo no cambia de rol', async () => {
    const yo = (await panelDe(duena.cookie)).usuarios.find((u) => u.esUsted)!;
    const revocarme = await llamar('POST', `/api/usuarios/${yo.id}/revocar`, duena.cookie);
    assert.equal(revocarme.estado, 422);
    assert.match(revocarme.cuerpo.mensaje, /a sí mismo/);
    const bajarme = await llamar('PUT', `/api/usuarios/${yo.id}`, duena.cookie, { nombre: yo.nombre, email: yo.email, rolId: asistente.id });
    assert.deepEqual([bajarme.estado, bajarme.cuerpo.campo], [422, 'rolId'], bajarme.crudo);
    assert.match(bajarme.cuerpo.mensaje, /único administrador activo/);
  });

  test('sin USUARIOS.GESTIONAR: 403; con la suscripción vencida, escribir es 402', async () => {
    const sinGestionar = await asistenteCon(duena, 'invita.sin@construsoft.test', ['PRESUPUESTOS.VER']);
    const r = await llamar('GET', '/api/usuarios', sinGestionar);
    assert.equal(r.estado, 403);
    assert.match(r.cuerpo.mensaje, /USUARIOS\.GESTIONAR/);
    const vencida = await registrar('Constructora Invita Vencida', '900000403-3', 'invita.vencida@construsoft.test');
    const rolV = rolDe(await panelDe(vencida.cookie), 'ASISTENTE');
    await vencerSuscripcion(vencida.contexto.tenantId);
    assert.equal((await llamar('POST', '/api/usuarios', vencida.cookie, { nombre: 'X', email: 'invita.v2@construsoft.test', rolId: rolV.id })).estado, 402);
  });
});

describe('el plan Personal (RN-11): dos usuarios y sin roles propios', () => {
  test('el segundo invitado supera el límite, y crear un rol lo rechaza la base', async () => {
    // registrar() siempre da el plan Empresarial; este usa Personal.
    const r0 = await app.inject({
      method: 'POST',
      url: '/api/registro',
      remoteAddress: otraIp(),
      payload: { nombre: 'Ana Personal', email: 'personal.ana@construsoft.test', contrasena: 'contrasena-segura-1', razonSocial: 'Ana Personal', nit: '900000405-5', plan: 'PERSONAL', aceptaTerminos: true, versionTerminos: VERSION_TERMINOS_DE_PRUEBA },
    });
    assert.equal(r0.statusCode, 201, r0.body);
    const cookie = cookieDe(r0)!;
    const p = await panelDe(cookie);
    assert.deepEqual(p.plan, { codigo: 'PERSONAL', maxUsuarios: 2, rolesPersonalizados: false });
    const asistente = rolDe(p, 'ASISTENTE');
    assert.equal((await llamar('POST', '/api/usuarios', cookie, { nombre: 'Su asistente', email: 'personal.asis@construsoft.test', rolId: asistente.id })).estado, 201);
    const tercero = await llamar('POST', '/api/usuarios', cookie, { nombre: 'Otro', email: 'personal.otro@construsoft.test', rolId: asistente.id });
    assert.deepEqual([tercero.estado, tercero.cuerpo.campo], [422, undefined], tercero.crudo);
    const rol = await llamar('POST', '/api/roles', cookie, { nombre: 'Residente', permisos: ['PRESUPUESTOS.VER'] });
    assert.equal(rol.estado, 422, rol.crudo);
  });
});

describe('roles (CONTRATO §11.3)', () => {
  let duena: Cuenta;

  before(async () => {
    duena = await registrar('Constructora Roles', '900000406-6', 'roles.http.admin@construsoft.test');
  });

  test('crear un rol PERSONALIZADO con su lista completa de permisos; el nombre repetido marca el campo', async () => {
    const r = await llamar('POST', '/api/roles', duena.cookie, { nombre: 'Residente', permisos: ['PRESUPUESTOS.VER', 'APU.VER', 'PRESUPUESTOS.EDITAR'] });
    assert.equal(r.estado, 201, r.crudo);
    assert.deepEqual([r.cuerpo.nombre, r.cuerpo.tipo, [...r.cuerpo.permisos].sort(), r.cuerpo.usuarios], ['Residente', 'PERSONALIZADO', ['APU.VER', 'PRESUPUESTOS.EDITAR', 'PRESUPUESTOS.VER'], 0]);
    const repetido = await llamar('POST', '/api/roles', duena.cookie, { nombre: 'Residente', permisos: ['PRESUPUESTOS.VER'] });
    assert.deepEqual([repetido.estado, repetido.cuerpo.campo], [422, 'nombre']);
  });

  test('las reglas de la matriz las hace cumplir la base: editar proyectos sin ver APU es 422', async () => {
    const r = await llamar('POST', '/api/roles', duena.cookie, { nombre: 'Incoherente', permisos: ['PRESUPUESTOS.VER', 'PRESUPUESTOS.EDITAR'] });
    assert.equal(r.estado, 422, r.crudo);
    assert.ok(!(await panelDe(duena.cookie)).roles.some((x) => x.nombre === 'Incoherente'));
  });

  test('editar reemplaza la lista completa; Administrador no se toca y Asistente no se renombra ni gestiona usuarios', async () => {
    const creado = (await llamar('POST', '/api/roles', duena.cookie, { nombre: 'Compras', permisos: ['RECURSOS.VER', 'RECURSOS.CREAR'] })).cuerpo;
    const editado = await llamar('PUT', `/api/roles/${creado.id}`, duena.cookie, { nombre: 'Compras y catálogo', permisos: ['RECURSOS.VER'] });
    assert.deepEqual([editado.estado, editado.cuerpo.nombre, editado.cuerpo.permisos], [200, 'Compras y catálogo', ['RECURSOS.VER']], editado.crudo);

    const p = await panelDe(duena.cookie);
    const admin = await llamar('PUT', `/api/roles/${rolDe(p, 'ADMIN').id}`, duena.cookie, { nombre: 'Administrador', permisos: [] });
    assert.equal(admin.estado, 422);
    assert.match(admin.cuerpo.mensaje, /Administrador tiene todos los permisos/);
    const asistente = rolDe(p, 'ASISTENTE');
    const renombrado = await llamar('PUT', `/api/roles/${asistente.id}`, duena.cookie, { nombre: 'Auxiliar', permisos: [] });
    assert.deepEqual([renombrado.estado, renombrado.cuerpo.campo], [422, 'nombre']);
    const gestiona = await llamar('PUT', `/api/roles/${asistente.id}`, duena.cookie, { nombre: 'Asistente', permisos: ['USUARIOS.GESTIONAR'] });
    assert.equal(gestiona.estado, 422);
    const bien = await llamar('PUT', `/api/roles/${asistente.id}`, duena.cookie, { nombre: 'Asistente', permisos: ['RECURSOS.VER'] });
    assert.deepEqual([bien.estado, bien.cuerpo.permisos], [200, ['RECURSOS.VER']]);
  });

  test('un rol con usuarios, aunque estén revocados, no se borra; sin usuarios, sí; los del sistema, nunca', async () => {
    const rol = (await llamar('POST', '/api/roles', duena.cookie, { nombre: 'Interventor', permisos: ['PRESUPUESTOS.VER'] })).cuerpo;
    const invitado = (await llamar('POST', '/api/usuarios', duena.cookie, { nombre: 'Hugo', email: 'roles.http.hugo@construsoft.test', rolId: rol.id })).cuerpo;
    await llamar('POST', `/api/usuarios/${invitado.id}/revocar`, duena.cookie);
    const conUsuarios = await llamar('DELETE', `/api/roles/${rol.id}`, duena.cookie);
    assert.equal(conUsuarios.estado, 422);
    assert.match(conUsuarios.cuerpo.mensaje, /El rol «Interventor» lo tiene 1 usuario/);

    const vacio = (await llamar('POST', '/api/roles', duena.cookie, { nombre: 'Sin nadie', permisos: ['RECURSOS.VER'] })).cuerpo;
    assert.equal((await llamar('DELETE', `/api/roles/${vacio.id}`, duena.cookie)).estado, 204);
    const sistema = await llamar('DELETE', `/api/roles/${rolDe(await panelDe(duena.cookie), 'ASISTENTE').id}`, duena.cookie);
    assert.equal(sistema.estado, 422);
  });
});

describe('aislamiento: los usuarios y los roles de otra empresa no existen (RN-01)', () => {
  test('cada ruta con un id de B responde lo mismo que con uno inexistente, y un rol de B al invitar es como uno inexistente', async () => {
    const a = await registrar('Constructora Usuarios A', '900000407-7', 'usuarios.a@construsoft.test');
    const b = await registrar('Constructora Usuarios B', '900000408-8', 'usuarios.b@construsoft.test');
    const pb = await panelDe(b.cookie);
    const usuarioDeB = pb.usuarios[0]!;
    const rolDeB = (await llamar('POST', '/api/roles', b.cookie, { nombre: 'De B', permisos: ['RECURSOS.VER'] })).cuerpo;
    const inexistente = '01900000-0000-7000-8000-000000000000';

    const rutas: [('POST' | 'PUT' | 'DELETE'), string, unknown][] = [
      ['PUT', '/api/usuarios/ID', { nombre: 'X', email: 'usuarios.x@construsoft.test', rolId: inexistente }],
      ['POST', '/api/usuarios/ID/revocar', undefined],
      ['POST', '/api/usuarios/ID/restituir', undefined],
    ];
    for (const [metodo, plantilla, cuerpo] of rutas) {
      const ajeno = await llamar(metodo, plantilla.replace('ID', usuarioDeB.id), a.cookie, cuerpo);
      assert.equal(ajeno.estado, 404, `${metodo} ${plantilla}: ${ajeno.crudo}`);
      for (const id of [inexistente, 'no-es-un-id']) {
        const otro = await llamar(metodo, plantilla.replace('ID', id), a.cookie, cuerpo);
        assert.deepEqual([otro.estado, otro.crudo], [ajeno.estado, ajeno.crudo], `${metodo} ${plantilla} con ${id}`);
      }
    }
    for (const [metodo, cuerpo] of [['PUT', { nombre: 'X', permisos: [] }], ['DELETE', undefined]] as const) {
      const ajeno = await llamar(metodo, `/api/roles/${rolDeB.id}`, a.cookie, cuerpo);
      assert.equal(ajeno.estado, 404, ajeno.crudo);
      const otro = await llamar(metodo, `/api/roles/${inexistente}`, a.cookie, cuerpo);
      assert.deepEqual([otro.estado, otro.crudo], [ajeno.estado, ajeno.crudo]);
    }
    const conRolDeB = await llamar('POST', '/api/usuarios', a.cookie, { nombre: 'X', email: 'usuarios.x1@construsoft.test', rolId: rolDeB.id });
    const conRolInexistente = await llamar('POST', '/api/usuarios', a.cookie, { nombre: 'X', email: 'usuarios.x2@construsoft.test', rolId: inexistente });
    assert.deepEqual([conRolDeB.estado, conRolDeB.cuerpo.campo, conRolDeB.cuerpo.mensaje], [conRolInexistente.estado, conRolInexistente.cuerpo.campo, conRolInexistente.cuerpo.mensaje]);
    assert.equal(conRolDeB.estado, 422);

    const pbDespues = await panelDe(b.cookie);
    assert.deepEqual(pbDespues.usuarios.map((u) => [u.email, u.estado]), [['usuarios.b@construsoft.test', 'ACTIVO']]);
  });
});
