import { describe, expect, it } from 'vitest';
import { validateDiagram } from '@orquestador/core';
import { EditorError, EditorSession, addNode, connect, createDiagram, getLevel, insertOnEdge, setCondition, updateNode } from '../src';

const base = () => createDiagram('d', 'Demo');
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof EditorError ? e.code : 'other';
  }
  return undefined;
};

describe('SPEC-032 · editor', () => {
  it('[R32.1] updateNode fija la tarea de un nodo agente, la cadena vacía la quita y no vale en otros nodos', () => {
    const { diagram, id } = addNode(base(), [], { kind: 'agent', agentId: 'pix', position: { x: 0, y: 0 } });
    const withTask = updateNode(diagram, [], id, { task: 'Dibuja' });
    expect(getLevel(withTask, []).nodes.find((n) => n.id === id)?.task).toBe('Dibuja');
    const cleared = updateNode(withTask, [], id, { task: '  ' });
    expect(getLevel(cleared, []).nodes.find((n) => n.id === id)).not.toHaveProperty('task');
    expect(code(() => updateNode(diagram, [], 'entry', { task: 'x' }))).toBe('invalid');
  });

  it('[R32.8][R32.9] insertOnEdge pone el nodo en el punto medio, conectado a ambos extremos, y quita la conexión original', () => {
    const d = base();
    const edgeId = getLevel(d, []).edges[0]!.id;
    const { diagram, id } = insertOnEdge(d, [], edgeId, { kind: 'agent', agentId: 'rev' });
    const level = getLevel(diagram, []);
    expect(level.edges.map((e) => [e.from, e.to])).toEqual([
      ['entry', id],
      [id, 'output'],
    ]);
    expect(level.edges.some((e) => e.id === edgeId)).toBe(false);
    // entrada (0) y salida (420) no dejan hueco: el nodo va a 280 y la salida se aparta a 560
    expect(level.nodes.find((n) => n.id === id)?.position).toEqual({ x: 280, y: 120 });
    expect(level.nodes.find((n) => n.id === 'output')?.position).toEqual({ x: 560, y: 120 });
    expect(level.nodes.find((n) => n.id === 'entry')?.position).toEqual({ x: 0, y: 120 });
    expect(validateDiagram(diagram)).toEqual([]);
    expect(code(() => insertOnEdge(d, [], 'nope', { kind: 'router' }))).toBe('unknown-edge');
  });

  it('[R32.9] si entre los extremos cabe el nodo, va al punto medio sin mover nada', () => {
    let d = base();
    d = getLevel(d, []) && { ...d, nodes: d.nodes.map((n) => (n.id === 'output' ? { ...n, position: { x: 900, y: 200 } } : n)) };
    const { diagram, id } = insertOnEdge(d, [], getLevel(d, []).edges[0]!.id, { kind: 'router' });
    const level = getLevel(diagram, []);
    expect(level.nodes.find((n) => n.id === id)?.position).toEqual({ x: 450, y: 160 });
    expect(level.nodes.find((n) => n.id === 'output')?.position).toEqual({ x: 900, y: 200 });
  });

  it('[R32.9] la condición de una conexión que sale de un router se conserva en el tramo del router', () => {
    let d = base();
    const r = addNode(d, [], { kind: 'router', position: { x: 100, y: 0 } });
    const a = addNode(r.diagram, [], { kind: 'agent', agentId: 'a', position: { x: 300, y: 0 } });
    d = a.diagram;
    const e = connect(d, [], r.id, a.id);
    d = setCondition(e.diagram, [], e.edgeId, 'si es urgente');
    const ins = insertOnEdge(d, [], e.edgeId, { kind: 'agent', agentId: 'b' });
    const edges = getLevel(ins.diagram, []).edges;
    expect(edges.find((x) => x.from === r.id && x.to === ins.id)?.condition).toBe('si es urgente');
    expect(edges.find((x) => x.from === ins.id && x.to === a.id)?.condition).toBeUndefined();
  });

  it('[R32.8] en la sesión, insertar en una conexión se deshace en un solo paso', () => {
    const s = new EditorSession(base());
    const edgeId = s.getSnapshot().level.edges[0]!.id;
    s.insertOnEdge(edgeId, { kind: 'loop' });
    expect(s.getSnapshot().level.nodes).toHaveLength(3);
    s.undo();
    expect(s.getSnapshot().level.nodes).toHaveLength(2);
    expect(s.getSnapshot().level.edges.map((e) => e.id)).toEqual([edgeId]);
  });
});

