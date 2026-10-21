import { useState } from 'react';
import { ErrorDeApi } from '../../api/cliente.ts';
import type { FormatoNumerico } from '../../api/tipos.ts';
import type { Calendario, DatosDeCalendario, Excepcion, ListasDeFestivos, Tramo } from '../../api/tiposCronograma.ts';
import { Campo } from '../../componentes/Campo.tsx';
import { Capa } from '../../componentes/Capa.tsx';
import { Icono } from '../../componentes/Icono.tsx';
import { leerCifra, paraEditar, soloCifra } from '../../entrada.ts';
import { useSesion } from '../../sesion.tsx';
import { DIAS_DE_LA_SEMANA, diaDe, diaDeLaSemana, fechaConDia } from '../cronograma/tiempo.ts';
import { MesDelCalendario } from './MesDelCalendario.tsx';
import { RejillaDeHoras } from './RejillaDeHoras.tsx';
import { bloquesDe, contar, describirTramos, horaDeBloque, horasDeBloques, llenar, tramosDe, type Dia } from './tramos.ts';

/*
 * Las piezas de un calendario que comparten la configuración de la empresa
 * (RF-CFG-29) y el calendario de la obra en el cronograma (07 §6.9: «el
 * calendario de un proyecto se puede editar o reemplazar»). Quien las usa
 * decide a qué ruta van los cambios; aquí solo se arma lo que viaja.
 */

export function mensajeDe(e: unknown, generico: string): string {
  return e instanceof ErrorDeApi ? e.message : generico;
}

/** «8» o «9,5» → «8» o «9.5», de más de 0 y hasta 24. */
export function leerHorasDelDia(texto: string, nombre: string, minimo: '0' | '1' = '0'): { valor: string } | { error: string } {
  const l = leerCifra(texto, { nombre, decimales: 2 });
  if ('error' in l) return l;
  const [entera = '0', fraccion = ''] = l.valor.split('.');
  const conFraccion = /[1-9]/.test(fraccion);
  const largo = entera.replace(/^0+/, '').length;
  const pasa24 = largo > 2 || (largo === 2 && entera > '24') || (entera === '24' && conFraccion);
  const bajo = minimo === '0' ? !/[1-9]/.test(l.valor) : entera === '0';
  if (pasa24 || bajo) return { error: minimo === '0' ? `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} va de más de 0 hasta 24 horas.` : `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} van de 1 a 24.` };
  return l;
}

// --- La semana: nombre, «1 día = X h», llenado rápido y la tabla -----------------

const MEDIAS = Array.from({ length: 48 }, (_, i) => i);

interface PropsSemana {
  titulo: string;
  textoGuardar: string;
  inicial: DatosDeCalendario | null;
  /** El aviso que va arriba: «Cambiar este calendario recalcula el cronograma». */
  nota?: string;
  alGuardar: (datos: DatosDeCalendario) => Promise<void>;
  alCerrar: () => void;
}

const SEMANA_NUEVA: Tramo[][] = [0, 1, 2, 3, 4].map(() => [{ inicio: '07:00', fin: '12:00' }, { inicio: '13:00', fin: '16:00' }]).concat([[], []]);

