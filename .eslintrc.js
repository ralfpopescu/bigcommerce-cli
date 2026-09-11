require('@bigcommerce/eslint-config/patch');

module.exports = {
  extends: ['@bigcommerce/eslint-config'],
  parserOptions: {
    project: ['./tsconfig.json'],
    tsconfigRootDir: __dirname,
  },
  ignorePatterns: ['dist/', 'node_modules/', 'coverage/', '.eslintrc.js', 'vitest.config.mts'],
  rules: {
    // The shared config bans `for...of` because regenerator-runtime is too
    // heavyweight for browser bundles. This is a Node-only CLI: there is no
    // bundle, and the loops here read better than the array equivalents.
    'no-restricted-syntax': [
      'error',
      { selector: 'ForInStatement', message: 'Use Object.keys/entries instead of for...in.' },
      { selector: 'WithStatement', message: '`with` is disallowed.' },
    ],
    'no-plusplus': 'off',
    'no-continue': 'off',

    // The shared config bans type assertions outright. That works when every
    // boundary is validated at runtime; here the boundaries are the API's
    // `unknown` responses and commander's untyped variadic action callbacks,
    // neither of which can be narrowed without a schema validator. Assertions
    // stay allowed, but never on object literals, where they hide real errors.
    '@typescript-eslint/consistent-type-assertions': [
      'error',
      { assertionStyle: 'as', objectLiteralTypeAssertions: 'never' },
    ],

    // A webpack rule; this package is never bundled.
    'import/dynamic-import-chunkname': 'off',

    // Pagination is inherently sequential — each request needs the previous
    // page's cursor, so the requests cannot be issued in parallel.
    'no-await-in-loop': 'off',

    // The BigCommerce API speaks snake_case on the wire and HTTP headers are
    // capitalized. Those names are not ours to choose.
    '@typescript-eslint/naming-convention': [
      'error',
      { selector: 'default', format: ['camelCase'] },
      { selector: 'import', format: ['camelCase', 'PascalCase'] },
      {
        selector: 'variable',
        format: ['camelCase', 'UPPER_CASE', 'PascalCase'],
        leadingUnderscore: 'allow',
      },
      { selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
      { selector: 'typeLike', format: ['PascalCase'] },
      { selector: 'enumMember', format: ['PascalCase', 'UPPER_CASE'] },
      // Wire format: request/response bodies, query parameters, headers.
      { selector: ['objectLiteralProperty', 'typeProperty'], format: null },
      { selector: 'objectLiteralMethod', format: ['camelCase'] },
    ],
  },
  overrides: [
    {
      // A CLI's output *is* stdout. Printing is confined to output.ts and the
      // interactive prompts in auth.ts; everywhere else should route through
      // the formatters.
      files: ['src/commands/auth.ts', 'src/index.ts'],
      rules: { 'no-console': 'off' },
    },
    {
      files: ['test/**/*.ts'],
      rules: {
        // Permission masks (mode & 0o777) are the clearest way to assert modes.
        'no-bitwise': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-shadow': 'off',
        '@typescript-eslint/require-await': 'off',
        '@typescript-eslint/no-require-imports': 'off',
        'import/order': 'off',
        '@typescript-eslint/consistent-type-assertions': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        'no-console': 'off',
      },
    },
  ],
};
