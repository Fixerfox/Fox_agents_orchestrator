import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHANNELS } from '@orquestador/editor';
import { createDemoOrchestrator } from '@orquestador/runtime';
import type { OrchestratorContext } from '../src/main/composition';
import { DesktopHandlers } from '../src/main/handlers';
import { fromMainFrame } from '../src/main/ipc-guard';
import { secureStorageAvailable } from '../src/main/secure-storage';
import { EXCLUDED_API_METHODS, testTools, type TestHost } from '../src/main/test-mcp/tools';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'orq-sec-c-'));
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

describe('SPEC-090 · secretos conocidos', () => {
  it('[R90.6] la clave API y los secretos MCP que se cargan pasan a secretValues', async () => {
    const ctxs: OrchestratorContext[] = [];
    const h = new DesktopHandlers({
      pickFolder: async () => join(dir, 'p'),
      createOrchestrator: (ctx) => (ctxs.push(ctx), createDemoOrchestrator()),
      vault: { read: async () => 'sk-ant-clave-de-prueba', has: async () => true } as never,
      mcpVault: { read: async () => ({ TOKEN: 'valor-secreto-mcp' }) } as never,
    });
    await h.invoke(CHANNELS.createProject, undefined);
    const ctx = ctxs.at(-1)!;
    expect(ctx.secretValues!()).toEqual([]);
    await ctx.apiKey();
    await ctx.mcpSecrets!('github');
    expect(ctx.secretValues!()).toEqual(expect.arrayContaining(['sk-ant-clave-de-prueba', 'valor-secreto-mcp']));
    h.dispose();
  });
});

describe('SPEC-090 · Linux sin llavero', () => {
  it('[R90.8] basic_text o un backend desconocido en Linux no cuentan como cifrado', () => {
    const storage = (backend: string, on = true) => ({ isEncryptionAvailable: () => on, getSelectedStorageBackend: () => backend });
    expect(secureStorageAvailable(storage('basic_text'), 'linux')).toBe(false);
    expect(secureStorageAvailable(storage('unknown'), 'linux')).toBe(false);
    expect(secureStorageAvailable(storage('gnome_libsecret'), 'linux')).toBe(true);
    expect(secureStorageAvailable(storage('kwallet5'), 'linux')).toBe(true);
    expect(secureStorageAvailable({ isEncryptionAvailable: () => true }, 'win32')).toBe(true);
    expect(secureStorageAvailable(storage('gnome_libsecret', false), 'linux')).toBe(false);
  });
});

describe('SPEC-090 · IPC y modo prueba', () => {
  it('[R90.11] solo se atiende el marco principal de la ventana', () => {
    expect(fromMainFrame({ senderFrame: { parent: null } })).toBe(true);
    expect(fromMainFrame({ senderFrame: { parent: {} } })).toBe(false);
    expect(fromMainFrame({ senderFrame: null })).toBe(false);
    expect(fromMainFrame({})).toBe(false);
  });

  it('[R90.12] call_api no deja usar las terminales', async () => {
    const host: TestHost = {
      invoke: async () => ({ ok: true, value: null }),
      renderer: async () => null,
      screenshot: async () => 'x',
      queueDialog: () => undefined,
      logs: () => [],
      reload: async () => undefined,
      sleep: async () => undefined,
    };
    const callApi = testTools(host).find((t) => t.name === 'call_api')!;
    for (const m of EXCLUDED_API_METHODS) await expect(callApi.run({ method: m })).rejects.toThrow('Método desconocido');
    expect(callApi.description).not.toContain('terminalStart');
    await expect(callApi.run({ method: 'listRuns' })).resolves.toBeDefined();
  });
});
