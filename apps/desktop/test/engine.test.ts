import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppToolDef, ClaudeQueryOptions, CreateAppServer, QueryFn, SdkMessage } from '@orquestador/claude';
import { promptText } from '@orquestador/claude';
import { defaultSettings, newAgent, newContext, newMcpServer, type AppSettings, type Diagram, type RunEvent } from '@orquestador/core';
import { CHANNELS, type AssistantEvent } from '@orquestador/editor';
import { createEngineOrchestrator } from '@orquestador/runtime';
import { ApiKeyVault, McpSecretVault, SettingsStore } from '@orquestador/store';
import { DesktopHandlers } from '../src/main/handlers';
import type { TerminalService } from '../src/main/terminal';

let dir: string;
let h: DesktopHandlers;
let pushed: RunEvent[];
let calls: { prompt: string; system?: string; env?: Record<string, string | undefined> }[];
let reply: SdkMessage[];

const query: QueryFn = async function* ({ prompt, options }) {
  calls.push({ prompt, ...(options.systemPrompt ? { system: promptText(options.systemPrompt) } : {}), ...(options.env ? { env: options.env } : {}) });
  for (const m of reply) yield m;
};
const throwing = (message: string): QueryFn => () => ({ [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error(message)) }) });
const result = (text: string): SdkMessage => ({ type: 'result', subtype: 'success', is_error: false, result: text, usage: { input_tokens: 3, output_tokens: 2 }, total_cost_usd: 0.001 });
const cipher = { available: () => true, encrypt: (s: string) => Buffer.from(`c:${s}`), decrypt: (b: Buffer) => b.toString().slice(2) };

const flow: Diagram = {
  id: 'flujo',
  name: 'Flujo',
  schemaVersion: 1,
  nodes: [
    { id: 'entry', kind: 'entry' },
    { id: 'p', kind: 'agent', agentId: 'pintor' },
    { id: 'output', kind: 'output' },
  ],
  edges: [
    { id: 'e1', from: 'entry', to: 'p' },
    { id: 'e2', from: 'p', to: 'output' },
  ],
};

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'orq-engine-'));
  pushed = [];
  calls = [];
  reply = [result('Héroe dibujado')];
  h = new DesktopHandlers({
    pickFolder: async () => join(dir, 'p'),
    createOrchestrator: (ctx) => createEngineOrchestrator(ctx, query),
    claudeQuery: query,
    settings: new SettingsStore(join(dir, 'config')),
    vault: new ApiKeyVault(join(dir, 'config'), cipher),
    push: (_id, events) => pushed.push(...events),
    batchMs: 5,
  });
});
afterEach(async () => {
  h.dispose();
  await fs.rm(dir, { recursive: true, force: true });
});

const val = <T,>(r: unknown) => {
  const x = r as { ok: boolean; value?: T; error?: unknown };
  if (!x.ok) throw new Error(JSON.stringify(x.error));
  return x.value as T;
};
const setEngine = async (engine: AppSettings['engine'], extra: Partial<AppSettings> = {}) => val(await h.invoke(CHANNELS.saveSettings, { ...defaultSettings(), engine, ...extra }));

async function openProject() {
  val(await h.invoke(CHANNELS.createProject, undefined));
  val(await h.invoke(CHANNELS.saveContext, { ...newContext('estilo', 'Estilo'), value: 'Paleta de 16 colores' }));
  val(await h.invoke(CHANNELS.saveSkill, { id: 'pixel', name: 'Pixel art', description: 'Para dibujar sprites', body: '# Pasos' }));
  val(await h.invoke(CHANNELS.saveAgent, { ...newAgent('pintor', 'Pintor'), instructions: 'Dibuja con cariño', contextIds: ['estilo'], skillIds: ['pixel'] }));
  val(await h.invoke(CHANNELS.saveDiagram, flow));
}
async function runFlow() {
  const { runId } = val<{ runId: string }>(await h.invoke(CHANNELS.startRun, { diagramId: 'flujo', order: 'Dibuja un héroe' }));
  val(await h.invoke(CHANNELS.subscribeRun, { runId, fromSeq: 1 }));
  await vi.waitFor(() => expect(pushed.some((e) => e.type === 'run.finished')).toBe(true));
  return runId;
}

