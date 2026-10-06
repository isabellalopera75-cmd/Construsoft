import { BotonVolver } from '../cascaron/Cascaron.tsx';

export function NoExiste() {
  return (
    <>
      <div className="encabezado-de-pantalla">
        <div className="encabezado-con-volver">
          <BotonVolver a={{ pantalla: 'inicio' }} nombre="Inicio" />
          <h1>Esa dirección no existe</h1>
        </div>
      </div>
      <div className="vacio">
        <p>Puede que el enlace esté incompleto o que la sección se haya movido. Desde el inicio llega a todos los módulos.</p>
      </div>
    </>
  );
}