export function FormularioDeSemana({ titulo, textoGuardar, inicial, nota, alGuardar, alCerrar }: PropsSemana) {
  const { arranque } = useSesion();
  const formato = arranque.formatoNumerico;
  const [nombre, setNombre] = useState(inicial?.nombre ?? '');
  const [horasPorDia, setHorasPorDia] = useState(inicial ? paraEditar(inicial.horasPorDia, formato) : '8');
  const [dias, setDias] = useState<Dia[]>(() => (inicial?.semana ?? SEMANA_NUEVA).map(bloquesDe));
  const [errores, setErrores] = useState<{ nombre?: string; horasPorDia?: string; semana?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [rapido, setRapido] = useState({ desde: 14, medias: 16, almuerzo: true, almDesde: 24, almHasta: 26, dias: [true, true, true, true, true, false, false], sabado: 'igual' as 'igual' | number });

  const huella = (n: string, h: string, d: Dia[]) => JSON.stringify([n.trim(), h, d.map(tramosDe)]);
  const [original] = useState(() => huella(nombre, horasPorDia, dias));
  const hayCambios = huella(nombre, horasPorDia, dias) !== original;
  const totalSemana = dias.reduce((s, d) => s + contar(d), 0);

  function pintar() {
    setDias(llenar({
      desde: horaDeBloque(rapido.desde),
      mediasHoras: rapido.medias,
      almuerzo: rapido.almuerzo ? { desde: horaDeBloque(rapido.almDesde), hasta: horaDeBloque(rapido.almHasta) } : null,
      dias: rapido.dias,
      sabado: rapido.sabado === 'igual' ? null : rapido.sabado,
    }));
    if (errores.semana) setErrores((e) => ({ ...e, semana: '' }));
  }

  async function enviar() {
    if (enviando) return;
    const faltan: typeof errores = {};
    if (nombre.trim() === '') faltan.nombre = 'Escriba el nombre del calendario.';
    const h = leerHorasDelDia(horasPorDia, '«1 día»');
    if ('error' in h) faltan.horasPorDia = h.error;
    if (totalSemana === 0) faltan.semana = 'Marque al menos una media hora: un calendario sin horas no deja avanzar ninguna actividad.';
    setErrores(faltan);
    if (faltan.nombre || faltan.horasPorDia || faltan.semana || 'error' in h) return;
    setEnviando(true);
    setError(null);
    try {
      await alGuardar({ nombre: nombre.trim(), horasPorDia: h.valor, semana: dias.map(tramosDe) });
    } catch (e) {
      setEnviando(false);
      if (e instanceof ErrorDeApi && (e.campo === 'nombre' || e.campo === 'horasPorDia' || e.campo === 'semana')) setErrores({ [e.campo]: e.message });
      else setError(mensajeDe(e, 'No se guardó el calendario. Intente de nuevo.'));
    }
  }

  const etiquetaMedias = (n: number) => `${horasDeBloques(n).replace('.0', '').replace('.', formato.separadorDecimal)} h`;

  return (
    <Capa
      titulo={titulo}
      alCerrar={alCerrar}
      hayCambios={hayCambios}
      error={error}
      alEnviar={() => void enviar()}
      acciones={(cerrar) => (
        <>
          <button type="button" className="boton boton-secundario" onClick={cerrar} disabled={enviando}>Cancelar</button>
          <button type="submit" className="boton boton-principal" disabled={enviando}>{enviando ? 'Guardando…' : textoGuardar}</button>
        </>
      )}
    >
      {nota ? <p className="nota-de-capa"><Icono nombre="aviso" tamano={18} /><span>{nota}</span></p> : null}
      <div className="fila-de-campos fila-calendario">
        <Campo etiqueta="Nombre" error={errores.nombre}>
          {(a) => <input {...a} autoComplete="off" value={nombre} onChange={(e) => { setNombre(e.target.value); if (errores.nombre) setErrores((x) => ({ ...x, nombre: '' })); }} />}
        </Campo>
        <Campo etiqueta="1 día equivale a (horas)" ayuda="Pasa las horas a los días que se ven en pantalla. No cambia el cálculo." error={errores.horasPorDia}>
          {(a) => <input {...a} className="campo-cifra-corto" inputMode="decimal" autoComplete="off" value={horasPorDia} onChange={(e) => { setHorasPorDia(soloCifra(e.target.value, formato.separadorDecimal)); if (errores.horasPorDia) setErrores((x) => ({ ...x, horasPorDia: '' })); }} />}
        </Campo>
      </div>

      <fieldset className="llenado-rapido">
        <legend>Llenado rápido</legend>
        <div className="llenado-rapido-campos">
          <label className="etiqueta-en-linea">Desde
            <select value={rapido.desde} onChange={(e) => setRapido({ ...rapido, desde: e.target.selectedIndex })}>
              {MEDIAS.map((i) => <option key={i} value={i}>{horaDeBloque(i)}</option>)}
            </select>
          </label>
          <label className="etiqueta-en-linea">Trabaja
            <select value={rapido.medias} onChange={(e) => setRapido({ ...rapido, medias: e.target.selectedIndex + 1 })}>
              {MEDIAS.map((i) => <option key={i} value={i + 1}>{etiquetaMedias(i + 1)}</option>)}
            </select>
          </label>
          <label className="casilla">
            <input type="checkbox" checked={rapido.almuerzo} onChange={(e) => setRapido({ ...rapido, almuerzo: e.target.checked })} />
            <span>Almuerzo de</span>
          </label>
          <select aria-label="Almuerzo desde" value={rapido.almDesde} disabled={!rapido.almuerzo} onChange={(e) => setRapido({ ...rapido, almDesde: e.target.selectedIndex })}>
            {MEDIAS.map((i) => <option key={i} value={i}>{horaDeBloque(i)}</option>)}
          </select>
          <span aria-hidden="true">a</span>
          <select aria-label="Almuerzo hasta" value={rapido.almHasta} disabled={!rapido.almuerzo} onChange={(e) => setRapido({ ...rapido, almHasta: e.target.selectedIndex + 1 })}>
            {MEDIAS.map((i) => <option key={i} value={i + 1}>{horaDeBloque(i + 1)}</option>)}
          </select>
        </div>
        <div className="llenado-rapido-campos">
          <span className="etiqueta">Días</span>
          {DIAS_DE_LA_SEMANA.map((d, i) => (
            <label key={d} className="casilla">
              <input type="checkbox" checked={rapido.dias[i] ?? false} onChange={(e) => setRapido({ ...rapido, dias: rapido.dias.map((x, j) => (j === i ? e.target.checked : x)) })} />
              <span>{d.slice(0, 3)}</span>
            </label>
          ))}
          <label className="etiqueta-en-linea">El sábado
            <select disabled={!rapido.dias[5]} value={rapido.sabado === 'igual' ? 'igual' : String(rapido.sabado)} onChange={(e) => setRapido({ ...rapido, sabado: e.target.value === 'igual' ? 'igual' : e.target.selectedIndex })}>
              <option value="igual">igual que los demás</option>
              {MEDIAS.slice(1, 25).map((i) => <option key={i} value={String(i)}>{etiquetaMedias(i)}</option>)}
            </select>
          </label>
          <button type="button" className="boton boton-secundario" onClick={pintar}>Pintar la tabla</button>
        </div>
      </fieldset>

      <div className="bloque-de-semana">
        <p className="bloque-de-precio-titulo">
          Semana tipo · <span className="cifra-en-texto">{horasDeBloques(totalSemana).replace('.', formato.separadorDecimal)} h</span>
        </p>
        <p className="campo-ayuda">Cómo se trabaja un lunes cualquiera, un martes cualquiera…: se repite todas las semanas. Las fechas concretas (festivos, días libres) van en las excepciones. Marque las medias horas que se trabajan arrastrando, o con las flechas y la barra espaciadora. Un turno que pasa la medianoche se marca en los dos días.</p>
        <RejillaDeHoras
          titulo="Horas de trabajo de cada día de la semana"
          filas={dias.map((d, i) => ({ etiqueta: DIAS_DE_LA_SEMANA[i] ?? '', dia: d }))}
          alCambiar={(i, d) => { setDias((ds) => ds.map((x, j) => (j === i ? d : x))); if (errores.semana) setErrores((x) => ({ ...x, semana: '' })); }}
        />
        {errores.semana ? <p className="campo-error" role="alert">{errores.semana}</p> : null}
        <ul className="resumen-de-semana">
          {dias.map((d, i) => (
            <li key={i}><span>{DIAS_DE_LA_SEMANA[i]}</span> <span className="dato-de-apoyo">{describirTramos(tramosDe(d))}</span></li>
          ))}
        </ul>
      </div>
    </Capa>
  );
}

// --- Las excepciones: festivos, días perdidos, un sábado completo ------------------

interface PropsExcepciones {
  calendario: Calendario;
  editable: boolean;
  alGuardar: (fecha: string, motivo: string | null, tramos: Tramo[]) => Promise<void>;
  alQuitar: (fecha: string) => Promise<void>;
  /** El mes que abre la vista de mes. */
  mesInicial: string;
}

export function ExcepcionesDeCalendario({ calendario, editable, alGuardar, alQuitar, mesInicial }: PropsExcepciones) {
  const { arranque } = useSesion();
  const formato = arranque.formatoNumerico;
  // Una excepción que existe, o una nueva (con la fecha del día que se tocó en el mes, si se tocó uno).
  const [editando, setEditando] = useState<Excepcion | { nueva: string } | null>(null);
  const [quitando, setQuitando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verTodas, setVerTodas] = useState(false);
  const lista = calendario.excepciones;
  const LIMITE = 12;
  const visibles = verTodas ? lista : lista.slice(0, LIMITE);

  return (
    <div className="excepciones">
      <div className="excepciones-cabecera">
        <p className="bloque-de-precio-titulo">El mes: la semana tipo con las excepciones</p>
      </div>
      <MesDelCalendario
        calendario={calendario}
        mesInicial={mesInicial}
        editable={editable}
        alElegir={(fecha) => setEditando(lista.find((x) => x.fecha === fecha) ?? { nueva: fecha })}
      />
      <div className="excepciones-cabecera">
        <p className="bloque-de-precio-titulo">
          Excepciones {lista.length > 0 ? <span className="pestana-conteo">{lista.length}</span> : null}
        </p>
        {editable ? (
          <button type="button" className="boton boton-secundario boton-chico-texto" onClick={() => setEditando({ nueva: '' })}>
            <Icono nombre="mas" tamano={16} />
            Agregar excepción
          </button>
        ) : null}
      </div>
      <p className="campo-ayuda">Una fecha que no se trabaja (un festivo, un día perdido por lluvia) o que se trabaja con otras horas (un sábado completo).</p>
      {error ? <p className="aviso-error" role="alert"><Icono nombre="aviso" /><span>{error}</span></p> : null}
      {lista.length === 0 ? (
        <p className="dato-de-apoyo">Este calendario no tiene excepciones.</p>
      ) : (
        <div className="tabla-con-desplazamiento">
          <table className="tabla tabla-densa">
            <caption className="solo-lectores">Excepciones del calendario</caption>
            <thead>
              <tr>
                <th scope="col">Fecha</th>
                <th scope="col">Motivo</th>
                <th scope="col">Horas</th>
                {editable ? <th scope="col"><span className="solo-lectores">Acciones</span></th> : null}
              </tr>
            </thead>
            <tbody>
              {visibles.map((x) => (
                <tr key={x.fecha}>
                  <td className="cifra-izquierda">{fechaConDia(x.fecha)}</td>
                  <td>{x.motivo ?? <span className="dato-de-apoyo">—</span>}</td>
                  <td>{x.tramos.length === 0 ? 'No laborable' : `${describirTramos(x.tramos)} · ${x.horas.replace('.', formato.separadorDecimal)} h`}</td>
                  {editable ? (
                    <td className="col-acciones">
                      <div className="acciones-de-fila">
                        <button type="button" className="boton-icono boton-chico" aria-label={`Editar la excepción del ${fechaConDia(x.fecha)}`} title="Editar" onClick={() => setEditando(x)}>
                          <Icono nombre="editar" tamano={18} />
                        </button>
                        <button
                          type="button"
                          className="boton-icono boton-chico boton-icono-peligro"
                          aria-label={`Quitar la excepción del ${fechaConDia(x.fecha)}`}
                          title="Quitar"
                          disabled={quitando === x.fecha}
                          onClick={async () => {
                            setQuitando(x.fecha);
                            setError(null);
                            try { await alQuitar(x.fecha); } catch (e) { setError(mensajeDe(e, 'No se quitó la excepción.')); } finally { setQuitando(null); }
                          }}
                        >
                          <Icono nombre="basura" tamano={18} />
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {lista.length > LIMITE ? (
        <button type="button" className="boton boton-secundario boton-chico-texto" onClick={() => setVerTodas(!verTodas)}>
          {verTodas ? 'Ver menos' : `Ver las ${lista.length}`}
        </button>
      ) : null}
      {editando ? (
        <FormularioDeExcepcion
          calendario={calendario}
          excepcion={'nueva' in editando ? null : editando}
          fechaInicial={'nueva' in editando ? editando.nueva : ''}
          alCerrar={() => setEditando(null)}
          alGuardar={async (f, m, t) => { await alGuardar(f, m, t); setEditando(null); }}
          alQuitar={async (f) => { await alQuitar(f); setEditando(null); }}
        />
      ) : null}
    </div>
  );
}

function FormularioDeExcepcion({ calendario, excepcion, fechaInicial, alGuardar, alQuitar, alCerrar }: { calendario: Calendario; excepcion: Excepcion | null; fechaInicial: string; alGuardar: (fecha: string, motivo: string | null, tramos: Tramo[]) => Promise<void>; alQuitar: (fecha: string) => Promise<void>; alCerrar: () => void }) {
  const [fecha, setFecha] = useState(excepcion?.fecha ?? fechaInicial);
  const [motivo, setMotivo] = useState(excepcion?.motivo ?? '');
  const [trabaja, setTrabaja] = useState(excepcion ? excepcion.tramos.length > 0 : false);
  const [dia, setDia] = useState<Dia>(() => bloquesDe(excepcion?.tramos ?? []));
  const [errores, setErrores] = useState<{ fecha?: string; tramos?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const hayCambios = fecha !== (excepcion?.fecha ?? fechaInicial) || motivo !== (excepcion?.motivo ?? '') || trabaja !== Boolean(excepcion?.tramos.length);

  // Al marcar «se trabaja con otras horas», se arranca de las horas normales de ese día.
  function cambiarTrabaja(si: boolean) {
    setTrabaja(si);
    if (si && contar(dia) === 0 && /^\d{4}-\d{2}-\d{2}$/.test(fecha)) setDia(bloquesDe(calendario.semana[diaDeLaSemana(diaDe(fecha))] ?? []));
  }

  async function enviar() {
    if (enviando) return;
    const faltan: typeof errores = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) faltan.fecha = 'Elija la fecha.';
    else if (!excepcion && calendario.excepciones.some((x) => x.fecha === fecha)) faltan.fecha = 'Esa fecha ya tiene una excepción: edítela en la lista.';
    if (trabaja && contar(dia) === 0) faltan.tramos = 'Marque las horas que se trabajan ese día, o elija «No se trabaja».';
    setErrores(faltan);
    if (faltan.fecha || faltan.tramos) return;
    setEnviando(true);
    setError(null);
    try {
      await alGuardar(fecha, motivo.trim() === '' ? null : motivo.trim(), trabaja ? tramosDe(dia) : []);
    } catch (e) {
      setEnviando(false);
      if (e instanceof ErrorDeApi && e.campo === 'tramos') setErrores({ tramos: e.message });
      else setError(mensajeDe(e, 'No se guardó la excepción. Intente de nuevo.'));
    }
  }

  return (
    <Capa
      titulo={excepcion ? `Excepción del ${fechaConDia(excepcion.fecha)}` : fechaInicial ? `Excepción del ${fechaConDia(fechaInicial)}` : 'Agregar excepción'}
      alCerrar={alCerrar}
      hayCambios={hayCambios}
      error={error}
      alEnviar={() => void enviar()}
      acciones={(cerrar) => (
        <>
          {excepcion ? (
            <button
              type="button"
              className="boton boton-peligroso boton-aparte"
              disabled={enviando}
              onClick={async () => {
                setEnviando(true);
                setError(null);
                try { await alQuitar(excepcion.fecha); } catch (e) { setEnviando(false); setError(mensajeDe(e, 'No se quitó la excepción.')); }
              }}
            >
              Quitar la excepción
            </button>
          ) : null}
          <button type="button" className="boton boton-secundario" onClick={cerrar} disabled={enviando}>Cancelar</button>
          <button type="submit" className="boton boton-principal" disabled={enviando}>{enviando ? 'Guardando…' : 'Guardar excepción'}</button>
        </>
      )}
    >
      <div className="fila-de-campos">
        <Campo etiqueta="Fecha" error={errores.fecha}>
          {(a) => <input {...a} type="date" value={fecha} disabled={excepcion !== null} onChange={(e) => setFecha(e.target.value)} />}
        </Campo>
        <Campo etiqueta="Motivo (opcional)">
          {(a) => <input {...a} autoComplete="off" value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
        </Campo>
      </div>
      {excepcion ? <p className="campo-ayuda">«Quitar la excepción» devuelve ese día a la semana tipo.</p> : null}
      <fieldset className="campo grupo-en-linea">
        <legend className="etiqueta">Ese día</legend>
        <label className="casilla"><input type="radio" name="trabaja" checked={!trabaja} onChange={() => cambiarTrabaja(false)} /><span>No se trabaja</span></label>
        <label className="casilla"><input type="radio" name="trabaja" checked={trabaja} onChange={() => cambiarTrabaja(true)} /><span>Se trabaja con otras horas</span></label>
      </fieldset>
      {trabaja ? (
        <>
          <RejillaDeHoras titulo="Horas que se trabajan ese día" filas={[{ etiqueta: fecha ? fechaConDia(fecha) : 'Ese día', dia }]} alCambiar={(_, d) => { setDia(d); if (errores.tramos) setErrores({}); }} />
          {errores.tramos ? <p className="campo-error" role="alert">{errores.tramos}</p> : null}
        </>
      ) : null}
    </Capa>
  );
}

// --- Copiar una lista de festivos (RF-CFG-32) ----------------------------------------

export function CopiarFestivos({ calendario, listas, alCopiar, alCerrar }: { calendario: Calendario; listas: ListasDeFestivos | null; alCopiar: (listaId: string, propia: boolean) => Promise<number | null>; alCerrar: () => void }) {
  const [elegida, setElegida] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [hecho, setHecho] = useState<string | null>(null);
  const opciones = listas
    ? [
        ...listas.plataforma.map((l) => ({ clave: `P:${l.id}`, id: l.id, propia: false, nombre: l.nombre, detalle: `Oficial · ${l.anioDesde} a ${l.anioHasta}` })),
        ...listas.propias.map((l) => ({ clave: `E:${l.id}`, id: l.id, propia: true, nombre: l.nombre, detalle: `De su empresa · ${l.fechas} ${l.fechas === 1 ? 'fecha' : 'fechas'}${l.desde !== null ? ` · ${l.desde === l.hasta ? l.desde : `${l.desde} a ${l.hasta}`}` : ''}` })),
      ]
    : [];

  async function enviar() {
    const o = opciones.find((x) => x.clave === elegida);
    if (!o || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const n = await alCopiar(o.id, o.propia);
      setHecho(n === null ? `Se copió «${o.nombre}».` : n === 0 ? `Ninguna fecha nueva: el calendario ya tenía todas las de «${o.nombre}».` : `Se copiaron ${n} ${n === 1 ? 'fecha' : 'fechas'} de «${o.nombre}» como días no laborables.`);
    } catch (e) {
      setError(mensajeDe(e, 'No se copiaron los festivos. Intente de nuevo.'));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Capa
      titulo={`Copiar festivos a «${calendario.nombre}»`}
      alCerrar={alCerrar}
      hayCambios={false}
      error={error}
      alEnviar={() => void enviar()}
      acciones={(cerrar) => (
        <>
          <button type="button" className="boton boton-secundario" onClick={cerrar}>{hecho ? 'Cerrar' : 'Cancelar'}</button>
          {hecho ? null : <button type="submit" className="boton boton-principal" disabled={enviando || elegida === ''}>{enviando ? 'Copiando…' : 'Copiar festivos'}</button>}
        </>
      )}
    >
      {hecho ? (
        <p className="nota-de-capa nota-de-capa-exito" role="status"><Icono nombre="visto" tamano={18} /><span>{hecho}</span></p>
      ) : (
        <>
          <p className="texto-de-dialogo">
            Cada fecha de la lista entra como día no laborable, y después se edita una por una: si la empresa trabaja un festivo, márquelo como laborable en las excepciones.
            Las fechas que el calendario ya tiene no se tocan.
          </p>
          {calendario.festivos.origen ? (
            <p className="dato-de-apoyo">Hoy tiene los de «{calendario.festivos.origen.nombre}», hasta {calendario.festivos.hasta}.</p>
          ) : null}
          {listas === null ? <p className="campo-ayuda">Cargando las listas…</p> : (
            <fieldset className="campo lista-de-opciones">
              <legend className="etiqueta">Lista</legend>
              {opciones.map((o) => (
                <label key={o.clave} className="opcion-con-detalle">
                  <input type="radio" name="lista-festivos" checked={elegida === o.clave} onChange={() => setElegida(o.clave)} />
                  <span><span>{o.nombre}</span><span className="dato-de-apoyo">{o.detalle}</span></span>
                </label>
              ))}
            </fieldset>
          )}
        </>
      )}
    </Capa>
  );
}

/** «Lunes a viernes · 40 h · 1 día = 8 h», para un dato de apoyo. */
export function resumenDeCalendario(c: { nombre: string; horasSemana: string; horasPorDia: string }, formato: FormatoNumerico): string {
  return `${c.horasSemana.replace(/\.0$/, '').replace('.', formato.separadorDecimal)} h por semana · 1 día = ${paraEditar(c.horasPorDia, formato)} h`;
}
