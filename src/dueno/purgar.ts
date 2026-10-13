/**
 * Corre a mano la purga diaria (D-74, CONTRATO §15.5) y dice qué eliminó.
 *
 *     npm run purgar
 *
 * Es la MISMA que la API corre sola cada día a las 00:05 de Bogotá: elimina
 * las empresas suspendidas por falta de pago hace 60 días y las canceladas
 * cuyo plazo para reactivar ya venció. Es IRREVERSIBLE. Cuáles cumplieron su
 * plazo lo decide la base; la prueba vencida no la toca (sigue siendo a mano,
 * desde el panel).
 *
 * Va por la conexión del panel (las variables SUPERADMIN_DB_* del .env): es
 * la única a la que la base le concede fn_purgar_empresas.
 */
import { purgarEmpresas } from '../infraestructura/basedatos/plataforma.js';
import { describirPurga } from '../purga/purgaDiaria.js';

try {
  console.log(describirPurga(await purgarEmpresas()));
  process.exit(0);
} catch (error) {
  console.error(`La purga falló y no eliminó nada. ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
