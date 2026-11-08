import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'dist/**',
      'tools/incremental-renderer/dist/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs}'],
    rules: {
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: [
      'src/**/*.js',
      'functions/**/*.js',
      'e2e/**/*.js',
      'tools/incremental-renderer/src/**/*.js',
      'tools/incremental-renderer/scripts/compare.mjs',
    ],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['*.config.js', 'server/**/*.js', 'tests/**/*.js', 'e2e/**/*.js', 'tools/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['e2e/**/*.js'],
    rules: { 'no-empty-pattern': ['error', { allowObjectPatternsAsParameters: true }] },
  },
];
