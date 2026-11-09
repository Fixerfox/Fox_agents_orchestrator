import { describe, expect, it } from 'vitest';
import {
  AgentError,
  BUDGET_GO_ON,
  BUDGET_QUESTION,
  BUDGET_SPENT,
  BUDGET_STOP,
  MockAgent,
  MockDecider,
  Orchestrator,
  TOKEN_GROUP_CHARS,
  applyRules,
  newRuleState,
  runMetrics,
  type AgentAdapter,
  type AgentRequest,
  type AgentStreamEvent,
  type ProviderCooldown,
  type RunEvent,
  type SharedResources,
} from '../src';
import { runInternalAgent } from '../src/execution/run/merge-agent';
import { BudgetTracker } from '../src/execution/run/budget-tracker';
import { RunAbort } from '../src/execution/run/run-abort';
import { RunEmitter } from '../src/execution/run/run-emitter';
import { EventBus } from '../src/execution/events';
import { PauseGate } from '../src/execution/run/pause-gate';
import { FakeTimers, MIN, flush } from './fake-timers';
import { ENTRY, OUTPUT, agent, chain, diagram, edge, fan, ofType } from './helpers';

class Scripted implements AgentAdapter {
  readonly calls: AgentRequest[] = [];
  constructor(private readonly script: (req: AgentRequest, signal: AbortSignal, n: number) => AsyncIterable<AgentStreamEvent>) {}
  run(req: AgentRequest, signal: AbortSignal): AsyncIterable<AgentStreamEvent> {
    this.calls.push(req);
    return this.script(req, signal, this.calls.length);
  }
}

/** Recursos compartidos de prueba: `max` huecos en orden de llegada y el enfriamiento que se le diga. */
function fakeResources(max: number) {
  let active = 0;
  let peak = 0;
  const queue: (() => void)[] = [];
  const opened: { retryAfterMs: number; reason: string }[] = [];
  let cooling: ProviderCooldown | undefined;
  const r: SharedResources = {
    async agentSlot(o) {
      if (cooling) o.cooling(cooling);
      if (active >= max) {
        o.queued(active);
        await new Promise<void>((res) => queue.push(res));
      } else active++;
      peak = Math.max(peak, active);
      let done = false;
      return () => {
        if (done) return;
        done = true;
        const next = queue.shift();
        if (next) next();
        else active--;
      };
    },
    limited(o) {
      opened.push(o);
      return { provider: 'claude', untilTs: '2026-11-08T10:42:00.000Z', reason: o.reason };
    },
  };
  return { r, peak: () => peak, opened, setCooling: (c: ProviderCooldown | undefined) => (cooling = c) };
}

const answering = (h: { bus: { subscribe(f: (e: RunEvent) => void): unknown }; answer(id: string, text: string): boolean }, reply: (e: Extract<RunEvent, { type: 'agent.question' }>) => string | undefined) =>
  h.bus.subscribe((e) => {
    if (e.type !== 'agent.question') return;
    const a = reply(e);
    if (a !== undefined) setTimeout(() => h.answer(e.questionId, a), 0);
  });

