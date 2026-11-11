import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { portsOf } from './ports';
import { MockAgent, MockDecider, Orchestrator, branchRule, type Diagram, type GitState, type RunEvent, type BranchGuardPort } from '@orquestador/core';
import { ProjectStore } from '@orquestador/store';
import { RunService } from '../src';

const D: Diagram = {
  id: 'd',
  name: 'Mi flujo',
  schemaVersion: 1,
  nodes: [{ id: 'entry', kind: 'entry' }, { id: 'a', kind: 'agent', agentId: 'a' }, { id: 'output', kind: 'output' }],
  edges: [{ id: 'e1', from: 'entry', to: 'a' }, { id: 'e2', from: 'a', to: 'output' }],
};

/** Git de mentira: guarda lo que se le pide y cambia de rama al crear. */
class FakeGit implements BranchGuardPort {
  calls: string[] = [];
  failCreate?: string;
  constructor(public current: GitState) {}
  async state() {
    return structuredClone(this.current);
  }
  async createBranch(name: string, from?: string) {
    this.calls.push(`create ${name}${from ? ` from ${from}` : ''}`);
    if (this.failCreate) throw new Error(this.failCreate);
    this.current = { ...this.current, branch: name, branches: [...this.current.branches, name], ...(from === 'develop' ? { commit: 'dev0001' } : {}) };
  }
  async stash(label: string) {
    this.calls.push(`stash ${label}`);
    this.current = { ...this.current, dirty: 0 };
    return true;
  }
}
const repo = (more: Partial<GitState> = {}): GitState => ({ repo: true, branch: 'feature/x', commit: 'abc1234', dirty: 0, branches: ['main', 'develop', 'feature/x'], ...more });

let dir: string;
let store: ProjectStore;
let agent: MockAgent;
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'orq-rungit-'));
  store = await ProjectStore.create(dir, { name: 'p' });
  await store.diagrams.save(D);
  agent = new MockAgent({ a: { output: 'ok' } });
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

const service = (git?: BranchGuardPort, orch = new Orchestrator({ getAdapter: () => agent, decider: new MockDecider() })) => new RunService({ ...portsOf(store), ...(git ? { git } : {}) }, orch);
async function gitEvent(svc: RunService, runId: string) {
  await svc.settled(runId);
  const { backlog } = await svc.subscribe(runId, 1, () => {});
  return backlog.find((e): e is Extract<RunEvent, { type: 'run.git' }> => e.type === 'run.git');
}

