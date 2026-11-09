import { describe, expect, it } from 'vitest';
import { AgentError, defaultSettings, newAgent, type AgentDefinition, type AgentRequest, type AgentStreamEvent } from '@orquestador/core';
import { ClaudeAdapter, withPause, type ClaudeEnvironment, type ClaudeQueryOptions, type QueryFn, type SdkMessage } from '../src';

const agent: AgentDefinition = { ...newAgent('dev', 'Dev'), instructions: 'x' };
const env: ClaudeEnvironment = { projectRoot: '/proy', settings: () => defaultSettings(), apiKey: async () => undefined, loadAgent: async () => agent, loadContexts: async () => [], loadSkills: async () => [] };

async function run(messages: SdkMessage[], extra: Partial<AgentRequest> = {}) {
  const seen: { options?: ClaudeQueryOptions } = {};
  const query: QueryFn = async function* ({ options }) {
    seen.options = options;
    for (const m of messages) yield m;
  };
  const events: AgentStreamEvent[] = [];
  let error: unknown;
  try {
    for await (const e of new ClaudeAdapter(env, query).run({ nodeId: 'n', agentId: 'dev', input: { text: 'x', files: [] }, attempt: 1, ask: async () => '', previousAnswers: [], ...extra }, new AbortController().signal)) events.push(e);
  } catch (e) {
    error = e;
  }
  return { options: seen.options!, events, error };
}

describe('SPEC-077 · en el motor de Claude', () => {
  it('[R77.9] el tope del intento va al SDK como maxBudgetUsd; sin tope, no', async () => {
    const ok: SdkMessage = { type: 'result', subtype: 'success', is_error: false, result: 'hecho', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 };
    expect((await run([ok], { maxCostUsd: 1.5 })).options.maxBudgetUsd).toBe(1.5);
    expect((await run([ok])).options.maxBudgetUsd).toBeUndefined();
  });

  it('[R77.9] al pasarse falla sin reintentar, lo dice con su tope y lo gastado cuenta', async () => {
    const over: SdkMessage = { type: 'result', subtype: 'error_max_budget_usd', is_error: true, usage: { input_tokens: 900, output_tokens: 100 }, total_cost_usd: 1.02 };
    const { events, error } = await run([over], { maxCostUsd: 1 });
    expect(error).toBeInstanceOf(AgentError);
    expect((error as AgentError).message).toBe('El paso llegó a su presupuesto de 1 $');
    expect((error as AgentError).retriable).toBe(false);
    expect((error as AgentError).kind).toBe('fatal');
    expect(events).toContainEqual({ type: 'usage', inputTokens: 900, outputTokens: 100, costUsd: 1.02 });
  });

  it('[R77.12] en pausa, la política de permisos espera antes de decidir; el adaptador la usa para cada herramienta', async () => {
    let paused = true;
    let resume!: () => void;
    const waiting = new Promise<void>((r) => (resume = r));
    const asked: string[] = [];
    const policy = withPause(
      async (tool) => {
        asked.push(tool);
        if (paused) await waiting;
      },
      async (_tool: string, _input: Record<string, unknown>) => ({ behavior: 'allow' as const, updatedInput: {} }),
    );
    const decided = policy('Bash', { command: 'ls' });
    let done = false;
    void decided.then(() => (done = true));
    await new Promise((r) => setTimeout(r, 5));
    expect(asked).toEqual(['Bash']);
    expect(done).toBe(false);
    paused = false;
    resume();
    expect((await decided).behavior).toBe('allow');
    // Sin pausa posible, la política es la misma.
    const plain = async () => ({ behavior: 'allow' as const, updatedInput: {} });
    expect(withPause(undefined, plain)).toBe(plain);
    // Y el adaptador la llama con el nombre de la herramienta antes de decidir.
    const held: string[] = [];
    const ok: SdkMessage = { type: 'result', subtype: 'success', is_error: false, result: 'hecho', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 };
    const { options } = await run([ok], { whilePaused: async (tool) => void held.push(tool) });
    await options.canUseTool!('Read', { file_path: 'a.md' }, { signal: new AbortController().signal } as never);
    expect(held).toEqual(['Read']);
  });
});
