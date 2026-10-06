import { useEffect, useState } from 'react';
import { conConsulta, ErrorDeApi, pedir } from '../../api/cliente.ts';
import type { Apu, DatosDeApu, LineaDeApu, PresupuestoVinculado, Recurso, Unidad } from '../../api/tipos.ts';
import { Buscador } from '../../componentes/Buscador.tsx';
import { Campo } from '../../componentes/Campo.tsx';
import { Capa } from '../../componentes/Capa.tsx';
import { Confirmacion } from '../../componentes/Confirmacion.tsx';
import { Icono } from '../../componentes/Icono.tsx';
import { aTexto, factorDePorcentaje, leer, multiplicar, sumar } from '../../decimal.ts';
import { leerCifra, paraEditar } from '../../entrada.ts';
import { formatearNumero } from '../../formato.ts';
import { useSesion } from '../../sesion.tsx';
import { ElegirPresupuestos } from '../comun/ElegirPresupuestos.tsx';
import { FormularioDeRecurso, NOMBRES_DE_TIPO } from '../recursos/FormularioDeRecurso.tsx';

/*
 * 02 §6.2 y §6.3 · Crear, consultar y editar un APU. Una sola capa: al abrir
 * un APU de la lista se CONSULTA, y «Editar» la transforma en edición sin
 * cambiar de ventana.
 *
 * El costo directo que se ve mientras se arma la composición es una VISTA
 * PREVIA (02 §2): se calcula con aritmética exacta (decimal.ts) y no se envía.
 * Lo que vale es lo que guarda el servidor, que lo recalcula por su cuenta.
 *
 * Cantidad y rendimiento son el error más caro del módulo (02 §6.2, caja de
 * riesgo): si se entienden como lo mismo, el consumo se multiplica dos veces y
 * nada avisa. Por eso cada uno lleva su explicación pegada al encabezado, y los
 * dos nacen en 1.
 */

interface LineaEnEdicion {
  recursoId: string;
  codigo: string;
  nombre: string;
  tipo: Recurso['tipo'];
  unidadSimbolo: string;
  precioUnitario: string;
  cantidad: string;
  rendimiento: string;
  desperdicio: string;
}

interface Props {
  /** Sin id, crea. */
  apuId?: string | undefined;
  /** Al crear desde la mesa: el nombre que se buscaba. */
  nombreInicial?: string | undefined;
  alCerrar: () => void;
  /** Guardado (creado o editado). */
  alGuardar: (apu: Apu, aviso: string) => void;
  /** Activado, desactivado o eliminado: la lista tiene que releerse. */
  alCambiar?: (aviso: string) => void;
}

