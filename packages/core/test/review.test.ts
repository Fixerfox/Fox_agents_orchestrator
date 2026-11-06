import { describe, expect, it } from 'vitest';
import {
  MockAgent,
  MockDecider,
  Orchestrator,
  composeRoundInput,
  parseVerdict,
  returnEdges,
  validateDiagram,
  type DiagramNode,
  type Edge,
  type Id,
  type ReviewPort,
} from '../src';
import { ENTRY, OUTPUT, agent, diagram, edge, nodeFinished, ofType, setup, deferred, waitForEvent } from './helpers';

const review = (id: Id, maxRounds = 3, mode: 'verdict' | 'ai' = 'verdict', criteria?: string): DiagramNode => ({
  id,
  kind: 'review',
  label: id,
  review: { maxRounds, mode, ...(criteria ? { criteria } : {}) },
});
const port = (from: Id, to: Id, p: ReviewPort): Edge => ({ id: `${from}->${to}`, from, to, port: p });

/** Entrada → diseñador → qa → revisión (✓ → Salida, ✗ → diseñador, ⏱ → Salida). */
function qaLoop(max = 3, mode: 'verdict' | 'ai' = 'verdict') {
  return diagram(
    [ENTRY, agent('dis'), agent('qa'), review('rev', max, mode), OUTPUT],
    [edge('entry', 'dis'), edge('dis', 'qa'), edge('qa', 'rev'), port('rev', 'output', 'approved'), port('rev', 'dis', 'rejected'), { ...port('rev', 'output', 'exhausted'), id: 'rev->output:x' }],
  );
}
const codes = (d: ReturnType<typeof diagram>) => validateDiagram(d).map((i) => i.code);

describe('SPEC-034 · el Juez', () => {
  const judged = (judgeReview: NonNullable<ConstructorParameters<typeof MockDecider>[0]>['judgeReview'], judge?: () => { done: boolean; reason: string }) => {
    const agents = new MockAgent({ dis: { output: 'hecho' }, qa: { output: 'Informe sin veredicto' } });
    const decider = new MockDecider({ ...(judgeReview ? { judgeReview } : {}), ...(judge ? { judge } : {}) });
    return { decider, orch: new Orchestrator({ getAdapter: () => agents, decider }) };
  };

  it('[R34.26] sin veredicto escrito decide el Juez, y queda como decisión', async () => {
    const seen: unknown[] = [];
    const { orch, decider } = judged((r) => (seen.push(r), Promise.resolve({ approved: true, reason: 'Sirve; queda el responsive' })));
    const { events, status } = await orch.start(qaLoop(), 'x').result;
    expect(status).toBe('succeeded');
    expect(seen).toMatchObject([{ round: 1, max: 3, output: { text: 'Informe sin veredicto' } }]);
    expect(decider.judgeCalls).toEqual([]);
    expect(ofType(events, 'review.decided')).toMatchObject([{ verdict: 'approved', source: 'ai', reason: 'Sirve; queda el responsive' }]);
    expect(ofType(events, 'decision')).toMatchObject([{ kind: 'judge', response: { done: true } }]);
  });

  it('[R34.26] un veredicto escrito manda: no se pregunta al Juez', async () => {
    const seen: unknown[] = [];
    const agents = new MockAgent({ dis: { output: 'hecho' }, qa: { output: 'VEREDICTO: APROBADO' } });
    const orch = new Orchestrator({ getAdapter: () => agents, decider: new MockDecider({ judgeReview: (r) => (seen.push(r), Promise.resolve({ approved: false, reason: '' })) }) });
    await orch.start(qaLoop(), 'x').result;
    expect(seen).toEqual([]);
  });

  it('[R34.26] sin Juez en el motor, sigue decidiendo judge', async () => {
    const { orch, decider } = judged(undefined, () => ({ done: true, reason: 'ok' }));
    await orch.start(qaLoop(), 'x').result;
    expect(decider.judgeCalls).toHaveLength(1);
  });

  it('[R34.27] recibe el criterio del nodo', async () => {
    const seen: { criteria?: string }[] = [];
    const agents = new MockAgent({ a: { output: 'x' } });
    const d = diagram([ENTRY, agent('a'), review('rev', 2, 'ai', 'Sin faltas'), OUTPUT], [edge('entry', 'a'), edge('a', 'rev'), port('rev', 'output', 'approved')]);
    const orch = new Orchestrator({ getAdapter: () => agents, decider: new MockDecider({ judgeReview: (r) => (seen.push(r), Promise.resolve({ approved: true, reason: '' })) }) });
    await orch.start(d, 'x').result;
    expect(seen[0]!.criteria).toBe('Sin faltas');
  });

  it('[R34.28] su gasto va marcado y no dispara el límite', async () => {
    const { orch } = judged(() => Promise.resolve({ approved: true, reason: '', usage: { inputTokens: 500, outputTokens: 500, costUsd: 0.002 } }));
    const { events, status } = await orch.start(qaLoop(), 'x', { budget: { maxTokens: 100 } }).result;
    expect(status).toBe('succeeded');
    expect(ofType(events, 'agent.usage').filter((e) => e.source === 'judge')).toMatchObject([{ nodeId: 'rev', costUsd: 0.002 }]);
  });
});

