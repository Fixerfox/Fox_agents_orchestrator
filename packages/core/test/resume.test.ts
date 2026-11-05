import { describe, expect, it } from 'vitest';
import { canResume, resumePlan, type AgentAdapter, type AgentRequest } from '../src';
import { chain, ofType, setup } from './helpers';

/** Adaptador que cuenta llamadas y hace fallar a «b» la primera ejecución. */
function counting(failB: () => boolean) {
  const calls: string[] = [];
  const adapter: AgentAdapter = {
    async *run(req: AgentRequest) {
      calls.push(req.agentId);
      if (req.agentId === 'b' && failB()) throw Object.assign(new Error('se cayó'), { retriable: false });
      yield { type: 'usage', inputTokens: 1, outputTokens: 1, costUsd: 0 } as never;
      yield { type: 'result', text: `salida de ${req.agentId} con «${req.input.text}»` };
    },
  };
  return { calls, adapter };
}

describe('SPEC-041 · reanudar una ejecución', () => {
  it('[R41.1] el plan guarda la última salida correcta de los pasos del nivel principal', async () => {
    let fail = true;
    const { calls, adapter } = counting(() => fail);
    const d = chain(['a', 'b', 'c']);
    const first = await setup({ adapter }).orch.start(d, 'pide').result;
    expect(first.status).toBe('failed');
    const plan = resumePlan(d, first.events);
    expect(Object.keys(plan)).toEqual(['a']);
    expect(plan['a']!.text).toBe('salida de a con «pide»');
    // reanudar: «a» no se repite y no gasta tokens; «b» y «c» sí se ejecutan
    fail = false;
    calls.length = 0;
    const second = await setup({ adapter }).orch.start(d, 'pide', { reuse: { fromRunId: 'run-0', outputs: plan } }).result;
    expect(second.status).toBe('succeeded');
    expect(calls).toEqual(['b', 'c']);
    expect(ofType(second.events, 'run.started')[0]!.resumedFrom).toBe('run-0');
    expect(ofType(second.events, 'node.reused')).toEqual([expect.objectContaining({ nodeId: 'a', fromRunId: 'run-0' })]);
    const aDone = ofType(second.events, 'node.finished').find((e) => e.nodeId === 'a')!;
    expect(aDone).toMatchObject({ status: 'succeeded', output: { text: 'salida de a con «pide»' } });
    // «b» recibe la salida reutilizada
    expect(second.output?.text).toContain('salida de c');
    expect(second.usage.inputTokens).toBe(2);
  });

  it('[R41.2] se reanuda lo interrumpido, fallido o cancelado, y una sola vez', () => {
    for (const s of ['interrupted', 'failed', 'cancelled']) expect(canResume(s)).toBe(true);
    for (const s of ['running', 'succeeded']) expect(canResume(s)).toBe(false);
    expect(canResume('failed', 'run-2')).toBe(false);
  });
});
