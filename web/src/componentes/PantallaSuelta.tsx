import type { ReactNode } from 'react';

/*
 * Una tarjeta sola en el centro, con la marca arriba: ingreso, recuperación,
 * activación y el ingreso del superadministrador. `bajoLaMarca` dice de qué
 * aplicación es, cuando no es la de las empresas.
 */
export function PantallaSuelta({ children, bajoLaMarca }: { children: ReactNode; bajoLaMarca?: string }) {
  return (
    <div className="pantalla-suelta">
      <main className="tarjeta-suelta">
        <p className="marca-palabra marca-grande">ConstruSoft</p>
        {bajoLaMarca ? <p className="bajo-la-marca">{bajoLaMarca}</p> : null}
        {children}
      </main>
    </div>
  );
}