describe('SPEC-077 · concurrencia global', () => {
  it('[R77.1] dos ejecuciones comparten el hueco global: nunca trabajan más agentes que él', async () => {
    const res = fakeResources(2);
    const agents = new MockAgent({ a: { latencyMs: 5 }, b: { latencyMs: 5 }, c: { latencyMs: 5 } });
    const orch = new Orchestrator({ getAdapter: () => agents, decider: new MockDecider(), resources: res.r });
    const [one, two] = await Promise.all([orch.start(fan(['a', 'b', 'c']), 'x').result, orch.start(fan(['a', 'b', 'c']), 'y').result]);
    expect([one.status, two.status]).toEqual(['succeeded', 'succeeded']);
    expect(agents.maxActive).toBeLessThanOrEqual(2);
    expect(res.peak()).toBe(2);
  });

  it('[R77.2][R77.3] quien espera hueco sale «en cola» con los agentes trabajando; quien pregunta suelta el suyo', async () => {
    const res = fakeResources(1);
    const agents = new MockAgent({ a: { asks: [{ question: '¿Seguro?' }] }, b: { output: 'hecho' } });
    const orch = new Orchestrator({ getAdapter: () => agents, decider: new MockDecider(), resources: res.r });
    const first = orch.start(chain(['a']), 'x');
    answering(first, () => undefined);
    const firstQuestion = new Promise<string>((r) => first.bus.subscribe((e) => e.type === 'agent.question' && r(e.questionId)));
    const q = await firstQuestion;
    // Con «a» esperando a la persona, «b» de otra ejecución trabaja.
    const second = await orch.start(chain(['b']), 'y').result;
    expect(second.status).toBe('succeeded');
    first.answer(q, 'sí');
    expect((await first.result).status).toBe('succeeded');
    // Y quien llega con el hueco ocupado lo dice.
    const busy = fakeResources(1);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = new MockAgent({ a: { waitFor: gate }, b: {} });
    const o2 = new Orchestrator({ getAdapter: () => slow, decider: new MockDecider(), resources: busy.r });
    const h1 = o2.start(chain(['a']), 'x');
    await new Promise((r) => setTimeout(r, 5));
    const h2 = o2.start(chain(['b']), 'y');
    await new Promise((r) => setTimeout(r, 5));
    const queued = ofType(h2.bus.history(), 'node.queued').find((e) => e.others !== undefined);
    expect(queued).toMatchObject({ nodeId: 'b', others: 1 });
    const started = h2.bus.history().findIndex((e) => e.type === 'node.started');
    expect(h2.bus.history().indexOf(queued!)).toBeGreaterThan(started);
    expect(ofType(h2.bus.history(), 'agent.request')).toEqual([]);
    release();
    await Promise.all([h1.result, h2.result]);
    expect(ofType(h2.bus.history(), 'agent.request')).toHaveLength(1);
  });
});

describe('SPEC-077 · límites de uso compartidos', () => {
  it('[R77.4] un límite con retry-after abre el enfriamiento y la ejecución lo dice; quien llega mientras, también', async () => {
    const res = fakeResources(8);
    let n = 0;
    const adapter = new Scripted(async function* () {
      if (++n === 1) throw new AgentError('429', true, [], { kind: 'rate_limit', retryAfterMs: 30_000 });
      yield { type: 'result', text: 'hecho' };
    });
    const orch = new Orchestrator({ getAdapter: () => adapter, decider: new MockDecider(), resources: res.r, sleep: async () => undefined });
    const r = await orch.start(chain(['a']), 'x', { retry: { maxAttempts: 3, baseDelayMs: 1 } }).result;
    expect(r.status).toBe('succeeded');
    expect(res.opened).toEqual([{ retryAfterMs: 30_000, reason: 'rate_limit' }]);
    expect(ofType(r.events, 'provider.cooldown')[0]).toMatchObject({ provider: 'claude', untilTs: '2026-11-08T10:42:00.000Z', reason: 'rate_limit', nodeId: 'a' });
    res.setCooling({ provider: 'claude', untilTs: '2026-11-08T10:42:00.000Z', reason: 'overloaded' });
    const other = await new Orchestrator({ getAdapter: () => new MockAgent(), decider: new MockDecider(), resources: res.r }).start(chain(['b']), 'y').result;
    expect(ofType(other.events, 'provider.cooldown')).toEqual([expect.objectContaining({ nodeId: 'b', reason: 'overloaded' })]);
  });
});

