import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHANNELS, type SavedAssistantTabs } from '@orquestador/editor';
import { createDemoOrchestrator } from '@orquestador/runtime';
import { DesktopHandlers } from '../src/main/handlers';
import { assistantTabsFile } from '../src/main/handlers/assistant';

let dir: string;
let picks: (string | null)[];
let h: DesktopHandlers;
const tabsDir = () => join(dir, 'datos', 'assistant');

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'orq-tabs-'));
  picks = [];
  h = new DesktopHandlers({ pickFolder: async () => picks.shift() ?? null, createOrchestrator: createDemoOrchestrator, assistantTabsDir: tabsDir() });
});
afterEach(async () => {
  h.dispose();
  await fs.rm(dir, { recursive: true, force: true });
});

const doc: SavedAssistantTabs = { activeId: 'tab-1', tabs: [{ id: 'tab-1', title: 'MCP', updatedAt: 1, items: [{ kind: 'user', id: 'u1', text: 'token ghp_x' }] }] };
const open = async (name: string) => {
  picks.push(join(dir, name));
  const r = (await h.invoke(CHANNELS.createProject, undefined)) as { ok: boolean };
  expect(r.ok).toBe(true);
};

describe('SPEC-086 · pestañas guardadas por proyecto', () => {
  it('[R86.11] sin proyecto, load da null y save falla', async () => {
    expect(await h.invoke(CHANNELS.assistantTabsLoad, undefined)).toEqual({ ok: true, value: null });
    expect(((await h.invoke(CHANNELS.assistantTabsSave, doc)) as { ok: boolean }).ok).toBe(false);
  });

  it('[R86.11] se guardan en la carpeta de datos de la app (no en el proyecto), una por proyecto', async () => {
    await open('uno');
    expect(await h.invoke(CHANNELS.assistantTabsLoad, undefined)).toEqual({ ok: true, value: null });
    expect(await h.invoke(CHANNELS.assistantTabsSave, doc)).toEqual({ ok: true, value: null });
    expect(await h.invoke(CHANNELS.assistantTabsLoad, undefined)).toEqual({ ok: true, value: doc });
    const file = assistantTabsFile(tabsDir(), join(dir, 'uno'));
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual(doc);
    const inProject = await fs.readdir(join(dir, 'uno', '.orquestador'), { recursive: true });
    expect(inProject.some((f) => String(f).includes('assistant'))).toBe(false);
    await open('dos');
    expect(await h.invoke(CHANNELS.assistantTabsLoad, undefined)).toEqual({ ok: true, value: null });
  });

  it('[R86.11] la clave son 16 caracteres del SHA-256 de la carpeta; en Windows no distingue mayúsculas', () => {
    const a = assistantTabsFile('/d', String.raw`C:\Proy\Juego`, 'win32');
    expect(a).toMatch(/[0-9a-f]{16}\.json$/);
    expect(assistantTabsFile('/d', String.raw`c:\proy\juego`, 'win32')).toBe(a);
  });
});
