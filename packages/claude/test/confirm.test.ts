import { describe, expect, it } from 'vitest';
import { defaultSettings, newAgent, type AgentDefinition, type AgentStreamEvent } from '@orquestador/core';
import { promptText, CONFIRM_RULE, ClaudeAdapter, buildSystemPrompt, type ClaudeEnvironment, type ClaudeQueryOptions, type QueryFn, type SdkMessage } from '../src';

const ok: SdkMessage = { type: 'result', subtype: 'success', is_error: false, result: 'Hecho', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 };
const agent: AgentDefinition = { ...newAgent('pintor', 'Pintor'), instructions: 'Dibuja' };
const env: ClaudeEnvironment = {
  projectRoot: '/proy',
  settings: () => defaultSettings(),
  apiKey: async () => undefined,
  loadAgent: async (id) => (id === agent.id ? agent : undefined),
  loadContexts: async () => [],
  loadSkills: async () => [],
};

async function systemOf(confirm: boolean): Promise<string> {
  const seen: { options?: ClaudeQueryOptions } = {};
  const query: QueryFn = async function* ({ options }) {
    seen.options = options;
    yield ok;
  };
  const out: AgentStreamEvent[] = [];
  const req = { nodeId: 'n', agentId: 'pintor', input: { text: 'x', files: [] }, attempt: 1, ask: async () => '', previousAnswers: [], ...(confirm ? { confirm: true } : {}) };
  for await (const e of new ClaudeAdapter(env, query).run(req, new AbortController().signal)) out.push(e);
  return promptText(seen.options!.systemPrompt);
}

describe('SPEC-043 · motor de Claude', () => {
  it('[R43.4] con confirmación, el prompt exige terminar con «## Resumen para confirmar»', async () => {
    expect(CONFIRM_RULE).toContain('## Resumen para confirmar');
    expect(buildSystemPrompt(agent, [], [], undefined, undefined, { confirm: true })).toContain(CONFIRM_RULE);
    expect(buildSystemPrompt(agent, [], [])).not.toContain(CONFIRM_RULE);
    expect(await systemOf(true)).toContain(CONFIRM_RULE);
    expect(await systemOf(false)).not.toContain(CONFIRM_RULE);
  });
});
