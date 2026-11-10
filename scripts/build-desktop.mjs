// Empaqueta la app de escritorio con esbuild: main y preload (CommonJS) + renderer (IIFE).
// `--release`: sin sourcemaps y sin el modo prueba [R91.8]. `--out <carpeta>`: dónde dejarlo (por defecto apps/desktop/dist).
import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(root, 'apps', 'desktop');
const argv = process.argv.slice(2);
const release = argv.includes('--release');
const outAt = argv.indexOf('--out');
const out = outAt >= 0 && argv[outAt + 1] ? join(root, argv[outAt + 1]) : join(app, 'dist');
mkdirSync(join(out, 'renderer'), { recursive: true });

const common = { bundle: true, sourcemap: !release, logLevel: 'info', absWorkingDir: root };

await build({ ...common, entryPoints: [join(app, 'src/main/main.ts')], outfile: join(out, 'main.cjs'), platform: 'node', format: 'cjs', target: 'node22', define: { __ORQ_TEST_MCP__: String(!release) }, minifySyntax: release, external: ['electron', '@anthropic-ai/claude-agent-sdk', '@lydell/node-pty'] });
await build({ ...common, entryPoints: [join(app, 'src/preload/preload.ts')], outfile: join(out, 'preload.cjs'), platform: 'node', format: 'cjs', target: 'node22', external: ['electron'] });
await build({
  ...common,
  entryPoints: [join(app, 'src/renderer/main.tsx')],
  outfile: join(out, 'renderer', 'renderer.js'),
  platform: 'browser',
  format: 'iife',
  target: 'chrome140',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  minify: true,
  // Con nombres: la traza de un error de la interfaz dice dónde falló [R19.12].
  keepNames: true,
  loader: { '.woff2': 'file', '.woff': 'file' },
  assetNames: '[name]-[hash]',
});
copyFileSync(join(app, 'assets/icon.png'), join(out, 'icon.png'));
copyFileSync(join(app, 'src/renderer/index.html'), join(out, 'renderer', 'index.html'));
copyFileSync(join(app, 'src/renderer/theme-init.js'), join(out, 'renderer', 'theme-init.js'));
console.log('Compilado en', out);
