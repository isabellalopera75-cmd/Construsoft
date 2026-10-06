import { useEffect, useState } from 'react';
import { ErrorDeApi, pedir } from '../../api/cliente.ts';
import type { CabeceraDeMesa, Clasificacion, Duplicacion, ModoEstructura, NodoDeMesa } from '../../api/tipos.ts';
import { Campo } from '../../componentes/Campo.tsx';
import { Capa } from '../../componentes/Capa.tsx';
import { formatearNumero } from '../../formato.ts';
import { useSesion } from '../../sesion.tsx';

/*
 * Las capas de la mesa que piden datos: capítulo, subnivel, renombrar,
 * los datos del presupuesto y duplicar. Las que solo confirman usan
 * Confirmacion, en Mesa.tsx.
 */

// --- Capítulo, subnivel y renombrar (02 §8.2 y §8.4) ----------------------------

export type FormaDeNodo =
  | { tipo: 'capitulo' }
  | { tipo: 'subnivel'; padre: NodoDeMesa }
  | { tipo: 'editar'; nodo: NodoDeMesa };

export function FormularioDeNodo({
  forma,
  alGuardar,
  alCerrar,
}: {
  forma: FormaDeNodo;
  /** Devuelve una promesa; un ErrorDeApi con campo marca el campo. */
  alGuardar: (datos: { nombre: string; clasificacion: Clasificacion | null }) => Promise<void>;
  alCerrar: () => void;
}) {
  const nodo = forma.tipo === 'editar' ? forma.nodo : null;
  const conClasificacion = forma.tipo === 'capitulo' || (nodo !== null && nodo.padreId === null);
  const [nombre, setNombre] = useState(nodo?.nombre ?? '');
  // 02 §8.4: al crear un capítulo no viene marcada ninguna. El usuario decide.
  const [clasificacion, setClasificacion] = useState<Clasificacion | ''>(nodo?.clasificacion ?? '');
  const [errores, setErrores] = useState<{ nombre?: string | undefined; clasificacion?: string | undefined }>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const titulo =
    forma.tipo === 'capitulo'
      ? 'Agregar capítulo'
      : forma.tipo === 'subnivel'
        ? `Agregar subcapítulo en ${forma.padre.codigoWbs} ${forma.padre.nombre}`
        : conClasificacion
          ? `Capítulo ${forma.nodo.codigoWbs}`
          : `Renombrar ${forma.nodo.codigoWbs}`;
  const hayCambios = nombre !== (nodo?.nombre ?? '') || clasificacion !== (nodo?.clasificacion ?? '');

  async function enviar() {
    if (enviando) return;
    const faltan: typeof errores = {};
    if (nombre.trim() === '') faltan.nombre = 'Escriba el nombre.';
    if (conClasificacion && clasificacion === '') faltan.clasificacion = 'Elija si el capítulo es de costo directo o indirecto.';
    setErrores(faltan);
    if (faltan.nombre || faltan.clasificacion) return;
    setEnviando(true);
    setError(null);
    try {
      await alGuardar({ nombre: nombre.trim(), clasificacion: conClasificacion ? (clasificacion as Clasificacion) : null });
    } catch (e) {
      setEnviando(false);
      if (e instanceof ErrorDeApi && (e.campo === 'nombre' || e.campo === 'clasificacion')) setErrores({ [e.campo]: e.message });
      else setError(e instanceof ErrorDeApi ? e.message : 'No se guardó. Intente de nuevo.');
    }
  }

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
          <button type="submit" className="boton boton-principal" disabled={enviando}>
            {enviando ? 'Guardando…' : forma.tipo === 'editar' ? 'Guardar' : forma.tipo === 'capitulo' ? 'Agregar capítulo' : 'Agregar subcapítulo'}
          </button>
        </>
      )}
    >
      <Campo etiqueta={forma.tipo === 'subnivel' ? 'Nombre del subcapítulo' : 'Nombre del capítulo'} error={errores.nombre}>
        {(a) => (
          <input {...a} autoComplete="off" value={nombre} onChange={(e) => {
            setNombre(e.target.value);
            if (errores.nombre) setErrores((x) => ({ ...x, nombre: undefined }));
          }} />
        )}
      </Campo>
      {conClasificacion ? (
        <fieldset className="campo grupo-de-opciones" data-con-error={errores.clasificacion ? 'si' : undefined}>
          <legend className="etiqueta">Naturaleza del capítulo</legend>
          <label className="opcion">
            <input type="radio" name="clasificacion" checked={clasificacion === 'DIRECTO'} onChange={() => setClasificacion('DIRECTO')} />
            <span>
              <span className="opcion-titulo">Costo directo</span>
              <span className="opcion-detalle">Obra física: cimentación, estructura, mampostería, instalaciones, acabados. Es la base del AIU.</span>
            </span>
          </label>
          <label className="opcion">
            <input type="radio" name="clasificacion" checked={clasificacion === 'INDIRECTO'} onChange={() => setClasificacion('INDIRECTO')} />
            <span>
              <span className="opcion-titulo">Costo indirecto</span>
              <span className="opcion-detalle">Lo que no es obra física: topografía, estudios, dirección de obra, pólizas, campamento. Entra en el total pero no en la base del AIU.</span>
            </span>
          </label>
          <p className="campo-ayuda">
            Los subcapítulos y actividades la heredan. Si un capítulo mezcla las dos naturalezas, créelos por separado.
          </p>
          {errores.clasificacion ? <p className="campo-error" role="alert">{errores.clasificacion}</p> : null}
        </fieldset>
      ) : null}
    </Capa>
  );
}

