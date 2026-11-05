import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RecentView } from '@orquestador/core';
import { CHANNELS, parseRequest } from '@orquestador/editor';
import { createDemoOrchestrator } from '@orquestador/runtime';
import { RecentStore } from '@orquestador/store';
import { DesktopHandlers } from '../src/main/handlers';

let dir: string;
let picks: (string | null)[];
let h: DesktopHandlers;

const make = () =>
  new DesktopHandlers({
    pickFolder: async () => picks.shift() ?? null,
    createOrchestrator: createDemoOrchestrator,
    recents: new RecentStore(join(dir, 'config')),
  });
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'orq-recent-ipc-'));
  picks = [];
  h = make();
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
const create = async (name: string) => {
  picks.push(join(dir, 'juegos', name));
  return val<{ name: string }>(await h.invoke(CHANNELS.createProject, undefined));
};
const recents = async () => val<RecentView[]>(await h.invoke(CHANNELS.listRecent, undefined));

describe('SPEC-028 · IPC de proyectos recientes', () => {
  it('[R28.2] crear y abrir recuerdan el proyecto, el último primero y sin duplicados', async () => {
    await create('uno');
    await create('dos');
    picks.push(join(dir, 'juegos', 'uno'));
    val(await h.invoke(CHANNELS.openProject, undefined));
    expect((await recents()).map((r) => r.name)).toEqual(['uno', 'dos']);
    expect(await fs.readFile(join(dir, 'config', 'recent.json'), 'utf8')).toContain('"schemaVersion": 1');
  });

  it('[R28.2] los recientes sobreviven a reiniciar la app', async () => {
    await create('uno');
    expect((val<RecentView[]>(await make().invoke(CHANNELS.listRecent, undefined))).map((r) => r.name)).toEqual(['uno']);
  });

  it('[R28.3] la lista no contiene rutas absolutas; solo carpeta contenedora y proyecto', async () => {
    await create('uno');
    const raw = JSON.stringify(await h.invoke(CHANNELS.listRecent, undefined));
    expect(raw).not.toContain(dir);
    expect(val<RecentView[]>(JSON.parse(raw))[0]).toMatchObject({ name: 'uno', folder: 'juegos / uno', missing: false });
  });

  it('[R28.3] abrir un reciente por su id abre el proyecto y lo sube al principio', async () => {
    await create('uno');
    await create('dos');
    const uno = (await recents()).find((r) => r.name === 'uno')!;
    expect(val<{ name: string }>(await h.invoke(CHANNELS.openRecent, { id: uno.id })).name).toBe('uno');
    expect((await recents())[0]!.name).toBe('uno');
    expect(await h.invoke(CHANNELS.listDiagrams, undefined)).toMatchObject({ ok: true });
  });

  it('[R28.3] si la carpeta desapareció se marca como no encontrada y abrirla falla con un mensaje sin rutas', async () => {
    await create('uno');
    await fs.rm(join(dir, 'juegos', 'uno'), { recursive: true, force: true });
    const [r] = await recents();
    expect(r).toMatchObject({ name: 'uno', missing: true });
    const res = await h.invoke(CHANNELS.openRecent, { id: r!.id });
    expect(res).toMatchObject({ ok: false, error: { code: 'not-found' } });
    expect(JSON.stringify(res)).not.toContain(dir);
  });

  it('[R28.3] un id desconocido falla con claridad', async () => {
    expect(await h.invoke(CHANNELS.openRecent, { id: 'pnada' })).toMatchObject({ ok: false, error: { code: 'not-found' } });
  });

  it('[R28.4] olvidar quita el reciente de la lista y no borra nada del disco', async () => {
    await create('uno');
    const [r] = await recents();
    expect(val(await h.invoke(CHANNELS.forgetRecent, r!.id))).toBe(true);
    expect(await recents()).toEqual([]);
    expect(val(await h.invoke(CHANNELS.forgetRecent, r!.id))).toBe(false);
    await expect(fs.stat(join(dir, 'juegos', 'uno', '.orquestador'))).resolves.toBeTruthy();
  });

  it('[R28.7] cerrar el proyecto deja la app sin proyecto', async () => {
    await create('uno');
    expect(val(await h.invoke(CHANNELS.closeProject, undefined))).toBeNull();
    expect(await h.invoke(CHANNELS.listDiagrams, undefined)).toMatchObject({ ok: false, error: { code: 'not-found' } });
    expect((await recents()).map((r) => r.name)).toEqual(['uno']);
  });

  it('[R28.7] cerrar cancela las ejecuciones en curso', async () => {
    await create('uno');
    val(await h.invoke(CHANNELS.saveDiagram, {
      id: 'f', name: 'F', schemaVersion: 1,
      nodes: [{ id: 'entry', kind: 'entry' }, { id: 'c', kind: 'agent', agentId: 'creador' }, { id: 'output', kind: 'output' }],
      edges: [{ id: 'e1', from: 'entry', to: 'c' }, { id: 'e2', from: 'c', to: 'output' }],
    }));
    val(await h.invoke(CHANNELS.startRun, { diagramId: 'f', order: 'x' }));
    await h.invoke(CHANNELS.closeProject, undefined);
    expect(await h.invoke(CHANNELS.listRuns, undefined)).toMatchObject({ ok: false });
  });

  it('[R28.6] las peticiones se validan: ids, campos extra y argumentos de más', () => {
    const ok = { id: 'p0123456789abcdef' };
    expect(parseRequest(CHANNELS.openRecent, ok)).toBe(ok);
    expect(() => parseRequest(CHANNELS.openRecent, { id: '../x' })).toThrow();
    expect(() => parseRequest(CHANNELS.openRecent, { id: 'p1', path: 'C:\\x' })).toThrow();
    expect(() => parseRequest(CHANNELS.openRecent, 'p1')).toThrow();
    expect(parseRequest(CHANNELS.forgetRecent, 'p1')).toBe('p1');
    expect(() => parseRequest(CHANNELS.forgetRecent, '../x')).toThrow();
    expect(() => parseRequest(CHANNELS.listRecent, { x: 1 })).toThrow();
    expect(() => parseRequest(CHANNELS.closeProject, 'x')).toThrow();
  });
});
