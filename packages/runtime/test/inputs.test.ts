import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { portsOf } from './ports';
import { MockAgent, MockDecider, Orchestrator, type Diagram, type RunEvent } from '@orquestador/core';
import { ProjectStore } from '@orquestador/store';
import { RunService } from '../src';

const D: Diagram = {
  id: 'd',
  name: 'D',
  schemaVersion: 1,
  nodes: [{ id: 'entry', kind: 'entry' }, { id: 'a', kind: 'agent', agentId: 'a' }, { id: 'b', kind: 'agent', agentId: 'b' }, { id: 'output', kind: 'output' }],
  edges: [{ id: 'e1', from: 'entry', to: 'a' }, { id: 'e2', from: 'a', to: 'b' }, { id: 'e3', from: 'b', to: 'output' }],
};
let dir: string;
let store: ProjectStore;
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'orq-inp-'));
  store = await ProjectStore.create(dir, { name: 'p' });
  await store.diagrams.save(D);
  await fs.writeFile(join(dir, 'brief.md'), '# brief');
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

describe('SPEC-048 · entrada con archivos en el servicio de ejecución', () => {
  it('[R48.5] el primer paso recibe el texto y los archivos; sin texto también vale si hay archivos', async () => {
    const agent = new MockAgent({ a: { output: 'ok' } });
    const svc = new RunService(portsOf(store), new Orchestrator({ getAdapter: () => agent, decider: new MockDecider() }));
    const att = await store.stageAttachment('logo.svg', new Uint8Array([60, 115]));
    const { runId } = await svc.start({ diagramId: 'd', order: '', files: ['brief.md'], attachments: [att.id] });
    await svc.settled(runId);
    expect(agent.callsOf('a')[0]!.input).toEqual({ text: '', files: ['brief.md', `.orquestador/attachments/${att.id}/logo.svg`] });
    const { backlog } = await svc.subscribe(runId, 1, () => {});
    expect(backlog.find((e): e is Extract<RunEvent, { type: 'node.started' }> => e.type === 'node.started' && e.nodeId === 'entry')!.input!.files).toHaveLength(2);
  });

  it('[R48.5] rechaza adjuntos desconocidos, rutas fuera, más de 20 archivos y una entrada vacía', async () => {
    const svc = new RunService(portsOf(store), new Orchestrator({ getAdapter: () => new MockAgent(), decider: new MockDecider() }));
    await expect(svc.start({ diagramId: 'd', order: 'x', attachments: ['no-existe'] })).rejects.toMatchObject({ code: 'bad-request' });
    await expect(svc.start({ diagramId: 'd', order: 'x', files: ['../fuera.md'] })).rejects.toMatchObject({ code: 'bad-request' });
    await expect(svc.start({ diagramId: 'd', order: 'x', files: Array.from({ length: 21 }, () => 'brief.md') })).rejects.toMatchObject({ code: 'bad-request' });
    await expect(svc.start({ diagramId: 'd', order: '  ' })).rejects.toMatchObject({ code: 'bad-request' });
    expect(await svc.list()).toEqual([]);
  });

  it('[R48.5] «Reanudar» reutiliza la misma entrada con sus archivos', async () => {
    let failB = true;
    const seen: { agentId: string; files: string[] }[] = [];
    const adapter = {
      async *run(req: { agentId: string; input: { files: string[] } }) {
        seen.push({ agentId: req.agentId, files: req.input.files });
        if (req.agentId === 'b' && failB) throw Object.assign(new Error('se cayó'), { retriable: false });
        yield { type: 'result', text: `hecho ${req.agentId}` };
      },
    };
    const svc = new RunService(portsOf(store), new Orchestrator({ getAdapter: () => adapter as never, decider: new MockDecider(), retry: { maxAttempts: 1, baseDelayMs: 0 } } as never));
    const first = await svc.start({ diagramId: 'd', order: 'pedido', files: ['brief.md'] });
    await svc.settled(first.runId);
    failB = false;
    const second = await svc.resumeRun(first.runId);
    await svc.settled(second.runId);
    const { backlog } = await svc.subscribe(second.runId, 1, () => {});
    expect(backlog.find((e): e is Extract<RunEvent, { type: 'node.started' }> => e.type === 'node.started' && e.nodeId === 'entry')!.input).toEqual({ text: 'pedido', files: ['brief.md'] });
  });
});