export function FormularioDeApu({ apuId, nombreInicial, alCerrar, alGuardar, alCambiar }: Props) {
  const { arranque, puedeEscribir } = useSesion();
  const formato = arranque.formatoNumerico;
  const [apu, setApu] = useState<Apu | null>(null);
  const [modo, setModo] = useState<'consulta' | 'edicion'>(apuId ? 'consulta' : 'edicion');
  const [unidades, setUnidades] = useState<Unidad[] | null>(null);
  const [nombre, setNombre] = useState(nombreInicial ?? '');
  const [unidadId, setUnidadId] = useState('');
  const [lineas, setLineas] = useState<LineaEnEdicion[]>([]);
  const [original, setOriginal] = useState('');
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [creandoRecurso, setCreandoRecurso] = useState<string | null>(null);
  const [preguntando, setPreguntando] = useState<{ presupuestos: PresupuestoVinculado[]; cuerpo: DatosDeApu } | null>(null);
  const [eliminando, setEliminando] = useState(false);
  const [bloqueoDeBorrado, setBloqueoDeBorrado] = useState<string | null>(null);

  useEffect(() => {
    if (!apuId) return;
    pedir<Apu>(`/api/apus/${encodeURIComponent(apuId)}`)
      .then(cargar)
      .catch((e: unknown) => setError(e instanceof ErrorDeApi ? e.message : 'No se pudo leer el APU.'));
  }, [apuId]);

  useEffect(() => {
    if (modo !== 'edicion' || unidades !== null) return;
    pedir<{ unidades: Unidad[] }>(conConsulta('/api/unidades', { para: 'APU' }))
      .then((r) => setUnidades(r.unidades))
      .catch((e: unknown) => setError(e instanceof ErrorDeApi ? e.message : 'No se pudieron leer las unidades de medida.'));
  }, [modo, unidades]);

  function cargar(leido: Apu) {
    setApu(leido);
    setNombre(leido.nombre);
    setUnidadId(leido.unidadId);
    const enEdicion = leido.lineas.map((l) => desdeLinea(l));
    setLineas(enEdicion);
    setOriginal(huella(leido.nombre, leido.unidadId, enEdicion));
  }

  function desdeLinea(l: LineaDeApu): LineaEnEdicion {
    return {
      recursoId: l.recursoId,
      codigo: l.recursoCodigo,
      nombre: l.recursoNombre,
      tipo: l.recursoTipo,
      unidadSimbolo: l.unidadSimbolo,
      precioUnitario: l.precioUnitario,
      cantidad: paraEditar(l.cantidad, formato),
      rendimiento: paraEditar(l.rendimiento, formato),
      desperdicio: /^0(\.0+)?$/.test(l.desperdicioPct) ? '' : paraEditar(l.desperdicioPct, formato),
    };
  }

  function vincular(r: Recurso) {
    setLineas((ls) => [
      ...ls,
      {
        recursoId: r.id,
        codigo: r.codigo,
        nombre: r.nombre,
        tipo: r.tipo,
        unidadSimbolo: r.unidadSimbolo,
        // El subtotal usa el precio TOTAL del recurso, con IVA (02 §6.2).
        precioUnitario: r.precioTotal,
        cantidad: '1',
        rendimiento: '1',
        desperdicio: '',
      },
    ]);
    if (errores['lineas']) setErrores((e) => ({ ...e, lineas: '' }));
  }

  function cambiarLinea(i: number, campo: 'cantidad' | 'rendimiento' | 'desperdicio', valor: string) {
    setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, [campo]: valor } : l)));
    const clave = `lineas.${i}.${campo === 'desperdicio' ? 'desperdicioPct' : campo}`;
    if (errores[clave]) setErrores((e) => ({ ...e, [clave]: '' }));
  }

  /** Subtotal en vista previa, o null si la línea todavía no tiene cifras válidas. */
  function subtotal(l: LineaEnEdicion): string | null {
    const c = leerCifra(l.cantidad, { nombre: 'la cantidad', permitirCero: false });
    const r = leerCifra(l.rendimiento, { nombre: 'el rendimiento', permitirCero: false });
    const d = l.tipo === 'MATERIAL' && l.desperdicio.trim() !== '' ? leerCifra(l.desperdicio, { nombre: 'el desperdicio' }) : { valor: '0' };
    if (!('valor' in c) || !('valor' in r) || !('valor' in d)) return null;
    return aTexto(multiplicar(multiplicar(multiplicar(leer(c.valor), leer(r.valor)), factorDePorcentaje(leer(d.valor))), leer(l.precioUnitario)));
  }

  const subtotales = lineas.map(subtotal);
  const costoPrevio = subtotales.every((s) => s !== null) && lineas.length > 0
    ? aTexto(subtotales.reduce((acc, s) => sumar(acc, leer(s ?? '0')), leer('0')))
    : null;

  const hayCambios = modo === 'edicion' && huella(nombre, unidadId, lineas) !== (apuId ? original : huella('', '', []));

  function validar(): DatosDeApu | null {
    const faltan: Record<string, string> = {};
    if (nombre.trim() === '') faltan['nombre'] = 'Escriba el nombre de la actividad.';
    if (unidadId === '') faltan['unidadId'] = 'Elija la unidad de medida.';
    if (lineas.length === 0) faltan['lineas'] = 'Agregue al menos un recurso: un APU sin composición no tiene costo y no puede entrar en un presupuesto.';
    const cuerpoLineas = lineas.map((l, i) => {
      const c = leerCifra(l.cantidad, { nombre: 'la cantidad', permitirCero: false });
      const r = leerCifra(l.rendimiento, { nombre: 'el rendimiento', permitirCero: false });
      if ('error' in c) faltan[`lineas.${i}.cantidad`] = c.error;
      if ('error' in r) faltan[`lineas.${i}.rendimiento`] = r.error;
      let desperdicioPct: string | undefined;
      if (l.tipo === 'MATERIAL' && l.desperdicio.trim() !== '') {
        const d = leerCifra(l.desperdicio, { nombre: 'el desperdicio' });
        if ('error' in d) faltan[`lineas.${i}.desperdicioPct`] = d.error;
        else desperdicioPct = d.valor;
      }
      return {
        recursoId: l.recursoId,
        cantidad: 'valor' in c ? c.valor : '',
        rendimiento: 'valor' in r ? r.valor : '',
        ...(desperdicioPct === undefined ? {} : { desperdicioPct }),
      };
    });
    setErrores(faltan);
    if (Object.values(faltan).some(Boolean)) return null;
    return { nombre: nombre.trim(), unidadId, lineas: cuerpoLineas };
  }

  async function enviar() {
    if (enviando || modo !== 'edicion') return;
    setError(null);
    const cuerpo = validar();
    if (!cuerpo) return;
    setEnviando(true);
    try {
      if (!apuId) {
        const creado = await pedir<Apu>('/api/apus', { metodo: 'POST', cuerpo });
        alGuardar(creado, `${creado.codigo} creado.`);
        return;
      }
      // 02 §6.4: si el APU está en presupuestos ABIERTOS, se suspende y se pregunta.
      const { presupuestos } = await pedir<{ presupuestos: PresupuestoVinculado[] }>(
        `/api/apus/${encodeURIComponent(apuId)}/presupuestos`,
      );
      const abiertos = presupuestos.filter((p) => p.estado === 'ABIERTO');
      if (abiertos.length > 0) {
        setPreguntando({ presupuestos: abiertos, cuerpo });
        setEnviando(false);
        return;
      }
      await guardarEdicion(cuerpo, []);
    } catch (e) {
      tratarError(e);
    }
  }

  async function guardarEdicion(cuerpo: DatosDeApu, reapuntar: string[]) {
    if (!apuId) return;
    setEnviando(true);
    try {
      const r = await pedir<{ apu: Apu; itemsReapuntados: number }>(`/api/apus/${encodeURIComponent(apuId)}`, {
        metodo: 'PUT',
        cuerpo: { ...cuerpo, presupuestosAReapuntar: reapuntar },
      });
      const n = reapuntar.length;
      alGuardar(
        r.apu,
        n > 0
          ? `${r.apu.codigo} guardado y actualizado en ${n} ${n === 1 ? 'presupuesto' : 'presupuestos'}.`
          : `${r.apu.codigo} guardado.`,
      );
    } catch (e) {
      setPreguntando(null);
      tratarError(e);
    }
  }

  function tratarError(e: unknown) {
    setEnviando(false);
    if (e instanceof ErrorDeApi && e.campo && (e.campo === 'nombre' || e.campo === 'unidadId' || e.campo.startsWith('lineas'))) {
      setErrores({ [e.campo]: e.message });
    } else {
      setError(e instanceof ErrorDeApi ? e.message : 'Algo falló y no se guardó el APU. Intente de nuevo.');
    }
  }

  async function cambiarActivo(activo: boolean) {
    if (!apu) return;
    setEnviando(true);
    setError(null);
    try {
      await pedir(`/api/apus/${encodeURIComponent(apu.id)}`, { metodo: 'PATCH', cuerpo: { activo } });
      setApu({ ...apu, activo });
      setBloqueoDeBorrado(null);
      alCambiar?.(activo ? `${apu.codigo} activado.` : `${apu.codigo} marcado como inactivo: ya no se ofrece al armar presupuestos.`);
    } catch (e) {
      setError(e instanceof ErrorDeApi ? e.message : 'No se pudo cambiar el estado del APU.');
    } finally {
      setEnviando(false);
    }
  }

  const consulta = modo === 'consulta';
  const titulo = !apuId ? 'Crear Nuevo APU' : apu === null ? 'APU' : consulta ? `${apu.codigo} · ${apu.nombre}` : `Editar ${apu.codigo}`;
  const yaVinculados = new Set(lineas.map((l) => l.recursoId));

  return (
    <>
      <Capa
        titulo={titulo}
        alCerrar={alCerrar}
        hayCambios={hayCambios}
        error={error}
        alEnviar={() => void enviar()}
        acciones={(cerrar) =>
          consulta ? (
            <>
              {apu && puedeEscribir('APU.ELIMINAR') ? (
                <button type="button" className="boton boton-peligroso boton-aparte" onClick={() => setEliminando(true)} disabled={enviando}>
                  Eliminar APU
                </button>
              ) : null}
              {apu && puedeEscribir('APU.EDITAR') ? (
                <button type="button" className="boton boton-secundario" onClick={() => void cambiarActivo(!apu.activo)} disabled={enviando}>
                  {apu.activo ? 'Marcar como inactivo' : 'Activar'}
                </button>
              ) : null}
              <button type="button" className="boton boton-secundario" onClick={cerrar}>
                Cerrar
              </button>
              {apu && puedeEscribir('APU.EDITAR') ? (
                <button type="button" className="boton boton-principal" onClick={() => setModo('edicion')}>
                  Editar
                </button>
              ) : null}
            </>
          ) : (
            <>
              <button type="button" className="boton boton-secundario" onClick={cerrar} disabled={enviando}>
                Cancelar
              </button>
              <button type="submit" className="boton boton-principal" disabled={enviando || (apuId !== undefined && apu === null)}>
                {enviando ? 'Guardando…' : apuId ? 'Guardar APU' : 'Crear APU'}
              </button>
            </>
          )
        }
      >
        {apuId && apu === null && !error ? <p className="campo-ayuda">Cargando el APU…</p> : null}

        {bloqueoDeBorrado ? (
          <div className="aviso-error" role="alert">
            <Icono nombre="aviso" />
            <span>{bloqueoDeBorrado}</span>
            {apu?.activo && puedeEscribir('APU.EDITAR') ? (
              <button type="button" className="boton boton-secundario" onClick={() => void cambiarActivo(false)}>
                Marcar como inactivo
              </button>
            ) : null}
          </div>
        ) : null}

        {consulta && apu ? (
          <div className="encabezado-de-capa">
            <div className="campo">
              <span className="etiqueta">Actividad</span>
              <p className="dato-estatico">{apu.nombre}</p>
            </div>
            <div className="campo">
              <span className="etiqueta">Unidad</span>
              <p className="dato-estatico">{apu.unidadSimbolo}</p>
            </div>
            <div className="campo">
              <span className="etiqueta">Estado</span>
              <p className="dato-estatico">
                <span className="insignia" data-estado={apu.activo ? 'ACTIVO' : 'CERRADO'}>{apu.activo ? 'Activo' : 'Inactivo'}</span>
              </p>
            </div>
          </div>
        ) : null}

        {!consulta && (!apuId || apu) ? (
          <div className="fila-de-campos fila-nombre-unidad">
            {apu ? (
              <div className="campo">
                <span className="etiqueta">Código</span>
                <p className="dato-fijo">{apu.codigo}</p>
              </div>
            ) : null}
            <Campo etiqueta="Nombre de la actividad" error={errores['nombre']}>
              {(a) => (
                <input {...a} autoComplete="off" value={nombre} onChange={(e) => {
                  setNombre(e.target.value);
                  if (errores['nombre']) setErrores((x) => ({ ...x, nombre: '' }));
                }} />
              )}
            </Campo>
            <Campo etiqueta="Unidad de medida" error={errores['unidadId']}>
              {(a) => (
                <select {...a} value={unidadId} disabled={unidades === null} onChange={(e) => {
                  setUnidadId(e.target.value);
                  if (errores['unidadId']) setErrores((x) => ({ ...x, unidadId: '' }));
                }}>
                  <option value="" disabled>{unidades === null ? 'Cargando…' : 'Elija la unidad'}</option>
                  {(unidades ?? []).map((u) => <option key={u.id} value={u.id}>{u.simbolo} · {u.descripcion}</option>)}
                </select>
              )}
            </Campo>
          </div>
        ) : null}

        {!consulta && (!apuId || apu) ? (
          <div className="bloque-de-composicion">
            <p className="bloque-de-precio-titulo">Composición: los recursos por cada unidad de obra</p>
            <Buscador<Recurso>
              etiqueta="Vincular un recurso por nombre o código"
              buscar={async (texto) => (await pedir<{ recursos: Recurso[] }>(conConsulta('/api/recursos', { texto }))).recursos}
              clave={(r) => r.id}
              deshabilitada={(r) => (yaVinculados.has(r.id) ? 'Ya está en la composición' : r.activo ? null : 'Inactivo')}
              pintar={(r) => (
                <span className="opcion-de-busqueda">
                  <span className="cifra-codigo">{r.codigo}</span>
                  <span className="opcion-de-busqueda-nombre">{r.nombre}</span>
                  <span className="dato-de-apoyo">{NOMBRES_DE_TIPO[r.tipo]} · {r.unidadSimbolo}</span>
                  <span className="cifra">{formatearNumero(r.precioTotal, formato)}</span>
                </span>
              )}
              alElegir={vincular}
              accionExtra={
                puedeEscribir('RECURSOS.CREAR')
                  ? { texto: (b) => `Crear el recurso «${b}»`, alElegir: (b) => setCreandoRecurso(b) }
                  : undefined
              }
            />
            {errores['lineas'] ? <p className="campo-error" role="alert">{errores['lineas']}</p> : null}
          </div>
        ) : null}

        {(consulta && apu) || !consulta ? (
          <TablaDeComposicion
            lineas={lineas}
            subtotales={consulta && apu ? apu.lineas.map((l) => l.subtotal) : subtotales}
            editable={!consulta}
            errores={errores}
            alCambiar={cambiarLinea}
            alQuitar={(i) => setLineas((ls) => ls.filter((_, j) => j !== i))}
          />
        ) : null}

        {(consulta && apu) || (!consulta && lineas.length > 0) ? (
          <div className="total-de-apu">
            <span>
              Costo directo por {consulta && apu ? apu.unidadSimbolo : unidades?.find((u) => u.id === unidadId)?.simbolo ?? 'unidad'}
              {!consulta ? <span className="dato-de-apoyo">Vista previa: la cifra que vale es la que guarda el servidor.</span> : null}
            </span>
            <span className="cifra cifra-grande">
              {consulta && apu ? formatearNumero(apu.costoDirecto, formato) : costoPrevio === null ? '—' : formatearNumero(costoPrevio, formato)}
            </span>
          </div>
        ) : null}
      </Capa>

      {creandoRecurso !== null ? (
        <FormularioDeRecurso
          nombreInicial={creandoRecurso}
          alCerrar={() => setCreandoRecurso(null)}
          alGuardar={(r) => {
            // 02 §6.2: el recurso nuevo se asigna de inmediato al APU, sin
            // perder lo que ya se había digitado.
            setCreandoRecurso(null);
            vincular(r);
          }}
        />
      ) : null}

      {preguntando ? (
        <ElegirPresupuestos
          titulo="APU en uso en presupuestos abiertos"
          pregunta="Este APU está en uso en presupuestos abiertos. ¿Desea actualizar su valor en dichos presupuestos?"
          explicacion="Los que no marque quedan exactamente como estaban. La versión nueva del APU queda vigente de todas formas para los proyectos futuros, y los presupuestos activos y cerrados no se tocan."
          presupuestos={preguntando.presupuestos}
          alResponder={(elegidos) => guardarEdicion(preguntando.cuerpo, elegidos)}
          alCerrar={() => setPreguntando(null)}
        />
      ) : null}

      {eliminando && apu ? (
        <Confirmacion
          titulo={`Eliminar el APU ${apu.codigo}`}
          textoConfirmar="Eliminar APU"
          textoEnviando="Eliminando…"
          peligroso
          alCerrar={() => setEliminando(false)}
          alConfirmar={async () => {
            try {
              await pedir<void>(`/api/apus/${encodeURIComponent(apu.id)}`, { metodo: 'DELETE' });
              alCambiar?.(`${apu.codigo} eliminado.`);
              alCerrar();
            } catch (e) {
              // En uso: el mensaje del servidor dice dónde y ofrece desactivarlo
              // (02 §6.5). Se muestra en la capa del APU, con el botón al lado.
              if (e instanceof ErrorDeApi && e.estado === 422) {
                setEliminando(false);
                setBloqueoDeBorrado(e.message);
                return;
              }
              throw e;
            }
          }}
        >
          <p>Se eliminará «{apu.nombre}» con todas sus versiones. Si alguna actividad de algún presupuesto lo usa, el sistema no lo permitirá.</p>
        </Confirmacion>
      ) : null}
    </>
  );
}

