import { describe, expect, it } from 'vitest';
import {
  AgentError,
  MockAgent,
  MockDecider,
  Orchestrator,
  UNFINISHED_STOP,
  applyRules,
  mergeLimits,
  newRuleState,
  unansweredPolicy,
  type AgentAdapter,
  type AgentRequest,
  type AgentStreamEvent,
  type Decider,
  type Diagram,
  type MockAgentScript,
  type RunEvent,
  type RunOptions,
  type StepLimits,
} from '../src';
import { FakeTimers, MIN, flush } from './fake-timers';
import { chain, diagram, edge, ENTRY, OUTPUT, ofType, router, agent } from './helpers';

/** Espera a que llegue la señal de cancelación, o nunca si el adaptador la ignora. */
const untilAbort = (signal: AbortSignal, ignore = false) =>
  new Promise<never>((_, reject) => {
    if (ignore) return;
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });

/** Adaptador que hace lo que diga `script` en cada intento. */
class ScriptedAdapter implements AgentAdapter {
  readonly calls: AgentRequest[] = [];
  constructor(private readonly script: (req: AgentRequest, signal: AbortSignal, n: number) => AsyncIterable<AgentStreamEvent>) {}
  run(req: AgentRequest, signal: AbortSignal): AsyncIterable<AgentStreamEvent> {
    this.calls.push(req);
    return this.script(req, signal, this.calls.length);
  }
}

function start(opts: { adapter?: AgentAdapter; scripts?: Record<string, MockAgentScript>; decider?: Decider; d?: Diagram; options?: RunOptions; agentLimits?: StepLimits }) {
  const timers = new FakeTimers();
  const orch = new Orchestrator({
    getAdapter: () => opts.adapter ?? new MockAgent(opts.scripts),
    decider: opts.decider ?? new MockDecider(),
    timers,
    sleep: async () => undefined,
    newRunId: () => 'run-1',
    ...(opts.agentLimits ? { agentLimits: () => opts.agentLimits } : {}),
  });
  const handle = orch.start(opts.d ?? chain(['a']), 'x', { retry: { maxAttempts: 2, baseDelayMs: 1 }, ...opts.options });
  return { timers, handle, events: () => handle.bus.history() as readonly RunEvent[] };
}

const finishedOk = async (h: { result: Promise<{ status: string }> }) => (await h.result).status;

