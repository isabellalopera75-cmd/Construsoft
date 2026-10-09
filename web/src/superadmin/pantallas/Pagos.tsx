import { useEffect, useState } from 'react';
import { ErrorDeApi, pedir } from '../../api/cliente.ts';
import { ErrorDeSeccion } from '../../modulos/configuracion/piezas.tsx';
import { dinero, fechaSola, hoy, NOMBRE_DE_METODO, primeroDelMes } from '../comun.tsx';
import { enlaceA } from '../navegacion.ts';
import type { PagoDePlataforma } from '../tipos.ts';

/*
 * RF-SAD-08 · Los pagos de todas las empresas en un rango de fechas, con su
 * total: lo que el dueño concilia contra el extracto del banco. Arranca en el
 * mes en curso. El total lo suma el servidor (regla 1.1).
 */

export function Pagos() {
  const [desde, setDesde] = useState(primeroDelMes());
  const [hasta, setHasta] = useState(hoy());
  const [datos, setDatos] = useState<{ pagos: PagoDePlataforma[]; total: string; moneda: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vez, setVez] = useState(0);

  useEffect(() => {
    if (desde === '' || hasta === '' || desde > hasta) return;
    let vigente = true;
    setDatos(null);
    pedir<{ pagos: PagoDePlataforma[]; total: string; moneda: string }>(`/api/superadmin/pagos?desde=${desde}&hasta=${hasta}`)
      .then((r) => vigente && (setDatos(r), setError(null)))
      .catch((e: unknown) => vigente && setError(e instanceof ErrorDeApi ? e.message : 'No se pudieron leer los pagos.'));
    return () => {
      vigente = false;
    };
  }, [desde, hasta, vez]);

  return (
    <>
      <div className="encabezado-de-pantalla">
        <div>
          <h1>Pagos</h1>
          <p className="subtitulo-de-pantalla">Lo que registró el panel, para conciliar con el banco. Un pago se registra desde la ficha de su empresa.</p>
        </div>
      </div>
      <div className="barra-de-filtros">
        <div className="campo">
          <label htmlFor="pagos-desde">Desde</label>
          <input id="pagos-desde" type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="pagos-hasta">Hasta</label>
          <input id="pagos-hasta" type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} />
        </div>
        {datos ? (
          <p className="total-del-filtro">
            {datos.pagos.length === 1 ? '1 pago' : `${datos.pagos.length} pagos`} · <strong>{dinero(datos.total, datos.moneda)}</strong>
          </p>
        ) : null}
      </div>
      {desde > hasta ? <p className="aviso-error" role="alert">La fecha inicial es posterior a la final.</p> : null}
      {error ? <ErrorDeSeccion mensaje={error} alReintentar={() => setVez((n) => n + 1)} /> : null}
      {!datos && !error && desde <= hasta ? <p className="campo-ayuda">Cargando…</p> : null}
      {datos && datos.pagos.length === 0 ? <div className="vacio"><p>No hay pagos registrados entre esas fechas.</p></div> : null}
      {datos && datos.pagos.length > 0 ? (
        <div className="tarjeta tarjeta-tabla">
          <table className="tabla">
            <caption className="solo-lectores">Pagos registrados</caption>
            <thead>
              <tr>
                <th scope="col">Fecha</th>
                <th scope="col">Empresa</th>
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
                  <td><a href={enlaceA({ pantalla: 'empresa', id: p.empresa.id })}>{p.empresa.razonSocial}</a></td>
                  <td>{p.concepto}<span className="dato-de-apoyo">Registró {p.registradoPor}{p.referencia ? ` · ref. ${p.referencia}` : ''}</span></td>
                  <td>{NOMBRE_DE_METODO[p.metodo]}</td>
                  <td className="cifra col-numero">{dinero(p.monto, p.moneda)}</td>
                  <td>{fechaSola(p.cubreHasta)}</td>
                  <td>{p.soporteId ? <a href={`/api/superadmin/soportes/${encodeURIComponent(p.soporteId)}`} target="_blank" rel="noopener">Ver</a> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
