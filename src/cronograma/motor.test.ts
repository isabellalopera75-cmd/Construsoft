import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { compilarCalendario, type DefinicionDeCalendario } from './calendarioCompilado.js';
import { calcularCronograma, ErrorDeCiclo, type ActividadDelMotor, type DependenciaDelMotor, type ResultadoDeActividad } from './motor.js';
import { deMinutos } from './tiempo.js';

/*
 * El CPM del cronograma (RF-PRG-05, D-87, D-89), calculado a mano. El
 * calendario de la obra es el de por defecto: lunes a viernes, 7:00–12:00 y
 * 13:00–16:00, 8 horas. El cronograma empieza el lunes 2 de noviembre de 2026.
 * Un jornal de 8 h son 480 minutos.
 */

const OCHO_HORAS = [{ inicio: '07:00', fin: '12:00' }, { inicio: '13:00', fin: '16:00' }];
const OBRA: DefinicionDeCalendario = { semana: [OCHO_HORAS, OCHO_HORAS, OCHO_HORAS, OCHO_HORAS, OCHO_HORAS, [], []], excepciones: [] };
const CORRIDO: DefinicionDeCalendario = { semana: Array.from({ length: 7 }, () => [{ inicio: '00:00', fin: '24:00' }]), excepciones: [] };
const HORIZONTE = { desde: '2026-01-01', hasta: '2031-12-31' };
const CALENDARIOS = { OBRA: compilarCalendario(OBRA, HORIZONTE), CORRIDO: compilarCalendario(CORRIDO, HORIZONTE) };
const H = 60;

function act(id: string, horas: number, extra: Partial<ActividadDelMotor> = {}): ActividadDelMotor {
  return { id, tipo: 'ITEM', enPresupuesto: true, usaCorrido: false, duracionMinutos: horas * H, restriccion: null, restriccionSecundaria: null, ...extra };
}
const hitoInicio = (id: string, extra: Partial<ActividadDelMotor> = {}) => act(id, 0, { tipo: 'HITO_INICIO', ...extra });
const hitoFin = (id: string, extra: Partial<ActividadDelMotor> = {}) => act(id, 0, { tipo: 'HITO_FIN', ...extra });
const dep = (predecesoraId: string, sucesoraId: string, tipo: DependenciaDelMotor['tipo'] = 'FC', desfaseHoras = 0): DependenciaDelMotor => ({
  predecesoraId,
  sucesoraId,
  tipo,
  desfaseMinutos: desfaseHoras * H,
});

function calcular(actividades: ActividadDelMotor[], dependencias: DependenciaDelMotor[] = []) {
  return calcularCronograma({ fechaInicio: '2026-11-02', calendarios: CALENDARIOS, actividades, dependencias });
}

/** Lo que se compara a mano: fechas como texto, holguras en horas. */
function vista(r: ResultadoDeActividad) {
  return {
    inicio: deMinutos(r.inicio),
    fin: deMinutos(r.fin),
    inicioTardio: r.inicioTardio === null ? null : deMinutos(r.inicioTardio),
    finTardio: r.finTardio === null ? null : deMinutos(r.finTardio),
    holguraTotal: r.holguraTotalMinutos === null ? null : r.holguraTotalMinutos / H,
    holguraLibre: r.holguraLibreMinutos === null ? null : r.holguraLibreMinutos / H,
    critica: r.critica,
  };
}
const fechas = (r: ResultadoDeActividad) => [deMinutos(r.inicio), deMinutos(r.fin)];

