import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import { z } from 'zod';
import {
  actualizarHashAlIngresar,
  leerMiCuenta,
  leerArranqueDeSesion,
  registrarEmpresa,
  selloVigente,
  consumirTokenRecuperacion,
  type ContextoTenant,
} from '../infraestructura/basedatos/contextoTenant.js';
import { autenticar } from '../infraestructura/basedatos/autenticacion.js';
import { crearPresupuesto, leerPresupuesto, listarPresupuestos } from '../infraestructura/basedatos/presupuesto.js';
import { ErrorParaElUsuario } from '../infraestructura/basedatos/errorParaElUsuario.js';
import { hashearContrasena, necesitaRehash, verificarContrasena } from './contrasenas.js';
import { sesionInvalida, traducirError } from './errores.js';
import { ContadorDeIntentos } from './limiteIntentos.js';
import { ATRIBUTOS_COOKIE, NOMBRE_COOKIE, armarSesion, leerSesion } from './sesion.js';
import { hashDeToken } from './tokens.js';
import { leerTerminos } from './terminos.js';
import { Rechazo, UUID } from './rechazo.js';
import { registrarRutasDeMesa } from './rutasMesa.js';
import { registrarRutasDeRecursos } from './rutasRecursos.js';
import { registrarRutasDeApu } from './rutasApu.js';
import { registrarRutasDeConfiguracion } from './rutasConfiguracion.js';
import { registrarRutasDeExportacion } from './rutasExportacion.js';
import { registrarRutasDeCicloDeVida } from './rutasCicloDeVida.js';
import { registrarRutasDeImportacion } from './rutasImportacion.js';

export interface OpcionesServidor {
  /** La clave de firma de la cookie: SESSION_SECRET del .env, que escribe el dueño. */
  secretoSesion: string;
  /** La versión de los términos y la política que se están publicando hoy (Ley 1581, 04 §7). */
  versionTerminos: string;
  /** A quién escribirle mientras los términos sean provisionales (PROVISIONAL-<fecha>). */
  contactoTerminos?: string | null;
  /**
   * Direcciones o subredes del proxy cuyo X-Forwarded-For se cree. Nunca
   * «true»: ver leerConfiguracion. Sin proxy, la IP es la de la conexión.
   */
  proxiesDeConfianza?: string[] | null;
  /** Dónde están las carpetas de los términos; por defecto legal/ del repositorio. Las pruebas usan textos sintéticos. */
  carpetaLegal?: string;
  /** El reloj, inyectable para probar el vencimiento de la sesión. */
  ahora?: () => number;
}

const QUINCE_MINUTOS = 15 * 60 * 1000;

/**
 * El primer problema de una validación, en palabras de la persona que llenó
 * el formulario, y el campo al que se refiere. Con campo, la interfaz marca
 * ese campo; sin campo, recarga la mesa (contrato §2).
 */
function respuestaDeValidacion(error: z.ZodError): { mensaje: string; campo?: string } {
  const problema = error.issues[0];
  const mensaje = problema?.message ?? 'Revise los datos del formulario.';
  const campo =
    problema && problema.path.length > 0
      ? problema.path.join('.')
      : problema?.code === 'unrecognized_keys'
        ? problema.keys[0]
        : undefined;
  return campo ? { mensaje, campo } : { mensaje };
}

const esquemaRegistro = z.object({
  nombre: z.string().trim().min(1, 'Escriba su nombre.'),
  email: z.email('Escriba un correo válido.'),
  contrasena: z.string().min(8, 'La contraseña necesita al menos 8 caracteres.'),
  razonSocial: z.string().trim().min(1, 'Escriba la razón social de la empresa.'),
  nit: z.string().trim().min(1, 'El NIT es obligatorio.'),
  plan: z.enum(['PERSONAL', 'EMPRESARIAL'], 'Elija un plan: Personal o Empresarial.'),
  aceptaTerminos: z.boolean(),
  versionTerminos: z.string(),
});

const esquemaIngreso = z.object({
  email: z.string().trim().min(1, 'Escriba su correo.'),
  contrasena: z.string().min(1, 'Escriba su contraseña.'),
});

const esquemaCambioDeContrasena = z.object({
  actual: z.string('Escriba su contraseña actual.').min(1, 'Escriba su contraseña actual.'),
  nueva: z.string('Escriba la contraseña nueva.').min(8, 'La contraseña necesita al menos 8 caracteres.'),
});

const esquemaRecuperacion = z.object({
  token: z.string().min(1, 'El enlace no es válido.'),
  contrasena: z.string().min(8, 'La contraseña necesita al menos 8 caracteres.'),
});

