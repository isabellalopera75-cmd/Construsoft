import { useEffect, useState } from 'react';
import { ErrorDeApi, pedir } from '../../api/cliente.ts';
import type {
  DatosDeRecurso,
  PresupuestoVinculado,
  Recurso,
  TipoRecurso,
  Unidad,
  ViaCaptura,
} from '../../api/tipos.ts';
import { Campo } from '../../componentes/Campo.tsx';
import { Capa } from '../../componentes/Capa.tsx';
import { Confirmacion } from '../../componentes/Confirmacion.tsx';
import { baseDesdeTotal, totalDesdeBase } from '../../decimal.ts';
import { leerCifra, paraEditar, soloCifra } from '../../entrada.ts';
import { formatearNumero } from '../../formato.ts';
import { useSesion } from '../../sesion.tsx';
import { ElegirPresupuestos } from '../comun/ElegirPresupuestos.tsx';

/*
 * 02 §5.2 y §5.3 · Crear y editar un recurso. Crear y editar son el mismo
 * formulario, con otro título y otro botón (DISENO §8).
 *
 * LA DOBLE VÍA DE PRECIO. La persona escribe el precio que tiene —el base, sin
 * IVA, o el total, con IVA— y la pantalla calcula el otro y lo BLOQUEA. Si
 * borra lo escrito, los dos se desbloquean y puede elegir de nuevo. La vía se
 * guarda con el recurso (viaCaptura), y al editar se reproduce el mismo
 * bloqueo.
 *
 * El complementario es la única cifra que la interfaz calcula para enviar
 * (CONTRATO §5, RF-REC-09). Sale de decimal.ts, con aritmética exacta y el
 * mismo redondeo que exige ck_recurso_precios_cuadran: si no diera idéntico,
 * la base rechazaría el recurso.
 */

export const NOMBRES_DE_TIPO: Record<TipoRecurso, string> = {
  MATERIAL: 'Material',
  EQUIPO: 'Equipo',
  PERSONAL: 'Personal',
  ACTIVIDAD_TODO_COSTO: 'Actividad a todo costo',
};

/*
 * El IVA con el que nace un recurso nuevo (decisión del dueño, 6 de octubre de
 * 2026): 19 % en material y equipo, que es la tarifa general; vacío —0 %— en
 * personal y actividad a todo costo, porque un jornal no lleva IVA. Se puede
 * cambiar siempre. Mientras la persona no lo haya tocado, sigue al tipo.
 */
function ivaPorDefecto(tipo: TipoRecurso | ''): string {
  return tipo === 'MATERIAL' || tipo === 'EQUIPO' ? '19' : '';
}

type Campos = 'nombre' | 'tipo' | 'unidadId' | 'precioBase' | 'ivaPct' | 'precioTotal';

interface Props {
  /** Sin recurso, crea. */
  recurso?: Recurso | undefined;
  /** Al crear desde una pestaña, viene preseleccionado (02 §5.1). */
  tipoInicial?: TipoRecurso | undefined;
  /** Al crear desde un APU, el nombre que se buscaba. */
  nombreInicial?: string | undefined;
  alCerrar: () => void;
  alGuardar: (recurso: Recurso, aviso: string) => void;
  alEliminar?: (recurso: Recurso) => void;
}

