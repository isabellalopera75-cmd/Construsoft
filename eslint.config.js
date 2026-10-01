import tsParser from '@typescript-eslint/parser';

const MENSAJE_PG =
  "No importes 'pg' directo: pasá por ejecutarComoTenant " +
  '(src/infraestructura/basedatos/contextoTenant.ts) o por autenticar/' +
  'resolverToken (src/infraestructura/basedatos/autenticacion.ts), que son ' +
  'las únicas conexiones autorizadas. Una de las dos fija el contexto de ' +
  'inquilino antes de tocar la base (RN-01); la otra resuelve credenciales ' +
  'sin contexto y no expone un cliente genérico (D-46, D-50). Un import ' +
  'suelto de pg abre una tercera vía que ninguna de las dos garantías cubre.';

export default [
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      sourceType: 'module',
      ecmaVersion: 2022,
    },
    rules: {
      'no-restricted-imports': ['error', { paths: [{ name: 'pg', message: MENSAJE_PG }] }],
    },
  },
  {
    // Los únicos archivos con permiso de hablarle a `pg` directo: los dos
    // módulos dueños de una conexión, y sus propias pruebas (que abren
    // pools ad-hoc a propósito para probar el aislamiento y D-50).
    files: [
      'src/infraestructura/basedatos/contextoTenant.ts',
      'src/infraestructura/basedatos/contextoTenant.test.ts',
      'src/infraestructura/basedatos/autenticacion.ts',
      'src/infraestructura/basedatos/autenticacion.test.ts',
      // Solo pruebas: prepara escenarios que ninguna conexión legítima puede
      // fabricar (vencer una suscripción) y se niega a abrir fuera de una base
      // «_test». La aplicación no lo importa.
      'src/pruebas/superusuario.ts',
    ],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
];
