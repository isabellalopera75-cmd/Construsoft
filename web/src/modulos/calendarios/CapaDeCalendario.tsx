import { useEffect, useState, type ReactNode } from 'react';
import { pedir } from '../../api/cliente.ts';
import type { Calendario, DatosDeCalendario, ListasDeFestivos, Tramo } from '../../api/tiposCronograma.ts';
import { Capa } from '../../componentes/Capa.tsx';
import { Icono } from '../../componentes/Icono.tsx';
import { useSesion } from '../../sesion.tsx';
import { DIAS_DE_LA_SEMANA } from '../cronograma/tiempo.ts';
import { CopiarFestivos, ExcepcionesDeCalendario, FormularioDeSemana, resumenDeCalendario } from './Calendarios.tsx';
import { RejillaDeHoras } from './RejillaDeHoras.tsx';
import { bloquesDe } from './tramos.ts';

/*
 * Un calendario abierto para consultarlo, como un APU (02 §6.2): se mira la
 * semana, las excepciones y de dónde salieron sus festivos, y «Editar semana»
 * abre el formulario encima. Las excepciones y los festivos se guardan al
 * momento, cada uno con su ruta, como las filas de la tabla de unidades.
 *
 * La usan la pestaña de configuración (el calendario de la empresa) y el
 * cronograma (el calendario de la obra, D-86). Quien la usa decide las rutas.
 */

interface Props {
  calendario: Calendario;
  editable: boolean;
  /** Lo que se dice arriba: para la obra, que cambiarlo recalcula. */
  nota?: string;
  /** Botones extra del pie, a la izquierda del «Cerrar». */
  accionesExtra?: ReactNode;
  /** Algo más debajo de los festivos: reemplazar por otro de la empresa. */
  pie?: ReactNode;
  alGuardarSemana: (datos: DatosDeCalendario) => Promise<void>;
  alGuardarExcepcion: (fecha: string, motivo: string | null, tramos: Tramo[]) => Promise<void>;
  alQuitarExcepcion: (fecha: string) => Promise<void>;
  /** Devuelve cuántas fechas entraron, o null si la ruta no lo dice. */
  alCopiarFestivos: (listaId: string, propia: boolean) => Promise<number | null>;
  /** Desde configuración, con `?para=CONFIG` (CONTRATO §19). */
  rutaListas?: string;
  alCerrar: () => void;
}

export function CapaDeCalendario({ rutaListas = '/api/festivos', calendario, editable, nota, accionesExtra, pie, alGuardarSemana, alGuardarExcepcion, alQuitarExcepcion, alCopiarFestivos, alCerrar }: Props) {
  const { arranque } = useSesion();
  const formato = arranque.formatoNumerico;
  const [editando, setEditando] = useState(false);
  const [copiando, setCopiando] = useState(false);
  const [listas, setListas] = useState<ListasDeFestivos | null>(null);

  useEffect(() => {
    if (!copiando || listas) return;
    pedir<ListasDeFestivos>(rutaListas).then(setListas).catch(() => setListas({ plataforma: [], propias: [] }));
  }, [copiando, listas, rutaListas]);

  const f = calendario.festivos;

  return (
    <>
      <Capa
        titulo={calendario.tipo === 'OBRA' ? `Calendario de la obra · ${calendario.nombre}` : `Calendario «${calendario.nombre}»`}
        alCerrar={alCerrar}
        hayCambios={false}
        acciones={(cerrar) => (
          <>
            {accionesExtra}
            <button type="button" className="boton boton-secundario" onClick={cerrar}>Cerrar</button>
            {editable ? (
              <button type="button" className="boton boton-principal" onClick={() => setEditando(true)}>
                <Icono nombre="editar" />
                Editar semana
              </button>
            ) : null}
          </>
        )}
      >
        {nota ? <p className="nota-de-capa"><Icono nombre="aviso" tamano={18} /><span>{nota}</span></p> : null}
        <div className="capa-ancha-contenido">
          <p className="dato-de-apoyo">{resumenDeCalendario(calendario, formato)}</p>
          <RejillaDeHoras
            titulo={`Semana del calendario ${calendario.nombre}`}
            filas={calendario.semana.map((d, i) => ({ etiqueta: DIAS_DE_LA_SEMANA[i] ?? '', dia: bloquesDe(d) }))}
            soloLectura
          />
        </div>

        <div className="festivos-del-calendario">
          <div>
            <p className="bloque-de-precio-titulo">Festivos</p>
            <p className="campo-ayuda">
              {f.origen
                ? `Copiados de «${f.origen.nombre}» hasta ${f.hasta ?? '—'}. Cada uno es una excepción y se edita abajo.`
                : 'Este calendario no tiene festivos copiados. Copie la lista oficial del país o una de su empresa.'}
            </p>
          </div>
          {editable ? (
            <button type="button" className="boton boton-secundario" onClick={() => setCopiando(true)}>
              <Icono nombre="calendario" />
              Copiar festivos
            </button>
          ) : null}
        </div>

        <ExcepcionesDeCalendario calendario={calendario} editable={editable} alGuardar={alGuardarExcepcion} alQuitar={alQuitarExcepcion} />
        {pie}
      </Capa>

      {editando ? (
        <FormularioDeSemana
          titulo={`Editar la semana de «${calendario.nombre}»`}
          textoGuardar="Guardar calendario"
          inicial={{ nombre: calendario.nombre, horasPorDia: calendario.horasPorDia, semana: calendario.semana }}
          {...(nota ? { nota } : {})}
          alCerrar={() => setEditando(false)}
          alGuardar={async (d) => {
            await alGuardarSemana(d);
            setEditando(false);
          }}
        />
      ) : null}
      {copiando ? <CopiarFestivos calendario={calendario} listas={listas} alCopiar={alCopiarFestivos} alCerrar={() => setCopiando(false)} /> : null}
    </>
  );
}
