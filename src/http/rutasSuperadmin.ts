import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  buscarSuperadmin,
  cambiarClaveSuperadmin,
  cambiarSuscripcion,
  cambiarSuspension,
  cancelarSuscripcion,
  designarAdministrador,
  eliminarEmpresa,
  leerFicha,
  leerResumen,
  leerSoporte,
  listarEmpresas,
  listarEventos,
  listarPagos,
  proponerCubreHasta,
  registrarPago,
  subirSoporte,
  superadminVigente,
  type Superadmin,
  type TipoDeSoporte,
} from '../infraestructura/basedatos/plataforma.js';
import { ErrorParaElUsuario } from '../infraestructura/basedatos/errorParaElUsuario.js';
import { hashearContrasena, necesitaRehash, verificarContrasena } from './contrasenas.js';
import { ContadorDeIntentos } from './limiteIntentos.js';
import { Rechazo, UUID } from './rechazo.js';
import { SIN_CAMPOS_DE_MAS, decimalComoTexto } from './validacion.js';

/*
 * El panel del superadministrador (CONTRATO §12). Otra conexión a la base
 * (plataforma.ts), otra cookie y otro límite de intentos: nada de esto se
 * mezcla con las empresas. Una cookie de empresa no abre ninguna ruta de
 * aquí, y la del panel, con Path=/api/superadmin, ni siquiera viaja a las
 * demás.
 */

export const COOKIE_PLATAFORMA = 'cs_plataforma';
const RUTA = '/api/superadmin';
/** 2 horas (CONTRATO §12.1): menos que la de las empresas, porque abre todas. */
const DURACION_MS = 2 * 60 * 60 * 1000;
const QUINCE_MINUTOS = 15 * 60 * 1000;
const CINCO_MEGAS = 5 * 1024 * 1024;

const ATRIBUTOS = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: RUTA,
  maxAge: DURACION_MS / 1000,
  signed: true,
} as const;

interface DatosDeSesion {
  usuarioId: string;
  sello: string;
  venceEn: number;
}

function leerCookie(valor: string, ahora: number): DatosDeSesion | null {
  try {
    const datos = JSON.parse(Buffer.from(valor, 'base64url').toString('utf8')) as Partial<DatosDeSesion>;
    if (typeof datos.usuarioId !== 'string' || typeof datos.sello !== 'string' || typeof datos.venceEn !== 'number') return null;
    return datos.venceEn > ahora && UUID.test(datos.usuarioId) ? (datos as DatosDeSesion) : null;
  } catch {
    return null;
  }
}

