import type { Revision as DatosDeRevision, VistaCronograma } from '../../api/tiposCronograma.ts';
import { Icono } from '../../componentes/Icono.tsx';

/*
 * La lista de revisión (RF-PRG-07, RN-39): lo que hay que mirar antes de dar
 * el cronograma por terminado. Es el estado de ahora, no un historial: una
 * actividad sale de «sin programar» con su primera relación.
 */

const GRUPOS: { clave: keyof DatosDeRevision; titulo: string; explicacion: string; grave: boolean }[] = [
  { clave: 'holguraNegativa', titulo: 'Con holgura negativa', explicacion: 'Una restricción que la lógica no deja cumplir: la obra va tarde contra esa fecha.', grave: true },
  { clave: 'yaNoEstan', titulo: 'Ya no están en el presupuesto', explicacion: 'Su ítem salió del presupuesto. Revise qué cadena se rompe y elimínelas.', grave: true },
  { clave: 'sinProgramar', titulo: 'Sin programar', explicacion: 'Actividades del presupuesto sin ninguna relación: arrancan el primer día.', grave: false },
  { clave: 'sinRendimiento', titulo: 'Sin rendimiento ni duración', explicacion: 'Su APU no tiene rendimiento y nadie escribió la duración: duran cero.', grave: false },
  { clave: 'manualDistinta', titulo: 'Duración manual distinta de la calculada', explicacion: 'La escrita a mano manda; la calculada se muestra en su panel.', grave: false },
  { clave: 'sinPredecesora', titulo: 'Sin predecesora', explicacion: 'Cabos sueltos. El hito de inicio del proyecto siempre aparece aquí, y es lo esperado.', grave: false },
  { clave: 'sinSucesora', titulo: 'Sin sucesora', explicacion: 'Cabos sueltos. El hito de fin del proyecto siempre aparece aquí, y es lo esperado.', grave: false },
];

export function contarRevision(r: DatosDeRevision): number {
  const ids = new Set<string>();
  for (const g of GRUPOS) for (const id of r[g.clave]) ids.add(id);
  return ids.size;
}

export function Revision({ vista, alIr }: { vista: VistaCronograma; alIr: (id: string) => void }) {
  const porId = new Map(vista.actividades.map((a) => [a.id, a]));
  const conAlgo = GRUPOS.filter((g) => vista.revision[g.clave].length > 0);
  return (
    <section className="revision" aria-labelledby="titulo-revision">
      <h2 id="titulo-revision" className="titulo-de-bloque">Revisión</h2>
      <p className="campo-ayuda">El software no crea relaciones: las define quien programa. Esta lista señala lo que falta para que el cronograma no parezca terminado cuando no lo está.</p>
      {conAlgo.length === 0 ? <p className="vacio">Nada que revisar.</p> : null}
      <div className="revision-grupos">
        {conAlgo.map((g) => (
          <section key={g.clave} className="tarjeta revision-grupo" data-grave={g.grave ? 'si' : 'no'}>
            <h3>
              {g.grave ? <Icono nombre="aviso" tamano={18} /> : null}
              {g.titulo} <span className="pestana-conteo">{vista.revision[g.clave].length}</span>
            </h3>
            <p className="dato-de-apoyo">{g.explicacion}</p>
            <ul>
              {vista.revision[g.clave].map((id) => {
                const a = porId.get(id);
                return a ? (
                  <li key={id}>
                    <button type="button" className="enlace-de-actividad" onClick={() => alIr(id)}>
                      <span className="cifra-codigo">{a.codigo}</span>
                      <span>{a.nombre}</span>
                    </button>
                  </li>
                ) : null;
              })}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}
