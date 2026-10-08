import { useState, type FormEvent } from 'react';
import { ErrorDeApi, pedir } from '../api/cliente.ts';
import { Campo } from '../componentes/Campo.tsx';
import { Icono } from '../componentes/Icono.tsx';
import { reemplazar } from '../navegacion.ts';
import { PantallaSuelta } from './Ingreso.tsx';

/*
 * 02 §3.3, pasos 3 a 5 · Abrir el enlace y fijar la contraseña nueva.
 *
 * Los pasos 1 y 2 —pedir el enlace por correo— son de la fase 8, porque el
 * correo no existe todavía. Hasta entonces el enlace lo entrega el dueño con
 * `npm run enlace`, con URL_RECUPERACION apuntando a esta pantalla:
 *
 *     http://localhost:5173/#/recuperar?token=
 *
 * El token va después del «#» a propósito: no sale del navegador (navegacion.ts).
 *
 * Un token vencido o inválido lo dice el servidor. El botón de «solicitar uno
 * nuevo» del paso 3 espera también a la fase 8.
 *
 * La misma pantalla activa la cuenta de un usuario invitado (02 §11.4,
 * CONTRATO §11.4): es el mismo gesto —abrir un enlace de un solo uso y elegir
 * una contraseña— contra otra ruta, con otras palabras. El enlace lo entrega
 * el dueño con `npm run activacion` hasta que exista el correo.
 */

type Proposito = 'recuperacion' | 'activacion';

const TEXTOS: Record<Proposito, { titulo: string; intro: string | null; ruta: string; boton: string; listo: string }> = {
  recuperacion: {
    titulo: 'Contraseña nueva',
    intro: null,
    ruta: '/api/recuperacion',
    boton: 'Guardar contraseña',
    listo: 'Su contraseña quedó guardada. Ingrese con ella.',
  },
  activacion: {
    titulo: 'Active su cuenta',
    intro: 'Lo invitaron a trabajar en ConstruSoft. Elija la contraseña con la que va a ingresar; nadie más la conoce, ni quien lo invitó.',
    ruta: '/api/activacion',
    boton: 'Activar mi cuenta',
    listo: 'Su cuenta quedó activa. Ingrese con su correo y la contraseña que eligió.',
  },
};

export function Recuperacion({ token, proposito = 'recuperacion', alTerminar }: { token: string; proposito?: Proposito; alTerminar: (aviso: string) => void }) {
  const textos = TEXTOS[proposito];
  const [contrasena, setContrasena] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [errores, setErrores] = useState<{ contrasena?: string; confirmacion?: string }>({});
  const [error, setError] = useState<string | null>(
    token === '' ? 'Este enlace está incompleto. Ábralo de nuevo, copiándolo entero.' : null,
  );
  const [enviando, setEnviando] = useState(false);

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    const faltan: typeof errores = {};
    if (contrasena.length < 8) faltan.contrasena = 'La contraseña necesita al menos 8 caracteres.';
    if (confirmacion !== contrasena) faltan.confirmacion = 'Las dos contraseñas no coinciden. Escríbala igual en los dos campos.';
    setErrores(faltan);
    if (faltan.contrasena || faltan.confirmacion) return;

    setEnviando(true);
    setError(null);
    try {
      await pedir<void>(textos.ruta, { metodo: 'POST', cuerpo: { token, contrasena } });
      // El enlace ya no sirve: se saca del historial para que «atrás» no lo reabra.
      reemplazar({ pantalla: 'inicio' });
      alTerminar(textos.listo);
    } catch (e) {
      if (e instanceof ErrorDeApi && e.campo === 'contrasena') setErrores({ contrasena: e.message });
      else setError(e instanceof ErrorDeApi ? e.message : 'Algo falló en esta pantalla. Recárguela e intente de nuevo.');
      setEnviando(false);
    }
  }

  return (
    <PantallaSuelta>
      <h1>{textos.titulo}</h1>
      {textos.intro ? <p className="campo-ayuda">{textos.intro}</p> : null}
      <form className="formulario" onSubmit={enviar} noValidate>
        {error ? (
          <p className="aviso-error" role="alert">
            <Icono nombre="aviso" />
            <span>{error}</span>
          </p>
        ) : null}
        <Campo etiqueta={proposito === 'activacion' ? 'Contraseña' : 'Contraseña nueva'} ayuda="Mínimo 8 caracteres." error={errores.contrasena}>
          {(a) => (
            <input {...a} type="password" autoComplete="new-password" value={contrasena}
                   onChange={(e) => setContrasena(e.target.value)} />
          )}
        </Campo>
        <Campo etiqueta="Repita la contraseña" error={errores.confirmacion}>
          {(a) => (
            <input {...a} type="password" autoComplete="new-password" value={confirmacion}
                   onChange={(e) => setConfirmacion(e.target.value)} />
          )}
        </Campo>
        <button type="submit" className="boton boton-principal boton-ancho" disabled={enviando || token === ''}>
          {enviando ? 'Guardando…' : textos.boton}
        </button>
        <p className="pie-de-formulario">
          <a href="#/">Volver al ingreso</a>
        </p>
      </form>
    </PantallaSuelta>
  );
}
