import { describe, expect, it } from 'vitest';
import { defaultSettings, newAgent, type AgentDefinition, type AgentStreamEvent } from '@orquestador/core';
import { promptText, ClaudeAdapter, ClaudeDecider, DELIVERABLE_RULE, buildSystemPrompt, deliverableSection, type ClaudeEnvironment, type ClaudeQueryOptions, type QueryFn, type SdkMessage } from '../src';

const result = (text: string): SdkMessage => ({ type: 'result', subtype: 'success', is_error: false, result: text, usage: { input_tokens: 700, output_tokens: 50 }, total_cost_usd: 0.01 });
const agent: AgentDefinition = { ...newAgent('qa', 'QA'), instructions: 'Revisa' };
const env: ClaudeEnvironment = {
  projectRoot: '/proy',
  settings: () => defaultSettings(),
  apiKey: async () => undefined,
  loadAgent: async (id) => (id === agent.id ? agent : undefined),
  loadContexts: async () => [],
  loadSkills: async () => [],
};

async function systemOf(deliverable?: { role: 'final' | 'goal'; text: string }): Promise<string> {
  const seen: { options?: ClaudeQueryOptions } = {};
  const query: QueryFn = async function* ({ options }) {
    seen.options = options;
    yield result('Hecho');
  };
  const out: AgentStreamEvent[] = [];
  const req = { nodeId: 'qa', agentId: 'qa', input: { text: 'x', files: [] }, attempt: 1, ask: async () => '', previousAnswers: [], ...(deliverable ? { deliverable } : {}) };
  for await (const e of new ClaudeAdapter(env, query).run(req, new AbortController().signal)) out.push(e);
  return promptText(seen.options!.systemPrompt);
}

describe('SPEC-046 · entregable con el motor de Claude', () => {
  it('[R46.5] los pasos finales reciben el contrato y la regla; con «goal», solo la línea', async () => {
    const final = { role: 'final' as const, text: 'Al terminar esta ejecución se entregará al usuario:\n- un resumen' };
    expect(deliverableSection(final)).toBe(`## Entregable de esta ejecución\n${final.text}\n\n${DELIVERABLE_RULE}`);
    expect(DELIVERABLE_RULE).toContain('No escribas tú ese entregable');
    expect(DELIVERABLE_RULE).toContain('nombra cada archivo');
    const sys = await systemOf(final);
    expect(sys).toContain('## Entregable de esta ejecución');
    expect(sys).toContain(DELIVERABLE_RULE);
    const goal = await systemOf({ role: 'goal', text: 'Objetivo final de la ejecución: se entregará un resumen.' });
    expect(goal).toContain('Objetivo final de la ejecución: se entregará un resumen.');
    expect(goal).not.toContain(DELIVERABLE_RULE);
    expect(await systemOf()).not.toContain('Entregable');
    expect(buildSystemPrompt(agent, [], [])).not.toContain(DELIVERABLE_RULE);
  });

  it('[R46.6][R46.9] la composición es un turno sin herramientas que devuelve sus tokens; «Transformar» no los cuenta', async () => {
    const seen: { options?: ClaudeQueryOptions; prompt?: string } = {};
    const query: QueryFn = async function* ({ prompt, options }) {
      seen.options = options;
      seen.prompt = typeof prompt === 'string' ? prompt : '';
      yield result('```markdown\nSe hizo la web.\n```');
    };
    const d = new ClaudeDecider({ query, projectRoot: '/proy', settings: () => defaultSettings(), apiKey: async () => undefined });
    const sig = new AbortController().signal;
    const r = await d.transform({ nodeId: 'output', format: 'markdown', instructions: 'Escribe un resumen', input: { text: 'x'.repeat(25_000), files: [] }, attempt: 1, deliverable: { kind: 'summary', steps: 3, files: 2 } }, sig);
    expect(r).toEqual({ text: 'Se hizo la web.', usage: { inputTokens: 700, outputTokens: 50, costUsd: 0.01 } });
    expect(seen.options).toMatchObject({ tools: [], maxTurns: 1 });
    expect(seen.options!.systemPrompt).toContain('entregable final');
    expect(seen.prompt).toContain('Escribe el resultado en Markdown.');
    // Admite el contexto entero del entregable (hasta 30 000 caracteres).
    expect(seen.prompt).toContain('x'.repeat(25_000));
    const plain = await d.transform({ nodeId: 't', format: 'markdown', instructions: 'x', input: { text: 'y', files: [] }, attempt: 1 }, sig);
    expect(plain.usage).toBeUndefined();
  });
});
