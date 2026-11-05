import stylistic from '@stylistic/eslint-plugin';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['node_modules/**', 'build/**', '.react-router/**'] },
  {
    files: ['**/*.{js,mjs,cjs,jsx,ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { '@stylistic': stylistic },
    rules: {
      curly: ['error', 'all'],
      '@stylistic/padding-line-between-statements': ['error', { blankLine: 'always', prev: '*', next: 'if' }, { blankLine: 'always', prev: 'if', next: '*' }],
    },
  },
];
