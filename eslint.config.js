import tsParser from '@typescript-eslint/parser';

const MENSAJE_PG =
  "No importes 'pg' directo: pasá por ejecutarComoTenant " +
  '(src/infraestructura/basedatos/contextoTenant.ts), la única conexión ' +
  'autorizada. Es la que fija el contexto de inquilino antes de tocar la ' +
  'base (RN-01); un import suelto de pg abre una vía que esa garantía no ' +
  'cubre.';

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
    // El único archivo con permiso de hablarle a `pg` directo: el módulo
    // dueño de la conexión de app_login, y su propia prueba (que abre un
    // pool ad-hoc a propósito para probar el aislamiento).
    files: [
      'src/infraestructura/basedatos/contextoTenant.ts',
      'src/infraestructura/basedatos/contextoTenant.test.ts',
    ],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
];
