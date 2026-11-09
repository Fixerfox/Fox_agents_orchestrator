import { describe, expect, it } from 'vitest';
import {
  AgentError,
  MockAgent,
  MockDecider,
  Orchestrator,
  RetryPolicy,
  describePreviousAttempt,
  isLimitError,
  type AgentAdapter,
  type AgentRequest,
  type AgentStreamEvent,
  type Diagram,
  type RestoreResult,
  type RunOptions,
} from '../src';
import { agent, chain, diagram, edge, ENTRY, OUTPUT, ofType, router } from './helpers';

class ScriptedAdapter implements AgentAdapter {
  readonly calls: AgentRequest[] = [];
  constructor(private readonly script: (req: AgentRequest, n: number) => AsyncIterable<AgentStreamEvent>) {}
  run(req: AgentRequest): AsyncIterable<AgentStreamEvent> {
    this.calls.push(req);
    return this.script(req, this.calls.filter((c) => c.agentId === req.agentId).length);
  }
}

function start(adapter: AgentAdapter, opts: { d?: Diagram; options?: RunOptions; restoreFiles?: (files: { path: string; change?: 'created' | 'modified' }[]) => Promise<RestoreResult>; decider?: MockDecider } = {}) {
  const sleeps: number[] = [];
  const orch = new Orchestrator({
    getAdapter: () => adapter,
    decider: opts.decider ?? new MockDecider(),
    sleep: async (ms) => void sleeps.push(ms),
    newRunId: () => 'run-1',
    ...(opts.restoreFiles ? { restoreFiles: (_run: string, files: { path: string; change?: 'created' | 'modified' }[]) => opts.restoreFiles!(files) } : {}),
  });
  return { handle: orch.start(opts.d ?? chain(['a']), 'x', opts.options), sleeps };
}

describe('SPEC-071 · clasificación y espera', () => {
  it('[R71.1] el tipo decide si se reintenta; sin tipo se deduce como antes', () => {
    expect(new AgentError('x', true).kind).toBe('transient');
    expect(new AgentError('x').kind).toBe('fatal');
    expect(new AgentError('x', false, [{ kind: 'skill', id: 's' }]).kind).toBe('unmet');
    const limit = new AgentError('x', false, [], { kind: 'rate_limit', retryAfterMs: 2000 });
    expect(limit.retriable).toBe(true);
    expect(limit.retryAfterMs).toBe(2000);
    expect(isLimitError(limit)).toBe(true);
    expect(isLimitError(new AgentError('x', true, [], { kind: 'overloaded' }))).toBe(true);
    expect(new AgentError('x', true, [], { kind: 'fatal' }).retriable).toBe(false);
  });

  it('[R71.3] jitter completo entre 0 y el tope, con tope de 60 s', () => {
    const p = new RetryPolicy({ maxAttempts: 3, baseDelayMs: 1000, jitter: true }, undefined, () => 0.5);
    expect(p.delayAfter(1)).toBe(500);
    expect(p.delayAfter(3)).toBe(2000);
    expect(p.delayAfter(20)).toBe(30_000);
    const zero = new RetryPolicy({ maxAttempts: 3, baseDelayMs: 1000, jitter: true }, undefined, () => 0);
    expect(zero.delayAfter(5)).toBe(0);
    // Sin jitter (la configuración por defecto del núcleo) la espera es la de siempre.
    expect(new RetryPolicy().delayAfter(3)).toBe(4000);
    expect(new RetryPolicy({ maxAttempts: 9, baseDelayMs: 1000 }).delayAfter(10)).toBe(60_000);
  });

  it('[R71.4] con `retry-after` se espera lo que diga, como mínimo la espera normal y como mucho 10 min', () => {
    const p = new RetryPolicy({ maxAttempts: 3, baseDelayMs: 1000 });
    expect(p.delayAfter(1, new AgentError('x', true, [], { kind: 'rate_limit', retryAfterMs: 20_000 }))).toBe(20_000);
    expect(p.delayAfter(3, new AgentError('x', true, [], { kind: 'rate_limit', retryAfterMs: 10 }))).toBe(4000);
    expect(p.delayAfter(1, new AgentError('x', true, [], { kind: 'rate_limit', retryAfterMs: 3_600_000 }))).toBe(600_000);
  });

  it('[R71.5] [R71.6] los límites de uso tienen su propia cuenta y `node.retrying` dice el tipo y la causa', async () => {
    let n = 0;
    const adapter = new ScriptedAdapter(async function* () {
      n++;
      if (n <= 4) throw new AgentError('límite', true, [], { kind: 'rate_limit', retryAfterMs: 1000 });
      yield { type: 'result', text: 'por fin' };
    });
    const { handle, sleeps } = start(adapter, { options: { retry: { maxAttempts: 3, baseDelayMs: 1 } } });
    const res = await handle.result;
    expect(res.status).toBe('succeeded');
    const retries = ofType(res.events, 'node.retrying');
    expect(retries).toHaveLength(4);
    expect(retries[0]).toMatchObject({ kind: 'rate_limit', max: 5 });
    expect(retries[0]!.cause).toBeUndefined();
    expect(sleeps.every((ms) => ms >= 1000)).toBe(true);

    let m = 0;
    const always = new ScriptedAdapter(async function* () {
      m++;
      throw new AgentError('límite', true, [], { kind: 'rate_limit' });
      yield { type: 'result', text: '' };
    });
    const failed = await start(always, { options: { retry: { maxAttempts: 3, baseDelayMs: 1, limitAttempts: 2 } } }).handle.result;
    expect(failed.status).toBe('failed');
    expect(m).toBe(2);
  });
});

