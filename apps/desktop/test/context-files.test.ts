import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHANNELS } from '@orquestador/editor';
import { createDemoOrchestrator } from '@orquestador/runtime';
import { DesktopHandlers } from '../src/main/handlers';

let dir: string;
let picks: (string | null)[];
let refPicks: (string[] | null)[];
let h: DesktopHandlers;
const value = <T,>(r: { ok: boolean }) => (r as unknown as { value: T }).value;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orq-ctxfiles-'));
  picks = [];
  refPicks = [];
  h = new DesktopHandlers({ pickFolder: async () => picks.shift() ?? null, pickSkillFiles: async () => refPicks.shift() ?? null, createOrchestrator: createDemoOrchestrator });
});
afterEach(() => rm(dir, { recursive: true, force: true }));

async function open() {
  picks.push(join(dir, 'proy'));
  await h.invoke(CHANNELS.createProject, undefined);
}
async function source(files: Record<string, string | Buffer>) {
  const root = await mkdtemp(join(dir, 'src-'));
  for (const [p, data] of Object.entries(files)) {
    await mkdir(join(root, p, '..'), { recursive: true });
    await writeFile(join(root, p), data);
  }
  return root;
}

describe('SPEC-022 · archivos de contexto', () => {
  it('[R22.14] un archivo guarda su ruta; varios o una carpeta apuntan a la carpeta', async () => {
    await open();
    const src = await source({ 'nota.md': 'hola', 'otra.md': 'adiós' });
    refPicks.push([join(src, 'nota.md')]);
    const one = value<{ value: string; files: number }>(await h.invoke(CHANNELS.addContextFiles, { id: 'guia', kind: 'files' }));
    expect(one).toMatchObject({ value: '.orquestador/context-files/guia/archivos/nota.md', files: 1 });
    refPicks.push([join(src, 'otra.md')]);
    const two = value<{ value: string; files: number }>(await h.invoke(CHANNELS.addContextFiles, { id: 'guia', kind: 'files' }));
    expect(two).toMatchObject({ value: '.orquestador/context-files/guia/archivos', files: 2 });
    expect(JSON.stringify(two)).not.toContain(dir);
  });

  it('[R22.14] una carpeta se copia con su estructura', async () => {
    await open();
    const src = await source({ 'sub/uno.md': '# uno', 'sub/dos/tres.md': '# tres' });
    refPicks.push([src]);
    const r = value<{ value: string; files: number }>(await h.invoke(CHANNELS.addContextFiles, { id: 'codigo', kind: 'folder' }));
    expect(r).toMatchObject({ value: '.orquestador/context-files/codigo/archivos', files: 2 });
    await expect(access(join(dir, 'proy', '.orquestador', 'context-files', 'codigo', 'archivos', src.split(/[\\/]/).pop()!, 'sub', 'uno.md'))).resolves.toBeUndefined();
  });

  it('[R22.14] un nombre repetido no se sobrescribe y cancelar devuelve null', async () => {
    await open();
    const src = await source({ 'nota.md': 'hola' });
    refPicks.push([join(src, 'nota.md')], [join(src, 'nota.md')]);
    await h.invoke(CHANNELS.addContextFiles, { id: 'guia', kind: 'files' });
    const again = value<{ renamed: number }>(await h.invoke(CHANNELS.addContextFiles, { id: 'guia', kind: 'files' }));
    expect(again.renamed).toBe(1);
    expect(value(await h.invoke(CHANNELS.addContextFiles, { id: 'guia', kind: 'files' }))).toBeNull();
  });

  it('[R22.14] respeta los límites y rechaza ids con rutas o tipos desconocidos', async () => {
    await open();
    expect(await h.invoke(CHANNELS.addContextFiles, { id: '../x', kind: 'files' })).toMatchObject({ ok: false, error: { code: 'bad-request' } });
    expect(await h.invoke(CHANNELS.addContextFiles, { id: 'guia', kind: 'raro' })).toMatchObject({ ok: false });
    const src = await source({ 'enorme.bin': Buffer.alloc(2 * 1024 * 1024 + 1, 1) });
    refPicks.push([join(src, 'enorme.bin')]);
    expect(await h.invoke(CHANNELS.addContextFiles, { id: 'guia', kind: 'files' })).toMatchObject({ ok: false, error: { code: 'invalid' } });
  });

  it('[R22.15] borrar el contexto borra también sus archivos subidos', async () => {
    await open();
    await h.invoke(CHANNELS.saveContext, { id: 'guia', schemaVersion: 1, name: 'Guía', kind: 'file', value: '.orquestador/context-files/guia/archivos' });
    const src = await source({ 'nota.md': 'hola' });
    refPicks.push([join(src, 'nota.md')]);
    await h.invoke(CHANNELS.addContextFiles, { id: 'guia', kind: 'files' });
    const uploaded = join(dir, 'proy', '.orquestador', 'context-files', 'guia');
    await expect(access(uploaded)).resolves.toBeUndefined();
    await h.invoke(CHANNELS.deleteContext, 'guia');
    await expect(access(uploaded)).rejects.toThrow();
  });
});
