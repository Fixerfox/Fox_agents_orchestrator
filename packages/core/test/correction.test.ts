import { describe, expect, it } from 'vitest';
import {
  approvedReviews,
  composeCorrectionInput,
  correctionCandidates,
  correctionPlan,
  correctionTargets,
  matchCandidate,
  MockDecider,
  resumePlan,
  validateDiagram,
  type AgentAdapter,
  type AgentRequest,
  type Diagram,
  type DiagramNode,
  type Edge,
  type Id,
  type ReviewPort,
  type RunEvent,
} from '../src';
import { ENTRY, OUTPUT, agent, chain, diagram, edge, ofType, setup, waitForEvent } from './helpers';

const human = (id: Id, maxRounds = 3, route?: 'propose' | 'auto'): DiagramNode => ({ id, kind: 'review', label: id, review: { maxRounds, mode: 'human', ...(route ? { route } : {}) } });
const port = (from: Id, to: Id, p: ReviewPort, id = `${from}->${to}:${p}`): Edge => ({ id, from, to, port: p });
const codes = (d: Diagram) => validateDiagram(d).map((i) => i.code);

/** Entrada → a → b → revisión humana (✓ y ⏱ a la Salida, ✗ sin conectar). */
function gate(max = 3, route?: 'propose' | 'auto'): Diagram {
  return diagram(
    [ENTRY, agent('a', 'Analista'), agent('b', 'Builder'), human('rev', max, route), OUTPUT],
    [edge('entry', 'a'), edge('a', 'b'), edge('b', 'rev'), port('rev', 'output', 'approved'), port('rev', 'output', 'exhausted')],
  );
}

/** Adaptador que cuenta llamadas y devuelve «agente#n» para poder seguir qué recibe cada paso. */
function echo() {
  const calls: AgentRequest[] = [];
  let n = 0;
  const adapter: AgentAdapter = {
    async *run(req: AgentRequest) {
      calls.push(req);
      n += 1;
      yield { type: 'result', text: `${req.agentId}#${n}` };
    },
  };
  return { calls, adapter, names: () => calls.map((c) => c.agentId) };
}

type Q = Extract<RunEvent, { type: 'agent.question' }>;
const isReviewQ = (phase: 'feedback' | 'route', round = 1) => (e: RunEvent) => e.type === 'agent.question' && e.review?.phase === phase && e.review.round === round;

