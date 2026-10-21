import { useEffect, useState } from 'react';
import { ErrorDeApi, pedir } from '../../api/cliente.ts';
import type { Calendario, CalendarioResumen, ListaPropia, ListaPropiaResumen, ListasDeFestivos } from '../../api/tiposCronograma.ts';
import { useAvisos } from '../../componentes/Avisos.tsx';
import { Campo } from '../../componentes/Campo.tsx';
import { Capa } from '../../componentes/Capa.tsx';
import { Confirmacion } from '../../componentes/Confirmacion.tsx';
import { Icono } from '../../componentes/Icono.tsx';
import { useSesion } from '../../sesion.tsx';
import { ImportarExcel } from '../comun/ImportarExcel.tsx';
import { DosColumnas, ErrorDeSeccion, Fichas, Seccion, useLectura } from '../configuracion/piezas.tsx';
import { fechaConDia } from '../cronograma/tiempo.ts';
import { FormularioDeSemana, mensajeDe, resumenDeCalendario } from './Calendarios.tsx';
import { CapaDeCalendario } from './CapaDeCalendario.tsx';

/*
 * Configuración › Calendarios y festivos (RF-CFG-29, RF-CFG-32; CONTRATO §19.3
 * y §19.4). Los calendarios de la empresa son el molde: cada cronograma se
 * lleva una copia al crearse, así que editarlos aquí no mueve ninguna obra
 * (D-86). Las listas de festivos de la plataforma se ven y se copian; las de
 * la empresa son suyas y solo ella las ve (D-90).
 */

const BASE = '/api/configuracion/calendarios';

