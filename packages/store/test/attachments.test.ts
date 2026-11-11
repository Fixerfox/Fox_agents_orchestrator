import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProjectStore, safeFileName } from '../src';
import { cleanupTmp, tmp } from './helpers';

cleanupTmp();

describe('SPEC-048 · adjuntos de la entrada en el proyecto', () => {
  it('[R48.4] guarda el adjunto con un nombre seguro y da su ruta relativa a la carpeta de trabajo', async () => {
    const root = await tmp();
    const store = await ProjectStore.create(root, { name: 'p' });
    const a = await store.stageAttachment('C:\\Users\\yo\\boceto final?.PNG', new Uint8Array([9, 9]));
    expect(a).toMatchObject({ name: 'boceto final_.PNG', size: 2, image: true });
    expect(await store.attachmentInputPath(a.id)).toBe(`.orquestador/attachments/${a.id}/boceto final_.PNG`);
    expect(await fs.readFile(path.join(root, '.orquestador', 'attachments', a.id, 'boceto final_.PNG'))).toEqual(Buffer.from([9, 9]));
    // En un proyecto antiguo con la carpeta de trabajo aparte, la ruta es relativa a ella [R96.4].
    const work = await tmp();
    await fs.writeFile(store.paths.workFolderFile, JSON.stringify({ schemaVersion: 1, path: work }));
    expect(await store.attachmentInputPath(a.id)).toBe(path.relative(work, path.join(root, '.orquestador', 'attachments', a.id, 'boceto final_.PNG')).split(path.sep).join('/'));
    await expect(store.stageAttachment('vacio.txt', new Uint8Array(0))).rejects.toThrow(/vacío/);
    await expect(store.stageAttachment('grande.bin', new Uint8Array(20 * 1024 * 1024 + 1))).rejects.toThrow(/20 MB/);
    await expect(store.attachmentInputPath('no-existe')).rejects.toThrow(/ya no existe/);
    await expect(store.attachmentInputPath('../x')).rejects.toThrow();
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('...')).toBe('adjunto');
    expect(safeFileName('a\u0001b.txt')).toBe('a_b.txt');
  });

  it('[R48.4] los archivos del proyecto tienen que existir dentro de la carpeta de trabajo y fuera de lo reservado', async () => {
    const root = await tmp();
    const store = await ProjectStore.create(root, { name: 'p' });
    await fs.mkdir(path.join(root, 'docs'), { recursive: true });
    await fs.writeFile(path.join(root, 'docs', 'plan.md'), 'hola');
    await fs.mkdir(path.join(root, '.git'), { recursive: true });
    await fs.writeFile(path.join(root, '.git', 'config'), 'x');
    expect(await store.inputFiles(['docs/plan.md', 'docs\\plan.md'])).toEqual([
      { path: 'docs/plan.md', size: 4, image: false },
      { path: 'docs/plan.md', size: 4, image: false },
    ]);
    await expect(store.inputFiles(['../fuera.md'])).rejects.toThrow(/no es un archivo del proyecto/);
    await expect(store.inputFiles(['.git/config'])).rejects.toThrow(/no es un archivo del proyecto/);
    await expect(store.inputFiles(['.orquestador/project.json'])).rejects.toThrow(/no es un archivo del proyecto/);
    await expect(store.inputFiles(['docs/no.md'])).rejects.toThrow(/no existe/);
    await expect(store.inputFiles(['docs'])).rejects.toThrow(/no es un archivo/);
    expect(await store.inputBase()).toBe(root);
  });
});