describe('SPEC-027 · motor de los agentes por IPC', () => {
  it('[R27.1] el motor por defecto es simulado; se guarda, se recupera y un valor inválido se rechaza', async () => {
    expect(val<AppSettings>(await h.invoke(CHANNELS.getSettings, undefined)).engine).toBe('simulated');
    await setEngine('claude');
    expect(val<AppSettings>(await h.invoke(CHANNELS.getSettings, undefined)).engine).toBe('claude');
    const bad = await h.invoke(CHANNELS.saveSettings, { ...defaultSettings(), engine: 'otro' });
    expect(bad).toMatchObject({ ok: false, error: { code: 'invalid', fields: [{ field: 'engine' }] } });
  });

  it('[R27.1] con el motor simulado no se llama a Claude', async () => {
    await openProject();
    await runFlow();
    expect(calls).toHaveLength(0);
  });

  it('[R22.10][R24.8] con Claude, instrucciones, modelo, contexto y skill del agente llegan al SDK y el resultado llega al diagrama', async () => {
    await openProject();
    await setEngine('claude');
    await runFlow();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.system).toContain('Dibuja con cariño');
    expect(calls[0]!.system).toContain('Paleta de 16 colores');
    expect(calls[0]!.system).toContain('.orquestador/skills/pixel/SKILL.md');
    expect(calls[0]!.prompt).toContain('Dibuja un héroe');
    const finished = pushed.find((e) => e.type === 'run.finished');
    expect(finished).toMatchObject({ type: 'run.finished', status: 'succeeded' });
    expect(JSON.stringify(pushed)).toContain('Héroe dibujado');
  });

  it('[R27.1] cambiar el motor en Ajustes se nota en la siguiente ejecución sin reabrir el proyecto', async () => {
    await openProject();
    await runFlow();
    expect(calls).toHaveLength(0);
    pushed.length = 0;
    await setEngine('claude');
    await runFlow();
    expect(calls).toHaveLength(1);
  });

  it('[R27.10] un agente inexistente en el proyecto hace fallar el nodo con un mensaje que explica cómo crearlo', async () => {
    val(await h.invoke(CHANNELS.createProject, undefined));
    val(await h.invoke(CHANNELS.saveDiagram, flow));
    await setEngine('claude');
    await runFlow();
    expect(JSON.stringify(pushed)).toContain('no existe en el proyecto');
    expect(pushed.find((e) => e.type === 'run.finished')).not.toMatchObject({ status: 'succeeded' });
  });

  it('[R27.8] con clave API se pasa solo al proceso del SDK y no aparece en los eventos', async () => {
    await openProject();
    val(await h.invoke(CHANNELS.setApiKey, 'sk-ant-api03-SECRETSECRETSECRET'));
    await setEngine('claude', { authMode: 'api-key' });
    reply = [result('Hecho con sk-ant-api03-SECRETSECRETSECRET')];
    await runFlow();
    expect(calls[0]!.env!['ANTHROPIC_API_KEY']).toBe('sk-ant-api03-SECRETSECRETSECRET');
    expect(JSON.stringify(pushed)).not.toContain('SECRETSECRET');
  });
});

