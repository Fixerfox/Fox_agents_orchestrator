import { describe, expect, it } from 'vitest';
import type { Diagram, RunEvent, RunOptions } from '../src';
import { chain, deferred, fan, nodeFinished, ofType, setup, sleepMs, waitForEvent } from './helpers';

const startedA = (e: RunEvent) => e.type === 'node.started' && e.nodeId === 'a';

describe('SPEC-007 · control de ejecución', () => {
  it('[R7.1] cancel() aborta los agentes y emite run.cancelled antes de run.finished', async () => {
    const never = deferred();
    const { orch, agents } = setup({ scripts: { a: { waitFor: never.promise } } });
    const h = orch.start(chain(['a', 'b']), 'x');
    await waitForEvent(h.bus, startedA);
    h.cancel('usuario');
    const res = await h.result;
    expect(res.status).toBe('cancelled');
    const t = res.events.map((e) => e.type);
    expect(t.indexOf('run.cancelled')).toBeGreaterThan(-1);
    expect(t.indexOf('run.cancelled')).toBeLessThan(t.indexOf('run.finished'));
    expect(ofType(res.events, 'run.cancelled')[0]!.reason).toBe('usuario');
    expect(nodeFinished(res.events, 'a')?.status).toBe('cancelled');
    expect(agents.observedAbort).toContain('a');
    expect(agents.callsOf('b')).toHaveLength(0);
  });

  it('[R7.2] pause() detiene los pasos de un agente hasta resume(); son idempotentes', async () => {
    const { orch } = setup({ scripts: { a: { tokens: ['1', '2', '3'] } } });
    const h = orch.start(chain(['a']), 'x');
    let paused = false;
    h.bus.subscribe((e) => {
      if (e.type === 'token.stream' && !paused) {
        paused = true;
        h.pause();
        h.pause();
      }
    });
    await sleepMs(30);
    expect(ofType(h.bus.history(), 'token.stream')).toHaveLength(1);
    expect(ofType(h.bus.history(), 'run.paused')).toHaveLength(1);
    h.resume();
    h.resume();
    const res = await h.result;
    expect(res.status).toBe('succeeded');
    expect(ofType(res.events, 'token.stream')).toHaveLength(3);
    expect(ofType(res.events, 'run.resumed')).toHaveLength(1);
  });

  it('[R7.2] en pausa no se inician nodos nuevos', async () => {
    const d = deferred();
    const { orch, agents } = setup({ scripts: { a: { waitFor: d.promise } } });
    const h = orch.start(chain(['a', 'b']), 'x');
    await waitForEvent(h.bus, startedA);
    h.pause();
    d.resolve();
    await sleepMs(30);
    expect(agents.callsOf('b')).toHaveLength(0);
    expect(nodeFinished(h.bus.history(), 'a')).toBeUndefined();
    h.resume();
    const res = await h.result;
    expect(res.status).toBe('succeeded');
    expect(agents.callsOf('b')).toHaveLength(1);
  });

  it('[R7.3] cancelar durante una pausa libera la ejecución', async () => {
    const never = deferred();
    const { orch } = setup({ scripts: { a: { waitFor: never.promise } } });
    const h = orch.start(chain(['a']), 'x');
    await waitForEvent(h.bus, startedA);
    h.pause();
    h.cancel();
    const res = await Promise.race([h.result, sleepMs(500).then(() => 'timeout' as const)]);
    expect(res).not.toBe('timeout');
    expect(typeof res === 'object' && res.status).toBe('cancelled');
  });

  it('[R7.4] el presupuesto detiene la ejecución una sola vez y no empiezan nodos posteriores', async () => {
    const usage = { inputTokens: 60, outputTokens: 40 };
    const { orch, agents } = setup({ scripts: { a: { usage } } });
    const res = await orch.start(chain(['a', 'b']), 'x', { budget: { maxTokens: 50 } }).result;
    expect(res.status).toBe('failed');
    expect(res.reason).toBe('budget_exceeded');
    const hits = ofType(res.events, 'run.budget_reached');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ limit: 'tokens', used: 100, max: 50 });
    expect(agents.callsOf('b')).toHaveLength(0);

    // llegar exactamente al límite también cuenta
    const exact = setup({ scripts: { a: { usage: { inputTokens: 30, outputTokens: 20 } } } });
    const r2 = await exact.orch.start(chain(['a']), 'x', { budget: { maxTokens: 50 } }).result;
    expect(r2.reason).toBe('budget_exceeded');

    // coste
    const cost = setup({ scripts: { a: { usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.02 } } } });
    const r3 = await cost.orch.start(chain(['a']), 'x', { budget: { maxCostUsd: 0.01 } }).result;
    expect(ofType(r3.events, 'run.budget_reached')[0]!.limit).toBe('cost');

    // varios agentes en paralelo: un solo evento
    const ids = ['a', 'b', 'c'];
    const par = setup({ scripts: Object.fromEntries(ids.map((i) => [i, { usage, latencyMs: 5 }])) });
    const r4 = await par.orch.start(fan(ids), 'x', { budget: { maxTokens: 50 } }).result;
    expect(ofType(r4.events, 'run.budget_reached')).toHaveLength(1);
  });

  it('[R7.5][R7.7] reintenta errores temporales con espera creciente y registra cada intento', async () => {
    const { orch, sleeps } = setup({ scripts: { a: { failTimes: 2 } } });
    const res = await orch
      .start(chain(['a']), 'x', { retry: { maxAttempts: 3, baseDelayMs: 10 } })
      .result;
    expect(res.status).toBe('succeeded');
    expect(ofType(res.events, 'node.retrying').map(({ attempt, max, delayMs }) => ({ attempt, max, delayMs }))).toEqual([
      { attempt: 1, max: 3, delayMs: 10 },
      { attempt: 2, max: 3, delayMs: 20 },
    ]);
    expect(sleeps).toEqual([10, 20]);
    // R7.7
    expect(ofType(res.events, 'agent.request').map((e) => e.attempt)).toEqual([1, 2, 3]);
    const errors = ofType(res.events, 'error');
    expect(errors).toHaveLength(2);
    expect(errors.every((e) => e.retriable && e.nodeId === 'a')).toBe(true);
  });

  it('[R7.5] agotados los intentos el nodo falla; por defecto 3 intentos y 1 s de base', async () => {
    const { orch, sleeps } = setup({ scripts: { a: { failTimes: 3 } } });
    const res = await orch.start(chain(['a']), 'x').result;
    expect(res.status).toBe('failed');
    expect(nodeFinished(res.events, 'a')?.status).toBe('failed');
    expect(ofType(res.events, 'agent.request')).toHaveLength(3);
    expect(ofType(res.events, 'node.retrying')).toHaveLength(2);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it('[R7.6] un error no temporal falla en el primer intento', async () => {
    const { orch } = setup({ scripts: { a: { failTimes: 1, failRetriable: false } } });
    const res = await orch.start(chain(['a']), 'x').result;
    expect(res.status).toBe('failed');
    expect(ofType(res.events, 'agent.request')).toHaveLength(1);
    expect(ofType(res.events, 'node.retrying')).toHaveLength(0);
    expect(ofType(res.events, 'error')[0]!.retriable).toBe(false);
  });
});

