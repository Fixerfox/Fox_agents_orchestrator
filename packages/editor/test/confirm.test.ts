import { describe, expect, it } from 'vitest';
import { MockAgent, MockDecider, Orchestrator, type RunEvent } from '@orquestador/core';
import { EditorError, addNode, computeProblems, createDiagram, deriveLive, transcriptItems, updateNode } from '../src';

const P = { x: 0, y: 0 };
const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return e instanceof EditorError ? e.code : 'other';
  }
  return undefined;
};

describe('SPEC-043 · confirmar antes de terminar (editor)', () => {
  it('[R43.2] updateNode pone y quita «confirm» solo en agentes', () => {
    const { diagram, id } = addNode(createDiagram('d', 'D'), [], { kind: 'agent', agentId: 'a', position: P });
    const on = updateNode(diagram, [], id, { confirm: true });
    expect(on.nodes.find((n) => n.id === id)!.confirm).toBe(true);
    expect('confirm' in updateNode(on, [], id, { confirm: false }).nodes.find((n) => n.id === id)!).toBe(false);
    const r = addNode(diagram, [], { kind: 'router', position: P });
    expect(code(() => updateNode(r.diagram, [], r.id, { confirm: true }))).toBe('invalid');
    const bad = { ...diagram, nodes: diagram.nodes.map((n) => (n.kind === 'output' ? { ...n, confirm: true } : n)) };
    expect(computeProblems(bad, []).all.map((i) => i.message).join(' ')).toContain('solo los pasos de agente confirman antes de terminar');
  });

  it('[R43.9] la transcripción y el estado en vivo marcan la confirmación', async () => {
    const agents = new MockAgent({ a: { output: '## Resumen para confirmar\nTodo' } });
    const orch = new Orchestrator({ getAdapter: () => agents, decider: new MockDecider() });
    const d = createDiagram('d', 'D');
    const a = addNode(d, [], { kind: 'agent', agentId: 'a', position: P });
    let dd = updateNode(a.diagram, [], a.id, { confirm: true });
    dd = { ...dd, edges: [{ id: 'e1', from: 'entry', to: a.id }, { id: 'e2', from: a.id, to: 'output' }] };
    const h = orch.start(dd, 'x');
    const events: RunEvent[] = [];
    await new Promise<void>((resolve) => {
      h.bus.subscribe((e) => {
        events.push(e);
        if (e.type === 'agent.question') resolve();
      });
    });
    const live = deriveLive(events);
    expect(live.pending).toEqual([expect.objectContaining({ nodeId: a.id, confirm: { round: 1 }, options: ['Aprobar'] })]);
    expect(live.nodeStatus[a.id]).toBe('waiting_input');
    const q = transcriptItems(events, a.id).find((i) => i.kind === 'question');
    expect(q).toMatchObject({ kind: 'question', confirm: { round: 1 }, text: '## Resumen para confirmar\nTodo' });
    h.cancel();
    await h.result;
  });
});
