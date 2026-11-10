import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ASSISTANT_TOOLS, CHANNELS, TEST_ARG, TEST_CALL_CHANNEL, TEST_READY_CHANNEL, TEST_REPLY_CHANNEL, type ApiResult } from '@orquestador/editor';
import { ConsoleLog, DialogQueue, RendererBridge, consoleEntry } from '../src/main/test-mcp/bridge';
import { PROTOCOL_VERSIONS, RPC, SERVER_NAME, handleMcp, inputSchema, type TestTool } from '../src/main/test-mcp/protocol';
import { DEFAULT_TEST_PORT, TEST_DATA_FOLDER, loadToken, startTestServer, testMode } from '../src/main/test-mcp/server';
import { EXCLUDED_APP_TOOLS, testTools, type TestHost } from '../src/main/test-mcp/tools';
import { windowOptions } from '../src/main/window';
import { buildTestBridge } from '../src/preload/api';

const echo: TestTool = { name: 'echo', description: 'Devuelve lo que recibe', params: { text: { type: 'string', description: 'Texto' }, n: { type: 'number', description: 'N', optional: true } }, run: async (a) => ({ text: a['text'] }) };
const boom: TestTool = { name: 'boom', description: 'Falla', params: {}, run: async () => Promise.reject(new Error('se rompió')) };
const rpc = (method: string, params?: unknown, id = 1) => ({ jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) });
const note = (method: string) => ({ jsonrpc: '2.0', method });

describe('SPEC-082 · activación y aislamiento', () => {
  it('[R82.1] solo con --test-mcp, nunca en la app empaquetada; el puerto es configurable', () => {
    expect(testMode(['electron', '.'], false)).toBeUndefined();
    expect(testMode(['electron', '.', '--test-mcp'], false)).toEqual({ port: DEFAULT_TEST_PORT });
    expect(testMode(['electron', '.', '--test-mcp', '--test-mcp-port=5000'], false)).toEqual({ port: 5000 });
    expect(testMode(['electron', '.', '--test-mcp', '--test-mcp-port=nope'], false)).toEqual({ port: DEFAULT_TEST_PORT });
    expect(testMode(['app.exe', '--test-mcp'], true)).toBeUndefined();
  });

  it('[R82.2] los datos van a su propia carpeta, junto a la normal, antes de la instancia única', () => {
    expect(TEST_DATA_FOLDER).toBe('Orquestador-test');
    const main = readFileSync(join(__dirname, '../src/main/main.ts'), 'utf8');
    const setPath = main.indexOf("app.setPath('userData', join(app.getPath('appData'), TEST_DATA_FOLDER))");
    expect(setPath).toBeGreaterThan(0);
    expect(setPath).toBeLessThan(main.indexOf('app.requestSingleInstanceLock()'));
  });

  it('[R82.3][R82.7] en modo prueba la ventana cambia de título y pasa el argumento al preload; si no, no', () => {
    const normal = windowOptions('/p.cjs', 'win32');
    expect(normal.title).toBe('Orquestador');
    expect(normal.webPreferences).not.toHaveProperty('additionalArguments');
    const t = windowOptions('/p.cjs', 'win32', undefined, { title: 'Orquestador · modo prueba', args: [TEST_ARG] });
    expect(t.title).toBe('Orquestador · modo prueba');
    expect(t.webPreferences.additionalArguments).toEqual([TEST_ARG]);
    expect(t.webPreferences.sandbox).toBe(true);
  });
});

