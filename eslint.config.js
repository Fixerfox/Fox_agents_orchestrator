import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';

/** Matriz de SPEC-056: el editor avisa al escribir y el test de arquitectura falla en `npm run check` [R56.7]. */
const architecture = JSON.parse(readFileSync(new URL('./scripts/architecture.json', import.meta.url), 'utf8'));
const OWN = ['core', 'editor', 'ui', 'claude', 'store', 'workspace', 'runtime'];

function layerRules(layer) {
  const banned = OWN.filter((p) => !layer.allowed.includes(p) && p !== layer.name).map((p) => `@orquestador/${p}`);
  const patterns = [{ group: banned.flatMap((p) => [p, `${p}/*`]), message: `«${layer.name}» solo puede importar de ${layer.allowed.join(', ') || 'ningún paquete'} (SPEC-056).` }];
  const pure = `«${layer.name}» no puede usar Node, Electron ni el SDK (SPEC-056).`;
  // `paths` y no `patterns`: un patrón «events» también marcaría «./events».
  const paths = layer.pure ? builtinModules.map((name) => ({ name, message: pure })) : [];
  if (layer.pure) {
    patterns.push({ group: ['node:*', ...architecture.forbiddenInPure], message: pure });
    if (!layer.react) patterns.push({ group: ['react', 'react/*', 'react-dom', 'react-dom/*'], message: 'Solo «ui» importa React (SPEC-056).' });
  }
  return { files: [`${layer.src}/**/*.{ts,tsx}`], rules: { 'no-restricted-imports': ['error', { paths, patterns: patterns.filter((p) => p.group.length > 0) }] } };
}

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/dist-preview/**', '**/dist-eval/**', '_to_delete/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['scripts/**/*.mjs', '*.config.*'],
    languageOptions: { globals: globals.node },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  ...architecture.layers.map(layerRules),
);
