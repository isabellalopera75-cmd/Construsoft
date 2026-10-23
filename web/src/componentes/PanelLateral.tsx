import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icono } from './Icono.tsx';

/*
 * El panel lateral NO MODAL (02 §8.6 y §10.2). La diferencia con la capa es
 * el punto: el desglose del pie tiene que poder quedar a la vista mientras se
 * recorre la mesa buscando la actividad mal clasificada. Lo de atrás sigue
 * vivo, se puede desplazar y se puede editar.
 *
 * Escape lo cierra solo si el foco está adentro: con el foco en la mesa,
 * Escape es de la mesa. Al cerrarse, el foco vuelve a quien lo abrió.
 *
 * Con `abajo`, el mismo panel va como una franja fija al pie de la pantalla, a
 * todo el ancho del contenido (el de una actividad del cronograma, pedido del
 * dueño, 22 de octubre de 2026): así lo de arriba usa el ancho entero. Va al
 * final de la pantalla que lo abre, pegado al borde de abajo de la ventana.
 */

interface Props {
  titulo: string;
  alCerrar: () => void;
  children: ReactNode;
  abajo?: boolean;
}

export function PanelLateral({ titulo, alCerrar, children, abajo = false }: Props) {
  const idTitulo = useId();
  const panel = useRef<HTMLElement>(null);
  const cerrar = useRef(alCerrar);
  cerrar.current = alCerrar;

  useEffect(() => {
    const abridor = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Abajo, sin desplazar la página: el panel ya está a la vista.
    panel.current?.focus({ preventScroll: abajo });
    return () => {
      if (abridor?.isConnected) abridor.focus();
    };
  }, []);

  return (
    <aside
      ref={panel}
      className={abajo ? 'panel-lateral panel-inferior' : 'panel-lateral'}
      aria-labelledby={idTitulo}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        cerrar.current();
      }}
    >
      <div className="panel-lateral-cabecera">
        <h2 id={idTitulo}>{titulo}</h2>
        <button type="button" className="boton-icono" aria-label={`Cerrar ${titulo.toLowerCase()}`} onClick={() => cerrar.current()}>
          <Icono nombre="cerrar" />
        </button>
      </div>
      <div className="panel-lateral-cuerpo">{children}</div>
    </aside>
  );
}
