import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockDecider, Orchestrator, type AgentAdapter, type Diagram } from '@orquestador/core';
import { ProjectStore } from '@orquestador/store';
import { summarizeRun } from '@orquestador/editor';
import { RunService } from '../src';
import { portsOf } from './ports';

/** entrada → router (IA) → a → b → salida */
const D: Diagram = {
  id: 'd',
  name: 'Web',
  schemaVersion: 1,
  nodes: [
    { id: 'entry', kind: 'entry' },
    { id: 'r', kind: 'router', label: 'Elegir', router: { mode: 'ai' } },
    { id: 'a', kind: 'agent', agentId: 'a', label: 'Plan' },
    { id: 'b', kind: 'agent', agentId: 'b', label: 'Obra' },
    { id: 'output', kind: 'output' },
  ],
  edges: [
    { id: 'e1', from: 'entry', to: 'r' },
    { id: 'e2', from: 'r', to: 'a' },
    { id: 'e3', from: 'a', to: 'b' },
    { id: 'e4', from: 'b', to: 'output' },
  ],
};

let dir: string;
let store: ProjectStore;
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'orq-dur-'));
  store = await ProjectStore.create(dir, { name: 'p' });
  await store.diagrams.save(D);
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

/** «b» falla la primera vez (o se queda colgada si `hang`), y cada paso cuesta 0,10 US$. */
function rig() {
  const calls: string[] = [];
  let failB = true;
  const adapter: AgentAdapter = {
    async *run(req) {
      calls.push(req.agentId);
      yield { type: 'usage', inputTokens: 10, outputTokens: 5, costUsd: 0.1 };
      if (req.agentId === 'b' && failB) throw Object.assign(new Error('se cayó'), { retriable: false });
      yield { type: 'result', text: `hecho ${req.agentId}` };
    },
  };
  const decider = new MockDecider();
  const orch = new Orchestrator({ getAdapter: () => adapter, decider, retry: { maxAttempts: 1, baseDelayMs: 0 } } as never);
  return { svc: new RunService(portsOf(store), orch), calls, decider, fix: () => void (failB = false) };
}

describe('SPEC-074 · reanudar en la app', () => {
  it('[R74.3][R74.13] reanudar reutiliza pasos y decisiones, y el Resumen dice cuánto se ahorró', async () => {
    const { svc, calls, decider, fix } = rig();
    const first = await svc.start({ diagramId: 'd', order: 'pedido' });
    await svc.settled(first.runId);
    expect(decider.routeCalls).toHaveLength(1);
    fix();
    calls.length = 0;
    const second = await svc.resumeRun(first.runId);
    await svc.settled(second.runId);
    expect(calls).toEqual(['b']);
    expect(decider.routeCalls).toHaveLength(1);
    const { backlog } = await svc.subscribe(second.runId, 1, () => {});
    const s = summarizeRun(backlog, (id) => id);
    expect(s.reused).toEqual({ steps: 1, decisions: 1, answers: 0, savedUsd: 0.1 });
  });

  it('[R74.11][R74.12] al abrir se ofrecen las interrumpidas de las últimas 72 h, con el último paso que terminó', async () => {
    const { svc } = rig();
    const { runId } = await svc.start({ diagramId: 'd', order: 'pedido' });
    await svc.settled(runId);
    const metaPath = join(store.paths.runDir(runId), 'meta.json');
    const meta = JSON.parse(await fs.readFile(metaPath, 'utf8')) as Record<string, unknown>;
    expect(meta['lastStepKey']).toBe('a#1');
    await fs.writeFile(metaPath, JSON.stringify({ ...meta, status: 'running' }));
    const fresh = rig().svc;
    const now = Date.parse(meta['startedAt'] as string);
    expect(await fresh.interruptedRecent(now + 3_600_000)).toEqual([{ runId, diagramName: 'Web', lastStep: 'Plan' }]);
    expect(await fresh.interruptedRecent(now + 73 * 3_600_000)).toEqual([]);
  });
});