describe('SPEC-034 · Revisión con retorno: modelo y validación', () => {
  it('[R34.1] la revisión con sus tres salidas y un retorno es un diagrama válido', () => {
    expect(validateDiagram(qaLoop())).toEqual([]);
  });

  it('[R34.2] valida configuración, puertos y conexiones de la revisión', () => {
    const noCfg = qaLoop();
    noCfg.nodes[3] = { id: 'rev', kind: 'review' };
    expect(codes(noCfg)).toContain('review-missing-config');
    expect(codes(diagram(qaLoop().nodes.map((n) => (n.id === 'rev' ? review('rev', 11) : n)), qaLoop().edges))).toContain('review-invalid-max');
    expect(codes(diagram(qaLoop().nodes.map((n) => (n.id === 'rev' ? review('rev', 0) : n)), qaLoop().edges))).toContain('review-invalid-max');
    const noPort = diagram([ENTRY, agent('a'), review('rev'), OUTPUT], [edge('entry', 'a'), edge('a', 'rev'), edge('rev', 'output')]);
    expect(codes(noPort)).toContain('review-edge-no-port');
    const dup = diagram([ENTRY, agent('a'), agent('b'), review('rev'), OUTPUT], [edge('entry', 'a'), edge('a', 'rev'), port('rev', 'output', 'approved'), port('rev', 'b', 'approved'), edge('b', 'output')]);
    expect(codes(dup)).toContain('review-duplicate-port');
    const noOk = diagram([ENTRY, agent('a'), review('rev'), OUTPUT], [edge('entry', 'a'), edge('a', 'rev'), port('rev', 'output', 'rejected')]);
    expect(codes(noOk)).toContain('review-no-approved');
    const stray = diagram([ENTRY, agent('a'), OUTPUT], [edge('entry', 'a'), { ...edge('a', 'output'), port: 'approved' }]);
    expect(codes(stray)).toContain('edge-port-not-review');
  });

  it('[R34.3] el retorno ✗ hacia atrás no es un ciclo; otros ciclos sí', () => {
    const d = qaLoop();
    expect([...returnEdges(d).keys()]).toEqual(['rev->dis']);
    expect(codes(d)).not.toContain('cycle');
    const plain = diagram([ENTRY, agent('a'), agent('b'), OUTPUT], [edge('entry', 'a'), edge('a', 'b'), edge('b', 'a'), edge('b', 'output')]);
    expect(codes(plain)).toContain('cycle');
    // Un ✓ hacia atrás no es un retorno: es un ciclo.
    const okBack = diagram([ENTRY, agent('a'), review('rev'), OUTPUT], [edge('entry', 'a'), edge('a', 'rev'), port('rev', 'a', 'approved'), port('rev', 'output', 'exhausted')]);
    expect(codes(okBack)).toContain('cycle');
  });

  it('[R34.4] el tramo debe tener una sola entrada y una sola salida', () => {
    const exits = qaLoop();
    exits.edges.push(edge('dis', 'output'));
    expect(codes(exits)).toContain('review-return-shape');
    const enters = diagram(
      [...qaLoop().nodes, agent('otro')],
      [...qaLoop().edges, edge('entry', 'otro'), edge('otro', 'qa')],
    );
    expect(codes(enters)).toContain('review-return-shape');
    expect(returnEdges(qaLoop()).get('rev->dis')!.segment).toEqual(new Set(['dis', 'qa', 'rev']));
  });

  it('[R34.5] con retorno hace falta ⏱ Agotado; los tramos no se pueden cruzar', () => {
    const d = qaLoop();
    d.edges = d.edges.filter((e) => e.port !== 'exhausted');
    expect(codes(d)).toContain('review-no-exhausted');
    const crossed = diagram(
      [ENTRY, agent('a'), review('r1'), agent('b'), review('r2'), OUTPUT],
      [
        edge('entry', 'a'),
        edge('a', 'r1'),
        port('r1', 'b', 'approved'),
        port('r1', 'a', 'rejected'),
        port('r1', 'output', 'exhausted'),
        edge('b', 'r2'),
        port('r2', 'output', 'approved'),
        port('r2', 'r1', 'rejected'),
        { ...port('r2', 'output', 'exhausted'), id: 'r2-x' },
      ],
    );
    // Tramo de r1: {a, r1}; tramo de r2: {r1, b, r2}: comparten r1 sin contenerse.
    expect(codes(crossed)).toContain('review-return-crossed');
  });
});

