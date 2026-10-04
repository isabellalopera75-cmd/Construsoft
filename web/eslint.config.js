import tsParser from '@typescript-eslint/parser';

/*
 * Una sola regla, y es la que importa: el dinero nunca pasa por Number().
 *
 * El tipo `string` ya impide multiplicarlo —TypeScript rechaza string * number—
 * pero no impide convertirlo, y convertirlo es la otra forma de perder cifras de
 * un numeric(24,6). En coma flotante 1,005 vale 1,00499… (04 §4.1).
 *
 * Que la regla exista no basta: hay una prueba que la rompe a propósito, en
 * src/api/noUsarNumber.prueba-de-la-regla.txt, con instrucciones para
 * comprobar que salta.
 */
export default [
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'Number',
          message:
            'El dinero viaja como texto y no se convierte (04 §4.1). Para mostrarlo, ' +
            'formatearNumero de src/formato.ts. Si de verdad hace falta un número que ' +
            'no es dinero, poné el motivo en un comentario y desactivá la regla en esa línea.',
        },
        {
          name: 'parseFloat',
          message: 'Lo mismo que Number(): pierde cifras de un numeric(24,6).',
        },
        {
          name: 'parseInt',
          message:
            'Para un entero propio del navegador —un índice, un ancho— desactivá la ' +
            'regla en la línea y decí por qué. Para dinero, nunca.',
        },
      ],
    },
  },
];
