import { crc32, deflateSync } from 'node:zlib';

/*
 * Imágenes de verdad para las pruebas: un PNG de un píxel del color que se
 * pida. Colores distintos dan archivos distintos —y sha256 distintos—, y los
 * dos generadores (pdfkit, exceljs) los pueden dibujar.
 */

function trozo(tipo: string, datos: Buffer): Buffer {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const tipoYDatos = Buffer.concat([Buffer.from(tipo, 'latin1'), datos]);
  const control = Buffer.alloc(4);
  control.writeUInt32BE(crc32(tipoYDatos));
  return Buffer.concat([largo, tipoYDatos, control]);
}

export function pngDeUnPixel(rojo: number, verde: number, azul: number): Buffer {
  const cabecera = Buffer.alloc(13);
  cabecera.writeUInt32BE(1, 0); // ancho
  cabecera.writeUInt32BE(1, 4); // alto
  cabecera.writeUInt8(8, 8); // bits por canal
  cabecera.writeUInt8(2, 9); // color RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo('IHDR', cabecera),
    trozo('IDAT', deflateSync(Buffer.from([0, rojo, verde, azul]))),
    trozo('IEND', Buffer.alloc(0)),
  ]);
}
