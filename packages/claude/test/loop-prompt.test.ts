import { describe, expect, it } from 'vitest';
import { LOOP_HEADING, defaultSettings, newAgent, type AgentDefinition } from '@orquestador/core';
import { ClaudeAdapter, promptText, type ClaudeEnvironment, type ClaudeQueryOptions, type QueryFn, type SdkMessage } from '../src';

const ok: SdkMessage = { type: 'result', subtype: 'success', is_error: false, result: 'Hecho', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 };
const agent: AgentDefinition = { ...newAgent('poeta', 'Poeta'), instructions: 'Escribe haikus' };
const env: ClaudeEnvironment = {
  projectRoot: '/proy',
  settings: () => defaultSettings(),
  apiKey: async () => undefined,
  loadAgent: async (id) => (id === agent.id ? agent : undefined),
  loadContexts: async () => [],
  loadSkills: async () => [],
};

async function promptsOf(loop: string | undefined): Promise<{ system: string; user: string }> {
  const seen: { options?: ClaudeQueryOptions; prompt?: unknown } = {};
  const query: QueryFn = async function* ({ prompt, options }) {
    seen.options = options;
    seen.prompt = prompt;
    yield ok;
  };
  const req = { nodeId: 'n', agentId: 'poeta', input: { text: 'haiku anterior', files: [] }, attempt: 1, ask: async () => '', previousAnswers: [], memory: 'Resumen de los pasos:\n- a: x', task: 'Mejora el haiku', ...(loop ? { loop } : {}) };
  for await (const _ of new ClaudeAdapter(env, query).run(req, new AbortController().signal)) void _;
  return { system: promptText(seen.options!.systemPrompt), user: promptText(seen.prompt as Parameters<typeof promptText>[0]) };
}

describe('SPEC-084 · el bucle en el motor de Claude', () => {
  it('[R84.5] el bloque del bucle va en el mensaje del usuario, después de la memoria y antes de la tarea', async () => {
    const block = `${LOOP_HEADING}\n\nBucle «B»: vuelta 2 de 3 como máximo.`;
    const { system, user } = await promptsOf(block);
    expect(user).toContain(block);
    expect(user.indexOf('</memoria>')).toBeLessThan(user.indexOf(LOOP_HEADING));
    expect(user.indexOf(LOOP_HEADING)).toBeLessThan(user.indexOf('Mejora el haiku'));
    expect(system).not.toContain(LOOP_HEADING);
    expect((await promptsOf(undefined)).user).not.toContain(LOOP_HEADING);
  });
});