describe('SPEC-070 · latido de los pasos de agente', () => {
  it('[R70.1] [R70.4] [R70.5] sin señales de vida: aviso a la mitad y corte reintentable al llegar al umbral', async () => {
    const adapter = new ScriptedAdapter(async function* (_r, signal) {
      yield { type: 'token', text: 'empiezo' };
      await untilAbort(signal);
    });
    const { timers, handle, events } = start({ adapter });
    await timers.advance(5 * MIN - 1);
    expect(ofType(events(), 'supervisor.alert').filter((a) => a.rule === 'stalled')).toHaveLength(0);
    await timers.advance(1);
    const stalled = ofType(events(), 'supervisor.alert').filter((a) => a.rule === 'stalled');
    expect(stalled).toHaveLength(1);
    expect(stalled[0]!.severity).toBe('info');
    expect(stalled[0]!.detail).toContain('5 min');
    await timers.advance(5 * MIN);
    const cut = ofType(events(), 'node.timeout');
    expect(cut).toEqual([expect.objectContaining({ nodeId: 'a', attempt: 1, kind: 'idle', minutes: 10 })]);
    const retry = ofType(events(), 'node.retrying')[0]!;
    expect(retry).toMatchObject({ kind: 'timeout', cause: 'timeout' });
    expect(ofType(events(), 'error')[0]!.message).toContain('no dio señales de vida en 10 min');
    // El segundo intento también se corta y el paso falla.
    await timers.advance(10 * MIN);
    expect(await finishedOk(handle)).toBe('failed');
  });

  it('[R70.1] cada evento de actividad reinicia el reloj', async () => {
    let tick: (() => void) | undefined;
    const adapter = new ScriptedAdapter(async function* (_r, signal) {
      for (let i = 0; i < 3; i++) {
        await new Promise<void>((r) => (tick = r));
        yield { type: 'token', text: `t${i}` };
      }
      void signal;
      yield { type: 'result', text: 'hecho' };
    });
    const { timers, handle, events } = start({ adapter });
    for (let i = 0; i < 3; i++) {
      await timers.advance(9 * MIN);
      tick!();
    }
    await flush();
    expect(ofType(events(), 'node.timeout')).toHaveLength(0);
    expect(await finishedOk(handle)).toBe('succeeded');
  });

  it('[R70.2] con una herramienta en curso el umbral es el de herramienta (30 min)', async () => {
    const adapter = new ScriptedAdapter(async function* (_r, signal) {
      yield { type: 'tool_call', tool: 'Bash', input: { command: 'npm test' } };
      await untilAbort(signal);
    });
    const { timers, events } = start({ adapter });
    await timers.advance(29 * MIN);
    expect(ofType(events(), 'node.timeout')).toHaveLength(0);
    expect(ofType(events(), 'supervisor.alert').find((a) => a.rule === 'stalled')!.detail).toContain('Bash');
    await timers.advance(MIN);
    expect(ofType(events(), 'node.timeout')[0]).toMatchObject({ kind: 'tool', minutes: 30, tool: 'Bash' });
  });

  it('[R70.3] el reloj se detiene mientras el paso espera a la persona y vuelve a cero al seguir', async () => {
    const { timers, handle, events } = start({ scripts: { a: { asks: [{ question: '¿Sigo?' }] } } });
    await timers.advance(40 * MIN);
    expect(ofType(events(), 'node.timeout')).toHaveLength(0);
    handle.answer('q-1', 'sí');
    expect(await finishedOk(handle)).toBe('succeeded');
  });

  it('[R70.3] la pausa de la ejecución tampoco corta', async () => {
    const adapter = new ScriptedAdapter(async function* (_r, signal) {
      yield { type: 'token', text: 'a' };
      await untilAbort(signal);
    });
    const { timers, handle, events } = start({ adapter });
    await flush();
    handle.pause();
    await timers.advance(30 * MIN);
    expect(ofType(events(), 'node.timeout')).toHaveLength(0);
    handle.cancel();
    await handle.result;
  });

  it('[R70.6] la duración máxima del intento corta aunque haya actividad', async () => {
    const adapter = new ScriptedAdapter(async function* (_r, signal) {
      while (!signal.aborted) {
        yield { type: 'token', text: '.' };
        await new Promise<void>((r) => setImmediate(r));
      }
    });
    const d: Diagram = diagram([ENTRY, { ...agent('a'), limits: { maxMinutes: 3 } }, OUTPUT], [edge('entry', 'a'), edge('a', 'output')]);
    const { timers, events, handle } = start({ adapter, d, options: { retry: { maxAttempts: 1, baseDelayMs: 1 } } });
    await timers.advance(3 * MIN);
    expect(ofType(events(), 'node.timeout')[0]).toMatchObject({ kind: 'total', minutes: 3 });
    expect(await finishedOk(handle)).toBe('failed');
  });

  it('[R70.7] los límites salen del paso, luego de la ficha del agente y luego de la ejecución', async () => {
    expect(mergeLimits({ idleMinutes: 3 }, { idleMinutes: 5, toolMinutes: 40 }, { idleMinutes: 9, toolMinutes: 9, maxMinutes: 60 })).toEqual({ idleMinutes: 3, toolMinutes: 40, maxMinutes: 60 });
    const adapter = new ScriptedAdapter(async function* (_r, signal) {
      yield { type: 'token', text: 'a' };
      await untilAbort(signal);
    });
    const { timers, events } = start({ adapter, agentLimits: { idleMinutes: 2 }, options: { limits: { idleMinutes: 50 }, retry: { maxAttempts: 1, baseDelayMs: 1 } } });
    await timers.advance(2 * MIN);
    expect(ofType(events(), 'node.timeout')[0]).toMatchObject({ kind: 'idle', minutes: 2 });
  });

  it('[R70.8] si el motor no devuelve el control tras cortar, el intento se abandona a los 10 s', async () => {
    const adapter = new ScriptedAdapter(async function* (_r, signal, n) {
      if (n === 1) {
        yield { type: 'token', text: 'a' };
        await untilAbort(signal, true);
      }
      yield { type: 'result', text: 'segundo intento' };
    });
    const { timers, handle, events } = start({ adapter });
    await timers.advance(10 * MIN);
    expect(ofType(events(), 'node.timeout')).toHaveLength(1);
    expect(ofType(events(), 'node.retrying')).toHaveLength(0);
    await timers.advance(10_000);
    expect(ofType(events(), 'node.retrying')).toHaveLength(1);
    expect(await finishedOk(handle)).toBe('succeeded');
  });

  it('[R70.9] los relojes son los inyectados: sin avanzar no pasa nada', async () => {
    const adapter = new ScriptedAdapter(async function* (_r, signal) {
      yield { type: 'token', text: 'a' };
      await untilAbort(signal);
    });
    const { timers, handle, events } = start({ adapter });
    await flush();
    expect(timers.pending).toBeGreaterThan(0);
    expect(ofType(events(), 'node.timeout')).toHaveLength(0);
    handle.cancel();
    await handle.result;
  });
});

