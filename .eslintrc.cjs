// @ts-check

/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'local-rules'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
  rules: {
    // Allow explicit any in certain scenarios for flexibility during hackathon
    '@typescript-eslint/no-explicit-any': 'warn',
    // Enforce no unused vars (ignore underscore-prefixed)
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
  },
  overrides: [
    {
      // Custom rule: flag writes to LLM-prohibited core fields from renderer/rag modules
      files: ['packages/rag/**/*.ts', 'packages/ai-generator/**/*.ts'],
      rules: {
        'local-rules/no-llm-prohibited-field-write': 'error',
      },
    },
  ],
  ignorePatterns: ['node_modules/', 'dist/', '*.js', '*.cjs', '*.mjs'],
};
