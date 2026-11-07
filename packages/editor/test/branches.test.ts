import { describe, expect, it } from 'vitest';
import { MockAgent, MockDecider, Orchestrator, type Diagram, type RunEvent } from '@orquestador/core';
import { branchBoxes, branchesOf, deriveLive, nodeBranches, reviewNumber, summarizeRun, type Rect } from '../src';

let seq = 0;
const ev = (nodeId: string, branch: string, via: 'head' | 'command' | 'mcp' | 'ran' = 'command', more: { created?: boolean; nodePath?: string[] } = {}) =>
  ({ type: 'git.branch', nodeId, branch, via, runId: 'r', seq: ++seq, ts: '2026-11-06T10:00:00.000Z', ...more }) as RunEvent;

const line: Diagram = {
  id: 'd',
  name: 'D',
  schemaVersion: 1,
  nodes: [
    { id: 'entry', kind: 'entry' },
    { id: 'a', kind: 'agent', agentId: 'a' },
    { id: 'b', kind: 'agent', agentId: 'b' },
    { id: 'output', kind: 'output' },
  ],
  edges: [
    { id: 'e1', from: 'entry', to: 'a' },
    { id: 'e2', from: 'a', to: 'b' },
    { id: 'e3', from: 'b', to: 'output' },
  ],
};

describe('SPEC-058 · evento de la rama', () => {
  it('[R58.1] el paso emite git.branch con lo que avisa el motor', async () => {
    const agent = new MockAgent({ a: { output: 'x', branches: [{ branch: 'feature/x', via: 'command', created: true }] }, b: { output: 'y', branches: [{ branch: 'feature/x', via: 'ran' }] } });
    const { events } = await new Orchestrator({ getAdapter: () => agent, decider: new MockDecider() }).start(line, 'pedido').result;
    const seen = events.filter((e) => e.type === 'git.branch');
    expect(seen).toMatchObject([
      { nodeId: 'a', branch: 'feature/x', via: 'command', created: true },
      { nodeId: 'b', branch: 'feature/x', via: 'ran' },
    ]);
    expect(seen[1]).not.toHaveProperty('created');
    expect(deriveLive(events).branches).toEqual({ a: ['feature/x'], b: ['feature/x'] });
  });
});

describe('SPEC-058 · ramas de una ejecución', () => {
  it('[R58.6] da las ramas de cada paso por orden de uso y quién actuó en cada una', () => {
    const r = branchesOf([ev('a', 'uno', 'command', { created: true }), ev('a', 'dos'), ev('b', 'uno', 'ran'), ev('a', 'uno')]);
    expect(r.byStep).toEqual({ a: ['dos', 'uno'], b: ['uno'] });
    expect(r.list).toEqual([
      { name: 'uno', created: true, deleted: false, steps: [{ key: 'a', nodeId: 'a', nodePath: [], actions: [] }, { key: 'b', nodeId: 'b', nodePath: [], actions: [] }] },
      { name: 'dos', created: false, deleted: false, steps: [{ key: 'a', nodeId: 'a', nodePath: [], actions: [] }] },
    ]);
  });

  it('[R58.6] un cambio de rama deja esa como la vigente, también en ejecuciones ya grabadas', () => {
    const moved = { runId: 'r', seq: 9, ts: 't', type: 'git.action', nodeId: 'a', branch: 'nueva', action: 'switch' } as RunEvent;
    const r = branchesOf([ev('a', 'nueva', 'command', { created: true }), ev('a', 'vieja', 'ran'), moved]);
    expect(r.byStep).toEqual({ a: ['vieja', 'nueva'] });
    expect(r.actions).toEqual({ a: ['switch'] });
  });

  it('[R58.6] si los pasos solo corrieron en ella, sin actividad de git, no hay ramas', () => {
    expect(branchesOf([ev('a', 'main', 'ran'), ev('b', 'main', 'ran')])).toEqual({ byStep: {}, actions: {}, links: {}, list: [] });
    expect(branchesOf([ev('a', 'main', 'ran'), ev('b', 'main', 'head')]).byStep).toEqual({ a: ['main'], b: ['main'] });
    expect(deriveLive([ev('a', 'main', 'ran')]).branches).toEqual({});
  });

  it('[R58.7] un bucle enseña las ramas de lo que lleva dentro', () => {
    const { byStep } = branchesOf([ev('x', 'dentro', 'command', { nodePath: ['bucle'] }), ev('bucle', 'fuera')]);
    expect(nodeBranches(byStep, 'bucle')).toEqual(['dentro', 'fuera']);
    expect(nodeBranches(byStep, 'buc')).toEqual([]);
  });

  it('[R58.6] volver a main al terminar no desbanca a la rama en la que se trabajó', () => {
    const { byStep } = branchesOf([ev('a', '006', 'mcp'), ev('b', '006', 'ran'), ev('c', '006', 'command'), ev('c', 'main', 'command')]);
    expect(nodeBranches(byStep, 'c')).toEqual(['main', '006']);
    expect(nodeBranches(branchesOf([ev('a', 'main'), ev('a', 'develop')]).byStep, 'a')).toEqual(['main', 'develop']);
    const boxes = branchBoxes({ nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], edges: [] }, [], byStep, new Map(['a', 'b', 'c'].map((id, i) => [id, { x: i * 200, y: 0, width: 100, height: 50 }])));
    expect(boxes.map((b) => b.branch)).toEqual(['006']);
  });

  it('[R58.12] cada paso lleva lo que hizo, sin repetir', async () => {
    const act = (nodeId: string, branch: string, action: string) => ({ ...ev(nodeId, branch), type: 'git.action', action }) as unknown as RunEvent;
    const events = [ev('a', 'x'), act('a', 'x', 'commit'), act('a', 'x', 'push'), act('a', 'x', 'commit')];
    expect(deriveLive(events).gitActions).toEqual({ a: ['commit', 'push'] });
    const agent = new MockAgent({ a: { output: 'x', branches: [{ branch: 'x', via: 'command' }], gitActions: [{ branch: 'x', action: 'push' }] }, b: { output: 'y' } });
    const run = await new Orchestrator({ getAdapter: () => agent, decider: new MockDecider() }).start(line, 'pedido').result;
    expect(run.events.filter((e) => e.type === 'git.action')).toMatchObject([{ nodeId: 'a', branch: 'x', action: 'push' }]);
  });

  it('[R58.13] el resumen dice qué hizo cada paso y marca la rama borrada', () => {
    const act = (nodeId: string, branch: string, action: string) => ({ ...ev(nodeId, branch), type: 'git.action', action }) as unknown as RunEvent;
    const s = summarizeRun([ev('a', 'x'), act('a', 'x', 'commit'), act('b', 'x', 'delete'), act('b', 'otra', 'delete')], (id) => id.toUpperCase());
    expect(s.branches).toEqual([{ name: 'x', created: false, deleted: true, steps: [{ label: 'A', actions: ['commit'] }, { label: 'B', actions: ['delete'] }] }]);
  });

  it('[R58.15] el paso y la rama llevan la PR, y el resumen la devuelve', () => {
    const url = 'https://github.com/o/r/pull/12';
    const events = [ev('a', 'x'), { ...ev('a', 'x'), type: 'git.action', action: 'pr', url } as unknown as RunEvent];
    expect(deriveLive(events).gitLinks).toEqual({ a: url });
    expect(summarizeRun(events, (id) => id).branches[0]!.prUrl).toBe(url);
    expect(reviewNumber(url)).toBe('12');
  });

  it('[R58.10] el resumen devuelve las ramas con el nombre de los pasos', () => {
    const s = summarizeRun([ev('a', 'uno', 'command', { created: true }), ev('b', 'uno', 'ran')], (id) => id.toUpperCase());
    expect(s.branches).toEqual([{ name: 'uno', created: true, deleted: false, steps: [{ label: 'A', actions: [] }, { label: 'B', actions: [] }] }]);
    expect(summarizeRun([], (id) => id).branches).toEqual([]);
  });
});

