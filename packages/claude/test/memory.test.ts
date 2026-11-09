import { describe, expect, it } from 'vitest';
import { NOTE_HEADING, NOTE_RULE, defaultSettings, newAgent, type AgentDefinition } from '@orquestador/core';
import { ClaudeAdapter, ClaudeDecider, promptText, type ClaudeEnvironment, type ClaudeQueryOptions, type QueryFn, type SdkMessage } from '../src';

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

/** Lanza un paso y devuelve su prompt de sistema y su mensaje de usuario. */
async function promptsOf(memory: string | undefined, task?: string): Promise<{ system: string; user: string }> {
  const seen: { options?: ClaudeQueryOptions; prompt?: unknown } = {};
  const query: QueryFn = async function* ({ prompt, options }) {
    seen.options = options;
    seen.prompt = prompt;
    yield ok;
  };
  const req = { nodeId: 'n', agentId: 'pintor', input: { text: 'Pinta el cielo', files: [] }, attempt: 1, ask: async () => '', previousAnswers: [], ...(memory ? { memory } : {}), ...(task ? { task } : {}) };
  for await (const _ of new ClaudeAdapter(env, query).run(req, new AbortController().signal)) void _;
  return { system: promptText(seen.options!.systemPrompt), user: promptText(seen.prompt as Parameters<typeof promptText>[0]) };
}

describe('SPEC-072 · la memoria en el motor de Claude', () => {
  it('[R72.13] todo agente recibe en su prompt de sistema la regla de la nota, con o sin memoria', async () => {
    expect(NOTE_RULE).toContain(NOTE_HEADING);
    expect(NOTE_RULE).toContain('5 líneas');
    expect(NOTE_RULE).toContain('No es para repetir la entrega');
    expect((await promptsOf(undefined)).system).toContain(NOTE_RULE);
    expect((await promptsOf('Resumen de los pasos:\n- a: x')).system).toContain(NOTE_RULE);
  });

  it('[R72.18] la memoria va en el mensaje del usuario, antes de la tarea, y el prompt de sistema no cambia', async () => {
    const one = await promptsOf('Resumen de los pasos:\n- a: uno', 'Solo el cielo');
    const two = await promptsOf('Decisiones de la persona:\n- b preguntó «¿x?» → «y»\n\nResumen de los pasos:\n- b: dos', 'Solo el cielo');
    expect(one.system).toBe(two.system);
    expect(one.system).not.toContain('<memoria>');
    expect(one.user).toContain('<memoria>\nResumen de los pasos:\n- a: uno\n</memoria>');
    expect(one.user.indexOf('</memoria>')).toBeLessThan(one.user.indexOf('Solo el cielo'));
  });

  it('[R72.10] la revisión pide y lee lo que el paso decidió: hasta 3, de 160 caracteres', async () => {
    const seen: string[] = [];
    const reply = JSON.stringify({ ok: true, summary: 'Hecho', decided: ['eligió PostgreSQL', 'x'.repeat(300), '  ', 'tercera', 'cuarta', 5] });
    const query: QueryFn = async function* ({ prompt }) {
      seen.push(String(prompt));
      yield { ...ok, result: reply };
    };
    const d = new ClaudeDecider({ query, projectRoot: '/p', settings: () => defaultSettings(), apiKey: async () => undefined });
    const v = await d.supervise({ step: 'Pintor', input: { text: 'x', files: [] }, actions: [], output: { text: 'Hecho', files: [] } }, new AbortController().signal);
    expect(v.decided).toEqual(['eligió PostgreSQL', 'x'.repeat(160), 'tercera']);
    expect(seen[0]).toContain('"decided"');
    expect(seen[0]).toContain('ninguna deducida');
  });
});
