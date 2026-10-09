import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Permiso } from '../api/tipos.ts';
import { Icono, type NombreDeIcono } from '../componentes/Icono.tsx';
import { enlaceA, type Ruta } from '../navegacion.ts';
import { useSesion } from '../sesion.tsx';
import { aplicarTema, temaVisible, type Tema } from '../tema.ts';
import { AvisoDeSuscripcion } from './AvisoDeSuscripcion.tsx';
import { useBarraPlegable } from './barraPlegable.ts';

/*
 * El marco de toda pantalla de adentro (DISENO §7): barra lateral con los
 * módulos que el rol permite, barra superior con «dónde estoy · quién soy», el
 * aviso de la suscripción y el contenido en una columna de 1280 px.
 *
 * La barra lateral se pliega a iconos (decisión del dueño, 9 de octubre de
 * 2026): un botón al pie la oculta y la muestra, y el navegador recuerda la
 * elección. Plegada, cada icono muestra su nombre en un globo al pasar el
 * mouse o al llegar con el teclado. Entre 641 y 1024 px va siempre plegada,
 * porque no cabe; en el teléfono es un cajón y esto no aplica.
 */

export interface Modulo {
  ruta: Ruta;
  nombre: string;
  icono: NombreDeIcono;
  /** Qué hay adentro, con las palabras del 02 §4. */
  descripcion: string;
  /** Null: no pide permiso. Configuración trae «Mi cuenta», que es de todos. */
  permiso: Permiso | null;
}

/** 02 §4, en su orden. Lo que el rol no permite no se muestra, ni deshabilitado. */
export const MODULOS: readonly Modulo[] = [
  {
    ruta: { pantalla: 'recursos' },
    nombre: 'Recursos',
    icono: 'recursos',
    descripcion: 'Catálogo maestro de materiales, equipos, personal y actividades a todo costo',
    permiso: 'RECURSOS.VER',
  },
  {
    ruta: { pantalla: 'apu' },
    nombre: 'APU',
    icono: 'apu',
    descripcion: 'Inventario de análisis de precios unitarios',
    permiso: 'APU.VER',
  },
  {
    ruta: { pantalla: 'presupuestos' },
    nombre: 'Proyectos',
    icono: 'presupuestos',
    descripcion: 'Lista de proyectos y mesa de trabajo',
    permiso: 'PRESUPUESTOS.VER',
  },
  {
    ruta: { pantalla: 'configuracion' },
    nombre: 'Configuración',
    icono: 'configuracion',
    descripcion: 'Cuenta, empresa, suscripción, preferencias y unidades',
    permiso: null,
  },
];

export function useModulosVisibles(): readonly Modulo[] {
  const { puede } = useSesion();
  return MODULOS.filter((m) => m.permiso === null || puede(m.permiso));
}

/** A qué módulo pertenece una pantalla, para marcarlo en la barra. */
function moduloDe(ruta: Ruta): Ruta['pantalla'] {
  return ruta.pantalla === 'mesa' ? 'presupuestos' : ruta.pantalla;
}

interface Props {
  ruta: Ruta;
  /** «Dónde estoy»: las migas, de la más general a la actual. */
  migas: readonly { nombre: string; ruta?: Ruta }[];
  children: ReactNode;
}

