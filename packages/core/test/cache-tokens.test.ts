import { describe, expect, it } from 'vitest';
import { chain, ofType, setup } from './helpers';

describe('SPEC-083 · los tokens de caché cuentan', () => {
  it('[R83.2] agent.usage copia lo leído de la caché', async () => {
    const { orch } = setup({ scripts: { a: { usage: { inputTokens: 1200, outputTokens: 30, cachedTokens: 1000, costUsd: 0.01 } } } });
    const res = await orch.start(chain(['a']), 'x').result;
    expect(ofType(res.events, 'agent.usage')[0]).toMatchObject({ nodeId: 'a', inputTokens: 1200, outputTokens: 30, cachedTokens: 1000 });
  });

  it('[R83.3] lo leído de la caché cuenta para el límite de tokens: la ejecución se para', async () => {
    const { orch } = setup({ scripts: { a: { usage: { inputTokens: 1000, outputTokens: 10, cachedTokens: 1000 } } } });
    const res = await orch.start(chain(['a', 'b']), 'x', { budget: { maxTokens: 500 } }).result;
    expect(res.reason).toBe('budget_exceeded');
    expect(ofType(res.events, 'node.started').some((e) => e.nodeId === 'b')).toBe(false);
  });
});