describe('SPEC-027 · probar conexión por IPC', () => {
  it('[R27.12][R23.7] responde con el modelo y el tiempo', async () => {
    val(await h.invoke(CHANNELS.createProject, undefined));
    reply = [result('OK')];
    const r = val<{ ok: boolean; model: string; ms: number }>(await h.invoke(CHANNELS.testConnection, undefined));
    expect(r).toMatchObject({ ok: true, model: defaultSettings().defaultModel });
  });

  it('[R27.12] un fallo se devuelve explicado, sin filtrar la clave ni rutas', async () => {
    val(await h.invoke(CHANNELS.createProject, undefined));
    val(await h.invoke(CHANNELS.setApiKey, 'sk-ant-api03-SECRETSECRETSECRET'));
    await setEngine('claude', { authMode: 'api-key' });
    reply = [];
    const failing = new DesktopHandlers({
      pickFolder: async () => join(dir, 'q'),
      createOrchestrator: (ctx) => createEngineOrchestrator(ctx, query),
      claudeQuery: throwing(`401 invalid x-api-key sk-ant-api03-SECRETSECRETSECRET en ${dir}`),
      settings: new SettingsStore(join(dir, 'config')),
      vault: new ApiKeyVault(join(dir, 'config'), cipher),
    });
    val(await failing.invoke(CHANNELS.createProject, undefined));
    const r = await failing.invoke(CHANNELS.testConnection, undefined);
    expect(val<{ ok: boolean; message: string }>(r)).toMatchObject({ ok: false, message: expect.stringContaining('sesión válida') });
    expect(JSON.stringify(r)).not.toContain('SECRETSECRET');
    failing.dispose();
  });

  it('[R27.12] sin proyecto abierto o sin motor disponible falla con claridad', async () => {
    expect(await h.invoke(CHANNELS.testConnection, undefined)).toMatchObject({ ok: false, error: { code: 'not-found' } });
    const bare = new DesktopHandlers({ pickFolder: async () => join(dir, 'z'), createOrchestrator: (ctx) => createEngineOrchestrator(ctx, query) });
    val(await bare.invoke(CHANNELS.createProject, undefined));
    expect(await bare.invoke(CHANNELS.testConnection, undefined)).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    bare.dispose();
  });
});

