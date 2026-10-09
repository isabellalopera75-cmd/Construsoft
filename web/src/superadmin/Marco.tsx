import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useBarraPlegable } from '../cascaron/barraPlegable.ts';
import { Icono, type NombreDeIcono } from '../componentes/Icono.tsx';
import { aplicarTema, temaVisible, type Tema } from '../tema.ts';
import { enlaceA, type RutaDePlataforma } from './navegacion.ts';

/*
 * El marco del panel: el mismo orden que el de las empresas —barra lateral,
 * migas, quién soy, contenido en una columna— para que quien conoce una
 * aplicación no tenga que aprender la otra. Lo que cambia es lo que dice: la
 * marca lleva debajo «Plataforma», con un escudo, para que nadie confunda en
 * qué consola está parado antes de suspender una empresa.
 */

const MODULOS: readonly { ruta: RutaDePlataforma; nombre: string; icono: NombreDeIcono }[] = [
  { ruta: { pantalla: 'resumen' }, nombre: 'Resumen', icono: 'resumen' },
  { ruta: { pantalla: 'empresas' }, nombre: 'Empresas', icono: 'empresas' },
  { ruta: { pantalla: 'pagos' }, nombre: 'Pagos', icono: 'pagos' },
  { ruta: { pantalla: 'bitacora' }, nombre: 'Bitácora', icono: 'historial' },
];

function moduloDe(ruta: RutaDePlataforma): RutaDePlataforma['pantalla'] {
  return ruta.pantalla === 'empresa' ? 'empresas' : ruta.pantalla;
}

export function Marco({
  ruta,
  migas,
  quien,
  alSalir,
  children,
}: {
  ruta: RutaDePlataforma;
  migas: readonly { nombre: string; ruta?: RutaDePlataforma }[];
  quien: string;
  alSalir: () => void;
  children: ReactNode;
}) {
  const { plegada, mediana, alternarBarra } = useBarraPlegable();
  const actual = moduloDe(ruta);
  const [cajonAbierto, setCajonAbierto] = useState(false);
  const botonMenu = useRef<HTMLButtonElement>(null);

  // En el teléfono la barra es un cajón: cambiar de pantalla lo cierra, y
  // Escape también, devolviendo el foco al botón que lo abrió.
  useEffect(() => setCajonAbierto(false), [ruta]);
  useEffect(() => {
    if (!cajonAbierto) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setCajonAbierto(false);
      botonMenu.current?.focus();
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [cajonAbierto]);

  return (
    <div className="cascaron cascaron-plataforma" data-cajon={cajonAbierto ? 'abierto' : 'cerrado'} data-barra={plegada ? 'plegada' : 'abierta'}>
      <a className="saltar-al-contenido" href="#contenido" onClick={(e) => {
        e.preventDefault();
        document.getElementById('contenido')?.focus();
      }}>
        Saltar al contenido
      </a>
      <aside className="barra-lateral" id="barra-lateral" aria-label="Secciones del panel">
        <a className="marca" href={enlaceA({ pantalla: 'resumen' })} aria-label="ConstruSoft, panel de la plataforma">
          <span className="marca-palabra">ConstruSoft</span>
        </a>
        <p className="sello-de-plataforma">
          <Icono nombre="escudo" tamano={16} />
          <span className="etiqueta-de-modulo">Plataforma</span>
        </p>
        <nav>
          <ul className="lista-de-modulos">
            {MODULOS.map((m) => (
              <li key={m.nombre}>
                <a href={enlaceA(m.ruta)} aria-current={actual === m.ruta.pantalla ? 'page' : undefined}>
                  <Icono nombre={m.icono} />
                  <span className="etiqueta-de-modulo">{m.nombre}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
        {mediana ? null : (
          <button type="button" className="boton-de-barra" aria-expanded={!plegada} aria-controls="barra-lateral" onClick={alternarBarra}>
            <Icono nombre={plegada ? 'desplegar' : 'plegar'} />
            <span className="etiqueta-de-modulo">{plegada ? 'Mostrar menú' : 'Ocultar menú'}</span>
          </button>
        )}
      </aside>
      <div className="velo-del-cajon" aria-hidden="true" onClick={() => setCajonAbierto(false)} />

      <div className="cascaron-principal">
        <header className="barra-superior">
          <button ref={botonMenu} type="button" className="boton-icono boton-del-cajon" aria-label="Menú del panel"
                  aria-expanded={cajonAbierto} aria-controls="barra-lateral" onClick={() => setCajonAbierto((a) => !a)}>
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
              <span className="quien-soy-nombre">{quien}</span>
              <span className="quien-soy-empresa">Superadministrador</span>
            </span>
            <BotonDeTema />
            <button type="button" className="boton-icono" aria-label="Salir" title="Salir" onClick={alSalir}>
              <Icono nombre="salir" />
            </button>
          </div>
        </header>
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
    <button type="button" className="boton-icono" aria-label={texto} title={texto} onClick={() => { aplicarTema(otro); setTema(otro); }}>
      <Icono nombre={otro === 'claro' ? 'sol' : 'luna'} />
    </button>
  );
}
