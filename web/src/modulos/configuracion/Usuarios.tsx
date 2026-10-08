import { useMemo, useState } from 'react';
import { ErrorDeApi, pedir } from '../../api/cliente.ts';
import type { EstadoUsuario, PanelDeUsuarios, Permiso, PermisoDelCatalogo, Rol, TipoDeRol, Usuario } from '../../api/tipos.ts';
import { useAvisos } from '../../componentes/Avisos.tsx';
import { Campo } from '../../componentes/Campo.tsx';
import { Capa } from '../../componentes/Capa.tsx';
import { Confirmacion } from '../../componentes/Confirmacion.tsx';
import { Icono } from '../../componentes/Icono.tsx';
import { formatearFecha, formatearFechaYHora } from '../../fechas.ts';
import { useSesion } from '../../sesion.tsx';
import { ErrorDeSeccion, Seccion, useLectura } from './piezas.tsx';

/*
 * 02 §11.4 · Usuarios, contra la forma que propone el CONTRATO §11.
 *
 * El contenido depende del plan, y el plan llega en la misma lectura:
 *   - Personal: el ingeniero y su único asistente. Se invita al asistente y
 *     se marcan los permisos del rol Asistente. No hay roles que crear.
 *   - Empresarial: usuarios con cualquier rol, y roles personalizados con su
 *     matriz de permisos.
 *
 * Invitar no fija contraseña (D-7) y, hasta la fase 8, tampoco manda correo:
 * el enlace de activación lo entrega el dueño de ConstruSoft. La pantalla no
 * lo muestra a propósito —quien tiene el enlace elige la contraseña de otra
 * persona— y lo dice con todas las letras en vez de prometer un correo que no
 * sale (decisión del dueño, 8 de octubre de 2026).
 *
 * Lo que la base rechaza igual (el último administrador, el límite del plan,
 * la coherencia de la matriz), la pantalla no lo ofrece. Si llega a pasar, el
 * mensaje del servidor va tal cual.
 */

const NOMBRES_DE_ESTADO: Record<EstadoUsuario, string> = {
  ACTIVO: 'Activo',
  PENDIENTE: 'Pendiente',
  REVOCADO: 'Revocado',
};

const NOMBRES_DE_TIPO: Record<TipoDeRol, string> = {
  ADMIN: 'Del sistema',
  ASISTENTE: 'Del sistema',
  PERSONALIZADO: 'Personalizado',
};

export function Usuarios() {
  const { datos, error, releer } = useLectura<PanelDeUsuarios>('/api/usuarios');
  if (error) return <ErrorDeSeccion mensaje={error} alReintentar={releer} />;
  if (!datos) return <p className="campo-ayuda">Cargando…</p>;
  return <PanelDeUsuariosVista panel={datos} releer={releer} />;
}

