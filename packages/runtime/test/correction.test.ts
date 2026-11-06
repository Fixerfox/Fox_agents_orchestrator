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
  nodes: [
    { id: 'entry', kind: 'entry' },
    { id: 'a', kind: 'agent', agentId: 'a', label: 'Analista' },
    { id: 'b', kind: 'agent', agentId: 'b', label: 'Builder' },
    { id: 'c', kind: 'agent', agentId: 'c', label: 'Cierre' },
    { id: 'output', kind: 'output' },
  ],
  edges: [
    { id: 'e1', from: 'entry', to: 'a' },
    { id: 'e2', from: 'a', to: 'b' },
    { id: 'e3', from: 'b', to: 'c' },
    { id: 'e4', from: 'c', to: 'output' },
  ],
};
let dir: string;
let store: ProjectStore;
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'orq-fix-'));
  store = await ProjectStore.create(dir, { name: 'p' });
  await store.diagrams.save(D);
  await fs.writeFile(join(dir, 'captura.md'), '# captura');
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

function service(decider = new MockDecider()) {
  const agent = new MockAgent({ a: { output: 'plan' }, b: { output: 'tareas' }, c: { output: 'web' } });
  return { agent, decider, svc: new RunService(portsOf(store), new Orchestrator({ getAdapter: () => agent, decider })) };
}

describe('SPEC-053 · corregir en el servicio de ejecución', () => {
  it('[R53.11] propone un paso y corrige: ejecución nueva enlazada que reutiliza lo anterior', async () => {
    const { svc, agent, decider } = service(new MockDecider({ blame: () => ({ nodeId: 'b', reason: 'las tareas' }) }));
    const first = await svc.start({ diagramId: 'd', order: 'pedido' });
    await svc.settled(first.runId);
    const prop = await svc.proposeCorrection(first.runId, '  faltan tareas  ');
    expect(prop.candidates).toEqual([{ nodeId: 'a', label: 'Analista' }, { nodeId: 'b', label: 'Builder' }, { nodeId: 'c', label: 'Cierre' }]);
    expect(prop.proposal).toEqual({ nodeId: 'b', reason: 'las tareas' });
    expect(decider.blameCalls[0]!.feedback).toBe('faltan tareas');
    expect((await svc.proposeCorrection(first.runId, 'x', 'c')).proposal.nodeId).toBe('c');

    const second = await svc.correctRun(first.runId, { text: 'Añade la US3', nodeId: 'b', files: ['captura.md'] });
    await svc.settled(second.runId);
    expect(agent.callsOf('a')).toHaveLength(1);
    expect(agent.callsOf('b')).toHaveLength(2);
    expect(agent.callsOf('c')).toHaveLength(2);
    const input = agent.callsOf('b')[1]!.input;
    expect(input.text).toContain('### Lo que hay que corregir\n\nAñade la US3');
    expect(input.text).toContain('### Tu entrega anterior\n\ntareas');
    expect(input.files).toContain('captura.md');
    const metas = await svc.list();
    expect(metas.find((m) => m.runId === second.runId)).toMatchObject({ correctedFrom: first.runId, status: 'succeeded' });
    expect(metas.find((m) => m.runId === first.runId)!.correctedBy).toEqual([second.runId]);
    const { backlog } = await svc.subscribe(second.runId, 1, () => {});
    expect(backlog.find((e) => e.type === 'node.reused')).toMatchObject({ nodeId: 'a', fromRunId: first.runId });
    // Se puede volver a corregir la misma: se añade a la lista.
    const third = await svc.correctRun(first.runId, { text: 'Otra cosa', nodeId: 'c' });
    await svc.settled(third.runId);
    expect((await svc.list()).find((m) => m.runId === first.runId)!.correctedBy).toEqual([second.runId, third.runId]);
    const thirdEvents = (await svc.subscribe(third.runId, 1, () => {})).backlog;
    expect(thirdEvents.filter((e): e is Extract<RunEvent, { type: 'node.reused' }> => e.type === 'node.reused').map((e) => e.nodeId)).toEqual(['a', 'b']);
  });

  it('[R53.11] rechaza sin texto, un paso que no se puede corregir, una ejecución desconocida o en marcha', async () => {
    const { svc } = service();
    const first = await svc.start({ diagramId: 'd', order: 'pedido' });
    await svc.settled(first.runId);
    await expect(svc.correctRun(first.runId, { text: '  ', nodeId: 'b' })).rejects.toMatchObject({ code: 'bad-request' });
    await expect(svc.correctRun(first.runId, { text: 'x', nodeId: 'output' })).rejects.toMatchObject({ code: 'bad-request' });
    await expect(svc.correctRun('nope', { text: 'x', nodeId: 'b' })).rejects.toMatchObject({ code: 'not-found' });
    await expect(svc.proposeCorrection('nope', 'x')).rejects.toMatchObject({ code: 'not-found' });
    // En marcha: un paso que espera la confirmación del usuario.
    const waiting: Diagram = { ...D, id: 'w', nodes: D.nodes.map((n) => (n.id === 'a' ? { ...n, confirm: true } : n)) };
    await store.diagrams.save(waiting);
    const live = await svc.start({ diagramId: 'w', order: 'pedido' });
    await new Promise((r) => setTimeout(r, 20));
    await expect(svc.proposeCorrection(live.runId, 'x')).rejects.toMatchObject({ code: 'bad-request' });
    svc.cancel(live.runId);
    await svc.settled(live.runId);
  });
});
