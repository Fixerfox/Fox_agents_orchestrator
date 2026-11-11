import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newMcpServer, type Diagram } from '@orquestador/core';
import { CHANNELS } from '@orquestador/editor';
import { createDemoOrchestrator } from '@orquestador/runtime';
import { McpSecretVault, RecentStore } from '@orquestador/store';
import { DesktopHandlers } from '../src/main/handlers';

let dir: string;
let old: string;
let work: string;
let picked: string;
let h: DesktopHandlers;
let recents: RecentStore;

const cipher = { available: () => true, encrypt: (s: string) => Buffer.from(`c:${s}`), decrypt: (b: Buffer) => b.toString().slice(2) };
const val = <T,>(r: unknown) => {
  const x = r as { ok: boolean; value?: T; error?: unknown };
  if (!x.ok) throw new Error(JSON.stringify(x.error));
  return x.value as T;
};
const exists = (p: string) => fs.stat(p).then(() => true, () => false);

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'orq-una-carpeta-'));
  old = join(dir, 'proyecto-orq');
  work = join(dir, 'mi-juego');
  await fs.mkdir(work, { recursive: true });
  await fs.writeFile(join(work, 'README.md'), '# Mi juego');
  picked = old;
  recents = new RecentStore(join(dir, 'config'));
  h = new DesktopHandlers({
    pickFolder: async () => picked,
    createOrchestrator: createDemoOrchestrator,
    recents,
    mcpVault: new McpSecretVault(join(dir, 'config'), cipher),
  });
});
afterEach(async () => {
  h.dispose();
  await fs.rm(dir, { recursive: true, force: true });
});

const flow: Diagram = {
  id: 'flujo',
  name: 'Flujo',
  schemaVersion: 1,
  nodes: [
    { id: 'entry', kind: 'entry' },
    { id: 'output', kind: 'output' },
  ],
  edges: [{ id: 'e1', from: 'entry', to: 'output' }],
};

/** Proyecto antiguo: `.orquestador` en `proyecto-orq` y carpeta de trabajo en `mi-juego`. */
async function openLegacy() {
  val(await h.invoke(CHANNELS.createProject, undefined));
  await fs.writeFile(join(old, '.orquestador', 'work-folder.json'), JSON.stringify({ schemaVersion: 1, path: work }));
}

