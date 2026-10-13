import type { ReactNode } from 'react';

/*
 * Una tarjeta sola en el centro, con la marca arriba: ingreso, recuperación,
 * activación y el ingreso del superadministrador. `bajoLaMarca` dice de qué
 * aplicación es, cuando no es la de las empresas. `ancha`, para el registro,
 * que tiene tres pasos y no cabe en la tarjeta del ingreso.
 */
export function PantallaSuelta({ children, bajoLaMarca, ancha = false }: { children: ReactNode; bajoLaMarca?: string; ancha?: boolean }) {
  return (
    <div className="pantalla-suelta">
      <main className={ancha ? 'tarjeta-suelta tarjeta-suelta-ancha' : 'tarjeta-suelta'}>
        <p className="marca-palabra marca-grande">ConstruSoft</p>
        {bajoLaMarca ? <p className="bajo-la-marca">{bajoLaMarca}</p> : null}
        {children}
      </main>
    </div>
  );
}
