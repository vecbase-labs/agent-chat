//  @ts-check

import { tanstackConfig } from '@tanstack/eslint-config'

export default [
  ...tanstackConfig,
  {
    rules: {
      'import/no-cycle': 'off',
      'import/order': 'off',
      'sort-imports': 'off',
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/require-await': 'off',
      'pnpm/json-enforce-catalog': 'off',
    },
  },
  {
    ignores: [
      'eslint.config.js',
      'prettier.config.js',
      '.output/**',
      '.nitro/**',
      '.tanstack/**',
      'coverage/**',
      'data/**',
      'backups/**',
      'src/routeTree.gen.ts',
    ],
  },
  {
    files: ['src/components/ui/**'],
    rules: { 'import/consistent-type-specifier-style': 'off' },
  },
  // Query rows and streamed bodies can be absent at runtime even when library
  // declarations imply otherwise. Keep explicit defensive checks at boundaries.
  {
    files: ['src/server/**'],
    rules: { '@typescript-eslint/no-unnecessary-condition': 'off' },
  },
]