const esquemaFiltros = z.object({
  texto: z.string().optional(),
  estado: z.enum(['ABIERTO', 'ACTIVO', 'CERRADO']).optional(),
  archivados: z.enum(['true', 'false']).optional(),
});

const esquemaNuevoPresupuesto = z.object({
  codigo: z.string(),
  nombre: z.string(),
  ubicacion: z.string(),
  modoEstructura: z.enum(['ITEMS', 'WBS'], 'Elija la estructura: por ítems o por EDT.'),
});

/**
 * La API de la rebanada 6.1, derivada de las pantallas del documento 02:
 * registro (§3.1), ingreso (§3.2), inicio y arranque (§4, §3.4), la vista
 * maestra de presupuestos (§7) y el enlace de restablecimiento que entrega el
 * dueño (04 §8.5). No abre ninguna conexión propia: llama a los módulos de la
 * capa de datos, que usan los dos agrupadores (auth_login y app_login, 04
 * §8.3), y una regla de ESLint impide abrir un tercero.
 */
export async function construirServidor(opciones: OpcionesServidor): Promise<FastifyInstance> {
  const ahora = opciones.ahora ?? Date.now;
  const app = Fastify({ logger: false, trustProxy: opciones.proxiesDeConfianza ?? false });
  await app.register(cookie, { secret: opciones.secretoSesion });

  // Límite de intentos (04 §5). Por correo frena la serie contra una cuenta;
  // por IP, la serie que reparte un correo distinto en cada intento.
  const fallosPorCorreo = new ContadorDeIntentos({ maximo: 5, ventanaMs: QUINCE_MINUTOS, ahora });
  const fallosPorIp = new ContadorDeIntentos({ maximo: 20, ventanaMs: QUINCE_MINUTOS, ahora });
  const tokensFallidosPorIp = new ContadorDeIntentos({ maximo: 10, ventanaMs: QUINCE_MINUTOS, ahora });
  // Mi cuenta: una sesión robada no sirve para adivinar la contraseña actual.
  const cambiosFallidosPorUsuario = new ContadorDeIntentos({ maximo: 5, ventanaMs: QUINCE_MINUTOS, ahora });

  function exigirSinBloqueo(contador: ContadorDeIntentos, clave: string): void {
    const hasta = contador.bloqueadoHasta(clave);
    if (hasta === null) return;
    const segundos = Math.max(1, Math.ceil((hasta - ahora()) / 1000));
    throw new Rechazo(
      429,
      `Demasiados intentos fallidos. Espere ${Math.ceil(segundos / 60)} minuto(s) e intente de nuevo.`,
      { 'retry-after': String(segundos) },
    );
  }

  function abrirSesion(reply: FastifyReply, contexto: ContextoTenant, sello: string): void {
    reply.setCookie(NOMBRE_COOKIE, armarSesion(contexto, sello, ahora()), ATRIBUTOS_COOKIE);
  }

  /**
   * La sesión de la petición, o un 401 que además borra la cookie. Comprueba,
   * en este orden: que haya cookie, que la firma valga, que no haya vencido y
   * que el sello de credenciales siga siendo el de la base (D-67).
   */
  async function sesionDe(request: FastifyRequest, reply: FastifyReply): Promise<ContextoTenant> {
    const cruda = request.cookies[NOMBRE_COOKIE];
    const firmada = cruda ? request.unsignCookie(cruda) : null;
    const datos = firmada?.valid && firmada.value ? leerSesion(firmada.value, ahora()) : null;
    if (datos && UUID.test(datos.tenantId) && UUID.test(datos.usuarioId)) {
      const contexto = { tenantId: datos.tenantId, usuarioId: datos.usuarioId };
      if (await selloVigente(contexto, datos.sello)) return contexto;
    }
    if (cruda) reply.clearCookie(NOMBRE_COOKIE, { path: '/' });
    const { estado, mensaje } = sesionInvalida();
    throw new Rechazo(estado, mensaje);
  }

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof Rechazo) {
      return reply.code(error.estado).headers(error.cabeceras).send({ mensaje: error.message });
    }
    if (error instanceof z.ZodError) {
      return reply.code(422).send(respuestaDeValidacion(error));
    }
    // Errores del propio Fastify sobre la forma de la petición (JSON roto…).
    const deFastify =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number' &&
      error.statusCode < 500 &&
      'code' in error &&
      String(error.code).startsWith('FST_');
    if (deFastify && error.statusCode === 413) {
      return reply.code(413).send({ mensaje: 'El archivo pasa de 2 MB. Divídalo en varios y súbalos por separado.' });
    }
    if (deFastify) {
      return reply.code(400).send({ mensaje: 'La petición no tiene la forma esperada.' });
    }
    const respuesta = traducirError(error);
    if (respuesta.borrarCookie) reply.clearCookie(NOMBRE_COOKIE, { path: '/' });
    return reply
      .code(respuesta.estado)
      .send(respuesta.campo ? { mensaje: respuesta.mensaje, campo: respuesta.campo } : { mensaje: respuesta.mensaje });
  });

  // --- 04 §7 · Los términos que se están publicando ---------------------------
  // La pantalla de registro los muestra y manda de vuelta esta versión al
  // aceptar. Se leen aquí, al construir, de legal/<versión>/legal.html: si la
  // carpeta falta o le falta un documento, no arranca (04 §8.6). Una versión
  // PROVISIONAL- lleva el aviso de borrador dentro de cada documento.
  const provisional = opciones.versionTerminos.startsWith('PROVISIONAL-');
  const documentosLegales = leerTerminos(
    opciones.versionTerminos,
    provisional ? (opciones.contactoTerminos ?? 'el administrador de esta instalación') : null,
    ...(opciones.carpetaLegal ? [opciones.carpetaLegal] : []),
  );
  app.get('/api/terminos', async (_request, reply) => {
    return reply.send({ version: opciones.versionTerminos, provisional, documentos: documentosLegales });
  });

  // --- 02 §3.1 · Registro de una empresa nueva -------------------------------
  app.post('/api/registro', async (request, reply) => {
    const datos = esquemaRegistro.parse(request.body);
    if (!datos.aceptaTerminos) {
      throw new Rechazo(
        422,
        'Para registrarse tiene que aceptar los términos y la política de tratamiento de datos personales.',
      );
    }
    if (datos.versionTerminos !== opciones.versionTerminos) {
      throw new Rechazo(
        409,
        'Los términos cambiaron desde que abrió el formulario. Vuelva a leerlos y acéptelos para continuar.',
      );
    }
    const empresa = await registrarEmpresa({
      razonSocial: datos.razonSocial,
      nit: datos.nit,
      plan: datos.plan,
      adminNombre: datos.nombre,
      adminEmail: datos.email,
      adminHash: await hashearContrasena(datos.contrasena),
      versionTerminos: opciones.versionTerminos,
    });
    const contexto = { tenantId: empresa.tenantId, usuarioId: empresa.usuarioId };
    const yo = (await autenticar(datos.email))!;
    abrirSesion(reply, contexto, yo.credencialesEn);
    return reply.code(201).send(await leerArranqueDeSesion(contexto));
  });

  // --- 02 §3.2 · Ingreso -----------------------------------------------------
  app.post('/api/sesion', async (request, reply) => {
    const { email, contrasena } = esquemaIngreso.parse(request.body);
    const claveCorreo = `correo:${email.toLowerCase()}`;
    const claveIp = `ip:${request.ip}`;
    // El bloqueo se mira ANTES de verificar: durante el bloqueo, ni la
    // contraseña correcta abre, porque si abriera el bloqueo no frenaría nada.
    exigirSinBloqueo(fallosPorIp, claveIp);
    exigirSinBloqueo(fallosPorCorreo, claveCorreo);

    const usuario = await autenticar(email);
    if (usuario?.estado === 'PENDIENTE') {
      // La concesión de 04 §8.2: este aviso revela que el correo existe.
      throw new Rechazo(
        403,
        'Su cuenta todavía no está activa: abra el enlace de activación que le enviaron. ' +
          'Si venció, pídale uno nuevo al administrador de su empresa.',
      );
    }
    // Con usuario o sin él, siempre un Argon2 completo: «no existe» y «otra
    // contraseña» tardan lo mismo y responden lo mismo.
    const correcta = await verificarContrasena(usuario?.passwordHash ?? null, contrasena);
    if (!usuario || !correcta) {
      fallosPorCorreo.registrarFallo(claveCorreo);
      fallosPorIp.registrarFallo(claveIp);
      throw new Rechazo(401, 'El correo o la contraseña no son correctos. Revíselos e intente de nuevo.');
    }
    if (usuario.estado === 'REVOCADO') {
      throw new Rechazo(
        403,
        'Su acceso fue revocado. Si cree que es un error, hable con el administrador de su empresa.',
      );
    }

    fallosPorCorreo.reiniciar(claveCorreo);
    const contexto = { tenantId: usuario.tenantId, usuarioId: usuario.usuarioId };
    let sello = usuario.credencialesEn;
    if (necesitaRehash(usuario.passwordHash!)) {
      // 04 §8.2: un hash con parámetros viejos se rehace aquí. Eso mueve el
      // sello, y la cookie tiene que llevar el NUEVO.
      sello = await actualizarHashAlIngresar(contexto, await hashearContrasena(contrasena));
    }
    abrirSesion(reply, contexto, sello);
    return reply.send(await leerArranqueDeSesion(contexto));
  });

  // --- 02 §4 y §3.4 · El arranque: quién soy, qué puedo y en qué estado está la suscripción
  app.get('/api/sesion', async (request, reply) => {
    return reply.send(await leerArranqueDeSesion(await sesionDe(request, reply)));
  });

  app.delete('/api/sesion', async (_request, reply) => {
    reply.clearCookie(NOMBRE_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  // --- 02 §7 · Vista maestra de presupuestos ---------------------------------
  app.get('/api/presupuestos', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const filtros = esquemaFiltros.parse(request.query);
    return reply.send(
      await listarPresupuestos(contexto, {
        ...(filtros.texto ? { texto: filtros.texto } : {}),
        ...(filtros.estado ? { estado: filtros.estado } : {}),
        archivados: filtros.archivados === 'true',
      }),
    );
  });

  // Un id ajeno, uno inexistente y algo que ni es un id responden IGUAL: un
  // 404 que se distinga de otro ya dice que el presupuesto existe (RN-01).
  const noExiste = () => new ErrorParaElUsuario('Ese proyecto no existe en su empresa.', 'NO_EXISTE');

  app.get<{ Params: { id: string } }>('/api/presupuestos/:id', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    if (!UUID.test(request.params.id)) throw noExiste();
    const presupuesto = await leerPresupuesto(contexto, request.params.id);
    if (!presupuesto) throw noExiste();
    return reply.send(presupuesto);
  });

  // --- 02 §8 · La mesa de trabajo: la lectura única y la estructura ---------
  registrarRutasDeMesa(app, sesionDe);

  // --- 02 §5 · Recursos ---------------------------------------------------------
  registrarRutasDeRecursos(app, sesionDe);

  // --- 02 §6 · APU ---------------------------------------------------------------
  registrarRutasDeApu(app, sesionDe);

  // --- 02 §11 · Configuración -----------------------------------------------------
  registrarRutasDeConfiguracion(app, sesionDe);

  // --- 02 §9.5 y §10.1 · Exportación y versiones ----------------------------------
  registrarRutasDeExportacion(app, sesionDe);

  // --- 02 §9 y §10 · Ciclo de vida, cabecera, versiones, duplicar, historial -----
  registrarRutasDeCicloDeVida(app, sesionDe);

  // --- CONTRATO §10 · Importar recursos y APU desde Excel ------------------------
  registrarRutasDeImportacion(app, sesionDe);

  // --- 02 §11.1 · Cambiar la contraseña desde Mi cuenta ---------------------------
  // Verifica la actual, guarda la nueva y mueve el sello de credenciales
  // (D-67): todas las OTRAS sesiones de esta persona quedan cerradas, y esta
  // recibe una cookie con el sello nuevo. Una actual equivocada es un dato del
  // formulario (422 en «actual»), no una sesión inválida: un 401 sacaría a la
  // persona de la aplicación.
  app.post('/api/configuracion/cuenta/contrasena', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const { actual, nueva } = esquemaCambioDeContrasena.parse(request.body);
    const clave = `usuario:${contexto.usuarioId}`;
    exigirSinBloqueo(cambiosFallidosPorUsuario, clave);
    const { email } = await leerMiCuenta(contexto);
    const yo = await autenticar(email);
    if (!yo || !(await verificarContrasena(yo.passwordHash, actual))) {
      cambiosFallidosPorUsuario.registrarFallo(clave);
      throw new z.ZodError([
        { code: 'custom', path: ['actual'], message: 'La contraseña actual no es correcta.', input: actual },
      ]);
    }
    cambiosFallidosPorUsuario.reiniciar(clave);
    abrirSesion(reply, contexto, await actualizarHashAlIngresar(contexto, await hashearContrasena(nueva)));
    return reply.code(204).send();
  });

  // 02 §7.1 · «Crear Nuevo Presupuesto», desde la misma vista maestra.
  app.post('/api/presupuestos', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const datos = esquemaNuevoPresupuesto.parse(request.body);
    return reply.code(201).send(await crearPresupuesto(contexto, datos));
  });

  // --- 04 §8.5 · El enlace de restablecimiento ---------------------------------
  app.post('/api/recuperacion', async (request, reply) => {
    const claveIp = `ip:${request.ip}`;
    exigirSinBloqueo(tokensFallidosPorIp, claveIp);
    const { token, contrasena } = esquemaRecuperacion.parse(request.body);
    try {
      await consumirTokenRecuperacion(hashDeToken(token), await hashearContrasena(contrasena));
    } catch (error) {
      if (error instanceof ErrorParaElUsuario) tokensFallidosPorIp.registrarFallo(claveIp);
      throw error;
    }
    return reply.code(204).send();
  });

  return app;
}