export function PestanaDeCalendarios() {
  const { soloLectura, arranque } = useSesion();
  const formato = arranque.formatoNumerico;
  const { avisar } = useAvisos();
  const cals = useLectura<{ calendarios: CalendarioResumen[] }>('/api/calendarios?para=CONFIG');
  const fest = useLectura<ListasDeFestivos>('/api/festivos?para=CONFIG');
  const [abierto, setAbierto] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);

  if (cals.error) return <ErrorDeSeccion mensaje={cals.error} alReintentar={cals.releer} />;
  if (!cals.datos) return <p className="campo-ayuda">Cargando…</p>;
  const lista = cals.datos.calendarios;
  const porDefecto = lista.find((c) => c.porDefecto);

  return (
    <>
      <Seccion titulo="Calendarios y festivos" ayuda="Cada proyecto se lleva una copia del calendario al crear su cronograma: cambiar uno de aquí no mueve ninguna obra.">
        <Fichas datos={[
          { etiqueta: 'Calendarios', valor: String(lista.length) },
          { etiqueta: 'Por defecto', valor: porDefecto?.nombre ?? '—' },
          { etiqueta: 'Listas de festivos', valor: fest.datos ? `${fest.datos.plataforma.length} oficial${fest.datos.plataforma.length === 1 ? '' : 'es'} · ${fest.datos.propias.length} de la empresa` : '…' },
        ]} />
      </Seccion>
      <DosColumnas>
        <Seccion
          titulo="Calendarios de la empresa"
          ayuda="El que va por defecto se propone al crear un cronograma."
          accion={soloLectura ? undefined : (
            <button type="button" className="boton boton-secundario" onClick={() => setCreando(true)}>
              <Icono nombre="mas" />
              Crear calendario
            </button>
          )}
        >
          <ul className="lista-de-calendarios">
            {lista.map((c) => (
              <li key={c.id}>
                <button type="button" className="fila-de-calendario" onClick={() => setAbierto(c.id)}>
                  <span className="fila-de-calendario-nombre">
                    <Icono nombre="calendario" tamano={18} />
                    {c.nombre}
                    {c.porDefecto ? <span className="insignia" data-estado="ACTIVO">Por defecto</span> : null}
                  </span>
                  <span className="dato-de-apoyo">{resumenDeCalendario(c, formato)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Seccion>
        <Festivos datos={fest.datos} error={fest.error} releer={fest.releer} />
      </DosColumnas>

      {creando ? (
        <FormularioDeSemana
          titulo="Crear calendario"
          textoGuardar="Crear calendario"
          inicial={null}
          alCerrar={() => setCreando(false)}
          alGuardar={async (d) => {
            const c = await pedir<Calendario>(BASE, { metodo: 'POST', cuerpo: d });
            setCreando(false);
            cals.releer();
            avisar(`Calendario «${c.nombre}» creado.`);
            setAbierto(c.id);
          }}
        />
      ) : null}
      {abierto ? (
        <CalendarioDeLaEmpresa
          id={abierto}
          alCerrar={() => setAbierto(null)}
          alCambiar={(aviso) => {
            cals.releer();
            if (aviso) avisar(aviso);
          }}
        />
      ) : null}
    </>
  );
}

function CalendarioDeLaEmpresa({ id, alCerrar, alCambiar }: { id: string; alCerrar: () => void; alCambiar: (aviso: string | null) => void }) {
  const { soloLectura } = useSesion();
  const [cal, setCal] = useState<Calendario | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [borrando, setBorrando] = useState(false);
  const ruta = `${BASE}/${encodeURIComponent(id)}`;

  useEffect(() => {
    pedir<Calendario>(ruta).then(setCal).catch((e: unknown) => setError(mensajeDe(e, 'No se pudo leer el calendario.')));
  }, [ruta]);

  if (!cal) {
    return (
      <Capa titulo="Calendario" alCerrar={alCerrar} hayCambios={false} error={error} acciones={(cerrar) => <button type="button" className="boton boton-secundario" onClick={cerrar}>Cerrar</button>}>
        {error ? null : <p className="campo-ayuda">Cargando el calendario…</p>}
      </Capa>
    );
  }

  const editable = !soloLectura;
  return (
    <>
      <CapaDeCalendario
        calendario={cal}
        editable={editable}
        rutaListas="/api/festivos?para=CONFIG"
        accionesExtra={editable && !cal.porDefecto ? (
          <>
            <button type="button" className="boton boton-peligroso boton-aparte" onClick={() => setBorrando(true)}>Eliminar</button>
            <button
              type="button"
              className="boton boton-secundario"
              onClick={async () => {
                try {
                  await pedir(`${ruta}/por-defecto`, { metodo: 'POST' });
                  setCal({ ...cal, porDefecto: true });
                  alCambiar(`«${cal.nombre}» es ahora el calendario por defecto.`);
                } catch (e) {
                  setError(mensajeDe(e, 'No se cambió el calendario por defecto.'));
                }
              }}
            >
              Usar por defecto
            </button>
          </>
        ) : null}
        pie={error ? <p className="aviso-error" role="alert"><Icono nombre="aviso" /><span>{error}</span></p> : null}
        alCerrar={alCerrar}
        alGuardarSemana={async (d) => {
          setCal(await pedir<Calendario>(ruta, { metodo: 'PUT', cuerpo: d }));
          alCambiar(`Calendario «${d.nombre}» guardado.`);
        }}
        alGuardarExcepcion={async (fecha, motivo, tramos) => {
          setCal(await pedir<Calendario>(`${ruta}/excepciones/${fecha}`, { metodo: 'PUT', cuerpo: { motivo, tramos } }));
        }}
        alQuitarExcepcion={async (fecha) => {
          setCal(await pedir<Calendario>(`${ruta}/excepciones/${fecha}`, { metodo: 'DELETE' }));
        }}
        alCopiarFestivos={async (listaId, propia) => {
          const r = await pedir<{ copiados: number; calendario: Calendario }>(`${ruta}/festivos`, { metodo: 'POST', cuerpo: { listaId, propia } });
          setCal(r.calendario);
          alCambiar(null);
          return r.copiados;
        }}
      />
      {borrando ? (
        <Confirmacion
          titulo={`Eliminar el calendario «${cal.nombre}»`}
          textoConfirmar="Eliminar calendario"
          textoEnviando="Eliminando…"
          peligroso
          alCerrar={() => setBorrando(false)}
          alConfirmar={async () => {
            await pedir<void>(ruta, { metodo: 'DELETE' });
            alCambiar(`Calendario «${cal.nombre}» eliminado.`);
            alCerrar();
          }}
        >
          <p>Se eliminará «{cal.nombre}» con sus excepciones. Los cronogramas que lo copiaron no cambian: cada uno tiene su copia.</p>
        </Confirmacion>
      ) : null}
    </>
  );
}

// --- Festivos ----------------------------------------------------------------------

function Festivos({ datos, error, releer }: { datos: ListasDeFestivos | null; error: string | null; releer: () => void }) {
  const { soloLectura } = useSesion();
  const { avisar } = useAvisos();
  const [editando, setEditando] = useState<ListaPropiaResumen | 'nueva' | null>(null);
  const [importando, setImportando] = useState(false);
  const [borrando, setBorrando] = useState<ListaPropiaResumen | null>(null);

  return (
    <Seccion
      titulo="Festivos"
      ayuda="Las listas se copian a un calendario; después cada fecha se edita en él."
      accion={soloLectura ? undefined : (
        <div className="fila-de-botones">
          <button type="button" className="boton boton-secundario" onClick={() => setImportando(true)}>
            <Icono nombre="subirArchivo" />
            Importar
          </button>
          <button type="button" className="boton boton-secundario" onClick={() => setEditando('nueva')}>
            <Icono nombre="mas" />
            Crear lista
          </button>
        </div>
      )}
    >
      {error ? <ErrorDeSeccion mensaje={error} alReintentar={releer} /> : null}
      {!datos && !error ? <p className="campo-ayuda">Cargando…</p> : null}
      {datos ? (
        <>
          <p className="bloque-de-precio-titulo">Oficiales</p>
          <ul className="lista-de-festivos">
            {datos.plataforma.map((l) => (
              <li key={l.id}>
                <span>{l.nombre}</span>
                <span className="dato-de-apoyo">{l.anioDesde} a {l.anioHasta} · la mantiene ConstruSoft</span>
              </li>
            ))}
          </ul>
          <p className="bloque-de-precio-titulo">De su empresa</p>
          {datos.propias.length === 0 ? (
            <p className="dato-de-apoyo">Todavía no hay listas propias. Sirven para los días que la empresa no trabaja y no son festivos del país.</p>
          ) : (
            <ul className="lista-de-festivos">
              {datos.propias.map((l) => (
                <li key={l.id}>
                  <span>{l.nombre}</span>
                  <span className="dato-de-apoyo">
                    {l.fechas} {l.fechas === 1 ? 'fecha' : 'fechas'}
                    {l.desde !== null ? ` · ${l.desde === l.hasta ? l.desde : `${l.desde} a ${l.hasta}`}` : ''}
                  </span>
                  {soloLectura ? null : (
                    <span className="acciones-de-fila">
                      <button type="button" className="boton-icono boton-chico" aria-label={`Editar la lista ${l.nombre}`} title="Editar" onClick={() => setEditando(l)}>
                        <Icono nombre="editar" tamano={18} />
                      </button>
                      <button type="button" className="boton-icono boton-chico boton-icono-peligro" aria-label={`Eliminar la lista ${l.nombre}`} title="Eliminar" onClick={() => setBorrando(l)}>
                        <Icono nombre="basura" tamano={18} />
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}

      {editando ? (
        <FormularioDeLista
          id={editando === 'nueva' ? null : editando.id}
          alCerrar={() => setEditando(null)}
          alGuardar={(l, nueva) => {
            setEditando(null);
            releer();
            avisar(nueva ? `Lista «${l.nombre}» creada.` : `Lista «${l.nombre}» guardada.`);
          }}
        />
      ) : null}
      {importando ? <ImportarFestivos alCerrar={() => setImportando(false)} alImportar={(l) => { setImportando(false); releer(); avisar(`Lista «${l.nombre}» importada, con ${l.fechas.length} ${l.fechas.length === 1 ? 'fecha' : 'fechas'}.`); }} /> : null}
      {borrando ? (
        <Confirmacion
          titulo={`Eliminar la lista «${borrando.nombre}»`}
          textoConfirmar="Eliminar lista"
          textoEnviando="Eliminando…"
          peligroso
          alCerrar={() => setBorrando(null)}
          alConfirmar={async () => {
            await pedir<void>(`/api/configuracion/festivos/${encodeURIComponent(borrando.id)}`, { metodo: 'DELETE' });
            avisar(`Lista «${borrando.nombre}» eliminada.`);
            setBorrando(null);
            releer();
          }}
        >
          <p>Se eliminará «{borrando.nombre}». Los calendarios que ya la copiaron conservan sus fechas.</p>
        </Confirmacion>
      ) : null}
    </Seccion>
  );
}

interface FilaDeFestivo { clave: number; fecha: string; nombre: string }

function FormularioDeLista({ id, alCerrar, alGuardar }: { id: string | null; alCerrar: () => void; alGuardar: (l: ListaPropia, nueva: boolean) => void }) {
  const [cargada, setCargada] = useState<ListaPropia | null>(null);
  const [nombre, setNombre] = useState('');
  const [filas, setFilas] = useState<FilaDeFestivo[]>([]);
  const [siguiente, setSiguiente] = useState(1);
  const [original, setOriginal] = useState('[]');
  const [errores, setErrores] = useState<{ nombre?: string; fechas?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!id) return;
    pedir<ListaPropia>(`/api/configuracion/festivos/${encodeURIComponent(id)}`)
      .then((l) => {
        setCargada(l);
        setNombre(l.nombre);
        const fs = l.fechas.map((f, i) => ({ clave: i + 1, fecha: f.fecha, nombre: f.nombre ?? '' }));
        setFilas(fs);
        setSiguiente(fs.length + 1);
        setOriginal(JSON.stringify([l.nombre, fs.map((f) => [f.fecha, f.nombre])]));
      })
      .catch((e: unknown) => setError(mensajeDe(e, 'No se pudo leer la lista.')));
  }, [id]);

  const huella = JSON.stringify([nombre, filas.map((f) => [f.fecha, f.nombre])]);
  const hayCambios = id ? huella !== original : nombre !== '' || filas.length > 0;

  async function enviar() {
    if (enviando) return;
    const faltan: typeof errores = {};
    if (nombre.trim() === '') faltan.nombre = 'Escriba el nombre de la lista.';
    const vistas = new Set<string>();
    for (const f of filas) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.fecha)) { faltan.fechas = 'Hay una fila sin fecha: llénela o quítela.'; break; }
      if (vistas.has(f.fecha)) { faltan.fechas = `La fecha ${fechaConDia(f.fecha)} está dos veces.`; break; }
      vistas.add(f.fecha);
    }
    setErrores(faltan);
    if (faltan.nombre || faltan.fechas) return;
    setEnviando(true);
    setError(null);
    const cuerpo = { nombre: nombre.trim(), fechas: [...filas].sort((a, b) => (a.fecha < b.fecha ? -1 : 1)).map((f) => ({ fecha: f.fecha, nombre: f.nombre.trim() === '' ? null : f.nombre.trim() })) };
    try {
      const l = id
        ? await pedir<ListaPropia>(`/api/configuracion/festivos/${encodeURIComponent(id)}`, { metodo: 'PUT', cuerpo })
        : await pedir<ListaPropia>('/api/configuracion/festivos', { metodo: 'POST', cuerpo });
      alGuardar(l, id === null);
    } catch (e) {
      setEnviando(false);
      if (e instanceof ErrorDeApi && (e.campo === 'nombre' || e.campo === 'fechas')) setErrores({ [e.campo]: e.message });
      else setError(mensajeDe(e, 'No se guardó la lista. Intente de nuevo.'));
    }
  }

  return (
    <Capa
      titulo={id ? `Editar la lista «${cargada?.nombre ?? '…'}»` : 'Crear lista de festivos'}
      alCerrar={alCerrar}
      hayCambios={hayCambios}
      error={error}
      alEnviar={() => void enviar()}
      acciones={(cerrar) => (
        <>
          <button type="button" className="boton boton-secundario" onClick={cerrar} disabled={enviando}>Cancelar</button>
          <button type="submit" className="boton boton-principal" disabled={enviando || (id !== null && cargada === null)}>{enviando ? 'Guardando…' : id ? 'Guardar lista' : 'Crear lista'}</button>
        </>
      )}
    >
      <Campo etiqueta="Nombre de la lista" error={errores.nombre}>
        {(a) => <input {...a} autoComplete="off" value={nombre} onChange={(e) => { setNombre(e.target.value); if (errores.nombre) setErrores((x) => ({ ...x, nombre: '' })); }} />}
      </Campo>
      <fieldset className="campo lista-de-fechas">
        <legend className="etiqueta">Fechas</legend>
        {filas.length === 0 ? <p className="dato-de-apoyo">Todavía no hay fechas. Agregue una por cada día que la empresa no trabaja.</p> : (
          <div className="fila-de-fecha fila-de-fecha-titulos" aria-hidden="true">
            <span>Fecha</span>
            <span>Nombre (opcional)</span>
          </div>
        )}
        {filas.map((f, i) => (
          <div key={f.clave} className="fila-de-fecha">
            <input type="date" aria-label={`Fecha ${i + 1}`} value={f.fecha} onChange={(e) => setFilas((fs) => fs.map((x) => (x.clave === f.clave ? { ...x, fecha: e.target.value } : x)))} />
            <input aria-label={`Nombre de la fecha ${i + 1} (opcional)`} autoComplete="off" value={f.nombre} onChange={(e) => setFilas((fs) => fs.map((x) => (x.clave === f.clave ? { ...x, nombre: e.target.value } : x)))} />
            <button type="button" className="boton-icono" aria-label={`Quitar la fecha ${i + 1}`} onClick={() => setFilas((fs) => fs.filter((x) => x.clave !== f.clave))}>
              <Icono nombre="cerrar" />
            </button>
          </div>
        ))}
        {errores.fechas ? <p className="campo-error" role="alert">{errores.fechas}</p> : null}
        <div>
          <button type="button" className="boton boton-secundario boton-chico-texto" onClick={() => { setFilas((fs) => [...fs, { clave: siguiente, fecha: '', nombre: '' }]); setSiguiente((n) => n + 1); if (errores.fechas) setErrores((x) => ({ ...x, fechas: '' })); }}>
            <Icono nombre="mas" tamano={16} />
            Agregar fecha
          </button>
        </div>
      </fieldset>
    </Capa>
  );
}

function ImportarFestivos({ alCerrar, alImportar }: { alCerrar: () => void; alImportar: (l: ListaPropia) => void }) {
  const [nombre, setNombre] = useState('');
  const [errorDelNombre, setErrorDelNombre] = useState<string | null>(null);
  return (
    <ImportarExcel<ListaPropia>
      titulo="Importar una lista de festivos"
      que="festivos"
      rutaPlantilla="/api/configuracion/festivos/plantilla"
      textoPlantilla="Trae las instrucciones en la primera hoja y la hoja Festivos con dos columnas: Fecha y Nombre."
      rutaImportar={() => {
        if (nombre.trim() === '') {
          setErrorDelNombre('Escriba el nombre que llevará la lista.');
          return null;
        }
        return `/api/configuracion/festivos/importar?nombre=${encodeURIComponent(nombre.trim())}`;
      }}
      alErrorDeCampo={(e) => {
        if (e.campo !== 'nombre') return false;
        setErrorDelNombre(e.message);
        return true;
      }}
      extra={
        <Campo etiqueta="Nombre de la lista" error={errorDelNombre}>
          {(a) => <input {...a} autoComplete="off" value={nombre} onChange={(e) => { setNombre(e.target.value); setErrorDelNombre(null); }} />}
        </Campo>
      }
      instrucciones={<>Una fila por fecha. La fecha como fecha de Excel o como texto AAAA-MM-DD; el nombre es opcional. Una fecha repetida es un error.</>}
      alCerrar={alCerrar}
      alImportar={alImportar}
    />
  );
}
