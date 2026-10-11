/*
 * El tipo de un archivo subido, decidido por su FIRMA —los primeros bytes— y
 * no por el content-type que diga el navegador ni por la extensión. Un SVG
 * nunca entra: servido en línea, es un documento que ejecuta código en el
 * dominio de la aplicación (D-71).
 */

export type TipoDeComprobante = 'image/png' | 'image/jpeg' | 'application/pdf';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);

export function tipoDeImagen(archivo: Buffer): 'image/png' | 'image/jpeg' | null {
  if (archivo.subarray(0, PNG.length).equals(PNG)) return 'image/png';
  if (archivo.subarray(0, JPEG.length).equals(JPEG)) return 'image/jpeg';
  return null;
}

/** Un comprobante de pago: imagen PNG o JPEG, o PDF. */
export function tipoDeComprobante(archivo: Buffer): TipoDeComprobante | null {
  if (archivo.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return tipoDeImagen(archivo);
}
