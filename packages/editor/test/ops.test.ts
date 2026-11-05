import { describe, expect, it } from 'vitest';
import { validateDiagram, type Diagram } from '@orquestador/core';
import {
  EditorError,
  addNode,
  connect,
  createDiagram,
  disconnect,
  getLevel,
  moveNode,
  removeNode,
  setCondition,
  updateNode,
} from '../src';

const P = { x: 10, y: 20 };
const fresh = (): Diagram => createDiagram('d', 'Demo');
const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return e instanceof EditorError ? e.code : 'other';
  }
  return undefined;
};

describe('ops: creación y borrado [R14.1]', () => {
  it('[R14.1] un diagrama nuevo trae entrada y salida conectadas y es válido', () => {
    const d = fresh();
    expect(d.nodes.map((n) => n.kind)).toEqual(['entry', 'output']);
    expect(d.edges).toHaveLength(1);
    expect(validateDiagram(d)).toEqual([]);
  });

  it('[R14.1] mover y renombrar no cambian el resto y no mutan el original', () => {
    const d = fresh();
    const { diagram, id } = addNode(d, [], { kind: 'agent', agentId: 'a', position: P });
    const moved = moveNode(diagram, [], id, { x: 99, y: 1 });
    const renamed = updateNode(moved, [], id, { label: 'Nuevo' });
    const n = renamed.nodes.find((x) => x.id === id)!;
    expect(n.position).toEqual({ x: 99, y: 1 });
    expect(n.label).toBe('Nuevo');
    expect(diagram.nodes.find((x) => x.id === id)!.position).toEqual(P);
    expect(d.nodes).toHaveLength(2);
  });

  it('[R14.1] borrar un nodo borra sus aristas', () => {
    let d = fresh();
    const r = addNode(d, [], { kind: 'agent', agentId: 'a', position: P });
    d = connect(r.diagram, [], 'entry', r.id).diagram;
    d = connect(d, [], r.id, 'output').diagram;
    const after = removeNode(d, [], r.id);
    expect(after.nodes.map((n) => n.id)).toEqual(['entry', 'output']);
    expect(after.edges.every((e) => e.from !== r.id && e.to !== r.id)).toBe(true);
  });

  it('[R14.1] entrada y salida no se pueden borrar ni añadir', () => {
    const d = fresh();
    expect(code(() => removeNode(d, [], 'entry'))).toBe('protected');
    expect(code(() => removeNode(d, [], 'output'))).toBe('protected');
    expect(code(() => addNode(d, [], { kind: 'entry', position: P } as never))).toBe('protected');
    expect(code(() => addNode(d, [], { kind: 'output', position: P } as never))).toBe('protected');
  });

  it('[R14.1] disconnect quita la arista y falla si no existe', () => {
    const d = fresh();
    expect(disconnect(d, [], 'entry->output').edges).toHaveLength(0);
    expect(code(() => disconnect(d, [], 'nada'))).toBe('unknown-edge');
  });
});

describe('ops: paleta [R14.2]', () => {
  it('[R14.2] ids únicos autogenerados y posición indicada', () => {
    let d = fresh();
    const a = addNode(d, [], { kind: 'agent', agentId: 'x', position: P });
    d = a.diagram;
    const b = addNode(d, [], { kind: 'agent', agentId: 'x', position: { x: 1, y: 2 } });
    expect(a.id).not.toBe(b.id);
    expect(b.diagram.nodes.find((n) => n.id === b.id)!.position).toEqual({ x: 1, y: 2 });
    const free = removeNode(b.diagram, [], a.id);
    expect(addNode(free, [], { kind: 'agent', agentId: 'x', position: P }).id).toBe(a.id);
  });

  it('[R14.2] el agente exige un agentId y el router nace en modo ai', () => {
    const d = fresh();
    expect(code(() => addNode(d, [], { kind: 'agent', agentId: '', position: P }))).toBe('invalid');
    const r = addNode(d, [], { kind: 'router', position: P });
    expect(r.diagram.nodes.find((n) => n.id === r.id)!.router).toEqual({ mode: 'ai' });
  });

  it('[R14.2] el bucle nace en modo count (3, máximo 5) con cuerpo válido', () => {
    const l = addNode(fresh(), [], { kind: 'loop', position: P });
    const node = l.diagram.nodes.find((n) => n.id === l.id)!;
    expect(node.loop).toMatchObject({ mode: 'count', count: 3, maxIterations: 5 });
    expect(validateDiagram(node.loop!.body)).toEqual([]);
  });
});

