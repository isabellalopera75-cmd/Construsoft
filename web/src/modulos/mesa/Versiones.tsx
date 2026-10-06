import { useEffect, useState } from 'react';
import { ErrorDeApi, pedir } from '../../api/cliente.ts';
import type { DisparadorVersion, Version, VersionConFotografia } from '../../api/tipos.ts';
import { Capa } from '../../componentes/Capa.tsx';
import { Icono } from '../../componentes/Icono.tsx';
import { InsigniaDeEstado } from '../../componentes/Insignia.tsx';
import { formatearFechaYHora, paraAtributo } from '../../fechas.ts';
import { formatearNumero } from '../../formato.ts';
import { useSesion } from '../../sesion.tsx';

/*
 * 02 §10.1 · El historial de versiones: número, fecha, motivo y usuario. Desde
 * acá se consulta una versión en solo lectura —el presupuesto tal como
 * estaba— o se exporta a PDF o Excel. Nada de esto se edita ni se borra.
 */

const DISPARADORES: Record<DisparadorVersion, string> = {
  ABIERTO_A_ACTIVO: 'Línea base: al activar',
  ACTIVO_A_ABIERTO: 'Al reabrir: conserva la línea base anterior',
  ACTIVO_A_CERRADO: 'Al cerrar',
  MANUAL: 'Guardada a mano',
};

export function enlaceDeExportacion(tipo: 'presupuestos' | 'versiones', id: string, formato: 'pdf' | 'xlsx'): string {
  return `/api/${tipo}/${encodeURIComponent(id)}/exportar?formato=${formato}`;
}

