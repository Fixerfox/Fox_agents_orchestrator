import { describe, expect, it } from 'vitest';
import { MockAgent, MockDecider, Orchestrator, replayPlan, stepKey, stepKeysOf, type AgentAdapter, type AgentRequest, type Diagram, type RunEvent, type RunOptions } from '../src';
import { INTERRUPTED_MESSAGE } from '../src/execution/nodes/agent';
import { ENTRY, OUTPUT, agent, chain, diagram, edge, loop, ofType, router, sub } from './helpers';

type Scripts = ConstructorParameters<typeof MockAgent>[0];

/** Primera ejecución: se corta (cancela) en cuanto `when` lo diga; la segunda reanuda con su plan. */
async function cutAndResume(d: Diagram, first: Scripts, second: Scripts, when: (e: RunEvent) => boolean, deciders: [MockDecider, MockDecider] = [new MockDecider(), new MockDecider()], answer?: (e: Extract<RunEvent, { type: 'agent.question' }>) => string, templates?: Record<string, Diagram>) {
  const run = (scripts: Scripts, decider: MockDecider, options: RunOptions = {}, cut = false) => {
    const agents = new MockAgent(scripts);
    const orch = new Orchestrator({ getAdapter: () => agents, decider, ...(templates ? { resolveTemplate: (id: string) => templates[id]! } : {}) });
    const h = orch.start(d, 'Pedido', options);
    h.bus.subscribe((e) => {
      if (cut && when(e)) h.cancel('corte');
      if (e.type === 'agent.question' && answer) setTimeout(() => h.answer(e.questionId, answer(e)), 0);
    });
    return { agents, result: h.result };
  };
  const a = run(first, deciders[0], {}, true);
  const r1 = await a.result;
  const plan = replayPlan(r1.events);
  const b = run(second, deciders[1], { reuse: { fromRunId: r1.runId, outputs: plan.outputs, approvedReviews: plan.approvedReviews, trail: plan.trail, decisions: plan.decisions, answers: plan.answers, interrupted: plan.interrupted, costs: plan.costs } });
  const r2 = await b.result;
  return { r1, r2, first: a.agents, second: b.agents, plan };
}

const never = new Promise<void>(() => {});

describe('SPEC-074 · claves de paso', () => {
  it('[R74.1] cada paso tiene su clave: ruta, nodo y pasada, que se cuenta por sus node.started', async () => {
    expect(stepKey(['L'], 'a', 2)).toBe('L/a#2');
    const d = diagram([ENTRY, loop('L', { mode: 'count', count: 3, maxIterations: 3, body: chain(['a'], 'body') }), OUTPUT], [edge('entry', 'L'), edge('L', 'output')]);
    const { events } = await new Orchestrator({ getAdapter: () => new MockAgent({}), decider: new MockDecider() }).start(d, 'x').result;
    const keys = stepKeysOf(events);
    const finished = ofType(events, 'node.finished').filter((e) => e.nodeId === 'a').map((e) => keys.get(e.seq));
    expect(finished).toEqual(['L/a#1', 'L/a#2', 'L/a#3']);
    expect(keys.get(ofType(events, 'loop.iteration')[1]!.seq)).toBe('L#1');
  });
});

