import { useEffect, useState } from 'react';
import { ErrorDeApi, pedir } from '../../api/cliente.ts';
import { useAvisos } from '../../componentes/Avisos.tsx';
import { Campo } from '../../componentes/Campo.tsx';
import { Capa } from '../../componentes/Capa.tsx';
import { Icono } from '../../componentes/Icono.tsx';
import { leerCifra, soloCifra } from '../../entrada.ts';
import { fechaSola, hoy, NOMBRE_DE_METODO, NOMBRE_DE_PLAN, SEPARADOR_DECIMAL } from '../comun.tsx';
import type { CodigoDePlan, FichaDeEmpresa, MetodoDePago } from '../tipos.ts';

/*
 * Las capas de la ficha de una empresa (CONTRATO §12.3). Cada una dice lo que
 * va a pasar antes de pasar, y las que dejan huella en la bitácora piden el
 * motivo con las palabras de lo que se registra.
 */

const rutaDe = (ficha: FichaDeEmpresa) => `/api/superadmin/empresas/${encodeURIComponent(ficha.empresa.id)}`;

// --- Registrar un pago (RF-SAD-09, RF-SAD-12) -------------------------------------

const PERIODOS = [1, 3, 6, 12];
const TIPOS_DE_SOPORTE = ['image/png', 'image/jpeg', 'application/pdf'];
const MAXIMO_SOPORTE = 5 * 1024 * 1024;

