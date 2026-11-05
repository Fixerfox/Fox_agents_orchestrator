import { describe, expect, it } from 'vitest';
import { defaultSettings, effectivePermission, newAgent, newMcpServer, type AgentStreamEvent, type AppSettings } from '@orquestador/core';
import { ClaudeAdapter, createMcpPolicy, nativePath, sensitiveCommand, type QueryFn, type ResolvedMcp, type SdkMessage } from '../src';

const pixel: ResolvedMcp = { def: { ...newMcpServer('pixel', 'Pixel'), command: 'npx' }, secrets: {} };

async function runWith(settings: Partial<AppSettings>, agentLevel?: 'ask') {
  const asked: string[] = [];
  const decisions: string[] = [];
  const query: QueryFn = async function* ({ options }) {
    decisions.push((await options.canUseTool!('mcp__pixel__dibujar', {})).behavior);
    decisions.push((await options.canUseTool!('mcp__ajeno__x', {})).behavior);
    yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: { input_tokens: 1, output_tokens: 1 } } as SdkMessage;
  };
  const adapter = new ClaudeAdapter(
    {
      projectRoot: '/proy',
      settings: () => ({ ...defaultSettings(), ...settings }),
      apiKey: async () => undefined,
      loadAgent: async () => ({ ...newAgent('pintor', 'Pintor'), mcpIds: ['pixel'], ...(agentLevel ? { permissions: agentLevel } : {}) }),
      loadContexts: async () => [],
      loadSkills: async () => [],
      loadMcp: async () => [pixel],
    },
    query,
  );
  const out: AgentStreamEvent[] = [];
  for await (const e of adapter.run({ nodeId: 'n', agentId: 'pintor', input: { text: 'x', files: [] }, attempt: 1, ask: async (q) => (asked.push(q.text), 'Permitir'), previousAnswers: [] }, new AbortController().signal)) out.push(e);
  return { asked, decisions };
}

describe('SPEC-051 · sin preguntas por defecto', () => {
  it('[R51.2] con «Sin preguntar nunca» los MCP del agente no preguntan; uno ajeno se sigue denegando', async () => {
    expect(effectivePermission({}, defaultSettings())).toBe('full');
    const free = await runWith({});
    expect(free.asked).toEqual([]);
    expect(free.decisions).toEqual(['allow', 'deny']);
    const auto = await runWith({ permissions: 'auto' });
    expect(auto.asked).toEqual(['¿Puede usar «dibujar» del servidor MCP «Pixel»?']);
    // el nivel propio del agente manda sobre el del proyecto [R51.4]
    const own = await runWith({}, 'ask');
    expect(own.asked).toHaveLength(1);
    const p = createMcpPolicy([pixel], async () => 'Denegar', { noAsk: true });
    expect(await p('mcp__pixel__dibujar', {})).toMatchObject({ behavior: 'allow' });
  });

  it('[R51.4] lo que sigue preguntando es lo que configura el usuario: el nivel propio de un agente', async () => {
    const own = await runWith({ permissions: 'full' }, 'ask');
    expect(own.asked).toEqual(['¿Puede usar «dibujar» del servidor MCP «Pixel»?']);
  });

  it('[R51.5] en Windows las rutas de Git Bash (/d/…, /cygdrive/d/…) se leen como D:/…', () => {
    expect(nativePath('/d/FixerfoxGames/WebApp', 'win32')).toBe('D:/FixerfoxGames/WebApp');
    expect(nativePath('/d', 'win32')).toBe('D:/');
    expect(nativePath('/cygdrive/c/Users/nico', 'win32')).toBe('C:/Users/nico');
    expect(nativePath('/tmp/w', 'win32')).toBe('/tmp/w');
    expect(nativePath('/dev/null', 'win32')).toBe('/dev/null');
    expect(nativePath('src/x', 'win32')).toBe('src/x');
    expect(nativePath('/d/FixerfoxGames/WebApp', 'linux')).toBe('/d/FixerfoxGames/WebApp');
    expect(nativePath('/d/x', 'darwin')).toBe('/d/x');
  });

  it.runIf(process.platform === 'win32')('[R51.5] en Windows, cd /d/… dentro del proyecto no es salir de la carpeta', () => {
    const root = 'D:\\FixerfoxGames\\WebApp';
    expect(sensitiveCommand('cd /d/FixerfoxGames/WebApp && wc -c _raiz/tools/index.html && ls _raiz/assets; git status --short _raiz | head', root)).toBeNull();
    expect(sensitiveCommand('cd /d/FixerfoxGames/WebApp/specs/002 && ls', root)).toBeNull();
    expect(sensitiveCommand('cd /d/FixerfoxGames/Otra && ls', root)).not.toBeNull();
    expect(sensitiveCommand('ls /tmp/w', root)).not.toBeNull();
  });
});