export function Cascaron({ ruta, migas, children }: Props) {
  const { arranque, salir } = useSesion();
  const modulos = useModulosVisibles();
  const [cajonAbierto, setCajonAbierto] = useState(false);
  const botonMenu = useRef<HTMLButtonElement>(null);
  const actual = moduloDe(ruta);
  const { plegada, mediana, alternarBarra } = useBarraPlegable();

  // Cambiar de pantalla cierra el cajón del teléfono.
  useEffect(() => setCajonAbierto(false), [ruta]);

  // Escape cierra el cajón y devuelve el foco al botón que lo abrió.
  useEffect(() => {
    if (!cajonAbierto) return;
    const alTeclear = (evento: KeyboardEvent) => {
      if (evento.key !== 'Escape') return;
      setCajonAbierto(false);
      botonMenu.current?.focus();
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [cajonAbierto]);

  return (
    <div className="cascaron" data-cajon={cajonAbierto ? 'abierto' : 'cerrado'} data-barra={plegada ? 'plegada' : 'abierta'}>
      <a className="saltar-al-contenido" href="#contenido" onClick={(e) => {
        // El destino es un id, no una ruta: sin esto, el «#contenido»
        // reemplazaría la dirección de la pantalla.
        e.preventDefault();
        document.getElementById('contenido')?.focus();
      }}>
        Saltar al contenido
      </a>

      <aside className="barra-lateral" id="barra-lateral" aria-label="Módulos">
        <a className="marca" href={enlaceA({ pantalla: 'inicio' })} aria-label="ConstruSoft, ir al inicio">
          <span className="marca-palabra">ConstruSoft</span>
        </a>
        <nav>
          <ul className="lista-de-modulos">
            <li>
              <a
                href={enlaceA({ pantalla: 'inicio' })}
                aria-current={actual === 'inicio' ? 'page' : undefined}
              >
                <Icono nombre="inicio" />
                <span className="etiqueta-de-modulo">Inicio</span>
              </a>
            </li>
            {modulos.map((m) => (
              <li key={m.nombre}>
                <a
                  href={enlaceA(m.ruta)}
                  aria-current={actual === m.ruta.pantalla ? 'page' : undefined}
                >
                  <Icono nombre={m.icono} />
                  <span className="etiqueta-de-modulo">{m.nombre}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
        {/* Sin botón entre 641 y 1024: ahí la barra no cabe abierta. */}
        {mediana ? null : (
          <button
            type="button"
            className="boton-de-barra"
            aria-expanded={!plegada}
            aria-controls="barra-lateral"
            onClick={alternarBarra}
          >
            <Icono nombre={plegada ? 'desplegar' : 'plegar'} />
            <span className="etiqueta-de-modulo">{plegada ? 'Mostrar menú' : 'Ocultar menú'}</span>
          </button>
        )}
      </aside>

      {/* El velo del cajón: tocar fuera lo cierra. Solo existe en teléfono. */}
      <div className="velo-del-cajon" aria-hidden="true" onClick={() => setCajonAbierto(false)} />

      <div className="cascaron-principal">
        <header className="barra-superior">
          <button
            ref={botonMenu}
            type="button"
            className="boton-icono boton-del-cajon"
            aria-label="Menú de módulos"
            aria-expanded={cajonAbierto}
            aria-controls="barra-lateral"
            onClick={() => setCajonAbierto((a) => !a)}
          >
            <Icono nombre="menu" />
          </button>

          <nav className="migas" aria-label="Dónde estoy">
            <ol>
              {migas.map((miga, i) => {
                const ultima = i === migas.length - 1;
                return (
                  <li key={miga.nombre}>
                    {ultima || !miga.ruta ? (
                      <span aria-current={ultima ? 'page' : undefined}>{miga.nombre}</span>
                    ) : (
                      <a href={enlaceA(miga.ruta)}>{miga.nombre}</a>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>

          <div className="quien-soy">
            <span className="quien-soy-texto">
              <span className="quien-soy-nombre">{arranque.usuarioNombre}</span>
              <span className="quien-soy-empresa">{arranque.razonSocial}</span>
            </span>
            <BotonDeTema />
            <button type="button" className="boton-icono" aria-label="Salir" title="Salir" onClick={() => void salir()}>
              <Icono nombre="salir" />
            </button>
          </div>
        </header>

        <AvisoDeSuscripcion />

        <main id="contenido" className="contenido" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}

function BotonDeTema() {
  const [tema, setTema] = useState<Tema>(() => temaVisible());
  const otro: Tema = tema === 'oscuro' ? 'claro' : 'oscuro';
  const texto = otro === 'claro' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro';
  return (
    <button
      type="button"
      className="boton-icono"
      aria-label={texto}
      title={texto}
      onClick={() => {
        aplicarTema(otro);
        setTema(otro);
      }}
    >
      <Icono nombre={otro === 'claro' ? 'sol' : 'luna'} />
    </button>
  );
}

/**
 * El botón Volver (02 §2): lleva a la sección de arriba, nunca al historial
 * del navegador (DISENO §7 bis).
 */
export function BotonVolver({ a, nombre }: { a: Ruta; nombre: string }) {
  return (
    <a className="boton boton-secundario boton-volver" href={enlaceA(a)}>
      <Icono nombre="volver" />
      <span>
        Volver<span className="solo-lectores"> a {nombre}</span>
      </span>
    </a>
  );
}
