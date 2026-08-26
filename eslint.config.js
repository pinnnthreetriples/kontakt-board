import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.strictTypeChecked],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: { project: ['./tsconfig.app.json'], tsconfigRootDir: import.meta.dirname },
    },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      'complexity': ['error', 24],
      'max-depth': ['error', 4],
    },
  },
  {
    files: ['**/*.tsx'],
    rules: {
      // Исключение AGENTS.md (<span> вокруг заблокированной кнопки в Tooltip) не выражается
      // селектором: в таком месте нужен eslint-disable-next-line с пояснением.
      'no-restricted-syntax': ['error', {
        selector: 'JSXOpeningElement[name.name=/^[a-z]/]',
        message: 'Сырые HTML-теги запрещены, используйте компонент Material UI (Box, Typography, Stack, Button…). См. AGENTS.md → UI / Design System',
      }],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/shared/design-system/**'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: '@mui/material/styles', message: 'Тема и общие стили правятся только в src/shared/design-system. См. AGENTS.md → UI / Design System' },
          { name: '@emotion/styled', message: 'Тема и общие стили правятся только в src/shared/design-system. См. AGENTS.md → UI / Design System' },
        ],
      }],
    },
  },
  {
    files: ['**/*.{test,spec}.{ts,tsx}', 'src/test/**'],
    rules: { '@typescript-eslint/no-unsafe-assignment': 'off', '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
