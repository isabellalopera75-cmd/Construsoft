import { useCallback, useEffect, useMemo, useState } from 'react';
import { ErrorDeApi, pedir } from '../../api/cliente.ts';
import type { ActividadDeMesa, Mesa as DatosDeMesa, NodoDeMesa, Pie, Presupuesto, Version } from '../../api/tipos.ts';
import { useAvisos } from '../../componentes/Avisos.tsx';
import { BotonVolver } from '../../cascaron/Cascaron.tsx';
import { Confirmacion } from '../../componentes/Confirmacion.tsx';
import { Icono } from '../../componentes/Icono.tsx';
import { InsigniaDeEstado } from '../../componentes/Insignia.tsx';
import { formatearFecha, formatearFechaYHora, paraAtributo } from '../../fechas.ts';
import { ir } from '../../navegacion.ts';
import { useSesion } from '../../sesion.tsx';
import { Arbol, type OperacionesDeMesa } from './Arbol.tsx';
import { armarArbol } from './arbol.ts';
import { Duplicar, EditarDatos, FormularioDeNodo, type FormaDeNodo } from './Dialogos.tsx';
import { Historial } from './Historial.tsx';
import { BarraDelPie, PanelDeDesglose } from './Pie.tsx';
import { enlaceDeExportacion, ListaDeVersiones } from './Versiones.tsx';

/*
 * 02 §8 a §10 · La mesa de trabajo. Todo ocurre en un lienzo único, sin
 * recargas de página.
 *
 * Una sola lectura la pinta entera (CONTRATO §1.2), y toda mutación responde
 * con la mesa entera recalculada (§1.3): la pantalla reemplaza su estado por
 * lo que llega. Si el servidor rechaza algo sin `campo`, el rechazo no es de
 * un dato sino del estado del mundo —«el presupuesto ya no está Abierto»—, así
 * que se muestra el mensaje tal cual y se relee la mesa (CONTRATO §2).
 *
 * Qué se puede editar lo dice el servidor con `editable`. La pantalla no
 * replica la regla.
 */

type Dialogo =
  | { tipo: 'nodo'; forma: FormaDeNodo }
  | { tipo: 'eliminar-nodo'; nodo: NodoDeMesa; mensaje: string }
  | { tipo: 'eliminar-actividad'; actividad: ActividadDeMesa }
  | { tipo: 'datos' }
  | { tipo: 'activar' }
  | { tipo: 'cerrar' }
  | { tipo: 'reabrir' }
  | { tipo: 'guardar-version' }
  | { tipo: 'versiones' }
  | { tipo: 'duplicar' }
  | { tipo: 'eliminar' }
  | null;

type Panel = 'desglose' | 'historial' | null;