describe('SPEC-077 · presupuesto', () => {
  const spend = (costUsd: number) => ({ usage: { inputTokens: 1, outputTokens: 1, costUsd } });

  it('[R77.6] al pasar del 80 % avisa una vez', async () => {
    const orch = new Orchestrator({ getAdapter: () => new MockAgent({ a: spend(4.1), b: spend(0.2), c: spend(0.1) }), decider: new MockDecider() });
    const r = await orch.start(chain(['a', 'b', 'c']), 'x', { budget: { maxCostUsd: 10 } }).result;
    expect(ofType(r.events, 'run.budget_warning')).toEqual([]);
    const h = new Orchestrator({ getAdapter: () => new MockAgent({ a: spend(8.1), b: spend(0.2), c: spend(0.1) }), decider: new MockDecider() }).start(chain(['a', 'b', 'c']), 'x', { budget: { maxCostUsd: 10 } });
    expect(ofType((await h.result).events, 'run.budget_warning')).toEqual([expect.objectContaining({ limit: 'cost', max: 10 })]);
  });

  it('[R77.7] desde el 90 % el siguiente paso pregunta; «Seguir hasta el límite» sigue sin volver a preguntar', async () => {
    const h = new Orchestrator({ getAdapter: () => new MockAgent({ a: spend(4.6), b: spend(0.1), c: spend(0.1) }), decider: new MockDecider() }).start(chain(['a', 'b', 'c']), 'x', { budget: { maxCostUsd: 5 } });
    answering(h, () => BUDGET_GO_ON);
    const r = await h.result;
    const asked = ofType(r.events, 'agent.question');
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ nodeId: 'b', kind: 'budget', options: [BUDGET_GO_ON, 'Subir el límite a 10.00 $', BUDGET_STOP] });
    expect(asked[0]!.text).toContain(BUDGET_QUESTION);
    expect(r.status).toBe('succeeded');
  });

  it('[R77.7] «Subir el límite a…» sube el límite; «Parar la ejecución» la para; sin respuesta, se para', async () => {
    const up = new Orchestrator({ getAdapter: () => new MockAgent({ a: spend(4.6), b: spend(0.1) }), decider: new MockDecider() }).start(chain(['a', 'b']), 'x', { budget: { maxCostUsd: 5 } });
    answering(up, (e) => e.options![1]);
    const r1 = await up.result;
    expect(ofType(r1.events, 'run.budget_raised')).toEqual([expect.objectContaining({ limit: 'cost', max: 10 })]);
    expect(r1.status).toBe('succeeded');
    const typed = new Orchestrator({ getAdapter: () => new MockAgent({ a: spend(4.6), b: spend(0.1) }), decider: new MockDecider() }).start(chain(['a', 'b']), 'x', { budget: { maxCostUsd: 5 } });
    answering(typed, () => '7,5');
    expect(ofType((await typed.result).events, 'run.budget_raised')[0]!.max).toBe(7.5);
    const stop = new Orchestrator({ getAdapter: () => new MockAgent({ a: spend(4.6), b: spend(0.1) }), decider: new MockDecider() }).start(chain(['a', 'b']), 'x', { budget: { maxCostUsd: 5 } });
    answering(stop, () => BUDGET_STOP);
    const r2 = await stop.result;
    expect([r2.status, r2.reason]).toEqual(['failed', 'budget_exceeded']);
    expect(ofType(r2.events, 'agent.request').map((e) => e.nodeId)).toEqual(['a']);
    const timers = new FakeTimers();
    const silent = new Orchestrator({ getAdapter: () => new MockAgent({ a: spend(4.6), b: spend(0.1) }), decider: new MockDecider(), timers }).start(chain(['a', 'b']), 'x', { budget: { maxCostUsd: 5 }, unanswered: { afterMinutes: 1, action: 'fallback' } });
    await timers.advance(2 * MIN);
    const r3 = await silent.result;
    expect(r3.reason).toBe('budget_exceeded');
    expect(ofType(r3.events, 'agent.answer')[0]).toMatchObject({ text: BUDGET_STOP, auto: true });
  });

  it('[R77.8] con «finish-running», al 100 % lo que está en marcha termina y no arranca nada nuevo', async () => {
    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    const agents = new MockAgent({ a: spend(6), b: { waitFor: slow, ...spend(1) }, c: spend(1) });
    const d = diagram([ENTRY, agent('a'), agent('b'), agent('c'), OUTPUT], [edge('entry', 'a'), edge('entry', 'b'), edge('a', 'c'), edge('b', 'output'), edge('c', 'output')]);
    const h = new Orchestrator({ getAdapter: () => agents, decider: new MockDecider() }).start(d, 'x', { budget: { maxCostUsd: 5 }, onBudget: 'finish-running' });
    await new Promise((r) => setTimeout(r, 10));
    release();
    const r = await h.result;
    expect([r.status, r.reason]).toEqual(['failed', 'budget_exceeded']);
    const fin = (id: string) => ofType(r.events, 'node.finished').find((e) => e.nodeId === id)?.status;
    expect(fin('b')).toBe('succeeded');
    expect(agents.callsOf('c')).toHaveLength(0);
    expect(ofType(r.events, 'error').some((e) => e.nodeId === 'c' && e.message === BUDGET_SPENT)).toBe(true);
    expect(ofType(r.events, 'run.cancelled')).toEqual([]);
  });

  it('[R77.9] el tope del paso o de la ficha llega al motor en cada intento', async () => {
    const agents = new MockAgent({ a: {}, b: {}, c: {} });
    const d = diagram([ENTRY, { ...agent('a'), limits: { maxCostUsd: 1 } }, agent('b'), agent('c'), OUTPUT], [edge('entry', 'a'), edge('a', 'b'), edge('b', 'c'), edge('c', 'output')]);
    await new Orchestrator({ getAdapter: () => agents, decider: new MockDecider(), agentLimits: (id) => (id === 'b' ? { maxCostUsd: 2 } : undefined) }).start(d, 'x').result;
    expect(agents.calls.map((c) => [c.agentId, c.maxCostUsd])).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', undefined],
    ]);
  });

  it('[R77.9] pasarse del tope es un error que no se reintenta', async () => {
    let n = 0;
    const adapter = new Scripted(async function* () {
      n++;
      yield { type: 'token', text: '' };
      throw new AgentError('El paso llegó a su presupuesto de 1 $', false, [], { kind: 'fatal' });
    });
    const r = await new Orchestrator({ getAdapter: () => adapter, decider: new MockDecider(), sleep: async () => undefined }).start(chain(['a']), 'x', { retry: { maxAttempts: 3, baseDelayMs: 1 } }).result;
    expect(n).toBe(1);
    expect(ofType(r.events, 'error')[0]).toMatchObject({ message: 'El paso llegó a su presupuesto de 1 $', retriable: false });
  });

  it('[R77.10] más de 1 $ por minuto durante 3 minutos seguidos avisa una vez; Ajustes cambia el umbral', () => {
    const at = (min: number) => new Date(Date.parse('2026-11-08T10:00:00.000Z') + min * MIN).toISOString();
    let seq = 0;
    const usage = (min: number, costUsd: number) => ({ runId: 'r', seq: ++seq, ts: at(min), type: 'agent.usage', nodeId: 'a', inputTokens: 1, outputTokens: 1, costUsd }) as RunEvent;
    const rules = (spends: [number, number][], burnRate?: number) => {
      const s = newRuleState();
      return spends.flatMap(([m, c]) => applyRules(s, usage(m, c), undefined, burnRate !== undefined ? { burnRate } : {})).map((a) => a.rule);
    };
    expect(rules([[0.5, 1.5], [1.5, 1.5], [2.5, 1.5], [2.9, 1.5]])).toEqual(['burn-rate']);
    expect(rules([[0.5, 1.5], [1.5, 0.5], [2.5, 1.5]])).toEqual([]);
    expect(rules([[0.5, 1.5], [1.5, 1.5]])).toEqual([]);
    expect(rules([[0.5, 1.5], [1.5, 1.5], [2.5, 1.5]], 2)).toEqual([]);
  });

  it('[R77.11] lo que gasta un agente interno (verificador, integrar conflictos) cuenta en el presupuesto', async () => {
    const bus = new EventBus('r');
    const emitter = new RunEmitter(bus);
    const stop = new RunAbort();
    const budget = new BudgetTracker({ maxCostUsd: 1 }, emitter, stop);
    const agents = new MockAgent({ verificador: spend(1.5) });
    await runInternalAgent({ emitter, getAdapter: () => agents, questions: undefined as never, signal: stop.signal, budget, timers: new FakeTimers(), gate: new PauseGate() }, { nodeId: 'a', agentId: 'verificador', path: [], input: { text: 'x', files: [] }, task: 'Verifica', kind: 'verify' });
    expect(budget.usage.costUsd).toBe(1.5);
    expect(stop.reason).toBe('budget_exceeded');
  });
});