function PanelDeUsuariosVista({ panel, releer }: { panel: PanelDeUsuarios; releer: () => void }) {
  const { puedeEscribir } = useSesion();
  const { avisar } = useAvisos();
  const escribe = puedeEscribir('USUARIOS.GESTIONAR');
  const personal = panel.plan.codigo === 'PERSONAL';

  const [editando, setEditando] = useState<Usuario | 'nuevo' | null>(null);
  const [revocando, setRevocando] = useState<Usuario | null>(null);
  const [restituyendo, setRestituyendo] = useState<Usuario | null>(null);

  const sinRevocar = panel.usuarios.filter((u) => u.estado !== 'REVOCADO').length;
  const max = panel.plan.maxUsuarios;
  const lleno = max !== null && sinRevocar >= max;
  const adminsActivos = panel.usuarios.filter((u) => u.estado === 'ACTIVO' && u.rolTipo === 'ADMIN');
  const esUnicoAdmin = (u: Usuario) => adminsActivos.length === 1 && adminsActivos[0]?.id === u.id;
  const hayPendientes = panel.usuarios.some((u) => u.estado === 'PENDIENTE');
  const rolAsistente = panel.roles.find((r) => r.tipo === 'ASISTENTE');

  const ayuda = personal
    ? 'Su plan Personal admite dos personas: usted y un asistente. Usted decide qué puede hacer el asistente.'
    : 'Invite a las personas de su empresa y asígneles un rol. Los permisos de cada rol se definen abajo.';

  return (
    <>
      <Seccion titulo="Usuarios" ayuda={ayuda}>
        {escribe ? (
          lleno ? (
            <p className="nota-pendiente">
              <Icono nombre="aviso" />
              <span>
                {personal
                  ? 'Ya tiene a su asistente. Para invitar a otra persona, revoque primero el acceso del actual.'
                  : `Su plan admite ${max} usuarios y ya los tiene. Revoque uno para invitar a otro.`}
              </span>
            </p>
          ) : (
            <div className="fila-de-botones fila-izquierda">
              <button type="button" className="boton boton-principal" onClick={() => setEditando('nuevo')}>
                <Icono nombre="invitar" />
                {personal ? 'Invitar asistente' : 'Invitar usuario'}
              </button>
            </div>
          )
        ) : null}

        {hayPendientes ? (
          <p className="nota-pendiente">
            <Icono nombre="reloj" />
            <span>
              Un usuario pendiente todavía no ha elegido su contraseña. El enlace de activación aún no sale por correo:
              pídaselo al equipo de ConstruSoft, que se lo envía a la persona. Vence a las 72 horas.
            </span>
          </p>
        ) : null}

        <TablaDeUsuarios
          usuarios={panel.usuarios}
          escribe={escribe}
          lleno={lleno}
          esUnicoAdmin={esUnicoAdmin}
          alEditar={setEditando}
          alRevocar={setRevocando}
          alRestituir={setRestituyendo}
        />
      </Seccion>

      {personal ? (
        rolAsistente ? <PermisosDelAsistente rol={rolAsistente} catalogo={panel.permisos} escribe={escribe} alGuardar={releer} /> : null
      ) : (
        <Roles panel={panel} escribe={escribe} releer={releer} />
      )}

      {editando ? (
        <FormularioDeUsuario
          usuario={editando === 'nuevo' ? null : editando}
          panel={panel}
          bloquearRol={editando !== 'nuevo' && esUnicoAdmin(editando)}
          alCerrar={() => setEditando(null)}
          alGuardar={(u, nuevo) => {
            setEditando(null);
            avisar(nuevo ? `Invitación creada para ${u.nombre}. Queda pendiente hasta que active su cuenta.` : `Cambios de ${u.nombre} guardados.`);
            releer();
          }}
        />
      ) : null}

      {revocando ? (
        <Confirmacion
          titulo={`Revocar el acceso de ${revocando.nombre}`}
          textoConfirmar="Revocar acceso"
          textoEnviando="Revocando…"
          peligroso
          alCerrar={() => setRevocando(null)}
          alConfirmar={async () => {
            await pedir<Usuario>(`/api/usuarios/${encodeURIComponent(revocando.id)}/revocar`, { metodo: 'POST' });
            avisar(`${revocando.nombre} ya no tiene acceso.`);
            setRevocando(null);
            releer();
          }}
        >
          <p>
            {revocando.nombre} ({revocando.email}) no podrá volver a ingresar. Si tiene una sesión abierta, se cierra en su siguiente acción.
          </p>
          <p>Lo que hizo se conserva en el historial con su nombre. Puede devolverle el acceso más adelante.</p>
        </Confirmacion>
      ) : null}

      {restituyendo ? (
        <Confirmacion
          titulo={`Devolver el acceso a ${restituyendo.nombre}`}
          textoConfirmar="Devolver acceso"
          textoEnviando="Un momento…"
          alCerrar={() => setRestituyendo(null)}
          alConfirmar={async () => {
            const u = await pedir<Usuario>(`/api/usuarios/${encodeURIComponent(restituyendo.id)}/restituir`, { metodo: 'POST' });
            avisar(u.estado === 'ACTIVO' ? `${u.nombre} puede ingresar de nuevo.` : `${u.nombre} quedó pendiente de activar su cuenta.`);
            setRestituyendo(null);
            releer();
          }}
        >
          <p>
            {restituyendo.nombre} vuelve con el rol «{restituyendo.rolNombre}».{' '}
            {restituyendo.ultimoAcceso
              ? 'Ingresa con la misma contraseña que tenía.'
              : 'Nunca activó su cuenta, así que queda pendiente hasta que lo haga.'}
          </p>
        </Confirmacion>
      ) : null}
    </>
  );
}

// --- La tabla ---------------------------------------------------------------------