describe('SPEC-026 · redactar con Claude por IPC', () => {
  const proposal = JSON.stringify({ name: 'Revisor', description: 'Revisa textos', instructions: '# Revisa', model: 'claude-opus-5-5', contextIds: ['guia', 'no-existe'], skillIds: [], extra: 'x' });

  it('[R26.1][R26.4][R26.6] devuelve campos conocidos y solo envía nombres de contextos, nunca su valor', async () => {
    val(await h.invoke(CHANNELS.createProject, undefined));
    val(await h.invoke(CHANNELS.saveContext, { ...newContext('guia', 'Guía'), value: 'SECRETO-DEL-CONTEXTO' }));
    reply = [result(`Aquí tienes:\n\`\`\`json\n${proposal}\n\`\`\``)];
    const r = val<{ fields: Record<string, unknown>; problems: unknown[] }>(await h.invoke(CHANNELS.draftWithClaude, { kind: 'agent', instruction: 'Revisa textos' }));
    expect(r.fields).toEqual({ name: 'Revisor', description: 'Revisa textos', instructions: '# Revisa', model: 'claude-opus-5-5', contextIds: ['guia'], skillIds: [] });
    expect(r.problems).toEqual([]);
    expect(calls[0]!.system).toContain('guia: Guía');
    expect(JSON.stringify(calls)).not.toContain('SECRETO-DEL-CONTEXTO');
  });

  it('[R26.5] un fallo de Claude se explica sin filtrar la clave y sin tocar el proyecto', async () => {
    val(await h.invoke(CHANNELS.createProject, undefined));
    const failing = new DesktopHandlers({
      pickFolder: async () => join(dir, 'q'),
      createOrchestrator: (ctx) => createEngineOrchestrator(ctx, query),
      claudeQuery: throwing(`401 invalid x-api-key sk-ant-api03-SECRETSECRETSECRET en ${dir}`),
    });
    val(await failing.invoke(CHANNELS.createProject, undefined));
    const r = await failing.invoke(CHANNELS.draftWithClaude, { kind: 'skill', instruction: 'Una skill' });
    expect(r).toMatchObject({ ok: false, error: { code: 'unavailable', message: expect.stringContaining('sesión válida') } });
    expect(JSON.stringify(r)).not.toContain('SECRETSECRET');
    expect(val<unknown[]>(await failing.invoke(CHANNELS.listSkills, undefined))).toEqual([]);
    failing.dispose();
  });

  it('[R26.6] una respuesta que no es JSON o no propone nada se rechaza con un mensaje', async () => {
    val(await h.invoke(CHANNELS.createProject, undefined));
    reply = [result('No sé qué decirte')];
    expect(await h.invoke(CHANNELS.draftWithClaude, { kind: 'agent', instruction: 'x' })).toMatchObject({ ok: false, error: { message: expect.stringContaining('formato esperado') } });
    reply = [result('{"otra": 1}')];
    expect(await h.invoke(CHANNELS.draftWithClaude, { kind: 'agent', instruction: 'x' })).toMatchObject({ ok: false, error: { message: expect.stringContaining('ningún campo') } });
  });

  it('[R26.6] lo que no cumple las reglas de un alta manual se devuelve campo a campo', async () => {
    val(await h.invoke(CHANNELS.createProject, undefined));
    reply = [result(JSON.stringify({ name: 'N'.repeat(80), description: 'ok', body: 'texto' }))];
    const r = val<{ problems: { field: string }[] }>(await h.invoke(CHANNELS.draftWithClaude, { kind: 'skill', instruction: 'x' }));
    expect(r.problems.map((p) => p.field)).toEqual(['name']);
  });

  it('[R26.1] redacta un contexto de texto', async () => {
    val(await h.invoke(CHANNELS.createProject, undefined));
    reply = [result(JSON.stringify({ name: 'Glosario', value: '# Términos' }))];
    const r = val<{ fields: Record<string, unknown>; problems: unknown[] }>(await h.invoke(CHANNELS.draftWithClaude, { kind: 'context', instruction: 'Glosario' }));
    expect(r).toMatchObject({ fields: { name: 'Glosario', value: '# Términos' }, problems: [] });
  });

  it('[R26.3] para mejorar envía el borrador actual junto con la indicación', async () => {
    val(await h.invoke(CHANNELS.createProject, undefined));
    reply = [result(JSON.stringify({ instructions: 'Más estricto' }))];
    val(await h.invoke(CHANNELS.draftWithClaude, { kind: 'agent', instruction: 'hazlo más estricto', current: { name: 'Revisor', instructions: 'Revisa' } }));
    expect(calls[0]!.prompt).toContain('Mejora este agente');
    expect(calls[0]!.prompt).toContain('"instructions": "Revisa"');
    expect(calls[0]!.prompt).toContain('hazlo más estricto');
  });

  it('[R26.7] el contrato rechaza campos extra, tipos y tamaños no válidos', async () => {
    val(await h.invoke(CHANNELS.createProject, undefined));
    for (const bad of [
      { kind: 'otro', instruction: 'x' },
      { kind: 'agent', instruction: '' },
      { kind: 'agent', instruction: 'x'.repeat(4001) },
      { kind: 'agent', instruction: 'x', apiKey: 'k' },
      { kind: 'skill', instruction: 'x', current: { instructions: 'no es de skill' } },
      { kind: 'agent', instruction: 'x', current: { contextIds: ['../fuera'] } },
    ]) {
      expect(await h.invoke(CHANNELS.draftWithClaude, bad)).toMatchObject({ ok: false, error: { code: 'bad-request' } });
    }
    expect(calls).toHaveLength(0);
  });

  it('[R26.5] sin proyecto abierto o sin motor disponible falla con claridad', async () => {
    expect(await h.invoke(CHANNELS.draftWithClaude, { kind: 'agent', instruction: 'x' })).toMatchObject({ ok: false });
    const bare = new DesktopHandlers({ pickFolder: async () => join(dir, 'z'), createOrchestrator: (ctx) => createEngineOrchestrator(ctx, query) });
    val(await bare.invoke(CHANNELS.createProject, undefined));
    expect(await bare.invoke(CHANNELS.draftWithClaude, { kind: 'agent', instruction: 'x' })).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    bare.dispose();
  });
});

