import { promises as fs } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { emptyLibraryFolders, moveToFolder } from '@orquestador/core';
import { ProjectStore, StoreError } from '../src';
import { cleanupTmp, tmp } from './helpers';

cleanupTmp();

describe('SPEC-038 · carpetas de la biblioteca en disco', () => {
  it('[R38.13] se guardan en .orquestador/library.json; sin archivo o roto, todo va en la raíz', async () => {
    const p = await ProjectStore.create(await tmp(), { name: 'P' });
    expect(await p.getLibraryFolders()).toEqual(emptyLibraryFolders());
    const saved = await p.saveLibraryFolders(moveToFolder(emptyLibraryFolders(), 'skills', 'pixel', 'Arte/Píxel'));
    expect(saved.kinds.skills).toEqual({ folders: ['Arte', 'Arte/Píxel'], items: { pixel: 'Arte/Píxel' } });
    expect(await p.getLibraryFolders()).toEqual(saved);
    expect(JSON.parse(await fs.readFile(p.paths.libraryFile, 'utf8'))).toMatchObject({ schemaVersion: 1 });
    await fs.writeFile(p.paths.libraryFile, '{roto');
    expect(await p.getLibraryFolders()).toEqual(emptyLibraryFolders());
    const tooMany = emptyLibraryFolders();
    tooMany.kinds.mcp.folders = Array.from({ length: 201 }, (_, i) => `c${i}`);
    await expect(p.saveLibraryFolders(tooMany)).rejects.toBeInstanceOf(StoreError);
  });
});
