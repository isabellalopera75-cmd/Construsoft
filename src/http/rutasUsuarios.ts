import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CODIGOS_PERMISO, type ContextoTenant } from '../infraestructura/basedatos/contextoTenant.js';
import {
  crearRol,
  editarRol,
  editarUsuario,
  eliminarRol,
  invitarUsuario,
  leerPanelDeUsuarios,
  restituirUsuario,
  revocarUsuario,
} from '../infraestructura/basedatos/usuarios.js';
import { ErrorParaElUsuario } from '../infraestructura/basedatos/errorParaElUsuario.js';
import { UUID } from './rechazo.js';
import { SIN_CAMPOS_DE_MAS } from './validacion.js';

/*
 * Usuarios y roles (02 §11.4, CONTRATO §11). Las reglas están en la capa de
 * datos y en la base; aquí solo la forma del pedido y el 404 de un id que ni
 * siquiera es un id, igual al de uno ajeno o inexistente (RN-01).
 */

type SesionDe = (request: FastifyRequest, reply: FastifyReply) => Promise<ContextoTenant>;
type ConId = { Params: { id: string } };

const esquemaUsuario = z.strictObject(
  {
    nombre: z.string('Escriba el nombre.').trim().min(1, 'Escriba el nombre.'),
    email: z.email('Escriba un correo válido.'),
    rolId: z.string('Elija un rol.').regex(UUID, 'Elija un rol de la lista.'),
  },
  SIN_CAMPOS_DE_MAS,
);

const esquemaRol = z.strictObject(
  {
    nombre: z.string('Escriba el nombre del rol.').trim().min(1, 'Escriba el nombre del rol.'),
    permisos: z.array(z.enum(CODIGOS_PERMISO, 'Ese permiso no existe en el catálogo.'), 'Marque los permisos del rol.'),
  },
  SIN_CAMPOS_DE_MAS,
);

export function registrarRutasDeUsuarios(app: FastifyInstance, sesionDe: SesionDe): void {
  const usuarioNoExiste = () => new ErrorParaElUsuario('Ese usuario no existe en su empresa.', 'NO_EXISTE');
  const rolNoExiste = () => new ErrorParaElUsuario('Ese rol no existe en su empresa.', 'NO_EXISTE');

  // --- La lectura única de la pestaña (§11.1) -----------------------------------------
  app.get('/api/usuarios', async (request, reply) => {
    return reply.send(await leerPanelDeUsuarios(await sesionDe(request, reply)));
  });

  // --- Usuarios (§11.2) ------------------------------------------------------------------
  app.post('/api/usuarios', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    return reply.code(201).send(await invitarUsuario(contexto, esquemaUsuario.parse(request.body)));
  });

  app.put<ConId>('/api/usuarios/:id', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const datos = esquemaUsuario.parse(request.body);
    if (!UUID.test(request.params.id)) throw usuarioNoExiste();
    return reply.send(await editarUsuario(contexto, request.params.id, datos));
  });

  for (const [accion, operacion] of [
    ['revocar', revocarUsuario],
    ['restituir', restituirUsuario],
  ] as const) {
    app.post<ConId>(`/api/usuarios/:id/${accion}`, async (request, reply) => {
      const contexto = await sesionDe(request, reply);
      if (!UUID.test(request.params.id)) throw usuarioNoExiste();
      return reply.send(await operacion(contexto, request.params.id));
    });
  }

  // --- Roles (§11.3) ---------------------------------------------------------------------
  app.post('/api/roles', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    return reply.code(201).send(await crearRol(contexto, esquemaRol.parse(request.body)));
  });

  app.put<ConId>('/api/roles/:id', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const datos = esquemaRol.parse(request.body);
    if (!UUID.test(request.params.id)) throw rolNoExiste();
    return reply.send(await editarRol(contexto, request.params.id, datos));
  });

  app.delete<ConId>('/api/roles/:id', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    if (!UUID.test(request.params.id)) throw rolNoExiste();
    await eliminarRol(contexto, request.params.id);
    return reply.code(204).send();
  });
}
