import { useState } from 'react';
import { ErrorDeApi, pedir } from '../api/cliente.ts';
import type { ModoEstructura, NuevoPresupuesto } from '../api/tipos.ts';
import { Campo } from '../componentes/Campo.tsx';
import { Capa } from '../componentes/Capa.tsx';
import { useSesion } from '../sesion.tsx';

/*
 * 02 §7.1 · Crear un presupuesto. Una capa encima de la vista maestra, sin
 * redirigir; al crearlo, se va a la mesa de trabajo.
 *
 * El código repetido lo dice el servidor (409 con campo «codigo»). El 02 pide
 * que lo valide «de inmediato»; no hay una ruta para preguntarlo antes de
 * enviar, así que se valida al presionar «Iniciar Presupuesto» y el error queda
 * debajo del campo, con el formulario abierto.
 *
 * La moneda se muestra como dato fijo y la pone la base (D-6). Sale del
 * arranque (monedaBase), que no pide CONFIG.PREFERENCIAS.
 */

type Campos = 'codigo' | 'nombre' | 'ubicacion' | 'modoEstructura';

const VACIO = { codigo: '', nombre: '', ubicacion: '', modoEstructura: '' as ModoEstructura | '' };

export function CrearPresupuesto({ alCerrar, alCrear }: { alCerrar: () => void; alCrear: (id: string) => void }) {
  const moneda = useSesion().arranque.monedaBase;
  const [datos, setDatos] = useState(VACIO);
  const [errores, setErrores] = useState<Partial<Record<Campos, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const hayCambios =
    datos.codigo !== '' || datos.nombre !== '' || datos.ubicacion !== '' || datos.modoEstructura !== '';

  function cambiar<K extends keyof typeof VACIO>(campo: K, valor: (typeof VACIO)[K]) {
    setDatos((d) => ({ ...d, [campo]: valor }));
    // Al corregir un campo, su error se va: ya no describe lo que hay escrito.
    if (errores[campo]) setErrores((e) => ({ ...e, [campo]: undefined }));
  }

  async function enviar() {
    if (enviando) return;
    const faltan: Partial<Record<Campos, string>> = {};
    if (datos.codigo.trim() === '') faltan.codigo = 'Escriba el código del presupuesto, por ejemplo PRE-2026-001.';
    if (datos.nombre.trim() === '') faltan.nombre = 'Escriba el nombre del proyecto.';
    if (datos.ubicacion.trim() === '') faltan.ubicacion = 'Escriba la ciudad o región de la obra.';
    if (datos.modoEstructura === '') faltan.modoEstructura = 'Elija la estructura: por ítems o por EDT.';
    setErrores(faltan);
    setError(null);
    const primero = (['codigo', 'nombre', 'ubicacion', 'modoEstructura'] as const).find((c) => faltan[c]);
    if (primero) {
      enfocar(primero);
      return;
    }

    const cuerpo: NuevoPresupuesto = {
      codigo: datos.codigo.trim(),
      nombre: datos.nombre.trim(),
      ubicacion: datos.ubicacion.trim(),
      modoEstructura: datos.modoEstructura as ModoEstructura,
    };
    setEnviando(true);
    try {
      const creado = await pedir<{ id: string }>('/api/presupuestos', { metodo: 'POST', cuerpo });
      alCrear(creado.id);
    } catch (e) {
      setEnviando(false);
      if (!(e instanceof ErrorDeApi)) {
        setError('Algo falló en esta pantalla y no se creó el presupuesto. Intente de nuevo.');
        return;
      }
      // Con campo, se marca el campo y el formulario sigue abierto (CONTRATO §2).
      if (e.campo && esCampo(e.campo)) {
        setErrores({ [e.campo]: e.message });
        enfocar(e.campo);
      } else {
        setError(e.message);
      }
    }
  }

  return (
    <Capa
      titulo="Crear Nuevo Presupuesto"
      alCerrar={alCerrar}
      hayCambios={hayCambios}
      error={error}
      alEnviar={() => void enviar()}
      acciones={(cerrar) => (
        <>
          <button type="button" className="boton boton-secundario" onClick={cerrar} disabled={enviando}>
            Cancelar
          </button>
          <button type="submit" className="boton boton-principal" disabled={enviando}>
            {enviando ? 'Creando…' : 'Iniciar Presupuesto'}
          </button>
        </>
      )}
    >
      <Campo etiqueta="Código del presupuesto" ayuda="Lo elige usted y no se puede repetir en su empresa. Ejemplo: PRE-2026-001." error={errores.codigo}>
        {(a) => (
          <input {...a} data-campo="codigo" autoComplete="off" spellCheck={false} value={datos.codigo}
                 onChange={(e) => cambiar('codigo', e.target.value)} />
        )}
      </Campo>
      <Campo etiqueta="Nombre del proyecto" error={errores.nombre}>
        {(a) => (
          <input {...a} data-campo="nombre" autoComplete="off" value={datos.nombre}
                 onChange={(e) => cambiar('nombre', e.target.value)} />
        )}
      </Campo>
      <Campo etiqueta="Ubicación" ayuda="Ciudad o región de la obra." error={errores.ubicacion}>
        {(a) => (
          <input {...a} data-campo="ubicacion" autoComplete="off" value={datos.ubicacion}
                 onChange={(e) => cambiar('ubicacion', e.target.value)} />
        )}
      </Campo>

      <div className="campo">
        <span className="etiqueta">Moneda</span>
        <p className="dato-fijo">
          {moneda}
          <span className="dato-de-apoyo">Se toma de la configuración de la empresa; no se elige por proyecto.</span>
        </p>
      </div>

      <fieldset className="campo grupo-de-opciones" data-con-error={errores.modoEstructura ? 'si' : undefined}
                aria-describedby={errores.modoEstructura ? 'error-estructura' : undefined}>
        <legend className="etiqueta">Estructura</legend>
        <label className="opcion">
          <input type="radio" name="modoEstructura" value="ITEMS" data-campo="modoEstructura"
                 checked={datos.modoEstructura === 'ITEMS'} onChange={() => cambiar('modoEstructura', 'ITEMS')} />
          <span>
            <span className="opcion-titulo">Por ítems</span>
            <span className="opcion-detalle">Capítulo → actividad</span>
          </span>
        </label>
        <label className="opcion">
          <input type="radio" name="modoEstructura" value="WBS"
                 checked={datos.modoEstructura === 'WBS'} onChange={() => cambiar('modoEstructura', 'WBS')} />
          <span>
            <span className="opcion-titulo">Por EDT</span>
            <span className="opcion-detalle">Capítulo → subcapítulo → actividad, con actividades también bajo el capítulo</span>
          </span>
        </label>
        <p className="campo-ayuda">Se puede cambiar mientras el presupuesto esté Abierto.</p>
        {errores.modoEstructura ? (
          <p id="error-estructura" className="campo-error" role="alert">{errores.modoEstructura}</p>
        ) : null}
      </fieldset>
    </Capa>
  );
}

function esCampo(campo: string): campo is Campos {
  return campo === 'codigo' || campo === 'nombre' || campo === 'ubicacion' || campo === 'modoEstructura';
}

/** El foco va al primer campo con error, para que se corrija sin buscarlo. */
function enfocar(campo: Campos) {
  window.requestAnimationFrame(() => {
    document.querySelector<HTMLElement>(`dialog[open] [data-campo="${campo}"]`)?.focus();
  });
}