export function ListaDeVersiones({ versiones, alCerrar }: { versiones: Version[]; alCerrar: () => void }) {
  const { arranque, puede } = useSesion();
  const formato = arranque.formatoNumerico;
  const [consultando, setConsultando] = useState<string | null>(null);
  const exporta = puede('PRESUPUESTOS.EXPORTAR');
  const ordenadas = [...versiones].sort((a, b) => b.numero - a.numero);

  return (
    <>
      <Capa
        titulo="Historial de versiones"
        alCerrar={alCerrar}
        hayCambios={false}
        acciones={(cerrar) => (
          <button type="button" className="boton boton-secundario" onClick={cerrar}>Cerrar</button>
        )}
      >
        {ordenadas.length === 0 ? (
          <p className="campo-ayuda">
            Todavía no hay versiones. Se guarda una sola al activar, al reabrir y al cerrar, y en cualquier momento con
            «Guardar versión».
          </p>
        ) : (
          <ol className="lista-de-versiones">
            {ordenadas.map((v) => (
              <li key={v.id} className="version">
                <div className="version-cabecera">
                  <span className="version-numero">Versión {v.numero}</span>
                  <InsigniaDeEstado estado={v.estado} />
                  <span className="cifra version-valor">{formatearNumero(v.valorTotal, formato)}</span>
                </div>
                <p className="dato-de-apoyo">
                  <time dateTime={paraAtributo(v.creadaEn)}>{formatearFechaYHora(v.creadaEn)}</time>
                  {v.autor ? ` · ${v.autor}` : ''} · {DISPARADORES[v.disparador]}
                </p>
                {v.motivo ? <p className="version-motivo">«{v.motivo}»</p> : null}
                <div className="fila-de-botones fila-izquierda">
                  <button type="button" className="boton boton-secundario boton-chico-texto" onClick={() => setConsultando(v.id)}>
                    Consultar
                  </button>
                  {exporta ? (
                    <>
                      <a className="boton boton-secundario boton-chico-texto" href={enlaceDeExportacion('versiones', v.id, 'pdf')} download>
                        <Icono nombre="descargar" tamano={16} /> PDF
                      </a>
                      <a className="boton boton-secundario boton-chico-texto" href={enlaceDeExportacion('versiones', v.id, 'xlsx')} download>
                        <Icono nombre="descargar" tamano={16} /> Excel
                      </a>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Capa>
      {consultando ? <VersionEnLectura id={consultando} alCerrar={() => setConsultando(null)} /> : null}
    </>
  );
}

/** Una versión en solo lectura: la fotografía tal como quedó (D-28). */
function VersionEnLectura({ id, alCerrar }: { id: string; alCerrar: () => void }) {
  const { arranque } = useSesion();
  const formato = arranque.formatoNumerico;
  const [version, setVersion] = useState<VersionConFotografia | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    pedir<VersionConFotografia>(`/api/versiones/${encodeURIComponent(id)}`)
      .then(setVersion)
      .catch((e: unknown) => setError(e instanceof ErrorDeApi ? e.message : 'No se pudo leer la versión.'));
  }, [id]);

  const filas = version ? filasDeFotografia(version) : [];
  const p = version?.fotografia.presupuesto;

  return (
    <Capa
      titulo={version ? `Versión ${version.numero} · solo lectura` : 'Versión'}
      alCerrar={alCerrar}
      hayCambios={false}
      error={error}
      acciones={(cerrar) => <button type="button" className="boton boton-secundario" onClick={cerrar}>Cerrar</button>}
    >
      {!version && !error ? <p className="campo-ayuda">Cargando la versión…</p> : null}
      {version && p ? (
        <>
          <p className="dato-de-apoyo">
            {p.codigo} · {p.nombre} · {p.ubicacion} · guardada el {formatearFechaYHora(version.creadaEn)}
          </p>
          <div className="tabla-con-desplazamiento">
            <table className="tabla tabla-version">
              <caption className="solo-lectores">Estructura de la versión {version.numero}</caption>
              <thead>
                <tr>
                  <th scope="col">N.º</th>
                  <th scope="col">Descripción</th>
                  <th scope="col">Und.</th>
                  <th scope="col" className="cifra">Cantidad</th>
                  <th scope="col" className="cifra">P. unitario</th>
                  <th scope="col" className="cifra">Valor</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) =>
                  f.tipo === 'capitulo' ? (
                    <tr key={f.id} className="fila-nodo" data-raiz={f.nivel === 1 ? 'si' : undefined}>
                      <td className="cifra-codigo">{f.codigo}</td>
                      <td colSpan={4}>
                        <strong>{f.nombre}</strong>
                        {f.nivel === 1 ? <span className="insignia insignia-clasificacion" data-clasificacion={f.clasificacion}>{f.clasificacion === 'DIRECTO' ? 'Directo' : 'Indirecto'}</span> : null}
                      </td>
                      <td className="cifra">{formatearNumero(f.monto, formato)}</td>
                    </tr>
                  ) : (
                    <tr key={f.id}>
                      <td className="cifra-codigo">{f.codigo}</td>
                      <td><span className="cifra-codigo cifra-apu">{f.codigoApu}</span> {f.nombre}</td>
                      <td>{f.unidad}</td>
                      <td className="cifra">{formatearNumero(f.cantidad, formato)}</td>
                      <td className="cifra">{formatearNumero(f.precio, formato)}</td>
                      <td className="cifra">{formatearNumero(f.monto, formato)}</td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
          <dl className="desglose desglose-compacto">
            <div><dt>Total Costo Indirecto</dt><dd className="cifra">{formatearNumero(p.totales.costoIndirecto, formato)}</dd></div>
            <div className="desglose-fuerte"><dt>Total Costo Directo</dt><dd className="cifra">{formatearNumero(p.totales.costoDirecto, formato)}</dd></div>
            <div><dt>Administración ({formatearNumero(p.aiu.a, formato)} %)</dt><dd className="cifra">{formatearNumero(p.totales.administracion, formato)}</dd></div>
            <div><dt>Imprevistos ({formatearNumero(p.aiu.i, formato)} %)</dt><dd className="cifra">{formatearNumero(p.totales.imprevistos, formato)}</dd></div>
            <div><dt>Utilidad ({formatearNumero(p.aiu.u, formato)} %)</dt><dd className="cifra">{formatearNumero(p.totales.utilidad, formato)}</dd></div>
            <div className="desglose-fuerte"><dt>AIU</dt><dd className="cifra">{formatearNumero(p.totales.aiu, formato)}</dd></div>
            <div><dt>IVA ({formatearNumero(p.ivaUtilidadPct, formato)} %)</dt><dd className="cifra">{formatearNumero(p.totales.iva, formato)}</dd></div>
            <div className="desglose-total"><dt>VALOR TOTAL</dt><dd className="cifra">{formatearNumero(p.totales.valorTotal, formato)}</dd></div>
          </dl>
        </>
      ) : null}
    </Capa>
  );
}

type FilaDeVersion =
  | { tipo: 'capitulo'; id: string; codigo: string; nivel: number; nombre: string; clasificacion: string; monto: string; orden: number[] }
  | { tipo: 'item'; id: string; codigo: string; codigoApu: string; nombre: string; unidad: string; cantidad: string; precio: string; monto: string; orden: number[] };

/*
 * La fotografía trae capítulos e ítems por separado y sin posición. Se
 * intercalan por su código convertido a números —nunca comparando el texto—:
 * capítulos e ítems comparten el contador del padre (D-42), así que el número
 * ya dice el orden. El «.0» de primer nivel es notación, no un nivel.
 */
function numeros(codigo: string, primerNivel: boolean): number[] {
  // eslint-disable-next-line no-restricted-globals -- un segmento de la numeración de la EDT, no dinero
  const partes = codigo.split('.').map((s) => parseInt(s, 10));
  return primerNivel ? partes.slice(0, 1) : partes;
}

function filasDeFotografia(v: VersionConFotografia): FilaDeVersion[] {
  const filas: FilaDeVersion[] = [
    ...v.fotografia.capitulos.map((c): FilaDeVersion => ({
      tipo: 'capitulo', id: c.id, codigo: c.codigoWbs, nivel: c.nivel, nombre: c.nombre,
      clasificacion: c.clasificacion, monto: c.montoAcumulado, orden: numeros(c.codigoWbs, c.nivel === 1),
    })),
    ...v.fotografia.items.map((i): FilaDeVersion => ({
      tipo: 'item', id: i.id, codigo: i.codigoItem, codigoApu: i.codigoApu, nombre: i.descripcion, unidad: i.unidad,
      cantidad: i.cantidad, precio: i.precioUnitario, monto: i.costoTotal, orden: numeros(i.codigoItem, false),
    })),
  ];
  return filas.sort((a, b) => {
    for (let k = 0; k < Math.max(a.orden.length, b.orden.length); k++) {
      const x = a.orden[k];
      const y = b.orden[k];
      if (x === undefined) return -1;
      if (y === undefined) return 1;
      if (x !== y) return x - y;
    }
    return 0;
  });
}
