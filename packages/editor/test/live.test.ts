import { describe, expect, it, vi } from 'vitest';
import { MockAgent, MockDecider, Orchestrator, type Diagram, type RunEvent } from '@orquestador/core';
import { budgetRemaining, deriveLive, transcriptItems, type ProjectApi, RunClient, ok, fail } from '../src';

const E = { id: 'entry', kind: 'entry' as const };
const O = { id: 'output', kind: 'output' as const };
const ag = (id: string) => ({ id, kind: 'agent' as const, agentId: id });
const dia = (nodes: Diagram['nodes'], edges: [string, string][]): Diagram => ({
  id: 'd',
  name: 'D',
  schemaVersion: 1,
  nodes,
  edges: edges.map(([from, to]) => ({ id: `${from}->${to}`, from, to })),
});

async function run(d: Diagram, scripts: ConstructorParameters<typeof MockAgent>[0], answers: string[] = [], judge?: () => { done: boolean; reason: string }) {
  const agent = new MockAgent(scripts);
  const decider = new MockDecider({
    route: (r) => ({ edgeIds: [r.candidates[0]!.edgeId], reason: 'primera ruta' }),
    ...(judge ? { judge } : {}),
  });
  const handle = new Orchestrator({ getAdapter: () => agent, decider }).start(d, 'orden');
  const events: RunEvent[] = [];
  handle.bus.subscribe((e) => {
    events.push(e);
    if (e.type === 'agent.question' && answers.length > 0) queueMicrotask(() => handle.answer(e.questionId, answers.shift()!));
  });
  await handle.result;
  return { events, handle };
}

describe('estado en vivo [R15.1]', () => {
  it('[R15.1] estado de cada nodo, ruta recorrida y resultado final', async () => {
    const d = dia([E, ag('a'), ag('b'), O], [['entry', 'a'], ['a', 'b'], ['b', 'output']]);
    const { events } = await run(d, { a: { output: 'A' }, b: { output: 'B' } });
    const live = deriveLive(events);
    expect(live.status).toBe('succeeded');
    expect(live.nodeStatus).toMatchObject({ entry: 'succeeded', a: 'succeeded', b: 'succeeded', output: 'succeeded' });
    expect([...live.edges].sort()).toEqual(['a->b', 'b->output', 'entry->a']);
    expect(live.finalOutput).toBe('B');
  });

  it('[R15.1] mientras se ejecuta marca running/queued y sin eventos está en reposo', async () => {
    const d = dia([E, ag('a'), O], [['entry', 'a'], ['a', 'output']]);
    const { events } = await run(d, { a: { output: 'A' } });
    const partial = deriveLive(events.slice(0, events.findIndex((e) => e.type === 'node.started' && e.nodeId === 'a') + 1));
    expect(partial.status).toBe('running');
    expect(partial.nodeStatus.a).toBe('running');
    expect(deriveLive([]).status).toBe('idle');
  });

  it('[R15.1] las ramas no elegidas por el router quedan omitidas y fuera de la ruta', async () => {
    const d = dia([E, { id: 'r', kind: 'router', router: { mode: 'ai' } }, ag('x'), ag('y'), O], [['entry', 'r'], ['r', 'x'], ['r', 'y'], ['x', 'output'], ['y', 'output']]);
    const { events } = await run(d, { x: { output: 'X' }, y: { output: 'Y' } });
    const live = deriveLive(events);
    expect(live.nodeStatus.x).toBe('succeeded');
    expect(live.nodeStatus.y).not.toBe('succeeded');
    expect(live.edges.has('r->y')).toBe(false);
    expect(live.edges.has('r->x')).toBe(true);
  });
});

describe('bucles y composición [R15.5]', () => {
  it('[R15.5] muestra la vuelta actual, el máximo y el veredicto del evaluador', async () => {
    const body = dia([E, ag('w'), O], [['entry', 'w'], ['w', 'output']]);
    const d = dia([E, { id: 'l', kind: 'loop', loop: { mode: 'ai-judge', prompt: '¿ok?', maxIterations: 4, body } }, O], [['entry', 'l'], ['l', 'output']]);
    let n = 0;
    const { events } = await run(d, { w: { output: 'w' } }, [], () => ({ done: ++n === 2, reason: n === 2 ? 'listo' : 'falta' }));
    const live = deriveLive(events);
    expect(live.loops.l).toMatchObject({ n: 2, max: 4, verdict: 'done', reason: 'listo' });
    expect(live.nodeStatus['l/w']).toBe('succeeded');
    expect(live.edges.has('l/w->output')).toBe(true);
  });
});