describe('SPEC-077 · pausa', () => {
  it('[R77.12][R77.13] en pausa, la siguiente herramienta espera a reanudar y el paso dice que quedó retenido, una vez', async () => {
    const order: string[] = [];
    const adapter = new Scripted(async function* (req) {
      yield { type: 'token', text: 'editando' };
      await req.whilePaused!('Edit');
      order.push('Edit');
      await req.whilePaused!('Bash');
      order.push('Bash');
      yield { type: 'result', text: 'hecho' };
    });
    const h = new Orchestrator({ getAdapter: () => adapter, decider: new MockDecider() }).start(chain(['a']), 'x');
    await new Promise<void>((r) => h.bus.subscribe((e) => e.type === 'agent.request' && r()));
    h.pause();
    await flush();
    expect(order).toEqual([]);
    // Retenido una vez: con el texto que ya llevaba o antes de «Edit», nunca después.
    expect(ofType(h.bus.history(), 'node.paused').map((e) => e.nodeId)).toEqual(['a']);
    h.resume();
    const r = await h.result;
    expect(order).toEqual(['Edit', 'Bash']);
    expect(r.status).toBe('succeeded');
    expect(ofType(r.events, 'node.paused')).toHaveLength(1);
  });

  it('[R77.13] si el turno acaba durante la pausa, el paso también queda «en pausa»', async () => {
    let finish!: () => void;
    const end = new Promise<void>((r) => (finish = r));
    const adapter = new Scripted(async function* () {
      await end;
      yield { type: 'result', text: 'hecho' };
    });
    const h = new Orchestrator({ getAdapter: () => adapter, decider: new MockDecider() }).start(chain(['a']), 'x');
    await new Promise<void>((r) => h.bus.subscribe((e) => e.type === 'agent.request' && r()));
    h.pause();
    finish();
    await flush();
    expect(ofType(h.bus.history(), 'node.paused')).toEqual([expect.objectContaining({ nodeId: 'a' })]);
    expect(ofType(h.bus.history(), 'node.finished').filter((e) => e.nodeId === 'a')).toEqual([]);
    h.resume();
    expect((await h.result).status).toBe('succeeded');
  });

  it('[R77.14] la pausa detiene el reloj de inactividad', async () => {
    const timers = new FakeTimers();
    const adapter = new Scripted(async function* (req, signal) {
      yield { type: 'token', text: 'a' };
      await req.whilePaused!('Bash');
      if (signal.aborted) return;
      yield { type: 'result', text: 'hecho' };
    });
    const h = new Orchestrator({ getAdapter: () => adapter, decider: new MockDecider(), timers }).start(chain(['a']), 'x', { limits: { idleMinutes: 2 } });
    await new Promise<void>((r) => h.bus.subscribe((e) => e.type === 'agent.request' && r()));
    h.pause();
    await timers.advance(10 * MIN);
    expect(ofType(h.bus.history(), 'node.timeout')).toEqual([]);
    h.resume();
    expect((await h.result).status).toBe('succeeded');
  });
});

