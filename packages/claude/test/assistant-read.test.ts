import { describe, expect, it } from 'vitest';
import { defaultSettings } from '@orquestador/core';
import {
  assistantToolPolicy,
  assistantGuardHook,
  isSensitivePath,
  promptText,
  readTargetOf,
  runAssistantTurn,
  type AssistantTurnEvent,
  type ClaudeQueryOptions,
  type QueryFn,
  type SdkMessage,
} from '../src';

const APP = ['mcp__orquestador__list_agents'];

const turn = async (opts: { query: QueryFn; emit?: (e: AssistantTurnEvent) => void; protectedDirs?: string[]; settings?: ReturnType<typeof defaultSettings> }) =>
  runAssistantTurn({
    query: opts.query,
    createServer: async () => ({}),
    tools: [{ name: 'list_agents', description: 'Lista', params: {} }],
    messages: [{ role: 'user', text: 'instala el MCP de C:\\mcp\\pix' }],
    settings: opts.settings ?? defaultSettings(),
    apiKey: undefined,
    cwd: '/proy',
    ...(opts.protectedDirs ? { protectedDirs: opts.protectedDirs } : {}),
    signal: new AbortController().signal,
    emit: opts.emit ?? (() => {}),
    callTool: async () => ({ ok: true, result: null }),
    newId: () => 'c1',
  });

const capture = () => {
  const box: { options?: ClaudeQueryOptions } = {};
  const query: QueryFn = async function* ({ options }) {
    box.options = options;
    yield { type: 'result', subtype: 'success', is_error: false, result: 'ok' } as SdkMessage;
  };
  return { box, query };
};

