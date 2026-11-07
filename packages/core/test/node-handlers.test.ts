import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MockAgent, MockDecider, Orchestrator, composeConfirmInput, explainTouchedFiles, isApproval, type DiagramNode, type Id, type NodeKind } from '../src';
import type { NodeHandler } from '../src/execution/nodes/handler';
import { NodeRegistry, defaultNodeRegistry } from '../src/execution/nodes/registry';
import { mergeInputs } from '../src/execution/text/merge-inputs';
import { deliverableNotice } from '../src/execution/text/deliverable-notice';
import { ENTRY, OUTPUT, agent, diagram, edge, loop, ofType, types } from './helpers';

const custom = (id: Id, kind: string): DiagramNode => ({ id, kind: kind as NodeKind, label: id });
const orch = (nodes?: NodeRegistry) => new Orchestrator({ getAdapter: () => new MockAgent(), decider: new MockDecider(), ...(nodes ? { nodes } : {}) });
const source = (rel: string) => readFileSync(fileURLToPath(new URL(`../src/execution/${rel}`, import.meta.url)), 'utf8');

/** Tipo de nodo que solo existe en este test: devuelve lo que recibe entre signos. */
const echoHandler: NodeHandler = {
  kind: 'echo',
  async run(step, node, input, path) {
    step.emitter.emit({ type: 'node.started', nodeId: node.id, input }, path);
    return { status: 'succeeded', output: { text: `¡${input.text}!`, files: input.files } };
  },
};
const withEcho = () => defaultNodeRegistry().register(echoHandler);
const echoDiagram = () => diagram([ENTRY, custom('e', 'echo'), OUTPUT], [edge('entry', 'e'), edge('e', 'output')]);