describe('SPEC-033 · subdiagramas con el motor real', () => {
  it('[R33.7] un paso subdiagrama ejecuta el diagrama guardado y su salida es la del paso', async () => {
    await openProject();
    await setEngine('claude');
    val(
      await h.invoke(CHANNELS.saveDiagram, {
        id: 'mundo',
        name: 'Mundo',
        schemaVersion: 1,
        nodes: [
          { id: 'entry', kind: 'entry' },
          { id: 's', kind: 'subdiagram', subdiagram: { templateId: 'flujo', version: 'latest' } },
          { id: 'output', kind: 'output' },
        ],
        edges: [
          { id: 'e1', from: 'entry', to: 's' },
          { id: 'e2', from: 's', to: 'output' },
        ],
      }),
    );
    const { runId } = val<{ runId: string }>(await h.invoke(CHANNELS.startRun, { diagramId: 'mundo', order: 'Dibuja un héroe' }));
    val(await h.invoke(CHANNELS.subscribeRun, { runId, fromSeq: 1 }));
    await vi.waitFor(() => expect(pushed.some((e) => e.type === 'run.finished')).toBe(true));
    const fin = pushed.find((e) => e.type === 'run.finished') as { status: string };
    expect(fin.status).toBe('succeeded');
    expect(pushed.some((e) => e.type === 'subdiagram.started')).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

describe('SPEC-033 · conocimiento añadido con el motor real', () => {
  it('[R33.3] lo añadido al paso llega al prompt de sistema aunque el agente no lo tenga', async () => {
    await openProject();
    await setEngine('claude');
    val(await h.invoke(CHANNELS.saveContext, { ...newContext('cueva', 'Cueva helada'), value: 'Hielo azul' }));
    val(await h.invoke(CHANNELS.saveDiagram, { ...flow, nodes: flow.nodes.map((n) => (n.id === 'p' ? { ...n, extra: { contextIds: ['cueva'] } } : n)) }));
    await runFlow();
    expect(calls[0]!.system).toContain('Cueva helada');
    expect(calls[0]!.system).toContain('Estilo');
  });
});

describe('SPEC-030 · MCP por IPC', () => {
  const withVault = (q: QueryFn = query, extra: Partial<ConstructorParameters<typeof DesktopHandlers>[0]> = {}) => {
    h.dispose();
    pushed = [];
    calls = [];
    h = new DesktopHandlers({
      appMcpDir: join(dir, 'config', 'mcp'),
      ...extra,
      pickFolder: async () => join(dir, 'p'),
      createOrchestrator: (ctx) => createEngineOrchestrator(ctx, q),
      claudeQuery: q,
      settings: new SettingsStore(join(dir, 'config')),
      vault: new ApiKeyVault(join(dir, 'config'), cipher),
      mcpVault: new McpSecretVault(join(dir, 'config'), cipher),
      push: (_id, events) => pushed.push(...events),
      batchMs: 5,
    });
  };
  const pixel = { ...newMcpServer('pixel', 'Pixel'), command: 'npx', args: ['pixelart-mcp'], secretNames: ['API_KEY'] };

  it('[R30.1][R30.8] el secreto se guarda cifrado fuera del proyecto y la interfaz solo ve su nombre', async () => {
    withVault();
    await openProject();
    val(await h.invoke(CHANNELS.saveMcp, pixel));
    val(await h.invoke(CHANNELS.setMcpSecret, { id: 'pixel', name: 'API_KEY', value: 'valor-muy-secreto' }));
    const list = val<{ id: string; secretsSet: string[] }[]>(await h.invoke(CHANNELS.listMcp, undefined));
    expect(list).toEqual([expect.objectContaining({ id: 'pixel', secretsSet: ['API_KEY'] })]);
    expect(JSON.stringify(list)).not.toContain('valor-muy-secreto');
    const projectFiles = await fs.readdir(join(dir, 'p', '.orquestador', 'mcp'));
    for (const f of projectFiles) expect(await fs.readFile(join(dir, 'p', '.orquestador', 'mcp', f), 'utf8')).not.toContain('valor-muy-secreto');
    val(await h.invoke(CHANNELS.clearMcpSecret, { id: 'pixel', name: 'API_KEY' }));
    expect(val<{ secretsSet: string[] }[]>(await h.invoke(CHANNELS.listMcp, undefined))[0]!.secretsSet).toEqual([]);
  });

  it('[R30.4] al ejecutar con Claude el agente recibe su servidor con el secreto como variable de entorno', async () => {
    const seen: ClaudeQueryOptions[] = [];
    const spy: QueryFn = async function* (args) {
      seen.push(args.options);
      yield* query(args);
    };
    withVault(spy);
    await openProject();
    await setEngine('claude');
    val(await h.invoke(CHANNELS.saveMcp, pixel));
    val(await h.invoke(CHANNELS.setMcpSecret, { id: 'pixel', name: 'API_KEY', value: 'k-123' }));
    val(await h.invoke(CHANNELS.saveAgent, { ...newAgent('pintor', 'Pintor'), mcpIds: ['pixel'] }));
    await runFlow();
    expect(seen[0]!.mcpServers).toEqual({ pixel: { type: 'stdio', command: 'npx', args: ['pixelart-mcp'], env: { API_KEY: 'k-123' } } });
    expect(JSON.stringify(pushed)).not.toContain('k-123');
  });

  it('[R30.5] probar conexión por IPC usa el SDK y no deja rutas en el mensaje', async () => {
    withVault();
    await openProject();
    val(await h.invoke(CHANNELS.saveMcp, pixel));
    reply = [{ type: 'system', subtype: 'init', tools: ['mcp__pixel__dibujar'], mcp_servers: [{ name: 'pixel', status: 'connected' }] } as SdkMessage];
    expect(val(await h.invoke(CHANNELS.testMcp, 'pixel'))).toMatchObject({ ok: true, tools: ['dibujar'] });
  });

  it('[R30.9] un servidor de la app guarda sus secretos aparte, se usa al ejecutar y cambiar de ámbito los mueve', async () => {
    const seen: ClaudeQueryOptions[] = [];
    const spy: QueryFn = async function* (args) {
      seen.push(args.options);
      yield* query(args);
    };
    withVault(spy);
    await openProject();
    await setEngine('claude');
    val(await h.invoke(CHANNELS.saveMcp, pixel));
    val(await h.invoke(CHANNELS.setMcpSecret, { id: 'pixel', name: 'API_KEY', value: 'k-app' }));
    val(await h.invoke(CHANNELS.saveMcp, { ...pixel, scope: 'app' }));
    expect(await fs.readdir(join(dir, 'config', 'mcp'))).toEqual(['pixel.json']);
    expect(val<{ scope: string; secretsSet: string[] }[]>(await h.invoke(CHANNELS.listMcp, undefined))).toEqual([expect.objectContaining({ scope: 'app', secretsSet: ['API_KEY'] })]);
    val(await h.invoke(CHANNELS.saveAgent, { ...newAgent('pintor', 'Pintor'), mcpIds: ['pixel'] }));
    await runFlow();
    expect(seen[0]!.mcpServers).toEqual({ pixel: expect.objectContaining({ env: { API_KEY: 'k-app' } }) });
    val(await h.invoke(CHANNELS.deleteMcp, 'pixel'));
    expect(await fs.readdir(join(dir, 'config', 'mcp'))).toEqual([]);
    expect(val<unknown[]>(await h.invoke(CHANNELS.listMcp, undefined))).toEqual([]);
  });

  it('[R30.13] la terminal arranca siempre en la carpeta del proyecto y se cierra al cambiar de proyecto', async () => {
    const started: { cwd: string; program: string }[] = [];
    let killed = 0;
    const terminals = {
      start: async (cwd: string, req: { program: string }) => (started.push({ cwd, program: req.program }), { id: 'term-1', external: false }),
      write: () => true,
      resize: () => true,
      kill: () => true,
      killAll: () => void killed++,
    } as unknown as TerminalService;
    withVault(query, { terminals });
    expect((await h.invoke(CHANNELS.terminalStart, { program: 'claude', cols: 80, rows: 24 })).ok).toBe(false);
    await openProject();
    val(await h.invoke(CHANNELS.terminalStart, { program: 'claude', prompt: 'hola', cols: 80, rows: 24 }));
    expect(started).toEqual([{ cwd: join(dir, 'p'), program: 'claude' }]);
    expect((await h.invoke(CHANNELS.terminalStart, { program: 'claude', cwd: '/', cols: 80, rows: 24 })).ok).toBe(false);
    const before = killed;
    val(await h.invoke(CHANNELS.openProject, undefined));
    expect(killed).toBeGreaterThan(before);
  });
});

describe('SPEC-029 · asistente por IPC', () => {
  const assistantEvents: { turnId: string; event: AssistantEvent }[] = [];
  const make = (q: QueryFn, server: CreateAppServer, protectedDirs?: string[]) => {
    h.dispose();
    assistantEvents.length = 0;
    h = new DesktopHandlers({
      pickFolder: async () => join(dir, 'p'),
      createOrchestrator: (ctx) => createEngineOrchestrator(ctx, q),
      claudeQuery: q,
      createAppServer: server,
      pushAssistant: (turnId, event) => assistantEvents.push({ turnId, event }),
      settings: new SettingsStore(join(dir, 'config')),
      vault: new ApiKeyVault(join(dir, 'config'), cipher),
      ...(protectedDirs ? { assistantProtectedDirs: protectedDirs } : {}),
      batchMs: 5,
    });
  };

  it('[R50.8][R29.9] la carpeta de datos de la app y .orquestador quedan protegidos y la interfaz no recibe rutas', async () => {
    let seen: ClaudeQueryOptions | undefined;
    const data = join(dir, 'config');
    const q: QueryFn = async function* ({ options }) {
      seen = options;
      yield { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'g', name: 'Grep', input: { pattern: `${join(dir, 'p')}/x`, path: dir } }] } } as SdkMessage;
      yield { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'g', content: '' }] } } as SdkMessage;
      yield { type: 'result', subtype: 'success', is_error: false, result: 'ok' } as SdkMessage;
    };
    make(q, async () => ({}), [data]);
    await openProject();
    await setEngine('claude');
    val(await h.invoke(CHANNELS.assistantSend, { turnId: 't4', messages: [{ role: 'user', text: 'lee' }] }));
    await vi.waitFor(() => expect(assistantEvents.some((e) => e.event.type === 'done')).toBe(true));
    expect(await seen!.canUseTool!('Read', { file_path: join(data, 'api-key.bin') })).toMatchObject({ behavior: 'deny' });
    expect(await seen!.canUseTool!('Read', { file_path: join(dir, 'p', 'README.md') })).toMatchObject({ behavior: 'allow' });
    expect(await seen!.canUseTool!('Write', { file_path: join(dir, 'p', '.orquestador', 'agents', 'x.json') })).toMatchObject({ behavior: 'deny' });
    expect(await seen!.canUseTool!('Bash', { command: 'npm install' })).toMatchObject({ behavior: 'allow' });
    const read = assistantEvents.find((e) => e.event.type === 'read')!.event as { target: string };
    expect(read.target).not.toContain(dir);
  });

  it('[R29.6] con el motor simulado explica que está en modo simulado', async () => {
    make(query, async () => ({}));
    await openProject();
    val(await h.invoke(CHANNELS.assistantSend, { turnId: 't1', messages: [{ role: 'user', text: 'hola' }] }));
    await vi.waitFor(() => expect(assistantEvents.some((e) => e.event.type === 'done')).toBe(true));
    expect(assistantEvents[0]!.event).toMatchObject({ type: 'text', text: expect.stringMatching(/modo simulado/) });
  });

  it('[R29.4] con Claude, cada herramienta espera a la interfaz y su resultado vuelve a Claude', async () => {
    let tools: AppToolDef[] = [];
    let toolOut = '';
    const q: QueryFn = async function* () {
      const r = await tools.find((t) => t.name === 'list_agents')!.handler({});
      toolOut = r.content[0]!.text;
      yield { type: 'result', subtype: 'success', is_error: false, result: 'Tienes un agente.', usage: { input_tokens: 1, output_tokens: 1 } } as SdkMessage;
    };
    make(q, async (_n, defs) => ((tools = defs), {}));
    await openProject();
    await setEngine('claude');
    val(await h.invoke(CHANNELS.assistantSend, { turnId: 't2', messages: [{ role: 'user', text: '¿qué agentes hay?' }] }));
    await vi.waitFor(() => expect(assistantEvents.some((e) => e.event.type === 'tool')).toBe(true));
    const call = assistantEvents.find((e) => e.event.type === 'tool')!.event as { callId: string; name: string };
    expect(call.name).toBe('list_agents');
    expect(tools.map((t) => t.name)).toContain('run_diagram');
    expect(val(await h.invoke(CHANNELS.assistantToolResult, { turnId: 't2', callId: call.callId, ok: true, result: [{ id: 'pintor' }] }))).toBe(true);
    await vi.waitFor(() => expect(assistantEvents.some((e) => e.event.type === 'done')).toBe(true));
    expect(toolOut).toBe('[{"id":"pintor"}]');
    expect(val(await h.invoke(CHANNELS.assistantToolResult, { turnId: 't2', callId: call.callId, ok: true, result: null }))).toBe(false);
  });

  it('[R29.4] detener un turno corta la herramienta que esperaba', async () => {
    let tools: AppToolDef[] = [];
    let answer = '';
    const q: QueryFn = async function* () {
      answer = (await tools[0]!.handler({})).content[0]!.text;
      yield { type: 'result', subtype: 'success', is_error: false, result: 'x' } as SdkMessage;
    };
    make(q, async (_n, defs) => ((tools = defs), {}));
    await openProject();
    await setEngine('claude');
    val(await h.invoke(CHANNELS.assistantSend, { turnId: 't3', messages: [{ role: 'user', text: 'x' }] }));
    await vi.waitFor(() => expect(assistantEvents.some((e) => e.event.type === 'tool')).toBe(true));
    expect(val(await h.invoke(CHANNELS.assistantCancel, 't3'))).toBe(true);
    await vi.waitFor(() => expect(assistantEvents.some((e) => e.event.type === 'error')).toBe(true));
    expect(answer).toBe('"Detenido."');
  });
});