describe('SPEC-082 · protocolo', () => {
  it('[R82.4] initialize negocia la versión y anuncia las herramientas', async () => {
    expect(await handleMcp(rpc('initialize', { protocolVersion: '2025-03-26' }), [])).toEqual({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: SERVER_NAME, version: '1.0.0' } } });
    expect(await handleMcp(rpc('initialize', { protocolVersion: '1999-01-01' }), [])).toMatchObject({ result: { protocolVersion: PROTOCOL_VERSIONS[0] } });
    expect(await handleMcp(rpc('ping'), [])).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
  });

  it('[R82.4] las notificaciones no tienen respuesta, también en lote', async () => {
    expect(await handleMcp(note('notifications/initialized'), [])).toBeUndefined();
    const batch = await handleMcp([note('notifications/initialized'), rpc('ping', undefined, 7)], []);
    expect(batch).toEqual([{ jsonrpc: '2.0', id: 7, result: {} }]);
  });

  it('[R82.4] tools/list da el esquema; tools/call ejecuta, valida y convierte fallos en isError', async () => {
    const list = (await handleMcp(rpc('tools/list'), [echo])) as { result: { tools: unknown[] } };
    expect(list.result.tools).toEqual([{ name: 'echo', description: 'Devuelve lo que recibe', inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'Texto' }, n: { type: 'number', description: 'N' } }, required: ['text'], additionalProperties: false } }]);
    expect(await handleMcp(rpc('tools/call', { name: 'echo', arguments: { text: 'hola' } }), [echo])).toEqual({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'hola' }] } });
    expect(await handleMcp(rpc('tools/call', { name: 'echo', arguments: {} }), [echo])).toMatchObject({ error: { code: RPC.params, message: 'Falta el parámetro text' } });
    expect(await handleMcp(rpc('tools/call', { name: 'echo', arguments: { text: 1 } }), [echo])).toMatchObject({ error: { code: RPC.params } });
    expect(await handleMcp(rpc('tools/call', { name: 'echo', arguments: { text: 'x', otro: 1 } }), [echo])).toMatchObject({ error: { code: RPC.params, message: 'Parámetro desconocido: otro' } });
    expect(await handleMcp(rpc('tools/call', { name: 'nada' }), [echo])).toMatchObject({ error: { code: RPC.params } });
    expect(await handleMcp(rpc('tools/call', { name: 'boom' }), [boom])).toEqual({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'se rompió' }], isError: true } });
    expect(await handleMcp(rpc('otra/cosa'), [])).toMatchObject({ error: { code: RPC.method } });
    expect(await handleMcp({ id: 1, method: 'ping' }, [])).toMatchObject({ error: { code: RPC.invalid } });
  });

  it('[R82.4] las listas de textos son arrays en el esquema', () => {
    expect(inputSchema({ paths: { type: 'string[]', description: 'Rutas' } }).properties['paths']).toEqual({ type: 'array', items: { type: 'string' }, description: 'Rutas' });
  });
});

describe('SPEC-082 · servidor HTTP', () => {
  let server: Server | undefined;
  let dir: string | undefined;
  afterEach(async () => {
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    server = undefined;
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });
  const post = (port: number, body: string, headers: Record<string, string> = {}) => fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });

  it('[R82.5] E82.a: con token responde; sin token 401, con Origin 403, GET 405, JSON roto -32700, solo notificaciones 202', async () => {
    server = await startTestServer(0, 'secreto', () => [echo]);
    const port = (server.address() as AddressInfo).port;
    expect((server.address() as AddressInfo).address).toBe('127.0.0.1');
    const auth = { authorization: 'Bearer secreto' };
    const list = await post(port, JSON.stringify(rpc('tools/list')), auth);
    expect(list.status).toBe(200);
    expect(((await list.json()) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name)).toEqual(['echo']);
    expect((await post(port, JSON.stringify(rpc('ping')))).status).toBe(401);
    expect((await post(port, JSON.stringify(rpc('ping')), { authorization: 'Bearer otro' })).status).toBe(401);
    expect((await post(port, JSON.stringify(rpc('ping')), { ...auth, origin: 'https://malo.example' })).status).toBe(403);
    expect((await fetch(`http://127.0.0.1:${port}/mcp`, { headers: auth })).status).toBe(405);
    expect((await fetch(`http://127.0.0.1:${port}/otra`, { method: 'POST', headers: auth })).status).toBe(404);
    expect(await (await post(port, '{roto', auth)).json()).toMatchObject({ error: { code: RPC.parse } });
    const accepted = await post(port, JSON.stringify(note('notifications/initialized')), auth);
    expect(accepted.status).toBe(202);
    expect(await accepted.text()).toBe('');
  });

  it('[R82.6] el token se crea una vez y se guarda con la dirección; con el puerto ocupado no arranca', async () => {
    dir = await mkdtemp(join(tmpdir(), 'orq-test-mcp-'));
    const file = join(dir, 'sub', 'test-mcp.json');
    const a = await loadToken(file, 'http://127.0.0.1:1/mcp');
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ url: 'http://127.0.0.1:1/mcp', token: a });
    expect(await loadToken(file, 'http://127.0.0.1:2/mcp')).toBe(a);
    const busy = createServer();
    await new Promise<void>((r) => busy.listen(0, '127.0.0.1', () => r()));
    const port = (busy.address() as AddressInfo).port;
    await expect(startTestServer(port, a, () => [])).rejects.toThrow();
    await new Promise<void>((r) => busy.close(() => r()));
    const main = readFileSync(join(__dirname, '../src/main/main.ts'), 'utf8');
    expect(main).toContain('No se pudo abrir el MCP');
  });
});