describe('SPEC-071 · lo que recibe el siguiente intento', () => {
  const twoAttempts = () =>
    new ScriptedAdapter(async function* (_req, n) {
      if (n === 1) {
        yield { type: 'tool_call', tool: 'Write', input: { file_path: 'a.ts' } };
        yield { type: 'file', path: 'a.ts', change: 'created' };
        yield { type: 'file', path: 'b.ts', change: 'modified' };
        yield { type: 'file', path: 'gen.html', change: 'created', via: 'command' };
        throw new AgentError('se cayó la red', true);
      }
      yield { type: 'result', text: 'hecho' };
    });

  it('[R71.7] [R71.8] el segundo intento recibe el error, sus acciones y los archivos que dejó, y queda en `agent.request`', async () => {
    const adapter = twoAttempts();
    const res = await start(adapter).handle.result;
    expect(res.status).toBe('succeeded');
    const prev = adapter.calls[1]!.previousAttempt!;
    expect(prev).toMatchObject({ attempt: 1, kind: 'transient', ended: 'error', message: 'se cayó la red' });
    expect(prev.actions).toEqual(['Write: {"file_path":"a.ts"}']);
    expect(prev.files).toEqual([
      { path: 'a.ts', change: 'created' },
      { path: 'b.ts', change: 'modified' },
      { path: 'gen.html', change: 'created', via: 'command' },
    ]);
    expect(adapter.calls[0]!.previousAttempt).toBeUndefined();
    expect(ofType(res.events, 'agent.request')[1]!.previousAttempt).toEqual(prev);
    const text = describePreviousAttempt(prev);
    expect(text).toContain('El intento 1 falló con un error: se cayó la red');
    expect(text).toContain('a.ts (creado)');
    expect(text).toContain('Revisa esos archivos');
  });

  it('[R71.8] lo que se cuenta tiene un tope de 3.000 caracteres, recortado por el medio', () => {
    const text = describePreviousAttempt({ attempt: 1, kind: 'transient', ended: 'error', message: 'x', actions: [], files: Array.from({ length: 400 }, (_, i) => ({ path: `carpeta/archivo-${i}.ts`, change: 'modified' as const })) });
    expect(text.length).toBeLessThanOrEqual(3000);
    expect(text).toContain('El intento 1');
    expect(text).toContain('Revisa esos archivos');
  });

  it('[R71.9] solo viaja el intento inmediatamente anterior', async () => {
    const adapter = new ScriptedAdapter(async function* (_req, n) {
      if (n < 3) throw new AgentError(`fallo ${n}`, true);
      yield { type: 'result', text: 'ok' };
    });
    await start(adapter).handle.result;
    expect(adapter.calls[2]!.previousAttempt).toMatchObject({ attempt: 2, message: 'fallo 2' });
  });
});

