import { describe, expect, it } from 'vitest';
import { MockAgent, MockDecider, Orchestrator, type Diagram, type KnowledgeExtra } from '@orquestador/core';
import { EditorSession, computeProblems, createDiagram, deriveLive, isRequired, knowledgeKey, setRequired } from '../src';

const E = { id: 'entry', kind: 'entry' as const };
const O = { id: 'output', kind: 'output' as const };
const flow = (extra?: KnowledgeExtra, task?: string): Diagram => ({
  id: 'd',
  name: 'D',
  schemaVersion: 1,
  nodes: [E, { id: 'a', kind: 'agent', agentId: 'a', ...(extra ? { extra } : {}), ...(task ? { task } : {}) }, O],
  edges: [
    { id: 'e1', from: 'entry', to: 'a' },
    { id: 'e2', from: 'a', to: 'output' },
  ],
});
const events = async (d: Diagram, ignoreRequired = 0) => {
  const orch = new Orchestrator({ getAdapter: () => new MockAgent({ a: { ignoreRequired } }), decider: new MockDecider(), sleep: async () => {}, newRunId: () => 'r' });
  return (await orch.start(d, 'hola').result).events;
};

describe('SPEC-036 · obligatorio en el editor', () => {
  it('[R36.4] setRequired solo marca lo que está en su lista, deja el resultado limpio y se puede desmarcar', () => {
    const base: KnowledgeExtra = { skillIds: ['trazo'], mcpIds: ['pixel'] };
    expect(setRequired(base, 'skillIds', 'trazo', true)).toEqual({ skillIds: ['trazo'], mcpIds: ['pixel'], required: { skillIds: ['trazo'] } });
    expect(setRequired(base, 'skillIds', 'otra', true)).toEqual(base);
    const on = setRequired(setRequired(base, 'skillIds', 'trazo', true), 'mcpIds', 'pixel', true);
    expect(isRequired(on, 'mcpIds', 'pixel')).toBe(true);
    expect(setRequired(on, 'skillIds', 'trazo', false)).toEqual({ skillIds: ['trazo'], mcpIds: ['pixel'], required: { mcpIds: ['pixel'] } });
    expect(setRequired(setRequired(base, 'skillIds', 'trazo', true), 'skillIds', 'trazo', false)).toEqual(base);
    expect(knowledgeKey('mcpIds', 'pixel')).toBe('mcp:pixel');
  });

  it('[R36.4] quitar la ficha del paso o del diagrama quita también lo obligatorio, y se deshace', () => {
    const s = new EditorSession(createDiagram('d', 'D'));
    const a = s.addNode({ kind: 'agent', agentId: 'pix', position: { x: 0, y: 0 } });
    s.updateNode(a, { extra: { skillIds: ['trazo', 'paleta'], required: { skillIds: ['trazo'] } } });
    expect(s.getSnapshot().level.nodes.find((n) => n.id === a)!.extra).toEqual({ skillIds: ['trazo', 'paleta'], required: { skillIds: ['trazo'] } });
    // se quita «trazo» dejando el resto como estaba (con su `required` viejo): se limpia
    s.updateNode(a, { extra: { skillIds: ['paleta'], required: { skillIds: ['trazo'] } } });
    expect(s.getSnapshot().level.nodes.find((n) => n.id === a)!.extra).toEqual({ skillIds: ['paleta'] });
    s.undo();
    expect(s.getSnapshot().level.nodes.find((n) => n.id === a)!.extra?.required).toEqual({ skillIds: ['trazo'] });
    s.setDiagramExtra({ contextIds: ['guia'], required: { contextIds: ['guia'] } });
    expect(s.getSnapshot().diagram.extra).toEqual({ contextIds: ['guia'], required: { contextIds: ['guia'] } });
    s.setDiagramExtra({ contextIds: [], required: { contextIds: ['guia'] } });
    expect(s.getSnapshot().diagram).not.toHaveProperty('extra');
  });

  it('[R36.15] un paso con conocimiento añadido y sin tarea da un aviso que no impide ejecutar', () => {
    const w = computeProblems(flow({ skillIds: ['trazo'] }), []);
    expect(w.all).toEqual([expect.objectContaining({ code: 'extra-without-task', nodeId: 'a', severity: 'warning' })]);
    expect(w.warningOnly).toEqual({ a: true });
    expect(w.runnable).toBe(true);
    expect(w.errors).toBe(0);
    expect(computeProblems(flow({ skillIds: ['trazo'] }, 'Genera las tareas'), []).all).toEqual([]);
    expect(computeProblems(flow(), []).all).toEqual([]);
    expect(computeProblems(flow({ contextIds: [] }), []).all).toEqual([]);
  });

  it('[R36.15] también avisa dentro de un bucle', () => {
    const d = flow();
    d.nodes[1] = {
      id: 'bucle',
      kind: 'loop',
      loop: { mode: 'count', count: 2, maxIterations: 2, body: { id: 'in', name: 'in', schemaVersion: 1, nodes: [E, { id: 'x', kind: 'agent', agentId: 'x', extra: { mcpIds: ['m'] } }, O], edges: [{ id: 'i1', from: 'entry', to: 'x' }, { id: 'i2', from: 'x', to: 'output' }] } },
    } as Diagram['nodes'][number];
    d.edges = [{ id: 'e1', from: 'entry', to: 'bucle' }, { id: 'e2', from: 'bucle', to: 'output' }];
    const p = computeProblems(d, []);
    expect(p.all.map((x) => x.code)).toContain('extra-without-task');
    expect(p.runnable).toBe(true);
  });

  it('[R36.18] el estado en vivo guarda, por paso, lo incluido, usado o que faltó en el último intento', async () => {
    const extra: KnowledgeExtra = { skillIds: ['trazo'], contextIds: ['guia'], required: { skillIds: ['trazo'] } };
    const ok = deriveLive(await events(flow(extra)));
    expect(ok.knowledge).toEqual({ a: { 'skill:trazo': 'included' } });
    // un primer intento que falla y un segundo que cumple: se ve el último
    const retry = deriveLive(await events(flow(extra), 1));
    expect(retry.knowledge).toEqual({ a: { 'skill:trazo': 'included' } });
    // el que se queda sin cumplir enseña «falta»
    const gone = deriveLive(await events(flow(extra), 99));
    expect(gone.knowledge).toEqual({ a: { 'skill:trazo': 'missing' } });
    expect(deriveLive([]).knowledge).toEqual({});
  });
});
