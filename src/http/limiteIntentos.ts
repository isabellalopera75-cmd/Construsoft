/*
 * Límite de intentos (documento 04 §5). Argon2id hace lenta cada prueba de
 * contraseña, pero no impide la serie: sin un contador, se puede probar
 * contraseñas indefinidamente, solo que despacio.
 *
 * DÓNDE VIVE EL CONTADOR: en la memoria del proceso. Es una decisión de
 * escala, y tiene dos consecuencias que hay que saber:
 *
 *  · Reiniciar el servidor borra los contadores.
 *  · Con más de una instancia detrás de un balanceador, cada una cuenta por su
 *    lado, y el límite efectivo se multiplica por el número de instancias.
 *
 * Con una sola instancia —la del MVP— alcanza. El día que haya dos, el
 * contador se mueve a la base o a un almacén compartido: por eso la
 * aplicación solo conoce esta clase y su interfaz, no la memoria.
 */

export interface OpcionesContador {
  /** Cuántos fallos dentro de la ventana bloquean la clave. */
  maximo: number;
  ventanaMs: number;
  /** El reloj, inyectable para las pruebas. */
  ahora?: () => number;
}

export class ContadorDeIntentos {
  readonly #fallos = new Map<string, number[]>();
  readonly #maximo: number;
  readonly #ventanaMs: number;
  readonly #ahora: () => number;

  constructor(opciones: OpcionesContador) {
    this.#maximo = opciones.maximo;
    this.#ventanaMs = opciones.ventanaMs;
    this.#ahora = opciones.ahora ?? Date.now;
  }

  /** Los fallos de la clave que siguen dentro de la ventana; los viejos se descartan. */
  #vigentes(clave: string): number[] {
    const desde = this.#ahora() - this.#ventanaMs;
    const vigentes = (this.#fallos.get(clave) ?? []).filter((momento) => momento > desde);
    if (vigentes.length === 0) this.#fallos.delete(clave);
    else this.#fallos.set(clave, vigentes);
    return vigentes;
  }

  /** Null si la clave puede intentar; si no, el instante (ms) en que se libera. */
  bloqueadoHasta(clave: string): number | null {
    const vigentes = this.#vigentes(clave);
    if (vigentes.length < this.#maximo) return null;
    return vigentes[vigentes.length - this.#maximo]! + this.#ventanaMs;
  }

  registrarFallo(clave: string): void {
    this.#fallos.set(clave, [...this.#vigentes(clave), this.#ahora()]);
  }

  reiniciar(clave: string): void {
    this.#fallos.delete(clave);
  }
}
