import { describe, expect, it } from 'vitest';
import { EditorError, EditorSession, computeProblems, createDiagram, t } from '../src';

const P = { x: 0, y: 0 };
const node = (s: EditorSession, id: string) => s.getSnapshot().level.nodes.find((n) => n.id === id)!;
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof EditorError ? e.code : 'other';
  }
  return undefined;
};

describe('SPEC-040 · modelo por paso en el editor', () => {
  it('[R40.2] fija el modelo del paso, «» lo quita, y deshacer/rehacer lo recorren', () => {
    const s = new EditorSession(createDiagram('d', 'D'));
    const id = s.addNode({ kind: 'agent', agentId: 'espec', position: P });
    s.updateNode(id, { model: 'claude-opus-5-5' });
    expect(node(s, id).model).toBe('claude-opus-5-5');
    s.updateNode(id, { model: '' });
    expect(node(s, id)).not.toHaveProperty('model');
    expect(s.undo()).toBe(true);
    expect(node(s, id).model).toBe('claude-opus-5-5');
    expect(s.redo()).toBe(true);
    expect(node(s, id)).not.toHaveProperty('model');
  });

  it('[R40.2] solo en pasos de agente y con un modelo conocido', () => {
    const s = new EditorSession(createDiagram('d', 'D'));
    const id = s.addNode({ kind: 'agent', agentId: 'espec', position: P });
    expect(code(() => s.updateNode(id, { model: 'gpt-x' }))).toBe('invalid');
    expect(code(() => s.updateNode('output', { model: 'claude-opus-5-5' }))).toBe('invalid');
    expect(node(s, id)).not.toHaveProperty('model');
  });

  it('[R40.1] un modelo desconocido en el archivo se explica como problema del paso', () => {
    const d = createDiagram('d', 'D');
    const bad = { ...d, nodes: [...d.nodes, { id: 'a', kind: 'agent' as const, agentId: 'x', label: 'Especificar', model: 'gpt-x' }] };
    const msgs = computeProblems(bad, []).all.map((p) => p.message);
    expect(msgs).toContain('«Especificar»: ese modelo no existe; elige otro en «Modelo»');
    expect(t('insp.model.agent', { model: 'Sonnet 5.5' })).toBe('El del agente (Sonnet 5.5)');
  });
});
