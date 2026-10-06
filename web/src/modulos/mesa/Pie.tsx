import { useState } from 'react';
import { ErrorDeApi } from '../../api/cliente.ts';
import type { Pie, Porcentajes } from '../../api/tipos.ts';
import { Icono } from '../../componentes/Icono.tsx';
import { PanelLateral } from '../../componentes/PanelLateral.tsx';
import { aTexto, leer, porcentajeDe, sumar } from '../../decimal.ts';
import { leerCifra, paraEditar } from '../../entrada.ts';
import { formatearNumero } from '../../formato.ts';
import { useSesion } from '../../sesion.tsx';

/*
 * 02 §8.6 · El pie financiero.
 *
 * Una barra fija con DOS renglones y nada más: costo directo y valor total. El
 * costo directo no es decoración: la clasificación de cada actividad se hereda
 * del capítulo, y es lo único del cálculo que puede salir mal sin producir
 * ningún error. El desglose vive en un panel lateral NO MODAL, que es además
 * donde se editan los cuatro porcentajes.
 *
 * El aviso de «no hay capítulos directos» va en la barra, nunca en el panel:
 * un aviso que hay que abrir para verlo no avisa.
 */

/** El texto lo fija el 02 §8.6. Se usa tal cual. */
const AVISO_SIN_BASE =
  'Este presupuesto no tiene capítulos de costo directo, así que el AIU da cero aunque esté configurado. ' +
  'Si lo que estás presupuestando es un servicio, esos costos son el costo directo de ese contrato y deberían clasificarse así.';

export function BarraDelPie({ pie, panelAbierto, alAlternarPanel }: { pie: Pie; panelAbierto: boolean; alAlternarPanel: () => void }) {
  const { arranque } = useSesion();
  const formato = arranque.formatoNumerico;
  return (
    <div className="barra-del-pie" role="region" aria-label="Totales del presupuesto">
      {pie.sinBaseAiu ? (
        <p className="aviso-del-pie" role="note">
          <Icono nombre="aviso" />
          <span>{AVISO_SIN_BASE}</span>
        </p>
      ) : null}
      <div className="barra-del-pie-cifras">
        <dl className="renglones-del-pie">
          <div>
            <dt>Total Costo Directo</dt>
            <dd className="cifra">{formatearNumero(pie.costoDirecto, formato)}</dd>
          </div>
          <div className="renglon-total">
            <dt>VALOR TOTAL</dt>
            <dd className="cifra">{formatearNumero(pie.valorTotal, formato)}</dd>
          </div>
        </dl>
        <button type="button" className="boton boton-secundario" aria-expanded={panelAbierto} aria-controls="panel-desglose" onClick={alAlternarPanel}>
          <Icono nombre="panel" />
          {panelAbierto ? 'Ocultar desglose' : 'Ver desglose'}
        </button>
      </div>
    </div>
  );
}

type Claves = keyof Porcentajes;
const NOMBRES: Record<Claves, string> = { a: 'Administración', i: 'Imprevistos', u: 'Utilidad', iva: 'IVA' };

