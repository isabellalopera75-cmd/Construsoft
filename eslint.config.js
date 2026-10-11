import tsParser from '@typescript-eslint/parser';

const MENSAJE_PG =
  "No importes 'pg' directo: pasá por ejecutarComoTenant " +
  '(src/infraestructura/basedatos/contextoTenant.ts) o por autenticar/' +
  'resolverToken (src/infraestructura/basedatos/autenticacion.ts), o, solo ' +
  'para el panel del superadministrador, por plataforma.ts. Son las únicas ' +
  'conexiones autorizadas. La primera fija el contexto de inquilino antes de ' +
  'tocar la base (RN-01); la segunda resuelve credenciales sin contexto y no ' +
  'expone un cliente genérico (D-46, D-50); la tercera firma cada acción del ' +
  'panel (D-72). Un import suelto de pg abre una vía que ninguna de esas ' +
  'garantías cubre.';

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
      // La tercera conexión: superadmin_login, solo para el panel (CONTRATO §12).
      'src/infraestructura/basedatos/plataforma.ts',
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
