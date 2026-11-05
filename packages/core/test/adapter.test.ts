import { describe, expect, it } from 'vitest';
import { AgentError, MockAgent, MockDecider, Orchestrator, type AgentAdapter } from '../src';
import { chain, deferred, req, setup } from './helpers';

describe('SPEC-009 · contrato de adapter y mocks', () => {
  it('[R9.1] la salida es el result final; sin result, los tokens concatenados', async () => {
    const tokensOnly: AgentAdapter = {
      async *run() {
        yield { type: 'token', text: 'a' };
        yield { type: 'token', text: 'b' };
      },
    };
    const withResult: AgentAdapter = {
      async *run() {
        yield { type: 'token', text: 'a' };
        yield { type: 'result', text: 'final' };
      },
    };
    const outputOf = async (adapter: AgentAdapter) => {
      const orch = new Orchestrator({ getAdapter: () => adapter, decider: new MockDecider() });
      return (await orch.start(chain(['x']), 'q').result).output?.text;
    };
    expect(await outputOf(tokensOnly)).toBe('ab');
    expect(await outputOf(withResult)).toBe('final');
  });

  it('[R9.2] respeta la señal de cancelación y libera sus recursos', async () => {
    const mock = new MockAgent({ a: { waitFor: deferred().promise } });
    const ac = new AbortController();
    const consume = (async () => {
      for await (const ev of mock.run(req('a'), ac.signal)) void ev;
    })();
    await Promise.resolve();
    expect(mock.active).toBe(1);
    ac.abort();
    await expect(consume).rejects.toThrow('aborted');
    expect(mock.active).toBe(0);
    expect(mock.observedAbort).toEqual(['a']);
  });

  it('[R9.3] AgentError indica si el fallo es temporal', () => {
    const e = new AgentError('x');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('AgentError');
    expect(e.retriable).toBe(false);
    expect(new AgentError('y', true).retriable).toBe(true);
  });

  it('[R9.4] MockAgent registra llamadas, concurrencia y fallos por agente', async () => {
    const mock = new MockAgent({ a: { latencyMs: 10, failTimes: 1 }, b: { latencyMs: 10 } });
    const drain = async (id: string) => {
      for await (const ev of mock.run(req(id, 'hola'), new AbortController().signal)) void ev;
    };
    await expect(drain('a')).rejects.toBeInstanceOf(AgentError);
    await drain('a'); // el segundo intento ya no falla
    await Promise.all([drain('a'), drain('b')]);
    expect(mock.maxActive).toBe(2);
    expect(mock.callsOf('a')).toHaveLength(3);
    expect(mock.calls).toHaveLength(4);
    const out: string[] = [];
    for await (const ev of new MockAgent().run(req('z', 'hola'), new AbortController().signal)) {
      if (ev.type === 'result') out.push(ev.text);
    }
    expect(out).toEqual(['[z] hola']);
  });

  it('[R9.5] MockDecider tiene valores por defecto y registra las llamadas', async () => {
    const d = new MockDecider();
    const signal = new AbortController().signal;
    const input = { text: 'x', files: [] };
    const route = await d.route({ nodeId: 'r', input, candidates: [{ edgeId: 'e1', to: 'a', label: 'a' }, { edgeId: 'e2', to: 'b', label: 'b' }] }, signal);
    expect(route.edgeIds).toEqual(['e1', 'e2']);
    expect((await d.judge({ prompt: 'p', output: input, iteration: 1 }, signal)).done).toBe(true);
    expect(await d.condition({ condition: 'c', input }, signal)).toBe(true);
    expect([d.routeCalls.length, d.judgeCalls.length, d.conditionCalls.length]).toEqual([1, 1, 1]);
    expect(setup().decider).toBeInstanceOf(MockDecider);
  });
});
