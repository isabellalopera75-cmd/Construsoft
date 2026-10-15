import { CampoDeCifra } from '../../componentes/CampoDeCifra.tsx';
import { useState } from 'react';
import { ErrorDeApi, pedir } from '../../api/cliente.ts';
import type { DetalleDeSuscripcion, EstadoDePago, EstadoSuscripcion, Pago } from '../../api/tipos.ts';
import { useAvisos } from '../../componentes/Avisos.tsx';
import { Campo } from '../../componentes/Campo.tsx';
import { Capa } from '../../componentes/Capa.tsx';
import { Confirmacion } from '../../componentes/Confirmacion.tsx';
import { Icono } from '../../componentes/Icono.tsx';
import { leerCifra } from '../../entrada.ts';
import { fechaDelDia, fechaDelDiaCorta } from '../../fechas.ts';
import { formatearNumero } from '../../formato.ts';
import { useSesion } from '../../sesion.tsx';
import { DosColumnas, ErrorDeSeccion, Fichas, Seccion, useLectura } from './piezas.tsx';

/*
 * 02 §11.3 · Suscripción, y desde el 11 de octubre de 2026 el pago reportado
 * (CONTRATO §14, D-73).
 *
 * La empresa paga por fuera —transferencia o PSE— y reporta aquí el pago con
 * su comprobante. El pago queda «en verificación» y NO extiende la suscripción:
 * solo la extiende el equipo de ConstruSoft al confirmarlo, porque un
 * comprobante puede ser falso (decisión del dueño). Si lo rechaza, la empresa
 * lee el motivo aquí mismo.
 *
 * Se puede reportar con la suscripción vencida, que es justo cuando hace
 * falta; no mientras otro pago espera verificación.
 *
 * D-78 (14 de octubre de 2026) · Los plazos ya no se escriben aquí: los cambia
 * el superadministrador y llegan en `plazos`. Sin ese dato, los textos los
 * nombran sin número.
 *
 * D-74 (12 de octubre de 2026) · El ciclo de vida: al vencer hay dos días
 * hábiles para pagar; después la cuenta se suspende y, a los 60 días, sus
 * datos se eliminan. El Administrador puede cancelar: la cuenta funciona hasta
 * lo pagado, y después tiene diez días para reactivarla pagando. Antes de esa
 * fecha la reanuda sin pagar. Los plazos los calcula la base y llegan aquí.
 */

const NOMBRES_DE_ESTADO: Record<EstadoSuscripcion, string> = {
  EN_PRUEBA: 'En prueba',
  ACTIVA: 'Activa',
  POR_PAGAR: 'Por pagar',
  VENCIDA: 'Vencida',
  CANCELADA: 'Cancelada',
  SUSPENDIDA: 'Suspendida',
  SIN_SUSCRIPCION: 'Sin suscripción',
};

const NOMBRES_DE_PAGO: Record<EstadoDePago, string> = {
  EXITOSO: 'Confirmado',
  PENDIENTE: 'En verificación',
  RECHAZADO: 'Rechazado',
};

const METODOS = [
  { valor: 'TRANSFERENCIA', nombre: 'Transferencia' },
  { valor: 'PSE', nombre: 'PSE' },
  { valor: 'EFECTIVO', nombre: 'Efectivo' },
  { valor: 'OTRO', nombre: 'Otro' },
];
const NOMBRE_DE_METODO: Record<string, string> = Object.fromEntries(METODOS.map((m) => [m.valor, m.nombre]));

/** «2026-10-16» → «16 de octubre de 2026». */
const fechaSola = fechaDelDia;

