import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { portsOf } from './ports';
import { MockAgent, MockDecider, Orchestrator, type Diagram, type GitBranchInfo, type GitState, type RemoteRepo, type ReviewDraft, type ReviewHost, type ReviewInfo, type RunEvent, type VersionControl } from '@orquestador/core';
import { ProjectStore } from '@orquestador/store';
import { GitService, RunService } from '../src';

const D: Diagram = {
  id: 'd',
  name: 'Mi flujo',
  schemaVersion: 1,
  nodes: [{ id: 'entry', kind: 'entry' }, { id: 'a', kind: 'agent', agentId: 'a' }, { id: 'output', kind: 'output' }],
  edges: [{ id: 'e1', from: 'entry', to: 'a' }, { id: 'e2', from: 'a', to: 'output' }],
};
const sha = (n: number) => String(n).repeat(40).slice(0, 40);

/** Repositorio de mentira con lo justo: ramas, un HEAD que avanza y los tramos entre commits. */
class FakeRepo implements VersionControl {
  calls: string[] = [];
  head = 1;
  current = 'main';
  names = ['main', 'develop', 'vieja'];
  dirty = 0;
  fail?: string;
  remote?: string;
  /** Ramas locales que ya siguen a una remota. */
  pushed: string[] = [];
  remoteUrl = async () => this.remote;
  async state(): Promise<GitState> {
    return { repo: true, branch: this.current, commit: sha(this.head).slice(0, 7), head: sha(this.head), dirty: this.dirty, branches: [...this.names] };
  }
  async createBranch(name: string, from?: string) {
    this.calls.push(`create ${name}${from ? ` from ${from}` : ''}`);
    this.names.push(name);
    this.current = name;
  }
  async stash(label: string) {
    this.calls.push(`stash ${label}`);
    this.dirty = 0;
    return true;
  }
  async branches(): Promise<GitBranchInfo[]> {
    return [...this.names.map((name) => ({ name, sha: sha(this.head), ...(name === this.current ? { current: true } : {}), ...(this.pushed.includes(name) ? { upstream: `origin/${name}`, ahead: 0, behind: 0 } : {}) })), { name: 'origin/main', sha: sha(1), remote: true }];
  }
  async history() {
    return Array.from({ length: this.head }, (_, i) => ({ sha: sha(this.head - i), parents: this.head - i > 1 ? [sha(this.head - i - 1)] : [], subject: `c${this.head - i}`, author: 'a', date: '2026-11-11T09:00:00Z', refs: [] }));
  }
  async changes() {
    return this.dirty > 0 ? [{ path: 'a.txt', status: 'modified' as const }] : [];
  }
  async diff(file: string) {
    return `+${file}`;
  }
  async stashes() {
    return [];
  }
  async range(from: string, to: string) {
    this.calls.push(`range ${from[0]}..${to[0]}`);
    const out: string[] = [];
    for (let n = Number(to[0]); n > Number(from[0]); n--) out.push(sha(n));
    return out;
  }
  private async done(what: string) {
    this.calls.push(what);
    if (this.fail) throw new Error(this.fail);
  }
  switchBranch = async (name: string) => {
    await this.done(`switch ${name}`);
    this.current = name;
  };
  commit = async (message: string) => {
    await this.done(`commit ${message}`);
    this.head++;
    this.dirty = 0;
    return sha(this.head).slice(0, 7);
  };
  push = () => this.done('push');
  pull = () => this.done('pull');
  fetch = () => this.done('fetch');
  merge = (name: string) => this.done(`merge ${name}`);
  deleteBranch = async (name: string) => {
    await this.done(`delete ${name}`);
    this.names = this.names.filter((n) => n !== name);
  };
  stashPop = (index: number) => this.done(`pop ${index}`);
}

let dir: string;
let store: ProjectStore;
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'orq-gitsvc-'));
  store = await ProjectStore.create(dir, { name: 'p' });
  await store.diagrams.save(D);
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

/** Un servicio cuyo agente hace `commits` commits mientras trabaja. */
function service(repo: FakeRepo, commits = 0, branches: { branch: string; via: 'command'; created: true }[] = []) {
  const adapter = {
    async *run() {
      repo.head += commits;
      for (const b of branches) yield { type: 'branch', ...b };
      yield { type: 'result', text: 'ok' };
    },
  };
  return new RunService({ ...portsOf(store), git: repo, repo }, new Orchestrator({ getAdapter: () => adapter as never, decider: new MockDecider() }));
}
async function finish(svc: RunService, runId: string) {
  await svc.memoryProposed(runId);
  // Lo que quedó en disco: `run.git.ended` se añade con el registro ya cerrado.
  return portsOf(store).runs.readEvents(runId);
}

