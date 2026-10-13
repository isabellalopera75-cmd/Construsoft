import type { ReactNode } from 'react';
import type { Suscripcion } from '../api/tipos.ts';
import { Icono, type NombreDeIcono } from '../componentes/Icono.tsx';
import { fechaDelDia } from '../fechas.ts';
import { SuscripcionPestana } from '../modulos/configuracion/Suscripcion.tsx';
import { useSesion } from '../sesion.tsx';

/*
 * D-74 · La cuenta detenida (decisión del dueño, 11 de octubre de 2026).
 *
 * Suspendida por falta de pago, suspendida por la plataforma, o cancelada y
 * pasada la fecha que pagó: la empresa no entra a Recursos, APU ni Proyectos.
 * Lo único que le queda es su suscripción, para pagar o reactivar. Por eso no
 * hay barra lateral ni menú: no llevan a ninguna parte. Una franja dice qué
 * pasó y hasta cuándo, y debajo va la misma pestaña de Suscripción de siempre.
 *
 * Quién la ve la decide `acceso`, que manda la base (SOLO_PAGO o NINGUNO). La
 * pantalla no lo deduce de las fechas.
 */
export function CuentaDetenida() {
  const { arranque, puede, salir } = useSesion();
  const s = arranque.suscripcion;
  if (!s) return null;
  const aviso = queDecir(s, arranque.razonSocial);
  // La plataforma la suspendió: pagar no lo resuelve, así que no se ofrece.
  const conPago = s.suspension !== 'PLATAFORMA' && s.acceso === 'SOLO_PAGO';

  return (
    <div className="cuenta-detenida">
      <header className="barra-de-cuenta-detenida">
        <span className="marca-palabra">ConstruSoft</span>
        <div className="quien-soy">
          <div className="quien-soy-texto">
            <span className="quien-soy-nombre">{arranque.usuarioNombre}</span>
            <span className="quien-soy-empresa">{arranque.razonSocial}</span>
          </div>
          <button type="button" className="boton boton-secundario" onClick={() => void salir()}>
            <Icono nombre="salir" />
            Salir
          </button>
        </div>
      </header>

      <main id="contenido" className="contenido contenido-detenido" tabIndex={-1}>
        <section className="aviso-de-cuenta" data-tono={aviso.tono} aria-labelledby="titulo-de-cuenta">
          <Icono nombre={aviso.icono} />
          <div>
            <h1 id="titulo-de-cuenta">{aviso.titulo}</h1>
            {aviso.texto}
            {aviso.plazos.length > 0 ? (
              <dl className="plazos-de-cuenta">
                {aviso.plazos.map(([que, cuando]) => (
                  <div key={que}><dt>{que}</dt><dd>{cuando}</dd></div>
                ))}
              </dl>
            ) : null}
          </div>
        </section>

        {conPago ? (
          puede('CONFIG.SUSCRIPCION') ? (
            <SuscripcionPestana />
          ) : (
            <p className="nota-pendiente">
              <Icono nombre="usuarios" />
              <span>El pago lo reporta el Administrador de su empresa. Avísele: cuando lo confirmemos, todo vuelve a estar como lo dejó.</span>
            </p>
          )
        ) : null}
      </main>
    </div>
  );
}

interface Aviso {
  titulo: string;
  texto: ReactNode;
  plazos: [string, string][];
  tono: 'aviso' | 'peligro';
  icono: NombreDeIcono;
}

function queDecir(s: Suscripcion, empresa: string): Aviso {
  const d = (f: string | null) => (f ? fechaDelDia(f) : '—');

  if (s.suspension === 'PLATAFORMA') {
    return {
      titulo: `El acceso de ${empresa} está suspendido`,
      texto: (
        <p>
          La administración de ConstruSoft suspendió el acceso de su empresa. Sus datos están intactos. Esto no se resuelve con un
          pago: escríbanos para conocer el motivo.
        </p>
      ),
      plazos: [],
      tono: 'peligro',
      icono: 'pausa',
    };
  }

  if (s.estado === 'CANCELADA') {
    if (s.acceso === 'NINGUNO') {
      return {
        titulo: `La suscripción de ${empresa} terminó`,
        texto: (
          <p>
            La suscripción se canceló y pasó el plazo para reactivarla. Los datos de la empresa se van a eliminar y no se podrán
            recuperar. Si cree que es un error, escríbanos hoy mismo.
          </p>
        ),
        plazos: [['Plazo para reactivar', `vencido el ${d(s.reactivableHasta)}`]],
        tono: 'peligro',
        icono: 'aviso',
      };
    }
    return {
      titulo: `La suscripción de ${empresa} está cancelada`,
      texto: (
        <p>
          {s.canceladaPor === 'PLATAFORMA' ? 'La administración de ConstruSoft canceló la suscripción' : 'Su empresa canceló la suscripción'} y
          la cuenta funcionó hasta el {d(s.venceEl)}. Todavía puede reactivarla: el Administrador reporta el pago abajo y, cuando lo
          confirmemos, todo vuelve a estar como lo dejó. {s.pagoEnVerificacion ? 'Su pago ya está en verificación.' : ''}
        </p>
      ),
      plazos: s.pagoEnVerificacion
        ? [['Funcionó hasta', d(s.venceEl)]]
        : [
            ['Funcionó hasta', d(s.venceEl)],
            ['Puede reactivarla hasta', d(s.reactivableHasta)],
            ['Si no, los datos se eliminan el', d(s.seEliminaEl)],
          ],
      tono: 'peligro',
      icono: 'candado',
    };
  }

  // Suspendida por falta de pago.
  return {
    titulo: `La cuenta de ${empresa} está suspendida por falta de pago`,
    texto: s.pagoEnVerificacion ? (
      <p>
        Recibimos su pago y lo estamos verificando. Mientras tanto la cuenta sigue suspendida: cuando lo confirmemos, todo vuelve a
        estar como lo dejó, sin que tenga que hacer nada más.
      </p>
    ) : (
      <p>
        La suscripción venció el {d(s.venceEl)} y el pago no llegó en los dos días hábiles siguientes. Mientras esté suspendida, nadie
        de su empresa puede entrar a Recursos, APU ni Proyectos; sus datos siguen intactos. Pague y repórtelo abajo con el
        comprobante: al confirmarlo, todo vuelve a estar como lo dejó.
      </p>
    ),
    plazos: s.pagoEnVerificacion
      ? [['Suspendida desde', d(s.suspendidaDesde)]]
      : [
          ['Suspendida desde', d(s.suspendidaDesde)],
          ['Si no paga, los datos se eliminan el', d(s.seEliminaEl)],
        ],
    tono: s.pagoEnVerificacion ? 'aviso' : 'peligro',
    icono: s.pagoEnVerificacion ? 'reloj' : 'candado',
  };
}
