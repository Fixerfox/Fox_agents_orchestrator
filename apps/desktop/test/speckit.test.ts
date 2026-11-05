import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHANNELS } from '@orquestador/editor';
import { createDemoOrchestrator } from '@orquestador/runtime';
import { DesktopHandlers } from '../src/main/handlers';

let dir: string;
const value = <T,>(r: unknown) => (r as { value: T }).value;
beforeEach(async () => (dir = await mkdtemp(join(tmpdir(), 'orq-speckit-'))));
afterEach(() => rm(dir, { recursive: true, force: true }));
const handlers = (preinstallSpecKit: boolean, root: string) => new DesktopHandlers({ pickFolder: async () => root, pickImport: async () => null, createOrchestrator: createDemoOrchestrator, preinstallSpecKit });

describe('SPEC-038 · Spec Kit en proyectos nuevos y carpetas por IPC', () => {
  it('[R38.15][R38.16] un proyecto nuevo trae las skills (con plantillas y licencia) y los agentes de Spec Kit en su carpeta', async () => {
    const h = handlers(true, join(dir, 'p'));
    await h.invoke(CHANNELS.createProject, undefined);
    const skills = value<{ id: string }[]>(await h.invoke(CHANNELS.listSkills, undefined)).map((s) => s.id);
    expect(skills).toContain('speckit-specify');
    expect(skills).toHaveLength(9);
    const agents = value<{ id: string; skillIds: string[] }[]>(await h.invoke(CHANNELS.listAgents, undefined));
    expect(agents.map((a) => a.id)).toContain('speckit-planificador');
    expect(await readFile(join(dir, 'p', '.orquestador', 'skills', 'speckit-specify', 'referencias', 'spec-template.md'), 'utf8')).toMatch(/Feature Specification/);
    const folders = value<{ kinds: Record<string, { items: Record<string, string> }> }>(await h.invoke(CHANNELS.getLibraryFolders, undefined));
    expect(folders.kinds['agents']!.items['speckit-analista']).toBe('Spec Kit');
    expect(folders.kinds['skills']!.items['speckit-converge']).toBe('Spec Kit');
  });

  it('[R38.13] sin preinstalar, el proyecto queda vacío y las carpetas se guardan y validan por IPC', async () => {
    const h = handlers(false, join(dir, 'q'));
    await h.invoke(CHANNELS.createProject, undefined);
    expect(value<unknown[]>(await h.invoke(CHANNELS.listSkills, undefined))).toEqual([]);
    const doc = { schemaVersion: 1, kinds: { agents: { folders: [], items: {} }, skills: { folders: ['Arte'], items: { pix: 'Arte' } }, contexts: { folders: [], items: {} }, mcp: { folders: [], items: {} }, diagrams: { folders: [], items: {} } } };
    expect(value(await h.invoke(CHANNELS.saveLibraryFolders, doc))).toEqual(doc);
    expect(await h.invoke(CHANNELS.saveLibraryFolders, { ...doc, extra: 1 })).toMatchObject({ ok: false });
  });
});
