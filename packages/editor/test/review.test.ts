import { describe, expect, it } from 'vitest';
import { validateDiagram, type Diagram, type RunEvent } from '@orquestador/core';
import {
  EditorError,
  EditorSession,
  addNode,
  computeProblems,
  connect,
  createDiagram,
  deriveLive,
  disconnect,
  insertOnEdge,
  insertParallel,
  t,
  updateNode,
} from '../src';

const P = { x: 0, y: 0 };
const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return e instanceof EditorError ? e.code : 'other';
  }
  return undefined;
};

/** Entrada → dis → qa → revisión; ✓ y ⏱ a Salida, ✗ vuelve a dis. */
function build(): { d: Diagram; rev: string } {
  let d = disconnect(createDiagram('d', 'D'), [], 'entry->output');
  const a = addNode(d, [], { kind: 'agent', agentId: 'dis', position: P });
  const q = addNode(a.diagram, [], { kind: 'agent', agentId: 'qa', position: P });
  const r = addNode(q.diagram, [], { kind: 'review', position: P });
  d = r.diagram;
  d = connect(d, [], 'entry', a.id).diagram;
  d = connect(d, [], a.id, q.id).diagram;
  d = connect(d, [], q.id, r.id).diagram;
  d = connect(d, [], r.id, 'output', 'approved').diagram;
  d = connect(d, [], r.id, a.id, 'rejected').diagram;
  return { d, rev: r.id };
}

describe('SPEC-034 · editor de la revisión', () => {
  it('[R34.15] añade «Revisión» con 3 vueltas y modo veredicto; updateNode limita las vueltas', () => {
    const { diagram, id } = addNode(createDiagram('d', 'D'), [], { kind: 'review', position: P });
    const n = diagram.nodes.find((x) => x.id === id)!;
    expect(n).toMatchObject({ kind: 'review', label: 'Revisión', review: { maxRounds: 3, mode: 'verdict' } });
    expect(updateNode(diagram, [], id, { review: { maxRounds: 40 } }).nodes.find((x) => x.id === id)!.review!.maxRounds).toBe(10);
    expect(updateNode(diagram, [], id, { review: { maxRounds: 0 } }).nodes.find((x) => x.id === id)!.review!.maxRounds).toBe(1);
    const withCrit = updateNode(diagram, [], id, { review: { mode: 'ai', criteria: 'Paleta' } }).nodes.find((x) => x.id === id)!;
    expect(withCrit.review).toEqual({ maxRounds: 3, mode: 'ai', criteria: 'Paleta' });
    expect(updateNode(diagram, [], id, { review: { criteria: '  ' } }).nodes.find((x) => x.id === id)!.review!.criteria).toBeUndefined();
    const agent = addNode(diagram, [], { kind: 'agent', agentId: 'a', position: P });
    expect(code(() => updateNode(agent.diagram, [], agent.id, { review: { maxRounds: 2 } }))).toBe('invalid');
  });

  it('[R34.16] la revisión exige puerto libre; solo ✗ puede volver atrás; los retornos no cuentan como ciclo', () => {
    const { d, rev } = build();
    expect(d.edges.find((e) => e.from === rev && e.to === 'agent-1')).toMatchObject({ id: `${rev}.rejected->agent-1`, port: 'rejected' });
    expect(code(() => connect(d, [], rev, 'agent-1'))).toBe('port-required');
    expect(code(() => connect(d, [], rev, 'agent-2', 'approved'))).toBe('port-taken');
    expect(code(() => connect(d, [], 'agent-1', 'output', 'approved'))).toBe('invalid');
    // ⏱ hacia atrás sería un ciclo; ✗ sí podía.
    const noX = disconnect(d, [], `${rev}.rejected->agent-1`);
    expect(code(() => connect(noX, [], rev, 'agent-1', 'exhausted'))).toBe('cycle');
    // ✓ y ⏱ pueden ir los dos a Salida.
    const full = connect(d, [], rev, 'output', 'exhausted');
    expect(full.edgeId).toBe(`${rev}.exhausted->output`);
    expect(validateDiagram(full.diagram)).toEqual([]);
    expect(code(() => connect(full.diagram, [], rev, 'output', 'exhausted'))).toBe('port-taken');
    // Con el retorno ya puesto, una conexión hacia delante normal no se confunde con un ciclo.
    const extra = addNode(full.diagram, [], { kind: 'agent', agentId: 'x', position: P });
    expect(code(() => connect(extra.diagram, [], 'entry', extra.id))).toBeUndefined();
    expect(t('error.port-required')).toContain('Aprobado');
  });

  it('[R34.17] insertar tras una salida conserva el puerto; en un retorno no se inserta', () => {
    const { d, rev } = build();
    const out = insertOnEdge(d, [], `${rev}.approved->output`, { kind: 'agent', agentId: 'pub' });
    const leg = out.diagram.edges.find((e) => e.from === rev && e.to === out.id)!;
    expect(leg.port).toBe('approved');
    expect(out.diagram.edges.find((e) => e.from === out.id)!.port).toBeUndefined();
    expect(code(() => insertOnEdge(d, [], `${rev}.rejected->agent-1`, { kind: 'agent', agentId: 'z' }))).toBe('invalid');
    expect(code(() => insertParallel(d, [], `${rev}.approved->output`, { branches: [{ agentId: 'a' }, { agentId: 'b' }] }))).toBe('invalid');
  });

  it('[R34.18] deriveLive guarda la última decisión de cada revisión y las que se agotaron', () => {
    const base = { runId: 'r', ts: '' };
    const events = [
      { ...base, seq: 1, type: 'run.started', diagramId: 'd' },
      { ...base, seq: 2, type: 'review.decided', nodeId: 'rev', round: 1, max: 2, verdict: 'rejected', source: 'verdict', returnTo: 'dis' },
      { ...base, seq: 3, type: 'review.decided', nodeId: 'rev', round: 2, max: 2, verdict: 'exhausted', source: 'ai', reason: 'no' },
    ] as RunEvent[];
    const v = deriveLive(events);
    expect(v.reviews['rev']).toEqual({ n: 2, max: 2, verdict: 'exhausted', reason: 'no' });
    expect(v.exhausted).toEqual([{ nodeId: 'rev', nodePath: [] }]);
  });

  it('[R34.19] los problemas de la revisión salen en español; sin ✓ es un aviso', () => {
    const { d, rev } = build();
    const p = computeProblems(d, []);
    expect(p.all.map((x) => x.message)).toContain('«Revisión» vuelve atrás: conecta también ⏱ Agotado para cuando se acaben las vueltas');
    const noOk = disconnect(connect(d, [], rev, 'output', 'exhausted').diagram, [], `${rev}.approved->output`);
    const w = computeProblems(noOk, []);
    const missing = w.all.find((x) => x.code === 'review-no-approved')!;
    expect(missing.severity).toBe('warning');
    expect(missing.message).toBe('«Revisión»: conecta la salida ✓ Aprobado');
    for (const c of ['review-missing-config', 'review-invalid-max', 'review-edge-no-port', 'review-duplicate-port', 'review-return-shape', 'review-return-crossed', 'edge-port-not-review']) {
      expect(t(`problem.${c}` as Parameters<typeof t>[0])).not.toBe(`problem.${c}`);
    }
  });

  it('[R34.16] la sesión conecta desde una salida concreta', () => {
    const s = new EditorSession(createDiagram('d', 'D'));
    const id = s.addNode({ kind: 'review', position: P });
    expect(s.tryConnect(id, 'output')).toMatchObject({ ok: false, code: 'port-required' });
    expect(s.tryConnect(id, 'output', 'approved')).toMatchObject({ ok: true });
    expect(s.getSnapshot().level.edges.find((e) => e.from === id)!.port).toBe('approved');
  });
});

