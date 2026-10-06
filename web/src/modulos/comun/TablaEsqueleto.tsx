/** Mientras llega la primera respuesta: la forma de la tabla, sin datos (DISENO §9). */
export function TablaEsqueleto({ texto }: { texto: string }) {
  return (
    <div className="tarjeta tarjeta-tabla" aria-busy="true">
      <p className="solo-lectores">{texto}</p>
      <div className="esqueleto" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="esqueleto-fila">
            <span /><span /><span /><span />
          </div>
        ))}
      </div>
    </div>
  );
}
