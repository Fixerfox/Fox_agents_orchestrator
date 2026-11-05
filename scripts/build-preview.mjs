// Vista previa de la interfaz en un navegador, con la API en memoria (para revisarla con capturas).
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist-preview');
mkdirSync(out, { recursive: true });
const entry = join(out, 'entry.tsx');
writeFileSync(
  entry,
  `import '@xyflow/react/dist/style.css';
import '@fontsource-variable/geist/index.css';
import '@fontsource-variable/geist-mono/index.css';
import '@xterm/xterm/css/xterm.css';
import '../packages/ui/src/styles.css';
import { createRoot } from 'react-dom/client';
import { App, createMemoryApi } from '@orquestador/ui';
const AGENTS = [
  { id: 'sprites', name: 'Sprites', description: 'Dibuja personajes y objetos en píxel art' },
  { id: 'revisor', name: 'Revisor', description: 'Comprueba el resultado y devuelve un veredicto' },
  { id: 'sonido', name: 'Sonido' },
];
const enc = new TextEncoder();
const sample = {
  'agents/revisor.md': '---\\nname: revisor\\ndescription: Comprueba el resultado y devuelve un veredicto\\ntools: Read, Bash\\nmodel: opus\\nskills: pixel-art\\n---\\nRevisa todo con cuidado.\\n',
  'skills/pixel-art/SKILL.md': '---\\nname: pixel-art\\ndescription: Dibuja sprites en píxel art con paleta limitada\\n---\\n# Pasos\\n',
  'skills/pixel-art/plantillas/base.txt': 'base',
  'skills/pixel-art/run.sh': 'echo',
  '.mcp.json': '{"mcpServers":{"git":{"command":"npx"}}}',
};
const ago = (d) => new Date(Date.now() - d * 86400000).toISOString();
const recent = [
  { id: 'p1', name: 'Revisión de sprites', folder: 'Juegos / Revisión de sprites', openedAt: ago(0), missing: false },
  { id: 'p2', name: 'Tienda online', folder: 'Trabajo / Tienda online', openedAt: ago(1), missing: false },
  { id: 'p3', name: 'Prototipo antiguo', folder: 'Escritorio / Prototipo antiguo', openedAt: ago(30), missing: true },
];
const importTree = { files: Object.entries(sample).map(([path, text]) => ({ path, data: enc.encode(text) })) };
const agentDefs = [
  { id: 'pixelador', schemaVersion: 1, name: 'Pixelador', description: 'Dibuja sprites y animaciones en píxel art con la paleta del juego', instructions: 'Eres el pixelador de INC Wars.\\n\\n## Cómo trabajas\\n- Lienzo de 32×32.\\n- Usa solo la paleta del contexto.', model: 'claude-sonnet-5-5', contextIds: ['paleta'], skillIds: ['pixel-art'] },
  { id: 'revisor', schemaVersion: 1, name: 'Revisor', description: 'Comprueba el resultado y devuelve un veredicto', instructions: 'Revisa el resultado del paso anterior.', model: 'claude-sonnet-5-5', contextIds: ['paleta'], skillIds: [] },
];
const contexts = [{ id: 'paleta', schemaVersion: 1, name: 'Paleta INC', kind: 'text', value: 'Paleta oficial (16 colores)' }];
const skills = [{ id: 'pixel-art', schemaVersion: 1, name: 'pixel-art', description: 'Dibuja sprites en píxel art con paleta limitada', body: '# Pasos' }];
const workFolderTree = { files: importTree.files, summary: 'INCWars/\\n  .claude/\\n  docs/  (14 archivos)\\n  juego/  (412 archivos)\\n  assets/  (1.380 imágenes)\\n\\nREADME.md: INC Wars es un juego de estrategia en píxel art.', docs: [{ name: 'CLAUDE.md', text: '# Normas del repositorio\\nTodo en español.' }, { name: 'TRABAJO.md', text: '# Forma de trabajar\\nUn jefe nuevo: diseño, sprites y registro en el Gestor.' }] };
createRoot(document.getElementById('root')).render(<App api={createMemoryApi(undefined, { importTree, recent, agents: agentDefs, contexts, skills, workFolderPick: { name: 'INCWars', files: 1806 }, workFolderTree })} agents={AGENTS} />);
`,
);
await build({
  absWorkingDir: root,
  entryPoints: [entry],
  outfile: join(out, 'preview.js'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
  loader: { '.woff2': 'file', '.woff': 'file' },
  assetNames: '[name]-[hash]',
  logLevel: 'warning',
});
writeFileSync(
  join(out, 'index.html'),
  '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Orquestador</title><link rel="stylesheet" href="./preview.css"><script src="./theme-init.js"></script></head><body><div id="root"></div><script src="./preview.js"></script></body></html>',
);
copyFileSync(join(root, 'apps/desktop/src/renderer/theme-init.js'), join(out, 'theme-init.js'));
console.log('Vista previa en', out);
