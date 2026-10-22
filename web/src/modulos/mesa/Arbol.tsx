import { useEffect, useState, type KeyboardEvent } from 'react';
import { conConsulta, ErrorDeApi, pedir } from '../../api/cliente.ts';
import type { ActividadDeMesa, Apu, ApuEncontrado, ModoEstructura, NodoDeMesa } from '../../api/tipos.ts';
import { Buscador } from '../../componentes/Buscador.tsx';
import { Icono } from '../../componentes/Icono.tsx';
import { aTexto, leer, multiplicar } from '../../decimal.ts';
import { leerCifra, paraEditar, soloCifra } from '../../entrada.ts';
import { formatearNumero } from '../../formato.ts';
import { useSesion } from '../../sesion.tsx';
import { FormularioDeApu } from '../apu/FormularioDeApu.tsx';
import { limitesDe, type Arbol as ArbolArmado, type Limites } from './arbol.ts';

/*
 * 02 §8.2 a §8.5 · La estructura de la mesa: capítulos, subcapítulos y
 * actividades, con sus totales en el extremo derecho de cada nivel.
 *
 * Toda mutación responde con la mesa entera (CONTRATO §1.3) y la pantalla
 * reemplaza su estado por lo que llega: no hay numeración provisional ni un
 * árbol a medias. Por eso estas filas no guardan nada suyo salvo lo que se
 * está escribiendo.
 *
 * D-75 (13 de octubre de 2026) · La actividad no lleva número jerárquico: en
 * la columna del código va el código de su APU, y la fila se entiende por el
 * bloque en el que está. Los subcapítulos van antes que las actividades
 * directas, y los números traen los ceros que les pone la base.
 */

export interface OperacionesDeMesa {
  mover: (tipo: 'nodo' | 'actividad', id: string, posicion: number) => void;
  agregarSubnivel: (nodo: NodoDeMesa) => void;
  editarNodo: (nodo: NodoDeMesa) => void;
  eliminarNodo: (nodo: NodoDeMesa) => void;
  eliminarActividad: (actividad: ActividadDeMesa) => void;
  /** Lanza ErrorDeApi con campo «cantidad» si el dato no sirve. */
  cambiarCantidad: (actividad: ActividadDeMesa, cantidad: string) => Promise<void>;
  agregarActividad: (nodoId: string, apuId: string, cantidad: string) => Promise<void>;
}

interface Props {
  arbol: ArbolArmado;
  /** Los niveles plegados viven en la mesa, que tiene los controles de niveles. */
  plegados: ReadonlySet<string>;
  setPlegados: (cambiar: (p: ReadonlySet<string>) => ReadonlySet<string>) => void;
  editable: boolean;
  modo: ModoEstructura;
  ocupado: boolean;
  op: OperacionesDeMesa;
}

export function Arbol({ arbol, plegados, setPlegados, editable, modo, ocupado, op }: Props) {
  const [agregandoEn, setAgregandoEn] = useState<string | null>(null);

  const alternar = (id: string) =>
    setPlegados((p) => {
      const nuevo = new Set(p);
      if (nuevo.has(id)) nuevo.delete(id);
      else nuevo.add(id);
      return nuevo;
    });

  const filas: React.ReactNode[] = [];
  const pintarNodo = (nodo: NodoDeMesa) => {
    const plegado = plegados.has(nodo.id);
    filas.push(
      <FilaDeNodo key={nodo.id} nodo={nodo} limites={limitesDe(arbol, nodo.padreId, 'nodo')} plegado={plegado} alAlternar={() => alternar(nodo.id)}
                  editable={editable} modo={modo} ocupado={ocupado} op={op}
                  alAgregarActividad={() => {
                    // Si el nivel estaba plegado, se despliega: la fila de agregar vive adentro.
                    setPlegados((p) => {
                      const nuevo = new Set(p);
                      nuevo.delete(nodo.id);
                      return nuevo;
                    });
                    setAgregandoEn(nodo.id);
                  }} />,
    );
    if (plegado) return;
    const hijos = arbol.hijos.get(nodo.id) ?? [];
    const limitesDeActividad = limitesDe(arbol, nodo.id, 'actividad');
    for (const hijo of hijos) {
      if (hijo.tipo === 'nodo') pintarNodo(hijo.nodo);
      else filas.push(<FilaDeActividad key={hijo.actividad.id} actividad={hijo.actividad} nivel={nodo.nivel} limites={limitesDeActividad} editable={editable} ocupado={ocupado} op={op} />);
    }
    // Agregar se abre con el icono junto al nombre del nivel (15 de octubre
    // de 2026): ya no hay una fila «Agregar actividad en…» fija debajo de
    // cada capítulo. La fila existe solo mientras se está agregando.
    if (editable && agregandoEn === nodo.id) {
      filas.push(<FilaDeAgregar key={`agregar-${nodo.id}`} nodo={nodo} alCerrar={() => setAgregandoEn(null)} op={op} />);
    }
  };
  for (const raiz of arbol.raices) pintarNodo(raiz);

  return (
    <div className="tarjeta tarjeta-tabla tarjeta-mesa">
      <table className="tabla tabla-mesa" data-editable={editable ? 'si' : 'no'}>
        <caption className="solo-lectores">Estructura del presupuesto</caption>
        <thead>
          <tr>
            <th scope="col" className="col-item">Código</th>
            <th scope="col">Descripción</th>
            <th scope="col" className="col-und">Und.</th>
            <th scope="col" className="cifra col-cantidad">Cantidad</th>
            <th scope="col" className="cifra col-precio">P. unitario</th>
            <th scope="col" className="cifra col-valor">Valor</th>
            <th scope="col" className="cifra col-incidencia" title="Peso sobre el costo directo total">Incid. %</th>
            {editable ? <th scope="col" className="col-acciones"><span className="solo-lectores">Acciones</span></th> : null}
          </tr>
        </thead>
        <tbody>{filas}</tbody>
      </table>
    </div>
  );
}

