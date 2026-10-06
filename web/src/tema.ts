/*
 * El tema (DISENO §1). Arranca en oscuro, que es la identidad; si el sistema
 * operativo está en claro, respeta eso; y una elección manual gana sobre las
 * dos y se guarda en `data-tema` del <html>. El CSS de tokens.css ya resuelve
 * los dos primeros casos sin JavaScript: esto solo maneja la elección manual.
 *
 * La elección se recuerda en este navegador. Es una comodidad, no un dato: si
 * el almacenamiento no está disponible (modo privado, política del navegador),
 * la aplicación funciona igual y el tema vuelve al del sistema la próxima vez.
 */

export type Tema = 'oscuro' | 'claro';

const CLAVE = 'construsoft.tema';

export function temaGuardado(): Tema | null {
  try {
    const valor = window.localStorage.getItem(CLAVE);
    return valor === 'oscuro' || valor === 'claro' ? valor : null;
  } catch {
    return null;
  }
}

/** El que se está viendo ahora, elegido o heredado del sistema. */
export function temaVisible(): Tema {
  const elegido = document.documentElement.dataset['tema'];
  if (elegido === 'oscuro' || elegido === 'claro') return elegido;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'claro' : 'oscuro';
}

export function aplicarTema(tema: Tema): void {
  document.documentElement.dataset['tema'] = tema;
  try {
    window.localStorage.setItem(CLAVE, tema);
  } catch {
    // Sin almacenamiento, la elección dura lo que dure la pestaña.
  }
}

/** Se llama antes de pintar nada, para que no haya un destello del otro tema. */
export function restaurarTema(): void {
  const guardado = temaGuardado();
  if (guardado) document.documentElement.dataset['tema'] = guardado;
}
