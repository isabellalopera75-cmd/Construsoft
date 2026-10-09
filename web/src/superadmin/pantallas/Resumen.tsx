import type { ReactNode } from 'react';
import { ErrorDeSeccion, useLectura } from '../../modulos/configuracion/piezas.tsx';
import { dinero, fechaSola, InsigniasDeEmpresa, NOMBRE_DE_PLAN, textoDeDias } from '../comun.tsx';
import { enlaceA } from '../navegacion.ts';
import type { FilaDeEmpresa, Resumen as ResumenDeDatos } from '../tipos.ts';

/*
 * RF-SAD-02 y RF-SAD-10 · Lo que el dueño mira primero al entrar: cuántas
 * empresas pagan, cuántas están por vencer y cuánto entró este mes. Las dos
 * listas de abajo son las que piden una acción hoy —cobrar o depurar—, por eso
 * van con el enlace a la ficha y no en una pantalla aparte.
 */

export function Resumen() {
  const { datos, error, releer } = useLectura<ResumenDeDatos>('/api/superadmin/resumen');
  if (error) return <ErrorDeSeccion mensaje={error} alReintentar={releer} />;
  if (!datos) return <p className="campo-ayuda">Cargando…</p>;
  const e = datos.empresas;

  return (
    <>
      <div className="encabezado-de-pantalla">
        <div>
          <h1>Resumen</h1>
          <p className="subtitulo-de-pantalla">{e.total === 1 ? '1 empresa registrada' : `${e.total} empresas registradas`}</p>
        </div>
      </div>

      <section className="cifras-del-panel" aria-label="Estado de las empresas">
        <Cifra titulo="Pagando" valor={e.activas} estado="ACTIVA" enlace="#/empresas?estado=ACTIVA" />
        <Cifra titulo="En prueba" valor={e.enPrueba} estado="EN_PRUEBA" enlace="#/empresas?estado=EN_PRUEBA" />
        <Cifra titulo="Vencidas" valor={e.vencidas} estado="VENCIDA" enlace="#/empresas?estado=VENCIDA" />
        <Cifra titulo="Suspendidas" valor={e.suspendidas} estado="SUSPENDIDA" enlace="#/empresas?estado=SUSPENDIDA" />
      </section>

      <section className="cifras-del-panel cifras-secundarias" aria-label="Este mes">
        <div className="tarjeta cifra-del-panel cifra-destacada">
          <span className="cifra-titulo">Ingresos del mes</span>
          <span className="cifra-valor">{dinero(datos.ingresosDelMes, datos.moneda)}</span>
          <a href={enlaceA({ pantalla: 'pagos' })}>Ver los pagos</a>
        </div>
        <div className="tarjeta cifra-del-panel">
          <span className="cifra-titulo">Nuevas este mes</span>
          <span className="cifra-valor">{datos.nuevasEsteMes}</span>
        </div>
        <div className="tarjeta cifra-del-panel">
          <span className="cifra-titulo">Por plan</span>
          <span className="cifra-reparto">
            <span><strong>{datos.porPlan.PERSONAL}</strong> {NOMBRE_DE_PLAN.PERSONAL}</span>
            <span><strong>{datos.porPlan.EMPRESARIAL}</strong> {NOMBRE_DE_PLAN.EMPRESARIAL}</span>
          </span>
        </div>
        <div className="tarjeta cifra-del-panel">
          <span className="cifra-titulo">Proyectos en la plataforma</span>
          <span className="cifra-valor">{datos.proyectos}</span>
        </div>
      </section>

      <ListaDeAccion
        titulo="Vencen en los próximos 7 días"
        ayuda="Empresas en prueba o al día que pierden el acceso pronto. Registrar el pago se hace desde su ficha."
        vacio="Ninguna empresa vence esta semana."
        filas={datos.porVencer}
        columnaFinal={(f) => (f.venceEl ? <>{fechaSola(f.venceEl)} <span className="dato-de-apoyo">{textoDeDias(f.diasRestantes)}</span></> : '—')}
        tituloFinal="Vence"
      />
      <ListaDeAccion
        titulo="Pruebas vencidas sin pago"
        ayuda="Empresas que terminaron la prueba sin pagar. Sus datos se pueden eliminar a partir de 10 días después del vencimiento, siempre a mano (RF-SAD-13)."
        vacio="No hay pruebas vencidas sin pago."
        filas={datos.pruebasSinConvertir}
        columnaFinal={(f) => (f.eliminableDesde ? `Desde el ${fechaSola(f.eliminableDesde)}` : '—')}
        tituloFinal="Se puede eliminar"
      />
    </>
  );
}

function Cifra({ titulo, valor, estado, enlace }: { titulo: string; valor: number; estado: string; enlace: string }) {
  return (
    <a className="tarjeta cifra-del-panel cifra-enlace" href={enlace} data-estado={estado}>
      <span className="cifra-titulo">{titulo}</span>
      <span className="cifra-valor">{valor}</span>
    </a>
  );
}

function ListaDeAccion({
  titulo,
  ayuda,
  vacio,
  filas,
  columnaFinal,
  tituloFinal,
}: {
  titulo: string;
  ayuda: string;
  vacio: string;
  filas: FilaDeEmpresa[];
  columnaFinal: (f: FilaDeEmpresa) => ReactNode;
  tituloFinal: string;
}) {
  return (
    <section className="tarjeta seccion-del-panel">
      <h2>{titulo}</h2>
      <p className="campo-ayuda">{ayuda}</p>
      {filas.length === 0 ? (
        <p className="vacio-en-linea">{vacio}</p>
      ) : (
        <div className="tarjeta-tabla tabla-con-borde">
          <table className="tabla">
            <caption className="solo-lectores">{titulo}</caption>
            <thead>
              <tr>
                <th scope="col">Empresa</th>
                <th scope="col">Plan</th>
                <th scope="col">Estado</th>
                <th scope="col">{tituloFinal}</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id}>
                  <td>
                    <a className="enlace-de-empresa" href={enlaceA({ pantalla: 'empresa', id: f.id })}>{f.razonSocial}</a>
                    <span className="dato-de-apoyo">NIT {f.nit}</span>
                  </td>
                  <td>{f.planCodigo ? NOMBRE_DE_PLAN[f.planCodigo] : '—'}</td>
                  <td><InsigniasDeEmpresa estado={f.estado} suspendida={f.suspendida} /></td>
                  <td>{columnaFinal(f)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
