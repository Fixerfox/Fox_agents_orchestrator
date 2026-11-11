import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueryFn, SdkMessage } from '@orquestador/claude';
import { defaultSettings, newAgent, type Diagram, type GitCommit, type GitOrigin, type RunEvent } from '@orquestador/core';
import { CHANNELS, type GitOverviewView } from '@orquestador/editor';
import { ApiKeyVault, SettingsStore } from '@orquestador/store';
import { composeOrchestrator } from '../src/main/composition';
import { DesktopHandlers } from '../src/main/handlers';

let dir: string;
let work: string;
let h: DesktopHandlers;
let pushed: RunEvent[];
/** Lo que hace el agente de mentira mientras trabaja. */
let during: () => Promise<void> | void;

const SLOW = { timeout: 40_000 };
const cipher = { available: () => true, encrypt: (s: string) => Buffer.from(`c:${s}`), decrypt: (b: Buffer) => b.toString().slice(2) };
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (...args: string[]) => execFileSync('git', args, { cwd: work, stdio: 'pipe', env: ENV }).toString().trim();
const query: QueryFn = async function* () {
  await during();
  const done: SdkMessage = { type: 'result', subtype: 'success', is_error: false, result: 'Hecho', usage: { input_tokens: 1, output_tokens: 1 } };
  yield done;
};
const flow: Diagram = {
  id: 'flujo',
  name: 'Mi flujo',
  schemaVersion: 1,
  nodes: [
    { id: 'entry', kind: 'entry' },
    { id: 'dev', kind: 'agent', agentId: 'dev' },
    { id: 'output', kind: 'output' },
  ],
  edges: [
    { id: 'e1', from: 'entry', to: 'dev' },
    { id: 'e2', from: 'dev', to: 'output' },
  ],
};
const val = <T,>(r: unknown) => {
  const x = r as { ok: boolean; value?: T; error?: unknown };
  if (!x.ok) throw new Error(JSON.stringify(x.error));
  return x.value as T;
};
const overview = async () => val<GitOverviewView | null>(await h.invoke(CHANNELS.gitOverview, undefined));
const history = async () => val<{ commits: GitCommit[]; origins: Record<string, GitOrigin> }>(await h.invoke(CHANNELS.gitHistory, { limit: 50 }));

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'orq-versiones-')));
  work = join(dir, 'mi-juego');
  await fs.mkdir(work);
  pushed = [];
  during = () => undefined;
  h = new DesktopHandlers({
    pickFolder: async () => work,
    createOrchestrator: (ctx) => composeOrchestrator(ctx, query),
    claudeQuery: query,
    settings: new SettingsStore(join(dir, 'config')),
    vault: new ApiKeyVault(join(dir, 'config'), cipher),
    push: (_id, events) => pushed.push(...events),
    batchMs: 5,
  });
});
afterEach(async () => {
  h.dispose();
  await fs.rm(dir, { recursive: true, force: true });
});

async function open(engine: 'claude' | 'simulated' = 'claude') {
  git('init', '-q', '-b', 'main');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'user.name', 't');
  git('config', 'user.email', 't@t');
  await fs.writeFile(join(work, 'README.md'), '# Mi juego\n');
  await fs.writeFile(join(work, '.gitignore'), '.orquestador/\n');
  git('add', '.');
  git('commit', '-q', '-m', 'inicial');
  val(await h.invoke(CHANNELS.createProject, undefined));
  val(await h.invoke(CHANNELS.saveAgent, { ...newAgent('dev', 'Dev'), instructions: 'Programa el juego' }));
  val(await h.invoke(CHANNELS.saveDiagram, flow));
  val(await h.invoke(CHANNELS.saveSettings, { ...defaultSettings(), supervisorReview: false, engine }));
}
async function run() {
  const { runId } = val<{ runId: string }>(await h.invoke(CHANNELS.startRun, { diagramId: 'flujo', order: 'Añade una nave' }));
  // La ejecución terminó y ya apuntó dónde quedó git: su meta lleva el commit de llegada.
  await vi.waitFor(
    async () => {
      const meta = JSON.parse(await fs.readFile(join(work, '.orquestador', 'runs', runId, 'meta.json'), 'utf8')) as { git?: { toSha?: string } };
      expect(meta.git?.toSha).toBeTruthy();
    },
    { timeout: 15_000, interval: 50 },
  );
  return runId;
}

