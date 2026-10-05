import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ContextoTenant } from '../infraestructura/basedatos/contextoTenant.js';
import {
  leerPresupuestoParaExportar,
  leerVersionParaExportar,
  type DocumentoExportable,
} from '../infraestructura/basedatos/exportacion.js';
import { leerPresupuesto } from '../infraestructura/basedatos/presupuesto.js';
import { listarVersiones } from '../infraestructura/basedatos/versiones.js';
import { ErrorParaElUsuario } from '../infraestructura/basedatos/errorParaElUsuario.js';
import { generarExcel } from '../exportacion/excel.js';
import { generarPdf } from '../exportacion/pdf.js';
import { UUID } from './rechazo.js';

/*
 * Exportar la oferta (02 §9.5) y el historial de versiones (02 §10.1). Los
 * archivos los arman generarPdf y generarExcel sobre la fotografía que
 * entrega la base: aquí solo se elige el formato y se nombra el archivo.
 *
 * El logo va en null hasta que exista el almacenamiento de objetos (D-30):
 * los dos generadores ya saben dibujarlo cuando llegue.
 */

type SesionDe = (request: FastifyRequest, reply: FastifyReply) => Promise<ContextoTenant>;

const esquemaFormato = z.object({
  formato: z.enum(['pdf', 'xlsx'], 'Elija el formato: pdf o xlsx.'),
});

const TIPO_DE_CONTENIDO = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;

/**
 * Content-Disposition con los dos nombres de RFC 6266: uno ASCII para quien
 * no entienda otra cosa, y filename* en UTF-8 con las tildes del código o de
 * «Versión». Del ASCII se quitan comillas y barras, que romperían la cabecera.
 */
function adjunto(nombre: string): string {
  const ascii = nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]|["\\/]/g, '-');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nombre)}`;
}

export function registrarRutasDeExportacion(app: FastifyInstance, sesionDe: SesionDe): void {
  const presupuestoNoExiste = () => new ErrorParaElUsuario('Ese presupuesto no existe en su empresa.', 'NO_EXISTE');
  const versionNoExiste = () => new ErrorParaElUsuario('Esa versión no existe en su empresa.', 'NO_EXISTE');

  async function enviarArchivo(reply: FastifyReply, documento: DocumentoExportable, formato: 'pdf' | 'xlsx') {
    const { codigo } = documento.fotografia.presupuesto;
    const nombre = documento.numeroVersion === null ? codigo : `${codigo} - Versión ${documento.numeroVersion}`;
    const archivo = formato === 'pdf' ? await generarPdf(documento, null) : await generarExcel(documento, null);
    return reply
      .header('content-type', TIPO_DE_CONTENIDO[formato])
      .header('content-disposition', adjunto(`${nombre}.${formato}`))
      .send(archivo);
  }

  // --- 02 §9.5 · El presupuesto como está hoy ------------------------------------
  app.get<{ Params: { id: string } }>('/api/presupuestos/:id/exportar', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const { formato } = esquemaFormato.parse(request.query);
    const documento = UUID.test(request.params.id) ? await leerPresupuestoParaExportar(contexto, request.params.id) : null;
    if (!documento) throw presupuestoNoExiste();
    return enviarArchivo(reply, documento, formato);
  });

  // --- 02 §10.1 · Las versiones del presupuesto, de la primera a la última --------
  app.get<{ Params: { id: string } }>('/api/presupuestos/:id/versiones', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const { id } = request.params;
    // Sin esto, el presupuesto de otra empresa respondería una lista vacía.
    if (!UUID.test(id) || !(await leerPresupuesto(contexto, id))) throw presupuestoNoExiste();
    return reply.send({ versiones: await listarVersiones(contexto, id) });
  });

  // --- RF-VER-07 · Una versión, con su número en el documento ----------------------
  app.get<{ Params: { id: string } }>('/api/versiones/:id/exportar', async (request, reply) => {
    const contexto = await sesionDe(request, reply);
    const { formato } = esquemaFormato.parse(request.query);
    const documento = UUID.test(request.params.id) ? await leerVersionParaExportar(contexto, request.params.id) : null;
    if (!documento) throw versionNoExiste();
    return enviarArchivo(reply, documento, formato);
  });
}
