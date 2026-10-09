import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { cuandoSePierdaLaSesion, ErrorDeApi, pedir } from '../api/cliente.ts';
import { ProveedorDeAvisos } from '../componentes/Avisos.tsx';
import { Campo } from '../componentes/Campo.tsx';
import { Icono } from '../componentes/Icono.tsx';
import { PantallaSuelta } from '../componentes/PantallaSuelta.tsx';
import { Marco } from './Marco.tsx';
import { useRuta, type RutaDePlataforma } from './navegacion.ts';
import { Bitacora } from './pantallas/Bitacora.tsx';
import { Empresas } from './pantallas/Empresas.tsx';
import { Ficha } from './pantallas/Ficha.tsx';
import { Pagos } from './pantallas/Pagos.tsx';
import { Resumen } from './pantallas/Resumen.tsx';
import type { Superadministrador } from './tipos.ts';

/*
 * Misma máquina de estados que la aplicación de las empresas: averiguando,
 * sin sesión, adentro o sin servidor. La sesión es otra cookie (CONTRATO
 * §12.1): estar adentro de una empresa no abre esto, ni al revés.
 */

type Estado =
  | { fase: 'cargando' }
  | { fase: 'sin-sesion'; aviso: string | null }
  | { fase: 'dentro'; yo: Superadministrador }
  | { fase: 'error'; mensaje: string };

const RUTA_SESION = '/api/superadmin/sesion';
const SESION_VENCIDA = 'Su sesión del panel terminó. Ingrese de nuevo.';

export function AppDePlataforma() {
  const [estado, setEstado] = useState<Estado>({ fase: 'cargando' });
  const ruta = useRuta();

  const leerSesion = useCallback(async () => {
    setEstado({ fase: 'cargando' });
    try {
      const yo = await pedir<Superadministrador>(RUTA_SESION, { el401EsDeLaPantalla: true });
      setEstado({ fase: 'dentro', yo });
    } catch (e) {
      if (e instanceof ErrorDeApi && e.estado === 401) setEstado({ fase: 'sin-sesion', aviso: null });
      else setEstado({ fase: 'error', mensaje: e instanceof ErrorDeApi ? e.message : 'Algo falló al abrir el panel.' });
    }
  }, []);

  useEffect(() => {
    cuandoSePierdaLaSesion(() => setEstado({ fase: 'sin-sesion', aviso: SESION_VENCIDA }));
    void leerSesion();
  }, [leerSesion]);

  const salir = useCallback(async () => {
    try {
      await pedir<void>(RUTA_SESION, { metodo: 'DELETE' });
    } catch {
      // Como en la aplicación de las empresas: salir no falla para la persona.
    }
    window.location.hash = '#/';
    setEstado({ fase: 'sin-sesion', aviso: null });
  }, []);

  switch (estado.fase) {
    case 'cargando':
      return <div className="cargando-aplicacion" aria-busy="true"><span className="marca-palabra">ConstruSoft</span></div>;
    case 'error':
      return (
        <PantallaSuelta bajoLaMarca="Panel de la plataforma">
          <h1>No pudimos abrir el panel</h1>
          <p className="aviso-error" role="alert">{estado.mensaje}</p>
          <button type="button" className="boton boton-principal boton-ancho" onClick={() => void leerSesion()}>Intentar de nuevo</button>
        </PantallaSuelta>
      );
    case 'sin-sesion':
      return <IngresoDePlataforma aviso={estado.aviso} alEntrar={(yo) => setEstado({ fase: 'dentro', yo })} />;
    case 'dentro':
      return (
        <ProveedorDeAvisos>
          <Adentro ruta={ruta} yo={estado.yo} alSalir={() => void salir()} />
        </ProveedorDeAvisos>
      );
  }
}

const RESUMEN = { nombre: 'Resumen', ruta: { pantalla: 'resumen' } as RutaDePlataforma };
const EMPRESAS = { nombre: 'Empresas', ruta: { pantalla: 'empresas' } as RutaDePlataforma };

function Adentro({ ruta, yo, alSalir }: { ruta: RutaDePlataforma; yo: Superadministrador; alSalir: () => void }) {
  const marco = (migas: readonly { nombre: string; ruta?: RutaDePlataforma }[], contenido: ReactElement) => (
    <Marco ruta={ruta} migas={migas} quien={yo.nombre} alSalir={alSalir}>{contenido}</Marco>
  );
  switch (ruta.pantalla) {
    case 'resumen':
      return marco([{ nombre: 'Resumen' }], <Resumen />);
    case 'empresas':
      return marco([RESUMEN, { nombre: 'Empresas' }], <Empresas />);
    case 'empresa':
      return marco([RESUMEN, EMPRESAS, { nombre: 'Ficha de la empresa' }], <Ficha key={ruta.id} id={ruta.id} />);
    case 'pagos':
      return marco([RESUMEN, { nombre: 'Pagos' }], <Pagos />);
    case 'bitacora':
      return marco([RESUMEN, { nombre: 'Bitácora' }], <Bitacora />);
    case 'no-existe':
      return marco(
        [RESUMEN, { nombre: 'No existe' }],
        <div className="vacio">
          <h1>Esta dirección no existe en el panel</h1>
          <p><a href="#/">Volver al resumen</a></p>
        </div>,
      );
  }
}

function IngresoDePlataforma({ aviso, alEntrar }: { aviso: string | null; alEntrar: (yo: Superadministrador) => void }) {
  const [email, setEmail] = useState('');
  const [contrasena, setContrasena] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (email.trim() === '' || contrasena === '') {
      setError('Escriba su correo y su contraseña.');
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      alEntrar(await pedir<Superadministrador>(RUTA_SESION, { metodo: 'POST', cuerpo: { email: email.trim(), contrasena }, el401EsDeLaPantalla: true }));
    } catch (err) {
      setError(err instanceof ErrorDeApi ? err.message : 'No se pudo ingresar. Intente de nuevo.');
      setEnviando(false);
    }
  }

  return (
    <PantallaSuelta bajoLaMarca="Panel de la plataforma">
      <h1>Ingreso del superadministrador</h1>
      <form className="formulario" onSubmit={enviar} noValidate>
        {aviso ? <p className="aviso-informativo" role="status">{aviso}</p> : null}
        {error ? <p className="aviso-error" role="alert"><Icono nombre="aviso" /><span>{error}</span></p> : null}
        <Campo etiqueta="Correo">
          {(a) => <input {...a} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Campo>
        <Campo etiqueta="Contraseña">
          {(a) => <input {...a} type="password" autoComplete="current-password" value={contrasena} onChange={(e) => setContrasena(e.target.value)} />}
        </Campo>
        <button type="submit" className="boton boton-principal boton-ancho" disabled={enviando}>{enviando ? 'Ingresando…' : 'Ingresar al panel'}</button>
        <p className="pie-de-formulario">Este panel es solo para el equipo de ConstruSoft. Si trabaja en una empresa, <a href="/">ingrese aquí</a>.</p>
      </form>
    </PantallaSuelta>
  );
}
