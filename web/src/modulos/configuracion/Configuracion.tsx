import { useEffect, useState, type FormEvent } from 'react';
import { ErrorDeApi, pedir } from '../../api/cliente.ts';
import type { Empresa, MiCuenta, Preferencias, Unidad } from '../../api/tipos.ts';
import { useAvisos } from '../../componentes/Avisos.tsx';
import { BotonVolver } from '../../cascaron/Cascaron.tsx';
import { Campo } from '../../componentes/Campo.tsx';
import { Capa } from '../../componentes/Capa.tsx';
import { Confirmacion } from '../../componentes/Confirmacion.tsx';
import { Icono } from '../../componentes/Icono.tsx';
import { Pestanas } from '../../componentes/Pestanas.tsx';
import { DosColumnas, ErrorDeSeccion, Fichas, Seccion, useLectura } from './piezas.tsx';
import { pestanasDeConfiguracion } from './pestanas.ts';
import { Logotipo } from './Logotipo.tsx';
import { SuscripcionPestana } from './Suscripcion.tsx';
import { Usuarios } from './Usuarios.tsx';
import { PestanaDeCalendarios } from '../calendarios/PestanaDeCalendarios.tsx';
import { leerHorasDelDia } from '../calendarios/Calendarios.tsx';
import { paraEditar, soloCifra } from '../../entrada.ts';
import { DIAS_DE_LA_SEMANA } from '../cronograma/tiempo.ts';
import { formatearNumero } from '../../formato.ts';
import { ir, type PestanaDeConfiguracion } from '../../navegacion.ts';
import { useSesion } from '../../sesion.tsx';
import { cambiarPosicionDelMenu, usePosicionDelMenu } from '../../cascaron/posicionDelMenu.ts';

/*
 * 02 §11 · Configuración, en pestañas. Para el 18 de octubre entran cuatro: mi
 * cuenta, datos de empresa, preferencias (con las unidades de medida, que
 * comparten el permiso CONFIG.PREFERENCIAS), suscripción y usuarios. Usuarios
 * entró el 8 de octubre de 2026, sin correo: el enlace de activación lo
 * entrega el dueño de ConstruSoft hasta la fase 8 (CONTRATO §11.4).
 *
 * Cada pestaña se muestra solo si el rol la permite. Mi cuenta no pide
 * permiso: nadie necesita autorización para ver su nombre ni para cambiar su
 * contraseña.
 */

export function Configuracion({ pestana }: { pestana: PestanaDeConfiguracion | undefined }) {
  const { puede } = useSesion();
  const disponibles = pestanasDeConfiguracion(puede);
  const actual = disponibles.find((p) => p.id === pestana)?.id ?? 'cuenta';

  // Centrada (decisión del dueño, 6 de octubre de 2026). Desde el 15 de
  // octubre, más ancha: las tarjetas van en dos columnas, con un resumen a lo
  // ancho arriba (pedido del dueño).
  return (
    <div className="pantalla-de-configuracion">
      <div className="encabezado-de-pantalla">
        <div className="encabezado-con-volver">
          <BotonVolver a={{ pantalla: 'inicio' }} nombre="Inicio" />
          <h1>Configuración</h1>
        </div>
      </div>
      <Pestanas
        etiqueta="Secciones de configuración"
        idBase="pestana-config"
        pestanas={disponibles}
        actual={actual}
        alCambiar={(id) => ir({ pantalla: 'configuracion', pestana: id })}
      />
      <div id="pestana-config-panel" role="tabpanel" aria-labelledby={`pestana-config-${actual}`} className="panel-de-pestana">
        {actual === 'cuenta' ? <MiCuentaPestana /> : null}
        {actual === 'empresa' ? <EmpresaPestana /> : null}
        {actual === 'preferencias' ? <PreferenciasPestana /> : null}
        {actual === 'calendarios' ? <PestanaDeCalendarios /> : null}
        {actual === 'suscripcion' ? <SuscripcionPestana /> : null}
        {actual === 'usuarios' ? <Usuarios /> : null}
      </div>
    </div>
  );
}

// --- 02 §11.1 · Mi cuenta -------------------------------------------------------

