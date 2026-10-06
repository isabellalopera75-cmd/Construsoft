import { useId, type ReactNode } from 'react';

/*
 * Un campo con su etiqueta arriba y siempre visible, nunca solo un placeholder
 * (DISENO §8): el placeholder desaparece al escribir, y quien vuelve a revisar
 * el formulario ya no sabe qué era ese campo.
 *
 * El error va debajo, con role="alert", y el control queda con
 * aria-describedby apuntándolo y aria-invalid. El control lo pone quien llama,
 * que recibe los atributos ya armados.
 */

export interface AtributosDeControl {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': boolean;
}

interface Props {
  etiqueta: string;
  error?: string | null | undefined;
  ayuda?: string;
  children: (atributos: AtributosDeControl) => ReactNode;
}

export function Campo({ etiqueta, error, ayuda, children }: Props) {
  const id = useId();
  const idAyuda = `${id}-ayuda`;
  const idError = `${id}-error`;
  const describe = [ayuda ? idAyuda : null, error ? idError : null].filter(Boolean).join(' ');

  return (
    <div className="campo" data-con-error={error ? 'si' : undefined}>
      <label htmlFor={id}>{etiqueta}</label>
      {children({ id, 'aria-describedby': describe === '' ? undefined : describe, 'aria-invalid': Boolean(error) })}
      {ayuda ? <p id={idAyuda} className="campo-ayuda">{ayuda}</p> : null}
      {error ? (
        <p id={idError} className="campo-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
