import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockDecider, Orchestrator, type Diagram, type RunEvent } from '@orquestador/core';
import { ProjectStore } from '@orquestador/store';
import { RunService } from '../src';

const D: Diagram = {
  id: 'd',
  name: 'D',
  schemaVersion: 1,
  nodes: [{ id: 'entry', kind: 'entry' }, { id: 'a', kind: 'agent', agentId: 'a' }, { id: 'b', kind: 'agent', agentId: 'b' }, { id: 'output', kind: 'output' }],
  edges: [
    { id: 'e1', from: 'entry', to: 'a' },
    { id: 'e2', from: 'a', to: 'b' },
    { id: 'e3', from: 'b', to: 'output' },
  ],
  deliverable: { items: [{ kind: 'links' }] },
};

let dir: string;
let store: ProjectStore;
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'orq-del-'));
  store = await ProjectStore.create(dir, { name: 'p' });
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

function service() {
  let failB = true;
  const adapter = {
    async *run(req: { agentId: string }) {
      if (req.agentId === 'b' && failB) throw Object.assign(new Error('se cayó'), { retriable: false });
      yield { type: 'result', text: `hecho ${req.agentId}`, files: [`${req.agentId}.txt`] };
    },
  };
  const orch = new Orchestrator({ getAdapter: () => adapter as never, decider: new MockDecider(), retry: { maxAttempts: 1, baseDelayMs: 0 } } as never);
  return { svc: new RunService(store, orch), fix: () => void (failB = false) };
}
const started = async (svc: RunService, runId: string) =>
  (await svc.subscribe(runId, 1, () => {})).backlog.find((e): e is Extract<RunEvent, { type: 'run.started' }> => e.type === 'run.started')!;

describe('SPEC-046 · entregable en el servicio de ejecución', () => {
  it('[R46.11] acepta un entregable solo para esta ejecución y rechaza uno no válido', async () => {
    await store.diagrams.save(D);
    const { svc, fix } = service();
    fix();
    const one = { items: [{ kind: 'summary' as const }], fileName: 'resumen' };
    const { runId } = await svc.start({ diagramId: 'd', order: 'x', deliverable: one });
    await svc.settled(runId);
    expect((await started(svc, runId)).deliverable).toEqual(one);
    expect((await svc.listOutput(runId)).map((f) => f.path)).toContain('resumen.md');
    expect((await svc.readOutput(runId, 'resumen.md')).text).toContain('## Resumen');
    // El diagrama guardado no cambia.
    expect((await store.diagrams.load('d')).deliverable).toEqual(D.deliverable);
    await expect(svc.start({ diagramId: 'd', order: 'x', deliverable: { items: [] } })).rejects.toMatchObject({ code: 'bad-request' });
  });

  it('[R46.11] al reanudar usa el entregable de la ejecución anterior', async () => {
    await store.diagrams.save(D);
    const { svc, fix } = service();
    const only = { items: [{ kind: 'links' as const }, { kind: 'custom' as const, title: 'Notas', instructions: 'n' }] };
    const first = await svc.start({ diagramId: 'd', order: 'x', deliverable: only });
    await svc.settled(first.runId);
    fix();
    const second = await svc.resumeRun(first.runId);
    await svc.settled(second.runId);
    expect((await started(svc, second.runId)).deliverable).toEqual(only);
    const md = (await svc.readOutput(second.runId, 'entregable.md')).text;
    expect(md).toContain('`a.txt`');
    expect(md).toContain('`b.txt`');
    expect(md).toContain('## Notas');
  });
});