export function RegistrarPago({ ficha, alCerrar, alRegistrar }: { ficha: FichaDeEmpresa; alCerrar: () => void; alRegistrar: (f: FichaDeEmpresa) => void }) {
  const plan = ficha.suscripcion?.planCodigo ?? 'PERSONAL';
  const [fecha, setFecha] = useState(hoy());
  const [monto, setMonto] = useState('');
  const [metodo, setMetodo] = useState<MetodoDePago>('TRANSFERENCIA');
  const [referencia, setReferencia] = useState('');
  const [modo, setModo] = useState<'periodo' | 'fecha'>('periodo');
  const [periodo, setPeriodo] = useState(1);
  const [cubreHasta, setCubreHasta] = useState('');
  const [concepto, setConcepto] = useState('');
  const [conceptoTocado, setConceptoTocado] = useState(false);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [propuesta, setPropuesta] = useState<string | null>(null);
  const [errores, setErrores] = useState<Record<string, string | undefined>>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // El concepto se propone solo mientras nadie lo haya escrito.
  const conceptoSugerido = `Suscripción plan ${NOMBRE_DE_PLAN[plan]}${modo === 'periodo' ? ` · ${periodo === 1 ? '1 mes' : `${periodo} meses`}` : ''}`;
  const conceptoFinal = conceptoTocado ? concepto : conceptoSugerido;

  // La fecha que resultaría la calcula la base (D-36): sumar meses tiene casos
  // borde, como el 31 de enero más un mes, y la regla vive allá.
  useEffect(() => {
    if (modo !== 'periodo') return;
    let vigente = true;
    setPropuesta(null);
    pedir<{ cubreHasta: string }>(`${rutaDe(ficha)}/pagos/propuesta?periodoMeses=${periodo}`)
      .then((r) => vigente && setPropuesta(r.cubreHasta))
      .catch(() => vigente && setPropuesta(null));
    return () => {
      vigente = false;
    };
  }, [ficha, modo, periodo]);

  async function enviar() {
    if (enviando) return;
    const faltan: Record<string, string | undefined> = {};
    const lectura = leerCifra(monto, { decimales: 2, nombre: 'el monto' });
    if ('error' in lectura) faltan.monto = lectura.error;
    if (fecha === '') faltan.fecha = 'Escriba la fecha en que se recibió el pago.';
    if (fecha > hoy()) faltan.fecha = 'La fecha del pago no puede ser futura.';
    if (conceptoFinal.trim() === '') faltan.concepto = 'Escriba el concepto.';
    if (modo === 'fecha' && cubreHasta === '') faltan.cubreHasta = 'Escriba hasta qué fecha queda cubierta la suscripción.';
    if (modo === 'fecha' && cubreHasta !== '' && cubreHasta < hoy()) faltan.cubreHasta = 'Esa fecha ya pasó: el pago no devolvería el acceso.';
    if (archivo && !TIPOS_DE_SOPORTE.includes(archivo.type)) faltan.soporte = 'El comprobante tiene que ser una imagen PNG o JPEG, o un PDF.';
    if (archivo && archivo.size > MAXIMO_SOPORTE) faltan.soporte = 'El comprobante pesa más de 5 MB.';
    setErrores(faltan);
    if (Object.values(faltan).some(Boolean) || 'error' in lectura) return;

    setEnviando(true);
    setError(null);
    try {
      const soporteId = archivo ? (await pedir<{ id: string }>('/api/superadmin/soportes', { metodo: 'POST', archivo })).id : null;
      const ficha2 = await pedir<FichaDeEmpresa>(`${rutaDe(ficha)}/pagos`, {
        metodo: 'POST',
        cuerpo: {
          fecha,
          concepto: conceptoFinal.trim(),
          monto: lectura.valor,
          metodo,
          referencia: referencia.trim() === '' ? null : referencia.trim(),
          periodoMeses: modo === 'periodo' ? periodo : null,
          cubreHasta: modo === 'fecha' ? cubreHasta : null,
          soporteId,
        },
      });
      alRegistrar(ficha2);
    } catch (e) {
      setEnviando(false);
      if (e instanceof ErrorDeApi && e.campo) setErrores({ [e.campo]: e.message });
      else setError(e instanceof ErrorDeApi ? e.message : 'No se registró el pago. Intente de nuevo.');
    }
  }

  const vence = modo === 'periodo' ? propuesta : cubreHasta || null;
  const hayCambios = monto !== '' || referencia !== '' || archivo !== null || conceptoTocado;

  return (
    <Capa
      titulo={`Registrar un pago de ${ficha.empresa.razonSocial}`}
      alCerrar={alCerrar}
      hayCambios={hayCambios}
      error={error}
      alEnviar={() => void enviar()}
      acciones={(cerrar) => (
        <>
          <button type="button" className="boton boton-secundario" onClick={cerrar} disabled={enviando}>Cancelar</button>
          <button type="submit" className="boton boton-principal" disabled={enviando}>{enviando ? 'Registrando…' : 'Registrar pago'}</button>
        </>
      )}
    >
      <p className="campo-ayuda">
        El pago se recibió por fuera del sistema. Registrarlo deja la suscripción activa hasta la fecha que resulte, y queda en la bitácora con su nombre.
      </p>
      <div className="fila-de-campos">
        <Campo etiqueta="Monto recibido (COP)" error={errores.monto}>
          {(a) => <input {...a} inputMode="decimal" autoComplete="off" value={monto} onChange={(e) => setMonto(soloCifra(e.target.value, SEPARADOR_DECIMAL))} />}
        </Campo>
        <Campo etiqueta="Fecha del pago" error={errores.fecha}>
          {(a) => <input {...a} type="date" max={hoy()} value={fecha} onChange={(e) => setFecha(e.target.value)} />}
        </Campo>
      </div>
      <div className="fila-de-campos">
        <Campo etiqueta="Método">
          {(a) => (
            <select {...a} value={metodo} onChange={(e) => setMetodo(e.target.value as MetodoDePago)}>
              {(Object.keys(NOMBRE_DE_METODO) as MetodoDePago[]).map((m) => <option key={m} value={m}>{NOMBRE_DE_METODO[m]}</option>)}
            </select>
          )}
        </Campo>
        <Campo etiqueta="Referencia" ayuda="El número de la transferencia o del PSE, si lo hay.">
          {(a) => <input {...a} autoComplete="off" value={referencia} onChange={(e) => setReferencia(e.target.value)} />}
        </Campo>
      </div>

      <fieldset className="grupo-de-opciones">
        <legend>¿Qué cubre?</legend>
        <label className="opcion">
          <input type="radio" name="modo" checked={modo === 'periodo'} onChange={() => setModo('periodo')} />
          <span>Un período</span>
        </label>
        {modo === 'periodo' ? (
          <div className="opciones-de-periodo" role="group" aria-label="Meses">
            {PERIODOS.map((n) => (
              <button key={n} type="button" className="boton boton-secundario boton-de-periodo" aria-pressed={periodo === n} onClick={() => setPeriodo(n)}>
                {n === 1 ? '1 mes' : `${n} meses`}
              </button>
            ))}
          </div>
        ) : null}
        <label className="opcion">
          <input type="radio" name="modo" checked={modo === 'fecha'} onChange={() => setModo('fecha')} />
          <span>Hasta una fecha que yo indico</span>
        </label>
        {modo === 'fecha' ? (
          <Campo etiqueta="Cubre hasta" error={errores.cubreHasta}>
            {(a) => <input {...a} type="date" min={hoy()} value={cubreHasta} onChange={(e) => setCubreHasta(e.target.value)} />}
          </Campo>
        ) : null}
      </fieldset>

      <p className="resultado-del-pago" aria-live="polite">
        <Icono nombre="visto" />
        <span>
          {vence
            ? <>Queda vigente hasta el <strong>{fechaSola(vence)}</strong>.</>
            : modo === 'periodo' ? 'Calculando hasta cuándo queda vigente…' : 'Elija la fecha hasta la que queda cubierta.'}
          {modo === 'periodo' ? ' Se cuenta desde el vencimiento actual o desde hoy, lo que sea más tarde: quien paga tarde no pierde días.' : ''}
        </span>
      </p>

      <Campo etiqueta="Concepto" error={errores.concepto}>
        {(a) => <input {...a} autoComplete="off" value={conceptoFinal} onChange={(e) => { setConceptoTocado(true); setConcepto(e.target.value); }} />}
      </Campo>
      <Campo etiqueta="Comprobante (opcional)" ayuda="La foto o el PDF que mandó el cliente. PNG, JPEG o PDF, hasta 5 MB." error={errores.soporte}>
        {(a) => <input {...a} className="campo-archivo" type="file" accept="image/png,image/jpeg,application/pdf" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />}
      </Campo>
    </Capa>
  );
}

