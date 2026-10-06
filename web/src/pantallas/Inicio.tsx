import { Icono } from '../componentes/Icono.tsx';
import { useModulosVisibles } from '../cascaron/Cascaron.tsx';
import { enlaceA } from '../navegacion.ts';
import { useSesion } from '../sesion.tsx';

/*
 * 02 §4 · La pantalla de inicio es un menú con los módulos que el rol permite.
 * Es la única bifurcación de la aplicación (DISENO §7 bis). El tablero con
 * cifras que pidió el dueño es alcance nuevo y no está en esta rebanada.
 */

export function Inicio() {
  const { arranque } = useSesion();
  const modulos = useModulosVisibles();
  const primerNombre = arranque.usuarioNombre.trim().split(/\s+/)[0] ?? '';

  return (
    <>
      <div className="encabezado-de-pantalla">
        <div>
          <h1>Hola, {primerNombre}</h1>
          <p className="bajada">{arranque.razonSocial}</p>
        </div>
      </div>
      <ul className="menu-de-inicio">
        {modulos.map((m) => (
          <li key={m.nombre}>
            <a className="tarjeta-de-modulo" href={enlaceA(m.ruta)}>
              <span className="tarjeta-de-modulo-icono"><Icono nombre={m.icono} tamano={24} /></span>
              <span className="tarjeta-de-modulo-texto">
                <span className="tarjeta-de-modulo-nombre">{m.nombre}</span>
                <span className="tarjeta-de-modulo-descripcion">{m.descripcion}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}
