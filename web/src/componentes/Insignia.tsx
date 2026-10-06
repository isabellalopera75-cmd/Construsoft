import type { EstadoPresupuesto } from '../api/tipos.ts';

/*
 * La insignia de estado. Siempre con palabra: el color nunca es la única señal
 * (DISENO §2). Quien no distingue el verde del gris tiene que leer «Activo».
 */

const NOMBRES: Record<EstadoPresupuesto, string> = {
  ABIERTO: 'Abierto',
  ACTIVO: 'Activo',
  CERRADO: 'Cerrado',
};

export function InsigniaDeEstado({ estado }: { estado: EstadoPresupuesto }) {
  return (
    <span className="insignia" data-estado={estado}>
      {NOMBRES[estado]}
    </span>
  );
}

export function nombreDeEstado(estado: EstadoPresupuesto): string {
  return NOMBRES[estado];
}
