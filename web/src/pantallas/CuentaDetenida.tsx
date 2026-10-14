import { useEffect, useState, type ReactNode } from 'react';
import { ErrorDeApi, pedir } from '../api/cliente.ts';
import type { EstadoPresupuesto, Suscripcion } from '../api/tipos.ts';
import { Icono, type NombreDeIcono } from '../componentes/Icono.tsx';
import { fechaDelDia } from '../fechas.ts';
import { SuscripcionPestana } from '../modulos/configuracion/Suscripcion.tsx';
import { enlaceDeExportacion } from '../modulos/mesa/Versiones.tsx';
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
 *
 * Exportar se deja en todos los casos (decisión del dueño, 13 de octubre de
 * 2026, D-76): los datos son de la empresa y tiene que poder llevárselos antes
 * de que se eliminen. Por eso, debajo, la lista de sus proyectos con su PDF y
 * su Excel (CONTRATO §17.1).
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

        {puede('PRESUPUESTOS.EXPORTAR') ? <SusProyectos /> : null}
      </main>
    </div>
  );
}

interface Exportable {
  id: string;
  codigo: string;
  nombre: string;
  estado: EstadoPresupuesto;
  archivado: boolean;
}

/** Sus proyectos, para descargarlos en PDF o Excel aunque la cuenta esté detenida. */
function SusProyectos() {
  const [lista, setLista] = useState<Exportable[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    pedir<{ presupuestos: Exportable[] }>('/api/presupuestos/exportables')
      .then((r) => setLista(r.presupuestos))
      .catch((e: unknown) => setError(e instanceof ErrorDeApi ? e.message : 'No se pudo traer la lista de proyectos.'));
  }, []);

  return (
    <section className="tarjeta seccion-de-config" aria-labelledby="titulo-sus-proyectos">
      <h2 id="titulo-sus-proyectos">Sus proyectos</h2>
      <p className="campo-ayuda">Sus datos son suyos: descárguelos en PDF o en Excel mientras la cuenta exista.</p>
      {error ? <p className="aviso-error" role="alert">{error}</p> : null}
      {lista === null && !error ? <p className="campo-ayuda">Cargando…</p> : null}
      {lista !== null && lista.length === 0 ? <p className="campo-ayuda">La empresa no tiene proyectos.</p> : null}
      {lista !== null && lista.length > 0 ? (
        <div className="tarjeta-tabla tabla-con-borde">
          <table className="tabla">
            <caption className="solo-lectores">Proyectos para exportar</caption>
            <thead>
              <tr>
                <th scope="col">Código</th>
                <th scope="col">Proyecto</th>
                <th scope="col"><span className="solo-lectores">Descargar</span></th>
              </tr>
            </thead>
            <tbody>
              {lista.map((p) => (
                <tr key={p.id}>
                  <td className="cifra-codigo">{p.codigo}</td>
                  <td>
                    {p.nombre}
                    {p.archivado ? <span className="dato-de-apoyo">Archivado</span> : null}
                  </td>
                  <td className="col-descargas"><div>
                    <a className="boton boton-secundario" href={enlaceDeExportacion('presupuestos', p.id, 'pdf')} download>
                      <Icono nombre="descargar" />
                      PDF
                    </a>
                    <a className="boton boton-secundario" href={enlaceDeExportacion('presupuestos', p.id, 'xlsx')} download>
                      <Icono nombre="descargar" />
                      Excel
                    </a>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
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
    // D-76 · La prueba gratuita que pasó sus 10 días de solo lectura sin pago.
    if (s.canceladaPor === 'PRUEBA') {
      return {
        titulo: `La prueba de ${empresa} terminó`,
        texto: (
          <p>
            La prueba gratuita terminó sin pago y el plazo para decidir ya pasó, así que quedó cancelada. Los datos de la
            empresa se eliminan hoy y no se podrán recuperar: descargue abajo los proyectos que quiera conservar. Si quiere seguir
            usando ConstruSoft, escríbanos.
          </p>
        ),
        plazos: [],
        tono: 'peligro',
        icono: 'aviso',
      };
    }
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
        La suscripción venció el {d(s.venceEl)} y el pago no llegó a tiempo: el plazo era hasta el {d(s.pagarAMasTardar)}. Mientras esté suspendida, nadie
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
