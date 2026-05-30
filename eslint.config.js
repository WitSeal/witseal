// ESLint 9 flat config for the WitSeal TS reference implementation.
//
// Scope: src + tests + schemas. Uses the syntactic (non-type-checked)
// recommended rule set so it runs without a tsconfig project service —
// `tsconfig.json` excludes tests, and type-checked rules would fail on files
// outside the project graph. Type safety is enforced separately by
// `tsc --noEmit` (the `typecheck` script).
//
// Built on the direct devDependencies (@typescript-eslint/parser + plugin,
// both ^8) rather than the unified `typescript-eslint` meta-package, which is
// only present transitively here.
import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import globals from 'globals';

export default [
  // Never lint build output, deps, or coverage.
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  // Base JS recommended rules.
  js.configs.recommended,
  // TypeScript sources, tests, and schemas run on Node.js.
  {
    files: ['src/**/*.ts', 'tests/**/*.ts', 'schemas/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      // typescript-eslint syntactic recommended set.
      ...tsPlugin.configs.recommended.rules,
      // no-unused-vars is handled by the TS-aware rule; disable the core one
      // to avoid duplicate / false positives on type-only constructs.
      'no-unused-vars': 'off',
      // Underscore prefix marks an intentionally-unused binding (e.g. a
      // callback parameter kept for signature shape). Standard ts-eslint idiom.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Core no-undef is turned off for TS per typescript-eslint guidance:
      // without type information it false-positives on ambient type globals
      // (e.g. the `NodeJS` namespace). TypeScript itself enforces undefined
      // references via `tsc --noEmit`.
      'no-undef': 'off',
      // Core no-redeclare is turned off for TS: it false-positives on function
      // overload signatures (multiple declarations of one function, e.g.
      // `generateReceiptByVersion`). TypeScript handles overload validity.
      'no-redeclare': 'off',
    },
  },
];
