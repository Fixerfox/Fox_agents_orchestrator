import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProjectStore } from '@orquestador/store';
import { checkEnv, checkRunnerFor, evidenceFor } from '../src/main/checks';
import { tryCheck } from '../src/main/handlers/runs';
import { createProject } from '../src/main/composition';

let dir: string;
let store: ProjectStore;
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'orq-chk-'));
  store = await createProject(dir, { name: 'p' });
  await fs.mkdir(join(dir, 'src'), { recursive: true });
  await fs.writeFile(join(dir, 'src', 'a.ts'), 'uno\ndos\ntres\n');
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));
const sig = new AbortController().signal;

describe('SPEC-075 · comprobaciones en la app', () => {
  it('[R75.4] el comando corre en la carpeta del paso, sin secretos en el entorno, y se mata al pasar su tiempo', async () => {
    const r = checkRunnerFor(store);
    const env = checkEnv({ PATH: '/bin', ANTHROPIC_API_KEY: 'x', GITHUB_TOKEN: 'y', HOME: '/h' });
    expect(Object.keys(env).sort()).toEqual(['HOME', 'PATH']);
    const ok = await r.command({ run: 'node -e "console.log(process.cwd())"', timeoutSec: 30, dir: join(dir, 'src') }, sig);
    expect(ok.exitCode).toBe(0);
    expect(ok.output.trim()).toBe(await fs.realpath(join(dir, 'src')));
    const slow = await r.command({ run: 'node -e "setTimeout(() => {}, 20000)"', timeoutSec: 1 }, sig);
    expect(slow.timedOut).toBe(true);
    expect(slow.durationMs).toBeLessThan(10_000);
    expect(await r.missing(['src/*.ts', 'docs/*.md'])).toEqual(['docs/*.md']);
  }, 20_000);

  it('[R75.6] lo aprobado se guarda por proyecto con su hash; cambiar el texto pide aprobarlo otra vez', async () => {
    const r = checkRunnerFor(store);
    expect(await r.approved('npm test')).toBe(false);
    await r.approve('npm test');
    expect(await r.approved('npm test')).toBe(true);
    expect(await r.approved('npm test -- --all')).toBe(false);
    const saved = await fs.readFile(join(dir, '.orquestador', 'approved-checks.json'), 'utf8');
    expect(saved).not.toContain('npm test');
    expect(await checkRunnerFor(store).approved('npm test')).toBe(true);
  });

  it('[R75.7] el diff compara con la copia de antes; lo nuevo va entero, lo de comandos solo se lista, con tope', async () => {
    await fs.mkdir(join(store.paths.backupsDir('r1'), 'src'), { recursive: true });
    await fs.writeFile(join(store.paths.backupsDir('r1'), 'src', 'a.ts'), 'uno\ntres\n');
    await fs.writeFile(join(dir, 'src', 'b.ts'), 'nuevo\n');
    const ev = evidenceFor(store);
    const out = await ev.diff({ runId: 'r1', files: [{ path: 'src/a.ts', change: 'modified' }, { path: 'src/b.ts', change: 'created' }, { path: 'dist/x.js', change: 'created', via: 'command' }], priority: [], maxChars: 12_000 });
    expect(out.diff).toContain('+dos');
    expect(out.diff).toContain('--- /dev/null\n+++ b/src/b.ts');
    expect(out.diff).toContain('dist/x.js (cambiado por un comando)');
    expect(out.lines).toEqual([{ path: 'src/a.ts', added: 1, removed: 0 }, { path: 'src/b.ts', added: 1, removed: 0 }]);
    const tight = await ev.diff({ runId: 'r1', files: [{ path: 'src/a.ts', change: 'modified' }, { path: 'src/b.ts', change: 'created' }], priority: ['src/a.ts'], maxChars: 70 });
    expect(tight.diff).toContain('src/a.ts');
    expect(tight.diff).toContain('No caben aquí: src/b.ts (+1 −0)');
  });

  it('[R75.24] «Ejecutar ahora» desde el lateral: ejecuta, deja el comando aprobado y dice cómo fue', async () => {
    const r = await tryCheck(store, { id: 't', label: 'Hola', kind: 'command', run: 'node -e "console.log(42)"' });
    expect(r).toMatchObject({ ok: true, checkId: 't' });
    expect(r.detail.trim()).toBe('42');
    expect(await checkRunnerFor(store).approved('node -e "console.log(42)"')).toBe(true);
    expect(await tryCheck(store, { id: 'f', label: 'Docs', kind: 'files', mustExist: ['docs/*.md'] })).toMatchObject({ ok: false, detail: 'No existe: docs/*.md' });
    expect((await tryCheck(store, { id: 'o', label: 'O', kind: 'output', contains: 'x' })).ok).toBe(false);
  }, 20_000);
});
