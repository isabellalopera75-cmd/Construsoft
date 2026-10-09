import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import ExcelJS from 'exceljs';
import type { FastifyInstance } from 'fastify';
import { activarPresupuesto } from '../infraestructura/basedatos/cicloDeVida.js';
import { armarPresupuestoDeReferencia } from '../pruebas/presupuestoDeReferencia.js';
import { pngDeUnPixel } from '../pruebas/imagenes.js';
import { imagenesDePdf } from '../pruebas/textoDePdf.js';
import { VERSION_TERMINOS_DE_PRUEBA, CARPETA_LEGAL_DE_PRUEBA, clienteDePrueba, type Cuenta } from '../pruebas/clienteHttp.js';
import { construirServidor } from './servidor.js';

let app: FastifyInstance;
const { otraIp, pedir, registrar, asistenteCon } = clienteDePrueba(() => app);

before(async () => {
  app = await construirServidor({ carpetaLegal: CARPETA_LEGAL_DE_PRUEBA, secretoSesion: randomBytes(32).toString('hex'), versionTerminos: VERSION_TERMINOS_DE_PRUEBA });
});
after(async () => {
  await app.close();
});

async function subirLogo(cookie: string, archivo: Buffer, tipo = 'image/png') {
  const r = await app.inject({ method: 'PUT', url: '/api/configuracion/empresa/logo', remoteAddress: otraIp(), headers: { cookie, 'content-type': tipo }, payload: archivo });
  return { estado: r.statusCode, cuerpo: r.json<{ logoId?: string | null; mensaje?: string }>(), crudo: r.body };
}