describe('transcripción [R15.2]', () => {
  it('[R15.2] entrada, texto en streaming agrupado, herramientas, uso y salida', async () => {
    const d = dia([E, ag('a'), O], [['entry', 'a'], ['a', 'output']]);
    const { events } = await run(d, {
      a: { output: 'fin', tokens: ['Hola', ' ', 'mundo'], tools: [{ tool: 'Write', input: { f: 1 }, ok: true, output: 'ok' }], usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.01 } },
    });
    const items = transcriptItems(events, 'a');
    expect(items[0]).toMatchObject({ kind: 'input', agentId: 'a', text: 'orden', attempt: 1 });
    expect(items.find((i) => i.kind === 'text')).toEqual({ kind: 'text', text: 'Hola mundo' });
    expect(items.find((i) => i.kind === 'tool')).toMatchObject({ tool: 'Write', ok: true, output: 'ok', input: { f: 1 } });
    expect(items.find((i) => i.kind === 'usage')).toEqual({ kind: 'usage', inputTokens: 10, outputTokens: 5, costUsd: 0.01 });
    expect(items[items.length - 1]).toEqual({ kind: 'output', status: 'succeeded', text: 'fin' });
    expect(items.filter((i) => i.kind === 'usage')).toHaveLength(1);
  });

  it('[R15.2] separa por nodo y por ruta dentro de un bucle', async () => {
    const body = dia([E, ag('w'), O], [['entry', 'w'], ['w', 'output']]);
    const d = dia([E, ag('a'), { id: 'l', kind: 'loop', loop: { mode: 'count', count: 1, maxIterations: 2, body } }, O], [['entry', 'a'], ['a', 'l'], ['l', 'output']]);
    const { events } = await run(d, { a: { output: 'A' }, w: { output: 'W' } });
    expect(transcriptItems(events, 'a').some((i) => i.kind === 'output' && i.text === 'A')).toBe(true);
    expect(transcriptItems(events, 'w', ['l']).some((i) => i.kind === 'output' && i.text === 'W')).toBe(true);
    expect(transcriptItems(events, 'w')).toEqual([]);
  });

  it('[R15.2] los reintentos y errores aparecen en la transcripción', async () => {
    const d = dia([E, ag('a'), O], [['entry', 'a'], ['a', 'output']]);
    const agent = new MockAgent({ a: { output: 'ok', failTimes: 1 } });
    const handle = new Orchestrator({ getAdapter: () => agent, decider: new MockDecider(), sleep: async () => {} }).start(d, 'x');
    const events: RunEvent[] = [];
    handle.bus.subscribe((e) => events.push(e));
    await handle.result;
    const kinds = transcriptItems(events, 'a').map((i) => i.kind);
    expect(kinds).toContain('retry');
    expect(kinds).toContain('error');
    expect(kinds.filter((k) => k === 'input')).toHaveLength(2);
  });
});

describe('preguntas [R18.12][R18.13][R18.14]', () => {
  const d = dia([E, ag('a'), O], [['entry', 'a'], ['a', 'output']]);
  const scripts = { a: { output: 'ok', asks: [{ question: '¿Color?', options: ['rojo', 'azul'] }] } };

  it('[R18.12] la pregunta y su respuesta forman el chat del nodo, con opciones', async () => {
    const { events } = await run(d, scripts, ['azul']);
    const q = transcriptItems(events, 'a').find((i) => i.kind === 'question');
    expect(q).toEqual({ kind: 'question', questionId: expect.any(String), text: '¿Color?', options: ['rojo', 'azul'], answer: 'azul' });
  });

  it('[R18.13] el nodo queda en espera y la pregunta cuenta como pendiente hasta responderla', async () => {
    const agent = new MockAgent(scripts);
    const handle = new Orchestrator({ getAdapter: () => agent, decider: new MockDecider() }).start(d, 'x');
    const events: RunEvent[] = [];
    handle.bus.subscribe((e) => events.push(e));
    await vi.waitFor(() => expect(handle.pendingQuestions()).toHaveLength(1));
    const waiting = deriveLive(events);
    expect(waiting.nodeStatus.a).toBe('waiting_input');
    expect(waiting.pending).toEqual([{ questionId: expect.any(String), nodeId: 'a', nodePath: [], text: '¿Color?', options: ['rojo', 'azul'] }]);
    handle.answer(handle.pendingQuestions()[0]!.questionId, 'rojo');
    await handle.result;
    const done = deriveLive(events);
    expect(done.pending).toEqual([]);
    expect(done.nodeStatus.a).toBe('succeeded');
  });

  it('[R18.14] al reconstruir desde el historial reaparecen las preguntas pendientes', async () => {
    const agent = new MockAgent(scripts);
    const handle = new Orchestrator({ getAdapter: () => agent, decider: new MockDecider() }).start(d, 'x');
    await vi.waitFor(() => expect(handle.pendingQuestions()).toHaveLength(1));
    const history: RunEvent[] = [];
    handle.bus.subscribe((e) => history.push(e), { fromSeq: 1 });
    const live = deriveLive(history);
    expect(live.pending.map((p) => p.questionId)).toEqual(handle.pendingQuestions().map((p) => p.questionId));
    handle.cancel();
    await handle.result;
  });
});