describe('SPEC-034 · plantilla', () => {
  it('[R34.25] «Crear y revisar con QA» vuelve al creador y pide el veredicto', async () => {
    const { exampleTemplates } = await import('../src');
    const tpl = exampleTemplates().find((x) => x.id === 'qa')!;
    expect(tpl.name).toBe('Crear y revisar con QA');
    expect(validateDiagram(tpl.diagram)).toEqual([]);
    expect(tpl.diagram.edges.find((e) => e.port === 'rejected')!.to).toBe('creador');
    expect(tpl.diagram.nodes.find((n) => n.id === 'qa')!.task).toContain('VEREDICTO: RECHAZADO');
  });
});

describe('SPEC-038 · vuelta atrás en vivo', () => {
  it('[R38.18] al volver atrás, los pasos y conexiones de la vuelta anterior dejan de verse como recorridos', () => {
    const base = { runId: 'r', ts: '' };
    let seq = 0;
    const ev = (e: Record<string, unknown>) => ({ ...base, seq: ++seq, ...e }) as RunEvent;
    const events = [
      ev({ type: 'run.started', diagramId: 'd' }),
      ev({ type: 'node.started', nodeId: 'entry' }),
      ev({ type: 'node.finished', nodeId: 'entry', status: 'succeeded' }),
      ev({ type: 'edge.traversed', edgeId: 'entry->dis' }),
      ev({ type: 'node.started', nodeId: 'dis' }),
      ev({ type: 'node.finished', nodeId: 'dis', status: 'succeeded' }),
      ev({ type: 'edge.traversed', edgeId: 'dis->qa' }),
      ev({ type: 'node.started', nodeId: 'qa' }),
      ev({ type: 'node.finished', nodeId: 'qa', status: 'succeeded' }),
      ev({ type: 'edge.traversed', edgeId: 'qa->rev' }),
      ev({ type: 'node.started', nodeId: 'rev' }),
      ev({ type: 'review.decided', nodeId: 'rev', round: 1, max: 3, verdict: 'rejected', source: 'verdict', returnTo: 'dis' }),
      ev({ type: 'node.finished', nodeId: 'rev', status: 'succeeded' }),
      ev({ type: 'edge.traversed', edgeId: 'rev.rejected->dis' }),
      ev({ type: 'node.started', nodeId: 'dis' }),
    ];
    const v = deriveLive(events);
    expect([...v.edges].sort()).toEqual(['entry->dis', 'rev.rejected->dis']);
    expect(v.nodeStatus).toEqual({ entry: 'succeeded', dis: 'running' });
    expect(v.reviews['rev']).toMatchObject({ n: 1, verdict: 'rejected' });
  });
});