describe('SPEC-077 · registro y métricas', () => {
  it('[R77.15] los tokens seguidos de un paso van juntos y los cierra cualquier otro evento del paso', async () => {
    const timers = new FakeTimers();
    const tokens = Array.from({ length: 300 }, (_, i) => `t${i} `);
    const agents = new MockAgent({ a: { tokens, tools: [{ tool: 'Read' }] } });
    const r = await new Orchestrator({ getAdapter: () => agents, decider: new MockDecider(), timers, coalesceTokens: { ms: 250, chars: TOKEN_GROUP_CHARS } }).start(chain(['a']), 'x').result;
    const streamed = ofType(r.events, 'token.stream');
    expect(streamed.length).toBeLessThan(5);
    expect(streamed.map((e) => e.text).join('')).toBe(tokens.join(''));
    // Antes de la herramienta, todo el texto.
    const tool = r.events.findIndex((e) => e.type === 'tool.called');
    expect(r.events.map((e) => e.type).lastIndexOf('token.stream')).toBeLessThan(tool);
    expect(streamed.every((e) => e.text.length <= TOKEN_GROUP_CHARS + 10)).toBe(true);
    expect(r.events.map((e) => e.seq)).toEqual(r.events.map((_, i) => i + 1));
  });

  it('[R77.15] el grupo se emite a los 250 ms aunque el paso siga', async () => {
    const timers = new FakeTimers();
    let go!: () => void;
    const later = new Promise<void>((r) => (go = r));
    const adapter = new Scripted(async function* () {
      yield { type: 'token', text: 'hola ' };
      await later;
      yield { type: 'result', text: 'hecho' };
    });
    const h = new Orchestrator({ getAdapter: () => adapter, decider: new MockDecider(), timers, coalesceTokens: { ms: 250, chars: 2000 } }).start(chain(['a']), 'x');
    await flush();
    expect(ofType(h.bus.history(), 'token.stream')).toEqual([]);
    await timers.advance(250);
    expect(ofType(h.bus.history(), 'token.stream').map((e) => e.text)).toEqual(['hola ']);
    go();
    await h.result;
  });

  it('[R77.17] métricas por paso y por ejecución, con el Supervisor aparte', () => {
    let seq = 0;
    const at = (s: number) => new Date(Date.parse('2026-11-08T10:00:00.000Z') + s * 1000).toISOString();
    const ev = (s: number, b: Record<string, unknown>) => ({ runId: 'r', seq: ++seq, ts: at(s), ...b }) as RunEvent;
    const events = [
      ev(0, { type: 'run.started', diagramId: 'd' }),
      ev(0, { type: 'node.queued', nodeId: 'a' }),
      ev(2, { type: 'node.started', nodeId: 'a' }),
      ev(2, { type: 'agent.request', nodeId: 'a', agentId: 'dev', attempt: 1, input: { text: '', files: [] }, model: 'claude-opus-5-5' }),
      ev(5, { type: 'agent.question', nodeId: 'a', questionId: 'q', text: '¿?' }),
      ev(15, { type: 'agent.answer', nodeId: 'a', questionId: 'q', text: 'sí' }),
      ev(16, { type: 'node.retrying', nodeId: 'a', attempt: 1, max: 3, delayMs: 1, message: '429', kind: 'rate_limit' }),
      ev(16, { type: 'node.queued', nodeId: 'a', others: 8 }),
      ev(20, { type: 'agent.request', nodeId: 'a', agentId: 'dev', attempt: 2, input: { text: '', files: [] }, model: 'claude-opus-5-5' }),
      ev(25, { type: 'agent.usage', nodeId: 'a', inputTokens: 100, outputTokens: 50, costUsd: 0.3 }),
      ev(26, { type: 'agent.usage', nodeId: 'a', inputTokens: 10, outputTokens: 5, costUsd: 0.01, source: 'supervisor' }),
      ev(30, { type: 'node.finished', nodeId: 'a', status: 'succeeded' }),
      ev(30, { type: 'node.started', nodeId: 'b' }),
      ev(30, { type: 'agent.request', nodeId: 'b', agentId: 'rev', attempt: 1, input: { text: '', files: [] } }),
      ev(32, { type: 'agent.usage', nodeId: 'b', inputTokens: 1, outputTokens: 1, costUsd: 0.1 }),
      ev(40, { type: 'node.finished', nodeId: 'b', status: 'succeeded' }),
      ev(40, { type: 'run.finished', status: 'succeeded' }),
    ];
    const m = runMetrics(events);
    expect(m.durationMs).toBe(40_000);
    const a = m.steps[0]!;
    expect(a).toMatchObject({ key: 'a#1', agentId: 'dev', model: 'claude-opus-5-5', attempts: 2, waitMs: 10_000, queueMs: 2000 + 4000, workMs: 28_000 - 10_000 - 4000, tokens: 150, costUsd: 0.3 });
    expect(a.retries).toEqual([{ kind: 'rate_limit', message: '429' }]);
    expect(m.steps[1]).toMatchObject({ agentId: 'rev', model: 'predeterminado', workMs: 10_000 });
    expect(m.total).toMatchObject({ steps: 2, attempts: 3, retries: 1, tokens: 152 });
    expect(m.byAgent.map((x) => x.agentId)).toEqual(['dev', 'rev']);
    expect(m.byModel).toEqual([
      { model: 'claude-opus-5-5', tokens: 150, costUsd: 0.3 },
      { model: 'predeterminado', tokens: 2, costUsd: 0.1 },
    ]);
    expect(m.supervisor).toEqual({ tokens: 15, costUsd: 0.01 });
  });
});

