import type { DocumentoExportable } from '../infraestructura/basedatos/exportacion.js';
import type { CapituloFotografia, FotografiaPresupuesto, ItemFotografia } from '../infraestructura/basedatos/versiones.js';

/**
 * Un presupuesto largo para probar la paginación: cinco capítulos con
 * ochenta actividades en total por defecto, algunas con descripciones
 * que ocupan dos líneas. Es una fotografía armada a mano, sin base: el
 * renderizador es puro y la paginación no depende de cómo se calcularon los
 * importes. Los importes son coherentes entre sí, pero no son el objeto de la
 * prueba.
 */
export function presupuestoLargo(totalActividades = 80): DocumentoExportable {
  const capitulos: CapituloFotografia[] = [];
  const items: ItemFotografia[] = [];
  const nombres = ['PRELIMINARES', 'CIMENTACIÓN', 'ESTRUCTURA', 'MAMPOSTERÍA', 'ACABADOS'];
  nombres.forEach((nombre, c) => {
    const n = c + 1;
    capitulos.push({
      id: `cap-${n}`,
      codigoWbs: `${n}.0`,
      padreCodigo: null,
      nivel: 1,
      nombre,
      clasificacion: n === 1 ? 'INDIRECTO' : 'DIRECTO',
      montoAcumulado: '136000.000000',
      incidenciaPct: null,
    });
    // Repartidas entre los cinco capítulos: los primeros se llevan el resto de la división.
    const enEste = Math.floor(totalActividades / 5) + (c < totalActividades % 5 ? 1 : 0);
    for (let a = 1; a <= enEste; a += 1) {
      const larga = a % 5 === 0;
      items.push({
        id: `item-${n}-${a}`,
        wbsNodoId: `cap-${n}`,
        codigoItem: `${n}.${a}`,
        codigoWbsPadre: `${n}.0`,
        codigoApu: `APU-${n}${a}`,
        descripcion: larga
          ? `Actividad ${n}.${a}: suministro, transporte e instalación con todos los elementos necesarios para su correcto funcionamiento`
          : `Actividad ${n}.${a}`,
        unidad: a % 2 === 0 ? 'm²' : 'm³',
        cantidad: `${a}.000000`,
        precioUnitario: '1000.000000',
        costoTotal: `${a * 1000}.000000`,
        apuVersionId: 'v',
      });
    }
  });

  const fotografia: FotografiaPresupuesto = {
    schema: 5,
    presupuesto: {
      codigo: 'PRE-LARGO',
      nombre: 'Edificio de prueba de paginación',
      ubicacion: 'Medellín, Antioquia',
      moneda: 'COP',
      estado: 'ABIERTO',
      tipoProyecto: 'CONSTRUCCION',
      modoEstructura: 'ITEMS',
      aiu: { a: '10.000000', i: '5.000000', u: '5.000000' },
      ivaUtilidadPct: '19.000000',
      totales: {
        costoDirecto: '544000.000000',
        costoIndirecto: '136000.000000',
        administracion: '54400.000000',
        imprevistos: '27200.000000',
        utilidad: '27200.000000',
        aiu: '108800.000000',
        iva: '5168.000000',
        valorTotal: '793968.000000',
      },
      fechaElaboracion: '2026-09-30T10:00:00-05:00',
    },
    empresa: { razonSocial: 'Constructora Paginación SAS', nit: '900999999-1', logoRuta: null },
    capitulos,
    items,
    generada: { porUsuarioId: null, porUsuarioNombre: null, en: '2026-09-30T10:00:00-05:00', disparador: 'MANUAL', motivo: null },
  };
  return { fotografia, formato: { separadorMiles: '.', separadorDecimal: ',', decimalesVista: 2 }, numeroVersion: null };
}