describe('SPEC-032 · diferencias por líneas', () => {
  it('[R32.7] marca líneas quitadas, añadidas y comunes en orden', async () => {
    const { lineDiff } = await import('../src');
    expect(lineDiff('a\nb\nc', 'a\nB\nc\nd')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'del', text: 'b' },
      { kind: 'add', text: 'B' },
      { kind: 'same', text: 'c' },
      { kind: 'add', text: 'd' },
    ]);
    expect(lineDiff('', 'nuevo')).toEqual([{ kind: 'add', text: 'nuevo' }]);
    expect(lineDiff('igual', 'igual')).toEqual([{ kind: 'same', text: 'igual' }]);
  });
});

describe('SPEC-032 · ramas en paralelo [R32.36]', () => {
  it('[R32.36] sustituye A → B por ramas en paralelo que desembocan en B, en un solo paso de deshacer', async () => {
    const { EditorSession, createDiagram } = await import('../src');
    const s = new EditorSession(createDiagram('d', 'D'));
    const r = s.insertParallel('entry->output', { branches: [{ agentId: 'fondo' }, { agentId: 'scripts' }, { agentId: 'musica' }] });
    const lvl = s.getSnapshot().level;
    expect(r.ids).toHaveLength(3);
    expect(lvl.edges.some((e) => e.id === 'entry->output')).toBe(false);
    for (const id of r.ids) {
      expect(lvl.edges.some((e) => e.from === 'entry' && e.to === id)).toBe(true);
      expect(lvl.edges.some((e) => e.from === id && e.to === 'output')).toBe(true);
    }
    const ys = r.ids.map((id) => lvl.nodes.find((n) => n.id === id)!.position!.y);
    expect(new Set(ys).size).toBe(3);
    const out = lvl.nodes.find((n) => n.id === 'output')!.position!.x;
    expect(out).toBeGreaterThanOrEqual(lvl.nodes.find((n) => n.id === r.ids[0])!.position!.x + 280);
    expect(s.getSnapshot().problems.runnable).toBe(true);
    s.undo();
    expect(s.getSnapshot().level.edges.map((e) => e.id)).toEqual(['entry->output']);
  });

  it('[R32.36] con agente que une: ramas → Unir (con su tarea) → B; el router conserva la condición en cada tramo', async () => {
    const { EditorSession, createDiagram } = await import('../src');
    const s = new EditorSession(createDiagram('d', 'D'));
    const router = s.addNode({ kind: 'router', position: { x: 200, y: 0 } });
    s.removeSelection({ edges: ['entry->output'] });
    s.connect('entry', router);
    const e = s.connect(router, 'output');
    s.setCondition(e, 'arte');
    const r = s.insertParallel(e, { branches: [{ agentId: 'a' }, { agentId: 'b' }], join: { agentId: 'unir', label: 'Unir', task: 'Junta' } });
    const lvl = s.getSnapshot().level;
    const join = lvl.nodes.find((n) => n.id === r.joinId)!;
    expect(join.task).toBe('Junta');
    expect(lvl.edges.filter((x) => x.to === r.joinId)).toHaveLength(2);
    expect(lvl.edges.some((x) => x.from === r.joinId && x.to === 'output')).toBe(true);
    expect(lvl.edges.filter((x) => x.from === router).map((x) => x.condition)).toEqual(['arte', 'arte']);
  });

  it('[R32.36] pide entre 2 y 8 ramas', async () => {
    const { EditorSession, createDiagram } = await import('../src');
    const s = new EditorSession(createDiagram('d', 'D'));
    expect(() => s.insertParallel('entry->output', { branches: [{ agentId: 'a' }] })).toThrow();
    expect(() => s.insertParallel('entry->output', { branches: Array.from({ length: 9 }, (_, i) => ({ agentId: `a${i}` })) })).toThrow();
  });
});