describe('SPEC-058 · recuadros', () => {
  const at = (x: number, y = 0): Rect => ({ x, y, width: 100, height: 50 });
  const level = {
    nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
    edges: [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'd' },
    ],
  };

  it('[R58.8] una rama da un recuadro que rodea sus pasos, con sitio para el nombre', () => {
    const boxes = branchBoxes(level, [], { a: ['x'], b: ['x'] }, new Map([['a', at(0)], ['b', at(200)], ['c', at(400)], ['d', at(600)]]));
    expect(boxes).toEqual([{ id: 'branch:x:0', branch: 'x', x: -24, y: -46, width: 348, height: 120 }]);
  });

  it('[R58.8] un paso con varias ramas va en el recuadro de la vigente', () => {
    const boxes = branchBoxes(level, [], { a: ['vieja', 'x'], b: ['x'] }, new Map([['a', at(0)], ['b', at(200)]]));
    expect(boxes.map((b) => b.branch)).toEqual(['x']);
  });

  it('[R58.8] dentro de un bucle cuenta la ruta del nivel', () => {
    expect(branchBoxes(level, ['bucle'], { 'bucle/a': ['x'], a: ['otra'] }, new Map([['a', at(0)]])).map((b) => b.branch)).toEqual(['x']);
  });

  it('[R58.9] si pisaría un paso de otra rama, se parte por grupos conectados', () => {
    const rects = new Map([['a', at(0)], ['b', at(200)], ['c', at(400)], ['d', at(600)]]);
    const boxes = branchBoxes(level, [], { a: ['x'], b: ['y'], c: ['x'], d: ['x'] }, rects);
    expect(boxes.filter((b) => b.branch === 'x').map((b) => b.id)).toEqual(['branch:x:0', 'branch:x:1']);
    expect(boxes.filter((b) => b.branch === 'x').map((b) => b.x)).toEqual([-24, 376]);
    expect(boxes.filter((b) => b.branch === 'y')).toHaveLength(1);
  });

  it('[R58.9] ramas que no se pisan siguen con un recuadro cada una', () => {
    const rects = new Map([['a', at(0)], ['b', at(200)], ['c', at(1000)], ['d', at(1200)]]);
    expect(branchBoxes(level, [], { a: ['x'], b: ['x'], c: ['y'], d: ['y'] }, rects).map((b) => b.id)).toEqual(['branch:x:0', 'branch:y:0']);
  });
});
