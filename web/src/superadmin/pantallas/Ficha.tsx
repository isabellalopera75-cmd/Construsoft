import { useState } from 'react';
import { pedir } from '../../api/cliente.ts';
import { useAvisos } from '../../componentes/Avisos.tsx';
import { Confirmacion } from '../../componentes/Confirmacion.tsx';
import { Icono } from '../../componentes/Icono.tsx';
import { formatearFecha, formatearFechaYHora } from '../../fechas.ts';
import { ErrorDeSeccion, useLectura } from '../../modulos/configuracion/piezas.tsx';
import { dinero, fechaSola, hoy, InsigniasDeEmpresa, NOMBRE_DE_METODO, NOMBRE_DE_PLAN, textoDeDias } from '../comun.tsx';
import { CambiarSuscripcion, DesignarAdministrador, EliminarEmpresa, RegistrarPago } from '../dialogos/Dialogos.tsx';
import { enlaceA } from '../navegacion.ts';
import type { EventoDePlataforma, FichaDeEmpresa } from '../tipos.ts';

/*
 * La ficha de una empresa: todo lo que el superadministrador hace sobre ella
 * sale de aquí (RF-SAD-03 a 09, 12 a 15). Las acciones van arriba en el orden
 * en que se usan —cobrar es lo de todos los días— y las que no tienen vuelta
 * atrás van abajo, separadas, en la «zona de cuidado».
 *
 * El panel no ve proyectos ni catálogos (01 §9): solo cuántos hay.
 */

type Dialogo = 'pago' | 'suscripcion' | 'suspender' | 'reactivar' | 'administrador' | 'cancelar' | 'eliminar' | null;