describe('SPEC-098 · el visor con git de verdad', () => {
  it('[R98.9] gitOverview da estado, ramas y cambios sin rutas del equipo; sin repositorio, null', SLOW, async () => {
    val(await h.invoke(CHANNELS.createProject, undefined));
    expect(await overview()).toBeNull();
    val(await h.invoke(CHANNELS.closeProject, undefined));
    await fs.rm(join(work, '.orquestador'), { recursive: true, force: true });
    await open();
    await fs.writeFile(join(work, 'README.md'), '# Mi juego\nCon naves\n');
    const o = (await overview())!;
    expect(o.state).toMatchObject({ repo: true, branch: 'main', dirty: 1 });
    expect(o.branches).toMatchObject([{ name: 'main', current: true }]);
    expect(o.changes).toEqual([{ path: 'README.md', status: 'modified', added: 1, removed: 0 }]);
    expect(o).toMatchObject({ stashes: [], running: 0, origins: {} });
    expect(JSON.stringify(o)).not.toContain(dir);
    expect(val<string>(await h.invoke(CHANNELS.gitDiff, { path: 'README.md' }))).toContain('+Con naves');
  });

  it('[R98.4][R98.5][R98.13] la rama y los commits que hizo un trabajo llevan su nombre; los hechos a mano, no', SLOW, async () => {
    await open();
    during = async () => {
      await fs.writeFile(join(work, 'nave.ts'), 'export const nave = 1;\n');
      git('add', '.');
      git('commit', '-q', '-m', 'Añade la nave');
    };
    const runId = await run();
    const o = (await overview())!;
    const branch = o.state.branch!;
    expect(branch).toMatch(/^orq\/mi-flujo-/);
    expect(o.origins).toEqual({ [branch]: { runId, name: 'Mi flujo' } });
    await fs.writeFile(join(work, 'a-mano.txt'), 'x');
    git('add', '.');
    git('commit', '-q', '-m', 'A mano');
    const hist = await history();
    expect(hist.commits.map((c) => c.subject)).toEqual(['A mano', 'Añade la nave', 'inicial']);
    expect(hist.origins).toEqual({ [hist.commits[1]!.sha]: { runId, name: 'Mi flujo' } });
  });

  it('[R98.6][R98.7] las acciones se hacen por IPC y devuelven cómo queda todo; lo que no se puede, con su motivo', SLOW, async () => {
    await open();
    const created = val<GitOverviewView>(await h.invoke(CHANNELS.gitAct, { kind: 'create', name: 'feature/menu' }));
    expect(created.state.branch).toBe('feature/menu');
    await fs.writeFile(join(work, 'menu.ts'), 'export {};\n');
    const committed = val<GitOverviewView>(await h.invoke(CHANNELS.gitAct, { kind: 'commit', message: 'Menú' }));
    expect(committed.changes).toEqual([]);
    expect(git('log', '-1', '--format=%s')).toBe('Menú');
    val(await h.invoke(CHANNELS.gitAct, { kind: 'switch', name: 'main' }));
    val(await h.invoke(CHANNELS.gitAct, { kind: 'merge', name: 'feature/menu' }));
    const deleted = val<GitOverviewView>(await h.invoke(CHANNELS.gitAct, { kind: 'delete', name: 'feature/menu' }));
    expect(deleted.branches.map((b) => b.name)).toEqual(['main']);
    expect(await h.invoke(CHANNELS.gitAct, { kind: 'delete', name: 'main' })).toMatchObject({ ok: false, error: { code: 'git-guard', message: expect.stringMatching(/en la que estás/) } });
    expect(await h.invoke(CHANNELS.gitAct, { kind: 'push' })).toMatchObject({ ok: false, error: { code: 'git-guard', message: expect.stringMatching(/No se pudo subir main/) } });
    expect(await h.invoke(CHANNELS.gitAct, { kind: 'rebase' })).toMatchObject({ ok: false, error: { code: 'bad-request' } });
  });

  it('[R98.8] mientras corre una ejecución no se cambia de rama, y sí se puede hacer commit', SLOW, async () => {
    await open();
    git('branch', 'otra');
    let release = () => {};
    during = () => new Promise<void>((r) => (release = r));
    const { runId } = val<{ runId: string }>(await h.invoke(CHANNELS.startRun, { diagramId: 'flujo', order: 'x', git: { mode: 'stay' } }));
    await vi.waitFor(async () => expect((await overview())!.running).toBe(1));
    expect(await h.invoke(CHANNELS.gitAct, { kind: 'switch', name: 'otra' })).toMatchObject({ ok: false, error: { message: expect.stringMatching(/Hay una ejecución en marcha/) } });
    await fs.writeFile(join(work, 'x.txt'), 'x');
    val(await h.invoke(CHANNELS.gitAct, { kind: 'commit', message: 'mientras tanto' }));
    release();
    val(await h.invoke(CHANNELS.subscribeRun, { runId, fromSeq: 1 }));
    await vi.waitFor(async () => expect((await overview())!.running).toBe(0), { timeout: 15_000 });
    val(await h.invoke(CHANNELS.gitAct, { kind: 'switch', name: 'otra' }));
  });

  it('[R98.10] la diferencia de un archivo que puede llevar secretos no llega a la interfaz', SLOW, async () => {
    await open();
    await fs.writeFile(join(work, '.env'), 'API_KEY=supersecreto\n');
    expect((await overview())!.changes.map((c) => c.path)).toContain('.env');
    const diff = val<string>(await h.invoke(CHANNELS.gitDiff, { path: '.env' }));
    expect(diff).not.toContain('supersecreto');
    expect(diff).toMatch(/puede contener secretos/);
    expect(await h.invoke(CHANNELS.gitDiff, { path: '../fuera' })).toMatchObject({ ok: false, error: { code: 'bad-request' } });
    // Un commit se llevaría el .env: no se hace, y lo explica.
    expect(await h.invoke(CHANNELS.gitAct, { kind: 'commit', message: 'todo' })).toMatchObject({ ok: false, error: { message: expect.stringMatching(/\.env puede llevar secretos/) } });
    expect(git('log', '--format=%s')).toBe('inicial');
    await fs.appendFile(join(work, '.gitignore'), '.env\n');
    val(await h.invoke(CHANNELS.gitAct, { kind: 'commit', message: 'ignora el .env' }));
    expect(git('show', '--stat', '--format=', 'HEAD')).not.toContain('.env\n');
  });

  it('[R98.9] el visor no depende del motor: con el simulado se ve igual, aunque la guarda no actúe', SLOW, async () => {
    await open('simulated');
    expect((await overview())!.state).toMatchObject({ repo: true, branch: 'main' });
    expect((await history()).commits.map((c) => c.subject)).toEqual(['inicial']);
    val(await h.invoke(CHANNELS.gitAct, { kind: 'create', name: 'feature/x' }));
    expect(git('branch', '--show-current')).toBe('feature/x');
  });
});
