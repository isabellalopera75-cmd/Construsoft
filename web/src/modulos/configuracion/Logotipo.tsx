import { useRef, useState } from 'react';
import { ErrorDeApi, pedir } from '../../api/cliente.ts';
import type { Empresa } from '../../api/tipos.ts';
import { useAvisos } from '../../componentes/Avisos.tsx';
import { Confirmacion } from '../../componentes/Confirmacion.tsx';
import { Icono } from '../../componentes/Icono.tsx';
import { useSesion } from '../../sesion.tsx';
import { ErrorDeSeccion, Seccion, useLectura } from './piezas.tsx';

/*
 * 02 §11.2 · El logotipo de la empresa, contra el CONTRATO §13.
 *
 * Va aparte del formulario de datos porque es otro gesto: elegir un archivo lo
 * sube en el acto, sin «Guardar». Solo PNG y JPEG, hasta 1 MB: un SVG servido
 * en línea es ejecución de script (D-71). La pantalla lo revisa antes de subir
 * para no hacer esperar un rechazo; la API lo vuelve a revisar leyendo la
 * firma del archivo, que es lo que vale.
 *
 * Quitar el logo no borra la imagen: una versión congelada de un proyecto
 * puede estar usándola (D-64), y la pantalla lo dice.
 */

const TIPOS = ['image/png', 'image/jpeg'];
const MAXIMO = 1024 * 1024;

export function Logotipo() {
  const { datos, error, releer, poner } = useLectura<Empresa>('/api/configuracion/empresa');
  const { soloLectura } = useSesion();
  const { avisar } = useAvisos();
  const entrada = useRef<HTMLInputElement>(null);
  const [errorDeArchivo, setErrorDeArchivo] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [quitando, setQuitando] = useState(false);

  if (error) return <ErrorDeSeccion mensaje={error} alReintentar={releer} />;
  if (!datos) return null;
  const logoId = datos.logoId;

  async function subir(archivo: File) {
    setErrorDeArchivo(null);
    if (!TIPOS.includes(archivo.type)) {
      setErrorDeArchivo('El logotipo tiene que ser una imagen PNG o JPEG.');
      return;
    }
    if (archivo.size > MAXIMO) {
      setErrorDeArchivo('El logotipo pesa más de 1 MB. Redúzcalo e intente de nuevo.');
      return;
    }
    setSubiendo(true);
    try {
      const empresa = await pedir<Empresa>('/api/configuracion/empresa/logo', { metodo: 'PUT', archivo });
      poner(empresa);
      avisar(logoId ? 'Logotipo cambiado. Los PDF nuevos ya salen con él.' : 'Logotipo guardado. Los PDF nuevos ya salen con él.');
    } catch (e) {
      setErrorDeArchivo(e instanceof ErrorDeApi ? e.message : 'No se subió el logotipo. Intente de nuevo.');
    } finally {
      setSubiendo(false);
      if (entrada.current) entrada.current.value = '';
    }
  }

  return (
    <Seccion
      titulo="Logotipo"
      ayuda="Se imprime en el encabezado de los PDF y las exportaciones, junto a la razón social y el NIT. PNG o JPEG, hasta 1 MB; mejor horizontal y con fondo transparente."
    >
      <div className="bloque-de-logo">
        <div className="marco-de-logo" data-vacio={logoId ? undefined : 'si'}>
          {logoId ? (
            <img src={`/api/logos/${encodeURIComponent(logoId)}`} alt={`Logotipo de ${datos.razonSocial}`} />
          ) : (
            <span>Sin logotipo</span>
          )}
        </div>
        {soloLectura ? null : (
          <div className="acciones-de-logo">
            <input
              ref={entrada}
              id="archivo-de-logo"
              className="solo-lectores"
              type="file"
              accept="image/png,image/jpeg"
              disabled={subiendo}
              onChange={(e) => {
                const archivo = e.target.files?.[0];
                if (archivo) void subir(archivo);
              }}
            />
            <button type="button" className="boton boton-secundario" disabled={subiendo} onClick={() => entrada.current?.click()}>
              <Icono nombre="subirArchivo" />
              {subiendo ? 'Subiendo…' : logoId ? 'Cambiar logotipo' : 'Subir logotipo'}
            </button>
            {logoId ? (
              <button type="button" className="boton boton-peligroso" disabled={subiendo} onClick={() => setQuitando(true)}>
                Quitar logotipo
              </button>
            ) : null}
          </div>
        )}
      </div>
      {errorDeArchivo ? (
        <p className="aviso-error" role="alert"><Icono nombre="aviso" /><span>{errorDeArchivo}</span></p>
      ) : null}
      {quitando ? (
        <Confirmacion
          titulo="Quitar el logotipo"
          textoConfirmar="Quitar logotipo"
          textoEnviando="Quitando…"
          alCerrar={() => setQuitando(false)}
          alConfirmar={async () => {
            const empresa = await pedir<Empresa>('/api/configuracion/empresa/logo', { metodo: 'DELETE' });
            poner(empresa);
            setQuitando(false);
            avisar('Logotipo quitado. Los PDF nuevos salen con la razón social y el NIT.');
          }}
        >
          <p>Los PDF que genere desde ahora saldrán sin logotipo.</p>
          <p>Las versiones guardadas de sus proyectos conservan el logotipo que tenían cuando se guardaron: una oferta reimpresa se ve igual que el día en que salió.</p>
        </Confirmacion>
      ) : null}
    </Seccion>
  );
}
