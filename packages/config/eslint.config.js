// ProBooks shared ESLint flat config (STANDARDS §4, §9.3).
// The single source of lint truth. Apps extend; no per-app overrides without an ADR.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import probooksPlugin from './eslint-rules/no-cross-tenant.js';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/.next/**', '**/coverage/**', '**/cdk.out/**', '**/*.config.*'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    plugins: {
      import: importPlugin,
      '@probooks': probooksPlugin,
    },
    rules: {
      // STANDARDS §3 — TS strictness
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': 'allow-with-description', 'ts-ignore': true },
      ],
      // STANDARDS §13 — no console in source
      'no-console': 'error',
      // STANDARDS §4 — named exports only (Next.js page/layout exempt per-app)
      'import/no-default-export': 'error',
      // STANDARDS §4 — import ordering
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc' },
        },
      ],
      // STANDARDS §4 — cyclomatic complexity cap
      complexity: ['error', 10],
      // STANDARDS §9.3 — the multi-tenancy backstop
      '@probooks/no-cross-tenant': 'error',
    },
  },
  // Tests may use default exports (config files) and relaxed rules
  {
    files: ['**/*.spec.ts', '**/*.e2e.spec.ts', '**/test-utils/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'import/no-default-export': 'off',
    },
  },
);