describe('el paso hacia adelante y hacia atrás, con los cuatro tipos de relación', () => {
  test('una cadena FC: cada una empieza en el siguiente instante laborable después de la anterior, y todas son críticas', () => {
    const r = calcular([act('A', 16), act('B', 8), hitoFin('C')], [dep('A', 'B'), dep('B', 'C')]);
    assert.deepEqual(vista(r.actividades.get('A')!), {
      inicio: '2026-11-02T07:00', fin: '2026-11-03T16:00', inicioTardio: '2026-11-02T07:00', finTardio: '2026-11-03T16:00',
      holguraTotal: 0, holguraLibre: 0, critica: true,
    });
    assert.deepEqual(fechas(r.actividades.get('B')!), ['2026-11-04T07:00', '2026-11-04T16:00']);
    assert.deepEqual(fechas(r.actividades.get('C')!), ['2026-11-04T16:00', '2026-11-04T16:00']);
    assert.deepEqual([deMinutos(r.proyecto.inicio), deMinutos(r.proyecto.fin)], ['2026-11-02T07:00', '2026-11-04T16:00']);
  });

  test('dos ramas que llegan a la misma sucesora: la corta tiene un día de holgura total y libre', () => {
    const r = calcular([act('A', 16), act('B', 8), act('C', 8)], [dep('A', 'C'), dep('B', 'C')]);
    assert.deepEqual(vista(r.actividades.get('B')!), {
      inicio: '2026-11-02T07:00', fin: '2026-11-02T16:00', inicioTardio: '2026-11-03T07:00', finTardio: '2026-11-03T16:00',
      holguraTotal: 8, holguraLibre: 8, critica: false,
    });
    assert.deepEqual(fechas(r.actividades.get('C')!), ['2026-11-04T07:00', '2026-11-04T16:00']);
  });

  test('CC con 8 h de desfase: la sucesora arranca un jornal después; la que no tiene sucesora tiene holgura hasta el fin del proyecto', () => {
    const r = calcular([act('A', 24), act('B', 8)], [dep('A', 'B', 'CC', 8)]);
    assert.deepEqual(fechas(r.actividades.get('B')!), ['2026-11-03T07:00', '2026-11-03T16:00']);
    // El proyecto termina con A, el miércoles a las 16:00: a B le sobra un jornal.
    assert.deepEqual([r.actividades.get('B')!.holguraTotalMinutos, r.actividades.get('B')!.holguraLibreMinutos], [8 * H, 8 * H]);
  });

  test('FF: la sucesora termina cuando termina la predecesora', () => {
    const r = calcular([act('A', 16), act('B', 8)], [dep('A', 'B', 'FF')]);
    assert.deepEqual(fechas(r.actividades.get('B')!), ['2026-11-03T07:00', '2026-11-03T16:00']);
  });

  test('CF: la sucesora termina cuando empieza la predecesora más el desfase', () => {
    // A empieza el miércoles a las 7:00; B tiene que terminar a las 11:00 de ese día.
    const r = calcular([act('A', 8, { restriccion: { tipo: 'INICIO_DESPUES', fecha: '2026-11-04' } }), act('B', 8)], [dep('A', 'B', 'CF', 4)]);
    assert.deepEqual(fechas(r.actividades.get('B')!), ['2026-11-03T11:00', '2026-11-04T11:00']);
  });

  test('un desfase negativo traslapa: FC −8 h arranca la sucesora el último jornal de la predecesora', () => {
    const r = calcular([act('A', 16), act('B', 8)], [dep('A', 'B', 'FC', -8)]);
    assert.deepEqual(fechas(r.actividades.get('B')!), ['2026-11-03T07:00', '2026-11-03T16:00']);
  });

  test('ninguna actividad empieza antes de la fecha de inicio, aunque un desfase negativo la empuje atrás (A8)', () => {
    const r = calcular([act('A', 8), act('B', 8)], [dep('A', 'B', 'FC', -40)]);
    assert.deepEqual(fechas(r.actividades.get('B')!), ['2026-11-02T07:00', '2026-11-02T16:00']);
  });
});

describe('el calendario de la sucesora y el corrido (RN-29, D-86)', () => {
  test('una espera en el corrido corre de noche y el fin de semana: 7 días son 168 h', () => {
    const r = calcular([act('A', 8), act('W', 168, { tipo: 'SIN_COSTO', usaCorrido: true }), act('B', 8)], [dep('A', 'W'), dep('W', 'B')]);
    assert.deepEqual(fechas(r.actividades.get('W')!), ['2026-11-02T16:00', '2026-11-09T16:00']);
    assert.deepEqual(fechas(r.actividades.get('B')!), ['2026-11-10T07:00', '2026-11-10T16:00']);
  });

  test('el desfase se cuenta en el calendario de la sucesora: 24 h hacia una espera corrida son un día, no tres', () => {
    const r = calcular([act('A', 8), act('W', 24, { tipo: 'SIN_COSTO', usaCorrido: true })], [dep('A', 'W', 'FC', 24)]);
    assert.deepEqual(fechas(r.actividades.get('W')!), ['2026-11-03T16:00', '2026-11-04T16:00']);
  });
});