// --- Los datos del presupuesto (cabecera y estructura) ---------------------------

export function EditarDatos({
  cabecera,
  tieneSubniveles,
  alGuardar,
  alCerrar,
}: {
  cabecera: CabeceraDeMesa;
  tieneSubniveles: boolean;
  alGuardar: (datos: { codigo: string; nombre: string; ubicacion: string }, modo: ModoEstructura | null) => Promise<void>;
  alCerrar: () => void;
}) {
  const [datos, setDatos] = useState({ codigo: cabecera.codigo, nombre: cabecera.nombre, ubicacion: cabecera.ubicacion });
  const [modo, setModo] = useState<ModoEstructura>(cabecera.modoEstructura);
  const [errores, setErrores] = useState<Partial<Record<'codigo' | 'nombre' | 'ubicacion' | 'modoEstructura', string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const hayCambios =
    datos.codigo !== cabecera.codigo || datos.nombre !== cabecera.nombre || datos.ubicacion !== cabecera.ubicacion || modo !== cabecera.modoEstructura;

  async function enviar() {
    if (enviando) return;
    const faltan: typeof errores = {};
    if (datos.codigo.trim() === '') faltan.codigo = 'Escriba el código del proyecto.';
    if (datos.nombre.trim() === '') faltan.nombre = 'Escriba el nombre del proyecto.';
    if (datos.ubicacion.trim() === '') faltan.ubicacion = 'Escriba la ubicación.';
    setErrores(faltan);
    if (Object.values(faltan).some(Boolean)) return;
    setEnviando(true);
    setError(null);
    try {
      await alGuardar(
        { codigo: datos.codigo.trim(), nombre: datos.nombre.trim(), ubicacion: datos.ubicacion.trim() },
        modo !== cabecera.modoEstructura ? modo : null,
      );
    } catch (e) {
      setEnviando(false);
      if (e instanceof ErrorDeApi && e.campo && ['codigo', 'nombre', 'ubicacion', 'modoEstructura'].includes(e.campo)) {
        setErrores({ [e.campo]: e.message });
      } else setError(e instanceof ErrorDeApi ? e.message : 'No se guardaron los datos. Intente de nuevo.');
    }
  }

  const cambiar = (campo: keyof typeof datos, valor: string) => {
    setDatos((d) => ({ ...d, [campo]: valor }));
    if (errores[campo]) setErrores((x) => ({ ...x, [campo]: undefined }));
  };

  return (
    <Capa
      titulo="Datos del proyecto"
      alCerrar={alCerrar}
      hayCambios={hayCambios}
      error={error}
      alEnviar={() => void enviar()}
      acciones={(cerrar) => (
        <>
          <button type="button" className="boton boton-secundario" onClick={cerrar} disabled={enviando}>Cancelar</button>
          <button type="submit" className="boton boton-principal" disabled={enviando}>{enviando ? 'Guardando…' : 'Guardar datos'}</button>
        </>
      )}
    >
      <Campo etiqueta="Código del proyecto" error={errores.codigo}>
        {(a) => <input {...a} autoComplete="off" spellCheck={false} value={datos.codigo} onChange={(e) => cambiar('codigo', e.target.value)} />}
      </Campo>
      <Campo etiqueta="Nombre del proyecto" error={errores.nombre}>
        {(a) => <input {...a} autoComplete="off" value={datos.nombre} onChange={(e) => cambiar('nombre', e.target.value)} />}
      </Campo>
      <Campo etiqueta="Ubicación" error={errores.ubicacion}>
        {(a) => <input {...a} autoComplete="off" value={datos.ubicacion} onChange={(e) => cambiar('ubicacion', e.target.value)} />}
      </Campo>
      <fieldset className="campo grupo-de-opciones">
        <legend className="etiqueta">Estructura</legend>
        <label className="opcion">
          <input type="radio" name="modo" checked={modo === 'ITEMS'} disabled={tieneSubniveles && cabecera.modoEstructura === 'WBS'} onChange={() => setModo('ITEMS')} />
          <span>
            <span className="opcion-titulo">Por ítems</span>
            <span className="opcion-detalle">
              {tieneSubniveles && cabecera.modoEstructura === 'WBS'
                ? 'No disponible: el proyecto ya tiene subcapítulos.'
                : 'Capítulo → actividad'}
            </span>
          </span>
        </label>
        <label className="opcion">
          <input type="radio" name="modo" checked={modo === 'WBS'} onChange={() => setModo('WBS')} />
          <span>
            <span className="opcion-titulo">Por EDT</span>
            <span className="opcion-detalle">Capítulo → subcapítulo → actividad</span>
          </span>
        </label>
        {errores.modoEstructura ? <p className="campo-error" role="alert">{errores.modoEstructura}</p> : null}
      </fieldset>
    </Capa>
  );
}