describe('SPEC-071 · volver al punto de partida', () => {
  const d = diagram([ENTRY, { ...agent('a'), onRetry: 'restore' }, OUTPUT], [edge('entry', 'a'), edge('a', 'output')]);

  it('[R71.10] [R71.12] con `restore` se piden los archivos del intento, sin los cambiados por comandos, y se emite `files.restored`', async () => {
    const asked: { path: string; change?: string }[][] = [];
    const adapter = new ScriptedAdapter(async function* (_req, n) {
      if (n === 1) {
        yield { type: 'file', path: 'a.ts', change: 'created' };
        yield { type: 'file', path: 'b.ts', change: 'modified' };
        yield { type: 'file', path: 'gen.html', change: 'created', via: 'command' };
        throw new AgentError('corte', true);
      }
      yield { type: 'result', text: 'ok' };
    });
    const res = await start(adapter, {
      d,
      restoreFiles: async (files) => {
        asked.push(files);
        return { restored: ['b.ts'], removed: ['a.ts'], failed: [] };
      },
    }).handle.result;
    expect(asked).toEqual([[{ path: 'a.ts', change: 'created' }, { path: 'b.ts', change: 'modified' }]]);
    expect(ofType(res.events, 'files.restored')[0]).toMatchObject({ nodeId: 'a', attempt: 1, restored: ['b.ts'], removed: ['a.ts'], failed: [{ path: 'gen.html', reason: 'cambiado por un comando' }] });
    expect(adapter.calls[1]!.previousAttempt!.files).toEqual([
      { path: 'a.ts', change: 'created', restored: true },
      { path: 'b.ts', change: 'modified', restored: true },
      { path: 'gen.html', change: 'created', via: 'command' },
    ]);
  });

  it('[R71.10] sin `restore` (por defecto) no se toca nada', async () => {
    let called = false;
    const adapter = new ScriptedAdapter(async function* (_req, n) {
      if (n === 1) {
        yield { type: 'file', path: 'a.ts', change: 'created' };
        throw new AgentError('corte', true);
      }
      yield { type: 'result', text: 'ok' };
    });
    const res = await start(adapter, { restoreFiles: async () => ((called = true), { restored: [], removed: [], failed: [] }) }).handle.result;
    expect(called).toBe(false);
    expect(ofType(res.events, 'files.restored')).toHaveLength(0);
  });

  it('[R71.11] no se restaura lo que ya estaba cambiado antes del intento ni lo que otro paso cambió', async () => {
    const two = diagram([ENTRY, agent('p'), { ...agent('a'), onRetry: 'restore' }, OUTPUT], [edge('entry', 'p'), edge('p', 'a'), edge('a', 'output')]);
    const asked: { path: string }[][] = [];
    const adapter = new ScriptedAdapter(async function* (req, n) {
      if (req.agentId === 'p') {
        yield { type: 'file', path: 'compartido.ts', change: 'modified' };
        yield { type: 'result', text: 'p' };
        return;
      }
      if (n === 1) {
        yield { type: 'file', path: 'compartido.ts', change: 'modified' };
        yield { type: 'file', path: 'propio.ts', change: 'modified' };
        throw new AgentError('corte', true);
      }
      yield { type: 'result', text: 'ok' };
    });
    const res = await start(adapter, { d: two, restoreFiles: async (f) => (asked.push(f), { restored: f.map((x) => x.path), removed: [], failed: [] }) }).handle.result;
    expect(asked).toEqual([[{ path: 'propio.ts', change: 'modified' }]]);
    expect(ofType(res.events, 'files.restored')[0]!.failed).toEqual([{ path: 'compartido.ts', reason: 'ya estaba cambiado antes de este intento' }]);
  });
});

describe('SPEC-071 · decisiones', () => {
  it('[R71.13] [R71.14] un router que falla de forma temporal se reintenta, y cuenta lo que gasta el intento bueno', async () => {
    let calls = 0;
    const decider = new MockDecider({ decisionUsage: { inputTokens: 10, outputTokens: 5 } });
    const route = decider.route;
    decider.route = async (r, s) => {
      calls++;
      if (calls === 1) throw new AgentError('529', true, [], { kind: 'overloaded' });
      return route(r, s);
    };
    const d = diagram([ENTRY, router('r', 'ai'), agent('a'), OUTPUT], [edge('entry', 'r'), edge('r', 'a'), edge('a', 'output')]);
    const res = await start(new MockAgent(), { d, decider }).handle.result;
    expect(res.status).toBe('succeeded');
    expect(calls).toBe(2);
    expect(ofType(res.events, 'node.retrying')).toEqual([expect.objectContaining({ nodeId: 'r', kind: 'overloaded', max: 3 })]);
    expect(ofType(res.events, 'agent.usage').filter((u) => u.source === 'decision')).toHaveLength(1);
  });

  it('[R71.13] un error definitivo de una decisión no se reintenta', async () => {
    let calls = 0;
    const decider = new MockDecider();
    decider.route = async () => {
      calls++;
      throw new AgentError('petición no válida', false);
    };
    const d = diagram([ENTRY, router('r', 'ai'), agent('a'), OUTPUT], [edge('entry', 'r'), edge('r', 'a'), edge('a', 'output')]);
    const res = await start(new MockAgent(), { d, decider }).handle.result;
    expect(res.status).toBe('failed');
    expect(calls).toBe(1);
  });
});
