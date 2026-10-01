import type { FormatoNumerico } from '../infraestructura/basedatos/contextoTenant.js';

/*
 * El redondeo de presentación (06 §2.2): la base guarda seis decimales y se
 * redondea una sola vez, al mostrar o exportar, a los decimales_vista de la
 * empresa (0, 1 o 2). Se hace sobre el TEXTO que entrega el controlador de
 * PostgreSQL, dígito por dígito, y nunca pasando por Number(). En coma
 * flotante 1,005 vale 1,00499… y redondea a 1,00, y un importe de veinticuatro
 * dígitos ni siquiera cabe (06 §2.4).
 *
 * El criterio es el de round() de PostgreSQL —a la mitad, alejándose del
 * cero— y una prueba lo compara contra la base en los casos borde. Si la
 * pantalla y la base redondearan distinto, el PDF diría un número y la base
 * otro.
 */

const NUMERO = /^(-?)(\d+)(?:\.(\d+))?$/;

/** Suma uno a una cadena de dígitos decimales, con acarreo: «0999» → «1000», «99» → «100». */
function sumarUno(digitos: string): string {
  const resultado = digitos.split('');
  for (let i = resultado.length - 1; i >= 0; i -= 1) {
    if (resultado[i] !== '9') {
      resultado[i] = String(Number(resultado[i]) + 1);
      return resultado.join('');
    }
    resultado[i] = '0';
  }
  return `1${resultado.join('')}`;
}

/**
 * Redondea un numeric en texto a `decimales` posiciones y devuelve el texto
 * canónico, con punto decimal y exactamente esa cantidad de decimales, igual
 * que round(valor, decimales)::text en PostgreSQL.
 */
export function redondear(texto: string, decimales: number): string {
  const partes = NUMERO.exec(texto);
  if (!partes) {
    throw new Error(
      `«${texto}» no es un número tal como lo entrega la base (dígitos y punto decimal). ` +
        'No se formatea a ciegas: revise de dónde salió el valor.',
    );
  }
  const signo = partes[1]!;
  const entera = partes[2]!;
  const fraccion = (partes[3] ?? '').padEnd(decimales + 1, '0');

  // Los dígitos que se conservan, enteros y decimales juntos, y el primero que se descarta.
  let conservados = entera + fraccion.slice(0, decimales);
  if (fraccion[decimales]! >= '5') {
    conservados = sumarUno(conservados);
  }

  const corte = conservados.length - decimales;
  const parteEntera = conservados.slice(0, corte).replace(/^0+(?=\d)/, '');
  const parteDecimal = conservados.slice(corte);
  const esCero = /^0*$/.test(parteEntera + parteDecimal);
  const resultado = decimales > 0 ? `${parteEntera}.${parteDecimal}` : parteEntera;
  return signo && !esCero ? `-${resultado}` : resultado;
}

/**
 * Un número listo para la pantalla o la exportación, con los separadores y
 * los decimales de la empresa (RF-CFG-14/15). Null es el guion de RF-PRE-37:
 * un porcentaje que no se puede calcular no es «0 %».
 */
export function formatearNumero(texto: string | null, formato: FormatoNumerico): string {
  if (texto === null) return '—';
  const redondeado = redondear(texto, formato.decimalesVista);
  const [conSigno, decimal] = redondeado.split('.');
  const signo = conSigno!.startsWith('-') ? '-' : '';
  const entera = conSigno!.replace('-', '');
  const agrupada = entera.replace(/\B(?=(\d{3})+(?!\d))/g, formato.separadorMiles);
  return decimal === undefined ? `${signo}${agrupada}` : `${signo}${agrupada}${formato.separadorDecimal}${decimal}`;
}