function MiCuentaPestana() {
  const { datos, error, releer } = useLectura<MiCuenta>('/api/configuracion/cuenta');
  const [cambiando, setCambiando] = useState(false);
  const { avisar } = useAvisos();
  if (error) return <ErrorDeSeccion mensaje={error} alReintentar={releer} />;
  if (!datos) return <p className="campo-ayuda">Cargando…</p>;
  return (
    <>
      <Seccion titulo="Mi cuenta">
        <Fichas datos={[
          { etiqueta: 'Nombre', valor: datos.nombre },
          { etiqueta: 'Correo de ingreso', valor: datos.email },
          { etiqueta: 'Rol', valor: datos.rol },
        ]} />
      </Seccion>
      <DosColumnas>
        <Seccion titulo="Contraseña" ayuda="Al cambiarla se cierran las demás sesiones abiertas con su cuenta.">
          <div className="fila-de-botones fila-izquierda">
            <button type="button" className="boton boton-principal" onClick={() => setCambiando(true)}>Cambiar Contraseña</button>
          </div>
        </Seccion>
        <MiPantalla />
      </DosColumnas>
      {cambiando ? (
        <CambiarContrasena
          alCerrar={() => setCambiando(false)}
          alCambiar={() => {
            setCambiando(false);
            avisar('Contraseña cambiada. Las demás sesiones abiertas con su cuenta se cerraron.');
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Cómo ve cada usuario su pantalla (pedido del dueño, 15 de octubre de 2026).
 * Va en Mi cuenta porque es de la persona, no de la empresa, y Mi cuenta la ve
 * todo rol. Se aplica al elegir, sin «Guardar», como el botón del tema.
 */
function MiPantalla() {
  const posicion = usePosicionDelMenu();
  return (
    <Seccion titulo="Mi pantalla" ayuda="Se recuerda en este navegador. En el teléfono el menú sigue en el botón de menú, arriba a la izquierda.">
      <fieldset className="campo grupo-de-opciones">
        <legend className="etiqueta">Posición del menú</legend>
        <label className="opcion">
          <input type="radio" name="posicion-del-menu" checked={posicion === 'izquierda'} onChange={() => cambiarPosicionDelMenu('izquierda')} />
          <span>
            <span className="opcion-titulo">A la izquierda</span>
            <span className="opcion-detalle">Una barra lateral con los módulos, que se puede plegar a iconos con «Ocultar menú».</span>
          </span>
        </label>
        <label className="opcion">
          <input type="radio" name="posicion-del-menu" checked={posicion === 'arriba'} onChange={() => cambiarPosicionDelMenu('arriba')} />
          <span>
            <span className="opcion-titulo">Arriba</span>
            <span className="opcion-detalle">Los módulos van en la barra superior y las pantallas ganan el ancho de la barra lateral.</span>
          </span>
        </label>
      </fieldset>
    </Seccion>
  );
}

function CambiarContrasena({ alCerrar, alCambiar }: { alCerrar: () => void; alCambiar: () => void }) {
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [errores, setErrores] = useState<{ actual?: string; nueva?: string; confirmacion?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar() {
    if (enviando) return;
    const faltan: typeof errores = {};
    if (actual === '') faltan.actual = 'Escriba su contraseña actual.';
    if (nueva.length < 8) faltan.nueva = 'La contraseña nueva necesita al menos 8 caracteres.';
    if (confirmacion !== nueva) faltan.confirmacion = 'Las dos contraseñas nuevas no coinciden. Escríbala igual en los dos campos.';
    setErrores(faltan);
    if (Object.values(faltan).some(Boolean)) return;
    setEnviando(true);
    setError(null);
    try {
      await pedir<void>('/api/configuracion/cuenta/contrasena', { metodo: 'POST', cuerpo: { actual, nueva } });
      alCambiar();
    } catch (e) {
      setEnviando(false);
      // Una actual equivocada es 422 en «actual», no 401 (CONTRATO §7).
      if (e instanceof ErrorDeApi && (e.campo === 'actual' || e.campo === 'nueva')) setErrores({ [e.campo]: e.message });
      else setError(e instanceof ErrorDeApi ? e.message : 'No se cambió la contraseña. Intente de nuevo.');
    }
  }

  return (
    <Capa
      titulo="Cambiar contraseña"
      alCerrar={alCerrar}
      hayCambios={actual !== '' || nueva !== '' || confirmacion !== ''}
      error={error}
      alEnviar={() => void enviar()}
      acciones={(cerrar) => (
        <>
          <button type="button" className="boton boton-secundario" onClick={cerrar} disabled={enviando}>Cancelar</button>
          <button type="submit" className="boton boton-principal" disabled={enviando}>{enviando ? 'Guardando…' : 'Cambiar contraseña'}</button>
        </>
      )}
    >
      <Campo etiqueta="Contraseña actual" error={errores.actual}>
        {(a) => <input {...a} type="password" autoComplete="current-password" value={actual} onChange={(e) => setActual(e.target.value)} />}
      </Campo>
      <Campo etiqueta="Contraseña nueva" ayuda="Mínimo 8 caracteres." error={errores.nueva}>
        {(a) => <input {...a} type="password" autoComplete="new-password" value={nueva} onChange={(e) => setNueva(e.target.value)} />}
      </Campo>
      <Campo etiqueta="Repita la contraseña nueva" error={errores.confirmacion}>
        {(a) => <input {...a} type="password" autoComplete="new-password" value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} />}
      </Campo>
      <p className="campo-ayuda">Al cambiarla se cierran las demás sesiones abiertas con su cuenta, en cualquier equipo.</p>
    </Capa>
  );
}

// --- 02 §11.2 · Datos de empresa ------------------------------------------------

/** Lo que se edita en el formulario; el logo va aparte, con su propio botón. */
type CampoDeEmpresa = Exclude<keyof Empresa, 'logoId'>;

function EmpresaPestana() {
  const { datos, error, releer, poner } = useLectura<Empresa>('/api/configuracion/empresa');
  const { soloLectura, recargar } = useSesion();
  const { avisar } = useAvisos();
  const [form, setForm] = useState<Record<CampoDeEmpresa, string> | null>(null);
  const [errores, setErrores] = useState<Partial<Record<CampoDeEmpresa, string>>>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (datos) {
      setForm({
        razonSocial: datos.razonSocial,
        nit: datos.nit,
        direccion: datos.direccion ?? '',
        telefono: datos.telefono ?? '',
        emailRecuperacion: datos.emailRecuperacion ?? '',
      });
    }
  }, [datos]);

  if (error) return <ErrorDeSeccion mensaje={error} alReintentar={releer} />;
  if (!form) return <p className="campo-ayuda">Cargando…</p>;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!form || enviando) return;
    const faltan: typeof errores = {};
    if (form.razonSocial.trim() === '') faltan.razonSocial = 'Escriba la razón social.';
    if (form.nit.trim() === '') faltan.nit = 'Escriba el NIT.';
    setErrores(faltan);
    if (Object.values(faltan).some(Boolean)) return;
    setEnviando(true);
    setErrorGeneral(null);
    try {
      const guardada = await pedir<Empresa>('/api/configuracion/empresa', { metodo: 'PUT', cuerpo: form });
      poner(guardada);
      await recargar(); // La razón social se ve en la barra superior.
      avisar('Datos de la empresa guardados.');
    } catch (err) {
      if (err instanceof ErrorDeApi && err.campo && err.campo in form) setErrores({ [err.campo]: err.message });
      else setErrorGeneral(err instanceof ErrorDeApi ? err.message : 'No se guardaron los datos. Intente de nuevo.');
    } finally {
      setEnviando(false);
    }
  }

  const campo = (clave: CampoDeEmpresa, etiqueta: string, extra: { tipo?: string; ayuda?: string; autoComplete?: string } = {}) => (
    <Campo etiqueta={etiqueta} error={errores[clave]} {...(extra.ayuda ? { ayuda: extra.ayuda } : {})}>
      {(a) => (
        <input {...a} type={extra.tipo ?? 'text'} autoComplete={extra.autoComplete ?? 'off'} value={form[clave]} disabled={soloLectura}
               onChange={(e) => {
                 setForm({ ...form, [clave]: e.target.value });
                 if (errores[clave]) setErrores((x) => ({ ...x, [clave]: undefined }));
               }} />
      )}
    </Campo>
  );

  return (
    <>
      <Seccion titulo="Datos de empresa" ayuda="El NIT y la razón social se imprimen en el encabezado de los PDF y las exportaciones.">
        {/* Lo guardado, no lo que se está escribiendo: cambia al guardar. */}
        <Fichas datos={[
          { etiqueta: 'Razón social', valor: datos?.razonSocial ?? '' },
          { etiqueta: 'NIT', valor: datos?.nit ?? '' },
        ]} />
      </Seccion>
      <DosColumnas>
        <Seccion titulo="Información legal y de contacto">
          <form className="formulario" onSubmit={enviar} noValidate>
            {errorGeneral ? <p className="aviso-error" role="alert"><Icono nombre="aviso" /><span>{errorGeneral}</span></p> : null}
            <div className="fila-de-campos">
              {campo('razonSocial', 'Razón social', { autoComplete: 'organization' })}
              {campo('nit', 'NIT', { ayuda: 'Único en la plataforma.' })}
            </div>
            <div className="fila-de-campos">
              {campo('direccion', 'Dirección', { autoComplete: 'street-address' })}
              {campo('telefono', 'Teléfono', { tipo: 'tel', autoComplete: 'tel' })}
            </div>
            {campo('emailRecuperacion', 'Correo de recuperación', {
              tipo: 'email',
              ayuda: 'Distinto del correo de ingreso: es por donde se recupera la cuenta si el administrador pierde el acceso.',
            })}
            {soloLectura ? null : (
              <div className="fila-de-botones fila-izquierda">
                <button type="submit" className="boton boton-principal" disabled={enviando}>{enviando ? 'Guardando…' : 'Guardar datos'}</button>
              </div>
            )}
          </form>
        </Seccion>
        <Logotipo />
      </DosColumnas>
    </>
  );
}

// --- 02 §11.5 y §11.6 · Preferencias y unidades -----------------------------------

const SEPARADORES_MILES = [
  { valor: '.', nombre: 'Punto (1.234.567)' },
  { valor: ',', nombre: 'Coma (1,234,567)' },
  { valor: ' ', nombre: 'Espacio (1 234 567)' },
];
const SEPARADORES_DECIMAL = [
  { valor: ',', nombre: 'Coma (0,50)' },
  { valor: '.', nombre: 'Punto (0.50)' },
];

function PreferenciasPestana() {
  const { datos, error, releer, poner } = useLectura<Preferencias>('/api/configuracion/preferencias');
  const { soloLectura, recargar } = useSesion();
  const { avisar } = useAvisos();
  const [form, setForm] = useState<Preferencias | null>(null);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  // Las horas por jornal se escriben como texto, con la coma de la empresa.
  const [jornal, setJornal] = useState('');
  const [errorJornal, setErrorJornal] = useState<string | null>(null);
  const formatoActual = useSesion().arranque.formatoNumerico;

  useEffect(() => {
    if (datos) {
      setForm(datos);
      setJornal(paraEditar(datos.horasPorJornal, formatoActual));
    }
  }, [datos, formatoActual]);

  if (error) return <ErrorDeSeccion mensaje={error} alReintentar={releer} />;
  if (!form) return <p className="campo-ayuda">Cargando…</p>;

  const iguales = form.separadorMiles === form.separadorDecimal;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!form || enviando || iguales) return;
    const h = leerHorasDelDia(jornal, 'las horas por jornal', '1');
    if ('error' in h) {
      setErrorJornal(h.error);
      return;
    }
    setEnviando(true);
    setErrorGeneral(null);
    try {
      const guardadas = await pedir<Preferencias>('/api/configuracion/preferencias', { metodo: 'PUT', cuerpo: { ...form, horasPorJornal: h.valor } });
      poner(guardadas);
      // El formato numérico sale del arranque: se relee para que toda cifra cambie ya.
      await recargar();
      avisar('Preferencias guardadas. Las cifras ya se muestran con el formato nuevo.');
    } catch (err) {
      if (err instanceof ErrorDeApi && err.campo === 'horasPorJornal') setErrorJornal(err.message);
      else setErrorGeneral(err instanceof ErrorDeApi ? err.message : 'No se guardaron las preferencias. Intente de nuevo.');
    } finally {
      setEnviando(false);
    }
  }

  const guardadas = datos ?? form;
  const formatoGuardado = { separadorMiles: guardadas.separadorMiles, separadorDecimal: guardadas.separadorDecimal, decimalesVista: guardadas.decimalesVista };
  const avisosActivos = [guardadas.notifVencimiento, guardadas.notifCambioEstado].filter(Boolean).length;

  return (
    <>
      <Seccion titulo="Preferencias del sistema">
        {/* Lo guardado: cambia al guardar, no mientras se elige. */}
        <Fichas datos={[
          { etiqueta: 'Moneda base', valor: guardadas.monedaBase === 'COP' ? 'COP · Peso colombiano' : guardadas.monedaBase },
          { etiqueta: 'Así se ve una cifra', valor: <span className="cifra">{formatearNumero('180590155.4567', formatoGuardado)}</span> },
          { etiqueta: 'Avisos por correo', valor: `${avisosActivos} de 2 activos` },
          { etiqueta: 'Jornal', valor: `${paraEditar(guardadas.horasPorJornal, formatoGuardado)} h · semana desde el ${(DIAS_DE_LA_SEMANA[guardadas.inicioSemana - 1] ?? '').toLowerCase()}` },
        ]} />
      </Seccion>
      {/* Un solo formulario para las dos tarjetas: un «Guardar» guarda las dos. */}
      <form className="formulario" onSubmit={enviar} noValidate>
        <DosColumnas>
          <Seccion titulo="Formato de números">
            <fieldset className="grupo-sin-borde formulario" disabled={soloLectura}>
              {/* En media columna no caben tres: la moneda va sola y los separadores juntos. */}
              <Campo etiqueta="Moneda base" ayuda="Se puede cambiar solo mientras no haya recursos, APU ni proyectos.">
                {(a) => (
                  <select {...a} value={form.monedaBase} onChange={(e) => setForm({ ...form, monedaBase: e.target.value })}>
                    <option value="COP">COP · Peso colombiano</option>
                  </select>
                )}
              </Campo>
              <div className="fila-de-campos">
                <Campo etiqueta="Separador de miles" error={iguales ? 'Los dos separadores no pueden ser iguales.' : null}>
                  {(a) => (
                    <select {...a} value={form.separadorMiles} onChange={(e) => setForm({ ...form, separadorMiles: e.target.value })}>
                      {SEPARADORES_MILES.map((s) => <option key={s.valor} value={s.valor}>{s.nombre}</option>)}
                    </select>
                  )}
                </Campo>
                <Campo etiqueta="Separador decimal">
                  {(a) => (
                    <select {...a} value={form.separadorDecimal} onChange={(e) => setForm({ ...form, separadorDecimal: e.target.value })}>
                      {SEPARADORES_DECIMAL.map((s) => <option key={s.valor} value={s.valor}>{s.nombre}</option>)}
                    </select>
                  )}
                </Campo>
              </div>
              <fieldset className="campo grupo-en-linea">
                <legend className="etiqueta">Decimales a mostrar, en pantalla y en impresión</legend>
                {([0, 1, 2] as const).map((n) => (
                  <label key={n} className="casilla">
                    <input type="radio" name="decimales" checked={form.decimalesVista === n} onChange={() => setForm({ ...form, decimalesVista: n })} />
                    <span>{n}</span>
                  </label>
                ))}
              </fieldset>
              <div className="vista-previa-formato">
                <span className="etiqueta">Así se verá una cifra</span>
                <span className="cifra cifra-grande">
                  {iguales ? '—' : formatearNumero('180590155.4567', { separadorMiles: form.separadorMiles, separadorDecimal: form.separadorDecimal, decimalesVista: form.decimalesVista })}
                </span>
              </div>
            </fieldset>
          </Seccion>
          <div className="columna-de-tarjetas">
          <Seccion titulo="Programación de obra" ayuda="Las usa el cronograma. Cada proyecto se lleva las horas por jornal al crearse: cambiarlas aquí no mueve los proyectos que ya existen.">
            <fieldset className="grupo-sin-borde formulario" disabled={soloLectura}>
              <div className="fila-de-campos">
                <Campo etiqueta="Horas por jornal" ayuda="Lo que dura el «día» del rendimiento de un APU. De 1 a 24." error={errorJornal}>
                  {(a) => (
                    <input {...a} className="campo-cifra-corto" inputMode="decimal" autoComplete="off" value={jornal} onChange={(e) => { setJornal(soloCifra(e.target.value, formatoActual.separadorDecimal)); setErrorJornal(null); }} />
                  )}
                </Campo>
                <Campo etiqueta="La semana empieza el" ayuda="Para la curva semanal y el Gantt.">
                  {(a) => (
                    <select {...a} value={form.inicioSemana} onChange={(e) => setForm({ ...form, inicioSemana: e.target.selectedIndex + 1 })}>
                      {DIAS_DE_LA_SEMANA.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
                    </select>
                  )}
                </Campo>
              </div>
            </fieldset>
          </Seccion>
          <Seccion titulo="Avisos por correo">
            <fieldset className="campo grupo-sin-borde" disabled={soloLectura}>
              <legend className="solo-lectores">Avisos por correo</legend>
              <label className="casilla">
                <input type="checkbox" checked={form.notifVencimiento} onChange={(e) => setForm({ ...form, notifVencimiento: e.target.checked })} />
                <span>Fin del período de prueba (dos días antes) y vencimiento de la suscripción (cinco días antes)</span>
              </label>
              <label className="casilla">
                <input type="checkbox" checked={form.notifCambioEstado} onChange={(e) => setForm({ ...form, notifCambioEstado: e.target.checked })} />
                <span>Cambios de estado de los proyectos</span>
              </label>
            </fieldset>
            {errorGeneral ? <p className="aviso-error" role="alert"><Icono nombre="aviso" /><span>{errorGeneral}</span></p> : null}
            {soloLectura ? null : (
              <div className="fila-de-botones fila-izquierda">
                <button type="submit" className="boton boton-principal" disabled={enviando || iguales}>{enviando ? 'Guardando…' : 'Guardar preferencias'}</button>
              </div>
            )}
          </Seccion>
          </div>
        </DosColumnas>
      </form>
      <Unidades />
    </>
  );
}

function Unidades() {
  const { datos, error, releer } = useLectura<{ unidades: Unidad[] }>('/api/configuracion/unidades');
  const { soloLectura } = useSesion();
  const { avisar } = useAvisos();
  const [editando, setEditando] = useState<Unidad | 'nueva' | null>(null);
  const [borrando, setBorrando] = useState<Unidad | null>(null);

  return (
    <Seccion
      titulo="Unidades de medida"
      ayuda="La lista oficial de su empresa. Las que cree quedan disponibles de inmediato en Recursos y APU. «Kg» y «kg» son el mismo símbolo."
      accion={datos && !soloLectura ? (
        <button type="button" className="boton boton-secundario" onClick={() => setEditando('nueva')}>
          <Icono nombre="mas" />
          Agregar unidad
        </button>
      ) : undefined}
    >
      {error ? <ErrorDeSeccion mensaje={error} alReintentar={releer} /> : null}
      {!datos && !error ? <p className="campo-ayuda">Cargando…</p> : null}
      {datos ? (
        <>
          <div className="tarjeta-tabla tabla-con-borde">
            <table className="tabla">
              <caption className="solo-lectores">Unidades de medida</caption>
              <thead>
                <tr>
                  <th scope="col">Símbolo</th>
                  <th scope="col">Descripción</th>
                  {soloLectura ? null : <th scope="col"><span className="solo-lectores">Acciones</span></th>}
                </tr>
              </thead>
              <tbody>
                {datos.unidades.map((u) => (
                  <tr key={u.id}>
                    <td className="col-codigo"><span className="cifra-codigo">{u.simbolo}</span></td>
                    <td>{u.descripcion}</td>
                    {soloLectura ? null : (
                      <td className="col-acciones">
                        <div className="acciones-de-fila">
                          <button type="button" className="boton-icono boton-chico" aria-label={`Editar ${u.simbolo}`} title="Editar" onClick={() => setEditando(u)}>
                            <Icono nombre="editar" tamano={18} />
                          </button>
                          <button type="button" className="boton-icono boton-chico boton-icono-peligro" aria-label={`Eliminar ${u.simbolo}`} title="Eliminar" onClick={() => setBorrando(u)}>
                            <Icono nombre="basura" tamano={18} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
      {editando ? (
        <FormularioDeUnidad
          unidad={editando === 'nueva' ? null : editando}
          alCerrar={() => setEditando(null)}
          alGuardar={(u, nueva) => {
            setEditando(null);
            avisar(nueva ? `Unidad «${u.simbolo}» creada.` : `Unidad «${u.simbolo}» guardada.`);
            releer();
          }}
        />
      ) : null}
      {borrando ? (
        <Confirmacion
          titulo={`Eliminar la unidad «${borrando.simbolo}»`}
          textoConfirmar="Eliminar unidad"
          textoEnviando="Eliminando…"
          peligroso
          alCerrar={() => setBorrando(null)}
          alConfirmar={async () => {
            await pedir<void>(`/api/configuracion/unidades/${encodeURIComponent(borrando.id)}`, { metodo: 'DELETE' });
            avisar(`Unidad «${borrando.simbolo}» eliminada.`);
            setBorrando(null);
            releer();
          }}
        >
          <p>Se eliminará «{borrando.simbolo} · {borrando.descripcion}». Si algún recurso o APU la usa, el sistema no lo permitirá y le dirá dónde está en uso.</p>
        </Confirmacion>
      ) : null}
    </Seccion>
  );
}

function FormularioDeUnidad({ unidad, alCerrar, alGuardar }: { unidad: Unidad | null; alCerrar: () => void; alGuardar: (u: Unidad, nueva: boolean) => void }) {
  const [simbolo, setSimbolo] = useState(unidad?.simbolo ?? '');
  const [descripcion, setDescripcion] = useState(unidad?.descripcion ?? '');
  const [errores, setErrores] = useState<{ simbolo?: string; descripcion?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar() {
    if (enviando) return;
    const faltan: typeof errores = {};
    if (simbolo.trim() === '') faltan.simbolo = 'Escriba el símbolo.';
    if (descripcion.trim() === '') faltan.descripcion = 'Escriba la descripción.';
    setErrores(faltan);
    if (faltan.simbolo || faltan.descripcion) return;
    setEnviando(true);
    setError(null);
    try {
      const cuerpo = { simbolo: simbolo.trim(), descripcion: descripcion.trim() };
      const u = unidad
        ? await pedir<Unidad>(`/api/configuracion/unidades/${encodeURIComponent(unidad.id)}`, { metodo: 'PUT', cuerpo })
        : await pedir<Unidad>('/api/configuracion/unidades', { metodo: 'POST', cuerpo });
      alGuardar(u, unidad === null);
    } catch (e) {
      setEnviando(false);
      if (e instanceof ErrorDeApi && (e.campo === 'simbolo' || e.campo === 'descripcion')) setErrores({ [e.campo]: e.message });
      else setError(e instanceof ErrorDeApi ? e.message : 'No se guardó la unidad. Intente de nuevo.');
    }
  }

  return (
    <Capa
      titulo={unidad ? `Editar unidad «${unidad.simbolo}»` : 'Agregar unidad de medida'}
      alCerrar={alCerrar}
      hayCambios={simbolo !== (unidad?.simbolo ?? '') || descripcion !== (unidad?.descripcion ?? '')}
      error={error}
      alEnviar={() => void enviar()}
      acciones={(cerrar) => (
        <>
          <button type="button" className="boton boton-secundario" onClick={cerrar} disabled={enviando}>Cancelar</button>
          <button type="submit" className="boton boton-principal" disabled={enviando}>{enviando ? 'Guardando…' : unidad ? 'Guardar unidad' : 'Agregar unidad'}</button>
        </>
      )}
    >
      <Campo etiqueta="Símbolo" ayuda="Por ejemplo: m², Kg, Jr." error={errores.simbolo}>
        {(a) => <input {...a} autoComplete="off" spellCheck={false} value={simbolo} onChange={(e) => setSimbolo(e.target.value)} />}
      </Campo>
      <Campo etiqueta="Descripción" error={errores.descripcion}>
        {(a) => <input {...a} autoComplete="off" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />}
      </Campo>
    </Capa>
  );
}