describe('SPEC-074 · reanudar reproduciendo', () => {
  it('[R74.2][R74.3] E74.a: un bucle cortado en la vuelta 3 reutiliza las vueltas 1 y 2 con sus veredictos', async () => {
    const d = diagram([ENTRY, loop('L', { mode: 'ai-judge', prompt: '¿basta?', maxIterations: 5, body: chain(['a'], 'body') }), OUTPUT], [edge('entry', 'L'), edge('L', 'output')]);
    let n = 0;
    let requests = 0;
    const judge1 = new MockDecider({ judge: (r) => ({ done: r.iteration >= 4, reason: `vuelta ${r.iteration}` }) });
    const judge2 = new MockDecider({ judge: (r) => ({ done: r.iteration >= 4, reason: `otra ${r.iteration}` }) });
    const { r2, second } = await cutAndResume(d, { a: { output: () => `v${++n}`, latencyMs: 5 } }, { a: { output: (req) => `nueva desde ${req.input.text}` } }, (e) => e.type === 'agent.request' && e.nodeId === 'a' && ++requests === 3, [judge1, judge2]);
    expect(ofType(r2.events, 'node.reused').map((e) => e.nodeId)).toEqual(['a', 'a']);
    expect(ofType(r2.events, 'decision').filter((e) => e.reused).map((e) => (e.response as { reason: string }).reason)).toEqual(['vuelta 1', 'vuelta 2']);
    // Solo se pregunta al juez por las vueltas que se repiten.
    expect(judge2.judgeCalls).toHaveLength(2);
    expect(second.callsOf('a')).toHaveLength(2);
    expect(second.callsOf('a')[0]!.input.text).toBe('v2');
    expect(r2.status).toBe('succeeded');
  });

  it('[R74.3][R74.4] E74.b: el router elige lo mismo sin consultar a la IA', async () => {
    const d = diagram([ENTRY, router('r', 'ai'), agent('f'), agent('b'), agent('fin'), OUTPUT], [edge('entry', 'r'), edge('r', 'f'), edge('r', 'b'), edge('f', 'fin'), edge('b', 'fin'), edge('fin', 'output')]);
    const pick = (id: string) => new MockDecider({ route: (req) => ({ edgeIds: req.candidates.filter((c) => c.to === id).map((c) => c.edgeId), reason: `elige ${id}` }) });
    const later = pick('b');
    const { r2 } = await cutAndResume(d, { f: {}, fin: { waitFor: never } }, { f: {}, fin: {} }, (e) => e.type === 'agent.request' && e.nodeId === 'fin', [pick('f'), later]);
    expect(later.routeCalls).toHaveLength(0);
    expect(ofType(r2.events, 'route.decided')[0]).toMatchObject({ chosen: ['f'], reason: 'elige f' });
    expect(ofType(r2.events, 'decision')[0]).toMatchObject({ kind: 'route', reused: true });
    expect(ofType(r2.events, 'agent.usage').filter((e) => e.source === 'decision')).toEqual([]);
  });

  it('[R74.4] si la ruta de entonces ya no existe, se decide otra vez y se avisa', async () => {
    const d = diagram([ENTRY, router('r', 'ai'), agent('f'), OUTPUT], [edge('entry', 'r'), edge('r', 'f'), edge('f', 'output')]);
    const decider = new MockDecider();
    const orch = new Orchestrator({ getAdapter: () => new MockAgent({}), decider });
    const { events } = await orch.start(d, 'x', { reuse: { fromRunId: 'antes', outputs: {}, decisions: { 'r#1': [{ kind: 'route', response: { edgeIds: ['ya-no-existe'], reason: 'vieja' } }] } } }).result;
    expect(decider.routeCalls).toHaveLength(1);
    expect(ofType(events, 'supervisor.alert')).toMatchObject([{ nodeId: 'r', rule: 'resume-diverged' }]);
  });

  it('[R74.5][R74.6] E74.c: el paso cortado se repite con lo que ya se respondió y no vuelve a preguntar', async () => {
    const d = chain(['a', 'b']);
    // Primera: «b» pregunta, toca un archivo y se queda trabajando hasta que se corta.
    const stuck: AgentAdapter = {
      async *run(req, signal) {
        if (req.agentId === 'a') {
          yield { type: 'result', text: 'plan' };
          return;
        }
        await req.ask({ text: '¿Color?', kind: 'question' });
        yield { type: 'file', path: 'b.css', change: 'created' };
        await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
      },
    };
    const o1 = new Orchestrator({ getAdapter: () => stuck, decider: new MockDecider() });
    const h1 = o1.start(d, 'Pedido');
    h1.bus.subscribe((e) => {
      if (e.type === 'agent.question') setTimeout(() => h1.answer(e.questionId, 'Azul'), 0);
      if (e.type === 'file.produced') setTimeout(() => h1.cancel('corte'), 0);
    });
    const r1 = await h1.result;
    const plan = replayPlan(r1.events);
    expect(plan.interrupted).toEqual({ 'b#1': { files: ['b.css'] } });
    // Segunda: «b» vuelve a preguntar lo mismo (un agente no sabe que ya se respondió).
    const calls: AgentRequest[] = [];
    const replies: string[] = [];
    const again: AgentAdapter = {
      async *run(req) {
        calls.push(req);
        replies.push(await req.ask({ text: '¿Color?', kind: 'question' }));
        yield { type: 'result', text: 'hecho' };
      },
    };
    const second = { callsOf: (id: string) => calls.filter((c) => c.agentId === id) };
    const h2 = new Orchestrator({ getAdapter: () => again, decider: new MockDecider() }).start(d, 'Pedido', { reuse: { fromRunId: r1.runId, outputs: plan.outputs, answers: plan.answers, interrupted: plan.interrupted } });
    const asked: string[] = [];
    h2.bus.subscribe((e) => e.type === 'agent.question' && asked.push(e.text));
    const r2 = await h2.result;
    expect(r2.status).toBe('succeeded');
    const call = second.callsOf('b')[0]!;
    expect(call.previousAnswers).toEqual([{ question: '¿Color?', answer: 'Azul' }]);
    expect(call.previousAttempt).toMatchObject({ ended: 'interrupted', message: INTERRUPTED_MESSAGE, files: [{ path: 'b.css' }] });
    // La pregunta sale, pero se responde sola con lo de entonces.
    expect(ofType(r2.events, 'agent.answer')).toMatchObject([{ text: 'Azul', reused: true }]);
    expect(replies).toEqual(['Azul']);
    expect(asked).toEqual(['¿Color?']);
    expect(second.callsOf('a')).toHaveLength(0);
  });

  it('[R74.2] se reutilizan pasos dentro de un subdiagrama a medias', async () => {
    const tpl = chain(['s1', 's2'], 'tpl');
    const d = diagram([ENTRY, sub('S', 'tpl'), OUTPUT], [edge('entry', 'S'), edge('S', 'output')]);
    const { r2, second } = await cutAndResume(d, { s1: { output: 'uno' }, s2: { waitFor: never } }, { s1: { output: 'repetido' }, s2: {} }, (e) => e.type === 'agent.request' && e.nodeId === 's2', undefined, undefined, { tpl });
    expect(second.callsOf('s1')).toHaveLength(0);
    expect(ofType(r2.events, 'node.reused')).toMatchObject([{ nodeId: 's1', nodePath: ['S'] }]);
    expect(second.callsOf('s2')[0]!.input.text).toBe('uno');
  });

  it('[R74.7] al corregir no se reutilizan las decisiones', async () => {
    const d = diagram([ENTRY, router('r', 'ai'), agent('f'), OUTPUT], [edge('entry', 'r'), edge('r', 'f'), edge('f', 'output')]);
    const decider = new MockDecider();
    const orch = new Orchestrator({ getAdapter: () => new MockAgent({}), decider });
    // Una corrección solo pasa las salidas: sin decisiones, el router decide otra vez.
    await orch.start(d, 'x', { reuse: { fromRunId: 'antes', outputs: {} }, correction: { fromRunId: 'antes', nodeId: 'f', text: 'otra', previous: { text: 'y', files: [] } } }).result;
    expect(decider.routeCalls).toHaveLength(1);
  });

  it('[R74.8] una revisión humana aprobada se reutiliza por su clave, también dentro de un bucle', async () => {
    const body = diagram([ENTRY, agent('a'), { id: 'rv', kind: 'review', label: 'Revisión', review: { mode: 'human', maxRounds: 2 } }, OUTPUT], [edge('entry', 'a'), edge('a', 'rv'), { id: 'ok', from: 'rv', to: 'output', port: 'approved' }, { id: 'no', from: 'rv', to: 'output', port: 'rejected' }], 'body');
    const d = diagram([ENTRY, loop('L', { mode: 'count', count: 1, maxIterations: 1, body }), OUTPUT], [edge('entry', 'L'), edge('L', 'output')]);
    const questions: string[] = [];
    const orch = new Orchestrator({ getAdapter: () => new MockAgent({}), decider: new MockDecider() });
    const h = orch.start(d, 'x', { reuse: { fromRunId: 'antes', outputs: {}, approvedReviews: ['L/rv#1'] } });
    h.bus.subscribe((e) => e.type === 'agent.question' && questions.push(e.text));
    const { events } = await h.result;
    expect(questions).toEqual([]);
    expect(ofType(events, 'review.decided')).toMatchObject([{ verdict: 'approved', source: 'reused' }]);
  });

  it('[R74.14] lo de una rama aislada que no llegó a juntarse no se reutiliza', () => {
    let seq = 0;
    const ev = (b: Record<string, unknown>) => ({ runId: 'r', seq: ++seq, ts: 't', ...b }) as unknown as RunEvent;
    const plan = replayPlan([
      ev({ type: 'workspace.opened', regionId: 'o', branchNodeIds: ['a'], strategy: 'copy' }),
      ev({ type: 'node.started', nodeId: 'a' }),
      ev({ type: 'agent.request', nodeId: 'a', agentId: 'a', attempt: 1, input: { text: '', files: [] } }),
      ev({ type: 'node.finished', nodeId: 'a', status: 'succeeded', output: { text: 'A', files: [] } }),
      ev({ type: 'node.started', nodeId: 'b' }),
      ev({ type: 'agent.request', nodeId: 'b', agentId: 'b', attempt: 1, input: { text: '', files: [] } }),
      ev({ type: 'node.finished', nodeId: 'b', status: 'succeeded', output: { text: 'B', files: [] } }),
    ]);
    expect(Object.keys(plan.outputs)).toEqual(['b#1']);
  });
});

