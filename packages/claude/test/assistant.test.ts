import { describe, expect, it } from 'vitest';
import { defaultSettings } from '@orquestador/core';
import { buildAssistantPrompt, runAssistantTurn, type AppToolDef, type AssistantTurnEvent, type ClaudeQueryOptions, type QueryFn, type SdkMessage, promptText } from '../src';

const tools: Omit<AppToolDef, 'handler'>[] = [
  { name: 'list_agents', description: 'Lista', params: {} },
  { name: 'create_agent', description: 'Crea', params: { name: { type: 'string', description: 'Nombre' } } },
];

describe('SPEC-029 · turno del asistente', () => {
  it('[R29.4] el mensaje lleva la conversación reciente y la petición nueva al final', () => {
    expect(buildAssistantPrompt([{ role: 'user', text: 'hola' }])).toBe('hola');
    const p = buildAssistantPrompt([
      { role: 'user', text: 'crea un agente' },
      { role: 'assistant', text: 'hecho' },
      { role: 'user', text: 'añádelo al diagrama' },
    ]);
    expect(p).toContain('Usuario: crea un agente\n\nAsistente: hecho');
    expect(p.endsWith('Petición nueva del usuario:\nañádelo al diagrama')).toBe(true);
  });

  it('[R29.4][R50.7] usa las herramientas de la app y las de Claude Code, reenvía cada llamada a la interfaz y emite el texto', async () => {
    let server: { name: string; tools: AppToolDef[] } | undefined;
    let seen: ClaudeQueryOptions | undefined;
    const query: QueryFn = async function* ({ options }) {
      seen = options;
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Creo el agente. ' }] } } as SdkMessage;
      const out = await server!.tools.find((t) => t.name === 'create_agent')!.handler({ name: 'Revisor' });
      yield { type: 'assistant', message: { content: [{ type: 'text', text: `Listo ${out.content[0]!.text}` }] } } as SdkMessage;
      yield { type: 'result', subtype: 'success', is_error: false, result: 'Listo', usage: { input_tokens: 5, output_tokens: 3 }, total_cost_usd: 0.001 } as SdkMessage;
    };
    const events: AssistantTurnEvent[] = [];
    const calls: [string, Record<string, unknown>][] = [];
    await runAssistantTurn({
      query,
      createServer: async (name, defs) => ((server = { name, tools: defs }), { fake: true }),
      tools,
      messages: [{ role: 'user', text: 'crea un revisor' }],
      settings: defaultSettings(),
      apiKey: undefined,
      cwd: '/proy',
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
      callTool: async (_id, name, input) => (calls.push([name, input]), { ok: true, result: { id: 'revisor' } }),
      newId: () => 'c1',
    });
    expect(server!.name).toBe('orquestador');
    expect(seen!.tools).toEqual({ type: 'preset', preset: 'claude_code' });
    expect(seen!.allowedTools).toEqual(['mcp__orquestador__list_agents', 'mcp__orquestador__create_agent']);
    expect(await seen!.canUseTool!('Bash', { command: 'npm test' })).toMatchObject({ behavior: 'allow' });
    expect(promptText(seen!.systemPrompt)).toMatch(/asistente de Orquestador/);
    expect(calls).toEqual([['create_agent', { name: 'Revisor' }]]);
    expect(events.map((e) => e.type)).toEqual(['text', 'tool', 'text', 'done']);
    expect(events[1]).toEqual({ type: 'tool', callId: 'c1', name: 'create_agent', args: { name: 'Revisor' } });
    expect(events[3]).toMatchObject({ type: 'done', text: 'Listo', usage: { inputTokens: 5, outputTokens: 3 } });
  });

  it('[R29.4] un error del SDK llega como mensaje y detener lo corta', async () => {
    const failing: QueryFn = () => ({ [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error('sin red')) }) });
    const events: AssistantTurnEvent[] = [];
    const base = { createServer: async () => ({}), tools, messages: [{ role: 'user' as const, text: 'x' }], settings: defaultSettings(), apiKey: undefined, cwd: '/p', callTool: async () => ({ ok: true, result: null }), newId: () => 'c' };
    await runAssistantTurn({ ...base, query: failing, signal: new AbortController().signal, emit: (e) => events.push(e) });
    expect(events[0]).toMatchObject({ type: 'error' });
    const ctrl = new AbortController();
    ctrl.abort();
    const ev2: AssistantTurnEvent[] = [];
    await runAssistantTurn({ ...base, query: failing, signal: ctrl.signal, emit: (e) => ev2.push(e) });
    expect(ev2).toEqual([{ type: 'error', message: 'Detenido.' }]);
  });
});