describe('ops: conexiones [R14.6]', () => {
  const two = () => {
    let d = fresh();
    d = disconnect(d, [], 'entry->output');
    const a = addNode(d, [], { kind: 'agent', agentId: 'a', position: P });
    const b = addNode(a.diagram, [], { kind: 'agent', agentId: 'b', position: P });
    return { d: b.diagram, a: a.id, b: b.id };
  };

  it('[R14.6] rechaza uno mismo, duplicados, hacia la entrada y desde la salida', () => {
    const { d, a, b } = two();
    const c = connect(d, [], a, b).diagram;
    expect(code(() => connect(c, [], a, a))).toBe('self-edge');
    expect(code(() => connect(c, [], a, b))).toBe('duplicate-edge');
    expect(code(() => connect(c, [], a, 'entry'))).toBe('into-entry');
    expect(code(() => connect(c, [], 'output', a))).toBe('from-output');
    expect(code(() => connect(c, [], a, 'nope'))).toBe('unknown-node');
  });

  it('[R14.6] rechaza ciclos (directos e indirectos) con un mensaje en español', () => {
    const { d, a, b } = two();
    const c = connect(d, [], a, b).diagram;
    try {
      connect(c, [], b, a);
      expect.unreachable();
    } catch (e) {
      expect((e as EditorError).code).toBe('cycle');
      expect((e as EditorError).message).toMatch(/ciclo/);
    }
  });

  it('[R14.6] una conexión válida da un diagrama que valida', () => {
    const { d, a, b } = two();
    let c = connect(d, [], 'entry', a).diagram;
    c = connect(c, [], a, b).diagram;
    c = connect(c, [], b, 'output').diagram;
    expect(validateDiagram(c)).toEqual([]);
  });
});

describe('ops: router y bucle [R14.7][R14.8]', () => {
  it('[R14.7] cambia el modo del router y fija/quita condiciones solo en aristas de router', () => {
    let d = disconnect(fresh(), [], 'entry->output');
    const r = addNode(d, [], { kind: 'router', position: P });
    const a = addNode(r.diagram, [], { kind: 'agent', agentId: 'a', position: P });
    d = connect(a.diagram, [], r.id, a.id).diagram;
    d = updateNode(d, [], r.id, { router: { mode: 'rules' } });
    expect(d.nodes.find((n) => n.id === r.id)!.router!.mode).toBe('rules');
    const eid = `${r.id}->${a.id}`;
    d = setCondition(d, [], eid, '  dibujar  ');
    expect(d.edges.find((e) => e.id === eid)!.condition).toBe('dibujar');
    d = setCondition(d, [], eid, '   ');
    expect(d.edges.find((e) => e.id === eid)!).not.toHaveProperty('condition');
    d = connect(d, [], 'entry', r.id).diagram;
    expect(code(() => setCondition(d, [], `entry->${r.id}`, 'x'))).toBe('invalid');
    expect(code(() => updateNode(d, [], a.id, { router: { mode: 'ai' } }))).toBe('invalid');
  });

  it('[R14.8] edita la configuración del bucle sin tocar su cuerpo', () => {
    const l = addNode(fresh(), [], { kind: 'loop', position: P });
    const before = l.diagram.nodes.find((n) => n.id === l.id)!.loop!.body;
    const d = updateNode(l.diagram, [], l.id, { loop: { mode: 'ai-judge', prompt: 'ok?', maxIterations: 7 } });
    const loop = d.nodes.find((n) => n.id === l.id)!.loop!;
    expect(loop).toMatchObject({ mode: 'ai-judge', prompt: 'ok?', maxIterations: 7 });
    expect(loop.body).toBe(before);
  });

  it('[R14.8] se edita el cuerpo con una ruta y los bucles se anidan', () => {
    const l = addNode(fresh(), [], { kind: 'loop', position: P });
    const inner = addNode(l.diagram, [l.id], { kind: 'loop', position: P });
    const leaf = addNode(inner.diagram, [l.id, inner.id], { kind: 'agent', agentId: 'z', position: P });
    expect(getLevel(leaf.diagram, [l.id, inner.id]).nodes.some((n) => n.id === leaf.id)).toBe(true);
    expect(leaf.diagram.nodes.some((n) => n.id === leaf.id)).toBe(false);
    expect(code(() => getLevel(leaf.diagram, ['entry']))).toBe('not-a-loop');
    expect(code(() => getLevel(leaf.diagram, ['zz']))).toBe('unknown-node');
  });
});