function FilaDeNodo({
  nodo,
  limites,
  plegado,
  alAlternar,
  editable,
  modo,
  ocupado,
  op,
  alAgregarActividad,
}: {
  nodo: NodoDeMesa;
  limites: Limites;
  plegado: boolean;
  alAlternar: () => void;
  editable: boolean;
  modo: ModoEstructura;
  ocupado: boolean;
  op: OperacionesDeMesa;
  alAgregarActividad: () => void;
}) {
  const { arranque } = useSesion();
  const formato = arranque.formatoNumerico;
  const esRaiz = nodo.padreId === null;
  return (
    <tr className="fila-nodo" data-nivel={Math.min(nodo.nivel, 4)} data-raiz={esRaiz ? 'si' : undefined}>
      <td className="col-item">
        <button type="button" className="boton-plegar" aria-expanded={!plegado} aria-label={`${plegado ? 'Desplegar' : 'Plegar'} ${nodo.nombre}`} onClick={alAlternar}>
          <span aria-hidden="true" className="flecha" data-plegado={plegado ? 'si' : 'no'}>›</span>
        </button>
        <span className="cifra-codigo">{nodo.codigoWbs}</span>
      </td>
      <td className="col-nombre-nodo" style={{ ['--sangria' as string]: `${(nodo.nivel - 1) * 16}px` }}>
        <span className="nombre-nodo">{nodo.nombre}</span>
        {esRaiz ? (
          // La etiqueta va en la barra del capítulo (02 §8.4). Siempre con palabra.
          <span className="insignia insignia-clasificacion" data-clasificacion={nodo.clasificacion}>
            {nodo.clasificacion === 'DIRECTO' ? 'Directo' : 'Indirecto'}
          </span>
        ) : null}
        {editable ? (
          // Agregar va junto al nombre, no al final de la fila (pedido del
          // dueño, 15 de octubre de 2026): el mouse no tiene que cruzar la
          // tabla. Subir, bajar, renombrar y eliminar se quedan a la derecha.
          <span className="agregar-en-nodo">
            <button type="button" className="boton-icono boton-chico" title={`Agregar actividad en ${nodo.codigoWbs}`} aria-label={`Agregar una actividad en ${nodo.codigoWbs} ${nodo.nombre}`} disabled={ocupado} onClick={alAgregarActividad}>
              <Icono nombre="item" tamano={18} />
            </button>
            {modo === 'WBS' ? (
              <button type="button" className="boton-icono boton-chico" title={`Agregar subcapítulo en ${nodo.codigoWbs}`} aria-label={`Agregar un subcapítulo en ${nodo.codigoWbs} ${nodo.nombre}`} disabled={ocupado} onClick={() => op.agregarSubnivel(nodo)}>
                <Icono nombre="carpeta" tamano={18} />
              </button>
            ) : null}
          </span>
        ) : null}
      </td>
      <td className="col-und" />
      <td className="col-cantidad" />
      <td className="col-precio" />
      <td className="cifra col-valor">{formatearNumero(nodo.montoAcumulado, formato)}</td>
      <td className="cifra col-incidencia" data-vacia={nodo.incidenciaPct === null ? 'si' : undefined}>
        {nodo.incidenciaPct === null ? <span aria-label="No se puede calcular: no hay costo directo">—</span> : formatearNumero(nodo.incidenciaPct, formato)}
      </td>
      {editable ? (
        <td className="col-acciones">
          <div className="acciones-de-fila">
            <BotonesDeMover tipo="nodo" id={nodo.id} posicion={nodo.posicion} limites={limites} nombre={nodo.nombre} ocupado={ocupado} op={op} />
            <button type="button" className="boton-icono boton-chico" title={esRaiz ? 'Renombrar o reclasificar' : 'Renombrar'} aria-label={`Renombrar ${nodo.nombre}`} disabled={ocupado} onClick={() => op.editarNodo(nodo)}>
              <Icono nombre="editar" tamano={18} />
            </button>
            <button type="button" className="boton-icono boton-chico boton-icono-peligro" title="Eliminar" aria-label={`Eliminar ${nodo.nombre}`} disabled={ocupado} onClick={() => op.eliminarNodo(nodo)}>
              <Icono nombre="basura" tamano={18} />
            </button>
          </div>
        </td>
      ) : null}
    </tr>
  );
}

