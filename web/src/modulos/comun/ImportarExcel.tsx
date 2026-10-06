import { useId, useState, type ReactNode } from 'react';
import { ErrorDeApi, pedir, type ErrorDeFila } from '../../api/cliente.ts';
import { Capa } from '../../componentes/Capa.tsx';
import { Icono } from '../../componentes/Icono.tsx';

/*
 * Importación masiva desde Excel (CONTRATO §10; decisión del dueño, 6 de
 * octubre de 2026). Tres pasos: descargar la plantilla, llenarla, subirla.
 *
 * TODO O NADA. La API valida el archivo entero en una sola transacción: si una
 * fila tiene un error, no entra ninguna, y la respuesta trae el informe fila
 * por fila. Así un archivo a medio corregir nunca deja el catálogo a medias,
 * y volver a subirlo no duplica lo que sí había entrado.
 *
 * Solo CREA. El código lo pone el sistema, y editar por Excel se saltaría la
 * pregunta de qué proyectos abiertos se actualizan (02 §5.3 y §6.4).
 */

const TAMANO_MAXIMO = 2 * 1024 * 1024;
const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

interface Props {
  titulo: string;
  /** «recursos» o «APU», para los textos. */
  que: string;
  rutaPlantilla: string;
  rutaImportar: string;
  instrucciones: ReactNode;
  alCerrar: () => void;
  alImportar: (creados: number) => void;
}

export function ImportarExcel({ titulo, que, rutaPlantilla, rutaImportar, instrucciones, alCerrar, alImportar }: Props) {
  const idArchivo = useId();
  const [archivo, setArchivo] = useState<File | null>(null);
  const [errorDelArchivo, setErrorDelArchivo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [informe, setInforme] = useState<ErrorDeFila[] | null>(null);
  const [enviando, setEnviando] = useState(false);

  function elegir(f: File | null) {
    setInforme(null);
    setError(null);
    setErrorDelArchivo(null);
    if (!f) {
      setArchivo(null);
      return;
    }
    if (!/\.xlsx$/i.test(f.name)) {
      setErrorDelArchivo('Elija un archivo de Excel .xlsx: el de la plantilla, lleno. Un .xls viejo o un .csv no sirven.');
      setArchivo(null);
      return;
    }
    if (f.size > TAMANO_MAXIMO) {
      setErrorDelArchivo('El archivo pesa más de 2 MB. Divídalo en dos y súbalos por separado.');
      setArchivo(null);
      return;
    }
    setArchivo(f);
  }

  async function importar() {
    if (enviando) return;
    if (!archivo) {
      setErrorDelArchivo('Elija primero el archivo lleno.');
      return;
    }
    setEnviando(true);
    setError(null);
    setInforme(null);
    try {
      // El tipo se fija aunque el navegador no lo sepa: la API decide por él.
      const conTipo = archivo.type === TIPO_XLSX ? archivo : new File([archivo], archivo.name, { type: TIPO_XLSX });
      const r = await pedir<{ creados: number }>(rutaImportar, { metodo: 'POST', archivo: conTipo });
      alImportar(r.creados);
    } catch (e) {
      setEnviando(false);
      if (e instanceof ErrorDeApi && e.errores && e.errores.length > 0) {
        setInforme(e.errores);
        setError(e.message);
      } else {
        setError(e instanceof ErrorDeApi ? e.message : `No se importaron los ${que}. Intente de nuevo.`);
      }
    }
  }

  return (
    <Capa
      titulo={titulo}
      alCerrar={alCerrar}
      hayCambios={false}
      error={error}
      alEnviar={() => void importar()}
      acciones={(cerrar) => (
        <>
          <button type="button" className="boton boton-secundario" onClick={cerrar} disabled={enviando}>Cancelar</button>
          <button type="submit" className="boton boton-principal" disabled={enviando || !archivo}>
            {enviando ? 'Revisando el archivo…' : `Importar ${que}`}
          </button>
        </>
      )}
    >
      <ol className="pasos-de-importacion">
        <li>
          <span className="paso-titulo">Descargue la plantilla</span>
          <span className="campo-ayuda">Trae las listas de tipos y de unidades de su empresa, y las instrucciones en la primera hoja.</span>
          <a className="boton boton-secundario boton-chico-texto" href={rutaPlantilla} download>
            <Icono nombre="descargar" tamano={16} />
            Descargar plantilla
          </a>
        </li>
        <li>
          <span className="paso-titulo">Llénela en Excel</span>
          <div className="campo-ayuda">{instrucciones}</div>
        </li>
        <li>
          <span className="paso-titulo">Súbala</span>
          <span className="campo-ayuda">
            Se revisa entera antes de guardar. Si una fila tiene un error, no se importa ninguna y se le dice cuál
            corregir; corrija el archivo y vuelva a subirlo.
          </span>
          <div className="campo">
            <label htmlFor={idArchivo}>Archivo lleno (.xlsx)</label>
            <input
              id={idArchivo}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="campo-archivo"
              aria-describedby={errorDelArchivo ? `${idArchivo}-error` : undefined}
              onChange={(e) => elegir(e.target.files?.[0] ?? null)}
            />
            {errorDelArchivo ? <p id={`${idArchivo}-error`} className="campo-error" role="alert">{errorDelArchivo}</p> : null}
          </div>
        </li>
      </ol>

      {informe ? (
        <div className="informe-de-importacion">
          <p className="bloque-de-precio-titulo">
            {informe.length === 1 ? 'Hay 1 error que corregir' : `Hay ${informe.length} errores que corregir`}
          </p>
          <div className="tabla-con-desplazamiento">
            <table className="tabla">
              <caption className="solo-lectores">Errores del archivo, fila por fila</caption>
              <thead>
                <tr>
                  <th scope="col">Hoja</th>
                  <th scope="col" className="cifra">Fila</th>
                  <th scope="col">Columna</th>
                  <th scope="col">Qué corregir</th>
                </tr>
              </thead>
              <tbody>
                {informe.map((f, i) => (
                  <tr key={`${f.hoja}-${f.fila}-${f.columna ?? ''}-${i}`}>
                    <td>{f.hoja}</td>
                    <td className="cifra">{f.fila}</td>
                    <td>{f.columna ?? '—'}</td>
                    <td>{f.mensaje}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </Capa>
  );
}