describe('SPEC-074 · validar antes de empezar', () => {
  it('[R74.9] E74.d: un subdiagrama con un tipo desconocido hace fallar la ejecución antes del primer paso', async () => {
    const bad = diagram([ENTRY, { id: 'x', kind: 'raro' } as never, OUTPUT], [edge('entry', 'x'), edge('x', 'output')], 'tpl');
    const d = diagram([ENTRY, agent('a'), sub('S', 'tpl'), OUTPUT], [edge('entry', 'a'), edge('a', 'S'), edge('S', 'output')]);
    const agents = new MockAgent({});
    const r = await new Orchestrator({ getAdapter: () => agents, decider: new MockDecider(), resolveTemplate: () => bad }).start(d, 'x').result;
    expect(r.status).toBe('failed');
    expect(agents.calls).toHaveLength(0);
    expect(ofType(r.events, 'node.started')).toEqual([]);
    expect(ofType(r.events, 'error')).toMatchObject([{ nodePath: ['S'], message: 'No se sabe ejecutar el tipo de nodo «raro»' }]);
  });

  it('[R74.9] referencias circulares y profundidad se ven antes de empezar, con su ruta', async () => {
    const loopy = diagram([ENTRY, sub('S2', 'tpl'), OUTPUT], [edge('entry', 'S2'), edge('S2', 'output')], 'tpl');
    const d = diagram([ENTRY, sub('S', 'tpl'), OUTPUT], [edge('entry', 'S'), edge('S', 'output')]);
    const r = await new Orchestrator({ getAdapter: () => new MockAgent({}), decider: new MockDecider(), resolveTemplate: () => loopy }).start(d, 'x').result;
    expect(r).toMatchObject({ status: 'failed', reason: 'invalid-diagram' });
    expect(ofType(r.events, 'error')[0]).toMatchObject({ nodePath: ['S'] });
    expect(ofType(r.events, 'error')[0]!.message).toContain('Referencia circular');
  });
});
