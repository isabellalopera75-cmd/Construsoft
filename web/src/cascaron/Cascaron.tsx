import { useEffect, useRef, useState, type ReactNode } from 'react';
import { pedir } from '../api/cliente.ts';
import type { FilaDePresupuesto, Permiso } from '../api/tipos.ts';
import { Icono, type NombreDeIcono } from '../componentes/Icono.tsx';
import { enlaceA, type Ruta } from '../navegacion.ts';
import { useSesion } from '../sesion.tsx';
import { aplicarTema, temaVisible, type Tema } from '../tema.ts';
import { AvisoDeSuscripcion } from './AvisoDeSuscripcion.tsx';
import { useBarraPlegable } from './barraPlegable.ts';
import { usePosicionDelMenu } from './posicionDelMenu.ts';
import { pestanasDeConfiguracion } from '../modulos/configuracion/pestanas.ts';

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
 *
 * El menú puede ir arriba (pedido del dueño, 15 de octubre de 2026): cada
 * usuario lo elige en Configuración › Mi cuenta. Arriba, la barra lateral
 * desaparece y los mismos módulos, con sus submenús, van en la barra superior,
 * entre las migas y «quién soy». En el teléfono el menú sigue siendo el cajón.
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

/**
 * El orden lo fijó el dueño el 13 de octubre de 2026: Proyectos, APU,
 * Recursos, Configuración (antes era el del 02 §4, con Recursos primero).
 * Lo que el rol no permite no se muestra, ni deshabilitado.
 */
export const MODULOS: readonly Modulo[] = [
  {
    ruta: { pantalla: 'presupuestos' },
    nombre: 'Proyectos',
    icono: 'presupuestos',
    descripcion: 'Lista de proyectos y mesa de trabajo',
    permiso: 'PRESUPUESTOS.VER',
  },
  {
    ruta: { pantalla: 'apu' },
    nombre: 'APU',
    icono: 'apu',
    descripcion: 'Inventario de análisis de precios unitarios',
    permiso: 'APU.VER',
  },
  {
    ruta: { pantalla: 'recursos' },
    nombre: 'Recursos',
    icono: 'recursos',
    descripcion: 'Catálogo maestro de materiales, equipos, personal y actividades a todo costo',
    permiso: 'RECURSOS.VER',
  },
  {
    ruta: { pantalla: 'configuracion' },
    nombre: 'Configuración',
    icono: 'configuracion',
    descripcion: 'Cuenta, empresa, suscripción, preferencias, unidades y calendarios',
    permiso: null,
  },
];

export function useModulosVisibles(): readonly Modulo[] {
  const { puede } = useSesion();
  return MODULOS.filter((m) => m.permiso === null || puede(m.permiso));
}

/** A qué módulo pertenece una pantalla, para marcarlo en la barra. */
function moduloDe(ruta: Ruta): Ruta['pantalla'] {
  return ruta.pantalla === 'mesa' || ruta.pantalla === 'cronograma' ? 'presupuestos' : ruta.pantalla;
}

/*
 * Submenús de la barra lateral (pedido del dueño, 13 de octubre de 2026): al
 * pasar el mouse por Proyectos aparecen los cuatro proyectos más recientes, y
 * por Configuración sus pestañas. Abierta la barra, se despliegan debajo del
 * módulo; plegada, salen al lado. Con el teclado se abren al llegar con Tab
 * (focus-within). En el teléfono no se muestran: allí no hay mouse.
 */
interface EnlaceDeSubmenu {
  clave: string;
  texto: string;
  apoyo?: string;
  href: string;
}

