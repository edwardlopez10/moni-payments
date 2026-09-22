import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'specs/**',
      'prompts/**',
      'bruno/**',
      'docs/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ['**/*.{ts,js}'],
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@prisma/client',
              message: 'domain must stay pure: no Prisma imports.',
            },
            {
              name: 'fastify',
              message: 'domain must stay pure: no Fastify imports.',
            },
          ],
          patterns: [
            {
              group: ['**/modules/**', '*/modules/*', '**/modules/*'],
              message: 'domain must not import from modules.',
            },
            {
              group: ['**/providers/fake', '**/providers/fake/**'],
              message: 'domain must not import the fake provider.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/providers/**/*.ts'],
    ignores: ['src/providers/fake/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@prisma/client',
              message: 'providers must not import Prisma.',
            },
            {
              name: 'fastify',
              message: 'providers must not import Fastify.',
            },
          ],
          patterns: [
            {
              group: ['**/modules/**', '*/modules/*', '**/modules/*'],
              message: 'providers must not import from modules.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/modules/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/providers/fake', '**/providers/fake/**'],
              importNames: ['FakePaymentProvider'],
              message:
                'modules must not import FakePaymentProvider by name; use the provider registry.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/modules/*/routes.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['./repository', './*/repository', '**/repository'],
              message: 'routes must call the service layer, not the repository.',
            },
            {
              group: ['**/providers/fake', '**/providers/fake/**'],
              importNames: ['FakePaymentProvider'],
              message:
                'modules must not import FakePaymentProvider by name; use the provider registry.',
            },
          ],
        },
      ],
    },
  },
);