describe('SPEC-002 · invariantes del log en todos los desenlaces', () => {
  function assertInvariants(events: readonly RunEvent[]) {
    expect(events[0]!.type).toBe('run.started');
    expect(events.at(-1)!.type).toBe('run.finished');
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
    const key = (e: RunEvent & { nodeId: string }) => `${(e.nodePath ?? []).join('/')}|${e.nodeId}`;
    const finished = new Set(ofType(events, 'node.finished').map(key));
    for (const s of ofType(events, 'node.started')) expect(finished.has(key(s))).toBe(true);
  }

  const run = async (d: Diagram, opts: RunOptions = {}, scripts = {}) => {
    const { orch } = setup({ scripts });
    return (await orch.start(d, 'x', opts).result).events;
  };

  it('[R2.7][R2.8] éxito, fallo, diagrama inválido, presupuesto y cancelación', async () => {
    assertInvariants(await run(chain(['a', 'b'])));
    assertInvariants(await run(chain(['a', 'b']), {}, { a: { failTimes: 9, failRetriable: false } }));
    assertInvariants(await run({ ...chain(['a']), schemaVersion: 9 }));
    assertInvariants(await run(chain(['a', 'b']), { budget: { maxTokens: 1 } }, { a: { usage: { inputTokens: 5, outputTokens: 5 } } }));

    const never = deferred();
    const { orch } = setup({ scripts: { a: { waitFor: never.promise } } });
    const h = orch.start(chain(['a', 'b']), 'x');
    await waitForEvent(h.bus, startedA);
    h.cancel();
    assertInvariants((await h.result).events);
  });
});