describe('SPEC-053 · revisión humana (motor)', () => {
  it('[R53.1] valida el modo humano, su destino y «route»', () => {
    expect(validateDiagram(gate())).toEqual([]);
    const noTimeout = gate();
    noTimeout.edges = noTimeout.edges.filter((e) => e.port !== 'exhausted');
    expect(codes(noTimeout)).toContain('review-no-exhausted');
    const nowhere = diagram([ENTRY, human('rev'), OUTPUT], [edge('entry', 'rev'), port('rev', 'output', 'approved'), port('rev', 'output', 'exhausted')]);
    expect(codes(nowhere)).toContain('review-human-no-target');
    const bad = gate();
    bad.nodes = bad.nodes.map((n) => (n.id === 'rev' ? { ...n, review: { maxRounds: 3, mode: 'verdict' as const, route: 'auto' as const } } : n));
    expect(codes(bad)).toContain('review-route-not-human');
    // Con ✗ conectada no hace falta destino elegido.
    const drawn = diagram([ENTRY, human('rev'), OUTPUT, agent('x')], [edge('entry', 'rev'), port('rev', 'output', 'approved'), port('rev', 'x', 'rejected'), edge('x', 'output')]);
    expect(codes(drawn)).not.toContain('review-human-no-target');
  });

  it('[R53.2] candidatos: pasos que llegan a la revisión con un tramo de una entrada y una salida, sin cruzar retornos', () => {
    expect(correctionCandidates(gate(), 'rev')).toEqual(['a', 'b']);
    // «b» y «x» no valen: lo de la otra rama entra al tramo por la revisión.
    const side = diagram(
      [ENTRY, agent('a'), agent('b'), agent('x'), human('rev'), OUTPUT],
      [edge('entry', 'a'), edge('a', 'b'), edge('a', 'x'), edge('b', 'rev'), edge('x', 'rev'), port('rev', 'output', 'approved'), port('rev', 'output', 'exhausted')],
    );
    expect(correctionCandidates(side, 'rev')).toEqual(['a']);
    // Un QA que vuelve a «b» desde «qa»: «c» cruzaría su tramo; «a» y «b» lo dejan dentro.
    const qa: DiagramNode = { id: 'qa', kind: 'review', review: { maxRounds: 2, mode: 'verdict' } };
    const nested = diagram(
      [ENTRY, agent('a'), agent('b'), agent('c'), qa, human('rev'), OUTPUT],
      [edge('entry', 'a'), edge('a', 'b'), edge('b', 'c'), edge('c', 'qa'), port('qa', 'rev', 'approved'), port('qa', 'b', 'rejected'), port('qa', 'rev', 'exhausted', 'qa-x'), port('rev', 'output', 'approved'), port('rev', 'output', 'exhausted')],
    );
    expect(correctionCandidates(nested, 'rev')).toEqual(['a', 'b']);
  });

  it('[R53.3] pregunta al usuario con lo que llega y «Aprobar»; al aprobar sale por ✓', async () => {
    const e = echo();
    const { orch } = setup({ adapter: e.adapter });
    const h = orch.start(gate(), 'pide');
    const q = (await waitForEvent(h.bus, isReviewQ('feedback'))) as Q;
    expect(q).toMatchObject({ nodeId: 'rev', text: 'b#2', options: ['Aprobar'], review: { round: 1, max: 3, phase: 'feedback' } });
    expect(h.pendingQuestions()[0]!.review).toMatchObject({ phase: 'feedback' });
    h.answer(q.questionId, ' APROBAR ');
    const r = await h.result;
    expect(r.status).toBe('succeeded');
    expect(e.names()).toEqual(['a', 'b']);
    expect(ofType(r.events, 'review.decided')).toEqual([expect.objectContaining({ nodeId: 'rev', verdict: 'approved', source: 'human' })]);
  });

  it('[R53.4] con ✗ dibujada vuelve por la flecha con las correcciones del usuario', async () => {
    const d = diagram(
      [ENTRY, agent('a'), human('rev', 2), OUTPUT],
      [edge('entry', 'a'), edge('a', 'rev'), port('rev', 'output', 'approved'), port('rev', 'a', 'rejected'), port('rev', 'output', 'exhausted')],
    );
    const e = echo();
    const { orch } = setup({ adapter: e.adapter });
    const h = orch.start(d, 'pide');
    h.answer(((await waitForEvent(h.bus, isReviewQ('feedback'))) as Q).questionId, 'Cambia el título');
    const q2 = (await waitForEvent(h.bus, isReviewQ('feedback', 2))) as Q;
    expect(e.calls[1]!.input.text).toContain('## Revisión humana · vuelta 2 de 2');
    expect(e.calls[1]!.input.text).toContain('Cambia el título');
    h.answer(q2.questionId, 'Sigue mal');
    const r = await h.result;
    // Última vuelta: sale por ⏱ sin volver a ejecutar.
    expect(e.names()).toEqual(['a', 'a']);
    expect(ofType(r.events, 'review.decided').map((x) => x.verdict)).toEqual(['rejected', 'exhausted']);
    expect(ofType(r.events, 'agent.question').filter((x) => x.review?.phase === 'route')).toHaveLength(0);
  });

  it('[R53.5][R53.6] sin ✗ propone un paso, el usuario elige otro por su nombre y se repite desde ahí', async () => {
    const e = echo();
    const { orch, decider } = setup({ adapter: e.adapter });
    const h = orch.start(gate(), 'pide');
    h.answer(((await waitForEvent(h.bus, isReviewQ('feedback'))) as Q).questionId, 'Falta la US3');
    const route = (await waitForEvent(h.bus, isReviewQ('route'))) as Q;
    // El simulado propone el más cercano; el propuesto va primero.
    expect(route.review).toMatchObject({ phase: 'route', proposal: 'b', candidates: [{ nodeId: 'a', label: 'Analista' }, { nodeId: 'b', label: 'Builder' }] });
    expect(route.options).toEqual(['Builder', 'Analista']);
    expect(decider.blameCalls[0]).toMatchObject({ feedback: 'Falta la US3', candidates: [{ nodeId: 'a', output: { text: 'a#1' } }, { nodeId: 'b', output: { text: 'b#2' } }] });
    h.answer(route.questionId, 'analista');
    const q2 = (await waitForEvent(h.bus, isReviewQ('feedback', 2))) as Q;
    expect(e.names()).toEqual(['a', 'b', 'a', 'b']);
    const again = e.calls[2]!.input.text;
    expect(again.startsWith('pide')).toBe(true);
    expect(again).toContain('## Revisión humana · vuelta 2 de 3');
    expect(again).toContain('### Tu entrega anterior\n\na#1');
    expect(again).toContain('### Correcciones pedidas\n\nFalta la US3');
    h.answer(q2.questionId, 'Aprobar');
    const r = await h.result;
    expect(r.status).toBe('succeeded');
    expect(ofType(r.events, 'correction.routed')).toEqual([expect.objectContaining({ nodeId: 'rev', round: 1, targetId: 'a', by: 'user' })]);
    expect(ofType(r.events, 'review.decided')[0]).toMatchObject({ verdict: 'rejected', source: 'human', returnTo: 'a' });
  });

  it('[R53.5] «Lo decide el asistente solo» no pregunta el destino; una respuesta inválida de Claude cae en el más cercano', async () => {
    const e = echo();
    const { orch } = setup({ adapter: e.adapter, decider: { blame: () => ({ nodeId: 'a', reason: 'faltan tareas' }) } });
    const h = orch.start(gate(3, 'auto'), 'pide');
    h.answer(((await waitForEvent(h.bus, isReviewQ('feedback'))) as Q).questionId, 'Falta algo');
    h.answer(((await waitForEvent(h.bus, isReviewQ('feedback', 2))) as Q).questionId, 'Aprobar');
    const r = await h.result;
    expect(ofType(r.events, 'agent.question').filter((x) => x.review?.phase === 'route')).toHaveLength(0);
    expect(ofType(r.events, 'correction.routed')[0]).toMatchObject({ targetId: 'a', by: 'assistant', reason: 'faltan tareas' });
    expect(e.names()).toEqual(['a', 'b', 'a', 'b']);

    const e2 = echo();
    const h2 = setup({ adapter: e2.adapter, decider: { blame: () => ({ nodeId: 'zzz', reason: 'x' }) } }).orch.start(gate(3, 'auto'), 'pide');
    h2.answer(((await waitForEvent(h2.bus, isReviewQ('feedback'))) as Q).questionId, 'Falta algo');
    h2.answer(((await waitForEvent(h2.bus, isReviewQ('feedback', 2))) as Q).questionId, 'Aprobar');
    expect(ofType((await h2.result).events, 'correction.routed')[0]).toMatchObject({ targetId: 'b' });
    expect(matchCandidate('nada', [{ nodeId: 'a', label: 'A' }], 'a')).toBe('a');
    expect(matchCandidate(' B ', [{ nodeId: 'a', label: 'A' }, { nodeId: 'x', label: 'b' }], 'a')).toBe('x');
  });

  it('[R53.5] en la última vuelta pedir cambios sale por ⏱', async () => {
    const e = echo();
    const h = setup({ adapter: e.adapter }).orch.start(gate(1), 'pide');
    h.answer(((await waitForEvent(h.bus, isReviewQ('feedback'))) as Q).questionId, 'No me gusta');
    const r = await h.result;
    expect(r.status).toBe('succeeded');
    expect(ofType(r.events, 'review.decided')[0]).toMatchObject({ verdict: 'exhausted', source: 'human' });
    expect(e.names()).toEqual(['a', 'b']);
  });

  it('[R53.3] al cancelar mientras espera, la ejecución queda cancelada', async () => {
    const h = setup().orch.start(gate(), 'pide');
    await waitForEvent(h.bus, isReviewQ('feedback'));
    h.cancel('basta');
    expect((await h.result).status).toBe('cancelled');
  });
});

