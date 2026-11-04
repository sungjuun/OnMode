import js from '@eslint/js'
import globals from 'globals'
import hooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist/**', 'playwright-report/**', 'test-results/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  { files: ['scripts/**/*.mjs'], languageOptions: { globals: globals.node } },
  { files: ['**/*.{ts,tsx}'], languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': hooks }, rules: {
      'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'error',
    } },
)