function FilaDeActividad({
  actividad,
  nivel,
  limites,
  editable,
  ocupado,
  op,
}: {
  actividad: ActividadDeMesa;
  /** El nivel de su capítulo o subcapítulo: la descripción se sangra debajo de él. */
  nivel: number;
  limites: Limites;
  editable: boolean;
  ocupado: boolean;
  op: OperacionesDeMesa;
}) {
  const { arranque } = useSesion();
  const formato = arranque.formatoNumerico;
  const original = paraEditar(actividad.cantidad, formato);
  const [texto, setTexto] = useState(original);
  const [base, setBase] = useState(original);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Si la mesa trae otra cantidad (la guardó otro, o se recargó), manda la mesa.
  if (original !== base) {
    setBase(original);
    setTexto(original);
  }

  const lectura = leerCifra(texto, { nombre: 'la cantidad' });
  const cambiada = texto !== original;
  // Vista previa del costo mientras se escribe (02 §2); la cifra que vale
  // llega con la mesa al guardar.
  const previa = cambiada && 'valor' in lectura ? aTexto(multiplicar(leer(lectura.valor), leer(actividad.precioUnitario))) : null;

  async function guardar() {
    if (!cambiada || guardando) return;
    if ('error' in lectura) {
      setError(lectura.error);
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      await op.cambiarCantidad(actividad, lectura.valor);
    } catch (e) {
      setError(e instanceof ErrorDeApi ? e.message : 'No se guardó la cantidad. Intente de nuevo.');
    } finally {
      setGuardando(false);
    }
  }

  function alTeclear(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void guardar();
    } else if (e.key === 'Escape' && cambiada) {
      e.preventDefault();
      setTexto(original);
      setError(null);
    }
  }

  return (
    <tr className="fila-actividad">
      {/* D-75 · El código del APU, no un número jerárquico. */}
      <td className="col-item"><span className="cifra-codigo cifra-apu">{actividad.codigoApu}</span></td>
      <td className="col-descripcion" style={{ ['--sangria' as string]: `${nivel * 16}px` }}>{actividad.descripcion}</td>
      <td className="col-und">{actividad.unidadSimbolo}</td>
      <td className="cifra col-cantidad">
        {editable ? (
          <span className="cifra-de-linea">
            <input
              aria-label={`Cantidad de ${actividad.descripcion}, en ${actividad.unidadSimbolo}`}
              inputMode="decimal"
              className="cifra-editable campo-compacto"
              value={texto}
              aria-invalid={Boolean(error)}
              disabled={guardando}
              onChange={(e) => {
                setTexto(soloCifra(e.target.value, formato.separadorDecimal));
                if (error) setError(null);
              }}
              onBlur={() => void guardar()}
              onKeyDown={alTeclear}
            />
            {error ? <span className="campo-error" role="alert">{error}</span> : null}
          </span>
        ) : (
          formatearNumero(actividad.cantidad, formato)
        )}
      </td>
      <td className="cifra col-precio">{formatearNumero(actividad.precioUnitario, formato)}</td>
      <td className="cifra col-valor" data-previa={previa ? 'si' : undefined} title={previa ? 'Vista previa: se confirma al guardar' : undefined}>
        {formatearNumero(previa ?? actividad.costoTotal, formato)}
      </td>
      <td className="col-incidencia" />
      {editable ? (
        <td className="col-acciones">
          <div className="acciones-de-fila">
            <BotonesDeMover tipo="actividad" id={actividad.id} posicion={actividad.posicion} limites={limites} nombre={actividad.descripcion} ocupado={ocupado} op={op} />
            <button type="button" className="boton-icono boton-chico boton-icono-peligro" title="Quitar del proyecto" aria-label={`Quitar ${actividad.descripcion}`} disabled={ocupado} onClick={() => op.eliminarActividad(actividad)}>
              <Icono nombre="basura" tamano={18} />
            </button>
          </div>
        </td>
      ) : null}
    </tr>
  );
}

