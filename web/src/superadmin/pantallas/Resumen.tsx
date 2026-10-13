import type { ReactNode } from 'react';
import { ErrorDeSeccion, useLectura } from '../../modulos/configuracion/piezas.tsx';
import { dinero, fechaSola, InsigniasDeEmpresa, NOMBRE_DE_METODO, NOMBRE_DE_PLAN, textoDeDias } from '../comun.tsx';
import { enlaceA } from '../navegacion.ts';
import type { FilaDeEmpresa, PagoDePlataforma, Resumen as ResumenDeDatos } from '../tipos.ts';

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

      {datos.porVerificar.length > 0 ? <PagosPorVerificar pagos={datos.porVerificar} /> : null}

      <section className="cifras-del-panel" aria-label="Estado de las empresas">
        <Cifra titulo="Pagando" valor={e.activas} estado="ACTIVA" enlace="#/empresas?estado=ACTIVA" />
        <Cifra titulo="En prueba" valor={e.enPrueba} estado="EN_PRUEBA" enlace="#/empresas?estado=EN_PRUEBA" />
        <Cifra titulo="Por pagar" valor={e.porPagar} estado="POR_PAGAR" enlace="#/empresas?estado=POR_PAGAR" />
        <Cifra titulo="Pruebas vencidas" valor={e.vencidas} estado="VENCIDA" enlace="#/empresas?estado=VENCIDA" />
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

      <TarjetasDeEmpresas
        titulo="Vencen en los próximos 7 días"
        vacio="Ninguna empresa vence esta semana."
        filas={datos.porVencer}
        fecha={(f) => (f.venceEl ? <>Vence el {fechaSola(f.venceEl)} <span className="dato-de-apoyo">{textoDeDias(f.diasRestantes)}</span></> : '—')}
      />
      {datos.porEliminar.length > 0 ? (
        <TarjetasDeEmpresas
          titulo="Sus datos se eliminan pronto"
          vacio=""
          filas={datos.porEliminar}
          fecha={(f) => (f.eliminableDesde ? <>Se eliminan el {fechaSola(f.eliminableDesde)}</> : '—')}
        />
      ) : null}
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

/**
 * Las empresas que piden una acción, como tarjetas y no como filas (pedido del
 * dueño, 13 de octubre de 2026): el nombre, sus insignias y la fecha que
 * importa. Toda la tarjeta lleva a la ficha.
 */
function TarjetasDeEmpresas({
  titulo,
  vacio,
  filas,
  fecha,
}: {
  titulo: string;
  vacio: string;
  filas: FilaDeEmpresa[];
  fecha: (f: FilaDeEmpresa) => ReactNode;
}) {
  return (
    <section className="seccion-de-tarjetas" aria-label={titulo}>
      <h2>{titulo}</h2>
      {filas.length === 0 ? (
        <p className="vacio-en-linea">{vacio}</p>
      ) : (
        <ul className="tarjetas-de-empresa">
          {filas.map((f) => (
            <li key={f.id}>
              <a className="tarjeta tarjeta-de-empresa" href={enlaceA({ pantalla: 'empresa', id: f.id })}>
                <span className="tarjeta-de-empresa-nombre">{f.razonSocial}</span>
                <span className="dato-de-apoyo">NIT {f.nit}{f.planCodigo ? ` · ${NOMBRE_DE_PLAN[f.planCodigo]}` : ''}</span>
                <InsigniasDeEmpresa estado={f.estado} suspendida={f.suspendida} />
                <span className="tarjeta-de-empresa-fecha">{fecha(f)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/*
 * CONTRATO §14 · Lo primero que hay que hacer hoy: pagos que reportaron las
 * empresas y no dan acceso hasta que alguien los verifique contra el banco.
 */
function PagosPorVerificar({ pagos }: { pagos: PagoDePlataforma[] }) {
  return (
    <section className="tarjeta seccion-del-panel seccion-por-verificar">
      <h2>{pagos.length === 1 ? '1 pago por verificar' : `${pagos.length} pagos por verificar`}</h2>
      <p className="campo-ayuda">
        Las empresas los reportaron con su comprobante. No les dan acceso hasta que usted los confirme: revise que el dinero esté en la cuenta.
      </p>
      <div className="tarjeta-tabla tabla-con-borde">
        <table className="tabla">
          <caption className="solo-lectores">Pagos por verificar</caption>
          <thead>
            <tr>
              <th scope="col">Empresa</th>
              <th scope="col" className="col-numero">Monto</th>
              <th scope="col">Pagó el</th>
              <th scope="col">Medio</th>
              <th scope="col">Comprobante</th>
              <th scope="col"><span className="solo-lectores">Acción</span></th>
            </tr>
          </thead>
          <tbody>
            {pagos.map((p) => (
              <tr key={p.id}>
                <td>
                  <a className="enlace-de-empresa" href={enlaceA({ pantalla: 'empresa', id: p.empresa.id })}>{p.empresa.razonSocial}</a>
                  {p.reportadoPor ? <span className="dato-de-apoyo">Lo reportó {p.reportadoPor}</span> : null}
                </td>
                <td className="cifra col-numero">{dinero(p.monto, p.moneda)}</td>
                <td>{fechaSola(p.fecha)}</td>
                <td>{NOMBRE_DE_METODO[p.metodo]}{p.referencia ? <span className="dato-de-apoyo">ref. {p.referencia}</span> : null}</td>
                <td>{p.soporteId ? <a href={`/api/superadmin/soportes/${encodeURIComponent(p.soporteId)}`} target="_blank" rel="noopener">Ver</a> : '—'}</td>
                <td><a className="boton boton-secundario boton-de-periodo" href={enlaceA({ pantalla: 'empresa', id: p.empresa.id })}>Verificar</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
