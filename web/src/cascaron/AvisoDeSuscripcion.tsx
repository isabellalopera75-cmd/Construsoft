import { Icono } from '../componentes/Icono.tsx';
import { enlaceA } from '../navegacion.ts';
import { useSesion } from '../sesion.tsx';

/*
 * El aviso permanente de la suscripción (02 §3.4). Lo que decide si se puede
 * escribir es `soloLectura`, que manda el servidor (D-65); el `estado` solo
 * elige las palabras. Las dos cosas no se mezclan: la pantalla no deduce
 * «solo lectura» de «vencida».
 *
 * Los textos no los fija el 02 y quedan a revisión del dueño (DISENO §12).
 */

export function AvisoDeSuscripcion() {
  const { arranque } = useSesion();
  const suscripcion = arranque.suscripcion;
  const aSuscripcion = enlaceA({ pantalla: 'configuracion', pestana: 'suscripcion' });

  // Null es «sin acceso», nunca «al día» (CONTRATO §3.1).
  if (suscripcion === null) {
    return (
      <Franja tono="peligro" icono="candado">
        No se pudo confirmar el estado de la suscripción de su empresa, así que por ahora no se pueden
        guardar cambios. Recargue la página; si sigue igual, escríbanos.
      </Franja>
    );
  }

  if (suscripcion.estado === 'SUSPENDIDA') {
    // «Pagar no lo resuelve» (02 §3.4): no se ofrece el camino de pago.
    return (
      <Franja tono="peligro" icono="candado">
        El acceso de su empresa fue suspendido por la administración de ConstruSoft. Puede consultar y
        exportar lo que tiene, pero no guardar cambios. Esto no se resuelve con un pago: escríbanos para
        conocer el motivo.
      </Franja>
    );
  }

  if (suscripcion.soloLectura) {
    return (
      <Franja tono="aviso" icono="candado">
        La suscripción de su empresa no está vigente: puede consultar y exportar todo lo que tiene, pero no
        guardar cambios. Sus datos se conservan intactos. <a href={aSuscripcion}>Ver cómo renovarla</a>
      </Franja>
    );
  }

  if (suscripcion.estado === 'EN_PRUEBA') {
    const dias = suscripcion.diasRestantes;
    const cuantos = dias <= 0 ? 'Hoy es el último día' : dias === 1 ? 'Queda 1 día' : `Quedan ${dias} días`;
    return (
      <Franja tono={dias <= 2 ? 'aviso' : 'neutro'} icono="reloj">
        Período de prueba. {cuantos}. <a href={aSuscripcion}>Ver la suscripción</a>
      </Franja>
    );
  }

  return null;
}

function Franja({
  tono,
  icono,
  children,
}: {
  tono: 'neutro' | 'aviso' | 'peligro';
  icono: 'reloj' | 'candado';
  children: React.ReactNode;
}) {
  // role="status" y no "alert": está desde que carga la pantalla, no es algo
  // que acaba de pasar, y no tiene que interrumpir a quien usa lector.
  return (
    <div className="franja-de-suscripcion" data-tono={tono} role="status">
      <Icono nombre={icono} />
      <p>{children}</p>
    </div>
  );
}
