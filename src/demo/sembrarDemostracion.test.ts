import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { autenticar } from '../infraestructura/basedatos/autenticacion.js';
import { leerMesa } from '../infraestructura/basedatos/mesa.js';
import { listarPresupuestos } from '../infraestructura/basedatos/presupuesto.js';
import { listarVersiones } from '../infraestructura/basedatos/versiones.js';
import { hashearContrasena, verificarContrasena } from '../http/contrasenas.js';
import { sembrarDemostracion } from './sembrarDemostracion.js';

describe('datos de demostración: una empresa lista para mostrarle a un cliente', () => {
  test('la empresa, el presupuesto de referencia activado con su versión 1 y uno por EDT abierto', async () => {
    const hash = await hashearContrasena('una-contrasena-de-prueba');
    const empresa = await sembrarDemostracion({ correo: 'demo@construsoft.test', hashContrasena: hash, versionTerminos: 'terminos-de-prueba' });

    const yo = (await autenticar('demo@construsoft.test'))!;
    assert.equal(yo.tenantId, empresa.tenantId);
    assert.ok(await verificarContrasena(yo.passwordHash, 'una-contrasena-de-prueba'));

    const presupuestos = await listarPresupuestos(empresa);
    const porCodigo = Object.fromEntries(presupuestos.map((p) => [p.codigo, p]));
    assert.deepEqual(Object.keys(porCodigo).sort(), ['DEMO-001', 'DEMO-002']);

    const referencia = porCodigo['DEMO-001']!;
    assert.deepEqual([referencia.estado, referencia.valorTotal], ['ACTIVO', '180590155.000000']);
    assert.deepEqual((await listarVersiones(empresa, referencia.id)).map((v) => v.numero), [1]);

    const edt = (await leerMesa(empresa, porCodigo['DEMO-002']!.id))!;
    assert.equal(edt.cabecera.estado, 'ABIERTO');
    assert.ok(edt.nodos.some((n) => n.nivel === 2), 'tiene subcapítulos');
    assert.ok(edt.actividades.length >= 4);
  });

  test('correrlo dos veces no duplica nada: la segunda se niega y dice por qué', async () => {
    const hash = await hashearContrasena('una-contrasena-de-prueba');
    await assert.rejects(
      sembrarDemostracion({ correo: 'otra.demo@construsoft.test', hashContrasena: hash, versionTerminos: 'terminos-de-prueba' }),
      /ya existe/,
    );
  });
});