describe('SPEC-050 · el asistente tiene Claude Code completo', () => {
  it('[R50.7] usa el prompt y todas las herramientas de Claude Code, sin AskUserQuestion, y carga .claude', async () => {
    const { box, query } = capture();
    await turn({ query });
    const o = box.options!;
    expect(o.tools).toEqual({ type: 'preset', preset: 'claude_code' });
    expect(o.disallowedTools).toEqual(['AskUserQuestion']);
    expect(o.maxTurns).toBe(100);
    expect(o.systemPrompt).toMatchObject({ type: 'preset', preset: 'claude_code' });
    expect(promptText(o.systemPrompt)).toMatch(/ninguna pide permiso/);
    expect(promptText(o.systemPrompt)).toMatch(/nunca editando \.orquestador a mano/);
    expect(o.settingSources).toEqual(['user', 'project', 'local']);
    const off = capture();
    await turn({ query: off.query, settings: { ...defaultSettings(), claudeConfig: false } });
    expect(off.box.options!.settingSources).toEqual([]);
  });

  it('[R50.8] escribe, edita, ejecuta y lanza subagentes sin pedir permiso, también fuera del proyecto', async () => {
    const { box, query } = capture();
    await turn({ query });
    const can = box.options!.canUseTool!;
    for (const [tool, input] of [
      ['Bash', { command: 'npm install' }],
      ['Write', { file_path: 'C:\\mcp\\pix\\notas.md', content: 'x' }],
      ['Edit', { file_path: '/proy/package.json', old_string: 'a', new_string: 'b' }],
      ['Agent', { description: 'revisar', prompt: 'x' }],
      ['Read', { file_path: '/proy/.env' }],
      ['Read', { file_path: '/proy/.orquestador/agents/a.json' }],
      ['mcp__orquestador__list_agents', {}],
    ] as const)
      expect(await can(tool, { ...input }), tool).toMatchObject({ behavior: 'allow' });
  });

  it('[R50.8] nunca escribe en .orquestador del proyecto ni toca la carpeta de datos de la app', async () => {
    const { box, query } = capture();
    await turn({ query, protectedDirs: ['/datos/app'] });
    const can = box.options!.canUseTool!;
    expect(await can('Write', { file_path: '.orquestador/diagrams/x.json', content: '{}' })).toMatchObject({ behavior: 'deny', message: expect.stringMatching(/mcp__orquestador__/) });
    expect(await can('Edit', { file_path: '/proy/.orquestador/agents/a.json' })).toMatchObject({ behavior: 'deny' });
    expect(await can('NotebookEdit', { notebook_path: '/proy/.orquestador/n.ipynb' })).toMatchObject({ behavior: 'deny' });
    expect(await can('Read', { file_path: '/datos/app/config/api-key.bin' })).toMatchObject({ behavior: 'deny', message: expect.stringMatching(/request_secret/) });
    expect(await can('Grep', { pattern: 'token', path: '/datos/app' })).toMatchObject({ behavior: 'deny' });
    expect(await can('Write', { file_path: '/datos/app/x' })).toMatchObject({ behavior: 'deny' });
    // en Grep el patrón es una expresión regular, no una ruta
    expect(await can('Grep', { pattern: '/datos/app', path: '/proy/src' })).toMatchObject({ behavior: 'allow' });
    // otra carpeta que se llame igual pero empiece distinto no cuenta
    expect(await can('Write', { file_path: '/proy/.orquestador-copia/x' })).toMatchObject({ behavior: 'allow' });
    // la carpeta de datos se compara sin mayúsculas ni barras
    const policy = assistantToolPolicy({ appTools: APP, protectedDirs: ['C:\\Users\\nico\\AppData\\Roaming\\Orquestador'] });
    expect(policy('Read', { file_path: 'c:/users/nico/appdata/roaming/orquestador/config/api-key.bin' })).toMatchObject({ behavior: 'deny' });
  });

  it('[R50.8] el gancho PreToolUse bloquea antes que cualquier regla de .claude', async () => {
    const { box, query } = capture();
    await turn({ query, protectedDirs: ['/datos/app'] });
    const entry = box.options!.hooks!.PreToolUse![0]!;
    expect(entry.matcher).toBe('Read|Glob|Grep|Write|Edit|MultiEdit|NotebookEdit');
    const hook = entry.hooks[0]!;
    const opts = { signal: new AbortController().signal };
    expect(await hook({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: '/proy/.orquestador/x.json' } }, 'u1', opts)).toEqual({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: expect.stringMatching(/\.orquestador/) },
    });
    expect(await hook({ tool_name: 'Read', tool_input: { file_path: '/datos/app/config/x' } }, 'u2', opts)).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
    expect(await hook({ tool_name: 'Read', tool_input: { file_path: '/proy/.env' } }, 'u3', opts)).toEqual({});
    expect(await assistantGuardHook(() => ({ behavior: 'allow', updatedInput: {} }))({ tool_name: 'Bash', tool_input: {} })).toEqual({});
  });

  it('[R45.11] isSensitivePath sigue reconociendo secretos y carpetas protegidas (visor de ficheros)', () => {
    for (const p of ['.env', 'C:\\proy\\.env.local', '/home/nico/.ssh/id_rsa', 'cert/server.pem', '.git-credentials', 'credentials.json', '**/.env*'])
      expect(isSensitivePath(p), p).toBe(true);
    for (const p of ['package.json', 'src/secrets.ts', 'environment.ts', '**/*.json']) expect(isSensitivePath(p), p).toBe(false);
    expect(isSensitivePath('c:/users/nico/appdata/roaming/orquestador/x', ['C:\\Users\\nico\\AppData\\Roaming\\Orquestador'])).toBe(true);
  });
});

