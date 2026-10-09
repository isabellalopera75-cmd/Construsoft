import { ErrorDeSeccion, useLectura } from '../../modulos/configuracion/piezas.tsx';
import type { EventoDePlataforma } from '../tipos.ts';
import { ListaDeEventos } from './Ficha.tsx';

/*
 * Las acciones del panel, de la más reciente a la más antigua (D-38): quién
 * suspendió, quién registró un pago, quién designó un administrador y por qué.
 * Sobrevive a las empresas eliminadas.
 */

export function Bitacora() {
  const { datos, error, releer } = useLectura<{ eventos: EventoDePlataforma[] }>('/api/superadmin/eventos');
  if (error) return <ErrorDeSeccion mensaje={error} alReintentar={releer} />;
  return (
    <>
      <div className="encabezado-de-pantalla">
        <div>
          <h1>Bitácora</h1>
          <p className="subtitulo-de-pantalla">Todo lo que se hizo desde este panel, con su motivo. No se edita ni se borra.</p>
        </div>
      </div>
      <section className="tarjeta seccion-del-panel">
        {datos ? <ListaDeEventos eventos={datos.eventos} conEmpresa vacio="Todavía no hay acciones registradas." /> : <p className="campo-ayuda">Cargando…</p>}
      </section>
    </>
  );
}
