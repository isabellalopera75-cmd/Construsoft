import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ejecutarConPermiso, type ContextoTenant } from '../infraestructura/basedatos/contextoTenant.js';
import { listarUnidadesParaElegir } from '../infraestructura/basedatos/configuracionEmpresa.js';
import { crearRecursosEnBloque, listarRecursos } from '../infraestructura/basedatos/recurso.js';
import { crearApusEnBloque, listarApus } from '../infraestructura/basedatos/apu.js';
import { FallasEnBloque } from '../infraestructura/basedatos/enBloque.js';
import { crearListaPropia } from '../infraestructura/basedatos/festivos.js';
import { ErrorParaElUsuario } from '../infraestructura/basedatos/errorParaElUsuario.js';
import { generarPlantillaDeApu, generarPlantillaDeFestivos, generarPlantillaDeRecursos, HOJA_APU, HOJA_FESTIVOS, HOJA_RECURSOS } from '../importacion/plantillas.js';
import { ArchivoNoValido, leerArchivoDeApu, leerArchivoDeFestivos, leerArchivoDeRecursos, type ErrorDeFila } from '../importacion/lectura.js';
import { traducirError } from './errores.js';

/*
 * Importar recursos y APU desde Excel (CONTRATO §10, alcance decidido por el
 * dueño el 6 de octubre de 2026). Cuatro rutas: dos plantillas y dos
 * importaciones. Todo o nada, solo crea, y se informan TODOS los errores con
 * hoja, fila de Excel y columna.
 *
 * El cuerpo del POST es el archivo tal cual. El lector binario se registra
 * dentro de este plugin, así que no cambia cómo leen su cuerpo las demás
 * rutas; el tope de 2 MB lo aplica Fastify, que responde 413.
 */

type SesionDe = (request: FastifyRequest, reply: FastifyReply) => Promise<ContextoTenant>;

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOS_MEGAS = 2 * 1024 * 1024;

function adjunto(reply: FastifyReply, nombre: string, archivo: Buffer) {
  return reply.header('content-type', XLSX).header('content-disposition', `attachment; filename="${nombre}"`).send(archivo);
}

/** Quien no puede crear recibe el 403 antes de descargar o de subir nada. */
const exigir = (contexto: ContextoTenant, permiso: 'RECURSOS.CREAR' | 'APU.CREAR' | 'CONFIG.PREFERENCIAS') =>
  ejecutarConPermiso(contexto, permiso, async () => undefined);

