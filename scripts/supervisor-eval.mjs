// Empaqueta y lanza la evaluación de los casos del Supervisor [R75.23]. No forma parte de `npm run check`.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist-eval');
mkdirSync(out, { recursive: true });
await build({ entryPoints: [join(root, 'scripts', 'supervisor-eval', 'main.ts')], bundle: true, platform: 'node', outfile: join(out, 'supervisor-eval.cjs'), format: 'cjs', target: 'node22', external: ['@anthropic-ai/claude-agent-sdk'], logLevel: 'warning', absWorkingDir: root });
const r = spawnSync(process.execPath, [join(out, 'supervisor-eval.cjs'), ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 1);