describe('SPEC-037 · transformar con el motor de la app', () => {
  const withTransform: Diagram = {
    ...flow,
    nodes: [...flow.nodes.filter((n) => n.id !== 'output'), { id: 't', kind: 'transform', transform: { mode: 'ai', format: 'json', instructions: 'Pon el resultado en un campo', schema: '{"type":"object","required":["resultado"],"properties":{"resultado":{"type":"string"}}}' } }, { id: 'output', kind: 'output' }],
    edges: [{ id: 'e1', from: 'entry', to: 'p' }, { id: 'e2', from: 'p', to: 't' }, { id: 'e3', from: 't', to: 'output' }],
  };

  it('[R37.8] con el motor simulado convierte sin llamar a Claude', async () => {
    await openProject();
    val(await h.invoke(CHANNELS.saveDiagram, withTransform));
    await runFlow();
    expect(calls).toHaveLength(0);
    expect(pushed.find((e) => e.type === 'run.finished')).toMatchObject({ status: 'succeeded' });
    expect(pushed.find((e) => e.type === 'transform.done')).toMatchObject({ ok: true, mode: 'ai' });
  });

  it('[R37.6] con Claude, el paso de transformar hace su propia consulta y su salida cumple el esquema', async () => {
    await openProject();
    val(await h.invoke(CHANNELS.saveDiagram, withTransform));
    await setEngine('claude');
    reply = [result('{"resultado":"Héroe dibujado"}')];
    await runFlow();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.prompt).toContain('Pon el resultado en un campo');
    const out = pushed.find((e) => e.type === 'node.finished' && e.nodeId === 't');
    expect(out).toMatchObject({ status: 'succeeded' });
    expect(JSON.parse((out as { output: { text: string } }).output.text)).toEqual({ resultado: 'Héroe dibujado' });
  });
});