describe('uso, presupuesto y resultados [R15.9][R17.1][R17.5][R15.3]', () => {
  it('[R15.9] acumula tokens y coste y calcula lo que queda de presupuesto', async () => {
    const d = dia([E, ag('a'), ag('b'), O], [['entry', 'a'], ['a', 'b'], ['b', 'output']]);
    const { events } = await run(d, { a: { output: 'a', usage: { inputTokens: 100, outputTokens: 50, costUsd: 0.1 } }, b: { output: 'b', usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.05 } } });
    const live = deriveLive(events);
    expect(live.usage).toEqual({ inputTokens: 110, outputTokens: 55, costUsd: expect.closeTo(0.15, 5) });
    expect(budgetRemaining(live, { maxTokens: 200, maxCostUsd: 1 })).toEqual({ tokens: 35, costUsd: expect.closeTo(0.85, 5) });
    expect(budgetRemaining(live, { maxTokens: 100 })).toEqual({ tokens: 0 });
    expect(budgetRemaining(live, {})).toEqual({});
  });

  it('[R15.9] registra el límite alcanzado', async () => {
    const d = dia([E, ag('a'), O], [['entry', 'a'], ['a', 'output']]);
    const agent = new MockAgent({ a: { output: 'x', usage: { inputTokens: 90, outputTokens: 90 } } });
    const handle = new Orchestrator({ getAdapter: () => agent, decider: new MockDecider() }).start(d, 'x', { budget: { maxTokens: 100 } });
    const events: RunEvent[] = [];
    handle.bus.subscribe((e) => events.push(e));
    await handle.result;
    const live = deriveLive(events);
    expect(live.budgetReached).toMatchObject({ limit: 'tokens', max: 100 });
    expect(live.status).toBe('failed');
    expect(live.reason).toBe('budget_exceeded');
  });

  it('[R15.3] refleja pausa y reanudación', async () => {
    const d = dia([E, ag('a'), O], [['entry', 'a'], ['a', 'output']]);
    let release!: () => void;
    const agent = new MockAgent({ a: { output: 'x', waitFor: new Promise<void>((r) => (release = r)) } });
    const handle = new Orchestrator({ getAdapter: () => agent, decider: new MockDecider() }).start(d, 'x');
    const events: RunEvent[] = [];
    handle.bus.subscribe((e) => events.push(e));
    handle.pause();
    expect(deriveLive(events).paused).toBe(true);
    handle.resume();
    expect(deriveLive(events).paused).toBe(false);
    handle.pause();
    handle.cancel();
    release();
    await handle.result;
    expect(deriveLive(events).paused).toBe(false);
  });

  it('[R17.1][R17.5] archivos producidos por nodo y texto final', async () => {
    const d = dia([E, ag('a'), O], [['entry', 'a'], ['a', 'output']]);
    const { events } = await run(d, { a: { output: 'listo: out/a.txt y b.png', files: ['out/a.txt', 'b.png'] } });
    const live = deriveLive(events);
    expect(live.produced).toEqual([
      { nodeId: 'a', path: 'out/a.txt', nodePath: [] },
      { nodeId: 'a', path: 'b.png', nodePath: [] },
    ]);
    expect(live.finalOutput).toBe('listo: out/a.txt y b.png');
  });
});

// --- cliente de ejecución ------------------------------------------------------------------