function huella(nombre: string, unidadId: string, lineas: LineaEnEdicion[]): string {
  return JSON.stringify([nombre, unidadId, lineas.map((l) => [l.recursoId, l.cantidad, l.rendimiento, l.desperdicio])]);
}

function TablaDeComposicion({
  lineas,
  subtotales,
  editable,
  errores,
  alCambiar,
  alQuitar,
}: {
  lineas: LineaEnEdicion[];
  subtotales: (string | null)[];
  editable: boolean;
  errores: Record<string, string>;
  alCambiar: (i: number, campo: 'cantidad' | 'rendimiento' | 'desperdicio', valor: string) => void;
  alQuitar: (i: number) => void;
}) {
  const { arranque } = useSesion();
  const formato = arranque.formatoNumerico;

  if (lineas.length === 0) {
    return (
      <div className="vacio vacio-compacto">
        <p>{editable ? 'Todavía no hay recursos en la composición. Búsquelos arriba por nombre o código.' : 'Este APU no tiene recursos.'}</p>
      </div>
    );
  }

  return (
    <div className="tabla-con-desplazamiento">
      <table className="tabla tabla-composicion">
        <caption className="solo-lectores">Composición del APU</caption>
        <thead>
          <tr>
            <th scope="col">Recurso</th>
            <th scope="col" className="cifra">Precio total</th>
            <th scope="col" className="cifra">
              Cantidad
              <span className="ayuda-de-columna">Cuántos intervienen a la vez: 2 oficiales, 1 mezcladora</span>
            </th>
            <th scope="col" className="cifra">
              Rendimiento
              <span className="ayuda-de-columna">Cuánto consume UNO por unidad de obra: 0,05 jornal/m³</span>
            </th>
            <th scope="col" className="cifra">
              Desp. %
              <span className="ayuda-de-columna">Solo materiales</span>
            </th>
            <th scope="col" className="cifra">Subtotal</th>
            {editable ? <th scope="col"><span className="solo-lectores">Quitar</span></th> : null}
          </tr>
        </thead>
        <tbody>
          {lineas.map((l, i) => {
            const sub = subtotales[i] ?? null;
            const errC = errores[`lineas.${i}.cantidad`];
            const errR = errores[`lineas.${i}.rendimiento`];
            const errD = errores[`lineas.${i}.desperdicioPct`];
            return (
              <tr key={l.recursoId}>
                <td>
                  <span className="cifra-codigo">{l.codigo}</span> {l.nombre}
                  <span className="dato-de-apoyo">{NOMBRES_DE_TIPO[l.tipo]} · por {l.unidadSimbolo}</span>
                </td>
                <td className="cifra">{formatearNumero(l.precioUnitario, formato)}</td>
                <td className="cifra">
                  {editable ? (
                    <CifraDeLinea etiqueta={`Cantidad de ${l.nombre}`} valor={l.cantidad} error={errC} alCambiar={(v) => alCambiar(i, 'cantidad', v)} />
                  ) : (
                    l.cantidad
                  )}
                </td>
                <td className="cifra">
                  {editable ? (
                    <CifraDeLinea etiqueta={`Rendimiento de ${l.nombre}`} valor={l.rendimiento} error={errR} alCambiar={(v) => alCambiar(i, 'rendimiento', v)} />
                  ) : (
                    l.rendimiento
                  )}
                </td>
                <td className="cifra">
                  {l.tipo !== 'MATERIAL' ? (
                    <span data-vacia="si" className="cifra" aria-label="No aplica">—</span>
                  ) : editable ? (
                    <CifraDeLinea etiqueta={`Desperdicio de ${l.nombre}, en porcentaje`} valor={l.desperdicio} error={errD} alCambiar={(v) => alCambiar(i, 'desperdicio', v)} />
                  ) : (
                    l.desperdicio || '0'
                  )}
                </td>
                <td className="cifra" data-vacia={sub === null ? 'si' : undefined}>
                  {sub === null ? '—' : formatearNumero(sub, formato)}
                </td>
                {editable ? (
                  <td>
                    <button type="button" className="boton-icono" aria-label={`Quitar ${l.nombre} de la composición`} onClick={() => alQuitar(i)}>
                      <Icono nombre="cerrar" />
                    </button>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CifraDeLinea({ etiqueta, valor, error, alCambiar }: { etiqueta: string; valor: string; error: string | undefined; alCambiar: (v: string) => void }) {
  return (
    <span className="cifra-de-linea">
      <input
        aria-label={etiqueta}
        inputMode="decimal"
        className="cifra-editable campo-compacto"
        value={valor}
        aria-invalid={Boolean(error)}
        onChange={(e) => alCambiar(e.target.value)}
      />
      {error ? <span className="campo-error" role="alert">{error}</span> : null}
    </span>
  );
}
