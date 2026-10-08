import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ErrorDeApi, pedir } from '../../api/cliente.ts';
import type { DetalleDeSuscripcion, Empresa, EstadoSuscripcion, MiCuenta, Preferencias, Unidad } from '../../api/tipos.ts';
import { useAvisos } from '../../componentes/Avisos.tsx';
import { BotonVolver } from '../../cascaron/Cascaron.tsx';
import { Campo } from '../../componentes/Campo.tsx';
import { Capa } from '../../componentes/Capa.tsx';
import { Confirmacion } from '../../componentes/Confirmacion.tsx';
import { Icono } from '../../componentes/Icono.tsx';
import { Pestanas } from '../../componentes/Pestanas.tsx';
import { ErrorDeSeccion, Seccion, useLectura } from './piezas.tsx';
import { Usuarios } from './Usuarios.tsx';
import { formatearNumero } from '../../formato.ts';
import { ir, type PestanaDeConfiguracion } from '../../navegacion.ts';
import { useSesion } from '../../sesion.tsx';

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
  const disponibles = [
    { id: 'cuenta' as const, nombre: 'Mi cuenta', visible: true },
    { id: 'empresa' as const, nombre: 'Datos de empresa', visible: puede('CONFIG.EMPRESA') },
    { id: 'preferencias' as const, nombre: 'Preferencias y unidades', visible: puede('CONFIG.PREFERENCIAS') },
    { id: 'suscripcion' as const, nombre: 'Suscripción', visible: puede('CONFIG.SUSCRIPCION') },
    { id: 'usuarios' as const, nombre: 'Usuarios', visible: puede('USUARIOS.GESTIONAR') },
  ].filter((p) => p.visible);
  const actual = disponibles.find((p) => p.id === pestana)?.id ?? 'cuenta';

  // Centrada y con ancho de lectura (decisión del dueño, 6 de octubre de
  // 2026): son formularios y datos sueltos, no una tabla que necesite ancho.
  return (
    <div className="pantalla-centrada">
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
    <Seccion titulo="Mi cuenta">
      <dl className="datos-estaticos">
        <div><dt>Nombre</dt><dd>{datos.nombre}</dd></div>
        <div><dt>Correo de ingreso</dt><dd>{datos.email}</dd></div>
        <div><dt>Rol</dt><dd>{datos.rol}</dd></div>
      </dl>
      <div className="fila-de-botones fila-izquierda">
        <button type="button" className="boton boton-principal" onClick={() => setCambiando(true)}>Cambiar Contraseña</button>
      </div>
      {cambiando ? (
        <CambiarContrasena
          alCerrar={() => setCambiando(false)}
          alCambiar={() => {
            setCambiando(false);
            avisar('Contraseña cambiada. Las demás sesiones abiertas con su cuenta se cerraron.');
          }}
        />
      ) : null}
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

function EmpresaPestana() {
  const { datos, error, releer, poner } = useLectura<Empresa>('/api/configuracion/empresa');
  const { soloLectura, recargar } = useSesion();
  const { avisar } = useAvisos();
  const [form, setForm] = useState<Record<keyof Empresa, string> | null>(null);
  const [errores, setErrores] = useState<Partial<Record<keyof Empresa, string>>>({});
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

  const campo = (clave: keyof Empresa, etiqueta: string, extra: { tipo?: string; ayuda?: string; autoComplete?: string } = {}) => (
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
    <Seccion titulo="Datos de empresa" ayuda="El NIT y la razón social se imprimen en el encabezado de los PDF y las exportaciones.">
      <form className="formulario formulario-ancho" onSubmit={enviar} noValidate>
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
        <p className="nota-pendiente">
          <Icono nombre="reloj" />
          <span>La carga del logotipo llega en una próxima versión. Mientras tanto, los PDF salen con la razón social y el NIT.</span>
        </p>
        {soloLectura ? null : (
          <div className="fila-de-botones fila-izquierda">
            <button type="submit" className="boton boton-principal" disabled={enviando}>{enviando ? 'Guardando…' : 'Guardar datos'}</button>
          </div>
        )}
      </form>
    </Seccion>
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

  useEffect(() => {
    if (datos) setForm(datos);
  }, [datos]);

  if (error) return <ErrorDeSeccion mensaje={error} alReintentar={releer} />;
  if (!form) return <p className="campo-ayuda">Cargando…</p>;

  const iguales = form.separadorMiles === form.separadorDecimal;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!form || enviando || iguales) return;
    setEnviando(true);
    setErrorGeneral(null);
    try {
      const guardadas = await pedir<Preferencias>('/api/configuracion/preferencias', { metodo: 'PUT', cuerpo: form });
      poner(guardadas);
      // El formato numérico sale del arranque: se relee para que toda cifra cambie ya.
      await recargar();
      avisar('Preferencias guardadas. Las cifras ya se muestran con el formato nuevo.');
    } catch (err) {
      setErrorGeneral(err instanceof ErrorDeApi ? err.message : 'No se guardaron las preferencias. Intente de nuevo.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <Seccion titulo="Preferencias del sistema">
        <form className="formulario formulario-ancho" onSubmit={enviar} noValidate>
          {errorGeneral ? <p className="aviso-error" role="alert"><Icono nombre="aviso" /><span>{errorGeneral}</span></p> : null}
          <fieldset className="grupo-sin-borde" disabled={soloLectura}>
            <div className="fila-de-campos fila-de-tres">
              <Campo etiqueta="Moneda base" ayuda="Se puede cambiar solo mientras no haya recursos, APU ni proyectos.">
                {(a) => (
                  <select {...a} value={form.monedaBase} onChange={(e) => setForm({ ...form, monedaBase: e.target.value })}>
                    <option value="COP">COP · Peso colombiano</option>
                  </select>
                )}
              </Campo>
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
            <fieldset className="campo grupo-sin-borde">
              <legend className="etiqueta">Avisos por correo</legend>
              <label className="casilla">
                <input type="checkbox" checked={form.notifVencimiento} onChange={(e) => setForm({ ...form, notifVencimiento: e.target.checked })} />
                <span>Fin del período de prueba (dos días antes) y vencimiento de la suscripción (cinco días antes)</span>
              </label>
              <label className="casilla">
                <input type="checkbox" checked={form.notifCambioEstado} onChange={(e) => setForm({ ...form, notifCambioEstado: e.target.checked })} />
                <span>Cambios de estado de los proyectos</span>
              </label>
            </fieldset>
          </fieldset>
          {soloLectura ? null : (
            <div className="fila-de-botones fila-izquierda">
              <button type="submit" className="boton boton-principal" disabled={enviando || iguales}>{enviando ? 'Guardando…' : 'Guardar preferencias'}</button>
            </div>
          )}
        </form>
      </Seccion>
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
    >
      {error ? <ErrorDeSeccion mensaje={error} alReintentar={releer} /> : null}
      {!datos && !error ? <p className="campo-ayuda">Cargando…</p> : null}
      {datos ? (
        <>
          {soloLectura ? null : (
            <div className="fila-de-botones fila-izquierda">
              <button type="button" className="boton boton-secundario" onClick={() => setEditando('nueva')}>
                <Icono nombre="mas" />
                Agregar unidad
              </button>
            </div>
          )}
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

// --- 02 §11.3 · Suscripción --------------------------------------------------------

const NOMBRES_DE_ESTADO: Record<EstadoSuscripcion, string> = {
  EN_PRUEBA: 'En prueba',
  ACTIVA: 'Activa',
  VENCIDA: 'Vencida',
  CANCELADA: 'Cancelada',
  SUSPENDIDA: 'Suspendida',
  SIN_SUSCRIPCION: 'Sin suscripción',
};

/** Una fecha sin hora («aaaa-mm-dd»), sin pasar por la medianoche UTC. */
function fechaSola(texto: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto);
  if (!m) return texto;
  const [, a, mes, d] = m;
  // eslint-disable-next-line no-restricted-globals -- partes de una fecha, no dinero
  const fecha = new Date(parseInt(a ?? '0', 10), parseInt(mes ?? '1', 10) - 1, parseInt(d ?? '1', 10));
  return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }).format(fecha);
}

function SuscripcionPestana() {
  const { datos, error, releer } = useLectura<DetalleDeSuscripcion>('/api/configuracion/suscripcion');
  const { arranque } = useSesion();
  const formato = arranque.formatoNumerico;
  if (error) return <ErrorDeSeccion mensaje={error} alReintentar={releer} />;
  if (!datos) return <p className="campo-ayuda">Cargando…</p>;

  const dias = datos.diasRestantes;
  return (
    <>
      <Seccion titulo="Suscripción">
        <dl className="datos-estaticos datos-en-rejilla">
          <div><dt>Plan</dt><dd>{datos.plan}</dd></div>
          <div>
            <dt>Estado</dt>
            <dd><span className="insignia insignia-suscripcion" data-estado={datos.estado}>{NOMBRES_DE_ESTADO[datos.estado]}</span></dd>
          </div>
          <div><dt>Vence el</dt><dd>{fechaSola(datos.venceEl)}</dd></div>
          <div><dt>Días restantes</dt><dd className="cifra-izquierda">{dias > 0 ? dias : 0}</dd></div>
        </dl>
        {datos.estado === 'SUSPENDIDA' ? (
          <p className="nota-pendiente">
            <Icono nombre="candado" />
            <span>El acceso de su empresa fue suspendido por la administración de ConstruSoft. Esto no se resuelve con un pago: escríbanos para conocer el motivo.</span>
          </p>
        ) : (
          <div className="como-pagar">
            <h3>Cómo pagar</h3>
            <p>
              {datos.estado === 'EN_PRUEBA'
                ? `Le ${dias === 1 ? 'queda 1 día' : `quedan ${dias} días`} de prueba. `
                : ''}
              El pago se hace por transferencia o PSE, fuera de la aplicación; el equipo de ConstruSoft lo registra y la fecha de
              vencimiento se extiende en ese momento. Mientras la suscripción no esté vigente, la empresa queda en solo lectura:
              sus datos se conservan y se pueden exportar.
            </p>
          </div>
        )}
      </Seccion>
      <Seccion titulo="Historial de facturación">
        {datos.pagos.length === 0 ? (
          <p className="campo-ayuda">Todavía no hay pagos registrados.</p>
        ) : (
          <div className="tarjeta-tabla tabla-con-borde">
            <table className="tabla">
              <caption className="solo-lectores">Pagos</caption>
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Concepto</th>
                  <th scope="col" className="cifra">Monto</th>
                  <th scope="col">Método</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Factura</th>
                </tr>
              </thead>
              <tbody>
                {datos.pagos.map((p) => (
                  <tr key={p.id}>
                    <td>{fechaSola(p.fecha)}</td>
                    <td>{p.concepto}</td>
                    <td className="cifra">{formatearNumero(p.monto, formato)} {p.moneda}</td>
                    <td>{p.metodo}</td>
                    <td>{p.estado}</td>
                    <td>{p.facturaNumero ?? <span className="dato-de-apoyo">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="campo-ayuda">El comprobante en PDF de cada pago llega con el módulo de cobro.</p>
      </Seccion>
    </>
  );
}