function fakeApi(history: RunEvent[]) {
  let push: (runId: string, events: RunEvent[]) => void = () => {};
  const calls: string[] = [];
  const api = {
    onRunEvents: (l: typeof push) => ((push = l), () => {}),
    startRun: async () => ok({ runId: 'r1' }),
    subscribeRun: async ({ fromSeq }: { fromSeq: number }) => (calls.push(`sub${fromSeq}`), ok(history.filter((e) => e.seq >= fromSeq))),
    controlRun: async (r: { action: string }) => (calls.push(r.action), ok(null)),
    answerRun: async () => ok(true),
    unsubscribeRun: async () => ok(null),
  } as unknown as ProjectApi;
  return { api, push: (events: RunEvent[]) => push('r1', events), calls };
}

const mk = (seq: number, type: 'run.started' | 'run.paused' = 'run.paused'): RunEvent =>
  ({ type, ...(type === 'run.started' ? { diagramId: 'd' } : {}), runId: 'r1', seq, ts: 't' }) as RunEvent;

describe('cliente de ejecución [R15.8]', () => {
  it('[R15.8] ignora duplicados y mantiene el orden por seq', async () => {
    const f = fakeApi([mk(1, 'run.started'), mk(2)]);
    const c = new RunClient(f.api);
    await c.start({ diagramId: 'd', order: 'x' });
    f.push([mk(2), mk(3, 'run.paused')]);
    expect(c.getSnapshot().events.map((e) => e.seq)).toEqual([1, 2, 3]);
    f.push([mk(3)]);
    expect(c.getSnapshot().events).toHaveLength(3);
  });

  it('[R15.8] los eventos que llegan durante la suscripción se guardan y se aplican después sin perder ni duplicar', async () => {
    const hist = [mk(1, 'run.started'), mk(2)];
    let resolveSub!: () => void;
    const gate = new Promise<void>((r) => (resolveSub = r));
    let push: (runId: string, e: RunEvent[]) => void = () => {};
    const api = {
      onRunEvents: (l: typeof push) => ((push = l), () => {}),
      subscribeRun: async () => (await gate, ok(hist)),
    } as unknown as ProjectApi;
    const c = new RunClient(api);
    const p = c.attach('r1');
    push('r1', [mk(3), mk(4)]);
    resolveSub();
    await p;
    expect(c.getSnapshot().events.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
  });

  it('[R15.8] ante un hueco pide de nuevo desde seq+1 y se recupera', async () => {
    const all = [1, 2, 3, 4, 5].map((n) => mk(n, n === 1 ? 'run.started' : 'run.paused'));
    const f = fakeApi(all);
    const c = new RunClient(f.api);
    await c.attach('r1');
    f.calls.length = 0;
    // el cliente solo tenía hasta 5 en el historial; simulamos que se pierden 6 y llega 7
    all.push(mk(6), mk(7));
    f.push([mk(7)]);
    await vi.waitFor(() => expect(c.getSnapshot().events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]));
    expect(f.calls).toContain('sub6');
  });

  it('[R15.8] ignora lotes de otra ejecución y notifica a los suscriptores', async () => {
    const f = fakeApi([mk(1, 'run.started')]);
    const c = new RunClient(f.api);
    const spy = vi.fn();
    c.subscribe(spy);
    await c.attach('r1');
    const before = spy.mock.calls.length;
    (f.push as unknown as (e: RunEvent[]) => void)([]);
    expect(spy.mock.calls.length).toBe(before);
    expect(c.getSnapshot().live.status).toBe('running');
  });

  it('[R15.3] control y respuestas pasan por la API y los fallos se muestran', async () => {
    const f = fakeApi([mk(1, 'run.started')]);
    const c = new RunClient(f.api);
    await c.start({ diagramId: 'd', order: 'x' });
    await c.control('pause');
    await c.control('cancel');
    expect(f.calls.filter((x) => !x.startsWith('sub'))).toEqual(['pause', 'cancel']);
    expect(await c.answer('q', 'a')).toBe(true);
    const bad = { ...f.api, controlRun: async () => fail('not-found', 'No existe esa ejecución en curso') } as ProjectApi;
    const c2 = new RunClient(bad);
    await c2.attach('r1').catch(() => {});
    (c2 as unknown as { runId: string }).runId = 'r1';
    await c2.control('pause');
    expect(c2.getSnapshot().error).toBe('No existe esa ejecución en curso');
  });

  it('[R15.8] si falla el arranque se informa y no hay ejecución', async () => {
    const api = { onRunEvents: () => () => {}, startRun: async () => fail('invalid-diagram', 'El diagrama tiene problemas') } as unknown as ProjectApi;
    const c = new RunClient(api);
    expect(await c.start({ diagramId: 'd', order: 'x' })).toBeUndefined();
    expect(c.getSnapshot()).toMatchObject({ error: 'El diagrama tiene problemas', events: [] });
  });
});

