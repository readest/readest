import { defineConfig, globalIgnores } from 'eslint/config';
import next from 'eslint-config-next';
import nextVitals from 'eslint-config-next/core-web-vitals';
import tseslint from 'eslint-config-next/typescript';
import jsxA11y from 'eslint-plugin-jsx-a11y';

const eslintConfig = defineConfig([
  ...tseslint,
  ...next,
  ...nextVitals,
  {
    rules: {
      ...jsxA11y.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  globalIgnores([
    'node_modules/**',
    '.next/**',
    '.open-next/**',
    'out/**',
    'build/**',
    'public/**',
    'next-env.d.ts',
  ]),
]);

export default eslintConfig;
