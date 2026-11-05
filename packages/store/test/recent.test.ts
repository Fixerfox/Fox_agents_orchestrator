import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RECENT_LIMIT, folderLabel, forgetRecent, normalizeRecents, recentId, touchRecent } from '@orquestador/core';
import { RecentStore } from '../src';

let dir: string;
let clock: number;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orq-recent-'));
  clock = Date.parse('2026-11-05T10:00:00Z');
});
afterEach(() => rm(dir, { recursive: true, force: true }));
const store = () => new RecentStore(dir, () => new Date((clock += 1000)));

describe('SPEC-028 · proyectos recientes (núcleo)', () => {
  it('[R28.2] el id es estable por carpeta, no depende de barras ni mayúsculas y no revela la ruta', () => {
    expect(recentId('D:\\Juegos\\Sprites')).toBe(recentId('d:/juegos/sprites/'));
    expect(recentId('D:/Juegos/A')).not.toBe(recentId('D:/Juegos/B'));
    expect(recentId('D:/Juegos/Sprites')).toMatch(/^p[0-9a-f]{16}$/);
  });

  it('[R28.2] el más reciente va primero, sin duplicados y con máximo', () => {
    let list = touchRecent([], { root: '/a', name: 'A' }, new Date('2026-01-01'));
    list = touchRecent(list, { root: '/b', name: 'B' }, new Date('2026-01-02'));
    list = touchRecent(list, { root: '/A/', name: 'A2' }, new Date('2026-01-03'));
    expect(list.map((r) => r.name)).toEqual(['A2', 'B']);
    for (let i = 0; i < 15; i++) list = touchRecent(list, { root: `/p${i}`, name: `P${i}` }, new Date());
    expect(list).toHaveLength(RECENT_LIMIT);
    expect(list[0]!.name).toBe('P14');
  });

  it('[R28.4] olvidar quita solo ese elemento', () => {
    const list = touchRecent(touchRecent([], { root: '/a', name: 'A' }, new Date()), { root: '/b', name: 'B' }, new Date());
    expect(forgetRecent(list, recentId('/a')).map((r) => r.name)).toEqual(['B']);
    expect(forgetRecent(list, 'nada')).toHaveLength(2);
  });

  it('[R28.2] lo inválido se descarta al leer', () => {
    const ok = { root: '/a', name: 'A', openedAt: '2026-01-01T00:00:00Z' };
    expect(normalizeRecents({ items: [ok, ok, { root: 1 }, null, 'x', { root: '', name: 'X', openedAt: 'y' }] }).map((r) => r.name)).toEqual(['A']);
    expect(normalizeRecents(undefined)).toEqual([]);
    expect(normalizeRecents('roto')).toEqual([]);
  });

  it('[R28.3] la etiqueta de carpeta nunca es una ruta absoluta', () => {
    expect(folderLabel('D:\\FixerfoxGames\\Juegos\\Sprites')).toBe('Juegos / Sprites');
    expect(folderLabel('/Sprites')).toBe('Sprites');
    expect(folderLabel('D:\\Juegos\\Sprites')).not.toContain('D:');
  });
});

describe('SPEC-028 · proyectos recientes (almacén)', () => {
  it('[R28.2] guarda en recent.json, recupera el orden y ordena al volver a abrir', async () => {
    const s = store();
    expect(await s.list()).toEqual([]);
    await s.touch('/a', 'A');
    await s.touch('/b', 'B');
    await s.touch('/a', 'A');
    expect((await store().list()).map((r) => r.name)).toEqual(['A', 'B']);
    expect((await s.find(recentId('/b')))?.root).toBe('/b');
  });

  it('[R28.2] un archivo dañado equivale a una lista vacía y se puede seguir guardando', async () => {
    await writeFile(join(dir, 'recent.json'), '{ no es json');
    const s = store();
    expect(await s.list()).toEqual([]);
    await s.touch('/a', 'A');
    expect(await s.list()).toHaveLength(1);
  });

  it('[R28.4] olvidar devuelve si había algo que quitar', async () => {
    const s = store();
    await s.touch('/a', 'A');
    expect(await s.forget(recentId('/a'))).toBe(true);
    expect(await s.forget(recentId('/a'))).toBe(false);
    expect(await s.list()).toEqual([]);
  });
});