function TablaDeUsuarios({
  usuarios,
  escribe,
  lleno,
  esUnicoAdmin,
  alEditar,
  alRevocar,
  alRestituir,
}: {
  usuarios: Usuario[];
  escribe: boolean;
  lleno: boolean;
  esUnicoAdmin: (u: Usuario) => boolean;
  alEditar: (u: Usuario) => void;
  alRevocar: (u: Usuario) => void;
  alRestituir: (u: Usuario) => void;
}) {
  return (
    <div className="tarjeta-tabla tabla-con-borde">
      <table className="tabla tabla-usuarios">
        <caption className="solo-lectores">Usuarios de la empresa</caption>
        <thead>
          <tr>
            <th scope="col">Nombre</th>
            <th scope="col">Rol</th>
            <th scope="col">Estado</th>
            <th scope="col">Último ingreso</th>
            {escribe ? <th scope="col" className="col-acciones"><span className="solo-lectores">Acciones</span></th> : null}
          </tr>
        </thead>
        <tbody>
          {usuarios.map((u) => (
            <tr key={u.id} data-estado={u.estado}>
              <td>
                <span className="nombre-de-usuario">
                  {u.nombre}
                  {u.esUsted ? <span className="marca-usted">usted</span> : null}
                </span>
                <span className="correo-de-usuario">{u.email}</span>
              </td>
              <td>{u.rolNombre}</td>
              <td>
                <span className="insignia insignia-usuario" data-estado={u.estado}>{NOMBRES_DE_ESTADO[u.estado]}</span>
              </td>
              <td className="col-ingreso">{textoDeIngreso(u)}</td>
              {escribe ? (
                <td className="col-acciones">
                  <AccionesDeUsuario
                    usuario={u}
                    lleno={lleno}
                    unicoAdmin={esUnicoAdmin(u)}
                    alEditar={alEditar}
                    alRevocar={alRevocar}
                    alRestituir={alRestituir}
                  />
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function textoDeIngreso(u: Usuario): string {
  if (u.estado === 'PENDIENTE') {
    return u.activacionVenceEn ? `Enlace vigente hasta el ${formatearFechaYHora(u.activacionVenceEn)}` : 'Sin enlace vigente';
  }
  return u.ultimoAcceso ? formatearFecha(u.ultimoAcceso) : 'Nunca';
}

function AccionesDeUsuario({
  usuario: u,
  lleno,
  unicoAdmin,
  alEditar,
  alRevocar,
  alRestituir,
}: {
  usuario: Usuario;
  lleno: boolean;
  unicoAdmin: boolean;
  alEditar: (u: Usuario) => void;
  alRevocar: (u: Usuario) => void;
  alRestituir: (u: Usuario) => void;
}) {
  if (u.estado === 'REVOCADO') {
    // Devolver el acceso cuenta para el límite del plan: si está lleno, no se ofrece.
    if (lleno) return null;
    return (
      <div className="acciones-de-fila">
        <button type="button" className="boton-icono boton-chico" aria-label={`Devolver el acceso a ${u.nombre}`} title="Devolver acceso" onClick={() => alRestituir(u)}>
          <Icono nombre="restituir" tamano={18} />
        </button>
      </div>
    );
  }
  // Ni a sí mismo ni al último administrador: la base lo rechazaría (D-29), y
  // sacarse a uno mismo de la empresa no es un gesto que se haga por error.
  const puedeRevocar = !u.esUsted && !unicoAdmin;
  return (
    <div className="acciones-de-fila">
      <button type="button" className="boton-icono boton-chico" aria-label={`Editar a ${u.nombre}`} title="Editar" onClick={() => alEditar(u)}>
        <Icono nombre="editar" tamano={18} />
      </button>
      {puedeRevocar ? (
        <button type="button" className="boton-icono boton-chico boton-icono-peligro" aria-label={`Revocar el acceso de ${u.nombre}`} title="Revocar acceso" onClick={() => alRevocar(u)}>
          <Icono nombre="revocar" tamano={18} />
        </button>
      ) : null}
    </div>
  );
}

// --- Invitar y editar -----------------------------------------------------------

function FormularioDeUsuario({
  usuario,
  panel,
  bloquearRol,
  alCerrar,
  alGuardar,
}: {
  usuario: Usuario | null;
  panel: PanelDeUsuarios;
  bloquearRol: boolean;
  alCerrar: () => void;
  alGuardar: (u: Usuario, nuevo: boolean) => void;
}) {
  const personal = panel.plan.codigo === 'PERSONAL';
  // En el plan Personal se invita solo al asistente: el rol no se elige.
  const rolPorDefecto = personal
    ? panel.roles.find((r) => r.tipo === 'ASISTENTE')?.id ?? ''
    : panel.roles.find((r) => r.tipo === 'PERSONALIZADO')?.id ?? panel.roles.find((r) => r.tipo === 'ASISTENTE')?.id ?? '';
  const inicial = { nombre: usuario?.nombre ?? '', email: usuario?.email ?? '', rolId: usuario?.rolId ?? rolPorDefecto };
  const [datos, setDatos] = useState(inicial);
  const [errores, setErrores] = useState<{ nombre?: string; email?: string; rolId?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // El correo es la identidad de ingreso: se corrige mientras la invitación
  // está pendiente, y después ya no (CONTRATO §11.2).
  const correoEditable = usuario === null || usuario.estado === 'PENDIENTE';
  const rolFijo = personal || bloquearRol;
  const rolActual = panel.roles.find((r) => r.id === datos.rolId);

  async function enviar() {
    if (enviando) return;
    const faltan: typeof errores = {};
    if (datos.nombre.trim() === '') faltan.nombre = 'Escriba el nombre de la persona.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.email.trim())) faltan.email = 'Escriba un correo válido, como nombre@empresa.com.';
    if (datos.rolId === '') faltan.rolId = 'Elija un rol.';
    setErrores(faltan);
    if (faltan.nombre || faltan.email || faltan.rolId) return;
    setEnviando(true);
    setError(null);
    try {
      const cuerpo = { nombre: datos.nombre.trim(), email: datos.email.trim(), rolId: datos.rolId };
      const u = usuario
        ? await pedir<Usuario>(`/api/usuarios/${encodeURIComponent(usuario.id)}`, { metodo: 'PUT', cuerpo })
        : await pedir<Usuario>('/api/usuarios', { metodo: 'POST', cuerpo });
      alGuardar(u, usuario === null);
    } catch (e) {
      setEnviando(false);
      if (e instanceof ErrorDeApi && (e.campo === 'nombre' || e.campo === 'email' || e.campo === 'rolId')) setErrores({ [e.campo]: e.message });
      else setError(e instanceof ErrorDeApi ? e.message : 'No se guardó. Intente de nuevo.');
    }
  }

  const hayCambios = datos.nombre !== inicial.nombre || datos.email !== inicial.email || datos.rolId !== inicial.rolId;
  const titulo = usuario ? `Editar a ${usuario.nombre}` : personal ? 'Invitar a su asistente' : 'Invitar usuario';

  return (
    <Capa
      titulo={titulo}
      alCerrar={alCerrar}
      hayCambios={hayCambios}
      error={error}
      alEnviar={() => void enviar()}
      acciones={(cerrar) => (
        <>
          <button type="button" className="boton boton-secundario" onClick={cerrar} disabled={enviando}>Cancelar</button>
          <button type="submit" className="boton boton-principal" disabled={enviando}>
            {enviando ? 'Guardando…' : usuario ? 'Guardar cambios' : 'Invitar'}
          </button>
        </>
      )}
    >
      <Campo etiqueta="Nombre" error={errores.nombre}>
        {(a) => <input {...a} autoComplete="off" value={datos.nombre} onChange={(e) => setDatos({ ...datos, nombre: e.target.value })} />}
      </Campo>
      <Campo
        etiqueta="Correo de ingreso"
        ayuda={correoEditable ? 'Con este correo va a ingresar. Cada correo pertenece a una sola empresa.' : 'Ya activó su cuenta con este correo, y no se cambia.'}
        error={errores.email}
      >
        {(a) => (
          <input
            {...a}
            type="email"
            autoComplete="off"
            spellCheck={false}
            value={datos.email}
            readOnly={!correoEditable}
            onChange={(e) => setDatos({ ...datos, email: e.target.value })}
          />
        )}
      </Campo>
      {rolFijo ? (
        <div className="campo">
          <span className="etiqueta-suelta">Rol</span>
          <p className="valor-suelto">{rolActual?.nombre ?? '—'}</p>
          <p className="campo-ayuda">
            {bloquearRol
              ? 'Es el único administrador activo de la empresa: no puede cambiar de rol hasta que haya otro.'
              : 'En el plan Personal, la segunda persona es siempre el asistente. Sus permisos se marcan en esta misma pestaña.'}
          </p>
        </div>
      ) : (
        <Campo etiqueta="Rol" ayuda="El rol decide qué puede ver y hacer. Administrador tiene todos los permisos." error={errores.rolId}>
          {(a) => (
            <select {...a} value={datos.rolId} onChange={(e) => setDatos({ ...datos, rolId: e.target.value })}>
              {panel.roles.map((r) => (
                <option key={r.id} value={r.id}>{r.nombre}</option>
              ))}
            </select>
          )}
        </Campo>
      )}
      {usuario === null ? (
        <p className="nota-pendiente">
          <Icono nombre="candado" />
          <span>
            Usted no elige su contraseña: la elige la persona al abrir su enlace de activación. Mientras llega el envío por
            correo, el enlace lo entrega el equipo de ConstruSoft.
          </span>
        </p>
      ) : null}
    </Capa>
  );
}

// --- Permisos ---------------------------------------------------------------------

const NOMBRES_DE_MODULO: Record<string, string> = {
  RECURSOS: 'Recursos',
  APU: 'APU',
  PRESUPUESTOS: 'Proyectos',
  CONFIG: 'Configuración',
  USUARIOS: 'Usuarios',
};

/*
 * Las palabras de cada casilla. El catálogo de la base todavía dice
 * «presupuestos»; la pantalla dice «proyectos» desde el 6 de octubre.
 */
const TEXTOS_DE_PERMISO: Partial<Record<Permiso, { accion: string; detalle: string }>> = {
  'RECURSOS.VER': { accion: 'Ver', detalle: 'Consultar el catálogo de recursos.' },
  'RECURSOS.CREAR': { accion: 'Crear', detalle: 'Crear recursos.' },
  'RECURSOS.EDITAR': { accion: 'Editar', detalle: 'Cambiar precios y datos de un recurso.' },
  'RECURSOS.ELIMINAR': { accion: 'Eliminar', detalle: 'Eliminar recursos que no se usan.' },
  'APU.VER': { accion: 'Ver', detalle: 'Consultar los APU.' },
  'APU.CREAR': { accion: 'Crear', detalle: 'Crear APU.' },
  'APU.EDITAR': { accion: 'Editar', detalle: 'Cambiar la composición de un APU.' },
  'APU.ELIMINAR': { accion: 'Eliminar', detalle: 'Eliminar APU que no se usan.' },
  'PRESUPUESTOS.VER': { accion: 'Ver', detalle: 'Consultar los proyectos.' },
  'PRESUPUESTOS.CREAR': { accion: 'Crear', detalle: 'Crear proyectos.' },
  'PRESUPUESTOS.EDITAR': { accion: 'Editar', detalle: 'Trabajar en la mesa, archivar y desarchivar.' },
  'PRESUPUESTOS.EXPORTAR': { accion: 'Exportar', detalle: 'Descargar en PDF y Excel.' },
  'PRESUPUESTOS.DUPLICAR': { accion: 'Duplicar', detalle: 'Copiar un proyecto en uno nuevo.' },
  'CONFIG.EMPRESA': { accion: 'Datos de empresa', detalle: 'Editar razón social, NIT y contacto.' },
  'CONFIG.PREFERENCIAS': { accion: 'Preferencias y unidades', detalle: 'Editar formatos de cifras y unidades de medida.' },
  'CONFIG.SUSCRIPCION': { accion: 'Ver suscripción', detalle: 'Consultar el plan y los pagos.' },
  'USUARIOS.GESTIONAR': { accion: 'Gestionar usuarios', detalle: 'Invitar personas y administrar roles.' },
};

const MODULOS_CON_VER = ['RECURSOS', 'APU', 'PRESUPUESTOS'];

/**
 * Qué exige cada permiso, con las mismas reglas que la base:
 *   - Ver es prerrequisito de las demás acciones de su módulo (RF-CFG-25);
 *   - editar proyectos exige ver APU (D-59);
 *   - crear o editar APU exige ver recursos (D-70).
 */
function requisitosDe(codigo: Permiso): Permiso[] {
  const [modulo = '', accion = ''] = codigo.split('.');
  const lista: Permiso[] = [];
  if (MODULOS_CON_VER.includes(modulo) && accion !== 'VER') lista.push(`${modulo}.VER` as Permiso);
  if (codigo === 'PRESUPUESTOS.EDITAR') lista.push('APU.VER');
  if (codigo === 'APU.CREAR' || codigo === 'APU.EDITAR') lista.push('RECURSOS.VER');
  return lista;
}

function conRequisitos(marcados: ReadonlySet<Permiso>, codigo: Permiso): Set<Permiso> {
  const nuevos = new Set(marcados);
  const pendientes = [codigo];
  while (pendientes.length > 0) {
    const c = pendientes.pop();
    if (c === undefined || nuevos.has(c)) continue;
    nuevos.add(c);
    pendientes.push(...requisitosDe(c));
  }
  return nuevos;
}

/** Quién, entre los marcados, exige este permiso. Vacío: se puede desmarcar. */
function quienesLoExigen(marcados: ReadonlySet<Permiso>, codigo: Permiso): Permiso[] {
  return [...marcados].filter((m) => requisitosDe(m).includes(codigo));
}

function nombreCompleto(codigo: Permiso): string {
  const [modulo = ''] = codigo.split('.');
  return `«${TEXTOS_DE_PERMISO[codigo]?.accion ?? codigo}» en ${NOMBRES_DE_MODULO[modulo] ?? modulo}`;
}

function MatrizDePermisos({
  catalogo,
  marcados,
  alCambiar,
  sinGestionarUsuarios,
  soloLectura,
}: {
  catalogo: PermisoDelCatalogo[];
  marcados: ReadonlySet<Permiso>;
  alCambiar: (nuevos: Set<Permiso>) => void;
  /** El rol Asistente no gestiona usuarios (fn_permiso_no_delegable). */
  sinGestionarUsuarios: boolean;
  soloLectura: boolean;
}) {
  const visibles = catalogo.filter((p) => !(sinGestionarUsuarios && p.codigo === 'USUARIOS.GESTIONAR'));
  const modulos = [...new Set(visibles.map((p) => p.modulo))];

  function alternar(codigo: Permiso, marcar: boolean) {
    if (marcar) {
      alCambiar(conRequisitos(marcados, codigo));
    } else {
      const nuevos = new Set(marcados);
      nuevos.delete(codigo);
      alCambiar(nuevos);
    }
  }

  return (
    <div className="matriz-de-permisos">
      {modulos.map((modulo) => (
        <fieldset key={modulo} className="modulo-de-permisos">
          <legend>{NOMBRES_DE_MODULO[modulo] ?? modulo}</legend>
          <div className="casillas-de-permisos">
            {visibles
              .filter((p) => p.modulo === modulo)
              .map((p) => {
                const marcado = marcados.has(p.codigo);
                const exigen = marcado ? quienesLoExigen(marcados, p.codigo) : [];
                const trabado = exigen.length > 0;
                const textos = TEXTOS_DE_PERMISO[p.codigo];
                const idMotivo = `motivo-${p.codigo.replace('.', '-')}`;
                return (
                  <label key={p.codigo} className="casilla-de-permiso" data-trabada={trabado ? 'si' : undefined}>
                    <input
                      type="checkbox"
                      checked={marcado}
                      disabled={soloLectura || trabado}
                      aria-describedby={trabado ? idMotivo : undefined}
                      onChange={(e) => alternar(p.codigo, e.target.checked)}
                    />
                    <span>
                      <span className="permiso-accion">{textos?.accion ?? p.accion}</span>
                      <span className="permiso-detalle">{textos?.detalle ?? p.descripcion}</span>
                      {trabado ? (
                        <span id={idMotivo} className="permiso-motivo">
                          Lo necesita {exigen.map(nombreCompleto).join(' y ')}.
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

function mismosPermisos(a: ReadonlySet<Permiso>, b: ReadonlySet<Permiso>): boolean {
  return a.size === b.size && [...a].every((p) => b.has(p));
}

/** Plan Personal: los permisos del rol Asistente, en la pestaña misma. */
function PermisosDelAsistente({ rol, catalogo, escribe, alGuardar }: { rol: Rol; catalogo: PermisoDelCatalogo[]; escribe: boolean; alGuardar: () => void }) {
  const original = useMemo(() => new Set(rol.permisos), [rol.permisos]);
  const [marcados, setMarcados] = useState<Set<Permiso>>(() => new Set(rol.permisos));
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const { avisar } = useAvisos();
  const iguales = mismosPermisos(marcados, original);

  async function guardar() {
    setEnviando(true);
    setError(null);
    try {
      await pedir<Rol>(`/api/roles/${encodeURIComponent(rol.id)}`, { metodo: 'PUT', cuerpo: { nombre: rol.nombre, permisos: [...marcados] } });
      avisar('Permisos del asistente guardados. Valen desde su siguiente acción.');
      alGuardar();
    } catch (e) {
      setError(e instanceof ErrorDeApi ? e.message : 'No se guardaron los permisos. Intente de nuevo.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Seccion
      titulo="Permisos del asistente"
      ayuda="Marque lo que su asistente puede hacer. Activar, cerrar, reabrir y eliminar proyectos es solo suyo, y no se delega."
    >
      {error ? (
        <p className="aviso-error" role="alert"><Icono nombre="aviso" /><span>{error}</span></p>
      ) : null}
      <MatrizDePermisos catalogo={catalogo} marcados={marcados} alCambiar={setMarcados} sinGestionarUsuarios soloLectura={!escribe} />
      {escribe ? (
        <div className="fila-de-botones fila-izquierda">
          <button type="button" className="boton boton-principal" disabled={enviando || iguales} onClick={() => void guardar()}>
            {enviando ? 'Guardando…' : 'Guardar permisos'}
          </button>
          {iguales ? null : (
            <button type="button" className="boton boton-secundario" disabled={enviando} onClick={() => setMarcados(new Set(original))}>
              Deshacer cambios
            </button>
          )}
        </div>
      ) : null}
    </Seccion>
  );
}

// --- Roles (plan Empresarial) -------------------------------------------------------

function Roles({ panel, escribe, releer }: { panel: PanelDeUsuarios; escribe: boolean; releer: () => void }) {
  const { avisar } = useAvisos();
  const [editando, setEditando] = useState<Rol | 'nuevo' | null>(null);
  const [borrando, setBorrando] = useState<Rol | null>(null);
  const totalDelegables = panel.permisos.length;

  return (
    <Seccion
      titulo="Roles"
      ayuda="Un rol es un conjunto de permisos. Administrador y Asistente vienen con la empresa; los demás los crea usted."
    >
      {escribe && panel.plan.rolesPersonalizados ? (
        <div className="fila-de-botones fila-izquierda">
          <button type="button" className="boton boton-secundario" onClick={() => setEditando('nuevo')}>
            <Icono nombre="mas" />
            Crear rol
          </button>
        </div>
      ) : null}
      <div className="tarjeta-tabla tabla-con-borde">
        <table className="tabla tabla-roles">
          <caption className="solo-lectores">Roles de la empresa</caption>
          <thead>
            <tr>
              <th scope="col">Rol</th>
              <th scope="col">Tipo</th>
              <th scope="col">Permisos</th>
              <th scope="col" className="col-numero">Usuarios</th>
              {escribe ? <th scope="col" className="col-acciones"><span className="solo-lectores">Acciones</span></th> : null}
            </tr>
          </thead>
          <tbody>
            {panel.roles.map((r) => (
              <tr key={r.id}>
                <td className="nombre-de-rol">{r.nombre}</td>
                <td>{NOMBRES_DE_TIPO[r.tipo]}</td>
                <td>{r.tipo === 'ADMIN' ? 'Todos' : `${r.permisos.filter((p) => p !== 'PRESUPUESTOS.ESTADO').length} de ${totalDelegables}`}</td>
                <td className="col-numero">{r.usuarios}</td>
                {escribe ? (
                  <td className="col-acciones">
                    {r.tipo === 'ADMIN' ? null : (
                      <div className="acciones-de-fila">
                        <button type="button" className="boton-icono boton-chico" aria-label={`Editar el rol ${r.nombre}`} title="Editar" onClick={() => setEditando(r)}>
                          <Icono nombre="editar" tamano={18} />
                        </button>
                        {r.tipo === 'PERSONALIZADO' ? (
                          <button type="button" className="boton-icono boton-chico boton-icono-peligro" aria-label={`Eliminar el rol ${r.nombre}`} title="Eliminar" onClick={() => setBorrando(r)}>
                            <Icono nombre="basura" tamano={18} />
                          </button>
                        ) : null}
                      </div>
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editando ? (
        <FormularioDeRol
          rol={editando === 'nuevo' ? null : editando}
          catalogo={panel.permisos}
          alCerrar={() => setEditando(null)}
          alGuardar={(r, nuevo) => {
            setEditando(null);
            avisar(nuevo ? `Rol «${r.nombre}» creado.` : `Rol «${r.nombre}» guardado. Los cambios valen desde la siguiente acción de sus usuarios.`);
            releer();
          }}
        />
      ) : null}

      {borrando ? (
        <Confirmacion
          titulo={`Eliminar el rol «${borrando.nombre}»`}
          textoConfirmar="Eliminar rol"
          textoEnviando="Eliminando…"
          peligroso
          alCerrar={() => setBorrando(null)}
          alConfirmar={async () => {
            await pedir<void>(`/api/roles/${encodeURIComponent(borrando.id)}`, { metodo: 'DELETE' });
            avisar(`Rol «${borrando.nombre}» eliminado.`);
            setBorrando(null);
            releer();
          }}
        >
          {borrando.usuarios > 0 ? (
            <p>
              {borrando.usuarios === 1 ? 'Un usuario tiene' : `${borrando.usuarios} usuarios tienen`} este rol, contando a los
              revocados. Cámbielos de rol antes de eliminarlo; si no, el sistema no lo permitirá.
            </p>
          ) : (
            <p>Nadie tiene este rol. Se eliminará con sus permisos.</p>
          )}
        </Confirmacion>
      ) : null}
    </Seccion>
  );
}

function FormularioDeRol({
  rol,
  catalogo,
  alCerrar,
  alGuardar,
}: {
  rol: Rol | null;
  catalogo: PermisoDelCatalogo[];
  alCerrar: () => void;
  alGuardar: (r: Rol, nuevo: boolean) => void;
}) {
  const original = useMemo(() => new Set(rol?.permisos ?? []), [rol]);
  const [nombre, setNombre] = useState(rol?.nombre ?? '');
  const [marcados, setMarcados] = useState<Set<Permiso>>(() => new Set(rol?.permisos ?? []));
  const [errorDeNombre, setErrorDeNombre] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  // Los roles del sistema se editan en sus permisos, no en su nombre.
  const deSistema = rol !== null && rol.tipo !== 'PERSONALIZADO';

  async function enviar() {
    if (enviando) return;
    if (nombre.trim() === '') {
      setErrorDeNombre('Escriba el nombre del rol, por ejemplo «Residente de obra».');
      return;
    }
    setErrorDeNombre(null);
    setEnviando(true);
    setError(null);
    try {
      const cuerpo = { nombre: nombre.trim(), permisos: [...marcados] };
      const r = rol
        ? await pedir<Rol>(`/api/roles/${encodeURIComponent(rol.id)}`, { metodo: 'PUT', cuerpo })
        : await pedir<Rol>('/api/roles', { metodo: 'POST', cuerpo });
      alGuardar(r, rol === null);
    } catch (e) {
      setEnviando(false);
      if (e instanceof ErrorDeApi && e.campo === 'nombre') setErrorDeNombre(e.message);
      else setError(e instanceof ErrorDeApi ? e.message : 'No se guardó el rol. Intente de nuevo.');
    }
  }

  const hayCambios = nombre !== (rol?.nombre ?? '') || !mismosPermisos(marcados, original);

  return (
    <Capa
      titulo={rol ? `Editar el rol «${rol.nombre}»` : 'Crear rol'}
      alCerrar={alCerrar}
      hayCambios={hayCambios}
      error={error}
      alEnviar={() => void enviar()}
      acciones={(cerrar) => (
        <>
          <button type="button" className="boton boton-secundario" onClick={cerrar} disabled={enviando}>Cancelar</button>
          <button type="submit" className="boton boton-principal" disabled={enviando}>
            {enviando ? 'Guardando…' : rol ? 'Guardar rol' : 'Crear rol'}
          </button>
        </>
      )}
    >
      {deSistema ? (
        <div className="campo">
          <span className="etiqueta-suelta">Nombre</span>
          <p className="valor-suelto">{rol.nombre}</p>
          <p className="campo-ayuda">Es un rol del sistema: sus permisos se cambian, su nombre no.</p>
        </div>
      ) : (
        <Campo etiqueta="Nombre del rol" error={errorDeNombre}>
          {(a) => <input {...a} autoComplete="off" value={nombre} onChange={(e) => setNombre(e.target.value)} />}
        </Campo>
      )}
      <p className="campo-ayuda">
        Marcar una acción marca también lo que necesita para funcionar: «Ver» de su módulo, «Ver» en APU para editar proyectos y
        «Ver» en Recursos para crear o editar APU.
      </p>
      <MatrizDePermisos
        catalogo={catalogo}
        marcados={marcados}
        alCambiar={setMarcados}
        sinGestionarUsuarios={rol?.tipo === 'ASISTENTE'}
        soloLectura={false}
      />
    </Capa>
  );
}
