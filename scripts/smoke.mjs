// Prueba de humo de lo empaquetado [R91.14]: arranca el ejecutable con --smoke y lee su resultado.
// Uso: node scripts/smoke.mjs <ejecutable> [argumentos extra]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** La línea `ORQ_SMOKE {…}` de una salida, ya leída. */
export function parseSmoke(text) {
  const line = text.split(/\r?\n/).reverse().find((l) => l.startsWith('ORQ_SMOKE '));
  if (!line) return undefined;
  try {
    return JSON.parse(line.slice('ORQ_SMOKE '.length));
  } catch {
    return undefined;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [exe, ...extra] = process.argv.slice(2);
  if (!exe || !existsSync(exe)) {
    console.error(`No existe el ejecutable: ${exe ?? '(ninguno)'}`);
    process.exit(2);
  }
  // Windows no siempre pasa la salida de una app de ventana: también se escribe en un archivo.
  const out = join(mkdtempSync(join(tmpdir(), 'orq-smoke-')), 'smoke.txt');
  // Con ELECTRON_RUN_AS_NODE, Electron hace de Node y no arranca la app.
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const run = spawnSync(exe, ['--smoke', ...extra], { encoding: 'utf8', timeout: 180_000, env: { ...env, ORQ_SMOKE_OUT: out, APPIMAGE_EXTRACT_AND_RUN: '1' } });
  const text = `${run.stdout ?? ''}\n${existsSync(out) ? readFileSync(out, 'utf8') : ''}`;
  const result = parseSmoke(text);
  console.log(result ? JSON.stringify(result, null, 2) : `Sin resultado. Salida:\n${text}\n${run.stderr ?? ''}${run.error ? `\n${run.error.message}` : ''}`);
  process.exit(result?.ok === true && run.status === 0 ? 0 : 1);
}