function hoy(): string {
  const d = new Date();
  const dos = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

export function SuscripcionPestana() {
  const { datos, error, releer, poner } = useLectura<DetalleDeSuscripcion>('/api/configuracion/suscripcion');
  const { arranque, recargar } = useSesion();
  const { avisar } = useAvisos();
  const [reportando, setReportando] = useState(false);
  const [dialogo, setDialogo] = useState<'cancelar' | 'reanudar' | null>(null);
  const formato = arranque.formatoNumerico;
  if (error) return <ErrorDeSeccion mensaje={error} alReintentar={releer} />;
  if (!datos) return <p className="campo-ayuda">Cargando…</p>;

  const dias = datos.diasRestantes;
  const pendiente = datos.pagos.find((p) => p.origen === 'REPORTADO' && p.estado === 'PENDIENTE') ?? null;
  // El último rechazo importa solo si es lo más reciente que pasó: si después
  // se confirmó otro pago, ya no hay nada que hacer con él.
  const ultimoReportado = datos.pagos.find((p) => p.origen === 'REPORTADO' && p.estado !== 'PENDIENTE') ?? null;
  const rechazado = !pendiente && ultimoReportado?.estado === 'RECHAZADO' ? ultimoReportado : null;
  const dinero = (p: Pago) => `$ ${formatearNumero(p.monto, { ...formato, decimalesVista: 0 })}`;
  const cancelada = datos.estado === 'CANCELADA';
  // Tras un rechazo, hasta cuándo se puede reenviar sin perder el acceso (D-74).
  const reenviarHasta = cancelada ? datos.reactivableHasta : datos.estado === 'POR_PAGAR' ? datos.pagarAMasTardar : null;
  // Cancelar o reanudar cambian lo que dice el aviso de arriba: se relee el arranque.
  const tras = async (detalle: DetalleDeSuscripcion, aviso: string) => {
    poner(detalle);
    setDialogo(null);
    avisar(aviso);
    await recargar();
  };

  // La organización del 15 de octubre de 2026 (pedido del dueño): arriba el
  // resumen, con los días restantes destacados; debajo, en dos columnas, la
  // vigencia con lo que hay que hacer y el historial de pagos; al final, a lo
  // ancho y si aplica, la zona de cuidado.
  const vigencia = (
    <Seccion titulo="Vigencia y pagos">
      <Fichas datos={[{ etiqueta: 'Vence el', valor: fechaSola(datos.venceEl) }]} />

      {pendiente ? (
        <p className="franja-de-estado franja-en-verificacion" role="status">
          <Icono nombre="reloj" />
          <span>
            <strong>Su pago está en verificación.</strong> Reportó {dinero(pendiente)} el {fechaSola(pendiente.fecha)}.
            Cuando el equipo de ConstruSoft lo confirme, su suscripción se extiende y lo verá aquí. Mientras tanto, su acceso
            sigue como está.
          </span>
        </p>
      ) : null}
      {rechazado ? (
        <p className="aviso-error" role="alert">
          <Icono nombre="aviso" />
          <span>
            <strong>No pudimos confirmar su pago del {fechaSola(rechazado.fecha)}.</strong> {rechazado.rechazoMotivo} Si cree
            que es un error, escríbanos o repórtelo de nuevo con el comprobante correcto
            {reenviarHasta ? <>, <strong>a más tardar el {fechaSola(reenviarHasta)}</strong>{cancelada ? '' : ': después, la cuenta se suspende'}</> : null}.
          </span>
        </p>
      ) : null}

      {datos.estado === 'POR_PAGAR' && datos.pagarAMasTardar && !pendiente && !rechazado ? (
        <p className="franja-de-estado franja-por-pagar" role="status">
          <Icono nombre="reloj" />
          <span>
            <strong>Su suscripción venció el {fechaSola(datos.venceEl)}.</strong> Tiene hasta el {fechaSola(datos.pagarAMasTardar)} para
            reportar el pago; después, la cuenta se suspende hasta que pague.
          </span>
        </p>
      ) : null}

      {datos.suspension === 'PLATAFORMA' ? (
        <p className="nota-pendiente">
          <Icono nombre="candado" />
          <span>El acceso de su empresa fue suspendido por la administración de ConstruSoft. Esto no se resuelve con un pago: escríbanos para conocer el motivo.</span>
        </p>
      ) : cancelada && datos.acceso === 'COMPLETO' ? (
        <div className="como-pagar">
          <h3>Cancelada: funciona hasta el {fechaSola(datos.venceEl)}</h3>
          <p>
            {datos.canceladaPor === 'PLATAFORMA' ? 'La administración de ConstruSoft canceló la suscripción.' : 'Su empresa canceló la suscripción.'}{' '}
            Hasta el {fechaSola(datos.venceEl)} todo funciona y no se le cobra nada más. Después, la cuenta deja de funcionar y solo el
            Administrador podrá reactivarla, pagando, hasta el {fechaSola(datos.reactivableHasta ?? datos.venceEl)}. Pasado ese día, los
            datos de la empresa se eliminan y no se pueden recuperar.
          </p>
          {datos.puedeReanudar ? (
            <>
              <p>¿Cambió de opinión? Reanúdela ahora: no tiene que pagar, porque el período sigue pagado.</p>
              <div className="fila-de-botones fila-izquierda">
                <button type="button" className="boton boton-principal" onClick={() => setDialogo('reanudar')}>
                  <Icono nombre="reanudar" />
                  Reanudar la suscripción
                </button>
              </div>
            </>
          ) : (
            <p className="campo-ayuda">Solo el Administrador de la empresa puede reanudarla.</p>
          )}
        </div>
      ) : cancelada ? (
        <div className="como-pagar">
          <h3>Reactivar la suscripción</h3>
          <p>
            Pague por transferencia o PSE y reporte aquí el pago con su comprobante. El equipo de ConstruSoft lo verifica y, al
            confirmarlo, la suscripción vuelve a estar activa con todo lo que tenía.
            {datos.reactivableHasta && !pendiente ? <> Puede hacerlo hasta el <strong>{fechaSola(datos.reactivableHasta)}</strong>.</> : null}
          </p>
          {datos.puedeReportar && !pendiente ? (
            <div className="fila-de-botones fila-izquierda">
              <button type="button" className="boton boton-principal" onClick={() => setReportando(true)}>
                <Icono nombre="subirArchivo" />
                Reportar el pago para reactivar
              </button>
            </div>
          ) : !pendiente ? (
            <p className="campo-ayuda">Reactivarla es solo del Administrador de la empresa.</p>
          ) : null}
        </div>
      ) : (
        <div className="como-pagar">
          <h3>Cómo pagar</h3>
          <p>
            {datos.estado === 'EN_PRUEBA' ? `Le ${dias === 1 ? 'queda 1 día' : `quedan ${dias} días`} de prueba. ` : ''}
            Pague por transferencia o PSE y reporte aquí el pago con su comprobante. El equipo de ConstruSoft lo verifica y, al
            confirmarlo, extiende su suscripción.
          </p>
          <p className="campo-ayuda">
            {datos.estado === 'EN_PRUEBA' || datos.estado === 'VENCIDA'
              ? `Si la prueba termina sin pago, tiene ${cuantos(datos.plazos?.pruebaSoloLectura, 'días', 'unos días')} en solo lectura para decidir: puede consultar, exportar y pagar aquí. Si no paga, la prueba se cancela y los datos se eliminan.`
              : `Si la suscripción vence sin pago, tiene ${cuantos(datos.plazos?.graciaPago, 'días hábiles', 'un plazo corto')} para pagar. Después, la cuenta se suspende y solo se puede entrar a esta pantalla; ${datos.plazos ? `a los ${datos.plazos.suspension} días de suspendida` : 'pasado el plazo de suspensión'}, los datos se eliminan.`}
          </p>
          {datos.puedeReportar && !pendiente ? (
            <div className="fila-de-botones fila-izquierda">
              <button type="button" className="boton boton-principal" onClick={() => setReportando(true)}>
                <Icono nombre="subirArchivo" />
                Reportar un pago
              </button>
            </div>
          ) : null}
        </div>
      )}
    </Seccion>
  );

  const historial = (
    <Seccion titulo="Historial de pagos">
      {datos.pagos.length === 0 ? (
        <p className="campo-ayuda">Todavía no hay pagos.</p>
      ) : (
        <div className="tarjeta-tabla tabla-con-borde">
          {/* En media columna no caben seis: cada dato va con el que lo
              acompaña (fecha y concepto, monto y método, estado y hasta
              cuándo cubre). No se pierde ninguno. */}
          <table className="tabla tabla-pagos">
            <caption className="solo-lectores">Pagos</caption>
            <thead>
              <tr>
                <th scope="col">Fecha y concepto</th>
                <th scope="col" className="col-numero">Monto y método</th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              {datos.pagos.map((p) => (
                <tr key={p.id}>
                  <td>
                    <span className="fecha-de-pago">{fechaDelDiaCorta(p.fecha)}</span>
                    <span className="dato-de-apoyo">{p.concepto}</span>
                  </td>
                  <td className="col-numero">
                    <span className="cifra">{dinero(p)}</span>
                    <span className="dato-de-apoyo">{NOMBRE_DE_METODO[p.metodo] ?? p.metodo}</span>
                  </td>
                  <td>
                    <span className="insignia insignia-pago" data-estado={p.estado}>{NOMBRES_DE_PAGO[p.estado]}</span>
                    {p.cubreHasta ? <span className="dato-de-apoyo">Cubre hasta el {fechaDelDiaCorta(p.cubreHasta)}</span> : null}
                    {p.estado === 'RECHAZADO' && p.rechazoMotivo ? <span className="dato-de-apoyo">{p.rechazoMotivo}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Seccion>
  );

  // En la cuenta detenida no se ofrece: lo que hay que hacer ahí es pagar.
  const cuidado = datos.puedeCancelar && datos.acceso === 'COMPLETO' ? (
    <section className="tarjeta seccion-de-config zona-de-cuidado">
      <h2>Zona de cuidado</h2>
      <div className="accion-de-cuidado">
        <div>
          <h3>Cancelar la suscripción</h3>
          <p className="campo-ayuda">
            Es definitivo: {dias >= 0 ? `la cuenta funciona hasta el ${fechaSola(datos.venceEl)}` : 'como la suscripción ya venció, la cuenta deja de funcionar enseguida'} y
            no se le cobra nada más. Después, tiene {cuantos(datos.plazos?.reactivacion, 'días', 'un plazo')} para reactivarla pagando;
            pasado ese plazo, los datos de la empresa se eliminan.
          </p>
        </div>
        <button type="button" className="boton boton-peligroso" onClick={() => setDialogo('cancelar')}>
          Cancelar suscripción
        </button>
      </div>
    </section>
  ) : null;

  return (
    <>
      {/* Las insignias van bajo el título, no debajo de la cifra destacada. */}
      <section className="tarjeta seccion-de-config">
        <div className="seccion-de-config-cabecera">
          <div>
            <h2>Suscripción</h2>
            <div className="insignias-de-config">
              <span className="insignia insignia-plan"><span className="solo-lectores">Plan: </span>{datos.plan}</span>
              <span className="insignia insignia-suscripcion" data-estado={datos.estado}>
                <span className="solo-lectores">Estado: </span>{NOMBRES_DE_ESTADO[datos.estado]}
              </span>
            </div>
          </div>
          <div className="ficha-destacada">
            <span>Días restantes</span>
            <strong>{dias > 0 ? dias : 0}</strong>
          </div>
        </div>
      </section>

      <DosColumnas>
        {vigencia}
        {historial}
      </DosColumnas>

      {cuidado}


      {dialogo === 'cancelar' ? (
        <Confirmacion
          titulo="Cancelar la suscripción"
          textoConfirmar="Cancelar suscripción"
          textoEnviando="Cancelando…"
          peligroso
          pideTexto={{ etiqueta: 'Por qué la cancela', ayuda: 'Nos ayuda a mejorar. Queda guardado con la suscripción.', campo: 'motivo', vacio: 'Cuéntenos por qué la cancela.' }}
          alCerrar={() => setDialogo(null)}
          alConfirmar={async (motivo) => tras(
            await pedir<DetalleDeSuscripcion>('/api/configuracion/suscripcion/cancelar', { metodo: 'POST', cuerpo: { motivo } }),
            dias >= 0 ? `Suscripción cancelada. Funciona hasta el ${fechaSola(datos.venceEl)}.` : 'Suscripción cancelada.',
          )}
        >
          {dias >= 0 ? (
            <>
              <p>
                Todo sigue funcionando hasta el {fechaSola(datos.venceEl)} y no se le cobra nada más. Desde el día siguiente nadie de la
                empresa podrá entrar, y el Administrador tendrá {cuantos(datos.plazos?.reactivacion, 'días', 'un plazo')} para reactivarla pagando. Si no lo hace, los datos de la
                empresa se eliminan y no se pueden recuperar.
              </p>
              <p>Mientras llega esa fecha puede reanudarla sin pagar.</p>
            </>
          ) : (
            <p>
              La suscripción ya venció, así que desde ahora nadie de la empresa podrá entrar. El Administrador tendrá{' '}
              {cuantos(datos.plazos?.reactivacion, 'días', 'un plazo')} para reactivarla pagando. Si no lo hace, los datos de la empresa se eliminan y no se pueden recuperar.
            </p>
          )}
        </Confirmacion>
      ) : null}
      {dialogo === 'reanudar' ? (
        <Confirmacion
          titulo="Reanudar la suscripción"
          textoConfirmar="Reanudar suscripción"
          textoEnviando="Reanudando…"
          alCerrar={() => setDialogo(null)}
          alConfirmar={async () => tras(
            await pedir<DetalleDeSuscripcion>('/api/configuracion/suscripcion/reanudar', { metodo: 'POST' }),
            'Suscripción reanudada. Sigue como antes de cancelarla.',
          )}
        >
          <p>La cancelación se anula y la suscripción sigue hasta el {fechaSola(datos.venceEl)}, como antes. No tiene que pagar nada ahora.</p>
        </Confirmacion>
      ) : null}

      {reportando ? (
        <ReportarPago
          reactivar={cancelada}
          alCerrar={() => setReportando(false)}
          alReportar={(d) => {
            poner(d);
            setReportando(false);
            avisar('Pago reportado. Le avisaremos aquí cuando lo verifiquemos.');
            // Reportado a tiempo, el aviso de arriba cambia (D-74).
            void recargar();
          }}
        />
      ) : null}
    </>
  );
}

const TIPOS_DE_COMPROBANTE = ['image/png', 'image/jpeg', 'application/pdf'];
const MAXIMO = 5 * 1024 * 1024;

function ReportarPago({ reactivar, alCerrar, alReportar }: { reactivar: boolean; alCerrar: () => void; alReportar: (d: DetalleDeSuscripcion) => void }) {
  const { arranque } = useSesion();
  const [monto, setMonto] = useState('');
  const [fecha, setFecha] = useState(hoy());
  const [metodo, setMetodo] = useState('TRANSFERENCIA');
  const [referencia, setReferencia] = useState('');
  const [meses, setMeses] = useState(1);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [errores, setErrores] = useState<Record<string, string | undefined>>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar() {
    if (enviando) return;
    const faltan: Record<string, string | undefined> = {};
    const lectura = leerCifra(monto, { decimales: 2, permitirCero: false, nombre: 'el monto' });
    if ('error' in lectura) faltan.monto = lectura.error;
    if (fecha === '' || fecha > hoy()) faltan.fecha = 'Escriba la fecha en que pagó; no puede ser futura.';
    if (!archivo) faltan.comprobante = 'Adjunte el comprobante: sin él no podemos verificar el pago.';
    else if (!TIPOS_DE_COMPROBANTE.includes(archivo.type)) faltan.comprobante = 'El comprobante tiene que ser una imagen PNG o JPEG, o un PDF.';
    else if (archivo.size > MAXIMO) faltan.comprobante = 'El comprobante pesa más de 5 MB.';
    setErrores(faltan);
    if (Object.values(faltan).some(Boolean) || 'error' in lectura || !archivo) return;
    setEnviando(true);
    setError(null);
    try {
      const { id } = await pedir<{ id: string }>('/api/configuracion/suscripcion/comprobantes', { metodo: 'POST', archivo });
      const detalle = await pedir<DetalleDeSuscripcion>('/api/configuracion/suscripcion/pagos', {
        metodo: 'POST',
        cuerpo: { fecha, monto: lectura.valor, metodo, referencia: referencia.trim() === '' ? null : referencia.trim(), periodoMeses: meses, comprobanteId: id },
      });
      alReportar(detalle);
    } catch (e) {
      setEnviando(false);
      if (e instanceof ErrorDeApi && e.campo) setErrores({ [e.campo]: e.message });
      else setError(e instanceof ErrorDeApi ? e.message : 'No se reportó el pago. Intente de nuevo.');
    }
  }

  return (
    <Capa
      titulo={reactivar ? 'Reportar el pago para reactivar' : 'Reportar un pago'}
      alCerrar={alCerrar}
      hayCambios={monto !== '' || referencia !== '' || archivo !== null}
      error={error}
      alEnviar={() => void enviar()}
      acciones={(cerrar) => (
        <>
          <button type="button" className="boton boton-secundario" onClick={cerrar} disabled={enviando}>Cancelar</button>
          <button type="submit" className="boton boton-principal" disabled={enviando}>{enviando ? 'Enviando…' : 'Reportar pago'}</button>
        </>
      )}
    >
      <p className="campo-ayuda">
        Cuéntenos qué pagó y adjunte el comprobante. El equipo de ConstruSoft lo verifica contra el banco y, al confirmarlo,{' '}
        {reactivar ? 'reactiva su suscripción' : 'extiende su suscripción'}. Su acceso no cambia hasta entonces.
      </p>
      <div className="fila-de-campos">
        <Campo etiqueta="Monto pagado" error={errores.monto}>
          {(a) => <CampoDeCifra {...a} valor={monto} alCambiar={setMonto} formato={arranque.formatoNumerico} />}
        </Campo>
        <Campo etiqueta="Fecha del pago" error={errores.fecha}>
          {(a) => <input {...a} type="date" max={hoy()} value={fecha} onChange={(e) => setFecha(e.target.value)} />}
        </Campo>
      </div>
      <div className="fila-de-campos">
        <Campo etiqueta="Medio de pago">
          {(a) => (
            <select {...a} value={metodo} onChange={(e) => setMetodo(e.target.value)}>
              {METODOS.map((m) => <option key={m.valor} value={m.valor}>{m.nombre}</option>)}
            </select>
          )}
        </Campo>
        <Campo etiqueta="Referencia (opcional)" ayuda="El número de la transferencia o del PSE.">
          {(a) => <input {...a} autoComplete="off" value={referencia} onChange={(e) => setReferencia(e.target.value)} />}
        </Campo>
      </div>
      <fieldset className="grupo-de-opciones">
        <legend>¿Cuántos meses paga?</legend>
        <div className="opciones-de-periodo sin-sangria" role="group" aria-label="Meses">
          {[1, 3, 6, 12].map((n) => (
            <button key={n} type="button" className="boton boton-secundario boton-de-periodo" aria-pressed={meses === n} onClick={() => setMeses(n)}>
              {n === 1 ? '1 mes' : `${n} meses`}
            </button>
          ))}
        </div>
      </fieldset>
      <Campo etiqueta="Comprobante" ayuda="Foto o PDF del comprobante del banco. PNG, JPEG o PDF, hasta 5 MB." error={errores.comprobante}>
        {(a) => <input {...a} className="campo-archivo" type="file" accept="image/png,image/jpeg,application/pdf" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />}
      </Campo>
    </Capa>
  );
}

/** «10 días», «1 día hábil»; sin el dato, el texto de reemplazo («un plazo»). D-78. */
function cuantos(n: number | undefined, unidad: 'días' | 'días hábiles', sinNumero: string): string {
  if (n === undefined) return sinNumero;
  if (n === 1) return unidad === 'días' ? '1 día' : '1 día hábil';
  return `${n} ${unidad}`;
}