describe('SPEC-096 · una sola carpeta por IPC', () => {
  it('[R96.2] getWorkFolder da la carpeta del proyecto; en un proyecto antiguo, la de trabajo con `separate`', async () => {
    val(await h.invoke(CHANNELS.createProject, undefined));
    expect(val(await h.invoke(CHANNELS.getWorkFolder, undefined))).toEqual({ name: 'proyecto-orq', files: 0 });
    await fs.writeFile(join(old, '.orquestador', 'work-folder.json'), JSON.stringify({ schemaVersion: 1, path: work }));
    const view = val(await h.invoke(CHANNELS.getWorkFolder, undefined));
    expect(view).toEqual({ name: 'mi-juego', files: 1, separate: true });
    expect(JSON.stringify(view)).not.toContain(dir);
  });

  it('[R96.5][R96.7] unir abre el proyecto en la carpeta de trabajo y lleva allí recientes y secretos MCP', async () => {
    await openLegacy();
    val(await h.invoke(CHANNELS.saveMcp, { ...newMcpServer('pixel', 'Pixel'), command: 'npx', secretNames: ['API_KEY'] }));
    val(await h.invoke(CHANNELS.setMcpSecret, { id: 'pixel', name: 'API_KEY', value: 'k-123' }));
    expect(val<{ name: string }>(await h.invoke(CHANNELS.joinWorkFolder, undefined))).toEqual({ name: 'proyecto-orq' });
    expect(await exists(join(work, '.orquestador', 'project.json'))).toBe(true);
    expect(await exists(join(old, '.orquestador.unido', 'project.json'))).toBe(true);
    expect(val(await h.invoke(CHANNELS.getWorkFolder, undefined))).toEqual({ name: 'mi-juego', files: 1 });
    // El MCP sigue ahí y conserva su secreto con la carpeta nueva.
    const mcp = val<{ id: string; secretsSet: string[] }[]>(await h.invoke(CHANNELS.listMcp, undefined));
    expect(mcp.find((m) => m.id === 'pixel')?.secretsSet).toEqual(['API_KEY']);
    expect((await recents.list()).map((r) => r.root)).toEqual([work]);
    // Ya unido, no hay nada más que unir.
    expect(await h.invoke(CHANNELS.joinWorkFolder, undefined)).toMatchObject({ ok: false, error: { message: expect.stringMatching(/no hay nada que unir/) } });
  });

  it('[R96.6] si el destino ya tiene .orquestador no se une, se explica y el proyecto sigue abierto donde estaba', async () => {
    await openLegacy();
    await fs.mkdir(join(work, '.orquestador'));
    expect(await h.invoke(CHANNELS.joinWorkFolder, undefined)).toMatchObject({ ok: false, error: { message: expect.stringMatching(/ya tiene su propio \.orquestador/) } });
    expect(val(await h.invoke(CHANNELS.getWorkFolder, undefined))).toMatchObject({ separate: true });
    expect((await recents.list()).map((r) => r.root)).toEqual([old]);
  });

  it('[R96.6] con una ejecución en marcha no se une', async () => {
    await openLegacy();
    val(await h.invoke(CHANNELS.saveDiagram, flow));
    val(await h.invoke(CHANNELS.startRun, { diagramId: 'flujo', order: 'x' }));
    expect(await h.invoke(CHANNELS.joinWorkFolder, undefined)).toMatchObject({ ok: false, error: { message: expect.stringMatching(/ejecuciones en marcha/) } });
    expect(await exists(join(work, '.orquestador'))).toBe(false);
  });

  it('[R96.9][R96.10][R96.11] la opción de git se lee y se cambia sobre el .gitignore de la carpeta del proyecto', async () => {
    picked = work;
    val(await h.invoke(CHANNELS.createProject, undefined));
    expect(val(await h.invoke(CHANNELS.getGitIgnore, undefined))).toEqual({ available: false, exists: false, mode: 'shared' });
    await fs.writeFile(join(work, '.gitignore'), 'dist\n');
    expect(val(await h.invoke(CHANNELS.getGitIgnore, undefined))).toEqual({ available: true, exists: true, mode: 'shared' });
    expect(val(await h.invoke(CHANNELS.setGitIgnore, 'all'))).toEqual({ available: true, exists: true, mode: 'all' });
    expect(await fs.readFile(join(work, '.gitignore'), 'utf8')).toMatch(/^dist\n# Orquestador.*\n\.orquestador\/\n$/);
    expect(val(await h.invoke(CHANNELS.setGitIgnore, 'shared'))).toMatchObject({ mode: 'shared' });
    expect(await fs.readFile(join(work, '.gitignore'), 'utf8')).toBe('dist\n');
  });

  it('[R96.12] el contrato valida el modo y rechaza argumentos de más; sin proyecto lo explica', async () => {
    expect(await h.invoke(CHANNELS.getGitIgnore, undefined)).toMatchObject({ ok: false });
    expect(await h.invoke(CHANNELS.setGitIgnore, 'all')).toMatchObject({ ok: false });
    expect(await h.invoke(CHANNELS.joinWorkFolder, undefined)).toMatchObject({ ok: false });
    val(await h.invoke(CHANNELS.createProject, undefined));
    for (const bad of ['todo', '', undefined, { mode: 'all' }, ['all']]) expect(await h.invoke(CHANNELS.setGitIgnore, bad)).toMatchObject({ ok: false, error: { code: 'bad-request' } });
    expect(await h.invoke(CHANNELS.getGitIgnore, { path: '/etc' })).toMatchObject({ ok: false, error: { code: 'bad-request' } });
    expect(await h.invoke(CHANNELS.joinWorkFolder, '/etc')).toMatchObject({ ok: false, error: { code: 'bad-request' } });
    expect(await exists(join(old, '.gitignore'))).toBe(false);
  });
});