/**
 * Subir y bajar: se manda la posición FINAL, no un «subir» (CONTRATO §1.4).
 * Desde D-75 cada uno se mueve dentro de su grupo: los subcapítulos entre los
 * subcapítulos, las actividades entre las actividades.
 */
function BotonesDeMover({
  tipo,
  id,
  posicion,
  limites,
  nombre,
  ocupado,
  op,
}: {
  tipo: 'nodo' | 'actividad';
  id: string;
  posicion: number;
  limites: Limites;
  nombre: string;
  ocupado: boolean;
  op: OperacionesDeMesa;
}) {
  return (
    <>
      <button type="button" className="boton-icono boton-chico" title="Subir" aria-label={`Subir ${nombre}`} disabled={ocupado || posicion <= limites.primera} onClick={() => op.mover(tipo, id, posicion - 1)}>
        <Icono nombre="subir" tamano={18} />
      </button>
      <button type="button" className="boton-icono boton-chico" title="Bajar" aria-label={`Bajar ${nombre}`} disabled={ocupado || posicion >= limites.ultima} onClick={() => op.mover(tipo, id, posicion + 1)}>
        <Icono nombre="bajar" tamano={18} />
      </button>
    </>
  );
}

/**
 * 02 §8.3 · Agregar una actividad, al final del nivel. Se abre con el icono
 * junto al nombre del capítulo o subcapítulo. Se busca el APU por código o
 * nombre; el código que queda es el del APU. Si no existe, se crea encima sin
 * perder nada, y queda elegido.
 */