describe('transcripción por pasadas [R15.14]', () => {
  /** Entrada → dis → qa → Revisión (✓ Salida, ✗ vuelve a dis, ⏱ Salida): la primera vez rechaza. */
  const qaLoop = (): Diagram => ({
    ...dia([E, ag('dis'), ag('qa'), { id: 'rev', kind: 'review', label: 'Revisión', review: { maxRounds: 3, mode: 'verdict' } }, O], [['entry', 'dis'], ['dis', 'qa'], ['qa', 'rev']]),
  });
  const withPorts = (d: Diagram): Diagram => ({
    ...d,
    edges: [
      ...d.edges,
      { id: 'rev.approved->output', from: 'rev', to: 'output', port: 'approved' },
      { id: 'rev.rejected->dis', from: 'rev', to: 'dis', port: 'rejected' },
      { id: 'rev.exhausted->output', from: 'rev', to: 'output', port: 'exhausted' },
    ],
  });

  it('[R15.14] un nodo devuelto por una revisión separa sus pasadas y numera sus entradas', async () => {
    let qa = 0;
    const { events } = await run(withPorts(qaLoop()), {
      dis: { output: 'diseño' },
      qa: { output: () => (++qa === 1 ? 'Falta el contraste.\nVEREDICTO: RECHAZADO' : 'VEREDICTO: APROBADO') },
    });
    const items = transcriptItems(events, 'dis');
    const kinds = items.map((i) => i.kind);
    // Pasada 1 entera, luego el separador y la pasada 2; el consumo total va con la última salida.
    expect(kinds.indexOf('pass')).toBeGreaterThan(kinds.indexOf('output'));
    expect(items.filter((i) => i.kind === 'pass')).toEqual([{ kind: 'pass', n: 2, by: 'rev' }]);
    expect(items.filter((i) => i.kind === 'input').map((i) => (i.kind === 'input' ? [i.pass, i.attempt] : []))).toEqual([
      [1, 1],
      [2, 1],
    ]);
    expect(items.filter((i) => i.kind === 'output')).toHaveLength(2);
    // QA también vuelve a ejecutarse, pero no fue el destino del retorno: su pasada 2 no dice quién la devolvió.
    expect(transcriptItems(events, 'qa').filter((i) => i.kind === 'pass')).toEqual([{ kind: 'pass', n: 2 }]);
  });

  it('[R15.14] el motivo de la revisión acompaña a la pasada; con una sola pasada no hay pasadas', () => {
    let seq = 0;
    const ev = (body: Record<string, unknown>): RunEvent => ({ runId: 'r', seq: ++seq, ts: '2026-11-05T12:00:00.000Z', ...body }) as unknown as RunEvent;
    const evs = [
      ev({ type: 'node.started', nodeId: 'dis' }),
      ev({ type: 'agent.request', nodeId: 'dis', agentId: 'dis', attempt: 1, input: { text: 'orden' } }),
      ev({ type: 'node.finished', nodeId: 'dis', status: 'succeeded', output: { text: 'a medias' } }),
      ev({ type: 'review.decided', nodeId: 'rev', round: 1, max: 3, verdict: 'rejected', source: 'ai', reason: 'No hay nada construido', returnTo: 'dis' }),
      ev({ type: 'node.started', nodeId: 'dis' }),
      ev({ type: 'agent.request', nodeId: 'dis', agentId: 'dis', attempt: 1, input: { text: 'correcciones' } }),
    ];
    expect(transcriptItems(evs, 'dis')).toContainEqual({ kind: 'pass', n: 2, by: 'rev', reason: 'No hay nada construido' });
    const single = transcriptItems(evs.slice(0, 3), 'dis');
    expect(single.some((i) => i.kind === 'pass')).toBe(false);
    expect(single[0]).not.toHaveProperty('pass');
    // Un retorno a otro nodo (u otra ruta) no se atribuye a este.
    const elsewhere = transcriptItems(evs.map((e) => (e.type === 'review.decided' ? ({ ...e, nodePath: ['l'] } as RunEvent) : e)), 'dis');
    expect(elsewhere).toContainEqual({ kind: 'pass', n: 2 });
  });
});