describe('SPEC-098 · qué trabajo creó cada rama y cada commit', () => {
  it('[R98.4] la ejecución apunta su commit de partida y, al terminar, en cuál quedó; todo en su meta', async () => {
    const repo = new FakeRepo();
    const svc = service(repo, 2, [{ branch: '001-naves', via: 'command', created: true }]);
    const { runId } = await svc.start({ diagramId: 'd', order: 'x' });
    const events = await finish(svc, runId);
    const started = events.find((e): e is Extract<RunEvent, { type: 'run.git' }> => e.type === 'run.git')!;
    expect(started).toMatchObject({ created: true, from: 'main', sha: sha(1) });
    expect(events.at(-1)).toMatchObject({ type: 'run.git.ended', branch: started.branch, sha: sha(3) });
    expect(events.findIndex((e) => e.type === 'run.finished')).toBeLessThan(events.length - 1);
    const meta = (await svc.list()).find((r) => r.runId === runId)!;
    expect(meta.git).toEqual({ branch: started.branch, created: true, fromSha: sha(1), toSha: sha(3), branches: ['001-naves'] });
  });

  it('[R98.5] el visor dice qué trabajo creó cada rama y qué commits hizo; lo demás no lleva nada', async () => {
    const repo = new FakeRepo();
    const svc = service(repo, 2, [{ branch: '001-naves', via: 'command', created: true }]);
    const { runId } = await svc.start({ diagramId: 'd', order: 'x' });
    await finish(svc, runId);
    const branch = repo.current;
    const overview = (await svc.git!.overview())!;
    expect(overview.origins).toEqual({ [branch]: { runId, name: 'Mi flujo' }, '001-naves': { runId, name: 'Mi flujo' } });
    expect(overview.branches.find((b) => b.current)!.name).toBe(branch);
    expect(overview.running).toBe(0);
    repo.head++; // un commit hecho a mano después
    const history = await svc.git!.history(50);
    expect(history.commits.map((c) => c.subject)).toEqual(['c4', 'c3', 'c2', 'c1']);
    expect(history.origins).toEqual({ [sha(3)]: { runId, name: 'Mi flujo' }, [sha(2)]: { runId, name: 'Mi flujo' } });
    // El tramo de cada ejecución se calcula una sola vez.
    await svc.git!.history(50);
    expect(repo.calls.filter((c) => c.startsWith('range'))).toEqual(['range 1..3']);
  });

  it('[R98.5] una ejecución que no hizo commits no se queda con ninguno, y si dos comparten un commit es de la primera', async () => {
    const repo = new FakeRepo();
    repo.current = 'feature/x';
    repo.names.push('feature/x');
    const svc = service(repo, 0);
    const quiet = await svc.start({ diagramId: 'd', order: 'x' });
    await finish(svc, quiet.runId);
    expect((await svc.git!.history(50)).origins).toEqual({});
    const git = new GitService(repo, { list: async () => [meta('nueva', '2026-11-11T10:00:00Z', 1, 4), meta('vieja', '2026-11-11T09:00:00Z', 1, 3)], appendEvent: async () => undefined }, () => 0, () => new Set());
    repo.head = 4;
    const origins = (await git.history(50)).origins;
    expect(origins[sha(4)]).toEqual({ runId: 'nueva', name: 'D' });
    expect(origins[sha(3)]).toEqual({ runId: 'vieja', name: 'D' });
    expect(origins[sha(2)]).toEqual({ runId: 'vieja', name: 'D' });
  });
});

const meta = (runId: string, startedAt: string, from: number, to: number) => ({ schemaVersion: 1, runId, diagramId: 'd', diagramName: 'D', startedAt, status: 'succeeded' as const, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, eventCount: 0, git: { branch: 'x', fromSha: sha(from), toSha: sha(to) } });

