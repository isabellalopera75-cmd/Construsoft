import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ErrorDeApi, pedir } from '../api/cliente.ts';
import type { Arranque } from '../api/tipos.ts';
import { Campo } from '../componentes/Campo.tsx';
import { Capa } from '../componentes/Capa.tsx';
import { Icono } from '../componentes/Icono.tsx';
import { PantallaSuelta } from '../componentes/PantallaSuelta.tsx';

/*
 * 02 §3.1 · Registro de una empresa nueva, contra el CONTRATO §3.
 *
 * Una sola pantalla con tres pasos encadenados, sin abandonarla: la cuenta
 * (nombre, correo, contraseña), la empresa (razón social, NIT y, si quiere, el
 * logotipo) y el plan, que es obligatorio. Debajo, la casilla de los términos.
 *
 * Lo que hace el servidor y la pantalla no repite: crear la empresa, su
 * configuración, el rol Administrador, el usuario y las doce unidades, y abrir
 * la sesión. Responde 201 con el mismo arranque que el ingreso.
 *
 * Los rechazos que conoce, con su campo para marcar el control:
 *   409 email  el correo ya tiene una cuenta;
 *   409 nit    el NIT ya está en otra empresa (es único en la plataforma);
 *   409        la versión de los términos cambió mientras se llenaba: se
 *              vuelven a pedir y la casilla se desmarca, porque lo aceptado
 *              tiene que ser el texto que se publica (04 §7);
 *   422        un dato que no sirve, con su campo.
 *
 * El logotipo no viaja en el registro: el registro es JSON y el logo es un
 * archivo con su propia ruta (CONTRATO §13), que exige sesión. Se sube justo
 * después, con la sesión que acaba de abrir el registro. Si esa subida falla,
 * la cuenta ya existe: se dice así y se deja entrar; el logo se sube luego
 * desde Configuración.
 */

type Plan = 'PERSONAL' | 'EMPRESARIAL';
type Campos = 'nombre' | 'email' | 'contrasena' | 'razonSocial' | 'nit' | 'plan' | 'logo' | 'terminos';
type Errores = Partial<Record<Campos, string | undefined>>;

interface DocumentoLegal {
  id: string;
  titulo: string;
  html: string;
}
interface Terminos {
  version: string;
  provisional: boolean;
  documentos: DocumentoLegal[];
}

const TIPOS_DE_LOGO = ['image/png', 'image/jpeg'];
const MAXIMO_DE_LOGO = 1024 * 1024;
const ORDEN: Campos[] = ['nombre', 'email', 'contrasena', 'razonSocial', 'nit', 'logo', 'plan', 'terminos'];

const PLANES: { codigo: Plan; titulo: string; detalle: string }[] = [
  { codigo: 'PERSONAL', titulo: 'Personal', detalle: 'Para un profesional independiente: usted y un asistente, con los roles de siempre.' },
  { codigo: 'EMPRESARIAL', titulo: 'Empresarial', detalle: 'Para un equipo: los usuarios que necesite y roles hechos a la medida.' },
];