function FilaDeAgregar({
  nodo,
  alCerrar,
  op,
}: {
  nodo: NodoDeMesa;
  alCerrar: () => void;
  op: OperacionesDeMesa;
}) {
  const { arranque, puede, puedeEscribir } = useSesion();
  const formato = arranque.formatoNumerico;
  const [elegido, setElegido] = useState<{ id: string; codigo: string; nombre: string; unidadSimbolo: string; costoDirecto: string } | null>(null);
  const [cantidad, setCantidad] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [creandoApu, setCreandoApu] = useState<string | null>(null);

  // Al abrir, el foco entra al buscador: quien pulsó el icono de agregar va a escribir.
  useEffect(() => {
    if (elegido === null) document.getElementById(`agregar-en-${nodo.id}`)?.focus();
  }, [elegido, nodo.id]);

  function cerrar() {
    setElegido(null);
    setCantidad('');
    setError(null);
    alCerrar();
  }

  async function agregar() {
    if (!elegido || enviando) return;
    const l = leerCifra(cantidad, { nombre: 'la cantidad de obra' });
    if ('error' in l) {
      setError(l.error);
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      await op.agregarActividad(nodo.id, elegido.id, l.valor);
      setElegido(null);
      setCantidad('');
      // El buscador queda abierto en el mismo nivel: lo normal es agregar varias.
      window.requestAnimationFrame(() => document.getElementById(`agregar-en-${nodo.id}`)?.focus());
    } catch (e) {
      setError(e instanceof ErrorDeApi ? e.message : 'No se agregó la actividad. Intente de nuevo.');
    } finally {
      setEnviando(false);
    }
  }

  if (!puede('APU.VER')) {
    // Un vacío que puede ser falta de permiso lo dice (DISENO §8).
    return (
      <tr className="fila-agregar">
        <td />
        <td colSpan={7} className="col-agregar">
          <p className="campo-ayuda">
            Para agregar actividades hay que poder consultar los APU, y su rol no tiene ese permiso.{' '}
            <button type="button" className="enlace-de-fila" onClick={cerrar}>Cerrar</button>
          </p>
        </td>
      </tr>
    );
  }

  return (
    <tr className="fila-agregar fila-agregar-abierta">
      <td />
      <td colSpan={7} className="col-agregar" style={{ ['--sangria' as string]: `${nodo.nivel * 16}px` }}>
        <div className="agregar-actividad">
          {/* Dice a qué nivel va: un subcapítulo con hijos deja esta fila pegada
              a la de un nivel más hondo, y sin el código no se sabe cuál es
              cuál. Va en la misma línea del buscador: la fila mide una línea. */}
          <span className="agregar-en-cual">
            Agregar en <span className="cifra-codigo">{nodo.codigoWbs}</span> {nodo.nombre}
          </span>
          {elegido === null ? (
            <Buscador<ApuEncontrado>
              idDelCampo={`agregar-en-${nodo.id}`}
              etiqueta={`Agregar actividad en ${nodo.codigoWbs} ${nodo.nombre}: buscar APU por código o nombre`}
              etiquetaVisible={false}
              buscar={async (q) => (await pedir<{ apus: ApuEncontrado[] }>(conConsulta('/api/apu/buscar', { q, limite: '12' }))).apus}
              clave={(a) => a.id}
              deshabilitada={(a) => (a.activo ? null : 'Inactivo: no se ofrece para proyectos nuevos')}
              pintar={(a) => (
                <span className="opcion-de-busqueda">
                  <span className="cifra-codigo">{a.codigo}</span>
                  <span className="opcion-de-busqueda-nombre">{a.nombre}</span>
                  <span className="dato-de-apoyo">por {a.unidadSimbolo}</span>
                  <span className="cifra">{formatearNumero(a.costoDirecto, formato)}</span>
                </span>
              )}
              alElegir={(a) => {
                setElegido(a);
                window.requestAnimationFrame(() => document.getElementById(`cantidad-en-${nodo.id}`)?.focus());
              }}
              accionExtra={
                puedeEscribir('APU.CREAR') ? { texto: (b) => `Crear Nuevo APU «${b}»`, alElegir: (b) => setCreandoApu(b) } : undefined
              }
            />
          ) : (
            <form className="agregar-elegido" noValidate onSubmit={(e) => {
              e.preventDefault();
              void agregar();
            }}>
              <span className="agregar-elegido-apu">
                <span className="cifra-codigo">{elegido.codigo}</span> {elegido.nombre}
                <span className="dato-de-apoyo">
                  {formatearNumero(elegido.costoDirecto, formato)} por {elegido.unidadSimbolo}
                </span>
              </span>
              <label className="etiqueta-en-linea">
                Cantidad ({elegido.unidadSimbolo})
                <input id={`cantidad-en-${nodo.id}`} inputMode="decimal" className="cifra-editable campo-compacto"
                       value={cantidad} aria-invalid={Boolean(error)} onChange={(e) => {
                         setCantidad(soloCifra(e.target.value, formato.separadorDecimal));
                         if (error) setError(null);
                       }} />
              </label>
              <button type="submit" className="boton boton-secundario" disabled={enviando}>{enviando ? 'Agregando…' : 'Agregar'}</button>
              <button type="button" className="boton boton-secundario" onClick={() => setElegido(null)}>Elegir otro</button>
            </form>
          )}
          <button type="button" className="boton-icono" aria-label="Dejar de agregar actividades aquí" onClick={cerrar}>
            <Icono nombre="cerrar" />
          </button>
        </div>
        {error ? <p className="campo-error" role="alert">{error}</p> : null}
        {creandoApu !== null ? (
          <FormularioDeApu
            nombreInicial={creandoApu}
            alCerrar={() => setCreandoApu(null)}
            alGuardar={(apu: Apu) => {
              // 02 §8.3: el APU nuevo se asigna al nivel actual sin perder el
              // progreso. Queda elegido y el foco va a la cantidad.
              setCreandoApu(null);
              setElegido({ id: apu.id, codigo: apu.codigo, nombre: apu.nombre, unidadSimbolo: apu.unidadSimbolo, costoDirecto: apu.costoDirecto });
              window.requestAnimationFrame(() => document.getElementById(`cantidad-en-${nodo.id}`)?.focus());
            }}
          />
        ) : null}
      </td>
    </tr>
  );
}