describe('las restricciones de P6 (RN-30, D-87, A7)', () => {
  test('«inicio en o después de» toma el comienzo de la jornada; en un sábado, el lunes siguiente', () => {
    const r = calcular([
      act('A', 8, { restriccion: { tipo: 'INICIO_DESPUES', fecha: '2026-11-04' } }),
      act('B', 8, { restriccion: { tipo: 'INICIO_DESPUES', fecha: '2026-11-07' } }),
    ]);
    assert.deepEqual(fechas(r.actividades.get('A')!), ['2026-11-04T07:00', '2026-11-04T16:00']);
    assert.deepEqual(fechas(r.actividades.get('B')!), ['2026-11-09T07:00', '2026-11-09T16:00']);
  });

  test('«fin en o antes de» que la lógica no cumple da holgura negativa: es una alerta, y las dos son críticas', () => {
    const r = calcular([act('A', 16), hitoFin('H', { restriccion: { tipo: 'FIN_ANTES', fecha: '2026-11-02' } })], [dep('A', 'H')]);
    assert.deepEqual(vista(r.actividades.get('H')!), {
      inicio: '2026-11-03T16:00', fin: '2026-11-03T16:00', inicioTardio: '2026-11-02T16:00', finTardio: '2026-11-02T16:00',
      holguraTotal: -8, holguraLibre: 0, critica: true,
    });
    assert.deepEqual([r.actividades.get('A')!.holguraTotalMinutos, r.actividades.get('A')!.critica], [-8 * H, true]);
  });

  test('«fin en o después de» empuja el fin al cierre de esa jornada', () => {
    const r = calcular([act('A', 8, { restriccion: { tipo: 'FIN_DESPUES', fecha: '2026-11-05' } })]);
    assert.deepEqual(fechas(r.actividades.get('A')!), ['2026-11-05T07:00', '2026-11-05T16:00']);
  });

  test('«inicio el» fija la fecha mientras la lógica lo deje; si la lógica la empuja, sale holgura negativa', () => {
    const libre = calcular([act('A', 8, { restriccion: { tipo: 'INICIO_EL', fecha: '2026-11-04' } }), hitoFin('F', { restriccion: { tipo: 'FIN_DESPUES', fecha: '2026-11-13' } })]);
    assert.deepEqual(vista(libre.actividades.get('A')!), {
      inicio: '2026-11-04T07:00', fin: '2026-11-04T16:00', inicioTardio: '2026-11-04T07:00', finTardio: '2026-11-04T16:00',
      // Libre hasta el fin del proyecto, el viernes 13: jueves, viernes y cinco días más.
      holguraTotal: 0, holguraLibre: 56, critica: true,
    });
    const empujada = calcular([act('P', 40), act('A', 8, { restriccion: { tipo: 'INICIO_EL', fecha: '2026-11-04' } })], [dep('P', 'A')]);
    assert.deepEqual(fechas(empujada.actividades.get('A')!), ['2026-11-09T07:00', '2026-11-09T16:00']);
    assert.equal(empujada.actividades.get('A')!.holguraTotalMinutos, -24 * H);
  });

  test('«inicio obligatorio» pasa por encima de la lógica; su predecesora queda con holgura negativa', () => {
    const r = calcular([act('A', 16), act('B', 8, { restriccion: { tipo: 'INICIO_OBLIGATORIO', fecha: '2026-11-02' } })], [dep('A', 'B')]);
    assert.deepEqual(fechas(r.actividades.get('B')!), ['2026-11-02T07:00', '2026-11-02T16:00']);
    assert.deepEqual([r.actividades.get('A')!.holguraTotalMinutos, r.actividades.get('A')!.critica], [-16 * H, true]);
  });

  test('«fin obligatorio» fija el fin al cierre de esa jornada, aunque la lógica diga otra cosa', () => {
    const r = calcular([act('A', 40), act('B', 8, { restriccion: { tipo: 'FIN_OBLIGATORIO', fecha: '2026-11-03' } })], [dep('A', 'B')]);
    assert.deepEqual(fechas(r.actividades.get('B')!), ['2026-11-03T07:00', '2026-11-03T16:00']);
  });

  test('la secundaria se suma a la principal: «después de» el miércoles y «antes de» el martes no cabe y da holgura negativa', () => {
    const r = calcular([
      act('A', 8, {
        restriccion: { tipo: 'INICIO_DESPUES', fecha: '2026-11-04' },
        restriccionSecundaria: { tipo: 'FIN_ANTES', fecha: '2026-11-03' },
      }),
    ]);
    assert.deepEqual(fechas(r.actividades.get('A')!), ['2026-11-04T07:00', '2026-11-04T16:00']);
    assert.equal(r.actividades.get('A')!.holguraTotalMinutos, -8 * H);
  });

  test('«lo más tarde posible» corre sus fechas tempranas hasta consumir la holgura libre, y la total baja en lo mismo (P8)', () => {
    const r = calcular([act('A', 16), act('B', 8, { restriccion: { tipo: 'LO_MAS_TARDE', fecha: null } }), act('C', 8)], [dep('A', 'C'), dep('B', 'C')]);
    assert.deepEqual(vista(r.actividades.get('B')!), {
      inicio: '2026-11-03T07:00', fin: '2026-11-03T16:00', inicioTardio: '2026-11-03T07:00', finTardio: '2026-11-03T16:00',
      holguraTotal: 0, holguraLibre: 0, critica: true,
    });
  });
});

