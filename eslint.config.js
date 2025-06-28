import globals from 'globals';
import js from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import unusedImports from 'eslint-plugin-unused-imports';
import prettierConfig from 'eslint-config-prettier';

export default [
  // Global ignores
  {
    ignores: ['dist/**', 'hexlife-wasm/src/core/wasm-engine/**'],
  },

  // Base configuration for JavaScript files
  js.configs.recommended,

  // Configuration to disable ESLint rules that conflict with Prettier
  prettierConfig,

  // Main project configuration
  {
    plugins: {
      import: importPlugin,
      'unused-imports': unusedImports,
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      // Disables the base rule to avoid conflicts with the plugin
      'no-unused-vars': 'off',
      // Enforces the unused-imports rule for dead code detection
      'unused-imports/no-unused-imports': 'warn',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],
      // Rules for the import plugin
      'import/no-unresolved': ['error', { commonjs: true, amd: true }],
      'import/named': 'error',
      'import/namespace': 'error',
      'import/default': 'error',
      'import/export': 'error',
    },
    settings: {
        'import/resolver': {
          node: {
            extensions: ['.js', '.mjs'],
          },
        },
      },
  },
];