describe('SPEC-097 · la guarda de rama al lanzar', () => {
  it('[R97.9] sin elegir, en una rama de trabajo se sigue en ella: no se toca git y el agente recibe la regla', async () => {
    const git = new FakeGit(repo({ dirty: 2 }));
    const svc = service(git);
    const { runId } = await svc.start({ diagramId: 'd', order: 'x' });
    expect(await gitEvent(svc, runId)).toMatchObject({ branch: 'feature/x', commit: 'abc1234', dirty: 2 });
    expect(git.calls).toEqual([]);
    expect(agent.calls[0]!.git).toBe(branchRule('feature/x'));
  });

  it('[R97.9] sin elegir, en una rama protegida la ejecución crea la suya', async () => {
    const git = new FakeGit(repo({ branch: 'main' }));
    const svc = service(git);
    const { runId } = await svc.start({ diagramId: 'd', order: 'x' });
    const e = await gitEvent(svc, runId);
    expect(e).toMatchObject({ created: true, from: 'main', commit: 'abc1234' });
    expect(e!.branch).toMatch(/^orq\/mi-flujo-\d{8}-\d{4}$/);
    expect(git.calls).toEqual([`create ${e!.branch}`]);
    expect(agent.calls[0]!.git).toBe(branchRule(e!.branch));
  });

  it('[R97.10] con otra base y «apartar», primero se apartan los cambios y luego se crea la rama', async () => {
    const git = new FakeGit(repo({ dirty: 3 }));
    const svc = service(git);
    const { runId } = await svc.start({ diagramId: 'd', order: 'x', git: { mode: 'new', name: 'orq/a', from: 'develop', changes: 'stash' } });
    expect(git.calls).toEqual(['stash orquestador: Mi flujo', 'create orq/a from develop']);
    const e = await gitEvent(svc, runId);
    expect(e).toMatchObject({ branch: 'orq/a', commit: 'dev0001', created: true, from: 'develop', stash: 'orquestador: Mi flujo' });
    expect(e!.dirty).toBeUndefined();
  });

  it('[R97.10] si git falla no arranca y lo explica; con los cambios ya apartados dice cómo recuperarlos', async () => {
    const git = new FakeGit(repo({ dirty: 3 }));
    git.failCreate = 'No se pudo crear la rama orq/a desde develop: conflicto';
    const svc = service(git);
    await expect(svc.start({ diagramId: 'd', order: 'x', git: { mode: 'new', name: 'orq/a', from: 'develop', changes: 'stash' } })).rejects.toMatchObject({
      code: 'git-guard',
      message: expect.stringMatching(/conflicto.*siguen apartados como «orquestador: Mi flujo».*git stash pop/),
    });
    expect(await svc.list()).toEqual([]);
    expect(agent.calls).toEqual([]);
  });

  it('[R97.6][R97.7] un bloqueo o una elección que no vale impiden arrancar con su motivo', async () => {
    const busy = service(new FakeGit(repo({ busy: 'rebase' })));
    await expect(busy.start({ diagramId: 'd', order: 'x' })).rejects.toMatchObject({ code: 'git-guard', message: expect.stringMatching(/un rebase a medias/) });
    const git = new FakeGit(repo());
    const svc = service(git);
    await expect(svc.start({ diagramId: 'd', order: 'x', git: { mode: 'new', name: 'develop', from: 'here' } })).rejects.toMatchObject({ code: 'git-guard', message: expect.stringMatching(/Ya existe una rama «develop»/) });
    expect(git.calls).toEqual([]);
  });

  it('[R97.9] la guarda va lo último: una entrada que no vale no crea ninguna rama', async () => {
    const git = new FakeGit(repo({ branch: 'main' }));
    const svc = service(git);
    await expect(svc.start({ diagramId: 'd', order: '   ' })).rejects.toMatchObject({ code: 'bad-request' });
    await expect(svc.start({ diagramId: 'no-existe', order: 'x' })).rejects.toThrow();
    expect(git.calls).toEqual([]);
  });

  it('[R97.7] con otra ejecución en marcha no se cambia de rama, pero sí se puede seguir en la actual', async () => {
    let release = () => {};
    const slow = {
      async *run() {
        await new Promise<void>((r) => (release = r));
        yield { type: 'result', text: 'ok' };
      },
    };
    const git = new FakeGit(repo());
    const svc = service(git, new Orchestrator({ getAdapter: () => slow as never, decider: new MockDecider() }));
    const first = await svc.start({ diagramId: 'd', order: 'x' });
    await expect(svc.start({ diagramId: 'd', order: 'y', git: { mode: 'new', name: 'orq/b', from: 'here' } })).rejects.toMatchObject({ code: 'git-guard', message: expect.stringMatching(/otra ejecución en marcha/) });
    expect((await svc.gitGuard('d'))!.otherRuns).toBe(1);
    const second = await svc.start({ diagramId: 'd', order: 'y', git: { mode: 'stay' } });
    release();
    await svc.settled(first.runId);
    release();
    await svc.settled(second.runId);
    expect(git.calls).toEqual([]);
  });

  it('[R97.9] reanudar no cambia de rama: apunta en la que se está', async () => {
    let fail = true;
    const adapter = {
      async *run() {
        if (fail) throw Object.assign(new Error('se cayó'), { retriable: false });
        yield { type: 'result', text: 'hecho' };
      },
    };
    const git = new FakeGit(repo({ branch: 'main' }));
    const svc = service(git, new Orchestrator({ getAdapter: () => adapter as never, decider: new MockDecider(), retry: { maxAttempts: 1, baseDelayMs: 0 } } as never));
    const first = await svc.start({ diagramId: 'd', order: 'x' });
    await svc.settled(first.runId);
    expect(git.calls).toHaveLength(1);
    const branch = git.current.branch!;
    fail = false;
    const again = await svc.resumeRun(first.runId);
    const e = await gitEvent(svc, again.runId);
    expect(e).toMatchObject({ branch });
    expect(e!.created).toBeUndefined();
    expect(git.calls).toHaveLength(1);
  });

  it('[R97.15] gitGuard da el estado, el nombre propuesto y las que hay en marcha; sin git, null y todo sigue como antes', async () => {
    const svc = service(new FakeGit(repo({ branch: 'main', branches: ['main'] })));
    const info = await svc.gitGuard('d');
    expect(info).toMatchObject({ state: { repo: true, branch: 'main' }, otherRuns: 0 });
    expect(info!.suggested).toMatch(/^orq\/mi-flujo-\d{8}-\d{4}$/);
    const plain = service();
    expect(await plain.gitGuard('d')).toBeNull();
    const { runId } = await plain.start({ diagramId: 'd', order: 'x' });
    expect(await gitEvent(plain, runId)).toBeUndefined();
    // Una carpeta que no es un repositorio tampoco apunta nada.
    const none = service(new FakeGit({ repo: false, dirty: 0, branches: [] }));
    const r = await none.start({ diagramId: 'd', order: 'x' });
    expect(await gitEvent(none, r.runId)).toBeUndefined();
  });
});