export function registrarRutasDeImportacion(app: FastifyInstance, sesionDe: SesionDe): void {
  void app.register(async (importacion) => {
    importacion.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: DOS_MEGAS }, (_request, cuerpo, listo) =>
      listo(null, cuerpo),
    );

    /** El 422 con la lista de errores, o el del archivo entero; el 201 si entró todo. */
    async function importar(
      reply: FastifyReply,
      hojaPrincipal: string,
      leer: () => Promise<{ errores: ErrorDeFila[]; crear: () => Promise<object> }>,
    ) {
      let lectura;
      try {
        lectura = await leer();
      } catch (error) {
        if (!(error instanceof ArchivoNoValido)) throw error;
        return reply.code(error.demasiadoGrande ? 413 : 422).send({ mensaje: error.message });
      }
      let errores = lectura.errores;
      if (errores.length === 0) {
        try {
          return reply.code(201).send(await lectura.crear());
        } catch (error) {
          if (!(error instanceof FallasEnBloque)) throw error;
          // Lo que la base rechazó dentro de la transacción, en la fila que lo causó.
          errores = error.fallas.map((f) => ({ hoja: hojaPrincipal, fila: f.fila, columna: null, mensaje: traducirError(f.error).mensaje }));
        }
      }
      return reply.code(422).send({
        mensaje: `El archivo tiene ${errores.length} ${errores.length === 1 ? 'error' : 'errores'} y no se importó nada. Corríjalos y vuelva a subirlo.`,
        errores,
      });
    }

    const comoArchivo = (cuerpo: unknown) => (Buffer.isBuffer(cuerpo) ? cuerpo : Buffer.alloc(0));

    // --- Recursos (CONTRATO §10.3) ------------------------------------------------
    importacion.get('/api/recursos/plantilla', async (request, reply) => {
      const contexto = await sesionDe(request, reply);
      await exigir(contexto, 'RECURSOS.CREAR');
      const unidades = await listarUnidadesParaElegir(contexto, 'RECURSOS.VER');
      return adjunto(reply, 'Plantilla de recursos.xlsx', await generarPlantillaDeRecursos(unidades.map((u) => u.simbolo)));
    });

    importacion.post('/api/recursos/importar', async (request, reply) => {
      const contexto = await sesionDe(request, reply);
      await exigir(contexto, 'RECURSOS.CREAR');
      return importar(reply, HOJA_RECURSOS, async () => {
        const [unidades, catalogo] = await Promise.all([listarUnidadesParaElegir(contexto, 'RECURSOS.VER'), listarRecursos(contexto)]);
        const { recursos, errores } = await leerArchivoDeRecursos(comoArchivo(request.body), unidades, catalogo);
        return { errores, crear: async () => ({ creados: await crearRecursosEnBloque(contexto, recursos) }) };
      });
    });

    // --- APU (CONTRATO §10.4) -------------------------------------------------------
    // El catálogo de recursos lo puede leer quien crea APU: D-70 exige RECURSOS.VER.
    async function catalogoDe(contexto: ContextoTenant) {
      const [recursos, unidades] = await Promise.all([listarRecursos(contexto), listarUnidadesParaElegir(contexto, 'APU.VER')]);
      return { recursos, unidades };
    }

    importacion.get('/api/apus/plantilla', async (request, reply) => {
      const contexto = await sesionDe(request, reply);
      await exigir(contexto, 'APU.CREAR');
      const { recursos, unidades } = await catalogoDe(contexto);
      const simbolo = new Map(unidades.map((u) => [u.id, u.simbolo]));
      const catalogo = recursos.map((r) => ({
        codigo: r.codigo,
        nombre: r.nombre,
        tipo: r.tipo,
        unidadSimbolo: simbolo.get(r.unidadId) ?? '',
        precioTotal: r.precioTotal,
      }));
      return adjunto(reply, 'Plantilla de APU.xlsx', await generarPlantillaDeApu(unidades.map((u) => u.simbolo), catalogo));
    });

    importacion.post('/api/apus/importar', async (request, reply) => {
      const contexto = await sesionDe(request, reply);
      await exigir(contexto, 'APU.CREAR');
      return importar(reply, HOJA_APU, async () => {
        const [{ recursos, unidades }, existentes] = await Promise.all([catalogoDe(contexto), listarApus(contexto)]);
        const { apus, errores } = await leerArchivoDeApu(comoArchivo(request.body), unidades, recursos, existentes);
        return { errores, crear: async () => ({ creados: await crearApusEnBloque(contexto, apus) }) };
      });
    });

    // --- CONTRATO §19.4 · Una lista propia de festivos ---------------------------------
    // Responde la lista creada, no { creados }: la pantalla la muestra enseguida.
    // Un nombre de lista que ya existe es el 409 de siempre, con su campo.
    importacion.get('/api/configuracion/festivos/plantilla', async (request, reply) => {
      const contexto = await sesionDe(request, reply);
      await exigir(contexto, 'CONFIG.PREFERENCIAS');
      return adjunto(reply, 'Plantilla de festivos.xlsx', await generarPlantillaDeFestivos());
    });

    importacion.post<{ Querystring: { nombre?: string } }>('/api/configuracion/festivos/importar', async (request, reply) => {
      const contexto = await sesionDe(request, reply);
      await exigir(contexto, 'CONFIG.PREFERENCIAS');
      const nombre = (request.query.nombre ?? '').trim();
      if (!nombre) throw new ErrorParaElUsuario('Escriba el nombre de la lista antes de subir el archivo.', 'RECHAZADO', 'nombre');
      return importar(reply, HOJA_FESTIVOS, async () => {
        const { fechas, errores } = await leerArchivoDeFestivos(comoArchivo(request.body));
        return { errores, crear: () => crearListaPropia(contexto, { nombre, fechas }) };
      });
    });
  });
}
