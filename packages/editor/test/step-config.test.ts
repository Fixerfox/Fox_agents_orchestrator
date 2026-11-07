import { describe, expect, it } from 'vitest';
import { EditorSession, createDiagram, extraCount, resetStepPatch, stepOverrides } from '../src';

const P = { x: 0, y: 0 };
function step() {
  const s = new EditorSession(createDiagram('d', 'D'));
  const id = s.addNode({ kind: 'agent', agentId: 'pix', position: P });
  const node = () => s.getSnapshot().level.nodes.find((n) => n.id === id)!;
  return { s, id, node };
}

describe('SPEC-066 · lo cambiado en un paso (editor)', () => {
  it('[R66.7] stepOverrides solo cuenta modelo, confirmar y conocimiento; nombre y tarea no', () => {
    const { s, id, node } = step();
    s.updateNode(id, { label: 'Sprites', task: 'Pinta' });
    expect(stepOverrides(node())).toEqual([]);
    s.updateNode(id, { model: 'claude-opus-5-5', confirm: true, extra: { skillIds: ['a'], contextIds: ['b', 'c'] } });
    expect(stepOverrides(node())).toEqual(['model', 'confirm', 'extra']);
    expect(extraCount(node().extra)).toBe(3);
    expect(extraCount(undefined)).toBe(0);
  });

  it('[R66.7] un nodo que no es agente no tiene nada que sobrescribir', () => {
    const s = new EditorSession(createDiagram('d', 'D'));
    const id = s.addNode({ kind: 'router', position: P });
    const n = s.getSnapshot().level.nodes.find((x) => x.id === id)!;
    expect(stepOverrides(n)).toEqual([]);
    expect(resetStepPatch(n)).toBeUndefined();
  });

  it('[R66.4] resetStepPatch devuelve el paso a su agente en un solo paso de historial y se puede deshacer', () => {
    const { s, id, node } = step();
    expect(resetStepPatch(node())).toBeUndefined();
    s.updateNode(id, { task: 'Pinta', model: 'claude-opus-5-5', confirm: true, extra: { mcpIds: ['m'] } });
    s.updateNode(id, resetStepPatch(node())!);
    expect(stepOverrides(node())).toEqual([]);
    expect(node().task).toBe('Pinta');
    s.undo();
    expect(stepOverrides(node())).toEqual(['model', 'confirm', 'extra']);
  });
});