describe('el logotipo de la empresa (CONTRATO §13)', () => {
  let duena: Cuenta;

  before(async () => {
    duena = await registrar('Constructora Logo', '900000410-0', 'logo.admin@construsoft.test');
  });

  test('subir una imagen PNG la deja vigente; la misma imagen otra vez es el mismo logo', async () => {
    const antes = await pedir('/api/configuracion/empresa', duena.cookie);
    assert.equal(antes.json<{ logoId: string | null }>().logoId, null);
    const png = pngDeUnPixel(200, 30, 30);
    const r = await subirLogo(duena.cookie, png);
    assert.equal(r.estado, 200, r.crudo);
    assert.match(String(r.cuerpo.logoId), /^[0-9a-f-]{36}$/);
    assert.equal((await subirLogo(duena.cookie, png)).cuerpo.logoId, r.cuerpo.logoId);

    const imagen = await pedir(`/api/logos/${r.cuerpo.logoId}`, duena.cookie);
    assert.equal(imagen.statusCode, 200);
    assert.deepEqual(imagen.rawPayload, png);
    assert.equal(imagen.headers['content-type'], 'image/png');
    assert.equal(imagen.headers['x-content-type-options'], 'nosniff');
    assert.equal(imagen.headers['content-disposition'], 'inline');
    assert.match(String(imagen.headers['cache-control']), /immutable/);
  });

  test('se mira la firma del archivo, no lo que dice el navegador: un PDF con content-type de imagen es 422; más de 1 MB es 413', async () => {
    const pdf = await subirLogo(duena.cookie, Buffer.from('%PDF-1.4 no es una imagen'), 'image/png');
    assert.equal(pdf.estado, 422);
    assert.match(pdf.cuerpo.mensaje!, /PNG o JPEG/);
    const grande = await subirLogo(duena.cookie, Buffer.concat([pngDeUnPixel(1, 1, 1), Buffer.alloc(1024 * 1024)]));
    assert.equal(grande.estado, 413);
    assert.match(grande.cuerpo.mensaje!, /1 MB/);
  });

  test('quitar deja la empresa sin logo, pero la imagen sigue: una versión puede estar nombrándola (D-64)', async () => {
    const { cuerpo } = await subirLogo(duena.cookie, pngDeUnPixel(0, 90, 0));
    const r = await app.inject({ method: 'DELETE', url: '/api/configuracion/empresa/logo', remoteAddress: otraIp(), headers: { cookie: duena.cookie } });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json<{ logoId: string | null }>().logoId, null);
    assert.equal((await pedir(`/api/logos/${cuerpo.logoId}`, duena.cookie)).statusCode, 200);
  });

  test('cualquier usuario de la empresa ve el logo; solo con CONFIG.EMPRESA se cambia', async () => {
    const { cuerpo } = await subirLogo(duena.cookie, pngDeUnPixel(0, 0, 120));
    const lector = await asistenteCon(duena, 'logo.lector@construsoft.test', ['PRESUPUESTOS.VER']);
    assert.equal((await pedir(`/api/logos/${cuerpo.logoId}`, lector)).statusCode, 200);
    const r = await subirLogo(lector, pngDeUnPixel(1, 2, 3));
    assert.equal(r.estado, 403);
    assert.match(r.cuerpo.mensaje!, /CONFIG\.EMPRESA/);
    assert.equal((await pedir(`/api/logos/${cuerpo.logoId}`)).statusCode, 401);
  });

  test('el PDF y el Excel llevan el logo; una versión lleva el que tenía al congelarse, aunque luego se quite', async () => {
    const otra = await registrar('Constructora Logo PDF', '900000411-1', 'logo.pdf@construsoft.test');
    const p = await armarPresupuestoDeReferencia(otra.contexto, 'LOGO-PDF');
    const exportar = async (url: string) => (await pedir(url, otra.cookie)).rawPayload;
    const imagenesDeExcel = async (archivo: Buffer) => {
      const libro = new ExcelJS.Workbook();
      await libro.xlsx.load(archivo as never);
      return libro.worksheets[0]!.getImages().length;
    };

    assert.equal(imagenesDePdf(await exportar(`/api/presupuestos/${p.presupuestoId}/exportar?formato=pdf`)), 0);
    await subirLogo(otra.cookie, pngDeUnPixel(250, 120, 0));
    assert.equal(imagenesDePdf(await exportar(`/api/presupuestos/${p.presupuestoId}/exportar?formato=pdf`)), 1);
    assert.equal(await imagenesDeExcel(await exportar(`/api/presupuestos/${p.presupuestoId}/exportar?formato=xlsx`)), 1);

    await activarPresupuesto(otra.contexto, p.presupuestoId);
    const [version] = (await pedir(`/api/presupuestos/${p.presupuestoId}/versiones`, otra.cookie)).json<{ versiones: { id: string }[] }>().versiones;
    await app.inject({ method: 'DELETE', url: '/api/configuracion/empresa/logo', remoteAddress: otraIp(), headers: { cookie: otra.cookie } });
    assert.equal(imagenesDePdf(await exportar(`/api/presupuestos/${p.presupuestoId}/exportar?formato=pdf`)), 0, 'el vivo ya no tiene logo');
    assert.equal(imagenesDePdf(await exportar(`/api/versiones/${version!.id}/exportar?formato=pdf`)), 1, 'la versión conserva el suyo');
  });
});

describe('aislamiento: el logo de otra empresa no existe (RN-01)', () => {
  test('pedir el logo de B con la sesión de A da el mismo 404 que uno inexistente o uno que no es un id', async () => {
    const a = await registrar('Constructora Logo A', '900000412-2', 'logo.a@construsoft.test');
    const b = await registrar('Constructora Logo B', '900000413-3', 'logo.b@construsoft.test');
    const deB = (await subirLogo(b.cookie, pngDeUnPixel(9, 9, 9))).cuerpo.logoId!;
    const ajeno = await pedir(`/api/logos/${deB}`, a.cookie);
    assert.equal(ajeno.statusCode, 404);
    for (const id of ['01900000-0000-7000-8000-000000000000', 'no-es-un-id']) {
      const otro = await pedir(`/api/logos/${id}`, a.cookie);
      assert.deepEqual([otro.statusCode, otro.body], [ajeno.statusCode, ajeno.body]);
    }
  });
});