function Submenu({ titulo, enlaces, vacio }: { titulo: string; enlaces: EnlaceDeSubmenu[]; vacio?: string }) {
  return (
    <div className="submenu-de-modulo">
      <span className="submenu-titulo" aria-hidden="true">{titulo}</span>
      {enlaces.length === 0 ? (
        <span className="submenu-vacio">{vacio}</span>
      ) : (
        <ul aria-label={titulo}>
          {enlaces.map((e) => (
            <li key={e.clave}>
              <a href={e.href}>
                {e.apoyo ? <span className="cifra-codigo submenu-apoyo">{e.apoyo}</span> : null}
                <span className="submenu-texto">{e.texto}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Los cuatro proyectos modificados más recientemente. Se piden cuando el mouse
 * pasa por Proyectos, no al cargar cada pantalla, y se reusan por 30 segundos:
 * así un proyecto recién creado aparece la siguiente vez sin pedir la lista a
 * cada movimiento del mouse.
 */
let recientesGuardados: { lista: FilaDePresupuesto[]; en: number } | null = null;
function useProyectosRecientes(pasadas: number): FilaDePresupuesto[] | null {
  const [lista, setLista] = useState<FilaDePresupuesto[] | null>(recientesGuardados?.lista ?? null);
  useEffect(() => {
    if (pasadas === 0) return;
    if (recientesGuardados && Date.now() - recientesGuardados.en < 30_000) return;
    let vivo = true;
    pedir<FilaDePresupuesto[]>('/api/presupuestos')
      .then((filas) => {
        const cuatro = [...filas].sort((a, b) => b.fechaModificacion.localeCompare(a.fechaModificacion)).slice(0, 4);
        recientesGuardados = { lista: cuatro, en: Date.now() };
        if (vivo) setLista(cuatro);
      })
      .catch(() => {
        if (vivo) setLista((l) => l ?? []);
      });
    return () => {
      vivo = false;
    };
  }, [pasadas]);
  return lista;
}

/**
 * Los módulos con sus submenús. La misma lista va en la barra lateral o en la
 * barra superior, según dónde quiera el menú cada usuario; el CSS decide la
 * forma (vertical, plegada a iconos o en fila).
 */
function ListaDeModulos({
  actual,
  recientes,
  alPasarPorProyectos,
}: {
  actual: Ruta['pantalla'];
  recientes: FilaDePresupuesto[] | null;
  alPasarPorProyectos: () => void;
}) {
  const { puede } = useSesion();
  const modulos = useModulosVisibles();
  return (
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
      {modulos.map((m) => {
        const conSubmenu = m.ruta.pantalla === 'presupuestos' || m.ruta.pantalla === 'configuracion';
        return (
          <li key={m.nombre} className={conSubmenu ? 'modulo-con-submenu' : undefined}
              onMouseEnter={m.ruta.pantalla === 'presupuestos' ? alPasarPorProyectos : undefined}
              onFocus={m.ruta.pantalla === 'presupuestos' ? alPasarPorProyectos : undefined}>
            <a
              href={enlaceA(m.ruta)}
              aria-current={actual === m.ruta.pantalla ? 'page' : undefined}
            >
              <Icono nombre={m.icono} />
              <span className="etiqueta-de-modulo">{m.nombre}</span>
            </a>
            {m.ruta.pantalla === 'configuracion' ? (
              <Submenu titulo={m.nombre} enlaces={pestanasDeConfiguracion(puede).map((p) => ({
                clave: p.id, texto: p.nombre, href: enlaceA({ pantalla: 'configuracion', pestana: p.id }),
              }))} />
            ) : null}
            {m.ruta.pantalla === 'presupuestos' ? (
              <Submenu titulo={m.nombre} vacio={recientes === null ? 'Cargando…' : 'Todavía no hay proyectos.'}
                       enlaces={(recientes ?? []).map((p) => ({
                         clave: p.id, texto: p.nombre, apoyo: p.codigo, href: enlaceA({ pantalla: 'mesa', id: p.id }),
                       }))} />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

interface Props {
  ruta: Ruta;
  /** «Dónde estoy»: las migas, de la más general a la actual. */
  migas: readonly { nombre: string; ruta?: Ruta }[];
  /**
   * Sin el tope de 1280 px: las pantallas de tablas (la mesa, el cronograma,
   * Proyectos, APU, Recursos) usan todo el ancho que tengan, con el menú a la
   * izquierda, plegado o arriba (pedido del dueño, 21 de octubre de 2026).
   * Los formularios y los textos se quedan con su ancho.
   */
  anchoCompleto?: boolean;
  children: ReactNode;
}

export function Cascaron({ ruta, migas, anchoCompleto = false, children }: Props) {
  const { arranque, salir } = useSesion();
  const [pasadas, setPasadas] = useState(0);
  const recientes = useProyectosRecientes(pasadas);
  const [cajonAbierto, setCajonAbierto] = useState(false);
  const botonMenu = useRef<HTMLButtonElement>(null);
  const actual = moduloDe(ruta);
  const { plegada, mediana, alternarBarra } = useBarraPlegable();
  const posicionDelMenu = usePosicionDelMenu();
  const arriba = posicionDelMenu === 'arriba';

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
    <div
      className="cascaron"
      data-cajon={cajonAbierto ? 'abierto' : 'cerrado'}
      data-menu={posicionDelMenu}
      // Con el menú arriba no hay barra que plegar: sin el atributo, las reglas
      // de la barra plegada no tocan los enlaces de la barra superior.
      data-barra={arriba ? undefined : plegada ? 'plegada' : 'abierta'}
    >
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
          <ListaDeModulos actual={actual} recientes={recientes} alPasarPorProyectos={() => setPasadas((n) => n + 1)} />
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

          {/* Con el menú arriba, marca y migas forman el lado izquierdo y
              «quién soy» el derecho, con el mismo ancho: así el menú queda en
              el centro. Con el menú a la izquierda, el bloque no existe para
              el diseño (display: contents). */}
          <div className="inicio-de-barra">
            {arriba ? (
              <a className="marca marca-en-barra" href={enlaceA({ pantalla: 'inicio' })} aria-label="ConstruSoft, ir al inicio">
                <span className="marca-palabra">ConstruSoft</span>
              </a>
            ) : null}

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
          </div>

          {arriba ? (
            <nav className="menu-superior" aria-label="Módulos">
              <ListaDeModulos actual={actual} recientes={recientes} alPasarPorProyectos={() => setPasadas((n) => n + 1)} />
            </nav>
          ) : null}

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

        {/* data-pantalla: para lo que el CSS ajusta a una pantalla sola (el
            margen de APU y Recursos). */}
        <main id="contenido" className="contenido" data-ancho={anchoCompleto ? 'completo' : undefined} data-pantalla={ruta.pantalla} tabIndex={-1}>
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