/** PNG, JPEG o PDF por la FIRMA del archivo, no por lo que diga el navegador (D-71). */
function tipoDeSoporte(archivo: Buffer): TipoDeSoporte | null {
  if (archivo.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (archivo.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (archivo.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const fecha = (mensaje: string) => z.string(mensaje).regex(FECHA, mensaje);
const obligatorio = (mensaje: string) => z.string(mensaje).trim().min(1, mensaje);

const esquemaIngreso = z.object({
  email: obligatorio('Escriba su correo.'),
  contrasena: z.string('Escriba su contraseña.').min(1, 'Escriba su contraseña.'),
});

const esquemaFiltros = z.object({
  texto: z.string().optional(),
  estado: z.enum(['EN_PRUEBA', 'ACTIVA', 'VENCIDA', 'CANCELADA', 'SIN_SUSCRIPCION', 'SUSPENDIDA'], 'Ese estado no existe.').optional(),
  plan: z.enum(['PERSONAL', 'EMPRESARIAL'], 'Ese plan no existe.').optional(),
});

const esquemaMotivo = z.strictObject({ motivo: obligatorio('Escriba el motivo.') }, SIN_CAMPOS_DE_MAS);

const esquemaSuscripcion = z.strictObject(
  {
    planCodigo: z.enum(['PERSONAL', 'EMPRESARIAL'], 'Elija el plan: Personal o Empresarial.'),
    venceEl: fecha('Elija la fecha de vencimiento.'),
    motivo: obligatorio('Escriba el motivo.'),
  },
  SIN_CAMPOS_DE_MAS,
);

const esquemaPropuesta = z.object({
  periodoMeses: z.coerce.number('Elija cuántos meses cubre el pago.').int('Elija cuántos meses cubre el pago.').min(1, 'El período es de al menos un mes.'),
});

const esquemaPago = z
  .strictObject(
    {
      fecha: fecha('Escriba la fecha del pago.'),
      concepto: obligatorio('Escriba el concepto.'),
      monto: decimalComoTexto(18, 'El monto', 'Escriba el monto con punto decimal y hasta seis decimales.'),
      metodo: z.enum(['TRANSFERENCIA', 'PSE', 'EFECTIVO', 'OTRO'], 'Elija el método de pago.'),
      referencia: z.string().trim().nullable().optional().transform((v) => v || null),
      periodoMeses: z.number().int().min(1, 'El período es de al menos un mes.').nullable().optional(),
      cubreHasta: fecha('Escriba hasta qué fecha cubre el pago.').nullable().optional(),
      soporteId: z.string().regex(UUID, 'Ese comprobante no existe. Súbalo otra vez.').nullable().optional(),
    },
    SIN_CAMPOS_DE_MAS,
  )
  // D-36: llega el período o la fecha. Si llegan los dos, manda la fecha.
  .refine((p) => p.periodoMeses != null || p.cubreHasta != null, {
    message: 'Elija cuántos meses cubre el pago o hasta qué fecha.',
    path: ['periodoMeses'],
  });

const esquemaAdministrador = z.strictObject(
  {
    email: z.email('Escriba un correo válido.'),
    nombre: obligatorio('Escriba el nombre.'),
    justificacion: obligatorio('Escriba cómo verificó la identidad de quien lo pidió.'),
  },
  SIN_CAMPOS_DE_MAS,
);

const esquemaEliminar = z.strictObject(
  {
    justificacion: obligatorio('Escriba la justificación.'),
    confirmacion: obligatorio('Escriba la razón social para confirmar.'),
  },
  SIN_CAMPOS_DE_MAS,
);

const esquemaRango = z.object({
  desde: fecha('Elija la fecha inicial.'),
  hasta: fecha('Elija la fecha final.'),
});

const esquemaEventos = z.object({
  empresaId: z.string().regex(UUID, 'Esa empresa no existe.').optional(),
});

export function registrarRutasDelPanel(app: FastifyInstance, ahora: () => number): void {
  // El mismo límite que el ingreso de las empresas (CONTRATO §12.1), en
  // contadores propios: los fallos de un lado no bloquean al otro.
  const fallosPorCorreo = new ContadorDeIntentos({ maximo: 5, ventanaMs: QUINCE_MINUTOS, ahora });
  const fallosPorIp = new ContadorDeIntentos({ maximo: 20, ventanaMs: QUINCE_MINUTOS, ahora });

  function exigirSinBloqueo(contador: ContadorDeIntentos, clave: string): void {
    const hasta = contador.bloqueadoHasta(clave);
    if (hasta === null) return;
    const segundos = Math.max(1, Math.ceil((hasta - ahora()) / 1000));
    throw new Rechazo(429, `Demasiados intentos fallidos. Espere ${Math.ceil(segundos / 60)} minuto(s) e intente de nuevo.`, {
      'retry-after': String(segundos),
    });
  }

  function abrirSesion(reply: FastifyReply, usuarioId: string, sello: string): void {
    const datos: DatosDeSesion = { usuarioId, sello, venceEn: ahora() + DURACION_MS };
    reply.setCookie(COOKIE_PLATAFORMA, Buffer.from(JSON.stringify(datos), 'utf8').toString('base64url'), ATRIBUTOS);
  }

  /** El superadministrador de la petición, o 401 y la cookie borrada. */
  async function sesionDe(request: FastifyRequest, reply: FastifyReply): Promise<Superadmin> {
    const cruda = request.cookies[COOKIE_PLATAFORMA];
    const firmada = cruda ? request.unsignCookie(cruda) : null;
    const datos = firmada?.valid && firmada.value ? leerCookie(firmada.value, ahora()) : null;
    const yo = datos ? await superadminVigente(datos.usuarioId, datos.sello) : null;
    if (yo) return yo;
    if (cruda) reply.clearCookie(COOKIE_PLATAFORMA, { path: RUTA });
    throw new Rechazo(401, 'Su sesión del panel ya no es válida. Ingrese de nuevo.');
  }

  const empresaNoExiste = () => new ErrorParaElUsuario('Esa empresa no existe.', 'NO_EXISTE');

  async function ficha(id: string) {
    const encontrada = UUID.test(id) ? await leerFicha(id) : null;
    if (!encontrada) throw empresaNoExiste();
    return encontrada;
  }

  /** Antes de tocar nada: un id que no es un id responde igual que uno que no existe. */
  function idDeEmpresa(id: string): string {
    if (!UUID.test(id)) throw empresaNoExiste();
    return id;
  }

  // --- §12.1 · La sesión ----------------------------------------------------------
  app.post(`${RUTA}/sesion`, async (request, reply) => {
    const { email, contrasena } = esquemaIngreso.parse(request.body);
    const claveCorreo = `correo:${email.toLowerCase()}`;
    const claveIp = `ip:${request.ip}`;
    exigirSinBloqueo(fallosPorIp, claveIp);
    exigirSinBloqueo(fallosPorCorreo, claveCorreo);

    const yo = await buscarSuperadmin(email);
    // Siempre un Argon2 completo, y el mismo mensaje para «no existe»,
    // «otra contraseña» y «cuenta inactiva»: el panel no confirma correos.
    const correcta = await verificarContrasena(yo?.passwordHash ?? null, contrasena);
    if (!yo || !correcta || !yo.activo) {
      fallosPorCorreo.registrarFallo(claveCorreo);
      fallosPorIp.registrarFallo(claveIp);
      throw new Rechazo(401, 'El correo o la contraseña no son correctos. Revíselos e intente de nuevo.');
    }
    fallosPorCorreo.reiniciar(claveCorreo);
    let sello = yo.sello;
    if (necesitaRehash(yo.passwordHash)) sello = await cambiarClaveSuperadmin(yo.email, await hashearContrasena(contrasena));
    abrirSesion(reply, yo.id, sello);
    return reply.send({ nombre: yo.nombre, email: yo.email });
  });

  app.get(`${RUTA}/sesion`, async (request, reply) => {
    const { nombre, email } = await sesionDe(request, reply);
    return reply.send({ nombre, email });
  });

  app.delete(`${RUTA}/sesion`, async (_request, reply) => {
    reply.clearCookie(COOKIE_PLATAFORMA, { path: RUTA });
    return reply.code(204).send();
  });

  // --- §12.3 · Lecturas -----------------------------------------------------------
  app.get(`${RUTA}/resumen`, async (request, reply) => {
    await sesionDe(request, reply);
    return reply.send(await leerResumen());
  });

  app.get(`${RUTA}/empresas`, async (request, reply) => {
    await sesionDe(request, reply);
    const filtros = esquemaFiltros.parse(request.query);
    return reply.send({
      empresas: await listarEmpresas({
        ...(filtros.texto ? { texto: filtros.texto } : {}),
        ...(filtros.estado ? { estado: filtros.estado } : {}),
        ...(filtros.plan ? { plan: filtros.plan } : {}),
      }),
    });
  });

  app.get<{ Params: { id: string } }>(`${RUTA}/empresas/:id`, async (request, reply) => {
    await sesionDe(request, reply);
    return reply.send(await ficha(request.params.id));
  });

  app.get(`${RUTA}/pagos`, async (request, reply) => {
    await sesionDe(request, reply);
    const { desde, hasta } = esquemaRango.parse(request.query);
    return reply.send(await listarPagos(desde, hasta));
  });

  app.get(`${RUTA}/eventos`, async (request, reply) => {
    await sesionDe(request, reply);
    const { empresaId } = esquemaEventos.parse(request.query);
    return reply.send({ eventos: await listarEventos(empresaId ?? null) });
  });

  // --- §12.3 · Acciones firmadas ----------------------------------------------------
  for (const [accion, suspender] of [
    ['suspender', true],
    ['reactivar', false],
  ] as const) {
    app.post<{ Params: { id: string } }>(`${RUTA}/empresas/:id/${accion}`, async (request, reply) => {
      const yo = await sesionDe(request, reply);
      const id = idDeEmpresa(request.params.id);
      const { motivo } = esquemaMotivo.parse(request.body);
      await cambiarSuspension({ autor: yo.id, motivo }, id, suspender);
      return reply.send(await ficha(id));
    });
  }

  app.put<{ Params: { id: string } }>(`${RUTA}/empresas/:id/suscripcion`, async (request, reply) => {
    const yo = await sesionDe(request, reply);
    const id = idDeEmpresa(request.params.id);
    const { motivo, ...datos } = esquemaSuscripcion.parse(request.body);
    await cambiarSuscripcion({ autor: yo.id, motivo }, id, datos);
    return reply.send(await ficha(id));
  });

  app.post<{ Params: { id: string } }>(`${RUTA}/empresas/:id/suscripcion/cancelar`, async (request, reply) => {
    const yo = await sesionDe(request, reply);
    const id = idDeEmpresa(request.params.id);
    const { motivo } = esquemaMotivo.parse(request.body);
    await cancelarSuscripcion({ autor: yo.id, motivo }, id);
    return reply.send(await ficha(id));
  });

  app.get<{ Params: { id: string } }>(`${RUTA}/empresas/:id/pagos/propuesta`, async (request, reply) => {
    await sesionDe(request, reply);
    const id = idDeEmpresa(request.params.id);
    const { periodoMeses } = esquemaPropuesta.parse(request.query);
    return reply.send({ cubreHasta: await proponerCubreHasta(id, periodoMeses) });
  });

  app.post<{ Params: { id: string } }>(`${RUTA}/empresas/:id/pagos`, async (request, reply) => {
    const yo = await sesionDe(request, reply);
    const id = idDeEmpresa(request.params.id);
    const pago = esquemaPago.parse(request.body);
    await registrarPago(yo.id, id, {
      fecha: pago.fecha,
      concepto: pago.concepto,
      monto: pago.monto,
      metodo: pago.metodo,
      referencia: pago.referencia ?? null,
      periodoMeses: pago.periodoMeses ?? null,
      cubreHasta: pago.cubreHasta ?? null,
      soporteId: pago.soporteId ?? null,
    });
    return reply.code(201).send(await ficha(id));
  });

  app.post<{ Params: { id: string } }>(`${RUTA}/empresas/:id/administrador`, async (request, reply) => {
    const yo = await sesionDe(request, reply);
    const id = idDeEmpresa(request.params.id);
    await designarAdministrador(yo.id, id, esquemaAdministrador.parse(request.body));
    return reply.send(await ficha(id));
  });

  app.delete<{ Params: { id: string } }>(`${RUTA}/empresas/:id`, async (request, reply) => {
    const yo = await sesionDe(request, reply);
    const id = idDeEmpresa(request.params.id);
    await eliminarEmpresa(yo.id, id, esquemaEliminar.parse(request.body));
    return reply.code(204).send();
  });

  // --- §12.3 · Comprobantes (D-71) ---------------------------------------------------
  // El cuerpo es el archivo tal cual. El lector binario y su tope de 5 MB
  // viven dentro de este plugin; el 413 lleva su propio mensaje.
  void app.register(async (soportes) => {
    soportes.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: CINCO_MEGAS }, (_request, cuerpo, listo) => listo(null, cuerpo));
    soportes.setErrorHandler((error, _request, reply) => {
      if ((error as { statusCode?: number }).statusCode === 413) {
        return reply.code(413).send({ mensaje: 'El comprobante pesa más de 5 MB. Redúzcalo e intente de nuevo.' });
      }
      throw error;
    });

    soportes.post(`${RUTA}/soportes`, async (request, reply) => {
      const yo = await sesionDe(request, reply);
      const archivo = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
      const tipo = tipoDeSoporte(archivo);
      if (!tipo) throw new ErrorParaElUsuario('El comprobante tiene que ser una imagen PNG o JPEG, o un PDF.', 'RECHAZADO');
      return reply.code(201).send({ id: await subirSoporte(yo.id, archivo, tipo) });
    });
  });

  app.get<{ Params: { id: string } }>(`${RUTA}/soportes/:id`, async (request, reply) => {
    await sesionDe(request, reply);
    const soporte = UUID.test(request.params.id) ? await leerSoporte(request.params.id) : null;
    if (!soporte) throw new ErrorParaElUsuario('Ese comprobante no existe.', 'NO_EXISTE');
    return reply
      .header('content-type', soporte.tipo)
      .header('x-content-type-options', 'nosniff')
      .header('content-disposition', 'inline')
      .header('cache-control', 'private, no-store')
      .send(soporte.contenido);
  });
}