describe('SPEC-034 · Revisión con retorno: ejecución', () => {
  it('[R34.6] lee el último VEREDICTO escrito, sin llamar a la IA', () => {
    expect(parseVerdict('VEREDICTO: RECHAZADO\n…\n**Veredicto:** aprobado')).toBe('approved');
    expect(parseVerdict('Antes: VEREDICTO: RECHAZADO. Al final VEREDICTO: **APROBADO**')).toBe('approved');
    expect(parseVerdict('verdict: rejected')).toBe('rejected');
    expect(parseVerdict('Sin veredicto')).toBeUndefined();
  });

  it('[R34.6] sin veredicto escrito (o en modo ai) decide la IA con el criterio', async () => {
    const { orch, decider } = setup({ scripts: { qa: { output: 'Todo bien' } }, decider: { judge: () => ({ done: true, reason: 'cumple' }) } });
    const r = await orch.start(qaLoop(), 'pedido').result;
    expect(r.status).toBe('succeeded');
    expect(decider.judgeCalls).toHaveLength(1);
    expect(ofType(r.events, 'decision').some((e) => e.kind === 'judge' && e.nodeId === 'rev')).toBe(true);
    expect(ofType(r.events, 'review.decided')[0]).toMatchObject({ verdict: 'approved', source: 'ai', reason: 'cumple' });

    const ai = setup({ scripts: { qa: { output: 'VEREDICTO: RECHAZADO' } }, decider: { judge: () => ({ done: true, reason: 'ok' }) } });
    const d = qaLoop(3, 'ai');
    d.nodes = d.nodes.map((n) => (n.id === 'rev' ? review('rev', 3, 'ai', 'Usa la paleta') : n));
    const r2 = await ai.orch.start(d, 'x').result;
    expect(r2.status).toBe('succeeded');
    expect((ai.decider.judgeCalls[0] as { prompt: string }).prompt).toBe('Usa la paleta');
  });

  it('[R34.7][R34.8][R34.11] rechaza, vuelve al diseñador con las correcciones y luego aprueba', async () => {
    let qaCalls = 0;
    const { orch, agents } = setup({
      scripts: {
        dis: { output: () => `diseño v${agents.callsOf('dis').length}`, files: ['a.png'] },
        qa: { output: () => (++qaCalls === 1 ? 'Falta contraste.\nVEREDICTO: RECHAZADO' : 'VEREDICTO: APROBADO') },
      },
    });
    const r = await orch.start(qaLoop(), 'Haz el logo').result;
    expect(r.status).toBe('succeeded');
    expect(agents.callsOf('dis')).toHaveLength(2);
    const second = agents.callsOf('dis')[1]!.input;
    expect(second.text).toContain('Haz el logo');
    expect(second.text).toContain('Revisión · vuelta 2 de 3');
    expect(second.text).toContain('### Tu entrega anterior\n\ndiseño v1');
    expect(second.text).toContain('### Correcciones pedidas\n\nFalta contraste.');
    expect(second.files).toContain('a.png');
    expect(r.output!.text).toBe('VEREDICTO: APROBADO');
    const decided = ofType(r.events, 'review.decided');
    expect(decided.map((e) => e.verdict)).toEqual(['rejected', 'approved']);
    expect(decided[0]).toMatchObject({ round: 1, max: 3, source: 'verdict', returnTo: 'dis' });
    expect(ofType(r.events, 'edge.traversed').filter((e) => e.edgeId === 'rev->dis')).toHaveLength(1);
    expect(ofType(r.events, 'edge.traversed').some((e) => e.edgeId === 'rev->output:x')).toBe(false);
  });

  it('[R34.9][R34.11] si siempre rechaza, sale por Agotado en la última vuelta', async () => {
    let n = 0;
    const { orch, agents } = setup({ scripts: { qa: { output: () => `fallo ${++n}\nVEREDICTO: RECHAZADO` } } });
    const r = await orch.start(qaLoop(3), 'x').result;
    expect(r.status).toBe('succeeded');
    expect(agents.callsOf('dis')).toHaveLength(3);
    const third = agents.callsOf('dis')[2]!.input.text;
    expect(third).toContain('vuelta 3 de 3');
    expect(third).toContain('### Correcciones de vueltas anteriores\n\n- Vuelta 1: fallo 1');
    const decided = ofType(r.events, 'review.decided');
    expect(decided.map((e) => e.verdict)).toEqual(['rejected', 'rejected', 'exhausted']);
    expect(r.output!.text).toContain('fallo 3');
    expect(ofType(r.events, 'edge.traversed').some((e) => e.edgeId === 'rev->output:x')).toBe(true);
    expect(nodeFinished(r.events, 'output')?.status).toBe('succeeded');
  });

  it('[R34.11] recorta cada corrección anterior a 600 caracteres', () => {
    const p = composeRoundInput({ round: 3, max: 3, original: { text: 'o', files: [] }, feedback: { text: 'f', files: [] }, earlier: ['x'.repeat(900)] });
    expect(p.text).toContain(`- Vuelta 1: ${'x'.repeat(600)}…`);
    expect(p.text).not.toContain('x'.repeat(601));
  });

  it('[R34.10] ✗ hacia delante es una rama normal; sin ✗ conectado la revisión falla', async () => {
    const fwd = diagram(
      [ENTRY, agent('qa'), review('rev'), agent('arreglo'), OUTPUT],
      [edge('entry', 'qa'), edge('qa', 'rev'), port('rev', 'output', 'approved'), port('rev', 'arreglo', 'rejected'), edge('arreglo', 'output')],
    );
    const a = setup({ scripts: { qa: { output: 'VEREDICTO: RECHAZADO' } } });
    const r = await a.orch.start(fwd, 'x').result;
    expect(r.status).toBe('succeeded');
    expect(a.agents.callsOf('arreglo')).toHaveLength(1);
    expect(ofType(r.events, 'review.decided')[0]!.verdict).toBe('rejected');

    const none = diagram([ENTRY, agent('qa'), review('rev'), OUTPUT], [edge('entry', 'qa'), edge('qa', 'rev'), port('rev', 'output', 'approved')]);
    const b = setup({ scripts: { qa: { output: 'VEREDICTO: RECHAZADO' } } });
    const r2 = await b.orch.start(none, 'x').result;
    expect(r2.status).toBe('failed');
    expect(ofType(r2.events, 'error').some((e) => e.message.includes('Rechazado'))).toBe(true);
  });

  it('[R34.12] review.decided lleva vuelta, máximo, veredicto y origen', async () => {
    const { orch } = setup({ scripts: { qa: { output: 'VEREDICTO: APROBADO' } } });
    const r = await orch.start(qaLoop(2), 'x').result;
    expect(ofType(r.events, 'review.decided')).toEqual([expect.objectContaining({ nodeId: 'rev', round: 1, max: 2, verdict: 'approved', source: 'verdict' })]);
  });

  it('[R34.13] una revisión anidada reinicia su cuenta y su entrada original en cada vuelta exterior', async () => {
    // entry → a → r1 (✗→a, ✓→b, ⏱→b) → b → r2 (✗→a, ✓→output, ⏱→output)
    const d = diagram(
      [ENTRY, agent('a'), review('r1', 2), agent('b'), review('r2', 2), OUTPUT],
      [
        edge('entry', 'a'),
        edge('a', 'r1'),
        port('r1', 'a', 'rejected'),
        port('r1', 'b', 'approved'),
        { ...port('r1', 'b', 'exhausted'), id: 'r1-x' },
        edge('b', 'r2'),
        port('r2', 'a', 'rejected'),
        port('r2', 'output', 'approved'),
        { ...port('r2', 'output', 'exhausted'), id: 'r2-x' },
      ],
    );
    expect(validateDiagram(d)).toEqual([]);
    let bCalls = 0;
    const { orch, agents } = setup({
      scripts: {
        // a siempre rechazado por r1 → agota r1 (2 vueltas) en cada vuelta de r2.
        a: { output: () => 'VEREDICTO: RECHAZADO' },
        b: { output: () => (++bCalls === 1 ? 'mal\nVEREDICTO: RECHAZADO' : 'VEREDICTO: APROBADO') },
      },
    });
    const r = await orch.start(d, 'inicio').result;
    expect(r.status).toBe('succeeded');
    // Vuelta exterior 1: a ×2 (r1 agota) · vuelta exterior 2: a ×2 otra vez.
    expect(agents.callsOf('a')).toHaveLength(4);
    const r1 = ofType(r.events, 'review.decided').filter((e) => e.nodeId === 'r1');
    expect(r1.map((e) => `${e.round}:${e.verdict}`)).toEqual(['1:rejected', '2:exhausted', '1:rejected', '2:exhausted']);
    // En la vuelta exterior 2, la «entrada original» de r1 es la que trae las correcciones de r2.
    const fourth = agents.callsOf('a')[3]!.input.text;
    expect(fourth).toContain('vuelta 2 de 2');
    expect(fourth.indexOf('Correcciones pedidas\n\nmal')).toBeGreaterThan(-1);
  });

  it('[R34.14] cancelar durante una vuelta detiene la ejecución sin más vueltas', async () => {
    const gate = deferred();
    let dis = 0;
    const { orch, agents } = setup({
      scripts: {
        dis: { output: () => `v${++dis}` },
        qa: { output: 'VEREDICTO: RECHAZADO' },
      },
    });
    // La segunda llamada al diseñador se queda esperando.
    const scripts = (agents as unknown as { scripts: Record<string, { waitFor?: Promise<void> }> }).scripts;
    const h = orch.start(qaLoop(3), 'x');
    await waitForEvent(h.bus, (e) => e.type === 'review.decided');
    scripts['dis']!.waitFor = gate.promise;
    await waitForEvent(h.bus, (e) => e.type === 'agent.request' && e.nodeId === 'dis' && e.input.text.includes('vuelta 2'));
    h.cancel('basta');
    const r = await h.result;
    expect(r.status).toBe('cancelled');
    expect(agents.callsOf('dis')).toHaveLength(2);
    expect(ofType(r.events, 'review.decided')).toHaveLength(1);
  });

  it('[R34.14] el presupuesto se aplica en cada vuelta', async () => {
    const { orch, agents } = setup({ scripts: { dis: { usage: { inputTokens: 60, outputTokens: 0 } }, qa: { output: 'VEREDICTO: RECHAZADO' } } });
    const r = await orch.start(qaLoop(3), 'x', { budget: { maxTokens: 100 } }).result;
    expect(r.status).toBe('failed');
    expect(r.reason).toBe('budget_exceeded');
    expect(agents.callsOf('dis')).toHaveLength(2);
  });
});