describe('SPEC-098 · acciones de git', () => {
  const svcOf = (repo: FakeRepo, running = 0) => new GitService(repo, { list: async () => [], appendEvent: async () => undefined }, () => running, () => new Set());

  it('[R98.6] cada acción se comprueba, se hace y devuelve cómo queda todo', async () => {
    const repo = new FakeRepo();
    const git = svcOf(repo);
    expect((await git.act({ kind: 'create', name: 'feature/y', from: 'develop' })).state.branch).toBe('feature/y');
    repo.dirty = 1;
    const after = await git.act({ kind: 'commit', message: 'hola' });
    expect(after.changes).toEqual([]);
    await git.act({ kind: 'push' });
    await git.act({ kind: 'fetch' });
    await git.act({ kind: 'pull' });
    await git.act({ kind: 'merge', name: 'develop' });
    await git.act({ kind: 'switch', name: 'main' });
    expect((await git.act({ kind: 'delete', name: 'vieja' })).branches.some((b) => b.name === 'vieja')).toBe(false);
    repo.dirty = 1;
    await git.act({ kind: 'stash', label: 'mío' });
    await git.act({ kind: 'stash-pop', index: 0 });
    expect(repo.calls).toEqual(['create feature/y from develop', 'commit hola', 'push', 'fetch', 'pull', 'merge develop', 'switch main', 'delete vieja', 'stash mío', 'pop 0']);
    expect(await git.diff('a.txt')).toBe('+a.txt');
  });

  it('[R98.7] lo que no se puede hacer no llega a git y dice por qué; un fallo de git también se explica', async () => {
    const repo = new FakeRepo();
    const git = svcOf(repo);
    await expect(git.act({ kind: 'delete', name: 'main' })).rejects.toMatchObject({ code: 'git-guard', message: expect.stringMatching(/en la que estás/) });
    await expect(git.act({ kind: 'delete', name: 'develop' })).rejects.toMatchObject({ message: expect.stringMatching(/rama protegida/) });
    await expect(git.act({ kind: 'commit', message: 'x' })).rejects.toMatchObject({ message: expect.stringMatching(/No hay cambios que guardar/) });
    expect(repo.calls).toEqual([]);
    repo.fail = 'No se pudo subir main: sin credenciales';
    await expect(git.act({ kind: 'push' })).rejects.toMatchObject({ code: 'git-guard', message: 'No se pudo subir main: sin credenciales' });
  });

  it('[R98.8] con una ejecución en marcha no se cambia de rama, pero se puede hacer commit y subir', async () => {
    const repo = new FakeRepo();
    repo.dirty = 1;
    const git = svcOf(repo, 1);
    expect((await git.overview())!.running).toBe(1);
    await expect(git.act({ kind: 'switch', name: 'develop' })).rejects.toMatchObject({ message: expect.stringMatching(/Hay una ejecución en marcha/) });
    await expect(git.act({ kind: 'stash' })).rejects.toMatchObject({ message: expect.stringMatching(/Hay una ejecución en marcha/) });
    await git.act({ kind: 'commit', message: 'a medias' });
    await git.act({ kind: 'push' });
    expect(repo.calls).toEqual(['commit a medias', 'push']);
  });

  it('[R98.9] una carpeta sin repositorio no tiene nada que enseñar', async () => {
    const repo = new FakeRepo();
    repo.state = async () => ({ repo: false, dirty: 0, branches: [] });
    expect(await svcOf(repo).overview()).toBeNull();
    const plain = new RunService(portsOf(store), new Orchestrator({ getAdapter: () => new MockAgent({ a: { output: 'ok' } }), decider: new MockDecider() }));
    expect(plain.git).toBeUndefined();
  });
});