export function Mesa({ id }: { id: string }) {
  const { puedeEscribir, puede, soloLectura } = useSesion();
  const { avisar } = useAvisos();
  const [mesa, setMesa] = useState<DatosDeMesa | null>(null);
  const [presupuesto, setPresupuesto] = useState<Presupuesto | null>(null);
  const [versiones, setVersiones] = useState<Version[]>([]);
  const [fallo, setFallo] = useState<{ mensaje: string; noExiste: boolean } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [cambios, setCambios] = useState(0);

  const base = `/api/presupuestos/${encodeURIComponent(id)}`;

  const leerTodo = useCallback(async () => {
    try {
      const [m, p, v] = await Promise.all([
        pedir<DatosDeMesa>(`${base}/mesa`),
        pedir<Presupuesto>(base),
        pedir<{ versiones: Version[] }>(`${base}/versiones`),
      ]);
      setMesa(m);
      setPresupuesto(p);
      setVersiones(v.versiones);
      setFallo(null);
    } catch (e) {
      if (e instanceof ErrorDeApi && e.estado === 401) return;
      setFallo({
        mensaje: e instanceof ErrorDeApi ? e.message : 'No se pudo abrir la mesa de trabajo.',
        noExiste: e instanceof ErrorDeApi && e.estado === 404,
      });
    }
  }, [base]);

  useEffect(() => {
    setMesa(null);
    setPanel(null);
    setDialogo(null);
    void leerTodo();
  }, [leerTodo]);

  /** La mesa que llegó reemplaza a la que había. */
  const aplicar = (nueva: DatosDeMesa) => {
    setMesa(nueva);
    setCambios((n) => n + 1);
  };

  /**
   * Una mutación de estructura. Con `campo`, el error es del formulario y se
   * relanza para que lo marque. Sin `campo`, se muestra arriba y se relee.
   */
  async function mutar(peticion: () => Promise<DatosDeMesa>, relanzarSiempre = false): Promise<void> {
    setOcupado(true);
    setAviso(null);
    try {
      aplicar(await peticion());
    } catch (e) {
      if (e instanceof ErrorDeApi && (e.campo || relanzarSiempre)) throw e;
      if (e instanceof ErrorDeApi && e.estado === 401) return;
      setAviso(e instanceof ErrorDeApi ? e.message : 'Algo falló y no se guardó el cambio. La mesa se volvió a leer.');
      await leerTodo();
    } finally {
      setOcupado(false);
    }
  }

  const op: OperacionesDeMesa = {
    mover: (tipo, objetoId, posicion) =>
      void mutar(() =>
        pedir<DatosDeMesa>(`/api/${tipo === 'nodo' ? 'nodos' : 'actividades'}/${encodeURIComponent(objetoId)}/mover`, {
          metodo: 'POST',
          cuerpo: { posicion },
        }),
      ).catch((e: unknown) => setAviso(e instanceof ErrorDeApi ? e.message : 'No se movió.')),
    agregarSubnivel: (padre) => setDialogo({ tipo: 'nodo', forma: { tipo: 'subnivel', padre } }),
    editarNodo: (nodo) => setDialogo({ tipo: 'nodo', forma: { tipo: 'editar', nodo } }),
    eliminarNodo: (nodo) => void eliminarNodo(nodo),
    eliminarActividad: (actividad) => setDialogo({ tipo: 'eliminar-actividad', actividad }),
    cambiarCantidad: (actividad, cantidad) =>
      mutar(() => pedir<DatosDeMesa>(`/api/actividades/${encodeURIComponent(actividad.id)}`, { metodo: 'PATCH', cuerpo: { cantidad } })),
    agregarActividad: (nodoId, apuId, cantidad) =>
      mutar(
        () => pedir<DatosDeMesa>(`/api/nodos/${encodeURIComponent(nodoId)}/actividades`, { metodo: 'POST', cuerpo: { apuId, cantidad } }),
        true,
      ),
  };

  /** Un nivel vacío se borra sin preguntar; con contenido, el servidor responde 409 con el texto de la pregunta. */
  async function eliminarNodo(nodo: NodoDeMesa) {
    setOcupado(true);
    setAviso(null);
    try {
      aplicar(await pedir<DatosDeMesa>(`/api/nodos/${encodeURIComponent(nodo.id)}`, { metodo: 'DELETE' }));
      avisar(`«${nodo.nombre}» eliminado.`);
    } catch (e) {
      if (e instanceof ErrorDeApi && e.estado === 409) setDialogo({ tipo: 'eliminar-nodo', nodo, mensaje: e.message });
      else if (!(e instanceof ErrorDeApi && e.estado === 401)) {
        setAviso(e instanceof ErrorDeApi ? e.message : 'No se eliminó.');
        await leerTodo();
      }
    } finally {
      setOcupado(false);
    }
  }

  const arbol = useMemo(() => (mesa ? armarArbol(mesa) : null), [mesa]);

  if (fallo) {
    return (
      <>
        <div className="encabezado-de-pantalla">
          <div className="encabezado-con-volver">
            <BotonVolver a={{ pantalla: 'presupuestos' }} nombre="Proyectos" />
            <h1>{fallo.noExiste ? 'Ese proyecto no existe' : 'No se pudo abrir la mesa'}</h1>
          </div>
        </div>
        <div className="aviso-error" role="alert">
          <Icono nombre="aviso" />
          <span>{fallo.mensaje}</span>
          {fallo.noExiste ? null : <button type="button" className="boton boton-secundario" onClick={() => void leerTodo()}>Reintentar</button>}
        </div>
      </>
    );
  }

  if (!mesa || !arbol) {
    return (
      <div className="mesa-cargando" aria-busy="true">
        <p className="solo-lectores">Abriendo la mesa de trabajo…</p>
        <div className="esqueleto" aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => <div key={i} className="esqueleto-fila"><span /><span /><span /><span /></div>)}
        </div>
      </div>
    );
  }

  const { cabecera, pie } = mesa;
  const editable = cabecera.editable;
  const archivado = presupuesto?.archivadoEn ?? null;
  const esAdmin = puedeEscribir('PRESUPUESTOS.ESTADO');
  const fueActivado = versiones.some((v) => v.disparador === 'ABIERTO_A_ACTIVO');
  const tieneSubniveles = mesa.nodos.some((n) => n.padreId !== null);
  const vacia = mesa.nodos.length === 0;

  const motivoDeSoloLectura = editable
    ? null
    : cabecera.estado === 'ACTIVO'
      ? 'Este proyecto está Activo: es la línea base contractual y no se edita. Para corregirlo, un Administrador tiene que reabrirlo con una justificación.'
      : cabecera.estado === 'CERRADO'
        ? 'Este proyecto está Cerrado: la obra terminó y no admite cambios. Para retomarlo, duplíquelo; la copia nace Abierta.'
        : soloLectura
          ? 'La suscripción de su empresa no está vigente: puede consultar y exportar este proyecto, pero no editarlo.'
          : 'Puede consultar este proyecto, pero su rol no tiene permiso para editarlo.';

  const cerrarDialogo = () => setDialogo(null);
  const conMesa = async (ruta: string, cuerpo?: unknown) => {
    const nueva = await pedir<DatosDeMesa>(ruta, { metodo: 'POST', ...(cuerpo === undefined ? {} : { cuerpo }) });
    aplicar(nueva);
    const v = await pedir<{ versiones: Version[] }>(`${base}/versiones`).catch(() => null);
    if (v) setVersiones(v.versiones);
  };

  async function archivar(si: boolean) {
    setOcupado(true);
    try {
      const p = await pedir<Presupuesto>(`${base}/${si ? 'archivar' : 'desarchivar'}`, { metodo: 'POST' });
      setPresupuesto(p);
      setCambios((n) => n + 1);
      avisar(si ? 'Proyecto archivado: ya no aparece en la lista, salvo con «Ver archivados».' : 'Proyecto desarchivado: vuelve a la lista.');
    } catch (e) {
      if (!(e instanceof ErrorDeApi && e.estado === 401)) setAviso(e instanceof ErrorDeApi ? e.message : 'No se pudo archivar.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="mesa" data-panel={panel ? 'abierto' : 'cerrado'}>
      <header className="tarjeta encabezado-de-mesa">
        <div className="encabezado-de-mesa-arriba">
          <BotonVolver a={{ pantalla: 'presupuestos' }} nombre="Proyectos" />
          <span className="codigo-de-mesa">{cabecera.codigo}</span>
          <InsigniaDeEstado estado={cabecera.estado} />
          {archivado ? <span className="insignia insignia-archivado">Archivado</span> : null}
        </div>
        <h1 className="titulo-de-mesa">{cabecera.nombre}</h1>
        <dl className="datos-de-mesa">
          <div><dt>Ubicación</dt><dd>{cabecera.ubicacion}</dd></div>
          <div><dt>Moneda</dt><dd>{cabecera.moneda}</dd></div>
          <div><dt>Estructura</dt><dd>{cabecera.modoEstructura === 'WBS' ? 'Por EDT' : 'Por ítems'}</dd></div>
          <div>
            <dt>Última modificación</dt>
            <dd><time dateTime={paraAtributo(cabecera.fechaModificacion)}>{formatearFechaYHora(cabecera.fechaModificacion)}</time></dd>
          </div>
          {archivado ? <div><dt>Archivado</dt><dd><time dateTime={paraAtributo(archivado)}>{formatearFecha(archivado)}</time></dd></div> : null}
        </dl>

        <div className="acciones-de-mesa">
          <div className="acciones-de-mesa-grupo">
            {cabecera.estado === 'ABIERTO' && esAdmin ? (
              <button type="button" className="boton boton-principal" disabled={ocupado} onClick={() => setDialogo({ tipo: 'activar' })}>
                <Icono nombre="visto" />
                Aprobar y Activar Proyecto
              </button>
            ) : null}
            {cabecera.estado === 'ACTIVO' && esAdmin ? (
              <button type="button" className="boton boton-secundario" disabled={ocupado} onClick={() => setDialogo({ tipo: 'reabrir' })}>
                Reabrir Proyecto
              </button>
            ) : null}
            {editable ? (
              <button type="button" className="boton boton-secundario" disabled={ocupado} onClick={() => setDialogo({ tipo: 'datos' })}>
                <Icono nombre="editar" />
                Editar datos
              </button>
            ) : null}
            {puede('PRESUPUESTOS.EXPORTAR') ? (
              <span className="grupo-exportar" role="group" aria-label="Exportar Proyecto">
                <a className="boton boton-secundario" href={enlaceDeExportacion('presupuestos', cabecera.id, 'pdf')} download>
                  <Icono nombre="descargar" />
                  PDF
                </a>
                <a className="boton boton-secundario" href={enlaceDeExportacion('presupuestos', cabecera.id, 'xlsx')} download>
                  <Icono nombre="descargar" />
                  Excel
                </a>
              </span>
            ) : null}
            <button type="button" className="boton boton-secundario" onClick={() => setDialogo({ tipo: 'versiones' })}>
              <Icono nombre="version" />
              Versiones
            </button>
            <button type="button" className="boton boton-secundario" aria-expanded={panel === 'historial'} onClick={() => setPanel(panel === 'historial' ? null : 'historial')}>
              <Icono nombre="historial" />
              Historial de cambios
            </button>
          </div>
          <div className="acciones-de-mesa-grupo acciones-secundarias">
            {puedeEscribir('PRESUPUESTOS.EDITAR') ? (
              <button type="button" className="boton boton-secundario" disabled={ocupado} onClick={() => setDialogo({ tipo: 'guardar-version' })}>
                Guardar versión
              </button>
            ) : null}
            {puedeEscribir('PRESUPUESTOS.DUPLICAR') ? (
              <button type="button" className="boton boton-secundario" disabled={ocupado} onClick={() => setDialogo({ tipo: 'duplicar' })}>
                <Icono nombre="copiar" />
                Duplicar Proyecto
              </button>
            ) : null}
            {puedeEscribir('PRESUPUESTOS.EDITAR') ? (
              <button type="button" className="boton boton-secundario" disabled={ocupado} onClick={() => void archivar(!archivado)}>
                <Icono nombre="archivar" />
                {archivado ? 'Desarchivar proyecto' : 'Archivar proyecto'}
              </button>
            ) : null}
            {cabecera.estado === 'ACTIVO' && esAdmin ? (
              <button type="button" className="boton boton-peligroso" disabled={ocupado} onClick={() => setDialogo({ tipo: 'cerrar' })}>
                Cerrar Proyecto
              </button>
            ) : null}
            {/* 02 §9.7: solo para el Administrador y solo si nunca se activó. */}
            {cabecera.estado === 'ABIERTO' && esAdmin && !fueActivado ? (
              <button type="button" className="boton boton-peligroso" disabled={ocupado} onClick={() => setDialogo({ tipo: 'eliminar' })}>
                <Icono nombre="basura" />
                Eliminar proyecto
              </button>
            ) : null}
          </div>
        </div>
      </header>

      {motivoDeSoloLectura ? (
        <p className="franja-de-estado" role="note">
          <Icono nombre="candado" />
          <span>{motivoDeSoloLectura}</span>
        </p>
      ) : null}

      {aviso ? (
        <div className="aviso-error" role="alert">
          <Icono nombre="aviso" />
          <span>{aviso}</span>
          <button type="button" className="boton-icono" aria-label="Cerrar aviso" onClick={() => setAviso(null)}><Icono nombre="cerrar" /></button>
        </div>
      ) : null}

      <div className="barra-de-estructura">
        <p className="campo-ayuda">
          {cabecera.modoEstructura === 'WBS'
            ? 'Estructura por EDT: capítulos, subcapítulos sin límite de profundidad y actividades. La numeración la asigna el sistema.'
            : 'Estructura por ítems: capítulos y actividades. La numeración la asigna el sistema.'}
        </p>
        {editable ? (
          <button type="button" className="boton boton-secundario" disabled={ocupado} onClick={() => setDialogo({ tipo: 'nodo', forma: { tipo: 'capitulo' } })}>
            <Icono nombre="mas" />
            Agregar Capítulo
          </button>
        ) : null}
      </div>

      {vacia ? (
        <div className="vacio">
          <p className="vacio-titulo">Este proyecto todavía no tiene capítulos.</p>
          <p>
            {editable
              ? 'Empiece con «Agregar Capítulo». Cada capítulo de primer nivel es de costo directo o indirecto, y lo que cuelga de él hereda esa naturaleza.'
              : 'No hay estructura que mostrar.'}
          </p>
        </div>
      ) : (
        <Arbol arbol={arbol} editable={editable} modo={cabecera.modoEstructura} ocupado={ocupado} op={op} />
      )}

      <BarraDelPie pie={pie} panelAbierto={panel === 'desglose'} alAlternarPanel={() => setPanel(panel === 'desglose' ? null : 'desglose')} />

      {panel === 'desglose' ? (
        <PanelDeDesglose
          pie={pie}
          editable={editable}
          alCerrar={() => setPanel(null)}
          alGuardar={async (porcentajes) => {
            const nuevoPie = await pedir<Pie>(`${base}/porcentajes`, { metodo: 'PATCH', cuerpo: porcentajes });
            setMesa((m) => (m ? { ...m, pie: nuevoPie } : m));
            setCambios((n) => n + 1);
            avisar('Porcentajes guardados.');
          }}
        />
      ) : null}
      {panel === 'historial' ? <Historial presupuestoId={cabecera.id} version={cambios} alCerrar={() => setPanel(null)} /> : null}

      {/* --- Diálogos ---------------------------------------------------------- */}

      {dialogo?.tipo === 'nodo' ? (
        <FormularioDeNodo
          forma={dialogo.forma}
          alCerrar={cerrarDialogo}
          alGuardar={async ({ nombre, clasificacion }) => {
            const forma = dialogo.forma;
            if (forma.tipo === 'capitulo') {
              await mutar(() => pedir<DatosDeMesa>(`${base}/capitulos`, { metodo: 'POST', cuerpo: { nombre, clasificacion } }), true);
            } else if (forma.tipo === 'subnivel') {
              await mutar(() => pedir<DatosDeMesa>(`/api/nodos/${encodeURIComponent(forma.padre.id)}/subniveles`, { metodo: 'POST', cuerpo: { nombre } }), true);
            } else {
              // Nombre y clasificación van por separado: el PATCH acepta uno u otro (CONTRATO §4.2).
              const ruta = `/api/nodos/${encodeURIComponent(forma.nodo.id)}`;
              if (nombre !== forma.nodo.nombre) await mutar(() => pedir<DatosDeMesa>(ruta, { metodo: 'PATCH', cuerpo: { nombre } }), true);
              if (clasificacion && clasificacion !== forma.nodo.clasificacion) {
                await mutar(() => pedir<DatosDeMesa>(ruta, { metodo: 'PATCH', cuerpo: { clasificacion } }), true);
              }
            }
            cerrarDialogo();
          }}
        />
      ) : null}

      {dialogo?.tipo === 'eliminar-nodo' ? (
        <Confirmacion
          titulo={`Eliminar ${dialogo.nodo.codigoWbs} ${dialogo.nodo.nombre}`}
          textoConfirmar="Eliminar con todo su contenido"
          textoEnviando="Eliminando…"
          peligroso
          alCerrar={cerrarDialogo}
          alConfirmar={async () => {
            const nueva = await pedir<DatosDeMesa>(`/api/nodos/${encodeURIComponent(dialogo.nodo.id)}?confirmado=si`, { metodo: 'DELETE' });
            aplicar(nueva);
            avisar(`«${dialogo.nodo.nombre}» eliminado con su contenido.`);
            cerrarDialogo();
          }}
        >
          {/* El texto lo escribe el servidor con los conteos (CONTRATO §4.2). */}
          <p>{dialogo.mensaje}</p>
        </Confirmacion>
      ) : null}

      {dialogo?.tipo === 'eliminar-actividad' ? (
        <Confirmacion
          titulo="Quitar actividad"
          textoConfirmar="Quitar del proyecto"
          textoEnviando="Quitando…"
          peligroso
          alCerrar={cerrarDialogo}
          alConfirmar={async () => {
            const nueva = await pedir<DatosDeMesa>(`/api/actividades/${encodeURIComponent(dialogo.actividad.id)}`, { metodo: 'DELETE' });
            aplicar(nueva);
            cerrarDialogo();
          }}
        >
          <p>
            Se quitará <strong>{dialogo.actividad.codigoItem} {dialogo.actividad.descripcion}</strong> ({dialogo.actividad.codigoApu}) de este
            proyecto. El APU sigue en el catálogo.
          </p>
        </Confirmacion>
      ) : null}

      {dialogo?.tipo === 'datos' ? (
        <EditarDatos
          cabecera={cabecera}
          tieneSubniveles={tieneSubniveles}
          alCerrar={cerrarDialogo}
          alGuardar={async (datos, modo) => {
            const cambioDatos = datos.codigo !== cabecera.codigo || datos.nombre !== cabecera.nombre || datos.ubicacion !== cabecera.ubicacion;
            if (cambioDatos) aplicar(await pedir<DatosDeMesa>(`${base}/cabecera`, { metodo: 'PUT', cuerpo: datos }));
            if (modo) aplicar(await pedir<DatosDeMesa>(`${base}/estructura`, { metodo: 'PUT', cuerpo: { modoEstructura: modo } }));
            avisar('Datos del proyecto guardados.');
            cerrarDialogo();
          }}
        />
      ) : null}

      {dialogo?.tipo === 'activar' ? (
        <Confirmacion
          titulo="Aprobar y activar el proyecto"
          textoConfirmar="Activar proyecto"
          textoEnviando="Activando…"
          alCerrar={cerrarDialogo}
          alConfirmar={async () => {
            await conMesa(`${base}/activar`);
            avisar('Proyecto activado: la versión de línea base quedó guardada.');
            cerrarDialogo();
          }}
        >
          {/* El texto lo fija el 02 §9.1 y se usa textual. */}
          <p>
            Esta acción cambiará el estado del proyecto a ACTIVO y congelará su presupuesto como la línea base contractual
            oficial. A partir de este momento no podrá modificarse sin reabrirlo. ¿Desea proceder?
          </p>
          {pie.aiuEnCero ? (
            // 02 §8.6: no bloquea —hay obras que se ofertan a costo— pero avisa.
            <p className="aviso-en-dialogo" role="note">
              <Icono nombre="aviso" />
              <span>
                Los tres porcentajes del AIU están en cero. Si la obra no se oferta a costo, revíselos en el desglose antes
                de activar: después quedan congelados.
              </span>
            </p>
          ) : null}
        </Confirmacion>
      ) : null}

      {dialogo?.tipo === 'cerrar' ? (
        <Confirmacion
          titulo="Cerrar el proyecto"
          textoConfirmar="Cerrar proyecto"
          textoEnviando="Cerrando…"
          peligroso
          alCerrar={cerrarDialogo}
          alConfirmar={async () => {
            await conMesa(`${base}/cerrar`);
            avisar('Proyecto cerrado. Se guardó una versión.');
            cerrarDialogo();
          }}
        >
          <p>
            El proyecto pasará a CERRADO: queda como registro histórico de una obra terminada o cancelada y no admite ningún
            cambio. <strong>Un proyecto cerrado no se puede reabrir</strong>; para retomarlo habrá que duplicarlo.
          </p>
          <p className="campo-ayuda">Si la licitación no se ganó, no lo cierre: archívelo.</p>
        </Confirmacion>
      ) : null}

      {dialogo?.tipo === 'reabrir' ? (
        <Confirmacion
          titulo="Reabrir el proyecto"
          textoConfirmar="Reabrir proyecto"
          textoEnviando="Reabriendo…"
          pideTexto={{ etiqueta: 'Justificación', ayuda: 'Queda en el historial con su nombre, la fecha y la hora, y nadie puede borrarla.', campo: 'justificacion', vacio: 'Escriba la justificación: sin ella no se puede reabrir.' }}
          alCerrar={cerrarDialogo}
          alConfirmar={async (justificacion) => {
            await conMesa(`${base}/reabrir`, { justificacion });
            avisar('Proyecto reabierto. La línea base anterior quedó guardada como versión.');
            cerrarDialogo();
          }}
        >
          <p>
            El proyecto vuelve a Abierto y se puede editar. Antes se guarda una versión con su estado actual, para que la
            línea base anterior quede consultable. Al volver a activarlo, la nueva versión pasa a ser la línea base vigente.
          </p>
        </Confirmacion>
      ) : null}

      {dialogo?.tipo === 'guardar-version' ? (
        <Confirmacion
          titulo="Guardar versión"
          textoConfirmar="Guardar versión"
          textoEnviando="Guardando…"
          pideTexto={{ etiqueta: 'Motivo', ayuda: 'Por ejemplo: «Enviada al cliente el 6 de octubre».', campo: 'motivo', vacio: 'Escriba el motivo de la versión.' }}
          alCerrar={cerrarDialogo}
          alConfirmar={async (motivo) => {
            const v = await pedir<Version>(`${base}/versiones`, { metodo: 'POST', cuerpo: { motivo } });
            setVersiones((vs) => [...vs, v]);
            avisar(`Versión ${v.numero} guardada.`);
            cerrarDialogo();
          }}
        >
          <p>Se guarda una fotografía completa del proyecto tal como está ahora. Se puede consultar y exportar después, pero no se edita.</p>
        </Confirmacion>
      ) : null}

      {dialogo?.tipo === 'versiones' ? <ListaDeVersiones versiones={versiones} alCerrar={cerrarDialogo} /> : null}

      {dialogo?.tipo === 'duplicar' ? (
        <Duplicar
          cabecera={cabecera}
          alCerrar={cerrarDialogo}
          alDuplicar={(nuevoId) => {
            cerrarDialogo();
            avisar('Proyecto duplicado. Está viendo la copia, que nace Abierta.');
            ir({ pantalla: 'mesa', id: nuevoId });
          }}
        />
      ) : null}

      {dialogo?.tipo === 'eliminar' ? (
        <Confirmacion
          titulo={`Eliminar el proyecto ${cabecera.codigo}`}
          textoConfirmar="Eliminar proyecto"
          textoEnviando="Eliminando…"
          peligroso
          pideTexto={{ etiqueta: 'Motivo', ayuda: 'Es lo único que queda del proyecto en el registro.', campo: 'motivo', vacio: 'Escriba por qué se elimina: es lo único que queda del proyecto.' }}
          alCerrar={cerrarDialogo}
          alConfirmar={async (motivo) => {
            await pedir<void>(`${base}/eliminar`, { metodo: 'POST', cuerpo: { motivo } });
            avisar(`Proyecto ${cabecera.codigo} eliminado.`);
            ir({ pantalla: 'presupuestos' });
          }}
        >
          <p>
            Se borra el proyecto con todo lo suyo: su estructura, sus versiones y su historial. Esto no se deshace. Queda
            solo la constancia de que existió y el motivo que escriba.
          </p>
          <p className="campo-ayuda">Si es una licitación que no se ganó, considere archivarlo: se conserva y sale de la lista.</p>
        </Confirmacion>
      ) : null}
    </div>
  );
}