describe('los hitos (RN-28)', () => {
  test('sin predecesora, el de inicio cae en el primer instante laborable del cronograma', () => {
    const r = calcular([hitoInicio('I'), act('A', 8)], [dep('I', 'A')]);
    assert.deepEqual(fechas(r.actividades.get('I')!), ['2026-11-02T07:00', '2026-11-02T07:00']);
  });

  test('después de algo que termina el viernes, el de fin muestra el viernes al cierre y el de inicio el lunes a las 7:00', () => {
    const r = calcular([act('A', 40), hitoFin('F'), hitoInicio('I')], [dep('A', 'F'), dep('A', 'I')]);
    assert.deepEqual(fechas(r.actividades.get('F')!), ['2026-11-06T16:00', '2026-11-06T16:00']);
    assert.deepEqual(fechas(r.actividades.get('I')!), ['2026-11-09T07:00', '2026-11-09T07:00']);
  });
});

describe('las fechas tardías de un instante', () => {
  test('una actividad de duración cero sin relaciones: sus fechas tardías son las tempranas, no el cierre del viernes anterior', () => {
    const r = calcular([act('A', 0), hitoInicio('I')]);
    assert.deepEqual(vista(r.actividades.get('A')!), {
      inicio: '2026-11-02T07:00', fin: '2026-11-02T07:00', inicioTardio: '2026-11-02T07:00', finTardio: '2026-11-02T07:00',
      holguraTotal: 0, holguraLibre: 0, critica: true,
    });
    assert.equal(deMinutos(r.actividades.get('I')!.inicioTardio!), '2026-11-02T07:00');
  });

  test('un hito de inicio al final de la obra queda al comienzo de la jornada siguiente; uno de fin, al cierre', () => {
    const r = calcular([act('A', 40), hitoInicio('I'), hitoFin('F')], [dep('A', 'I'), dep('A', 'F')]);
    assert.deepEqual([deMinutos(r.actividades.get('I')!.inicioTardio!), deMinutos(r.actividades.get('F')!.finTardio!)], ['2026-11-09T07:00', '2026-11-06T16:00']);
  });
});

describe('la administración, el fin a mitad de jornada y los ciclos', () => {
  test('la administración va del primer inicio al último fin de las actividades del presupuesto, sin hitos, trámites ni las que ya no están (RN-37)', () => {
    const r = calcular([
      hitoInicio('I'),
      act('T', 40, { tipo: 'SIN_COSTO' }),
      act('A', 8, { restriccion: { tipo: 'INICIO_DESPUES', fecha: '2026-11-03' } }),
      act('B', 16),
      act('X', 80, { enPresupuesto: false }),
      act('ADM', 0, { tipo: 'ADMINISTRACION' }),
    ], [dep('I', 'T'), dep('T', 'A'), dep('A', 'B')]);
    assert.deepEqual(vista(r.actividades.get('ADM')!), {
      inicio: '2026-11-09T07:00', fin: '2026-11-11T16:00', inicioTardio: null, finTardio: null,
      holguraTotal: null, holguraLibre: null, critica: false,
    });
    assert.equal(r.actividades.get('ADM')!.duracionMinutos, 24 * H);
  });

  test('una barra que termina a las 12:00 termina a mitad de jornada; una que termina a las 16:00, no; un hito, nunca', () => {
    const r = calcular([act('A', 5), act('B', 8), hitoFin('F')], [dep('B', 'F')]);
    assert.deepEqual(
      ['A', 'B', 'F'].map((id) => r.actividades.get(id)!.finAMitadDeJornada),
      [true, false, false],
    );
  });

  test('un ciclo no calcula nada y dice qué actividades lo forman, y solo esas', () => {
    assert.throws(
      () => calcular([act('A', 8), act('B', 8), act('C', 8), act('D', 8)], [dep('D', 'A'), dep('A', 'B'), dep('B', 'C'), dep('C', 'A')]),
      (error: unknown) => error instanceof ErrorDeCiclo && [...error.actividades].sort().join() === 'A,B,C',
    );
  });
});