/** Host simulado de las herramientas. */
function fakeHost(over: Partial<TestHost> = {}) {
  const calls: { tool: string; args: Record<string, unknown>; timeoutMs: number }[] = [];
  const queued: string[][] = [];
  const invoked: [string, unknown][] = [];
  const host: TestHost = {
    invoke: async (channel, payload) => (invoked.push([channel, payload]), { ok: true, value: null }),
    renderer: async (tool, args, timeoutMs) => (calls.push({ tool, args, timeoutMs }), { tool }),
    screenshot: async () => 'UE5H',
    queueDialog: (p) => void queued.push(p),
    logs: (n) => Array.from({ length: n }, (_, i) => `l${i}`),
    reload: async () => undefined,
    sleep: async () => undefined,
    ...over,
  };
  return { host, calls, queued, invoked, tools: testTools(host) };
}
const call = (tools: TestTool[], name: string, args: Record<string, unknown> = {}) => tools.find((t) => t.name === name)!.run(args);

describe('SPEC-082 · herramientas', () => {
  it('[R82.7] están las acciones de la app salvo las interactivas y la terminal, y van a la interfaz con prefijo app:', async () => {
    const { tools, calls } = fakeHost();
    const names = tools.map((t) => t.name);
    for (const t of ASSISTANT_TOOLS) expect(names.includes(t.name)).toBe(!EXCLUDED_APP_TOOLS.has(t.name));
    expect([...EXCLUDED_APP_TOOLS].sort()).toEqual(['ask_user', 'open_terminal', 'request_secret']);
    expect(tools.find((t) => t.name === 'run_diagram')!.params).toEqual(ASSISTANT_TOOLS.find((t) => t.name === 'run_diagram')!.params);
    await call(tools, 'run_diagram', { input: 'x' });
    expect(calls).toEqual([{ tool: 'app:run_diagram', args: { input: 'x' }, timeoutMs: 10 * 60_000 }]);
  });

  it('[R82.8][R82.9][R82.17] las de interfaz van tal cual, con 60 s de límite', async () => {
    const { tools, calls } = fakeHost();
    for (const n of ['app_state', 'ui_snapshot', 'ui_click', 'ui_type', 'ui_press']) await call(tools, n, n === 'ui_click' ? { name: 'Ejecutar' } : {});
    expect(calls.map((c) => c.tool)).toEqual(['app_state', 'ui_snapshot', 'ui_click', 'ui_type', 'ui_press']);
    expect(calls.every((c) => c.timeoutMs === 60_000)).toBe(true);
    expect(calls[2]!.args).toEqual({ name: 'Ejecutar' });
  });

  it('[R82.10][R82.11] open_project deja la ruta para el diálogo antes de pedírselo a la interfaz; queue_dialog la deja sin más', async () => {
    const order: string[] = [];
    const { tools, queued } = fakeHost({ queueDialog: (p) => void order.push(`queue:${p.join(',')}`), renderer: async (tool, args) => (order.push(`${tool}:${JSON.stringify(args)}`), { opened: 'P' }) });
    expect(await call(tools, 'open_project', { path: 'C:/pruebas/p1', create: true })).toEqual({ text: { opened: 'P' } });
    expect(order).toEqual(['queue:C:/pruebas/p1', 'open_project:{"create":true}']);
    const q = fakeHost();
    await call(q.tools, 'queue_dialog', { paths: [] });
    expect(q.queued).toEqual([[]]);
    void queued;
  });

  it('[R82.12] screenshot devuelve una imagen PNG', async () => {
    expect(await call(fakeHost().tools, 'screenshot')).toEqual({ image: { data: 'UE5H', mimeType: 'image/png' } });
  });

  it('[R82.13] call_api solo acepta métodos de la API y va por su canal; { value } envuelve un texto', async () => {
    const { tools, invoked } = fakeHost();
    await call(tools, 'call_api', { method: 'listRuns' });
    await call(tools, 'call_api', { method: 'pendingQuestions', payload: { value: 'run-1' } });
    await call(tools, 'call_api', { method: 'loadDiagram', payload: { id: 'd' } });
    expect(invoked).toEqual([[CHANNELS.listRuns, undefined], [CHANNELS.pendingQuestions, 'run-1'], [CHANNELS.loadDiagram, { id: 'd' }]]);
    await expect(call(tools, 'call_api', { method: 'rm -rf' })).rejects.toThrow('Método desconocido');
  });

  it('[R82.14] wait_run espera a que termine, avisa si pregunta y corta al llegar al límite', async () => {
    let polls = 0;
    const runs = (status: string) => [{ runId: 'old', status: 'succeeded', startedAt: '2026-11-09T09:00:00Z' }, { runId: 'new', status, startedAt: '2026-11-09T10:00:00Z' }];
    const finishing = fakeHost({ invoke: async (ch): Promise<ApiResult<unknown>> => (ch === CHANNELS.listRuns ? { ok: true, value: runs(++polls < 3 ? 'running' : 'failed') } : { ok: true, value: [] }) });
    expect(await call(finishing.tools, 'wait_run')).toEqual({ text: { runId: 'new', status: 'failed' } });
    const asking = fakeHost({ invoke: async (ch): Promise<ApiResult<unknown>> => (ch === CHANNELS.listRuns ? { ok: true, value: runs('running') } : { ok: true, value: [{ questionId: 'q1', text: '¿Sigo?' }] }) });
    expect(await call(asking.tools, 'wait_run', { runId: 'new' })).toEqual({ text: { runId: 'new', status: 'waiting', questions: [{ questionId: 'q1', text: '¿Sigo?' }] } });
    const slow = fakeHost({ invoke: async (ch): Promise<ApiResult<unknown>> => (ch === CHANNELS.listRuns ? { ok: true, value: runs('running') } : { ok: true, value: [] }) });
    expect(await call(slow.tools, 'wait_run', { timeoutMs: 1000 })).toEqual({ text: { runId: 'new', status: 'running', timedOut: true } });
    await expect(call(fakeHost({ invoke: async () => ({ ok: true, value: [] }) }).tools, 'wait_run')).rejects.toThrow('No hay ninguna ejecución');
  });

  it('[R82.15][R82.16] logs con tope y reload esperan a la app', async () => {
    const reload = vi.fn(async () => undefined);
    const { tools } = fakeHost({ reload });
    expect(((await call(tools, 'logs', { limit: 999 })) as { text: string[] }).text).toHaveLength(200);
    expect(((await call(tools, 'logs')) as { text: string[] }).text).toHaveLength(50);
    await call(tools, 'reload');
    expect(reload).toHaveBeenCalledOnce();
    const log = new ConsoleLog(3);
    for (const l of ['a', 'b', 'c', 'd']) log.add(l);
    expect(log.last(10).map((l) => l.split(' ')[1])).toEqual(['b', 'c', 'd']);
    expect(consoleEntry([{ level: 'error', message: 'x' }])).toEqual({ level: 'error', message: 'x' });
    expect(consoleEntry([{}, 2, 'aviso'])).toEqual({ level: 'warning', message: 'aviso' });
  });
});

