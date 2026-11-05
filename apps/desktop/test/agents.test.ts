import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newAgent, newContext, defaultSettings, type AppSettings } from '@orquestador/core';
import { CHANNELS, parseRequest } from '@orquestador/editor';
import { createDemoOrchestrator } from '@orquestador/runtime';
import { ApiKeyVault, SettingsStore } from '@orquestador/store';
import { DesktopHandlers } from '../src/main/handlers';

let dir: string;
let picks: (string | null)[];
let h: DesktopHandlers;
let seen: AppSettings[];

const cipher = (on = true) => ({
  available: () => on,
  encrypt: (s: string) => Buffer.from(`cifrado:${s}`),
  decrypt: (b: Buffer) => b.toString().replace('cifrado:', ''),
});

function make(on = true): DesktopHandlers {
  return new DesktopHandlers({
    pickFolder: async () => picks.shift() ?? null,
    createOrchestrator: (ctx) => (seen.push(ctx.settings()), createDemoOrchestrator()),
    settings: new SettingsStore(join(dir, 'config')),
    vault: new ApiKeyVault(join(dir, 'config'), cipher(on)),
  });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orq-agents-'));
  picks = [];
  seen = [];
  h = make();
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const value = <T,>(r: { ok: boolean }) => (r as unknown as { value: T }).value;
async function open() {
  picks.push(join(dir, 'proy'));
  await h.invoke(CHANNELS.createProject, undefined);
}

describe('SPEC-022 · IPC de agentes y contextos', () => {
  it('[R22.5] sin proyecto abierto las operaciones fallan con un error claro', async () => {
    expect(await h.invoke(CHANNELS.listAgents, undefined)).toMatchObject({ ok: false, error: { code: 'not-found' } });
  });

  it('[R22.5] guardar, listar y borrar agentes y contextos', async () => {
    await open();
    expect(await h.invoke(CHANNELS.saveContext, { ...newContext('guia', 'Guía'), value: 'Texto' })).toMatchObject({ ok: true });
    expect(await h.invoke(CHANNELS.saveAgent, { ...newAgent('pintor', 'Pintor'), contextIds: ['guia'] })).toMatchObject({ ok: true });
    expect(value<{ id: string }[]>(await h.invoke(CHANNELS.listAgents, undefined)).map((a) => a.id)).toEqual(['pintor']);
    expect(value(await h.invoke(CHANNELS.contextUsage, 'guia'))).toEqual([{ agentId: 'pintor', name: 'Pintor' }]);
    expect(value(await h.invoke(CHANNELS.deleteContext, 'guia'))).toBe(true);
    expect(value<{ contextIds: string[] }[]>(await h.invoke(CHANNELS.listAgents, undefined))[0]!.contextIds).toEqual([]);
    expect(value(await h.invoke(CHANNELS.deleteAgent, 'pintor'))).toBe(true);
  });

  it('[R22.5] un agente inválido devuelve los campos con problema, sin rutas', async () => {
    await open();
    const r = await h.invoke(CHANNELS.saveAgent, { ...newAgent('x', ' ') });
    expect(r).toMatchObject({ ok: false, error: { code: 'invalid' } });
    expect((r as { error: { fields: { field: string }[] } }).error.fields.map((f) => f.field)).toContain('name');
  });

  it('[R22.5] la petición se valida: campos extra, ids con «..» y tipos erróneos', () => {
    const a = newAgent('a', 'A');
    expect(() => parseRequest(CHANNELS.saveAgent, { ...a, extra: 1 })).toThrow();
    expect(() => parseRequest(CHANNELS.saveAgent, { ...a, id: '../x' })).toThrow();
    expect(() => parseRequest(CHANNELS.saveAgent, { ...a, contextIds: ['../x'] })).toThrow();
    expect(() => parseRequest(CHANNELS.deleteContext, '../x')).toThrow();
    expect(() => parseRequest(CHANNELS.saveContext, { ...newContext('c', 'C'), kind: 'otro' })).toThrow();
    expect(parseRequest(CHANNELS.saveAgent, a)).toBe(a);
  });
});

describe('SPEC-023 · IPC de ajustes', () => {
  it('[R23.4] los ajustes se guardan en la carpeta de datos y se recuperan', async () => {
    const s: AppSettings = { ...defaultSettings(), maxParallel: 6, authMode: 'api-key' };
    expect(await h.invoke(CHANNELS.saveSettings, s)).toMatchObject({ ok: true, value: { maxParallel: 6, apiKeyStored: false } });
    expect(value<AppSettings>(await make().invoke(CHANNELS.getSettings, undefined)).authMode).toBe('api-key');
  });

  it('[R23.4] ajustes inválidos se rechazan con el campo', async () => {
    const r = await h.invoke(CHANNELS.saveSettings, { ...defaultSettings(), maxParallel: 99 });
    expect(r).toMatchObject({ ok: false, error: { code: 'invalid', fields: [{ field: 'maxParallel' }] } });
  });

  it('[R23.3] la clave nunca se devuelve: solo si existe; se guarda cifrada y se puede quitar', async () => {
    const r = await h.invoke(CHANNELS.setApiKey, 'sk-ant-secreta');
    expect(r).toMatchObject({ ok: true, value: { apiKeyStored: true } });
    expect(JSON.stringify(r)).not.toContain('sk-ant-secreta');
    expect(JSON.stringify(await h.invoke(CHANNELS.getSettings, undefined))).not.toContain('sk-ant-secreta');
    const files = await readdir(join(dir, 'config'));
    for (const f of files) expect(await readFile(join(dir, 'config', f), 'utf8')).not.toContain('sk-ant-secreta');
    expect(await h.invoke(CHANNELS.clearApiKey, undefined)).toMatchObject({ ok: true, value: { apiKeyStored: false } });
  });

  it('[R23.3] claves inválidas o sin cifrado se rechazan sin eco de la clave', async () => {
    expect(await h.invoke(CHANNELS.setApiKey, 'con espacio')).toMatchObject({ ok: false, error: { code: 'invalid' } });
    const sin = make(false);
    const r = await sin.invoke(CHANNELS.setApiKey, 'sk-ant-1');
    expect(r).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(JSON.stringify(r)).not.toContain('sk-ant-1');
  });

  it('[R23.6] el orquestador se crea con los ajustes guardados', async () => {
    await h.invoke(CHANNELS.saveSettings, { ...defaultSettings(), maxParallel: 2 });
    await open();
    expect(seen.at(-1)?.maxParallel).toBe(2);
  });
});

describe('SPEC-035 · IPC del diagrama de una ejecución [R35.16]', () => {
  it('[R35.16] run:diagram valida el id y devuelve null si la ejecución no guardó copia', async () => {
    await open();
    expect(await h.invoke(CHANNELS.runDiagram, '../fuera')).toMatchObject({ ok: false });
    expect(await h.invoke(CHANNELS.runDiagram, { runId: 'x' })).toMatchObject({ ok: false });
    expect(await h.invoke(CHANNELS.runDiagram, 'sin-copia')).toEqual({ ok: true, value: null });
    expect(() => parseRequest(CHANNELS.runDiagram, 'abc')).not.toThrow();
  });
});
