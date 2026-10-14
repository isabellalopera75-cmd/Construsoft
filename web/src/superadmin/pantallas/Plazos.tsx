import { useState } from 'react';
import { ErrorDeApi, pedir } from '../../api/cliente.ts';
import { useAvisos } from '../../componentes/Avisos.tsx';
import { Campo } from '../../componentes/Campo.tsx';
import { Capa } from '../../componentes/Capa.tsx';
import { Confirmacion } from '../../componentes/Confirmacion.tsx';
import { Icono } from '../../componentes/Icono.tsx';
import { ErrorDeSeccion, useLectura } from '../../modulos/configuracion/piezas.tsx';
import { formatearFechaYHora } from '../../fechas.ts';
import { fechaSola, hoy } from '../comun.tsx';
import type { Plazo, Plazos as DatosDePlazos } from '../tipos.ts';

/*
 * D-78 · Los plazos del ciclo de suscripción, contra el CONTRATO §18.3.
 *
 * Cinco plazos que antes vivían escritos en la base —la gracia para pagar, el
 * plazo tras un rechazo, la suspensión antes de eliminar, la solo lectura al
 * terminar la prueba y el plazo para reactivar una cancelada— y que ahora se
 * cambian aquí, con un motivo que queda en la bitácora.
 *
 * La regla que la pantalla tiene que dejar clara, porque es la que hace seguro
 * el cambio: un plazo se cuenta con el valor vigente el día desde el que se
 * cuenta. Un cambio alcanza a los plazos que EMPIECEN a correr desde la fecha
 * elegida; los que ya corren conservan su valor. Acortar la suspensión no
 * borra a nadie antes de lo que se le prometió.
 *
 * Lo que no hace la pantalla: validar el rango por su cuenta. Muestra los
 * límites, y el rechazo —fuera de rango, una fecha anterior a la del último
 * cambio— lo dice la base, con su campo.
 */

