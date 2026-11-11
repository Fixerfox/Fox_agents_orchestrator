import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueryFn, SdkMessage } from '@orquestador/claude';
import { buildSystemPrompt, promptText } from '@orquestador/claude';
import { branchRule, defaultSettings, newAgent, type Diagram, type GitState, type RunEvent } from '@orquestador/core';
import { CHANNELS } from '@orquestador/editor';
import { ApiKeyVault, SettingsStore } from '@orquestador/store';
import { composeOrchestrator } from '../src/main/composition';
import { DesktopHandlers } from '../src/main/handlers';

let dir: string;
let work: string;
let h: DesktopHandlers;
let pushed: RunEvent[];
let systems: string[];

const SLOW = { timeout: 30_000 };
const cipher = { available: () => true, encrypt: (s: string) => Buffer.from(`c:${s}`), decrypt: (b: Buffer) => b.toString().slice(2) };
const query: QueryFn = async function* ({ options }) {
  if (options.systemPrompt) systems.push(promptText(options.systemPrompt));
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
const git = (...args: string[]) => execFileSync('git', args, { cwd: work, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).toString().trim();
const val = <T,>(r: unknown) => {
  const x = r as { ok: boolean; value?: T; error?: unknown };
  if (!x.ok) throw new Error(JSON.stringify(x.error));
  return x.value as T;
};

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'orq-guarda-')));
  work = join(dir, 'mi-juego');
  await fs.mkdir(work);
  pushed = [];
  systems = [];
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
  // Al terminar, git apunta en segundo plano dónde quedó la carpeta [R98.4]; en Windows eso la bloquea un instante.
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

async function open(withRepo = true) {
  if (withRepo) {
    git('init', '-q', '-b', 'main');
    git('config', 'commit.gpgsign', 'false');
    await fs.writeFile(join(work, 'README.md'), '# Mi juego');
    await fs.writeFile(join(work, '.gitignore'), '.orquestador/\n');
    git('add', '.');
    git('commit', '-q', '-m', 'inicial');
  }
  val(await h.invoke(CHANNELS.createProject, undefined));
  val(await h.invoke(CHANNELS.saveAgent, { ...newAgent('dev', 'Dev'), instructions: 'Programa el juego' }));
  val(await h.invoke(CHANNELS.saveDiagram, flow));
  val(await h.invoke(CHANNELS.saveSettings, { ...defaultSettings(), supervisorReview: false, engine: 'claude' }));
}
async function run(extra: object = {}) {
  const { runId } = val<{ runId: string }>(await h.invoke(CHANNELS.startRun, { diagramId: 'flujo', order: 'Añade una nave', ...extra }));
  const backlog = val<RunEvent[] | { backlog: RunEvent[] }>(await h.invoke(CHANNELS.subscribeRun, { runId, fromSeq: 1 }));
  const first = Array.isArray(backlog) ? backlog : backlog.backlog;
  const all = () => [...first, ...pushed].filter((e) => e.runId === runId);
  await vi.waitFor(() => expect(all().some((e) => e.type === 'run.finished')).toBe(true), { timeout: 15_000 });
  return all();
}

describe('SPEC-097 · la guarda de rama con git de verdad', () => {
  it('[R97.2][R97.15] gitGuard da el estado del repositorio sin rutas y el nombre propuesto', SLOW, async () => {
    await open();
    const view = val<{ state: GitState; suggested: string; otherRuns: number }>(await h.invoke(CHANNELS.gitGuard, { diagramId: 'flujo' }));
    expect(view.state).toMatchObject({ repo: true, branch: 'main', dirty: 0, branches: ['main'] });
    expect(view.suggested).toMatch(/^orq\/mi-flujo-\d{8}-\d{4}$/);
    expect(view.otherRuns).toBe(0);
    expect(JSON.stringify(view)).not.toContain(dir);
  });

  it('[R97.9][R97.11][R97.12] lanzar en main sin elegir crea la rama, lo apunta y el agente de Claude recibe la regla', SLOW, async () => {
    await open();
    const events = await run();
    const e = events.find((x): x is Extract<RunEvent, { type: 'run.git' }> => x.type === 'run.git')!;
    expect(e).toMatchObject({ created: true, from: 'main' });
    expect(e.branch).toMatch(/^orq\/mi-flujo-/);
    expect(git('branch', '--show-current')).toBe(e.branch);
    expect(systems.some((s) => s.includes(branchRule(e.branch)))).toBe(true);
  });

  it('[R97.4][R97.10] quedarse en main hay que elegirlo; una rama nueva desde otra base aparta los cambios si se pide', SLOW, async () => {
    await open();
    git('branch', 'develop');
    const stayed = await run({ git: { mode: 'stay' } });
    expect(stayed.find((x) => x.type === 'run.git')).toMatchObject({ branch: 'main' });
    expect(git('branch', '--show-current')).toBe('main');
    await fs.writeFile(join(work, 'pendiente.txt'), 'x');
    const moved = await run({ git: { mode: 'new', name: 'orq/limpia', from: 'develop', changes: 'stash' } });
    expect(moved.find((x) => x.type === 'run.git')).toMatchObject({ branch: 'orq/limpia', created: true, from: 'develop', stash: 'orquestador: Mi flujo' });
    expect(git('branch', '--show-current')).toBe('orq/limpia');
    expect(git('stash', 'list')).toContain('orquestador: Mi flujo');
    expect(await fs.stat(join(work, 'pendiente.txt')).then(() => true, () => false)).toBe(false);
  });

  it('[R97.6] con HEAD suelto no arranca y dice por qué', SLOW, async () => {
    await open();
    git('checkout', '-q', '--detach');
    expect(await h.invoke(CHANNELS.startRun, { diagramId: 'flujo', order: 'x' })).toMatchObject({ ok: false, error: { code: 'git-guard', message: expect.stringMatching(/HEAD suelto/) } });
  });

  it('[R97.6] una carpeta sin repositorio se ejecuta como siempre, sin run.git ni regla', SLOW, async () => {
    await open(false);
    expect(val<{ state: GitState }>(await h.invoke(CHANNELS.gitGuard, { diagramId: 'flujo' })).state.repo).toBe(false);
    const events = await run();
    expect(events.some((x) => x.type === 'run.git')).toBe(false);
    expect(systems.some((s) => s.includes('## Rama de git'))).toBe(false);
  });

  it('[R97.1] con el motor simulado no se mira ni se toca git', SLOW, async () => {
    await open();
    val(await h.invoke(CHANNELS.saveSettings, { ...defaultSettings(), supervisorReview: false, engine: 'simulated' }));
    expect(val<{ state: GitState }>(await h.invoke(CHANNELS.gitGuard, { diagramId: 'flujo' })).state.repo).toBe(false);
    const events = await run();
    expect(events.some((x) => x.type === 'run.git')).toBe(false);
    expect(git('branch', '--show-current')).toBe('main');
    expect(git('branch', '--list')).toBe('* main');
  });

  it('[R97.12] Claude recibe la regla en su prompt tal como la compone core', () => {
    const rule = branchRule('feature/x');
    expect(buildSystemPrompt(newAgent('dev', 'Dev'), [], [], undefined, undefined, { git: rule })).toContain(rule);
    expect(buildSystemPrompt(newAgent('dev', 'Dev'), [], [])).not.toContain('## Rama de git');
  });
});
