// ESLint (flat config): typescript-eslint with type information, React and its hooks rules, sorted imports.
// Formatting is Prettier's (eslint-config-prettier turns the stylistic rules off).
import js from '@eslint/js';
import eslintReact from '@eslint-react/eslint-plugin';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    'dist/',
    'aip/',
    'trn-docs/',
    'data/',
    'public/',
    'server/pgdata/',
    'tests/e2e/artifacts/',
    // iOS: Xcode's build output and the web app copied into the app (npm run ios:sync)
    'ios/build/',
    'ios/App/App/public/',
    'ios/App/CapApp-SPM/',
    // agents' git worktrees
    '.claude/',
    // applied migrations are frozen
    'api/_lib/migrations/',
    // the browser-side weather code before the proxy, kept verbatim for the equivalence test
    'tests/unit/data/legacy/',
  ]),
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { project: ['./tsconfig.app.json', './tsconfig.node.json'], tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/only-throw-error': 'error',
      // String(x) of an unknown input is how request bodies are normalised
      '@typescript-eslint/no-base-to-string': 'off',
      // `IsoDate | ''` documents the empty value even though IsoDate is a string
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      // an async function without await is how a sync body meets a Promise-returning signature
      '@typescript-eslint/require-await': 'off',
      // methods are declared as properties, so destructuring them (useSession(), route handlers) is sound
      '@typescript-eslint/method-signature-style': ['error', 'property'],
      // database rows and parsed JSON are typed at the boundary (rows.ts, the *Of normalisers); the
      // no-unsafe-* family would flag every step of that normalisation
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    // one-off build scripts that read the legacy data/*.js globals
    files: ['tools/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    files: ['tests/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/prefer-promise-reject-errors': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
    },
  },
  {
    files: ['src/**/*.tsx', 'tests/**/*.tsx'],
    extends: [eslintReact.configs['recommended-typescript']],
    rules: {
      // the hooks rules come from eslint-plugin-react-hooks below
      '@eslint-react/exhaustive-deps': 'off',
      '@eslint-react/rules-of-hooks': 'off',
      '@eslint-react/naming-convention-ref-name': 'off',
      '@eslint-react/no-array-index-key': 'off',
      '@eslint-react/set-state-in-effect': 'off',
      '@eslint-react/use-state': 'off',
    },
  },
  {
    // test components defined next to the test that renders them
    files: ['tests/**/*.tsx'],
    rules: {
      '@eslint-react/no-nested-component-definitions': 'off',
      '@eslint-react/static-components': 'off',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': ['error', { additionalHooks: '^useAsync$' }],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },
  {
    // MapLibre markers and drag handlers are bound imperatively and go with the marker or the drag
    files: ['src/features/editor/map/RouteMap.tsx', 'src/features/waypoints/WaypointMap.tsx'],
    rules: {
      '@eslint-react/web-api-no-leaked-event-listener': 'off',
      '@eslint-react/web-api-no-leaked-timeout': 'off',
    },
  },
  {
    files: ['api/**', 'server/**', 'tools/**', 'tests/**', '*.config.{js,ts}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    plugins: { 'simple-import-sort': simpleImportSort },
    rules: {
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      eqeqeq: ['error', 'smart'],
      'no-console': 'off',
      'prefer-const': 'error',
    },
  },
  prettier,
);