export function Plazos() {
  const { datos, error, releer, poner } = useLectura<DatosDePlazos>('/api/superadmin/parametros');
  const { avisar } = useAvisos();
  const [cambiando, setCambiando] = useState<Plazo | null>(null);
  const [anulando, setAnulando] = useState<Plazo | null>(null);

  if (error) return <ErrorDeSeccion mensaje={error} alReintentar={releer} />;

  return (
    <>
      <div className="encabezado-de-pantalla">
        <div>
          <h1>Plazos</h1>
          <p className="subtitulo-de-pantalla">Los plazos del ciclo de suscripción de todas las empresas.</p>
        </div>
      </div>

      <p className="aviso-informativo regla-de-plazos">
        <Icono nombre="reloj" />
        <span>
          Un cambio solo alcanza a los plazos que <b>empiecen a correr</b> desde la fecha que usted elija. Los que ya están corriendo
          conservan el valor con que empezaron: acortar la suspensión no elimina a nadie antes de lo que se le prometió.
        </span>
      </p>

      {datos === null ? (
        <p className="campo-ayuda">Cargando…</p>
      ) : (
        <div className="tarjetas-de-plazos">
          {datos.parametros.map((p) => (
            <section key={p.clave} className="tarjeta tarjeta-de-plazo" aria-labelledby={`plazo-${p.clave}`}>
              <div className="plazo-cabeza">
                <h2 id={`plazo-${p.clave}`}>{p.nombre}</h2>
                <button type="button" className="boton boton-secundario boton-chico-texto" onClick={() => setCambiando(p)}>
                  <Icono nombre="editar" />
                  Cambiar
                </button>
              </div>
              <p className="plazo-valor">
                <span className="cifra">{p.valorHoy}</span> {unidad(p.valorHoy, p.unidad)}
              </p>
              <p className="dato-de-apoyo">{p.vigenteDesde ? `Rige desde el ${fechaSola(p.vigenteDesde)}` : 'Valor inicial'}</p>
              <p className="campo-ayuda">{p.descripcion}</p>
              {p.valorProgramado !== null && p.programadoDesde ? (
                <div className="plazo-programado">
                  <span>
                    Desde el <b>{fechaSola(p.programadoDesde)}</b> pasa a <b>{p.valorProgramado} {unidad(p.valorProgramado, p.unidad)}</b>
                  </span>
                  <button type="button" className="boton boton-secundario boton-chico-texto" onClick={() => setAnulando(p)}>
                    Anular
                  </button>
                </div>
              ) : null}
              {p.apareceEnTerminos ? (
                <p className="plazo-terminos">
                  <Icono nombre="aviso" />
                  <span>Está escrito en la política de datos.</span>
                </p>
              ) : null}
            </section>
          ))}
        </div>
      )}

      {datos && datos.historial.length > 0 ? (
        <section className="tarjeta seccion-del-panel" aria-labelledby="titulo-historial-plazos">
          <h2 id="titulo-historial-plazos">Historial</h2>
          <div className="tarjeta-tabla tabla-con-borde">
            <table className="tabla">
              <caption className="solo-lectores">Cambios de plazos, del más reciente al más antiguo</caption>
              <thead>
                <tr>
                  <th scope="col">Plazo</th>
                  <th scope="col">Valor</th>
                  <th scope="col">Rige desde</th>
                  <th scope="col">Motivo</th>
                  <th scope="col">Quién y cuándo</th>
                </tr>
              </thead>
              <tbody>
                {datos.historial.map((c) => {
                  const p = datos.parametros.find((x) => x.clave === c.clave);
                  return (
                    <tr key={`${c.clave}-${c.vigenteDesde ?? 'inicial'}`}>
                      <td>{c.nombre}</td>
                      <td className="cifra">{c.valor} {p ? unidad(c.valor, p.unidad) : ''}</td>
                      <td>{c.vigenteDesde ? fechaSola(c.vigenteDesde) : 'Valor inicial'}</td>
                      <td>{c.motivo}</td>
                      <td className="dato-de-apoyo">{c.registradoPor ?? 'Sistema'} · {formatearFechaYHora(c.registradoEn)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {cambiando ? (
        <CambiarPlazo
          plazo={cambiando}
          alCerrar={() => setCambiando(null)}
          alGuardar={(d, aviso) => {
            poner(d);
            setCambiando(null);
            avisar(aviso);
          }}
        />
      ) : null}
      {anulando && anulando.programadoDesde ? (
        <Confirmacion
          titulo={`Anular el cambio de «${anulando.nombre}»`}
          textoConfirmar="Anular cambio"
          textoEnviando="Anulando…"
          pideTexto={{ etiqueta: 'Motivo', ayuda: 'Queda en la bitácora del panel.', campo: 'motivo', vacio: 'Escriba por qué anula el cambio.' }}
          alCerrar={() => setAnulando(null)}
          alConfirmar={async (motivo) => {
            const d = await pedir<DatosDePlazos>(`/api/superadmin/parametros/${encodeURIComponent(anulando.clave)}/anular`, {
              metodo: 'POST',
              cuerpo: { vigenteDesde: anulando.programadoDesde, motivo },
            });
            poner(d);
            setAnulando(null);
            avisar('Cambio anulado. El plazo sigue como está.');
          }}
        >
          <p>
            El cambio a {anulando.valorProgramado} {unidad(anulando.valorProgramado ?? 0, anulando.unidad)} programado para el{' '}
            {fechaSola(anulando.programadoDesde)} no va a regir. «{anulando.nombre}» sigue en {anulando.valorHoy}{' '}
            {unidad(anulando.valorHoy, anulando.unidad)}.
          </p>
        </Confirmacion>
      ) : null}
    </>
  );
}

function unidad(n: number, u: Plazo['unidad']): string {
  const uno = n === 1;
  return u === 'DIAS_HABILES' ? (uno ? 'día hábil' : 'días hábiles') : uno ? 'día' : 'días';
}

function CambiarPlazo({ plazo, alCerrar, alGuardar }: { plazo: Plazo; alCerrar: () => void; alGuardar: (d: DatosDePlazos, aviso: string) => void }) {
  const [valor, setValor] = useState('');
  const [desde, setDesde] = useState(hoy());
  const [motivo, setMotivo] = useState('');
  const [errores, setErrores] = useState<Record<string, string | undefined>>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar() {
    if (enviando) return;
    const faltan: Record<string, string | undefined> = {};
    if (!/^\d{1,3}$/.test(valor)) faltan.valor = `Escriba un número entero de ${plazo.minimo} a ${plazo.maximo}.`;
    if (desde < hoy()) faltan.vigenteDesde = 'Un plazo no se cambia hacia atrás: elija hoy o una fecha posterior.';
    if (motivo.trim() === '') faltan.motivo = 'Escriba por qué cambia el plazo.';
    setErrores(faltan);
    if (Object.values(faltan).some(Boolean)) return;
    setEnviando(true);
    setError(null);
    try {
      const d = await pedir<DatosDePlazos>(`/api/superadmin/parametros/${encodeURIComponent(plazo.clave)}`, {
        metodo: 'POST',
        cuerpo: { valor, vigenteDesde: desde, motivo: motivo.trim() },
      });
      alGuardar(
        d,
        desde === hoy()
          ? `«${plazo.nombre}» queda en ${valor} desde hoy.`
          : `«${plazo.nombre}» pasa a ${valor} desde el ${fechaSola(desde)}.`,
      );
    } catch (e) {
      setEnviando(false);
      if (e instanceof ErrorDeApi && e.campo) setErrores({ [e.campo]: e.message });
      else setError(e instanceof ErrorDeApi ? e.message : 'No se guardó el cambio. Intente de nuevo.');
    }
  }

  return (
    <Capa
      titulo={`Cambiar «${plazo.nombre}»`}
      alCerrar={alCerrar}
      hayCambios={valor !== '' || motivo !== ''}
      error={error}
      alEnviar={() => void enviar()}
      acciones={(cerrar) => (
        <>
          <button type="button" className="boton boton-secundario" onClick={cerrar} disabled={enviando}>Cancelar</button>
          <button type="submit" className="boton boton-principal" disabled={enviando}>{enviando ? 'Guardando…' : 'Cambiar plazo'}</button>
        </>
      )}
    >
      <p className="campo-ayuda">
        Hoy vale <b>{plazo.valorHoy} {unidad(plazo.valorHoy, plazo.unidad)}</b>. El valor nuevo alcanza a los plazos que empiecen a correr
        desde la fecha que elija; los que ya corren conservan el suyo.
      </p>
      {plazo.apareceEnTerminos ? (
        <p className="aviso-error" role="note">
          <Icono nombre="aviso" />
          <span>
            Este plazo está escrito en la política de datos que aceptaron las empresas. Si lo cambia, publique antes una versión nueva de los
            términos con el valor nuevo: si no, el texto queda prometiendo otra cosa.
          </span>
        </p>
      ) : null}
      <div className="fila-de-campos">
        <Campo
          etiqueta={plazo.unidad === 'DIAS_HABILES' ? 'Días hábiles' : 'Días'}
          ayuda={`De ${plazo.minimo} a ${plazo.maximo}.`}
          error={errores.valor}
        >
          {(a) => (
            <input
              {...a}
              inputMode="numeric"
              autoComplete="off"
              value={valor}
              onChange={(e) => setValor(e.target.value.replace(/\D/g, '').slice(0, 3))}
            />
          )}
        </Campo>
        <Campo etiqueta="Rige desde" error={errores.vigenteDesde}>
          {(a) => <input {...a} type="date" min={hoy()} value={desde} onChange={(e) => setDesde(e.target.value)} />}
        </Campo>
      </div>
      <Campo etiqueta="Motivo" ayuda="Queda en la bitácora del panel." error={errores.motivo}>
        {(a) => <textarea {...a} rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
      </Campo>
    </Capa>
  );
}