// --- Cambiar plan o vencimiento (RF-SAD-06) -----------------------------------------

export function CambiarSuscripcion({ ficha, alCerrar, alGuardar }: { ficha: FichaDeEmpresa; alCerrar: () => void; alGuardar: (f: FichaDeEmpresa) => void }) {
  const s = ficha.suscripcion;
  const [plan, setPlan] = useState<CodigoDePlan>(s?.planCodigo ?? 'PERSONAL');
  const [venceEl, setVenceEl] = useState(s?.venceEl ?? hoy());
  const [motivo, setMotivo] = useState('');
  const [errores, setErrores] = useState<Record<string, string | undefined>>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const iguales = plan === s?.planCodigo && venceEl === s.venceEl;

  async function enviar() {
    if (enviando) return;
    const faltan: Record<string, string | undefined> = {};
    if (iguales) faltan.venceEl = 'Cambie el plan o la fecha; así como está no hay nada que guardar.';
    if (venceEl < hoy()) faltan.venceEl = 'La fecha de vencimiento no puede quedar en el pasado.';
    if (motivo.trim() === '') faltan.motivo = 'Escriba el motivo del cambio.';
    setErrores(faltan);
    if (Object.values(faltan).some(Boolean)) return;
    setEnviando(true);
    setError(null);
    try {
      alGuardar(await pedir<FichaDeEmpresa>(`${rutaDe(ficha)}/suscripcion`, { metodo: 'PUT', cuerpo: { planCodigo: plan, venceEl, motivo: motivo.trim() } }));
    } catch (e) {
      setEnviando(false);
      if (e instanceof ErrorDeApi && e.campo) setErrores({ [e.campo]: e.message });
      else setError(e instanceof ErrorDeApi ? e.message : 'No se guardó el cambio. Intente de nuevo.');
    }
  }

  return (
    <Capa
      titulo="Cambiar plan o vencimiento"
      alCerrar={alCerrar}
      hayCambios={!iguales || motivo !== ''}
      error={error}
      alEnviar={() => void enviar()}
      acciones={(cerrar) => (
        <>
          <button type="button" className="boton boton-secundario" onClick={cerrar} disabled={enviando}>Cancelar</button>
          <button type="submit" className="boton boton-principal" disabled={enviando}>{enviando ? 'Guardando…' : 'Guardar cambio'}</button>
        </>
      )}
    >
      <p className="campo-ayuda">
        Para cobrar, use «Registrar pago»: esto es para corregir. Pasar al plan Personal solo se permite si la empresa cabe en él (un asistente y sin roles propios).
      </p>
      <div className="fila-de-campos">
        <Campo etiqueta="Plan">
          {(a) => (
            <select {...a} value={plan} onChange={(e) => setPlan(e.target.value as CodigoDePlan)}>
              <option value="PERSONAL">Personal</option>
              <option value="EMPRESARIAL">Empresarial</option>
            </select>
          )}
        </Campo>
        <Campo etiqueta="Vence el" error={errores.venceEl}>
          {(a) => <input {...a} type="date" min={hoy()} value={venceEl} onChange={(e) => setVenceEl(e.target.value)} />}
        </Campo>
      </div>
      <Campo etiqueta="Motivo" ayuda="Queda en la bitácora del panel." error={errores.motivo}>
        {(a) => <textarea {...a} rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
      </Campo>
    </Capa>
  );
}

// --- Designar administrador (RF-SAD-14) ------------------------------------------

export function DesignarAdministrador({ ficha, alCerrar, alDesignar }: { ficha: FichaDeEmpresa; alCerrar: () => void; alDesignar: (f: FichaDeEmpresa, nuevo: boolean) => void }) {
  const [email, setEmail] = useState('');
  const [nombre, setNombre] = useState('');
  const [justificacion, setJustificacion] = useState('');
  const [errores, setErrores] = useState<Record<string, string | undefined>>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const existente = ficha.usuarios.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());

  async function enviar() {
    if (enviando) return;
    const faltan: Record<string, string | undefined> = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) faltan.email = 'Escriba un correo válido.';
    if (!existente && nombre.trim() === '') faltan.nombre = 'Escriba el nombre de la persona nueva.';
    if (justificacion.trim() === '') faltan.justificacion = 'Escriba cómo verificó la identidad de quien lo pidió.';
    setErrores(faltan);
    if (Object.values(faltan).some(Boolean)) return;
    setEnviando(true);
    setError(null);
    try {
      const f = await pedir<FichaDeEmpresa>(`${rutaDe(ficha)}/administrador`, {
        metodo: 'POST',
        cuerpo: { email: email.trim(), nombre: existente ? existente.nombre : nombre.trim(), justificacion: justificacion.trim() },
      });
      alDesignar(f, !existente);
    } catch (e) {
      setEnviando(false);
      if (e instanceof ErrorDeApi && e.campo) setErrores({ [e.campo]: e.message });
      else setError(e instanceof ErrorDeApi ? e.message : 'No se designó el administrador. Intente de nuevo.');
    }
  }

  return (
    <Capa
      titulo={`Designar administrador de ${ficha.empresa.razonSocial}`}
      alCerrar={alCerrar}
      hayCambios={email !== '' || justificacion !== ''}
      error={error}
      alEnviar={() => void enviar()}
      acciones={(cerrar) => (
        <>
          <button type="button" className="boton boton-secundario" onClick={cerrar} disabled={enviando}>Cancelar</button>
          <button type="submit" className="boton boton-principal" disabled={enviando}>{enviando ? 'Designando…' : 'Designar administrador'}</button>
        </>
      )}
    >
      <p className="aviso-en-dialogo">
        <Icono nombre="escudo" />
        <span>
          Quien quede como administrador controla la empresa entera: su catálogo, sus ofertas y sus usuarios. Hágalo solo después de
          verificar la identidad de quien lo pide por un canal que ya la identifique.
        </span>
      </p>
      <Campo etiqueta="Correo" ayuda={existente ? `Es de ${existente.nombre}, que hoy tiene el rol ${existente.rolNombre}: pasará a Administrador.` : 'Si no es de nadie en la empresa, se crea una persona nueva, pendiente de activar.'} error={errores.email}>
        {(a) => <input {...a} type="email" autoComplete="off" list="correos-de-la-empresa" value={email} onChange={(e) => setEmail(e.target.value)} />}
      </Campo>
      <datalist id="correos-de-la-empresa">
        {ficha.usuarios.map((u) => <option key={u.id} value={u.email}>{u.nombre}</option>)}
      </datalist>
      {existente ? null : (
        <Campo etiqueta="Nombre" error={errores.nombre}>
          {(a) => <input {...a} autoComplete="off" value={nombre} onChange={(e) => setNombre(e.target.value)} />}
        </Campo>
      )}
      <Campo etiqueta="¿Cómo verificó la identidad de quien lo pidió?" ayuda="Por ejemplo: «llamada al teléfono registrado de la empresa y copia del certificado de existencia». Queda en la bitácora." error={errores.justificacion}>
        {(a) => <textarea {...a} rows={3} value={justificacion} onChange={(e) => setJustificacion(e.target.value)} />}
      </Campo>
    </Capa>
  );
}