export function Ficha({ id }: { id: string }) {
  const ruta = `/api/superadmin/empresas/${encodeURIComponent(id)}`;
  const { datos, error, releer, poner } = useLectura<FichaDeEmpresa>(ruta);
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const { avisar } = useAvisos();

  if (error) return <ErrorDeSeccion mensaje={error} alReintentar={releer} />;
  if (!datos) return <p className="campo-ayuda">Cargando…</p>;
  const { empresa, suscripcion, cifras } = datos;
  const cerrar = () => setDialogo(null);
  const listo = (ficha: FichaDeEmpresa, aviso: string) => {
    poner(ficha);
    setDialogo(null);
    avisar(aviso);
  };
  const eliminable = datos.eliminableDesde !== null && datos.eliminableDesde <= hoy();

  return (
    <>
      <div className="encabezado-de-pantalla">
        <div className="encabezado-con-volver">
          <a className="boton boton-secundario boton-volver" href={enlaceA({ pantalla: 'empresas' })}>
            <Icono nombre="volver" />
            <span>Volver<span className="solo-lectores"> a Empresas</span></span>
          </a>
          <h1>{empresa.razonSocial}</h1>
          <p className="subtitulo-de-pantalla">
            NIT {empresa.nit} · registrada el {formatearFecha(empresa.registradaEn)}
          </p>
          {suscripcion ? <InsigniasDeEmpresa estado={suscripcion.estado} suspendida={empresa.suspendida} /> : null}
        </div>
      </div>

      {empresa.suspendida ? (
        <p className="franja-de-estado franja-suspendida">
          <Icono nombre="pausa" />
          <span>
            <strong>Suspendida.</strong> La empresa entra pero no puede abrir Recursos, APU ni Proyectos, y ve que la suspendió la
            administración de ConstruSoft. Sus datos están intactos. Registrar un pago no la reactiva: hay que reactivarla aquí.
          </span>
        </p>
      ) : null}

      <div className="acciones-de-ficha">
        <button type="button" className="boton boton-principal" disabled={!suscripcion} onClick={() => setDialogo('pago')}>
          <Icono nombre="pagos" />
          Registrar pago
        </button>
        <button type="button" className="boton boton-secundario" disabled={!suscripcion} onClick={() => setDialogo('suscripcion')}>
          Cambiar plan o vencimiento
        </button>
        {empresa.suspendida ? (
          <button type="button" className="boton boton-secundario" onClick={() => setDialogo('reactivar')}>
            <Icono nombre="reanudar" />
            Reactivar
          </button>
        ) : (
          <button type="button" className="boton boton-secundario" onClick={() => setDialogo('suspender')}>
            <Icono nombre="pausa" />
            Suspender
          </button>
        )}
        <button type="button" className="boton boton-secundario" onClick={() => setDialogo('administrador')}>
          <Icono nombre="invitar" />
          Designar administrador
        </button>
      </div>

      <div className="rejilla-de-ficha">
        <section className="tarjeta seccion-del-panel">
          <h2>Suscripción</h2>
          {suscripcion ? (
            <dl className="datos-estaticos datos-en-rejilla">
              <div><dt>Plan</dt><dd>{NOMBRE_DE_PLAN[suscripcion.planCodigo]}</dd></div>
              <div><dt>Desde</dt><dd>{fechaSola(suscripcion.fechaInicio)}</dd></div>
              <div><dt>Vence</dt><dd>{fechaSola(suscripcion.venceEl)}</dd></div>
              <div><dt>Días</dt><dd>{textoDeDias(suscripcion.diasRestantes)}</dd></div>
              {suscripcion.canceladaMotivo ? (
                <div className="dato-ancho"><dt>Motivo de la cancelación</dt><dd>{suscripcion.canceladaMotivo}</dd></div>
              ) : null}
            </dl>
          ) : (
            <p className="campo-ayuda">Esta empresa no tiene suscripción. Es una alta incompleta: revísela con el equipo técnico.</p>
          )}
        </section>
        <section className="tarjeta seccion-del-panel">
          <h2>Uso</h2>
          <dl className="datos-estaticos datos-en-rejilla">
            <div><dt>Proyectos</dt><dd>{cifras.proyectos}</dd></div>
            <div><dt>Recursos</dt><dd>{cifras.recursos}</dd></div>
            <div><dt>APU</dt><dd>{cifras.apus}</dd></div>
            <div><dt>Usuarios</dt><dd>{datos.usuarios.filter((u) => u.estado !== 'REVOCADO').length}</dd></div>
          </dl>
        </section>
        <section className="tarjeta seccion-del-panel">
          <h2>Contacto</h2>
          <dl className="datos-estaticos">
            <div><dt>Dirección</dt><dd>{empresa.direccion ?? '—'}</dd></div>
            <div><dt>Teléfono</dt><dd>{empresa.telefono ?? '—'}</dd></div>
            <div><dt>Correo de recuperación</dt><dd>{empresa.emailRecuperacion ?? '—'}</dd></div>
          </dl>
        </section>
      </div>

      <section className="tarjeta seccion-del-panel">
        <h2>Pagos</h2>
        {datos.pagos.length === 0 ? (
          <p className="vacio-en-linea">Todavía no tiene pagos registrados.</p>
        ) : (
          <div className="tarjeta-tabla tabla-con-borde">
            <table className="tabla">
              <caption className="solo-lectores">Pagos de la empresa</caption>
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Concepto</th>
                  <th scope="col">Método</th>
                  <th scope="col" className="col-numero">Monto</th>
                  <th scope="col">Cubre hasta</th>
                  <th scope="col">Comprobante</th>
                </tr>
              </thead>
              <tbody>
                {datos.pagos.map((p) => (
                  <tr key={p.id}>
                    <td>{fechaSola(p.fecha)}</td>
                    <td>
                      {p.concepto}
                      <span className="dato-de-apoyo">Registró {p.registradoPor}{p.referencia ? ` · ref. ${p.referencia}` : ''}</span>
                    </td>
                    <td>{NOMBRE_DE_METODO[p.metodo]}</td>
                    <td className="cifra col-numero">{dinero(p.monto, p.moneda)}</td>
                    <td>{fechaSola(p.cubreHasta)}</td>
                    <td>
                      {p.soporteId ? (
                        <a href={`/api/superadmin/soportes/${encodeURIComponent(p.soporteId)}`} target="_blank" rel="noopener">Ver</a>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="tarjeta seccion-del-panel">
        <h2>Usuarios</h2>
        <div className="tarjeta-tabla tabla-con-borde">
          <table className="tabla">
            <caption className="solo-lectores">Usuarios de la empresa</caption>
            <thead>
              <tr>
                <th scope="col">Nombre</th>
                <th scope="col">Rol</th>
                <th scope="col">Estado</th>
                <th scope="col">Último ingreso</th>
              </tr>
            </thead>
            <tbody>
              {datos.usuarios.map((u) => (
                <tr key={u.id}>
                  <td>{u.nombre}<span className="dato-de-apoyo">{u.email}</span></td>
                  <td>{u.rolNombre}</td>
                  <td><span className="insignia insignia-usuario" data-estado={u.estado}>{nombreDeEstadoDeUsuario(u.estado)}</span></td>
                  <td>{u.ultimoAcceso ? formatearFecha(u.ultimoAcceso) : 'Nunca'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="tarjeta seccion-del-panel">
        <h2>Bitácora de la empresa</h2>
        <ListaDeEventos eventos={datos.eventos} conEmpresa={false} vacio="Ninguna acción del panel sobre esta empresa todavía." />
      </section>

      <section className="tarjeta seccion-del-panel zona-de-cuidado">
        <h2>Zona de cuidado</h2>
        <div className="accion-de-cuidado">
          <div>
            <h3>Cancelar la suscripción</h3>
            <p className="campo-ayuda">Decisión comercial: la empresa queda en solo lectura y conserva todos sus datos. Se revierte registrando un pago.</p>
          </div>
          <button type="button" className="boton boton-peligroso" disabled={!suscripcion || suscripcion.estado === 'CANCELADA'} onClick={() => setDialogo('cancelar')}>
            Cancelar suscripción
          </button>
        </div>
        <div className="accion-de-cuidado">
          <div>
            <h3>Eliminar los datos de la empresa</h3>
            <p className="campo-ayuda">
              {datos.eliminableDesde === null
                ? 'No se puede: la empresa pagó alguna vez o su prueba no ha vencido. Sus datos se conservan; si hace falta, suspéndala.'
                : eliminable
                  ? 'Su prueba venció hace más de 10 días sin pago. Borra todo lo de la empresa y no se puede deshacer.'
                  : `Se podrá a partir del ${fechaSola(datos.eliminableDesde)}, 10 días después de vencer la prueba.`}
            </p>
          </div>
          <button type="button" className="boton boton-peligroso" disabled={!eliminable} onClick={() => setDialogo('eliminar')}>
            Eliminar datos
          </button>
        </div>
      </section>

      {dialogo === 'pago' && suscripcion ? (
        <RegistrarPago ficha={datos} alCerrar={cerrar} alRegistrar={(f) => listo(f, `Pago registrado. ${f.empresa.razonSocial} queda vigente hasta el ${fechaSola(f.suscripcion?.venceEl ?? '')}.`)} />
      ) : null}
      {dialogo === 'suscripcion' && suscripcion ? (
        <CambiarSuscripcion ficha={datos} alCerrar={cerrar} alGuardar={(f) => listo(f, 'Suscripción actualizada.')} />
      ) : null}
      {dialogo === 'administrador' ? (
        <DesignarAdministrador ficha={datos} alCerrar={cerrar} alDesignar={(f, nuevo) => listo(f, nuevo
          ? 'Administrador designado. Está pendiente: genere su enlace de activación con npm run activacion.'
          : 'Administrador designado.')} />
      ) : null}
      {dialogo === 'eliminar' ? <EliminarEmpresa ficha={datos} alCerrar={cerrar} /> : null}
      {dialogo === 'suspender' ? (
        <Confirmacion
          titulo={`Suspender a ${empresa.razonSocial}`}
          textoConfirmar="Suspender empresa"
          textoEnviando="Suspendiendo…"
          peligroso
          pideTexto={{ etiqueta: 'Motivo', ayuda: 'Queda en la bitácora del panel. La empresa no lo ve.', campo: 'motivo', vacio: 'Escriba el motivo de la suspensión.' }}
          alCerrar={cerrar}
          alConfirmar={async (motivo) => listo(await pedir<FichaDeEmpresa>(`${ruta}/suspender`, { metodo: 'POST', cuerpo: { motivo } }), 'Empresa suspendida. Sus usuarios lo verán en su siguiente acción.')}
        >
          <p>Nadie de la empresa podrá abrir Recursos, APU ni Proyectos hasta que la reactive. Los datos no se tocan y la suscripción sigue corriendo.</p>
        </Confirmacion>
      ) : null}
      {dialogo === 'reactivar' ? (
        <Confirmacion
          titulo={`Reactivar a ${empresa.razonSocial}`}
          textoConfirmar="Reactivar empresa"
          textoEnviando="Reactivando…"
          pideTexto={{ etiqueta: 'Motivo', ayuda: 'Queda en la bitácora del panel.', campo: 'motivo', vacio: 'Escriba el motivo de la reactivación.' }}
          alCerrar={cerrar}
          alConfirmar={async (motivo) => listo(await pedir<FichaDeEmpresa>(`${ruta}/reactivar`, { metodo: 'POST', cuerpo: { motivo } }), 'Empresa reactivada.')}
        >
          <p>La empresa recupera el acceso que le dé su suscripción: si está vencida, sigue en solo lectura hasta que pague.</p>
        </Confirmacion>
      ) : null}
      {dialogo === 'cancelar' ? (
        <Confirmacion
          titulo={`Cancelar la suscripción de ${empresa.razonSocial}`}
          textoConfirmar="Cancelar suscripción"
          textoEnviando="Cancelando…"
          peligroso
          pideTexto={{ etiqueta: 'Motivo', ayuda: 'Queda guardado con la suscripción y en la bitácora.', campo: 'motivo', vacio: 'Escriba el motivo de la cancelación.' }}
          alCerrar={cerrar}
          alConfirmar={async (motivo) => listo(await pedir<FichaDeEmpresa>(`${ruta}/suscripcion/cancelar`, { metodo: 'POST', cuerpo: { motivo } }), 'Suscripción cancelada.')}
        >
          <p>La empresa queda en solo lectura desde ya: puede consultar y exportar, pero no editar. Sus datos se conservan.</p>
        </Confirmacion>
      ) : null}
    </>
  );
}

function nombreDeEstadoDeUsuario(estado: string): string {
  return estado === 'ACTIVO' ? 'Activo' : estado === 'PENDIENTE' ? 'Pendiente' : estado === 'REVOCADO' ? 'Revocado' : estado;
}

const NOMBRES_DE_EVENTO: Record<string, string> = {
  TENANT_CREADO: 'Empresa registrada',
  TENANT_SUSPENDIDO: 'Suspendida',
  TENANT_REACTIVADO: 'Reactivada',
  TENANT_ELIMINADO: 'Datos eliminados',
  PLAN_CAMBIADO: 'Suscripción cambiada',
  SUSCRIPCION_CANCELADA: 'Suscripción cancelada',
  PAGO_REGISTRADO: 'Pago registrado',
  ADMIN_DESIGNADO: 'Administrador designado',
};

export function ListaDeEventos({ eventos, conEmpresa, vacio }: { eventos: EventoDePlataforma[]; conEmpresa: boolean; vacio: string }) {
  if (eventos.length === 0) return <p className="vacio-en-linea">{vacio}</p>;
  return (
    <ol className="lista-de-eventos">
      {eventos.map((e) => (
        <li key={e.id}>
          <div className="evento-cabeza">
            <span className="evento-tipo" data-tipo={e.tipo}>{NOMBRES_DE_EVENTO[e.tipo] ?? e.tipo}</span>
            {conEmpresa ? (
              e.empresa ? <a href={enlaceA({ pantalla: 'empresa', id: e.empresa.id })}>{e.empresa.razonSocial}</a> : <span className="dato-de-apoyo">Empresa eliminada</span>
            ) : null}
            <time className="dato-de-apoyo">{formatearFechaYHora(e.ocurridoEn)}{e.autor ? ` · ${e.autor}` : ''}</time>
          </div>
          <p>{e.descripcion}</p>
          {e.justificacion ? <p className="evento-justificacion">«{e.justificacion}»</p> : null}
        </li>
      ))}
    </ol>
  );
}
