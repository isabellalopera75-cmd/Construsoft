/*
 * Vive aparte de contextoTenant.ts porque ese módulo vigila sus exports: solo
 * expone puertas con permiso. Esto es texto SQL, no una puerta.
 */

/**
 * Las columnas de fn_estado_suscripcion con los nombres del contrato. La
 * comparten el arranque y la pestaña Suscripción, que no pueden decir cosas
 * distintas.
 */
export const COLUMNAS_DEL_CICLO = `
  estado, solo_lectura AS "soloLectura", dias_restantes AS "diasRestantes",
  vence_el::text AS "venceEl", plan_codigo AS "planCodigo", acceso, suspension,
  pagar_a_mas_tardar::text AS "pagarAMasTardar", suspendida_desde::text AS "suspendidaDesde",
  reactivable_hasta::text AS "reactivableHasta", se_elimina_el::text AS "seEliminaEl",
  cancelada_por AS "canceladaPor", pago_en_verificacion AS "pagoEnVerificacion"`;
