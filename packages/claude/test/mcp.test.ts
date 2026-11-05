import { describe, expect, it } from 'vitest';
import { defaultSettings, newAgent, newMcpServer, type AgentStreamEvent } from '@orquestador/core';
import { ClaudeAdapter, createMcpPolicy, sdkMcpConfig, testMcpServer, type ClaudeQueryOptions, type QueryFn, type ResolvedMcp, type SdkMessage } from '../src';

const pixel: ResolvedMcp = { def: { ...newMcpServer('pixel', 'Pixel'), command: 'npx', args: ['pixelart-mcp'], secretNames: ['API_KEY'] }, secrets: { API_KEY: 's3cr3t' } };
const web: ResolvedMcp = { def: { ...newMcpServer('docs', 'Docs'), transport: 'http', url: 'https://docs.example.com/mcp', secretNames: ['Authorization'], trusted: true }, secrets: { Authorization: 'Bearer x' } };
const off: ResolvedMcp = { def: { ...newMcpServer('off', 'Apagado'), command: 'x', enabled: false }, secrets: {} };

describe('SPEC-030 · MCP en el adaptador de Claude', () => {
  it('[R30.4] la configuración del SDK lleva los secretos como entorno o cabeceras y omite los apagados', () => {
    expect(sdkMcpConfig([pixel, web, off])).toEqual({
      pixel: { type: 'stdio', command: 'npx', args: ['pixelart-mcp'], env: { API_KEY: 's3cr3t' } },
      docs: { type: 'http', url: 'https://docs.example.com/mcp', headers: { Authorization: 'Bearer x' } },
    });
  });

  it('[R30.4] cada herramienta pregunta salvo en servidores de confianza; «en esta ejecución» vale para el servidor', async () => {
    const asked: string[] = [];
    let answer = 'Permitir en esta ejecución';
    const policy = createMcpPolicy([pixel, web], async (q) => (asked.push(q.text), answer));
    expect(await policy('Read', {})).toBeUndefined();
    expect(await policy('mcp__docs__buscar', { q: 'x' })).toEqual({ behavior: 'allow', updatedInput: { q: 'x' } });
    expect(await policy('mcp__pixel__dibujar', {})).toMatchObject({ behavior: 'allow' });
    expect(await policy('mcp__pixel__borrar', {})).toMatchObject({ behavior: 'allow' });
    expect(asked).toEqual(['¿Puede usar «dibujar» del servidor MCP «Pixel»?']);
    expect(await policy('mcp__ajeno__x', {})).toMatchObject({ behavior: 'deny' });
    answer = 'Denegar';
    const strict = createMcpPolicy([pixel], async () => answer);
    expect(await strict('mcp__pixel__dibujar', {})).toMatchObject({ behavior: 'deny' });
  });

  it('[R30.4] el agente recibe sus servidores (y los añadidos al paso) y la política MCP decide sus herramientas', async () => {
    const seen: { options?: ClaudeQueryOptions } = {};
    const query: QueryFn = async function* ({ options }) {
      seen.options = options;
      const r = await options.canUseTool!('mcp__pixel__dibujar', {});
      yield { type: 'result', subtype: 'success', is_error: false, result: r.behavior, usage: { input_tokens: 1, output_tokens: 1 } } as SdkMessage;
    };
    const asked: string[] = [];
    const loaded: string[][] = [];
    const adapter = new ClaudeAdapter(
      {
        projectRoot: '/proy',
        settings: () => ({ ...defaultSettings(), permissions: 'auto' }),
        apiKey: async () => undefined,
        loadAgent: async () => ({ ...newAgent('pintor', 'Pintor'), mcpIds: ['pixel'] }),
        loadContexts: async () => [],
        loadSkills: async () => [],
        loadMcp: async (ids) => (loaded.push(ids), ids.includes('docs') ? [pixel, web] : [pixel]),
      },
      query,
    );
    const out: AgentStreamEvent[] = [];
    for await (const e of adapter.run({ nodeId: 'n', agentId: 'pintor', input: { text: 'x', files: [] }, extra: { mcpIds: ['docs'] }, attempt: 1, ask: async (q) => (asked.push(q.text), 'Permitir'), previousAnswers: [] }, new AbortController().signal)) out.push(e);
    expect(loaded).toEqual([['pixel', 'docs']]);
    expect(Object.keys(seen.options!.mcpServers!)).toEqual(['pixel', 'docs']);
    expect(asked).toEqual(['¿Puede usar «dibujar» del servidor MCP «Pixel»?']);
    expect(out.find((e) => e.type === 'result')).toMatchObject({ text: 'allow' });
  });

  it('[R30.5] probar conexión lee el mensaje de inicio y corta antes del modelo', async () => {
    let afterInit = false;
    const query: QueryFn = async function* () {
      yield { type: 'system', subtype: 'init', tools: ['Read', 'mcp__pixel__dibujar', 'mcp__pixel__paleta'], mcp_servers: [{ name: 'pixel', status: 'connected' }] } as SdkMessage;
      afterInit = true;
      yield { type: 'result', subtype: 'success', result: 'no debería llegar' } as SdkMessage;
    };
    const r = await testMcpServer({ query, server: pixel, settings: defaultSettings(), apiKey: undefined, cwd: '/proy' });
    expect(r).toMatchObject({ ok: true, tools: ['dibujar', 'paleta'] });
    expect(afterInit).toBe(false);
    const failed: QueryFn = async function* () {
      yield { type: 'system', subtype: 'init', tools: [], mcp_servers: [{ name: 'pixel', status: 'failed' }] } as SdkMessage;
    };
    expect(await testMcpServer({ query: failed, server: pixel, settings: defaultSettings(), apiKey: undefined, cwd: '/proy' })).toMatchObject({ ok: false, message: expect.stringContaining('failed') });
  });
});
