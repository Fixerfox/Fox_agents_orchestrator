import { describe, expect, it } from 'vitest';
import type { DeliverableSpec, Diagram, RunEvent } from '@orquestador/core';
import { CHANNELS, EditorSession, computeProblems, createDiagram, deliverableLabel, parseRequest, setDeliverable, summarizeRun } from '../src';

const SPEC: DeliverableSpec = { items: [{ kind: 'links' }, { kind: 'summary' }, { kind: 'custom', title: 'Cómo arrancarlo', instructions: 'Pasos' }] };
const ev = (seq: number, body: object): RunEvent => ({ runId: 'r', seq, ts: `2026-11-05T17:00:0${seq}Z`, ...body }) as RunEvent;

describe('SPEC-046 · entregable en el editor', () => {
  it('[R46.12] setDeliverable lo pone y lo quita sin tocar el resto; la sesión lo deshace en un paso', () => {
    const d = createDiagram('d', 'Web');
    const withIt = setDeliverable(d, SPEC);
    expect(withIt.deliverable).toEqual(SPEC);
    expect(withIt.deliverable).not.toBe(SPEC);
    expect(setDeliverable(withIt, undefined)).toEqual(d);
    const s = new EditorSession(d);
    s.setDeliverable(SPEC);
    expect(s.diagram.deliverable).toEqual(SPEC);
    s.undo();
    expect(s.diagram.deliverable).toBeUndefined();
  });

  it('[R46.12] el subtítulo resume lo que se entrega', () => {
    expect(deliverableLabel(undefined)).toBeUndefined();
    expect(deliverableLabel(SPEC)).toBe('enlaces + resumen .md + 1 sección');
    expect(deliverableLabel({ items: [{ kind: 'json' }, { kind: 'custom', title: 'a', instructions: 'b' }, { kind: 'custom', title: 'c', instructions: 'd' }] })).toBe('JSON + 2 secciones');
  });

  it('[R46.12] los problemas del entregable se ven en la Salida', () => {
    const d: Diagram = setDeliverable(createDiagram('d', 'Web'), { items: [{ kind: 'custom', title: '', instructions: '' }] });
    const p = computeProblems(d, []);
    expect(p.runnable).toBe(false);
    expect(p.byNode['output']).toEqual(['Entregable: la sección propia necesita título e instrucciones']);
    const bad = setDeliverable(createDiagram('d', 'Web'), { items: [{ kind: 'json', schema: '[]' }] });
    expect(computeProblems(bad, []).byNode['output']![0]).toMatch(/^Entregable: Esquema del JSON/);
  });

  it('[R46.12] el IPC de ejecutar acepta y valida el entregable (null lo quita)', () => {
    const base = { diagramId: 'd', order: 'x' };
    expect(parseRequest(CHANNELS.startRun, { ...base, deliverable: SPEC })).toMatchObject({ deliverable: SPEC });
    expect(parseRequest(CHANNELS.startRun, { ...base, deliverable: null })).toMatchObject({ deliverable: null });
    expect(() => parseRequest(CHANNELS.startRun, { ...base, deliverable: { items: [] } })).toThrow(/entregable no válido/);
    expect(() => parseRequest(CHANNELS.startRun, { ...base, deliverable: { items: [{ kind: 'links' }], fileName: '../../x' } })).toThrow(/entregable no válido/);
  });

  it('[R46.12] el resumen de la ejecución incluye el entregable, o que estaba pedido y no llegó', () => {
    const done = summarizeRun([
      ev(1, { type: 'run.started', diagramId: 'd', deliverable: SPEC }),
      ev(2, { type: 'deliverable.done', nodeId: 'output', ok: false, fileName: 'entregable', markdown: '# Entregable', items: [{ kind: 'links', title: 'Enlaces', ok: true, attempts: 0 }, { kind: 'summary', title: 'Resumen', ok: false, error: 'vacío', attempts: 2 }] }),
      ev(3, { type: 'run.finished', status: 'succeeded' }),
    ]);
    expect(done.deliverable).toEqual({ done: { ok: false, fileName: 'entregable', markdown: '# Entregable', items: expect.arrayContaining([expect.objectContaining({ title: 'Resumen', ok: false })]) } });
    const pending = summarizeRun([ev(1, { type: 'run.started', diagramId: 'd', deliverable: SPEC }), ev(2, { type: 'run.finished', status: 'failed' })]);
    expect(pending.deliverable).toEqual({});
    expect(summarizeRun([ev(1, { type: 'run.started', diagramId: 'd' })]).deliverable).toBeUndefined();
  });
});
