import { useEffect, useState } from 'react';
import { ErrorDeApi, pedir } from '../../api/cliente.ts';
import { Icono } from '../../componentes/Icono.tsx';
import { formatearFecha } from '../../fechas.ts';
import { ErrorDeSeccion } from '../../modulos/configuracion/piezas.tsx';
import { fechaSola, InsigniasDeEmpresa, NOMBRE_DE_PLAN, textoDeDias } from '../comun.tsx';
import { enlaceA } from '../navegacion.ts';
import type { FilaDeEmpresa } from '../tipos.ts';

/*
 * RF-SAD-03 · Todas las empresas, con lo que hace falta para decidir sin
 * abrir la ficha: plan, estado, cuándo vence y cuánto la usan. Las cifras del
 * resumen traen el filtro puesto en la dirección (#/empresas?estado=VENCIDA).
 */

const ESTADOS = [
  { valor: '', nombre: 'Todos' },
  { valor: 'EN_PRUEBA', nombre: 'En prueba' },
  { valor: 'ACTIVA', nombre: 'Activa' },
  { valor: 'VENCIDA', nombre: 'Vencida' },
  { valor: 'CANCELADA', nombre: 'Cancelada' },
  { valor: 'SUSPENDIDA', nombre: 'Suspendida' },
  { valor: 'SIN_SUSCRIPCION', nombre: 'Sin suscripción' },
];

function filtroInicial(): string {
  const consulta = window.location.hash.split('?')[1] ?? '';
  const estado = new URLSearchParams(consulta).get('estado') ?? '';
  return ESTADOS.some((e) => e.valor === estado) ? estado : '';
}

export function Empresas() {
  const [texto, setTexto] = useState('');
  const [buscado, setBuscado] = useState('');
  const [estado, setEstado] = useState(filtroInicial);
  const [plan, setPlan] = useState('');
  const [filas, setFilas] = useState<FilaDeEmpresa[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vez, setVez] = useState(0);

  // Buscar mientras se escribe, sin una petición por tecla.
  useEffect(() => {
    const espera = window.setTimeout(() => setBuscado(texto.trim()), 250);
    return () => window.clearTimeout(espera);
  }, [texto]);

  useEffect(() => {
    let vigente = true;
    const q = new URLSearchParams();
    if (buscado) q.set('texto', buscado);
    if (estado) q.set('estado', estado);
    if (plan) q.set('plan', plan);
    pedir<{ empresas: FilaDeEmpresa[] }>(`/api/superadmin/empresas?${q.toString()}`)
      .then((r) => vigente && (setFilas(r.empresas), setError(null)))
      .catch((e: unknown) => vigente && setError(e instanceof ErrorDeApi ? e.message : 'No se pudo leer la lista de empresas.'));
    return () => {
      vigente = false;
    };
  }, [buscado, estado, plan, vez]);

  const hayFiltro = buscado !== '' || estado !== '' || plan !== '';

  return (
    <>
      <div className="encabezado-de-pantalla">
        <div>
          <h1>Empresas</h1>
          <p className="subtitulo-de-pantalla">Cada empresa con su plan, el estado de su suscripción y cuánto la usa.</p>
        </div>
      </div>

      <div className="barra-de-filtros" role="search">
        <div className="campo campo-buscar">
          <label htmlFor="buscar-empresa">Buscar por razón social o NIT</label>
          <div className="control-con-icono">
            <Icono nombre="buscar" />
            <input id="buscar-empresa" type="search" autoComplete="off" value={texto} onChange={(e) => setTexto(e.target.value)} />
          </div>
        </div>
        <div className="campo">
          <label htmlFor="filtro-estado">Estado</label>
          <select id="filtro-estado" value={estado} onChange={(e) => setEstado(e.target.value)}>
            {ESTADOS.map((e) => <option key={e.valor} value={e.valor}>{e.nombre}</option>)}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="filtro-plan">Plan</label>
          <select id="filtro-plan" value={plan} onChange={(e) => setPlan(e.target.value)}>
            <option value="">Todos los planes</option>
            <option value="PERSONAL">Personal</option>
            <option value="EMPRESARIAL">Empresarial</option>
          </select>
        </div>
      </div>

      {error ? <ErrorDeSeccion mensaje={error} alReintentar={() => setVez((n) => n + 1)} /> : null}
      {!filas && !error ? <p className="campo-ayuda">Cargando…</p> : null}
      {filas && filas.length === 0 ? (
        <div className="vacio">
          <p>{hayFiltro ? 'Ninguna empresa coincide con estos filtros.' : 'Todavía no se ha registrado ninguna empresa.'}</p>
        </div>
      ) : null}
      {filas && filas.length > 0 ? (
        <div className="tarjeta tarjeta-tabla">
          <table className="tabla tabla-empresas">
            <caption className="solo-lectores">Empresas registradas</caption>
            <thead>
              <tr>
                <th scope="col">Empresa</th>
                <th scope="col">Plan</th>
                <th scope="col">Estado</th>
                <th scope="col">Vence</th>
                <th scope="col" className="col-numero">Usuarios</th>
                <th scope="col" className="col-numero">Proyectos</th>
                <th scope="col" className="col-secundaria">Registrada</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id}>
                  <td>
                    <a className="enlace-de-empresa" href={enlaceA({ pantalla: 'empresa', id: f.id })}>{f.razonSocial}</a>
                    <span className="dato-de-apoyo">NIT {f.nit}</span>
                  </td>
                  <td>{f.planCodigo ? NOMBRE_DE_PLAN[f.planCodigo] : '—'}</td>
                  <td><InsigniasDeEmpresa estado={f.estado} suspendida={f.suspendida} /></td>
                  <td>
                    {f.venceEl ? fechaSola(f.venceEl) : '—'}
                    {f.venceEl ? <span className="dato-de-apoyo">{textoDeDias(f.diasRestantes)}</span> : null}
                  </td>
                  <td className="col-numero">{f.usuarios}</td>
                  <td className="col-numero">{f.proyectos}</td>
                  <td className="col-secundaria">{formatearFecha(f.registradaEn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
