import { describe, expect, it } from 'vitest';
import { defaultSettings } from '@orquestador/core';
import { ClaudeDecider, type QueryFn, type SdkMessage } from '../src';

const sig = new AbortController().signal;
const result = (text: string): SdkMessage => ({ type: 'result', subtype: 'success', is_error: false, result: text, usage: { input_tokens: 30, output_tokens: 4 }, total_cost_usd: 0.0001 });

function decider(reply: string) {
  const seen: { prompt: string; system: string }[] = [];
  const query: QueryFn = async function* ({ prompt, options }) {
    seen.push({ prompt: String(prompt), system: JSON.stringify(options.systemPrompt) });
    yield result(reply);
  };
  return { seen, d: new ClaudeDecider({ query, projectRoot: '/p', settings: () => defaultSettings(), apiKey: async () => undefined }) };
}

describe('SPEC-065 · la comprobación final con Claude', () => {
  it('[R65.1] lo que solo puede hacer una persona va en forPerson y no cuenta como falta', async () => {
    const { d, seen } = decider('{"met":true,"missing":"","forPerson":"Medir de verdad los 30 minutos"}');
    const v = await d.verifyRun({ order: { text: 'Mide el quickstart', files: [] }, steps: [] }, sig);
    expect(v).toMatchObject({ met: true, missing: '', forPerson: 'Medir de verdad los 30 minutos' });
    expect(seen[0]!.system).toContain('solo puede hacer o comprobar una persona');
    expect(seen[0]!.system).toContain('ponlo en forPerson, no en missing');
    expect(seen[0]!.prompt).toContain('"forPerson"');
  });

  it('[R65.1] sin forPerson (o vacío) no se añade', async () => {
    const v = await decider('{"met":true,"missing":"","forPerson":"  "}').d.verifyRun({ order: { text: 'x', files: [] }, steps: [] }, sig);
    expect(v).not.toHaveProperty('forPerson');
  });
});
