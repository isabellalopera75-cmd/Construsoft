import { useCallback, useEffect, useMemo, useState } from 'react';
import { cuandoSePierdaLaSesion, ErrorDeApi, pedir } from './api/cliente.ts';
import type { Arranque, Permiso } from './api/tipos.ts';
import { Cascaron } from './cascaron/Cascaron.tsx';
import { useRuta, type Ruta } from './navegacion.ts';
import { Inicio } from './pantallas/Inicio.tsx';
import { Ingreso, PantallaSuelta } from './pantallas/Ingreso.tsx';
import { NoExiste } from './pantallas/Pendiente.tsx';
import { ProveedorDeAvisos } from './componentes/Avisos.tsx';
import { ListaDeApu } from './modulos/apu/ListaDeApu.tsx';
import { Configuracion } from './modulos/configuracion/Configuracion.tsx';
import { Mesa } from './modulos/mesa/Mesa.tsx';
import { Recursos } from './modulos/recursos/Recursos.tsx';
import { Presupuestos } from './pantallas/Presupuestos.tsx';
import { Recuperacion } from './pantallas/Recuperacion.tsx';
import { ContextoDeSesion, crearSesion, useSesion } from './sesion.tsx';

/*
 * La aplicación es una máquina de cuatro estados: averiguando si hay sesión,
 * sin sesión (ingreso), adentro, o sin poder hablar con el servidor. Todo lo
 * que decide qué mostrar adentro sale del arranque (CONTRATO §3.1).
 */

type Estado =
  | { fase: 'cargando' }
  | { fase: 'sin-sesion'; aviso: string | null }
  | { fase: 'dentro'; arranque: Arranque }
  | { fase: 'error'; mensaje: string };

const SESION_VENCIDA = 'Su sesión terminó. Ingrese de nuevo para seguir; lo que ya estaba guardado sigue ahí.';

export function App() {
  const [estado, setEstado] = useState<Estado>({ fase: 'cargando' });
  const ruta = useRuta();

  const leerArranque = useCallback(async () => {
    setEstado({ fase: 'cargando' });
    try {
      const arranque = await pedir<Arranque>('/api/sesion', { el401EsDeLaPantalla: true });
      setEstado({ fase: 'dentro', arranque });
    } catch (e) {
      if (e instanceof ErrorDeApi && e.estado === 401) setEstado({ fase: 'sin-sesion', aviso: null });
      else setEstado({ fase: 'error', mensaje: e instanceof ErrorDeApi ? e.message : 'Algo falló al abrir la aplicación.' });
    }
  }, []);

  useEffect(() => {
    // Cualquier 401 de cualquier pantalla, después del arranque, es una sesión
    // que terminó: vencida, cerrada en otro lado o con la contraseña cambiada
    // (D-67). Se vuelve al ingreso y la dirección se conserva, así que al
    // volver a entrar se llega a donde se estaba.
    cuandoSePierdaLaSesion(() => setEstado({ fase: 'sin-sesion', aviso: SESION_VENCIDA }));
    void leerArranque();
  }, [leerArranque]);

  const salir = useCallback(async () => {
    try {
      await pedir<void>('/api/sesion', { metodo: 'DELETE' });
    } catch {
      // Salir no puede fallar desde el punto de vista de la persona: la cookie
      // es HttpOnly y no se puede borrar desde acá, pero la pantalla sí se
      // cierra. Si la red estaba caída, el próximo arranque lo resuelve.
    }
    window.location.hash = '#/';
    setEstado({ fase: 'sin-sesion', aviso: null });
  }, []);

  const recargar = useCallback(async () => {
    try {
      const arranque = await pedir<Arranque>('/api/sesion');
      setEstado({ fase: 'dentro', arranque });
    } catch {
      // Un 401 ya lo atiende el cliente. Otro error deja el arranque que había:
      // la pantalla sigue funcionando con el formato anterior.
    }
  }, []);

  const sesion = useMemo(
    () => (estado.fase === 'dentro' ? crearSesion(estado.arranque, salir, recargar) : null),
    [estado, salir, recargar],
  );

  // El enlace de restablecimiento se abre sin sesión, y con sesión también:
  // quien lo pidió para otra cuenta no tiene por qué salir primero.
  if (ruta.pantalla === 'recuperar' || ruta.pantalla === 'activar') {
    return (
      <Recuperacion
        key={ruta.pantalla}
        proposito={ruta.pantalla === 'activar' ? 'activacion' : 'recuperacion'}
        token={ruta.token}
        alTerminar={(aviso) => setEstado({ fase: 'sin-sesion', aviso })}
      />
    );
  }

  switch (estado.fase) {
    case 'cargando':
      // Nada de reloj centrado: la marca, mientras el arranque responde.
      return <div className="cargando-aplicacion" aria-busy="true"><span className="marca-palabra">ConstruSoft</span></div>;
    case 'error':
      return (
        <PantallaSuelta>
          <h1>No pudimos abrir ConstruSoft</h1>
          <p className="aviso-error" role="alert">{estado.mensaje}</p>
          <button type="button" className="boton boton-principal boton-ancho" onClick={() => void leerArranque()}>
            Intentar de nuevo
          </button>
        </PantallaSuelta>
      );
    case 'sin-sesion':
      return <Ingreso aviso={estado.aviso} alEntrar={(arranque) => setEstado({ fase: 'dentro', arranque })} />;
    case 'dentro':
      return (
        <ContextoDeSesion.Provider value={sesion}>
          <ProveedorDeAvisos>
            <Adentro ruta={ruta} />
          </ProveedorDeAvisos>
        </ContextoDeSesion.Provider>
      );
  }
}