describe('SPEC-029 · lo que hace el asistente se ve en el chat', () => {
  it('[R29.9] cada lectura llega a la interfaz con solo el nombre, el patrón o el dominio, y dice si se denegó', async () => {
    const query: QueryFn = async function* () {
      yield { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a', name: 'Read', input: { file_path: 'C:\\Users\\nico\\pixelart-mcp\\package.json' } }] } } as SdkMessage;
      yield { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'b', name: 'Read', input: { file_path: '/p/.env' } }] } } as SdkMessage;
      yield { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'a', content: '{"name":"pixelart-mcp"}' }] } } as SdkMessage;
      yield { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'b', is_error: true, content: 'secretos' }] } } as SdkMessage;
      yield { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'c', name: 'WebFetch', input: { url: 'https://github.com/x/y', prompt: '¿cómo se arranca?' } }] } } as SdkMessage;
      yield { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'c', content: 'npx' }] } } as SdkMessage;
      yield { type: 'result', subtype: 'success', is_error: false, result: 'Se arranca con node dist/index.js' } as SdkMessage;
    };
    const events: AssistantTurnEvent[] = [];
    await runAssistantTurn({
      query,
      createServer: async () => ({}),
      tools: [],
      messages: [{ role: 'user', text: 'x' }],
      settings: defaultSettings(),
      apiKey: undefined,
      cwd: '/proy',
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
      callTool: async () => ({ ok: true, result: null }),
      newId: () => 'c1',
    });
    expect(events.filter((e) => e.type === 'read')).toEqual([
      { type: 'read', tool: 'Read', target: 'package.json', ok: true },
      { type: 'read', tool: 'Read', target: '.env', ok: false },
      { type: 'read', tool: 'WebFetch', target: 'github.com', ok: true },
    ]);
    expect(events.at(-1)).toMatchObject({ type: 'done', text: 'Se arranca con node dist/index.js' });
  });

  it('[R29.9] el objetivo nunca lleva la ruta completa', () => {
    expect(readTargetOf('Read', { file_path: '/home/nico/proyecto/src/main.ts' })).toBe('main.ts');
    expect(readTargetOf('Glob', { pattern: 'C:\\Users\\nico\\pix\\**\\*.json' })).toBe('*.json');
    expect(readTargetOf('Grep', { pattern: 'mcpServers', path: '/home/nico' })).toBe('mcpServers');
    expect(readTargetOf('WebFetch', { url: 'no es url' })).toBe('');
    expect(readTargetOf('WebSearch', { query: 'pixelart mcp server' })).toBe('pixelart mcp server');
    expect(readTargetOf('Read', null)).toBe('');
  });
});

describe('SPEC-050 · lo que hace el asistente en el sistema se ve en el chat', () => {
  it('[R50.9] escrituras, comandos y subagentes salen como una línea; TodoWrite no', async () => {
    const tool = (id: string, name: string, input: Record<string, unknown>) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } }) as SdkMessage;
    const done = (id: string, isError = false) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'x', ...(isError ? { is_error: true } : {}) }] } }) as SdkMessage;
    const query: QueryFn = async function* () {
      yield tool('w', 'Write', { file_path: 'C:\\mcp\\pix\\notas.md', content: 'x' });
      yield done('w');
      yield tool('e', 'Edit', { file_path: '/proy/.orquestador/a.json' });
      yield done('e', true);
      yield tool('b', 'Bash', { command: 'npm   install\n--no-audit' });
      yield done('b');
      yield tool('a', 'Agent', { description: 'revisar el MCP', prompt: 'mira…' });
      yield done('a');
      yield tool('t', 'TodoWrite', { todos: [] });
      yield done('t');
      yield { type: 'result', subtype: 'success', is_error: false, result: 'Hecho' } as SdkMessage;
    };
    const events: AssistantTurnEvent[] = [];
    await turn({ query, emit: (e) => events.push(e) });
    expect(events.filter((e) => e.type === 'read')).toEqual([
      { type: 'read', tool: 'Write', target: 'notas.md', ok: true },
      { type: 'read', tool: 'Edit', target: 'a.json', ok: false },
      { type: 'read', tool: 'Bash', target: 'npm install', ok: true },
      { type: 'read', tool: 'Agent', target: 'revisar el MCP', ok: true },
    ]);
    expect(readTargetOf('Bash', { command: 'cd C:\\mcp\\pix && npm install --no-audit' })).toBe('npm install');
    expect(readTargetOf('Bash', { command: 'C:\\tools\\node.exe dist/index.js | tail -5' })).toBe('node.exe && tail');
    expect(readTargetOf('Bash', { command: 'git -C /home/nico/x status' })).toBe('git');
    expect(readTargetOf('Bash', { command: 'x'.repeat(200) })).toHaveLength(80);
    expect(readTargetOf('NotebookEdit', { notebook_path: '/a/b/c.ipynb' })).toBe('c.ipynb');
  });
});
