import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * 決定性（詰将棋性）の担保がこの設定の最大の目的。
 * - `Math.random` はプロジェクト全体で禁止
 * - `core/` `ai/` では時刻・暗号乱数など「実行のたびに変わる値」も禁止
 * - レイヤ間の依存の向き（ui → render/input → core、ui → ai → core）を import 制限で固定
 */

/** 乱数の全面禁止（実装計画書 第2章）。 */
const noRandomness = {
  'no-restricted-properties': [
    'error',
    {
      object: 'Math',
      property: 'random',
      message:
        '乱数は使用禁止です（実装計画書 第1.1章: 詰将棋性）。決定的な計算に置き換えてください。',
    },
  ],
};

/** core / ai に追加で課す「同じ入力なら必ず同じ出力」の制約。 */
const noNondeterminism = {
  'no-restricted-properties': [
    'error',
    {
      object: 'Math',
      property: 'random',
      message: '乱数は使用禁止です（実装計画書 第1.1章: 詰将棋性）。',
    },
    {
      object: 'Date',
      property: 'now',
      message: 'core/ai は時刻に依存できません。値は引数として受け取ってください。',
    },
    {
      object: 'performance',
      property: 'now',
      message: 'core/ai は時刻に依存できません。値は引数として受け取ってください。',
    },
    {
      object: 'crypto',
      property: 'getRandomValues',
      message: '乱数は使用禁止です（実装計画書 第1.1章: 詰将棋性）。',
    },
  ],
  'no-restricted-syntax': [
    'error',
    {
      selector: "NewExpression[callee.name='Date']",
      message: 'core/ai は時刻に依存できません。値は引数として受け取ってください。',
    },
  ],
  'no-restricted-globals': [
    'error',
    {
      name: 'window',
      message: 'core/ai は DOM に依存できません（実装計画書 第3.1章）。',
    },
    {
      name: 'document',
      message: 'core/ai は DOM に依存できません（実装計画書 第3.1章）。',
    },
  ],
};

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      ...noRandomness,
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },

  // core: 他レイヤを一切参照しない（実装計画書 第3.1章）。
  {
    files: ['src/core/**/*.ts'],
    rules: {
      ...noNondeterminism,
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/ai/*', '@/render/*', '@/input/*', '@/ui/*', '@/editor/*', '../*'],
              message: 'core は他のレイヤを参照できません（実装計画書 第3.1章）。',
            },
          ],
        },
      ],
    },
  },

  // ai: core にのみ依存する。
  {
    files: ['src/ai/**/*.ts'],
    rules: {
      ...noNondeterminism,
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/render/*', '@/input/*', '@/ui/*', '@/editor/*'],
              message: 'ai は core にのみ依存できます（実装計画書 第3.1章）。',
            },
          ],
        },
      ],
    },
  },

  // render / input: core を読むだけ。UI 層は参照しない。
  {
    files: ['src/render/**/*.ts', 'src/input/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/ui/*', '@/editor/*'],
              message: 'render/input は ui を参照できません（実装計画書 第3.1章）。',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['tests/**/*.ts', '**/*.test.ts'],
    rules: {
      'no-restricted-properties': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  {
    files: ['*.js', '*.config.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  prettier,
);
