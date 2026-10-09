import { formatearNumero } from '../formato.ts';
import type { CodigoDePlan, Dinero, EstadoComercial, Fecha, MetodoDePago } from './tipos.ts';

/*
 * Lo que comparten las pantallas del panel. El panel no tiene una empresa de
 * la cual leer los formatos: cobra en pesos colombianos y escribe las cifras
 * como se escriben en Colombia.
 */

const FORMATO_COP = { separadorMiles: '.', separadorDecimal: ',', decimalesVista: 0 } as const;
export const SEPARADOR_DECIMAL = ',';

export function dinero(monto: Dinero, moneda = 'COP'): string {
  return moneda === 'COP' ? `$ ${formatearNumero(monto, FORMATO_COP)}` : `${formatearNumero(monto, FORMATO_COP)} ${moneda}`;
}

const MESES: Record<string, string> = {
  '01': 'ene', '02': 'feb', '03': 'mar', '04': 'abr', '05': 'may', '06': 'jun',
  '07': 'jul', '08': 'ago', '09': 'sept', '10': 'oct', '11': 'nov', '12': 'dic',
};

/** «2026-10-16» → «16 oct 2026», sin pasar por la medianoche UTC. */
export function fechaSola(f: Fecha): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(f);
  if (!m) return f;
  const [, anio = '', mes = '01', dia = '01'] = m;
  return `${dia} ${MESES[mes] ?? mes} ${anio}`;
}

/** La fecha de hoy en la zona del navegador, como «aaaa-mm-dd». */
export function hoy(): Fecha {
  const d = new Date();
  const dos = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

export function primeroDelMes(): Fecha {
  return `${hoy().slice(0, 8)}01`;
}

export const NOMBRE_DE_PLAN: Record<CodigoDePlan, string> = { PERSONAL: 'Personal', EMPRESARIAL: 'Empresarial' };

export const NOMBRE_DE_METODO: Record<MetodoDePago, string> = {
  TRANSFERENCIA: 'Transferencia',
  PSE: 'PSE',
  EFECTIVO: 'Efectivo',
  OTRO: 'Otro',
};

const NOMBRE_DE_ESTADO: Record<EstadoComercial, string> = {
  EN_PRUEBA: 'En prueba',
  ACTIVA: 'Activa',
  VENCIDA: 'Vencida',
  CANCELADA: 'Cancelada',
  SIN_SUSCRIPCION: 'Sin suscripción',
};

/**
 * El estado de la suscripción y, aparte, la suspensión: son dos cosas. Una
 * empresa puede estar al día y suspendida, y pagar no la saca de ahí.
 */
export function InsigniasDeEmpresa({ estado, suspendida }: { estado: EstadoComercial; suspendida: boolean }) {
  return (
    <span className="insignias">
      <span className="insignia insignia-suscripcion" data-estado={estado}>{NOMBRE_DE_ESTADO[estado]}</span>
      {suspendida ? <span className="insignia insignia-suscripcion" data-estado="SUSPENDIDA">Suspendida</span> : null}
    </span>
  );
}

/** «vence en 3 días», «venció hace 2 días», «vence hoy». */
export function textoDeDias(dias: number | null): string {
  if (dias === null) return '';
  if (dias === 0) return 'vence hoy';
  if (dias === 1) return 'vence mañana';
  if (dias > 1) return `en ${dias} días`;
  return dias === -1 ? 'venció ayer' : `venció hace ${-dias} días`;
}
