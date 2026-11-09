import { describe, expect, it } from 'vitest';
import { defaultSettings } from '@orquestador/core';
import { ClaudeDecider, MessageMapper, type QueryFn, type SdkMessage } from '../src';

const cached: SdkMessage = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'Hecho',
  usage: { input_tokens: 26, cache_creation_input_tokens: 4000, cache_read_input_tokens: 90000, output_tokens: 900 },
  total_cost_usd: 0.3,
};

describe('SPEC-083 · los tokens de caché cuentan', () => {
  it('[R83.1][R83.2] E83.a: la entrada suma lo nuevo, lo escrito y lo leído de la caché; lo leído va aparte', () => {
    const usage = new MessageMapper().map(cached).find((e) => e.type === 'usage');
    expect(usage).toEqual({ type: 'usage', inputTokens: 94026, outputTokens: 900, cachedTokens: 90000, costUsd: 0.3 });
  });

  it('[R83.1] un resultado con error también cuenta la caché; sin caché no hay cachedTokens', () => {
    const failed: SdkMessage = { ...cached, subtype: 'error_max_turns', is_error: true };
    expect(new MessageMapper().usageOf(failed)).toEqual([{ type: 'usage', inputTokens: 94026, outputTokens: 900, cachedTokens: 90000, costUsd: 0.3 }]);
    const plain: SdkMessage = { ...cached, usage: { input_tokens: 10, output_tokens: 5 } };
    expect(new MessageMapper().usageOf(plain)).toEqual([{ type: 'usage', inputTokens: 10, outputTokens: 5, costUsd: 0.3 }]);
  });

  it('[R83.1] las decisiones (enrutador, evaluador) también cuentan la caché', async () => {
    const query: QueryFn = async function* () {
      yield { ...cached, result: '{"done":true,"reason":"ok"}' };
    };
    const d = new ClaudeDecider({ query, projectRoot: '/proy', settings: () => defaultSettings(), apiKey: async () => undefined });
    const j = await d.judge({ prompt: 'p', output: { text: 'x', files: [] }, iteration: 1 }, new AbortController().signal);
    expect(j.usage).toMatchObject({ inputTokens: 94026, outputTokens: 900 });
  });
});
