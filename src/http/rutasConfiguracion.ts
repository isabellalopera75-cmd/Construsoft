import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { leerMiCuenta, type ContextoTenant } from '../infraestructura/basedatos/contextoTenant.js';
import {
  actualizarDatosEmpresa,
  actualizarPreferencias,
  actualizarUnidad,
  crearUnidad,
  eliminarUnidad,
  leerDatosEmpresa,
  leerPreferencias,
  leerSuscripcion,
  listarUnidades,
} from '../infraestructura/basedatos/configuracionEmpresa.js';
import { ErrorParaElUsuario } from '../infraestructura/basedatos/errorParaElUsuario.js';
import { UUID } from './rechazo.js';
import { SIN_CAMPOS_DE_MAS } from './validacion.js';

/*
 * Configuración (02 §11), pestaña por pestaña. Cada una pide su permiso de
 * catálogo, salvo Mi cuenta, que son los datos propios. Las reglas —NIT
 * único, separadores distintos, moneda bloqueada cuando ya hay datos, el
 * símbolo repetido sin distinguir mayúsculas— las defiende la base.
 *
 * Fuera por ahora, y anotado en la bitácora: el logotipo (depende del
 * almacenamiento de objetos de D-30, que no existe todavía), el comprobante
 * PDF de cada pago (fase 7) y Usuarios (decisión pendiente sobre cómo llega
 * el enlace de activación sin correo, que es de la fase 8).
 */

type SesionDe = (request: FastifyRequest, reply: FastifyReply) => Promise<ContextoTenant>;

const opcional = <T extends z.ZodTypeAny>(esquema: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), esquema.nullable());

const esquemaEmpresa = z.strictObject(
  {
    razonSocial: z.string('Escriba la razón social.').trim().min(1, 'Escriba la razón social.'),
    nit: z.string('Escriba el NIT.').trim().min(1, 'Escriba el NIT.'),
    direccion: opcional(z.string().trim()),
    telefono: opcional(z.string().trim()),
    // D-29: distinto del correo de ingreso; lo exige la base.
    emailRecuperacion: opcional(z.email('Escriba un correo válido.')),
  },
  SIN_CAMPOS_DE_MAS,
);

const esquemaPreferencias = z.strictObject(
  {
    monedaBase: z.string('Elija la moneda.').regex(/^[A-Z]{3}$/, 'Elija la moneda.'),
    separadorMiles: z.string('Elija el separador de miles.').length(1, 'Elija el separador de miles.'),
    separadorDecimal: z.string('Elija el separador decimal.').length(1, 'Elija el separador decimal.'),
    decimalesVista: z.union([z.literal(0), z.literal(1), z.literal(2)], 'Los decimales a mostrar son 0, 1 o 2.'),
    notifVencimiento: z.boolean('Indique si quiere el aviso de vencimiento.'),
    notifCambioEstado: z.boolean('Indique si quiere el aviso de cambio de estado.'),
  },
  SIN_CAMPOS_DE_MAS,
);

const esquemaUnidad = z.strictObject(
  {
    simbolo: z.string('Escriba el símbolo.').trim().min(1, 'Escriba el símbolo.'),
    descripcion: z.string('Escriba la descripción.').trim().min(1, 'Escriba la descripción.'),
  },
  SIN_CAMPOS_DE_MAS,
);

export function registrarRutasDeConfiguracion(app: FastifyInstance, sesionDe: SesionDe): void {
  const unidadNoExiste = () => new ErrorParaElUsuario('Esa unidad de medida no existe en su empresa.', 'NO_EXISTE');

  /** Lo que se muestra de la empresa. El logo queda fuera hasta que exista dónde guardarlo (D-30). */
  async function empresa(contexto: ContextoTenant) {
    const { razonSocial, nit, direccion, telefono, emailRecuperacion } = await leerDatosEmpresa(contexto);
    return { razonSocial, nit, direccion, telefono, emailRecuperacion };
  }

  // --- 02 §11.1 · Mi cuenta ------------------------------------------------------
  app.get('/api/configuracion/cuenta', async (request, reply) => {
    return reply.send(await leerMiCuenta(await sesionDe(request, reply)));
  });

  // --- 02 §11.2 · Datos de empresa -----------------------------------------------
  app.get('/api/configuracion/empresa', async (request, reply) => {
    return reply.send(await empresa(await sesionDe(request, reply)));
  });

  app.put('/api/configuracion/empresa', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const datos = esquemaEmpresa.parse(request.body);
    // El formulario no trae el logo: se conserva el que haya.
    const { logoRuta } = await leerDatosEmpresa(contexto);
    await actualizarDatosEmpresa(contexto, { ...datos, logoRuta });
    return reply.send(await empresa(contexto));
  });

  // --- 02 §11.3 · Suscripción: el estado y los pagos; no cobra -------------------
  app.get('/api/configuracion/suscripcion', async (request, reply) => {
    return reply.send(await leerSuscripcion(await sesionDe(request, reply)));
  });

  // --- 02 §11.5 · Preferencias del sistema ---------------------------------------
  app.get('/api/configuracion/preferencias', async (request, reply) => {
    return reply.send(await leerPreferencias(await sesionDe(request, reply)));
  });

  app.put('/api/configuracion/preferencias', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    await actualizarPreferencias(contexto, esquemaPreferencias.parse(request.body));
    return reply.send(await leerPreferencias(contexto));
  });

  // --- 02 §11.6 · Unidades de medida ---------------------------------------------
  app.get('/api/configuracion/unidades', async (request, reply) => {
    return reply.send({ unidades: await listarUnidades(await sesionDe(request, reply)) });
  });

  app.post('/api/configuracion/unidades', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    return reply.code(201).send(await crearUnidad(contexto, esquemaUnidad.parse(request.body)));
  });

  app.put<{ Params: { id: string } }>('/api/configuracion/unidades/:id', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const datos = esquemaUnidad.parse(request.body);
    const unidad = UUID.test(request.params.id) ? await actualizarUnidad(contexto, request.params.id, datos) : null;
    if (!unidad) throw unidadNoExiste();
    return reply.send(unidad);
  });

  app.delete<{ Params: { id: string } }>('/api/configuracion/unidades/:id', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const { id } = request.params;
    if (!UUID.test(id) || !(await listarUnidades(contexto)).some((u) => u.id === id)) throw unidadNoExiste();
    await eliminarUnidad(contexto, id);
    return reply.code(204).send();
  });
}
