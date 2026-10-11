import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  leerLogo,
  leerMiCuenta,
  reportarPago,
  subirComprobanteDePago,
  type ContextoTenant,
} from '../infraestructura/basedatos/contextoTenant.js';
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
  quitarLogo,
  subirLogo,
} from '../infraestructura/basedatos/configuracionEmpresa.js';
import { ErrorParaElUsuario } from '../infraestructura/basedatos/errorParaElUsuario.js';
import { tipoDeComprobante, tipoDeImagen } from './firmaDeArchivo.js';
import { UUID } from './rechazo.js';
import { SIN_CAMPOS_DE_MAS, decimalComoTexto } from './validacion.js';

/*
 * Configuración (02 §11), pestaña por pestaña. Cada una pide su permiso de
 * catálogo, salvo Mi cuenta, que son los datos propios. Las reglas —NIT
 * único, separadores distintos, moneda bloqueada cuando ya hay datos, el
 * símbolo repetido sin distinguir mayúsculas— las defiende la base.
 *
 * El logotipo vive en app.logo (D-71) mientras no haya almacenamiento de
 * objetos. Usuarios y roles están en rutasUsuarios.ts.
 */

const UN_MEGA = 1024 * 1024;
const CINCO_MEGAS = 5 * UN_MEGA;

/** El reporte de un pago (CONTRATO §14.1). El comprobante se sube antes, aparte. */
const esquemaReporteDePago = z.strictObject(
  {
    fecha: z.string('Escriba la fecha del pago.').regex(/^\d{4}-\d{2}-\d{2}$/, 'Escriba la fecha del pago.'),
    monto: decimalComoTexto(18, 'El monto', 'Escriba el monto con punto decimal y hasta seis decimales.').refine(
      (m) => /[1-9]/.test(m),
      'El monto tiene que ser mayor que cero.',
    ),
    metodo: z.enum(['TRANSFERENCIA', 'PSE', 'EFECTIVO', 'OTRO'], 'Elija cómo pagó.'),
    referencia: z.string().trim().nullable().optional().transform((v) => v || null),
    periodoMeses: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)], 'Elija cuántos meses paga: 1, 3, 6 o 12.'),
    comprobanteId: z.string().nullable().optional(),
  },
  SIN_CAMPOS_DE_MAS,
);

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
    const { razonSocial, nit, direccion, telefono, emailRecuperacion, logoRuta } = await leerDatosEmpresa(contexto);
    return { razonSocial, nit, direccion, telefono, emailRecuperacion, logoId: logoRuta };
  }

  // --- CONTRATO §13 · El logotipo: subir, quitar y servir ---------------------------
  // El cuerpo del PUT es la imagen tal cual. El lector binario y su tope de
  // 1 MB viven dentro de este plugin; el 413 lleva su propio mensaje.
  void app.register(async (logo) => {
    logo.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: UN_MEGA }, (_request, cuerpo, listo) => listo(null, cuerpo));
    logo.setErrorHandler((error, _request, reply) => {
      if ((error as { statusCode?: number }).statusCode === 413) {
        return reply.code(413).send({ mensaje: 'El logotipo pesa más de 1 MB. Redúzcalo e intente de nuevo.' });
      }
      throw error;
    });

    logo.put('/api/configuracion/empresa/logo', async (request, reply) => {
      const contexto = await sesionDe(request, reply);
      const archivo = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
      const tipo = tipoDeImagen(archivo);
      if (!tipo) throw new ErrorParaElUsuario('El logotipo tiene que ser una imagen PNG o JPEG.', 'RECHAZADO');
      await subirLogo(contexto, archivo, tipo);
      return reply.send(await empresa(contexto));
    });
  });

  app.delete('/api/configuracion/empresa/logo', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    await quitarLogo(contexto);
    return reply.send(await empresa(contexto));
  });

  // Cualquier sesión de la empresa: el logo va en la cabecera de todas las
  // pantallas. El id ya identifica el contenido, así que la caché es eterna.
  app.get<{ Params: { id: string } }>('/api/logos/:id', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const imagen = UUID.test(request.params.id) ? await leerLogo(contexto, request.params.id) : null;
    if (!imagen) throw new ErrorParaElUsuario('Ese logotipo no existe en su empresa.', 'NO_EXISTE');
    return reply
      .header('content-type', imagen.tipo)
      .header('x-content-type-options', 'nosniff')
      .header('content-disposition', 'inline')
      .header('cache-control', 'private, max-age=31536000, immutable')
      .send(imagen.contenido);
  });

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

  // --- CONTRATO §14.1 · Reportar un pago: queda en verificación, no da acceso ----
  // El comprobante es el archivo tal cual, como el logo, con tope de 5 MB.
  void app.register(async (comprobantes) => {
    comprobantes.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: CINCO_MEGAS }, (_request, cuerpo, listo) => listo(null, cuerpo));
    comprobantes.setErrorHandler((error, _request, reply) => {
      if ((error as { statusCode?: number }).statusCode === 413) {
        return reply.code(413).send({ mensaje: 'El comprobante pesa más de 5 MB. Redúzcalo e intente de nuevo.', campo: 'comprobante' });
      }
      throw error;
    });

    comprobantes.post('/api/configuracion/suscripcion/comprobantes', async (request, reply) => {
      const contexto = await sesionDe(request, reply);
      const archivo = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
      const tipo = tipoDeComprobante(archivo);
      if (!tipo) {
        throw new ErrorParaElUsuario('El comprobante tiene que ser una imagen PNG o JPEG, o un PDF.', 'RECHAZADO', 'comprobante');
      }
      return reply.code(201).send({ id: await subirComprobanteDePago(contexto, archivo, tipo) });
    });
  });

  app.post('/api/configuracion/suscripcion/pagos', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const { comprobanteId, ...pago } = esquemaReporteDePago.parse(request.body);
    // El campo de la pantalla es «comprobante», no el id que viaja.
    if (!comprobanteId || !UUID.test(comprobanteId)) {
      throw new ErrorParaElUsuario('Adjunte el comprobante: sin él no podemos verificar el pago.', 'RECHAZADO', 'comprobante');
    }
    await reportarPago(contexto, { ...pago, comprobanteId });
    return reply.code(201).send(await leerSuscripcion(contexto));
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