export function FormularioDeRecurso({ recurso, tipoInicial, nombreInicial, alCerrar, alGuardar, alEliminar }: Props) {
  const { arranque, puedeEscribir } = useSesion();
  const formato = arranque.formatoNumerico;
  const editando = recurso !== undefined;
  const soloConsulta = editando && !puedeEscribir('RECURSOS.EDITAR');

  const inicial = {
    nombre: recurso?.nombre ?? nombreInicial ?? '',
    tipo: (recurso?.tipo ?? tipoInicial ?? '') as TipoRecurso | '',
    unidadId: recurso?.unidadId ?? '',
    // Al editar, el campo de la vía muestra lo capturado; el otro se calcula.
    precioBase: recurso ? paraEditar(recurso.precioBase, formato) : '',
    ivaPct: recurso
      ? /^0(\.0+)?$/.test(recurso.ivaPct) ? '' : paraEditar(recurso.ivaPct, formato)
      : ivaPorDefecto(tipoInicial ?? ''),
    precioTotal: recurso ? paraEditar(recurso.precioTotal, formato) : '',
  };
  const [datos, setDatos] = useState(inicial);
  const [via, setVia] = useState<ViaCaptura | null>(recurso?.viaCaptura ?? null);
  const [ivaTocado, setIvaTocado] = useState(editando);
  const [unidades, setUnidades] = useState<Unidad[] | null>(null);
  const [errores, setErrores] = useState<Partial<Record<Campos, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [preguntando, setPreguntando] = useState<{ presupuestos: PresupuestoVinculado[]; cuerpo: DatosDeRecurso } | null>(null);
  const [eliminando, setEliminando] = useState(false);

  useEffect(() => {
    pedir<{ unidades: Unidad[] }>('/api/unidades')
      .then((r) => setUnidades(r.unidades))
      .catch((e: unknown) => setError(e instanceof ErrorDeApi ? e.message : 'No se pudieron leer las unidades de medida.'));
  }, []);

  const hayCambios = (Object.keys(inicial) as (keyof typeof inicial)[]).some((k) => datos[k] !== inicial[k]);

  /** Recalcula el precio bloqueado a partir del capturado. */
  function complementar(nuevos: typeof datos, viaActual: ViaCaptura | null): typeof datos {
    if (viaActual === null) return nuevos;
    const iva = nuevos.ivaPct.trim() === '' ? { valor: '0' } : leerCifra(nuevos.ivaPct, { nombre: 'el IVA' });
    const origen = viaActual === 'BASE' ? nuevos.precioBase : nuevos.precioTotal;
    const precio = leerCifra(origen, { nombre: 'el precio' });
    if (!('valor' in iva) || !('valor' in precio)) {
      // Mientras lo escrito no sea una cifra, el bloqueado queda vacío: un
      // complementario de un número a medio escribir sería una cifra falsa.
      return viaActual === 'BASE' ? { ...nuevos, precioTotal: '' } : { ...nuevos, precioBase: '' };
    }
    const calculado =
      viaActual === 'BASE' ? totalDesdeBase(precio.valor, iva.valor) : baseDesdeTotal(precio.valor, iva.valor);
    const visible = paraEditar(calculado, formato);
    return viaActual === 'BASE' ? { ...nuevos, precioTotal: visible } : { ...nuevos, precioBase: visible };
  }

  function cambiar(campo: keyof typeof datos, valor: string) {
    let nuevaVia = via;
    if (campo === 'precioBase' || campo === 'precioTotal') {
      const esta: ViaCaptura = campo === 'precioBase' ? 'BASE' : 'TOTAL';
      if (valor.trim() === '') nuevaVia = null;
      else if (via === null) nuevaVia = esta;
    }
    let nuevos = { ...datos, [campo]: valor };
    if (campo === 'ivaPct') setIvaTocado(true);
    if (campo === 'tipo' && !ivaTocado) nuevos = { ...nuevos, ivaPct: ivaPorDefecto(valor as TipoRecurso) };
    if (nuevaVia === null && (campo === 'precioBase' || campo === 'precioTotal')) {
      // Borró lo escrito: los dos se desbloquean y quedan vacíos (02 §5.2).
      nuevos = { ...nuevos, precioBase: '', precioTotal: '' };
    }
    setVia(nuevaVia);
    setDatos(complementar(nuevos, nuevaVia));
    if (errores[campo as Campos]) setErrores((e) => ({ ...e, [campo]: undefined }));
  }

  function validar(): DatosDeRecurso | null {
    const faltan: Partial<Record<Campos, string>> = {};
    if (datos.nombre.trim() === '') faltan.nombre = 'Escriba el nombre del recurso.';
    if (datos.tipo === '') faltan.tipo = 'Elija el tipo de recurso.';
    if (datos.unidadId === '') faltan.unidadId = 'Elija la unidad de medida.';
    let iva = '0';
    if (datos.ivaPct.trim() !== '') {
      const l = leerCifra(datos.ivaPct, { nombre: 'el IVA' });
      if ('error' in l) faltan.ivaPct = l.error;
      else iva = l.valor;
    }
    let base = '';
    let total = '';
    if (via === null) {
      faltan.precioBase = 'Escriba el precio base o el precio total; el otro se calcula solo.';
    } else {
      const capturado = leerCifra(via === 'BASE' ? datos.precioBase : datos.precioTotal, { nombre: 'el precio' });
      if ('error' in capturado) {
        faltan[via === 'BASE' ? 'precioBase' : 'precioTotal'] = capturado.error;
      } else if (!faltan.ivaPct) {
        // Se recalcula sobre la cifra canónica, no sobre lo mostrado.
        base = via === 'BASE' ? capturado.valor : baseDesdeTotal(capturado.valor, iva);
        total = via === 'BASE' ? totalDesdeBase(capturado.valor, iva) : capturado.valor;
      }
    }
    setErrores(faltan);
    if (Object.values(faltan).some(Boolean)) return null;
    return {
      nombre: datos.nombre.trim(),
      tipo: datos.tipo as TipoRecurso,
      unidadId: datos.unidadId,
      precioBase: base,
      ivaPct: iva,
      precioTotal: total,
      viaCaptura: via as ViaCaptura,
    };
  }

  async function enviar() {
    if (enviando || soloConsulta) return;
    setError(null);
    const cuerpo = validar();
    if (!cuerpo) return;
    setEnviando(true);
    try {
      if (!editando) {
        const creado = await pedir<Recurso>('/api/recursos', { metodo: 'POST', cuerpo });
        alGuardar(creado, `Recurso ${creado.codigo} creado.`);
        return;
      }
      // 02 §5.3: si el recurso entra en presupuestos ABIERTOS, se pregunta antes.
      const { presupuestos } = await pedir<{ presupuestos: PresupuestoVinculado[] }>(
        `/api/recursos/${encodeURIComponent(recurso.id)}/presupuestos-afectados`,
      );
      if (presupuestos.length > 0) {
        setPreguntando({ presupuestos, cuerpo });
        setEnviando(false);
        return;
      }
      await guardarEdicion(cuerpo, []);
    } catch (e) {
      tratarError(e);
    }
  }

  async function guardarEdicion(cuerpo: DatosDeRecurso, reapuntar: string[]) {
    if (!recurso) return;
    setEnviando(true);
    try {
      const r = await pedir<{ recurso: Recurso; apusVersionados: number }>(
        `/api/recursos/${encodeURIComponent(recurso.id)}`,
        { metodo: 'PUT', cuerpo: { ...cuerpo, presupuestosAReapuntar: reapuntar } },
      );
      const n = reapuntar.length;
      alGuardar(
        r.recurso,
        n > 0
          ? `Recurso ${r.recurso.codigo} guardado y actualizado en ${n} ${n === 1 ? 'proyecto' : 'proyectos'}.`
          : `Recurso ${r.recurso.codigo} guardado.`,
      );
    } catch (e) {
      setPreguntando(null);
      tratarError(e);
    }
  }

  function tratarError(e: unknown) {
    setEnviando(false);
    if (e instanceof ErrorDeApi && e.campo && e.campo in datos) setErrores({ [e.campo]: e.message });
    else setError(e instanceof ErrorDeApi ? e.message : 'Algo falló y no se guardó el recurso. Intente de nuevo.');
  }

  const bloqueadoBase = via === 'TOTAL';
  const bloqueadoTotal = via === 'BASE';
  const titulo = !editando ? 'Crear Nuevo Recurso' : soloConsulta ? `Recurso ${recurso.codigo}` : `Editar recurso ${recurso.codigo}`;

  return (
    <>
      <Capa
        titulo={titulo}
        alCerrar={alCerrar}
        hayCambios={hayCambios && !soloConsulta}
        error={error}
        alEnviar={() => void enviar()}
        acciones={(cerrar) => (
          <>
            {editando && alEliminar && puedeEscribir('RECURSOS.ELIMINAR') ? (
              <button type="button" className="boton boton-peligroso boton-aparte" onClick={() => setEliminando(true)} disabled={enviando}>
                Eliminar recurso
              </button>
            ) : null}
            <button type="button" className="boton boton-secundario" onClick={cerrar} disabled={enviando}>
              {soloConsulta ? 'Cerrar' : 'Cancelar'}
            </button>
            {soloConsulta ? null : (
              <button type="submit" className="boton boton-principal" disabled={enviando || unidades === null}>
                {enviando ? 'Guardando…' : editando ? 'Guardar recurso' : 'Crear recurso'}
              </button>
            )}
          </>
        )}
      >
        {editando ? (
          <div className="campo">
            <span className="etiqueta">Código</span>
            <p className="dato-fijo">
              {recurso.codigo}
              <span className="dato-de-apoyo">Lo asigna el sistema y no cambia nunca.</span>
            </p>
          </div>
        ) : null}
        <fieldset className="grupo-sin-borde" disabled={soloConsulta}>
          <Campo etiqueta="Nombre del recurso" error={errores.nombre}>
            {(a) => <input {...a} data-campo="nombre" autoComplete="off" value={datos.nombre} onChange={(e) => cambiar('nombre', e.target.value)} />}
          </Campo>
          <div className="fila-de-campos">
            <Campo etiqueta="Tipo de recurso" error={errores.tipo}>
              {(a) => (
                <select {...a} value={datos.tipo} onChange={(e) => cambiar('tipo', e.target.value)}>
                  <option value="" disabled>Elija el tipo</option>
                  {(Object.keys(NOMBRES_DE_TIPO) as TipoRecurso[]).map((t) => (
                    <option key={t} value={t}>{NOMBRES_DE_TIPO[t]}</option>
                  ))}
                </select>
              )}
            </Campo>
            <Campo etiqueta="Unidad de medida" error={errores.unidadId}>
              {(a) => (
                <select {...a} value={datos.unidadId} onChange={(e) => cambiar('unidadId', e.target.value)} disabled={unidades === null || soloConsulta}>
                  <option value="" disabled>{unidades === null ? 'Cargando…' : 'Elija la unidad'}</option>
                  {(unidades ?? []).map((u) => (
                    <option key={u.id} value={u.id}>{u.simbolo} · {u.descripcion}</option>
                  ))}
                </select>
              )}
            </Campo>
          </div>

          <div className="bloque-de-precio">
            <p className="bloque-de-precio-titulo">Precio en {arranque.monedaBase}</p>
            <p className="campo-ayuda">
              Escriba el precio que tiene —sin IVA o con IVA incluido— y el otro se calcula solo. Para cambiar de
              vía, borre lo escrito.
            </p>
            <div className="fila-de-campos fila-de-tres">
              <Campo
                etiqueta="Precio base (sin IVA)"
                error={errores.precioBase}
                {...(bloqueadoBase ? { ayuda: 'Calculado desde el total.' } : {})}
              >
                {(a) => (
                  <input {...a} data-campo="precioBase" inputMode="decimal" className="cifra-editable" autoComplete="off"
                         value={datos.precioBase} readOnly={bloqueadoBase} aria-readonly={bloqueadoBase}
                         onChange={(e) => cambiar('precioBase', soloCifra(e.target.value, formato.separadorDecimal))} />
                )}
              </Campo>
              <Campo etiqueta="IVA %" ayuda="19 % en material y equipo; vacío es 0 %." error={errores.ivaPct}>
                {(a) => (
                  <input {...a} data-campo="ivaPct" inputMode="decimal" className="cifra-editable" autoComplete="off"
                         value={datos.ivaPct} onChange={(e) => cambiar('ivaPct', soloCifra(e.target.value, formato.separadorDecimal))} />
                )}
              </Campo>
              <Campo
                etiqueta="Precio total (con IVA)"
                error={errores.precioTotal}
                {...(bloqueadoTotal ? { ayuda: 'Calculado desde el base.' } : {})}
              >
                {(a) => (
                  <input {...a} data-campo="precioTotal" inputMode="decimal" className="cifra-editable" autoComplete="off"
                         value={datos.precioTotal} readOnly={bloqueadoTotal} aria-readonly={bloqueadoTotal}
                         onChange={(e) => cambiar('precioTotal', soloCifra(e.target.value, formato.separadorDecimal))} />
                )}
              </Campo>
            </div>
            {editando && soloConsulta ? (
              <p className="campo-ayuda">
                Precio total: <span className="cifra">{formatearNumero(recurso.precioTotal, formato)}</span>
              </p>
            ) : null}
          </div>
        </fieldset>
      </Capa>

      {preguntando ? (
        <ElegirPresupuestos
          titulo="Actualizar proyectos abiertos"
          pregunta={`Este recurso se usa en ${preguntando.presupuestos.length} ${
            preguntando.presupuestos.length === 1 ? 'proyecto abierto' : 'proyectos abiertos'
          }. ¿Desea actualizar su precio en ellos?`}
          explicacion="Los que no marque quedan exactamente como estaban. El catálogo queda con el precio nuevo de todas formas, y los proyectos activos y cerrados no se tocan."
          presupuestos={preguntando.presupuestos}
          alResponder={(elegidos) => guardarEdicion(preguntando.cuerpo, elegidos)}
          alCerrar={() => setPreguntando(null)}
        />
      ) : null}

      {eliminando && recurso && alEliminar ? (
        <Confirmacion
          titulo={`Eliminar el recurso ${recurso.codigo}`}
          textoConfirmar="Eliminar recurso"
          textoEnviando="Eliminando…"
          peligroso
          alCerrar={() => setEliminando(false)}
          alConfirmar={async () => {
            await pedir<void>(`/api/recursos/${encodeURIComponent(recurso.id)}`, { metodo: 'DELETE' });
            alEliminar(recurso);
          }}
        >
          <p>
            Se eliminará «{recurso.nombre}» del catálogo. Si está vinculado a algún APU, el sistema no lo
            permitirá y le dirá dónde está en uso.
          </p>
        </Confirmacion>
      ) : null}
    </>
  );
}
