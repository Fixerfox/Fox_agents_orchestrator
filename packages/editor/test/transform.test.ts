import { describe, expect, it } from 'vitest';
import { validateDiagram, type Diagram, type RunEvent } from '@orquestador/core';
import {
  EditorError,
  addNode,
  computeProblems,
  createDiagram,
  eventsOfDiagram,
  getLevel,
  insertOnEdge,
  previewInput,
  previewTransform,
  transformSubtitle,
  updateNode,
} from '../src';

const P = { x: 10, y: 20 };
const fresh = (): Diagram => createDiagram('d', 'Demo');
let seq = 0;
const ev = (body: Record<string, unknown>, nodePath?: string[]): RunEvent => ({ runId: 'r', seq: ++seq, ts: '2026-11-05T10:00:00.000Z', ...(nodePath ? { nodePath } : {}), ...body }) as RunEvent;

describe('SPEC-037 · editor del nodo Transformar', () => {
  it('[R37.11] se añade un nodo en reglas y JSON, válido, e insertarlo en una conexión lo deja en medio', () => {
    const { diagram, id } = addNode(fresh(), [], { kind: 'transform', position: P });
    const n = diagram.nodes.find((x) => x.id === id)!;
    expect(n).toMatchObject({ kind: 'transform', label: 'Transformar', transform: { mode: 'rules', format: 'json' } });
    expect(id).toBe('transform-1');

    const base = fresh();
    const edgeId = base.edges[0]!.id;
    const ins = insertOnEdge(base, [], edgeId, { kind: 'transform' });
    const level = getLevel(ins.diagram, []);
    expect(level.edges.map((e) => `${e.from}->${e.to}`).sort()).toEqual([`entry->${ins.id}`, `${ins.id}->output`].sort());
    expect(validateDiagram(ins.diagram)).toEqual([]);
  });

  it('[R37.12] los cambios se mezclan, un texto vacío quita el campo y solo valen en un nodo transformar', () => {
    const added = addNode(fresh(), [], { kind: 'transform', position: P });
    const id = added.id;
    let diagram = updateNode(added.diagram, [], id, { transform: { mode: 'ai', instructions: 'Saca tareas', schema: '{"type":"object"}', maxAttempts: 3 } });
    expect(diagram.nodes.find((x) => x.id === id)!.transform).toEqual({ mode: 'ai', format: 'json', instructions: 'Saca tareas', schema: '{"type":"object"}', maxAttempts: 3 });
    diagram = updateNode(diagram, [], id, { transform: { schema: '  ', format: 'markdown' } });
    expect(diagram.nodes.find((x) => x.id === id)!.transform).toEqual({ mode: 'ai', format: 'markdown', instructions: 'Saca tareas', maxAttempts: 3 });
    const router = addNode(fresh(), [], { kind: 'router', position: P });
    expect(() => updateNode(router.diagram, [], router.id, { transform: { mode: 'ai' } })).toThrow(EditorError);
  });

  it('[R37.12] los problemas del nodo salen traducidos en el panel de problemas', () => {
    const { diagram: d0, id } = addNode(fresh(), [], { kind: 'transform', position: P });
    const diagram = updateNode(d0, [], id, { transform: { mode: 'ai', schema: '{mal' } });
    const msgs = computeProblems(diagram, []).byNode[id] ?? [];
    expect(msgs).toContain('«Transformar» necesita instrucciones para Claude');
    expect(msgs).toContain('«Transformar»: el esquema no es un objeto JSON válido');
  });

  it('[R37.13] la vista previa usa lo que recibió el nodo, si no la salida del paso anterior y si no el ejemplo', () => {
    const { diagram: d0, id } = addNode(fresh(), [], { kind: 'transform', position: P });
    const diagram = { ...d0, edges: [{ id: 'a', from: 'entry', to: id }, { id: 'b', from: id, to: 'output' }] };
    const level = getLevel(diagram, []);
    const cfg = { mode: 'rules' as const, format: 'markdown' as const, template: '# {{json.t}}', sample: '{"t":"Ejemplo"}' };

    expect(previewInput([], level, [], id, undefined)).toEqual({ source: 'none' });
    const fromSample = previewTransform(cfg, [], level, [], id);
    expect(fromSample).toMatchObject({ source: 'sample', result: { ok: true, text: '# Ejemplo' } });

    const prev = [ev({ type: 'node.finished', nodeId: 'entry', status: 'succeeded', output: { text: '{"t":"Anterior"}', files: [] } })];
    expect(previewTransform(cfg, prev, level, [], id)).toMatchObject({ source: 'prev', result: { ok: true, text: '# Anterior' } });

    const got = [...prev, ev({ type: 'node.started', nodeId: id, input: { text: '{"t":"Recibido"}', files: [] } })];
    expect(previewTransform(cfg, got, level, [], id)).toMatchObject({ source: 'run', result: { ok: true, text: '# Recibido' } });

    // Un nodo con el mismo id dentro de un bucle no cuenta.
    const nested = [ev({ type: 'node.started', nodeId: id, input: { text: '{"t":"Dentro"}', files: [] } }, ['bucle'])];
    expect(previewInput(nested, level, [], id, undefined).source).toBe('none');

    const bad = previewTransform({ ...cfg, format: 'json', template: undefined, schema: '{"required":["x"]}' }, got, level, [], id);
    expect(bad.result).toMatchObject({ ok: false, errors: ['$.x: falta'] });
    const ai = previewTransform({ mode: 'ai', format: 'json', instructions: 'x', schema: '{"required":["t"]}' }, got, level, [], id);
    expect(ai.result).toMatchObject({ ok: true });
  });

  it('[R37.13] solo cuentan los eventos de una ejecución de este mismo diagrama', () => {
    const events = [ev({ type: 'run.started', diagramId: 'd' })];
    expect(eventsOfDiagram(events, 'd')).toBe(events);
    expect(eventsOfDiagram(events, 'otro')).toEqual([]);
    expect(eventsOfDiagram([], 'd')).toEqual([]);
  });

  it('[R37.14] el subtítulo dice formato y modo', () => {
    expect(transformSubtitle({ mode: 'rules', format: 'json' })).toBe('JSON · por reglas');
    expect(transformSubtitle({ mode: 'ai', format: 'markdown' })).toBe('Markdown · con Claude');
    expect(transformSubtitle({ mode: 'ai', format: 'text' })).toBe('Texto · con Claude');
    expect(transformSubtitle(undefined)).toBeUndefined();
  });
});
