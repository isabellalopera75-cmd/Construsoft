import { useState } from 'react';
import type { Calendario, Fecha, Tramo } from '../../api/tiposCronograma.ts';
import { Icono } from '../../componentes/Icono.tsx';
import { useSesion } from '../../sesion.tsx';
import { DIAS_DE_LA_SEMANA, diaDe, diaDeLaSemana, diaDelMes, fechaConDia, fechaDe, mesSiguiente, minutosDelDia, nombreDelMes, primeroDelMes } from '../cronograma/tiempo.ts';

/*
 * El mes de un calendario (pedido del dueño, 21 de octubre de 2026): cómo
 * queda cada fecha con la semana tipo y las excepciones juntas, como la vista
 * de mes del calendario de P6. La semana tipo dice cómo es un lunes
 * cualquiera; esta vista dice cómo es el lunes 2 de noviembre, festivo
 * incluido.
 *
 * Con un clic en un día se edita su excepción: se crea si no la tiene.
 */

type Tipo = 'laborable' | 'no-laborable' | 'excepcion-libre' | 'excepcion-horas';

const minutosDe = (tramos: Tramo[]) => tramos.reduce((s, t) => s + minutosDelDia(t.fin) - minutosDelDia(t.inicio), 0);

/** «8 h», «4,5 h». Son medias horas enteras, no dinero. */
function horasEnTexto(minutos: number, decimal: string): string {
  const medias = Math.round(minutos / 30);
  return `${Math.floor(medias / 2)}${medias % 2 === 0 ? '' : `${decimal}5`} h`;
}

interface Props {
  calendario: Calendario;
  /** El mes que se abre: el del inicio de la obra, o el de hoy. */
  mesInicial: Fecha;
  editable: boolean;
  alElegir: (fecha: Fecha) => void;
}

export function MesDelCalendario({ calendario, mesInicial, editable, alElegir }: Props) {
  const decimal = useSesion().arranque.formatoNumerico.separadorDecimal;
  const [primero, setPrimero] = useState(() => primeroDelMes(diaDe(mesInicial)));
  const siguiente = mesSiguiente(primero);
  const anterior = primeroDelMes(primero - 1);
  const excepciones = new Map(calendario.excepciones.map((e) => [e.fecha, e]));

  // Semanas de lunes a domingo, como la semana tipo.
  const desde = primero - diaDeLaSemana(primero);
  const hasta = siguiente - 1 + (6 - diaDeLaSemana(siguiente - 1));
  const semanas: number[][] = [];
  for (let d = desde; d <= hasta; d += 7) semanas.push([0, 1, 2, 3, 4, 5, 6].map((i) => d + i));

  const describir = (dia: number): { tipo: Tipo; horas: string; motivo: string | null } => {
    const fecha = fechaDe(dia);
    const e = excepciones.get(fecha);
    if (e) {
      return e.tramos.length === 0
        ? { tipo: 'excepcion-libre', horas: '', motivo: e.motivo ?? 'No laborable' }
        : { tipo: 'excepcion-horas', horas: horasEnTexto(minutosDe(e.tramos), decimal), motivo: e.motivo ?? 'Otras horas' };
    }
    const tramos = calendario.semana[diaDeLaSemana(dia)] ?? [];
    return tramos.length === 0 ? { tipo: 'no-laborable', horas: '', motivo: null } : { tipo: 'laborable', horas: horasEnTexto(minutosDe(tramos), decimal), motivo: null };
  };

  const resumen = (dia: number) => {
    const d = describir(dia);
    const que = d.tipo === 'laborable' ? `se trabajan ${d.horas}` : d.tipo === 'no-laborable' ? 'no se trabaja' : d.tipo === 'excepcion-libre' ? `no se trabaja: ${d.motivo}` : `${d.motivo}: se trabajan ${d.horas}`;
    return `${fechaConDia(fechaDe(dia))}, ${que}`;
  };

  return (
    <div className="mes-del-calendario">
      <div className="mes-del-calendario-cabecera">
        <button type="button" className="boton-icono" aria-label={`Mes anterior, ${nombreDelMes(anterior)}`} onClick={() => setPrimero(anterior)}>
          <Icono nombre="volver" />
        </button>
        <p className="mes-del-calendario-titulo" aria-live="polite">{nombreDelMes(primero)}</p>
        <button type="button" className="boton-icono boton-adelante" aria-label={`Mes siguiente, ${nombreDelMes(siguiente)}`} onClick={() => setPrimero(siguiente)}>
          <Icono nombre="volver" />
        </button>
      </div>
      <table className="mes-del-calendario-tabla">
        <caption className="solo-lectores">{`${calendario.nombre}, ${nombreDelMes(primero)}`}</caption>
        <thead>
          <tr>{DIAS_DE_LA_SEMANA.map((d) => <th key={d} scope="col" abbr={d}>{d.slice(0, 3)}</th>)}</tr>
        </thead>
        <tbody>
          {semanas.map((s) => (
            <tr key={s[0]}>
              {s.map((dia) => {
                if (dia < primero || dia >= siguiente) return <td key={dia} data-fuera="si" />;
                const d = describir(dia);
                const contenido = (
                  <>
                    <span className="mes-dia-numero">{diaDelMes(dia)}</span>
                    {d.horas ? <span className="mes-dia-horas">{d.horas}</span> : null}
                    {d.motivo ? <span className="mes-dia-motivo">{d.motivo}</span> : null}
                  </>
                );
                return (
                  <td key={dia} data-tipo={d.tipo}>
                    {editable ? (
                      <button type="button" className="mes-dia" aria-label={`${resumen(dia)}. Editar ese día`} title={resumen(dia)} onClick={() => alElegir(fechaDe(dia))}>
                        {contenido}
                      </button>
                    ) : (
                      <span className="mes-dia" aria-label={resumen(dia)} title={resumen(dia)}>{contenido}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="leyenda leyenda-mes" aria-label="Qué es cada día">
        <li><span className="leyenda-dia" data-tipo="laborable" />Se trabaja, con la semana tipo</li>
        <li><span className="leyenda-dia" data-tipo="no-laborable" />No se trabaja por la semana tipo</li>
        <li><span className="leyenda-dia" data-tipo="excepcion-libre" />Festivo o día libre</li>
        <li><span className="leyenda-dia" data-tipo="excepcion-horas" />Otras horas ese día</li>
      </ul>
      {editable ? <p className="campo-ayuda">Haga clic en un día para marcarlo como festivo, como día libre o con otras horas.</p> : null}
    </div>
  );
}