describe('SPEC-082 · puente con la interfaz', () => {
  it('[R82.17] responde con lo que dice la interfaz, falla con su error y corta por tiempo', async () => {
    vi.useFakeTimers();
    try {
      const sent: { id: string }[] = [];
      const bridge = new RendererBridge((c) => (sent.push(c), true));
      const ok = bridge.call('ui_snapshot', {}, 1000);
      bridge.reply({ id: sent[0]!.id, ok: true, result: 'pantalla' });
      expect(await ok).toBe('pantalla');
      const bad = bridge.call('ui_click', {}, 1000);
      bridge.reply({ id: sent[1]!.id, ok: false, result: 'No encuentro el botón' });
      await expect(bad).rejects.toThrow('No encuentro el botón');
      bridge.reply({ id: 'desconocido', ok: true, result: 1 });
      bridge.reply('basura');
      const slow = bridge.call('ui_wait', {}, 1000);
      const caught = expect(slow).rejects.toThrow('La interfaz no respondió en 1 s.');
      await vi.advanceTimersByTimeAsync(1001);
      await caught;
      await expect(new RendererBridge(() => false).call('x', {}, 10)).rejects.toThrow('No hay ventana');
    } finally {
      vi.useRealTimers();
    }
  });

  it('[R82.16] al estar lista, lo pendiente falla y quien esperaba sigue', async () => {
    const bridge = new RendererBridge(() => true);
    const pending = bridge.call('ui_snapshot', {}, 60_000);
    const ready = bridge.nextReady(1000);
    bridge.ready();
    await expect(pending).rejects.toThrow('La interfaz se recargó.');
    await expect(ready).resolves.toBeUndefined();
  });

  it('[R82.11] la cola de diálogos responde una vez y después vuelve el diálogo real', async () => {
    const q = new DialogQueue();
    const real = vi.fn(async () => 'real');
    q.push(['C:/a']);
    q.push([]);
    expect(await q.one(real)).toBe('C:/a');
    expect(await q.many(async () => ['real'])).toBeNull();
    expect(await q.one(real)).toBe('real');
    q.push(['x', 'y']);
    expect(await q.many(async () => null)).toEqual(['x', 'y']);
  });

  it('[R82.7] el preload del modo prueba solo usa sus tres canales', () => {
    const send = vi.fn();
    const listeners: string[] = [];
    const bridge = buildTestBridge(send, (channel, l) => (listeners.push(channel), l({ id: '1', tool: 'app_state', args: {} }), () => undefined));
    const got: unknown[] = [];
    bridge.onCall((c) => got.push(c));
    bridge.reply({ id: '1', ok: true, result: 2 });
    bridge.ready();
    expect(listeners).toEqual([TEST_CALL_CHANNEL]);
    expect(got).toEqual([{ id: '1', tool: 'app_state', args: {} }]);
    expect(send.mock.calls).toEqual([[TEST_REPLY_CHANNEL, { id: '1', ok: true, result: 2 }], [TEST_READY_CHANNEL]]);
    const preload = readFileSync(join(__dirname, '../src/preload/preload.ts'), 'utf8');
    expect(preload).toContain("if (process.argv.includes(TEST_ARG))");
  });
});

describe('SPEC-082 · desarrollo', () => {
  it('[R82.18] hay script para arrancar en modo prueba y guía para conectar Claude Code', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../../../package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['start:test']).toContain('--test-mcp');
    const doc = join(__dirname, '../../../docs/07-modo-prueba.md');
    expect(existsSync(doc)).toBe(true);
    expect(readFileSync(doc, 'utf8')).toContain('claude mcp add --transport http');
  });
});
