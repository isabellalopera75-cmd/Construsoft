import { useEffect, useState } from 'react';
import { pedir, ErrorDeApi } from './api/cliente.ts';
import { formatearNumero } from './formato.ts';
import type { Arranque, FilaDePresupuesto } from './api/tipos.ts';

/*
 * Andamio de la rebanada 6.1. No es la pantalla final: existe para comprobar,
 * de punta a punta y contra el servidor de verdad, las cuatro cosas que todo lo
 * demás da por sentadas.
 *
 *   1. La cookie de sesión viaja (SameSite=Strict + el proxy de Vite).
 *   2. El arranque llega con su formato numérico y su estado de suscripción.
 *   3. El formateador compartido con el PDF produce las mismas cifras acá.
 *   4. Un rechazo de la API llega con su estado y su mensaje, no como «algo falló».
 *
 * Los estilos vienen después, con el sistema de tokens.
 */

type Estado =
  | { fase: 'cargando' }
  | { fase: 'sin-sesion'; mensaje?: string }
  | { fase: 'dentro'; arranque: Arranque; presupuestos: FilaDePresupuesto[] }
  | { fase: 'error'; mensaje: string };

export function App() {
  const [estado, setEstado] = useState<Estado>({ fase: 'cargando' });

  useEffect(() => {
    void (async () => {
      try {
        const arranque = await pedir<Arranque>('/api/sesion');
        const { presupuestos } = await pedir<{ presupuestos: FilaDePresupuesto[] }>(
          '/api/presupuestos',
        );
        setEstado({ fase: 'dentro', arranque, presupuestos });
      } catch (error) {
        if (error instanceof ErrorDeApi && error.estado === 401) {
          setEstado({ fase: 'sin-sesion' });
          return;
        }
        setEstado({
          fase: 'error',
          mensaje: error instanceof ErrorDeApi ? error.message : 'Error inesperado.',
        });
      }
    })();
  }, []);

  if (estado.fase === 'cargando') return <p>Cargando…</p>;
  if (estado.fase === 'error') return <p role="alert">{estado.mensaje}</p>;
  if (estado.fase === 'sin-sesion') return <Ingreso alAbrir={() => setEstado({ fase: 'cargando' })} aviso={estado.mensaje} />;

  const { arranque, presupuestos } = estado;
  const formato = arranque.formatoNumerico;
  const suscripcion = arranque.suscripcion;

  return (
    <main>
      <h1>{arranque.razonSocial}</h1>
      <p>
        {arranque.usuarioNombre} · {arranque.permisos.length} permisos
      </p>
      {/* Null es «sin acceso», nunca «al día»: se trata como el peor caso. */}
      {suscripcion === null ? (
        <p role="alert">No se pudo leer el estado de la suscripción. No hay acceso.</p>
      ) : (
        <p>
          Suscripción {suscripcion.estado}
          {suscripcion.estado === 'EN_PRUEBA' ? ` · ${suscripcion.diasRestantes} días` : ''}
          {suscripcion.soloLectura ? ' · SOLO LECTURA' : ''}
        </p>
      )}

      <h2>Presupuestos ({presupuestos.length})</h2>
      <table>
        <thead>
          <tr>
            <th>Código</th>
            <th>Nombre</th>
            <th>Estado</th>
            <th>Valor total</th>
          </tr>
        </thead>
        <tbody>
          {presupuestos.map((p) => (
            <tr key={p.id}>
              <td>{p.codigo}</td>
              <td>{p.nombre}</td>
              <td>{p.estado}</td>
              {/* La cifra sale del formateador compartido con el PDF. */}
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {formatearNumero(p.valorTotal, formato)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {presupuestos.length === 0 ? <p>Todavía no hay presupuestos.</p> : null}
    </main>
  );
}

// `aviso: string | undefined` y no `aviso?: string`: con
// exactOptionalPropertyTypes, pasar explícitamente undefined a una propiedad
// opcional es un error. La distinción es real —«no se pasó» contra «se pasó
// nada»— y acá la que corresponde es la segunda.
function Ingreso({ alAbrir, aviso }: { alAbrir: () => void; aviso: string | undefined }) {
  const [email, setEmail] = useState('');
  const [contrasena, setContrasena] = useState('');
  const [error, setError] = useState<string | null>(aviso ?? null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      await pedir('/api/sesion', { metodo: 'POST', cuerpo: { email, contrasena } });
      alAbrir();
    } catch (e) {
      // El mensaje lo escribe el servidor: «el correo o la contraseña no son
      // correctos» es uno solo a propósito, para no delatar qué correos existen.
      setError(e instanceof ErrorDeApi ? e.message : 'Error inesperado.');
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar}>
      <h1>Ingresar</h1>
      <label htmlFor="email">Correo</label>
      <input id="email" type="email" autoComplete="username" required value={email}
             onChange={(e) => setEmail(e.target.value)} />
      <label htmlFor="contrasena">Contraseña</label>
      <input id="contrasena" type="password" autoComplete="current-password" required
             value={contrasena} onChange={(e) => setContrasena(e.target.value)} />
      <button type="submit" disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</button>
      {error === null ? null : <p role="alert">{error}</p>}
    </form>
  );
}