// --- Eliminar los datos de la empresa (RF-SAD-13, RF-SAD-15) ----------------------

export function EliminarEmpresa({ ficha, alCerrar }: { ficha: FichaDeEmpresa; alCerrar: () => void }) {
  const [justificacion, setJustificacion] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [errores, setErrores] = useState<Record<string, string | undefined>>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const { avisar } = useAvisos();
  const coincide = confirmacion.trim() === ficha.empresa.razonSocial;

  async function enviar() {
    if (enviando) return;
    const faltan: Record<string, string | undefined> = {};
    if (justificacion.trim() === '') faltan.justificacion = 'Escriba por qué se eliminan los datos.';
    if (!coincide) faltan.confirmacion = 'Escriba la razón social exactamente como aparece arriba.';
    setErrores(faltan);
    if (Object.values(faltan).some(Boolean)) return;
    setEnviando(true);
    setError(null);
    try {
      await pedir<void>(rutaDe(ficha), { metodo: 'DELETE', cuerpo: { justificacion: justificacion.trim(), confirmacion: confirmacion.trim() } });
      avisar(`Se eliminaron los datos de ${ficha.empresa.razonSocial}. La bitácora del panel conserva el registro.`);
      window.location.hash = '#/empresas';
    } catch (e) {
      setEnviando(false);
      if (e instanceof ErrorDeApi && e.campo) setErrores({ [e.campo]: e.message });
      else setError(e instanceof ErrorDeApi ? e.message : 'No se eliminaron los datos. Intente de nuevo.');
    }
  }

  return (
    <Capa
      titulo={`Eliminar los datos de ${ficha.empresa.razonSocial}`}
      alCerrar={alCerrar}
      hayCambios={justificacion !== '' || confirmacion !== ''}
      error={error}
      alEnviar={() => void enviar()}
      acciones={(cerrar) => (
        <>
          <button type="button" className="boton boton-secundario" onClick={cerrar} disabled={enviando}>Cancelar</button>
          <button type="submit" className="boton boton-peligroso" disabled={enviando || !coincide}>{enviando ? 'Eliminando…' : 'Eliminar todo'}</button>
        </>
      )}
    >
      <p className="aviso-en-dialogo">
        <Icono nombre="aviso" />
        <span>
          Se borran la empresa, sus usuarios, su catálogo, sus APU y sus {ficha.cifras.proyectos === 1 ? 'un proyecto' : `${ficha.cifras.proyectos} proyectos`}. No se puede deshacer. Es
          el único camino por el que se borran datos de un cliente, y por eso nunca lo hace un proceso automático.
        </span>
      </p>
      <Campo etiqueta="Justificación" ayuda="Queda en la bitácora del panel, que sobrevive a la empresa." error={errores.justificacion}>
        {(a) => <textarea {...a} rows={3} value={justificacion} onChange={(e) => setJustificacion(e.target.value)} />}
      </Campo>
      <Campo etiqueta={`Para confirmar, escriba «${ficha.empresa.razonSocial}»`} error={errores.confirmacion}>
        {(a) => <input {...a} autoComplete="off" spellCheck={false} value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} />}
      </Campo>
    </Capa>
  );
}