export function Registro({ alEntrar }: { alEntrar: (arranque: Arranque) => void }) {
  const [datos, setDatos] = useState({ nombre: '', email: '', contrasena: '', razonSocial: '', nit: '' });
  const [plan, setPlan] = useState<Plan | null>(null);
  const [acepta, setAcepta] = useState(false);
  const [logo, setLogo] = useState<File | null>(null);
  const [vistaDelLogo, setVistaDelLogo] = useState<string | null>(null);
  const [errores, setErrores] = useState<Errores>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [terminos, setTerminos] = useState<Terminos | null>(null);
  const [errorDeTerminos, setErrorDeTerminos] = useState<string | null>(null);
  const [leyendo, setLeyendo] = useState<DocumentoLegal | null>(null);
  // La cuenta quedó creada pero el logo no subió: se dice, y un botón entra.
  const [creadaSinLogo, setCreadaSinLogo] = useState<{ arranque: Arranque; motivo: string } | null>(null);
  const formulario = useRef<HTMLFormElement>(null);
  const archivo = useRef<HTMLInputElement>(null);

  const leerTerminos = useCallback(async () => {
    setErrorDeTerminos(null);
    try {
      setTerminos(await pedir<Terminos>('/api/terminos'));
    } catch (e) {
      setErrorDeTerminos(e instanceof ErrorDeApi ? e.message : 'No se pudieron traer los términos.');
    }
  }, []);

  useEffect(() => {
    void leerTerminos();
    formulario.current?.querySelector<HTMLInputElement>('input')?.focus();
  }, [leerTerminos]);

  // La vista previa del logo es un objeto del navegador: se suelta al cambiarla.
  useEffect(() => {
    if (!logo) {
      setVistaDelLogo(null);
      return;
    }
    const url = URL.createObjectURL(logo);
    setVistaDelLogo(url);
    return () => URL.revokeObjectURL(url);
  }, [logo]);

  function cambiar(campo: keyof typeof datos, valor: string) {
    setDatos((d) => ({ ...d, [campo]: valor }));
    if (errores[campo]) setErrores((e) => ({ ...e, [campo]: undefined }));
  }

  function elegirLogo(elegido: File | undefined) {
    setErrores((e) => ({ ...e, logo: undefined }));
    if (!elegido) return;
    if (!TIPOS_DE_LOGO.includes(elegido.type)) {
      setErrores((e) => ({ ...e, logo: 'El logotipo tiene que ser una imagen PNG o JPEG.' }));
    } else if (elegido.size > MAXIMO_DE_LOGO) {
      setErrores((e) => ({ ...e, logo: 'El logotipo pesa más de 1 MB. Redúzcalo e intente de nuevo.' }));
    } else {
      setLogo(elegido);
    }
    if (archivo.current) archivo.current.value = '';
  }

  /** El foco va al primer campo con error, para corregirlo sin buscarlo. */
  function enfocar(faltan: Errores) {
    const primero = ORDEN.find((c) => faltan[c]);
    if (!primero) return;
    window.requestAnimationFrame(() => formulario.current?.querySelector<HTMLElement>(`[data-campo="${primero}"]`)?.focus());
  }

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    setError(null);
    const faltan: Errores = {};
    if (datos.nombre.trim() === '') faltan.nombre = 'Escriba su nombre.';
    if (datos.email.trim() === '') faltan.email = 'Escriba su correo.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.email.trim())) faltan.email = 'Ese correo no parece válido. Revíselo.';
    if (datos.contrasena.length < 8) faltan.contrasena = 'La contraseña necesita al menos 8 caracteres.';
    if (datos.razonSocial.trim() === '') faltan.razonSocial = 'Escriba la razón social, o su nombre si se registra como persona natural.';
    if (datos.nit.trim() === '') faltan.nit = 'El NIT es obligatorio. En el plan Personal es el de su RUT.';
    if (plan === null) faltan.plan = 'Elija un plan para terminar el registro.';
    if (!acepta) faltan.terminos = 'Para crear la cuenta tiene que aceptar los términos y la política de datos.';
    if (errores.logo) faltan.logo = errores.logo;
    setErrores(faltan);
    if (Object.values(faltan).some(Boolean)) {
      enfocar(faltan);
      return;
    }
    if (!terminos || plan === null) return;

    setEnviando(true);
    let arranque: Arranque;
    try {
      arranque = await pedir<Arranque>('/api/registro', {
        metodo: 'POST',
        cuerpo: {
          nombre: datos.nombre.trim(),
          email: datos.email.trim(),
          contrasena: datos.contrasena,
          razonSocial: datos.razonSocial.trim(),
          nit: datos.nit.trim(),
          plan,
          aceptaTerminos: true,
          versionTerminos: terminos.version,
        },
        el401EsDeLaPantalla: true,
      });
    } catch (e) {
      setEnviando(false);
      if (!(e instanceof ErrorDeApi)) {
        setError('Algo falló en esta pantalla. Recárguela e intente de nuevo.');
        return;
      }
      if (e.estado === 409 && !e.campo) {
        // Los términos cambiaron: el texto aceptado tiene que ser el vigente.
        setAcepta(false);
        void leerTerminos();
        setErrores({ terminos: e.message });
        enfocar({ terminos: e.message });
        return;
      }
      const campo = ORDEN.find((c) => c === e.campo);
      if (campo) {
        setErrores({ [campo]: e.message });
        enfocar({ [campo]: e.message });
      } else {
        setError(e.message);
      }
      return;
    }

    if (logo) {
      try {
        await pedir('/api/configuracion/empresa/logo', { metodo: 'PUT', archivo: logo });
      } catch (e) {
        setEnviando(false);
        setCreadaSinLogo({ arranque, motivo: e instanceof ErrorDeApi ? e.message : 'La subida no terminó.' });
        return;
      }
    }
    alEntrar(arranque);
  }

  if (creadaSinLogo) {
    return (
      <PantallaSuelta>
        <h1>Su cuenta está lista</h1>
        <p className="aviso-informativo" role="status">
          <span>Creamos la cuenta de {creadaSinLogo.arranque.razonSocial}. Tiene 15 días de prueba.</span>
        </p>
        <p className="campo-ayuda">
          El logotipo no se subió ({creadaSinLogo.motivo}). Puede subirlo cuando quiera desde Configuración, en Datos de empresa.
        </p>
        <button type="button" className="boton boton-principal boton-ancho" onClick={() => alEntrar(creadaSinLogo.arranque)}>
          Entrar a ConstruSoft
        </button>
      </PantallaSuelta>
    );
  }

  const documento = (id: string) => terminos?.documentos.find((d) => d.id === id);
  const enlaceA = (id: string, texto: string) => {
    const d = documento(id);
    return d ? (
      <button type="button" className="boton-enlace" onClick={() => setLeyendo(d)}>{texto}</button>
    ) : (
      texto
    );
  };

  return (
    <PantallaSuelta ancha>
      <h1>Crear una cuenta</h1>
      <p className="entrada-de-registro">
        Los primeros 15 días son de prueba, sin costo. Al terminar decide si sigue, y ningún dato se pierde mientras lo decide.
      </p>
      <form ref={formulario} className="formulario formulario-de-registro" onSubmit={enviar} noValidate>
        {error ? (
          <p className="aviso-error" role="alert">
            <Icono nombre="aviso" />
            <span>{error}</span>
          </p>
        ) : null}

        <fieldset className="paso-de-registro">
          <legend><span className="numero-de-paso">1</span>Su cuenta</legend>
          <Campo etiqueta="Nombre" error={errores.nombre}>
            {(a) => <input {...a} data-campo="nombre" autoComplete="name" value={datos.nombre} onChange={(e) => cambiar('nombre', e.target.value)} />}
          </Campo>
          <Campo etiqueta="Correo" error={errores.email} ayuda="Con él ingresa a ConstruSoft. No puede estar en otra cuenta.">
            {(a) => (
              <input {...a} data-campo="email" type="email" inputMode="email" autoComplete="email" value={datos.email}
                     onChange={(e) => cambiar('email', e.target.value)} />
            )}
          </Campo>
          <Campo etiqueta="Contraseña" error={errores.contrasena} ayuda="Mínimo 8 caracteres.">
            {(a) => (
              <input {...a} data-campo="contrasena" type="password" autoComplete="new-password" value={datos.contrasena}
                     onChange={(e) => cambiar('contrasena', e.target.value)} />
            )}
          </Campo>
        </fieldset>

        <fieldset className="paso-de-registro">
          <legend><span className="numero-de-paso">2</span>Su empresa</legend>
          <Campo etiqueta="Razón social" error={errores.razonSocial} ayuda="Si trabaja como persona natural, su nombre completo.">
            {(a) => (
              <input {...a} data-campo="razonSocial" autoComplete="organization" value={datos.razonSocial}
                     onChange={(e) => cambiar('razonSocial', e.target.value)} />
            )}
          </Campo>
          <Campo etiqueta="NIT" error={errores.nit} ayuda="En el plan Personal, el NIT de su RUT como persona natural.">
            {(a) => <input {...a} data-campo="nit" inputMode="numeric" autoComplete="off" value={datos.nit} onChange={(e) => cambiar('nit', e.target.value)} />}
          </Campo>
          <div className="campo" data-con-error={errores.logo ? 'si' : undefined}>
            <span className="etiqueta">Logotipo <span className="opcional">(opcional)</span></span>
            <div className="logo-de-registro">
              <div className="marco-de-logo" data-vacio={vistaDelLogo ? undefined : 'si'}>
                {vistaDelLogo ? <img src={vistaDelLogo} alt="Vista previa del logotipo" /> : <span>Sin logotipo</span>}
              </div>
              <div className="acciones-de-logo">
                <input ref={archivo} id="logo-de-registro" type="file" accept="image/png,image/jpeg" className="solo-lectores"
                       data-campo="logo" aria-describedby="ayuda-logo-registro" onChange={(e) => elegirLogo(e.target.files?.[0])} />
                <label htmlFor="logo-de-registro" className="boton boton-secundario">
                  <Icono nombre="subirArchivo" />
                  {logo ? 'Cambiar' : 'Elegir imagen'}
                </label>
                {logo ? (
                  <button type="button" className="boton boton-secundario" onClick={() => setLogo(null)}>Quitar</button>
                ) : null}
              </div>
            </div>
            <p id="ayuda-logo-registro" className="campo-ayuda">PNG o JPEG, hasta 1 MB. Sale en el encabezado de sus PDF; también puede subirlo después.</p>
            {errores.logo ? <p className="campo-error" role="alert">{errores.logo}</p> : null}
          </div>
        </fieldset>

        <fieldset className="paso-de-registro grupo-de-opciones" data-con-error={errores.plan ? 'si' : undefined}
                  aria-describedby={errores.plan ? 'error-plan' : undefined}>
          <legend><span className="numero-de-paso">3</span>Plan</legend>
          <div className="planes-de-registro">
            {PLANES.map((p, i) => (
              <label key={p.codigo} className="opcion">
                <input type="radio" name="plan" value={p.codigo} data-campo={i === 0 ? 'plan' : undefined} checked={plan === p.codigo}
                       onChange={() => { setPlan(p.codigo); setErrores((e) => ({ ...e, plan: undefined })); }} />
                <span>
                  <span className="opcion-titulo">{p.titulo}</span>
                  <span className="opcion-detalle">{p.detalle}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="campo-ayuda">Puede cambiar de plan más adelante, escribiéndonos.</p>
          {errores.plan ? <p id="error-plan" className="campo-error" role="alert">{errores.plan}</p> : null}
        </fieldset>

        <div className="campo" data-con-error={errores.terminos ? 'si' : undefined}>
          {errorDeTerminos ? (
            <p className="aviso-error" role="alert">
              <Icono nombre="aviso" />
              <span>{errorDeTerminos}</span>
              <button type="button" className="boton boton-secundario" onClick={() => void leerTerminos()}>Reintentar</button>
            </p>
          ) : null}
          <label className="casilla casilla-de-terminos">
            <input type="checkbox" data-campo="terminos" checked={acepta} disabled={!terminos}
                   aria-invalid={Boolean(errores.terminos)} aria-describedby={errores.terminos ? 'error-terminos' : undefined}
                   onChange={(e) => { setAcepta(e.target.checked); setErrores((x) => ({ ...x, terminos: undefined })); }} />
            <span>
              Leí y acepto los {enlaceA('terminos', 'Términos y Condiciones')} y la{' '}
              {enlaceA('privacidad', 'Política de Tratamiento de Datos Personales')}
            </span>
          </label>
          <p className="campo-ayuda">
            Vea también la {enlaceA('cookies', 'Política de Cookies')} y la {enlaceA('reembolsos', 'Política de Reembolsos')}.
          </p>
          {errores.terminos ? <p id="error-terminos" className="campo-error" role="alert">{errores.terminos}</p> : null}
        </div>

        <button type="submit" className="boton boton-principal boton-ancho" disabled={enviando || !terminos}>
          {enviando ? 'Creando la cuenta…' : 'Crear cuenta'}
        </button>
        <p className="pie-de-formulario">
          ¿Ya tiene una cuenta? <a href="#/">Ingresar</a>
        </p>
      </form>

      {leyendo ? (
        <Capa
          titulo={leyendo.titulo}
          alCerrar={() => setLeyendo(null)}
          hayCambios={false}
          acciones={(cerrar) => (
            <button type="button" className="boton boton-principal" onClick={cerrar}>Cerrar</button>
          )}
        >
          {/* El texto es el que publica la API, leído de legal/<versión>/: se pinta tal cual (CONTRATO §3). */}
          <div className="documento-legal" dangerouslySetInnerHTML={{ __html: leyendo.html }} />
        </Capa>
      ) : null}
    </PantallaSuelta>
  );
}