describe('SPEC-056 · tipos de nodo como handlers', () => {
  it('[R56.12] el registro tiene un handler por cada tipo de nodo de la aplicación', () => {
    const kinds: NodeKind[] = ['entry', 'output', 'agent', 'router', 'loop', 'review', 'transform', 'subdiagram'];
    const registry = defaultNodeRegistry();
    for (const k of kinds) expect(registry.find(k)?.kind, k).toBe(k);
    expect(registry.find('echo')).toBeUndefined();
  });

  it('[R56.12] cada tipo vive en su archivo y `runNode` no tiene un switch por tipo', () => {
    for (const f of ['nodes/entry.ts', 'nodes/agent.ts', 'nodes/router.ts', 'nodes/loop.ts', 'nodes/transform.ts', 'nodes/subdiagram.ts', 'nodes/review/index.ts', 'nodes/review/ai.ts', 'nodes/review/human.ts', 'nodes/output/index.ts', 'nodes/output/deliverable.ts']) {
      expect(source(f).length, f).toBeGreaterThan(0);
    }
    expect(source('orchestrator.ts')).not.toMatch(/switch\s*\(\s*node\.kind/);
  });

  it('[R56.12] un tipo sin handler no arranca: falla con su motivo antes del primer paso', async () => {
    const r = await orch().start(echoDiagram(), 'hola').result;
    expect(r.status).toBe('failed');
    expect(r.reason).toBe('node-no-handler');
    expect(types(r.events)).toEqual(['run.started', 'error', 'run.finished']);
    expect(ofType(r.events, 'run.finished')[0]).toMatchObject({ status: 'failed', reason: 'node-no-handler' });
    expect(ofType(r.events, 'error')[0]!.message).toContain('echo');
  });

  it('[R56.12] también lo detecta dentro de un bucle, sin ejecutar nada antes', async () => {
    const d = diagram([ENTRY, agent('a'), loop('l', { mode: 'count', count: 1, maxIterations: 1, body: echoDiagram() }), OUTPUT], [edge('entry', 'a'), edge('a', 'l'), edge('l', 'output')]);
    const r = await orch().start(d, 'hola').result;
    expect(r.reason).toBe('node-no-handler');
    expect(ofType(r.events, 'node.started')).toEqual([]);
  });

  it('[R56.12] `missingIn` dice qué tipo falta y nada si están todos', () => {
    expect(new NodeRegistry().missingIn(diagram([ENTRY], []))).toBe('entry');
    expect(defaultNodeRegistry().missingIn(diagram([ENTRY, OUTPUT], []))).toBeUndefined();
  });

  it('[R56.15] añadir un tipo de nodo no toca el orquestador: `entry → echo → output` funciona', async () => {
    const r = await orch(withEcho()).start(echoDiagram(), 'hola').result;
    expect(r.status).toBe('succeeded');
    expect(r.output?.text).toBe('¡hola!');
    expect(ofType(r.events, 'node.started').map((e) => e.nodeId)).toEqual(['entry', 'e', 'output']);
    expect(ofType(r.events, 'node.finished').find((e) => e.nodeId === 'e')).toMatchObject({ status: 'succeeded', output: { text: '¡hola!' } });
  });

  it('[R56.15] un handler nuevo recibe los servicios: su fallo y su cancelación funcionan como los de los demás', async () => {
    const boom: NodeHandler = {
      kind: 'boom',
      async run() {
        throw new Error('roto');
      },
    };
    const d = diagram([ENTRY, custom('b', 'boom'), OUTPUT], [edge('entry', 'b'), edge('b', 'output')]);
    const r = await orch(defaultNodeRegistry().register(boom)).start(d, 'x').result;
    expect(r.status).toBe('failed');
    expect(ofType(r.events, 'error')[0]).toMatchObject({ nodeId: 'b', message: 'roto' });
  });
});

describe('SPEC-056 · el orquestador solo planifica', () => {
  it('[R56.14] orchestrator.ts no contiene lógica de ningún tipo de nodo', () => {
    const text = source('orchestrator.ts');
    for (const word of ['adapter.run', 'decider.route', 'decider.judge', 'decider.transform', 'parseVerdict', 'collectLinks', 'applyTransformRules']) expect(text, word).not.toContain(word);
    expect(text.split('\n').length).toBeLessThan(500);
  });

  it('[R56.14] mergeInputs: una entrada tal cual; varias, bajo «## nombre» y sin archivos repetidos', () => {
    const a = { text: 'A', files: ['x'] };
    const b = { text: 'B', files: ['x', 'y'] };
    expect(mergeInputs([{ label: 'uno', payload: a }])).toEqual({ text: 'A', files: ['x'] });
    expect(mergeInputs([{ label: 'uno', payload: a }, { label: 'dos', payload: b }])).toEqual({ text: '## uno\nA\n\n## dos\nB', files: ['x', 'y'] });
  });

  it('[R56.14] las funciones de texto siguen disponibles y funcionan fuera del motor', () => {
    expect(isApproval('  aprobar ')).toBe(true);
    expect(composeConfirmInput({ round: 1, original: { text: 'o', files: ['a'] }, previous: { text: 'p', files: ['a', 'b'] }, request: 'r' }).files).toEqual(['a', 'b']);
    expect(explainTouchedFiles('hecho', new Map([['a.txt', 'created']]))).toContain('a.txt (creado)');
  });

  it('[R56.14] deliverableNotice avisa según «Avisar a» y si el paso es final', () => {
    const items = [{ kind: 'links' as const }];
    const finals = new Set(['fin']);
    expect(deliverableNotice(undefined, finals, 'fin', [])).toBeUndefined();
    expect(deliverableNotice({ items, notify: 'none' }, finals, 'fin', [])).toBeUndefined();
    expect(deliverableNotice({ items }, finals, 'fin', [])?.role).toBe('final');
    expect(deliverableNotice({ items }, finals, 'otro', [])).toBeUndefined();
    expect(deliverableNotice({ items, notify: 'all' }, finals, 'otro', [])?.role).toBe('goal');
    expect(deliverableNotice({ items, notify: 'all' }, finals, 'fin', ['bucle'])?.role).toBe('goal');
  });
});