describe('SPEC-077 · Ajustes', () => {
  it('[R77.1][R77.8][R77.10] agentes en toda la app (1–32, 8 por defecto), qué hacer al llegar al presupuesto y el umbral de burn-rate', async () => {
    const { MAX_AGENTS_TOTAL, agentsTotal, defaultSettings, normalizeSettings, validateSettings } = await import('../src');
    expect(MAX_AGENTS_TOTAL).toBe(8);
    expect(agentsTotal(defaultSettings())).toBe(8);
    const ok = { ...defaultSettings(), maxAgentsTotal: 32, onBudget: 'finish-running' as const, burnRateUsdPerMin: 2.5 };
    expect(validateSettings(ok)).toEqual([]);
    expect(validateSettings({ ...ok, maxAgentsTotal: 33 }).map((p) => p.field)).toEqual(['maxAgentsTotal']);
    expect(validateSettings({ ...ok, onBudget: 'otra' }).map((p) => p.field)).toEqual(['onBudget']);
    expect(validateSettings({ ...ok, burnRateUsdPerMin: 0 }).map((p) => p.field)).toEqual(['burnRateUsdPerMin']);
    expect(normalizeSettings({ ...ok, maxAgentsTotal: 0 })).toMatchObject({ onBudget: 'finish-running', burnRateUsdPerMin: 2.5 });
    expect(normalizeSettings({ ...ok, maxAgentsTotal: 0 }).maxAgentsTotal).toBeUndefined();
  });
});