describe('SPEC-053 · corregir una ejecución terminada (motor)', () => {
  it('[R53.7] pasos corregibles y plan: se reutiliza lo anterior y no lo que depende del paso', async () => {
    const d = chain(['a', 'b', 'c']);
    const first = await setup().orch.start(d, 'pide').result;
    expect(correctionTargets(d, first.events)).toEqual(['a', 'b', 'c']);
    const plan = correctionPlan(d, first.events, 'b');
    expect(Object.keys(plan.outputs)).toEqual(['a']);
    expect(plan.previous).toEqual(resumePlan(d, first.events)['b']);
    expect(plan.approvedReviews).toEqual([]);
  });

  it('[R53.8] el paso corregido recibe la corrección; lo anterior se reutiliza y lo posterior se repite', async () => {
    const d = chain(['a', 'b', 'c']);
    const first = await setup({ adapter: echo().adapter }).orch.start(d, 'pide').result;
    const plan = correctionPlan(d, first.events, 'b');
    const e2 = echo();
    const r = await setup({ adapter: e2.adapter }).orch.start(d, 'pide', {
      reuse: { fromRunId: 'old', outputs: plan.outputs },
      correction: { fromRunId: 'old', nodeId: 'b', text: 'Usa la numeración seguida', previous: plan.previous!, files: ['captura.png'] },
    }).result;
    expect(r.status).toBe('succeeded');
    expect(e2.names()).toEqual(['b', 'c']);
    const input = e2.calls[0]!.input;
    expect(input.text).toBe(composeCorrectionInput({ input: { text: 'a#1', files: [] }, previous: plan.previous!, text: 'Usa la numeración seguida' }).text);
    expect(input.text).toContain('## Corrección pedida por el usuario');
    expect(input.text).toContain('### Tu entrega anterior\n\nb#2');
    expect(input.files).toContain('captura.png');
    expect(ofType(r.events, 'run.started')[0]).toMatchObject({ correctedFrom: 'old' });
    expect(ofType(r.events, 'run.started')[0]!.resumedFrom).toBeUndefined();
    expect(ofType(r.events, 'correction.applied')).toEqual([expect.objectContaining({ nodeId: 'b', fromRunId: 'old', text: 'Usa la numeración seguida' })]);
  });

  it('[R53.9] una revisión humana ya aprobada no vuelve a preguntar en la siguiente', async () => {
    const d = gate();
    const h = setup().orch.start(d, 'pide');
    h.answer(((await waitForEvent(h.bus, isReviewQ('feedback'))) as Q).questionId, 'Aprobar');
    const first = await h.result;
    expect(approvedReviews(d, first.events)).toEqual(['rev']);
    // «rev» depende de «a»: al corregir «a» vuelve a preguntar.
    expect(correctionPlan(d, first.events, 'a').approvedReviews).toEqual([]);
    const r = await setup().orch.start(d, 'pide', { reuse: { fromRunId: 'old', outputs: resumePlan(d, first.events), approvedReviews: ['rev'] } }).result;
    expect(r.status).toBe('succeeded');
    expect(ofType(r.events, 'agent.question')).toHaveLength(0);
    expect(ofType(r.events, 'review.decided')[0]).toMatchObject({ verdict: 'approved', source: 'reused' });
  });

  it('[R53.10] propuesta: el paso preferido sin llamar a Claude; si no, decide «blame»; sin pasos, error', async () => {
    const d = chain(['a', 'b', 'c']);
    const first = await setup().orch.start(d, 'pide').result;
    const { orch, decider } = setup({ decider: { blame: () => ({ nodeId: 'a', reason: 'empieza ahí' }) } });
    const pref = await orch.proposeCorrection({ diagram: d, events: first.events, text: 'mal', prefer: 'b' });
    expect(pref.proposal).toEqual({ nodeId: 'b', reason: '' });
    expect(pref.candidates.map((c) => c.nodeId)).toEqual(['a', 'b', 'c']);
    expect(decider.blameCalls).toHaveLength(0);
    const asked = await orch.proposeCorrection({ diagram: d, events: first.events, text: 'mal' });
    expect(asked.proposal).toEqual({ nodeId: 'a', reason: 'empieza ahí' });
    expect(decider.blameCalls[0]!.candidates[0]).toMatchObject({ nodeId: 'a', label: 'a', output: { text: expect.any(String) } });
    await expect(orch.proposeCorrection({ diagram: d, events: [], text: 'mal' })).rejects.toThrow(/no tiene pasos/);
  });

  it('[R53.17] el simulado elige el último candidato o lo que diga su configuración', async () => {
    const cands = [{ nodeId: 'a', label: 'A' }, { nodeId: 'b', label: 'B' }];
    expect((await new MockDecider().blame({ feedback: 'x', candidates: cands })).nodeId).toBe('b');
    expect((await new MockDecider({ blame: () => ({ nodeId: 'a', reason: 'r' }) }).blame({ feedback: 'x', candidates: cands })).nodeId).toBe('a');
  });
});
