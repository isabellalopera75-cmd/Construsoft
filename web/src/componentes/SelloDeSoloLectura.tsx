import { Icono } from './Icono.tsx';

/*
 * Por qué no se puede editar, en un sello chico en la esquina de la cabecera
 * (pedido del dueño, 23 de octubre de 2026). Antes era una franja a todo el
 * ancho que ocupaba un renglón entero. El motivo completo se lee al pasar el
 * mouse y lo oye el lector de pantalla.
 */
export function SelloDeSoloLectura({ motivo }: { motivo: string }) {
  return (
    <span className="sello-de-solo-lectura" role="note" title={motivo}>
      <Icono nombre="candado" tamano={14} />
      Solo lectura
      <span className="solo-lectores">: {motivo}</span>
    </span>
  );
}