// --- Duplicar (02 §9.4) ------------------------------------------------------------

export function Duplicar({
  cabecera,
  alDuplicar,
  alCerrar,
}: {
  cabecera: CabeceraDeMesa;
  alDuplicar: (id: string) => void;
  alCerrar: () => void;
}) {
  const { arranque } = useSesion();
  const formato = arranque.formatoNumerico;
  const [info, setInfo] = useState<Duplicacion | null>(null);
  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState(cabecera.nombre);
  const [actualizar, setActualizar] = useState(true);
  const [errores, setErrores] = useState<{ codigo?: string | undefined; nombre?: string | undefined }>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    pedir<Duplicacion>(`/api/presupuestos/${encodeURIComponent(cabecera.id)}/duplicacion`)
      .then(setInfo)
      .catch((e: unknown) => setError(e instanceof ErrorDeApi ? e.message : 'No se pudo preparar la duplicación.'));
  }, [cabecera.id]);

  const desactualizados = info?.apusDesactualizados ?? [];

  async function enviar() {
    if (enviando || !info) return;
    const faltan: typeof errores = {};
    if (codigo.trim() === '') faltan.codigo = 'Escriba el código del proyecto nuevo.';
    if (nombre.trim() === '') faltan.nombre = 'Escriba el nombre del proyecto.';
    setErrores(faltan);
    if (faltan.codigo || faltan.nombre) return;
    setEnviando(true);
    setError(null);
    try {
      const { id } = await pedir<{ id: string }>(`/api/presupuestos/${encodeURIComponent(cabecera.id)}/duplicar`, {
        metodo: 'POST',
        cuerpo: { codigo: codigo.trim(), nombre: nombre.trim(), actualizarApu: desactualizados.length > 0 && actualizar },
      });
      alDuplicar(id);
    } catch (e) {
      setEnviando(false);
      if (e instanceof ErrorDeApi && (e.campo === 'codigo' || e.campo === 'nombre')) setErrores({ [e.campo]: e.message });
      else setError(e instanceof ErrorDeApi ? e.message : 'No se duplicó el proyecto. Intente de nuevo.');
    }
  }

  return (
    <Capa
      titulo={`Duplicar ${cabecera.codigo}`}
      alCerrar={alCerrar}
      hayCambios={codigo !== ''}
      error={error}
      alEnviar={() => void enviar()}
      acciones={(cerrar) => (
        <>
          <button type="button" className="boton boton-secundario" onClick={cerrar} disabled={enviando}>Cancelar</button>
          <button type="submit" className="boton boton-principal" disabled={enviando || !info}>
            {enviando ? 'Duplicando…' : 'Duplicar Proyecto'}
          </button>
        </>
      )}
    >
      <p className="texto-de-dialogo">
        La copia nace Abierta, con toda la estructura, las cantidades y los cuatro porcentajes del original.
      </p>
      <Campo etiqueta="Código del proyecto nuevo" error={errores.codigo}>
        {(a) => <input {...a} autoComplete="off" spellCheck={false} value={codigo} onChange={(e) => {
          setCodigo(e.target.value);
          if (errores.codigo) setErrores((x) => ({ ...x, codigo: undefined }));
        }} />}
      </Campo>
      <Campo etiqueta="Nombre del proyecto nuevo" error={errores.nombre}>
        {(a) => <input {...a} autoComplete="off" value={nombre} onChange={(e) => {
          setNombre(e.target.value);
          if (errores.nombre) setErrores((x) => ({ ...x, nombre: undefined }));
        }} />}
      </Campo>

      {info === null && !error ? <p className="campo-ayuda">Revisando los precios de los APU…</p> : null}
      {info && desactualizados.length === 0 ? (
        <p className="campo-ayuda">Todos los APU de este proyecto están en su versión vigente: la copia sale con los precios de hoy.</p>
      ) : null}
      {info && desactualizados.length > 0 ? (
        <div className="bloque-de-composicion">
          <p className="bloque-de-precio-titulo">
            {desactualizados.length === 1 ? 'Un APU tiene' : `${desactualizados.length} APU tienen`} un precio distinto al de hoy
          </p>
          <div className="tabla-con-desplazamiento">
            <table className="tabla">
              <caption className="solo-lectores">APU desactualizados</caption>
              <thead>
                <tr>
                  <th scope="col">APU</th>
                  <th scope="col" className="cifra">En el original</th>
                  <th scope="col" className="cifra">Hoy</th>
                </tr>
              </thead>
              <tbody>
                {desactualizados.map((d) => (
                  <tr key={d.itemId}>
                    <td><span className="cifra-codigo">{d.codigo}</span> {d.descripcion}</td>
                    <td className="cifra">{formatearNumero(d.precioEnElPresupuesto, formato)}</td>
                    <td className="cifra">{formatearNumero(d.precioVigente, formato)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="casilla">
            <input type="checkbox" checked={actualizar} onChange={(e) => setActualizar(e.target.checked)} />
            <span>Actualizar la copia a los precios de hoy</span>
          </label>
          <dl className="desglose desglose-compacto">
            <div><dt>Valor total con los precios del original</dt><dd className="cifra">{formatearNumero(info.valorTotalActual, formato)}</dd></div>
            <div className="desglose-fuerte"><dt>Valor total con los precios de hoy</dt><dd className="cifra">{formatearNumero(info.valorTotalConApuVigentes, formato)}</dd></div>
          </dl>
        </div>
      ) : null}
    </Capa>
  );
}
