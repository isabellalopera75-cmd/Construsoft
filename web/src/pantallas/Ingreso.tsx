import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ErrorDeApi, pedir } from '../api/cliente.ts';
import type { Arranque } from '../api/tipos.ts';
import { Campo } from '../componentes/Campo.tsx';
import { Icono } from '../componentes/Icono.tsx';
import { PantallaSuelta } from '../componentes/PantallaSuelta.tsx';

// La pantalla suelta vive en componentes/: la usa también el superadministrador.
export { PantallaSuelta };

/*
 * 02 §3.2 · Ingreso. Correo y contraseña, sin selector de empresa: el correo
 * identifica al usuario en toda la plataforma.
 *
 * Los mensajes los escribe el servidor y se muestran tal cual:
 *   401  «El correo o la contraseña no son correctos…», uno solo a propósito,
 *        para no delatar qué correos existen.
 *   403  cuenta pendiente de activar, o revocada.
 *   429  demasiados intentos; el botón espera lo que pide Retry-After.
 */

export function Ingreso({ alEntrar, aviso }: { alEntrar: (arranque: Arranque) => void; aviso: string | null }) {
  const [email, setEmail] = useState('');
  const [contrasena, setContrasena] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [errores, setErrores] = useState<{ email?: string; contrasena?: string }>({});
  const [enviando, setEnviando] = useState(false);
  const [esperaHasta, setEsperaHasta] = useState<number | null>(null);
  const espera = useCuentaRegresiva(esperaHasta);
  const campoCorreo = useRef<HTMLInputElement>(null);
  const campoContrasena = useRef<HTMLInputElement>(null);

  useEffect(() => campoCorreo.current?.focus(), []);

  // Mientras se envía, el botón se deshabilita y el navegador suelta el foco
  // en el <body>. Al volver un rechazo, el foco va adonde se corrige: la
  // contraseña, que además quedó vacía.
  useEffect(() => {
    if (!enviando && error !== null) campoContrasena.current?.focus();
  }, [enviando, error]);

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    const faltan: typeof errores = {};
    if (email.trim() === '') faltan.email = 'Escriba su correo.';
    if (contrasena === '') faltan.contrasena = 'Escriba su contraseña.';
    setErrores(faltan);
    setError(null);
    if (faltan.email || faltan.contrasena) return;

    setEnviando(true);
    try {
      const arranque = await pedir<Arranque>('/api/sesion', {
        metodo: 'POST',
        cuerpo: { email: email.trim(), contrasena },
        el401EsDeLaPantalla: true,
      });
      alEntrar(arranque);
    } catch (e) {
      if (e instanceof ErrorDeApi) {
        setError(e.message);
        if (e.estado === 429 && e.reintentarEn !== undefined) setEsperaHasta(Date.now() + e.reintentarEn * 1000);
        if (e.estado === 401) setContrasena('');
      } else {
        setError('Algo falló en esta pantalla. Recárguela e intente de nuevo.');
      }
      setEnviando(false);
    }
  }

  const bloqueado = espera > 0;

  return (
    <PantallaSuelta>
      <h1>Ingresar</h1>
      <form className="formulario" onSubmit={enviar} noValidate>
        {error ?? aviso ? (
          <p className="aviso-error" role="alert">
            <Icono nombre="aviso" />
            <span>{error ?? aviso}</span>
          </p>
        ) : null}
        <Campo etiqueta="Correo" error={errores.email}>
          {(a) => (
            <input
              {...a}
              ref={campoCorreo}
              type="email"
              autoComplete="username"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Campo>
        <Campo etiqueta="Contraseña" error={errores.contrasena}>
          {(a) => (
            <input
              {...a}
              ref={campoContrasena}
              type="password"
              autoComplete="current-password"
              value={contrasena}
              onChange={(e) => setContrasena(e.target.value)}
            />
          )}
        </Campo>
        <button type="submit" className="boton boton-principal boton-ancho" disabled={enviando || bloqueado}>
          {enviando ? 'Ingresando…' : bloqueado ? `Espere ${espera} s para reintentar` : 'Ingresar'}
        </button>
      </form>
    </PantallaSuelta>
  );
}

/** El marco de las pantallas sin sesión: la marca y una tarjeta centrada. */

/** Segundos que faltan hasta un instante, actualizados cada segundo. */
function useCuentaRegresiva(hasta: number | null): number {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    if (hasta === null) return;
    const reloj = window.setInterval(() => setAhora(Date.now()), 1000);
    return () => window.clearInterval(reloj);
  }, [hasta]);
  if (hasta === null) return 0;
  return Math.max(0, Math.ceil((hasta - ahora) / 1000));
}
