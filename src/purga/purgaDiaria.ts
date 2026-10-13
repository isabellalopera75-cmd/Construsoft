import type { EmpresaPurgada } from '../infraestructura/basedatos/plataforma.js';

/*
 * La purga diaria (D-74, CONTRATO §15.5). Qué empresa cumplió su plazo lo
 * decide plataforma.fn_purgar_empresas; aquí solo se decide CUÁNDO llamarla:
 * una vez al día, a las 00:05 de Bogotá, dentro del proceso de la API.
 *
 * Como todo sale de fechas, un día que no corra no rompe nada: la empresa que
 * hoy quedó pendiente la toma la corrida de mañana. Por eso no hay reintentos
 * ni una corrida al arrancar: un fallo se avisa y se espera al día siguiente.
 * Y si corrieran dos procesos a la vez, la segunda corrida no encuentra nada:
 * fn_eliminar_tenant vuelve a comprobar la fecha y la empresa ya no está.
 */

const MINUTO = 60 * 1000;
const DIA = 24 * 60 * MINUTO;
/** Bogotá es UTC−5 todo el año: Colombia no tiene horario de verano. */
const DESFASE_DE_BOGOTA = 5 * 60 * MINUTO;
/** Unos minutos después de la medianoche, para que current_date ya sea el día nuevo. */
const HORA_DE_LA_PURGA = 5 * MINUTO;

/** Cuánto falta para las próximas 00:05 de Bogotá. Exactamente a esa hora, la próxima es mañana. */
export function msHastaLaProximaPurga(ahora: Date): number {
  const relojDeBogota = ahora.getTime() - DESFASE_DE_BOGOTA;
  let objetivo = Math.floor(relojDeBogota / DIA) * DIA + HORA_DE_LA_PURGA;
  if (objetivo <= relojDeBogota) objetivo += DIA;
  return objetivo - relojDeBogota;
}

export interface OpcionesDeLaPurga {
  purgar: () => Promise<EmpresaPurgada[]>;
  avisar: (texto: string) => void;
  ahora?: () => Date;
  /** Programa `hacer` dentro de `ms`; devuelve con qué cancelarlo. Las pruebas lo reemplazan. */
  esperar?: (ms: number, hacer: () => void) => () => void;
}

function esperarConTemporizador(ms: number, hacer: () => void): () => void {
  const temporizador = setTimeout(hacer, ms);
  // La purga no mantiene vivo el proceso: lo mantiene el servidor que escucha.
  temporizador.unref();
  return () => clearTimeout(temporizador);
}

/** Describe una corrida para el registro de la API, empresa por empresa. */
export function describirPurga(purgadas: EmpresaPurgada[]): string {
  if (purgadas.length === 0) return 'Purga diaria: ninguna empresa cumplió su plazo.';
  return [
    `Purga diaria: ${purgadas.length === 1 ? 'se eliminó 1 empresa' : `se eliminaron ${purgadas.length} empresas`}.`,
    ...purgadas.map((p) => `  · ${p.razonSocial} (${p.tenantId}): ${p.motivo}`),
  ].join('\n');
}

/** Programa la purga cada día a las 00:05 de Bogotá. Devuelve con qué detenerla. */
export function programarPurgaDiaria(opciones: OpcionesDeLaPurga): () => void {
  const { purgar, avisar, ahora = () => new Date(), esperar = esperarConTemporizador } = opciones;
  let cancelar = () => {};
  let detenida = false;

  const siguiente = () => {
    if (detenida) return;
    cancelar = esperar(msHastaLaProximaPurga(ahora()), () => {
      void purgar()
        .then((purgadas) => avisar(describirPurga(purgadas)))
        .catch((error: unknown) =>
          avisar(`Purga diaria: falló y no eliminó nada; se intenta de nuevo mañana. ${error instanceof Error ? error.message : String(error)}`),
        )
        .finally(siguiente);
    });
  };
  siguiente();

  return () => {
    detenida = true;
    cancelar();
  };
}