describe('SPEC-070 · bucle de herramientas', () => {
  const call = (n: number) => ({ type: 'tool.called', nodeId: 'a', tool: 'Read', input: { file_path: 'x.ts' }, runId: 'r', seq: n, ts: '' }) as RunEvent;

  it('[R70.10] la misma herramienta con la misma entrada 4 veces seguidas da aviso; un archivo cambiado lo reinicia', () => {
    const state = newRuleState();
    const alerts = [1, 2, 3].flatMap((n) => applyRules(state, call(n), undefined));
    expect(alerts).toEqual([]);
    expect(applyRules(state, call(4), undefined)).toEqual([expect.objectContaining({ rule: 'tool-loop', nodeId: 'a' })]);
    const fresh = newRuleState();
    for (const n of [1, 2, 3]) applyRules(fresh, call(n), undefined);
    applyRules(fresh, { type: 'file.produced', nodeId: 'a', path: 'x.ts', runId: 'r', seq: 9, ts: '' } as RunEvent, undefined);
    expect(applyRules(fresh, call(10), undefined)).toEqual([]);
    // Con espacios distintos sigue siendo la misma entrada.
    expect(applyRules(newRuleState(), { ...call(1), input: { file_path: 'x.ts' } } as RunEvent, undefined)).toEqual([]);
  });

  it('[R70.11] a la octava repetición se corta el intento', async () => {
    const adapter = new ScriptedAdapter(async function* (_r, _s, n) {
      if (n === 1) for (let i = 0; i < 9; i++) yield { type: 'tool_call', tool: 'Read', input: { file_path: 'x.ts' } };
      yield { type: 'result', text: 'ok' };
    });
    const { handle, events } = start({ adapter });
    expect(await finishedOk(handle)).toBe('succeeded');
    expect(ofType(events(), 'tool.called').filter((e) => e.nodeId === 'a')).toHaveLength(8);
    expect(ofType(events(), 'node.timeout')[0]).toMatchObject({ kind: 'loop' });
    expect(ofType(events(), 'node.retrying')[0]).toMatchObject({ cause: 'loop' });
    expect(ofType(events(), 'error')[0]!.message).toContain('8 veces');
  });
});

describe('SPEC-070 · decisiones', () => {
  it('[R70.12] una decisión que tarda más de su tiempo máximo se cancela y cuenta como error reintentable', async () => {
    let calls = 0;
    const decider = new MockDecider();
    decider.route = (_r, signal) => {
      calls++;
      if (calls === 1) return untilAbort(signal);
      return Promise.resolve({ edgeIds: ['r->a'], reason: 'ok' });
    };
    const d = diagram([ENTRY, router('r', 'ai'), agent('a'), OUTPUT], [edge('entry', 'r'), edge('r', 'a'), edge('a', 'output')]);
    const { timers, handle, events } = start({ decider, d, options: { decisionTimeoutMs: 120_000 } });
    await timers.advance(120_000);
    expect(ofType(events(), 'node.retrying')[0]).toMatchObject({ nodeId: 'r', message: expect.stringContaining('120 s') });
    expect(await finishedOk(handle)).toBe('succeeded');
    expect(calls).toBe(2);
  });
});