describe('SPEC-099 · PR y MR en el servicio', () => {
  const open: ReviewInfo = { number: 31, title: 'Menú', state: 'open', head: 'feature/x', base: 'develop', url: 'https://github.com/Fixerfox/app/pull/31' };
  function setup(opts: { remote?: string; via?: 'cli' | 'token'; listError?: string; createError?: string } = {}) {
    const repo = new FakeRepo();
    if (opts.remote !== undefined) repo.remote = opts.remote;
    repo.names.push('feature/x', 'feature/y', 'local');
    repo.current = 'feature/y';
    repo.pushed = ['main', 'develop', 'feature/x', 'feature/y'];
    const drafts: ReviewDraft[] = [];
    const asked: RemoteRepo[] = [];
    const host: ReviewHost = {
      list: async () => {
        if (opts.listError) throw new Error(opts.listError);
        return [open];
      },
      create: async (d) => {
        if (opts.createError) throw new Error(opts.createError);
        drafts.push(d);
        return { number: 32, title: d.title, state: d.draft ? 'draft' : 'open', head: d.head, base: d.base };
      },
    };
    const git = new GitService(repo, { list: async () => [], appendEvent: async () => undefined }, () => 0, () => new Set(), async (r) => {
      asked.push(r);
      return opts.via ? { host, via: opts.via } : {};
    });
    return { git, drafts, asked };
  }
  const GH = 'https://github.com/Fixerfox/app.git';

  it('[R99.7] da el proveedor, el proyecto, cómo está conectado, las revisiones y el destino propuesto', async () => {
    const { git, asked } = setup({ remote: GH, via: 'cli' });
    expect(await git.reviews()).toEqual({ provider: 'github', word: 'PR', host: 'github.com', project: 'Fixerfox/app', base: 'develop', via: 'cli', reviews: [open] });
    expect(asked).toEqual([{ provider: 'github', host: 'github.com', path: 'Fixerfox/app', name: 'app' }]);
    expect(await setup({ remote: 'git@gitlab.com:g/s/app.git', via: 'token' }).git.reviews()).toMatchObject({ provider: 'gitlab', word: 'MR', project: 'g/s/app', via: 'token' });
  });

  it('[R99.7] sin origin, o con uno que no es GitHub ni GitLab, no hay nada; sin conexión lo dice; si la lista falla, da el motivo', async () => {
    expect(await setup().git.reviews()).toBeNull();
    expect(await setup({ remote: 'https://bitbucket.org/a/b.git', via: 'cli' }).git.reviews()).toBeNull();
    const off = await setup({ remote: GH }).git.reviews();
    expect(off).toEqual({ provider: 'github', word: 'PR', host: 'github.com', project: 'Fixerfox/app', base: 'develop', reviews: [] });
    expect(off!.via).toBeUndefined();
    expect(await setup({ remote: GH, via: 'token', listError: 'github.com rechazó la petición de las PR: el token no vale o no tiene permiso.' }).git.reviews()).toMatchObject({ via: 'token', reviews: [], error: expect.stringMatching(/el token no vale/) });
    // Sin quien conecte (un proyecto sin esa pieza) tampoco hay nada.
    const bare = new FakeRepo();
    bare.remote = GH;
    expect(await new GitService(bare, { list: async () => [], appendEvent: async () => undefined }, () => 0, () => new Set()).reviews()).toBeNull();
  });

  it('[R99.9] abrir una revisión comprueba antes de llamar fuera y devuelve la creada', async () => {
    const { git, drafts } = setup({ remote: GH, via: 'cli' });
    expect(await git.createReview({ title: '  Opciones  ', body: '  ', head: 'feature/y', base: 'develop' })).toEqual({ number: 32, title: 'Opciones', state: 'open', head: 'feature/y', base: 'develop' });
    expect(drafts).toEqual([{ title: 'Opciones', head: 'feature/y', base: 'develop' }]);
    await expect(git.createReview({ title: 'x', head: 'local', base: 'develop' })).rejects.toMatchObject({ code: 'git-guard', message: expect.stringMatching(/todavía no está subida/) });
    await expect(git.createReview({ title: 'x', head: 'feature/x', base: 'develop' })).rejects.toMatchObject({ message: expect.stringMatching(/Ya hay una PR abierta.*#31/) });
    await expect(git.createReview({ title: 'x', head: 'feature/y', base: 'feature/y' })).rejects.toMatchObject({ message: expect.stringMatching(/son la misma/) });
    expect(drafts).toHaveLength(1);
    await expect(setup({ remote: GH }).git.createReview({ title: 'x', head: 'feature/y', base: 'develop' })).rejects.toMatchObject({ message: expect.stringMatching(/No hay conexión con github\.com: inicia sesión con gh o guarda un token/) });
    await expect(setup().git.createReview({ title: 'x', head: 'feature/y', base: 'develop' })).rejects.toMatchObject({ message: expect.stringMatching(/no tiene un origin de GitHub ni de GitLab/) });
    await expect(setup({ remote: GH, via: 'cli', createError: 'sin permiso' }).git.createReview({ title: 'x', head: 'feature/y', base: 'develop' })).rejects.toMatchObject({ message: 'No se pudo abrir la PR: sin permiso' });
  });
});