const INICIO = { nombre: 'Inicio', ruta: { pantalla: 'inicio' } as Ruta };

/** Qué pantalla corresponde a la dirección, y con qué migas. */
function Adentro({ ruta }: { ruta: Ruta }) {
  const { puede } = useSesion();

  // Una dirección a un módulo que el rol no permite responde como una que no
  // existe: el menú no lo muestra y la dirección escrita a mano tampoco lo abre.
  const permitido = (permiso: Permiso) => puede(permiso);

  switch (ruta.pantalla) {
    case 'inicio':
      return <Cascaron ruta={ruta} migas={[{ nombre: 'Inicio' }]}><Inicio /></Cascaron>;
    case 'presupuestos':
      if (!permitido('PRESUPUESTOS.VER')) break;
      return (
        <Cascaron ruta={ruta} migas={[INICIO, { nombre: 'Proyectos' }]}>
          <Presupuestos />
        </Cascaron>
      );
    case 'mesa':
      if (!permitido('PRESUPUESTOS.VER')) break;
      return (
        <Cascaron ruta={ruta} migas={[INICIO, { nombre: 'Proyectos', ruta: { pantalla: 'presupuestos' } }, { nombre: 'Mesa de trabajo' }]}>
          {/* key: abrir otro presupuesto (al duplicar) empieza una mesa nueva. */}
          <Mesa key={ruta.id} id={ruta.id} />
        </Cascaron>
      );
    case 'recursos':
      if (!permitido('RECURSOS.VER')) break;
      return (
        <Cascaron ruta={ruta} migas={[INICIO, { nombre: 'Recursos' }]}>
          <Recursos />
        </Cascaron>
      );
    case 'apu':
      if (!permitido('APU.VER')) break;
      return (
        <Cascaron ruta={ruta} migas={[INICIO, { nombre: 'APU' }]}>
          <ListaDeApu />
        </Cascaron>
      );
    case 'configuracion':
      return (
        <Cascaron ruta={ruta} migas={[INICIO, { nombre: 'Configuración' }]}>
          <Configuracion pestana={ruta.pestana} />
        </Cascaron>
      );
    case 'recuperar':
    case 'activar':
    case 'no-existe':
      break;
  }
  return <Cascaron ruta={ruta} migas={[INICIO, { nombre: 'No existe' }]}><NoExiste /></Cascaron>;
}