describe('SPEC-070 · preguntas', () => {
  it('[R70.13] «no terminó lo pedido» trae como respuesta segura «Parar la ejecución»', async () => {
    const timers = new FakeTimers();
    const decider = new MockDecider({ supervise: async () => ({ ok: false, reason: 'falta', summary: '' }) });
    const orch = new Orchestrator({ getAdapter: () => new MockAgent(), decider, timers, supervisor: { review: () => true }, newRunId: () => 'r' });
    const h = orch.start(chain(['a']), 'x', { unanswered: { afterMinutes: 1, action: 'fallback' } });
    await timers.advance(MIN);
    const answer = ofType(h.bus.history(), 'agent.answer')[0]!;
    expect(answer).toMatchObject({ text: UNFINISHED_STOP, auto: true });
    expect((await h.result).status).toBe('failed');
  });

  it('[R70.14] [R70.15] con «fallback» se responde sola si hay respuesta segura, y si no el paso falla', async () => {
    const withFallback = new ScriptedAdapter(async function* (req) {
      const a = await req.ask({ text: '¿Puedo modificar x.ts?', options: ['Permitir', 'Denegar'], kind: 'permission', fallback: 'Denegar' });
      yield { type: 'result', text: `respuesta: ${a}` };
    });
    const one = start({ adapter: withFallback, options: { unanswered: { afterMinutes: 30, action: 'fallback' } } });
    await one.timers.advance(30 * MIN);
    expect(ofType(one.events(), 'agent.answer')[0]).toMatchObject({ text: 'Denegar', auto: true });
    expect((await one.handle.result).output?.text).toBe('respuesta: Denegar');

    const two = start({ scripts: { a: { asks: [{ question: '¿Qué base de datos uso?' }] } }, options: { unanswered: { afterMinutes: 30, action: 'fallback' } } });
    await two.timers.advance(30 * MIN);
    expect(await finishedOk(two.handle)).toBe('failed');
    expect(ofType(two.events(), 'error')[0]!.message).toContain('nadie respondió en 30 min');
  });

  it('[R70.14] con «wait» se espera siempre; con «fail» falla el paso', async () => {
    const wait = start({ scripts: { a: { asks: [{ question: '?' }] } }, options: { unanswered: { afterMinutes: 1, action: 'wait' } } });
    await wait.timers.advance(600 * MIN);
    expect(ofType(wait.events(), 'error')).toHaveLength(0);
    wait.handle.answer('q-1', 'ok');
    expect(await finishedOk(wait.handle)).toBe('succeeded');

    const fail = start({ scripts: { a: { asks: [{ question: '?', options: ['Sí'] }] } }, options: { unanswered: { afterMinutes: 5, action: 'fail' } } });
    await fail.timers.advance(5 * MIN);
    expect(await finishedOk(fail.handle)).toBe('failed');
  });

  it('[R70.16] a los 15 minutos llega un recordatorio, solo uno por pregunta', async () => {
    const { timers, handle, events } = start({ scripts: { a: { asks: [{ question: '¿Color?' }] } } });
    await timers.advance(15 * MIN);
    await timers.advance(60 * MIN);
    expect(ofType(events(), 'question.reminder')).toEqual([expect.objectContaining({ nodeId: 'a', questionId: 'q-1', text: '¿Color?', minutes: 15 })]);
    handle.answer('q-1', 'rojo');
    await handle.result;
  });

  it('[R70.17] los permisos de Claude también siguen la política, no la espera del gancho', async () => {
    const adapter = new ScriptedAdapter(async function* (req) {
      const a = await req.ask({ text: '¿Puedo ejecutar rm?', options: ['Permitir', 'Denegar'], kind: 'permission', fallback: 'Denegar' });
      yield { type: 'result', text: a };
    });
    const { timers, handle } = start({ adapter, options: { unanswered: { afterMinutes: 10, action: 'fallback' } } });
    await timers.advance(10 * MIN);
    expect((await handle.result).output?.text).toBe('Denegar');
  });

  it('[R70.18] `questionTimeoutMs` se traduce a la política «fail»', () => {
    expect(unansweredPolicy({ questionTimeoutMs: 120_000 })).toEqual({ afterMinutes: 2, action: 'fail' });
    expect(unansweredPolicy({})).toEqual({ afterMinutes: 60, action: 'wait' });
    expect(unansweredPolicy({ unanswered: { afterMinutes: 3, action: 'fallback' }, questionTimeoutMs: 1 })).toEqual({ afterMinutes: 3, action: 'fallback' });
  });

  it('[R70.5] un corte por tiempo es un `AgentError` del tipo «timeout»', () => {
    const e = new AgentError('x', true, [], { kind: 'timeout' });
    expect(e.retriable).toBe(true);
    expect(e.kind).toBe('timeout');
  });
});