export function PanelDeDesglose({
  pie,
  editable,
  alGuardar,
  alCerrar,
}: {
  pie: Pie;
  editable: boolean;
  alGuardar: (porcentajes: Porcentajes) => Promise<void>;
  alCerrar: () => void;
}) {
  const { arranque } = useSesion();
  const formato = arranque.formatoNumerico;
  const inicial = (Object.keys(NOMBRES) as Claves[]).reduce(
    (acc, k) => ({ ...acc, [k]: paraEditar(pie.porcentajes[k], formato) }),
    {} as Record<Claves, string>,
  );
  const [textos, setTextos] = useState(inicial);
  const [base, setBase] = useState(pie.porcentajes);
  const [errores, setErrores] = useState<Partial<Record<Claves, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Si llega otro pie (se guardó, o cambió la mesa), los campos lo siguen.
  if (base !== pie.porcentajes) {
    setBase(pie.porcentajes);
    setTextos(inicial);
  }

  const lecturas = (Object.keys(NOMBRES) as Claves[]).map((k) => [k, leerCifra(textos[k], { nombre: `el porcentaje de ${NOMBRES[k].toLowerCase()}` })] as const);
  const cambiados = (Object.keys(NOMBRES) as Claves[]).some((k) => textos[k] !== inicial[k]);
  const todosValidos = lecturas.every(([, l]) => 'valor' in l);

  // Vista previa mientras se escriben los porcentajes (02 §8.6: «el total se
  // mueve a la par»). Exacta, y marcada como previa: no se envía.
  let previa: Record<'administracion' | 'imprevistos' | 'utilidad' | 'aiu' | 'iva' | 'valorTotal', string> | null = null;
  if (cambiados && todosValidos) {
    const v = Object.fromEntries(lecturas.map(([k, l]) => [k, 'valor' in l ? l.valor : '0'])) as Record<Claves, string>;
    const cd = leer(pie.costoDirecto);
    const adm = porcentajeDe(cd, leer(v.a));
    const imp = porcentajeDe(cd, leer(v.i));
    const uti = porcentajeDe(cd, leer(v.u));
    const aiu = sumar(sumar(adm, imp), uti);
    const iva = porcentajeDe(uti, leer(v.iva));
    previa = {
      administracion: aTexto(adm),
      imprevistos: aTexto(imp),
      utilidad: aTexto(uti),
      aiu: aTexto(aiu),
      iva: aTexto(iva),
      valorTotal: aTexto(sumar(sumar(sumar(leer(pie.costoIndirecto), cd), aiu), iva)),
    };
  }

  async function guardar() {
    const faltan: Partial<Record<Claves, string>> = {};
    for (const [k, l] of lecturas) if ('error' in l) faltan[k] = l.error;
    setErrores(faltan);
    if (Object.keys(faltan).length > 0) return;
    setGuardando(true);
    setError(null);
    try {
      const v = Object.fromEntries(lecturas.map(([k, l]) => [k, 'valor' in l ? l.valor : '0'])) as unknown as Porcentajes;
      await alGuardar(v);
    } catch (e) {
      if (e instanceof ErrorDeApi && e.campo && e.campo in NOMBRES) setErrores({ [e.campo]: e.message });
      else setError(e instanceof ErrorDeApi ? e.message : 'No se guardaron los porcentajes. Intente de nuevo.');
    } finally {
      setGuardando(false);
    }
  }

  const cifra = (valor: string, clave?: keyof NonNullable<typeof previa>) => {
    const mostrado = previa && clave ? previa[clave] : valor;
    return (
      <dd className="cifra" data-previa={previa && clave ? 'si' : undefined}>
        {formatearNumero(mostrado, formato)}
      </dd>
    );
  };

  const campoPct = (k: Claves) =>
    editable ? (
      <span className="pct-editable">
        <input
          aria-label={`Porcentaje de ${NOMBRES[k].toLowerCase()}`}
          inputMode="decimal"
          className="cifra-editable campo-compacto"
          value={textos[k]}
          aria-invalid={Boolean(errores[k])}
          onChange={(e) => {
            setTextos((t) => ({ ...t, [k]: e.target.value }));
            if (errores[k]) setErrores((x) => ({ ...x, [k]: undefined }));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void guardar();
            }
          }}
        />
        <span aria-hidden="true">%</span>
      </span>
    ) : (
      <span className="pct-fijo">{formatearNumero(pie.porcentajes[k], formato)} %</span>
    );

  return (
    <PanelLateral titulo="Desglose del presupuesto" alCerrar={alCerrar}>
      <div id="panel-desglose">
        {error ? <p className="aviso-error" role="alert"><Icono nombre="aviso" /><span>{error}</span></p> : null}
        {/* El orden es decisión del dueño (02 §8.6) y es el mismo del PDF y el Excel. */}
        <dl className="desglose">
          <div><dt>Total Costo Indirecto</dt>{cifra(pie.costoIndirecto)}</div>
          <div className="desglose-fuerte"><dt>Total Costo Directo</dt>{cifra(pie.costoDirecto)}</div>
          <div className="desglose-pct"><dt>Administración (A) {campoPct('a')}</dt>{cifra(pie.administracion, 'administracion')}</div>
          <div className="desglose-pct"><dt>Imprevistos (I) {campoPct('i')}</dt>{cifra(pie.imprevistos, 'imprevistos')}</div>
          <div className="desglose-pct"><dt>Utilidad (U) {campoPct('u')}</dt>{cifra(pie.utilidad, 'utilidad')}</div>
          <div className="desglose-fuerte"><dt>AIU</dt>{cifra(pie.aiu, 'aiu')}</div>
          <div className="desglose-pct"><dt>IVA {campoPct('iva')}</dt>{cifra(pie.iva, 'iva')}</div>
          <div className="desglose-total"><dt>VALOR TOTAL</dt>{cifra(pie.valorTotal, 'valorTotal')}</div>
        </dl>
        {(Object.keys(NOMBRES) as Claves[]).map((k) =>
          errores[k] ? <p key={k} className="campo-error" role="alert">{NOMBRES[k]}: {errores[k]}</p> : null,
        )}
        <p className="campo-ayuda">
          El AIU se calcula sobre el costo directo; el IVA, solo sobre la utilidad. Los capítulos indirectos entran en el
          valor total pero no en la base del AIU.
        </p>
        {editable ? (
          <div className="pie-del-panel">
            {previa ? <p className="campo-ayuda">Vista previa: la cifra que vale es la que confirma el servidor al guardar.</p> : null}
            <div className="fila-de-botones">
              {cambiados ? (
                <button type="button" className="boton boton-secundario" onClick={() => { setTextos(inicial); setErrores({}); }} disabled={guardando}>
                  Descartar
                </button>
              ) : null}
              <button type="button" className="boton boton-secundario" onClick={() => void guardar()} disabled={!cambiados || guardando}>
                {guardando ? 'Guardando…' : 'Guardar porcentajes'}
              </button>
            </div>
          </div>
        ) : (
          <p className="campo-ayuda">Los porcentajes se editan con el presupuesto Abierto.</p>
        )}
      </div>
    </PanelLateral>
  );
}
