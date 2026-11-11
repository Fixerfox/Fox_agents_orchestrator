import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { McpSecretVault, ProjectStore, ROOT_GITIGNORE_NOTE, ignoresOrq, insideGitRepo, joinProjectIntoWorkFolder, rootGitignoreState, setRootGitignore, withOrqIgnored, withoutOrqIgnored } from '../src';
import { cleanupTmp, tmp } from './helpers';

cleanupTmp();

const exists = (p: string) => fs.stat(p).then(() => true, () => false);
/** Proyecto antiguo: `.orquestador` en una carpeta y la de trabajo en otra. */
async function legacy() {
  const root = await tmp();
  const work = path.join(await tmp(), 'mi-juego');
  await fs.mkdir(work, { recursive: true });
  const store = await ProjectStore.create(root, { name: 'Juego' });
  await fs.writeFile(store.paths.workFolderFile, JSON.stringify({ schemaVersion: 1, path: work }));
  await fs.writeFile(path.join(store.paths.orq, 'library.json'), '{"marca":1}');
  return { root, work, store };
}

describe('SPEC-096 · el proyecto es la carpeta en la que se trabaja', () => {
  it('[R96.1] la carpeta de trabajo de un proyecto nuevo es la suya, con .orquestador dentro', async () => {
    const root = await tmp();
    const store = await ProjectStore.create(root, { name: 'p' });
    expect(await store.getWorkFolder()).toBe(root);
    expect(await store.separateWorkFolder()).toBeUndefined();
    expect(await exists(path.join(root, '.orquestador', 'project.json'))).toBe(true);
    expect(store).not.toHaveProperty('setWorkFolder');
  });

  it('[R96.4] un proyecto antiguo sigue en su carpeta aparte; si apunta a sí mismo o ya no existe, se ignora', async () => {
    const { root, work, store } = await legacy();
    expect(await store.getWorkFolder()).toBe(work);
    expect(await store.separateWorkFolder()).toBe(work);
    await fs.writeFile(store.paths.workFolderFile, JSON.stringify({ schemaVersion: 1, path: root }));
    expect(await store.separateWorkFolder()).toBeUndefined();
    expect(await store.getWorkFolder()).toBe(root);
    await fs.writeFile(store.paths.workFolderFile, JSON.stringify({ schemaVersion: 1, path: path.join(root, 'no-existe') }));
    expect(await store.getWorkFolder()).toBe(root);
    await fs.writeFile(store.paths.workFolderFile, '{roto');
    expect(await store.getWorkFolder()).toBe(root);
    await fs.writeFile(store.paths.workFolderFile, JSON.stringify({ path: 'relativa' }));
    expect(await store.getWorkFolder()).toBe(root);
  });

  it('[R96.5] unir copia .orquestador a la carpeta de trabajo sin work-folder.json y aparta el antiguo sin borrarlo', async () => {
    const { root, work, store } = await legacy();
    const r = await joinProjectIntoWorkFolder(store);
    expect(r.root).toBe(work);
    expect((await r.store.info()).name).toBe('Juego');
    expect(await r.store.getWorkFolder()).toBe(work);
    expect(await fs.readFile(path.join(work, '.orquestador', 'library.json'), 'utf8')).toBe('{"marca":1}');
    expect(await exists(path.join(work, '.orquestador', 'work-folder.json'))).toBe(false);
    // El antiguo queda apartado, entero, con otro nombre.
    expect(r.kept).toBe(path.join(root, '.orquestador.unido'));
    expect(await exists(path.join(root, '.orquestador'))).toBe(false);
    expect(await fs.readFile(path.join(root, '.orquestador.unido', 'library.json'), 'utf8')).toBe('{"marca":1}');
    expect((await fs.readdir(work)).filter((n) => n.includes('uniendo'))).toEqual([]);
  });

  it('[R96.5] si ya hay un .orquestador.unido, el antiguo se aparta con un número detrás', async () => {
    const { root, store } = await legacy();
    await fs.mkdir(path.join(root, '.orquestador.unido'));
    expect((await joinProjectIntoWorkFolder(store)).kept).toBe(path.join(root, '.orquestador.unido-2'));
  });

  it('[R96.6] no se une si el destino ya tiene .orquestador o si el proyecto no tiene carpeta aparte', async () => {
    const { root, work, store } = await legacy();
    await fs.mkdir(path.join(work, '.orquestador'));
    await expect(joinProjectIntoWorkFolder(store)).rejects.toThrow(/ya tiene su propio \.orquestador/);
    expect(await exists(path.join(root, '.orquestador', 'project.json'))).toBe(true);
    const plain = await ProjectStore.create(await tmp(), { name: 'p' });
    await expect(joinProjectIntoWorkFolder(plain)).rejects.toThrow(/no hay nada que unir/);
  });

  it('[R96.6] si la copia falla a mitad, se retira lo copiado y el proyecto sigue donde estaba', async () => {
    const { root, work, store } = await legacy();
    const half = async (from: string, to: string) => {
      await fs.mkdir(to, { recursive: true });
      await fs.copyFile(path.join(from, 'project.json'), path.join(to, 'project.json'));
      throw new Error('disco lleno');
    };
    await expect(joinProjectIntoWorkFolder(store, half)).rejects.toThrow(/No se pudo unir el proyecto: disco lleno/);
    expect(await fs.readdir(work)).toEqual([]);
    expect(await store.getWorkFolder()).toBe(work);
    expect((await ProjectStore.open(root).then((s) => s.info())).name).toBe('Juego');
    // Una copia que no se puede abrir tampoco se deja en el destino.
    const broken = async (_from: string, to: string) => {
      await fs.mkdir(to, { recursive: true });
      await fs.writeFile(path.join(to, 'project.json'), '{roto');
    };
    await expect(joinProjectIntoWorkFolder(store, broken)).rejects.toThrow(/No se pudo unir/);
    expect(await fs.readdir(work)).toEqual([]);
    expect(await exists(path.join(root, '.orquestador', 'project.json'))).toBe(true);
  });

  it('[R96.7] los secretos MCP de un proyecto pasan a la clave de su carpeta nueva, sin tocar los de otros', async () => {
    const cipher = { available: () => true, encrypt: (s: string) => Buffer.from(`c:${s}`), decrypt: (b: Buffer) => b.toString().slice(2) };
    const vault = new McpSecretVault(await tmp(), cipher);
    await vault.set('aaaa:github', 'TOKEN', 'uno');
    await vault.set('aaaa:jira', 'KEY', 'dos');
    await vault.set('aaaab:otro', 'X', 'tres');
    await vault.set('app:github', 'TOKEN', 'app');
    await vault.movePrefix('aaaa', 'bbbb');
    expect(await vault.read('bbbb:github')).toEqual({ TOKEN: 'uno' });
    expect(await vault.read('bbbb:jira')).toEqual({ KEY: 'dos' });
    expect(await vault.read('aaaa:github')).toEqual({});
    expect(await vault.read('aaaab:otro')).toEqual({ X: 'tres' });
    expect(await vault.read('app:github')).toEqual({ TOKEN: 'app' });
  });
});

describe('SPEC-096 · .gitignore de la carpeta del proyecto', () => {
  it('[R96.9] la opción se ofrece con repositorio (también en una carpeta de dentro) o con .gitignore, y dice el modo', async () => {
    const root = await tmp();
    expect(await rootGitignoreState(root)).toEqual({ available: false, exists: false, mode: 'shared' });
    await fs.writeFile(path.join(root, '.gitignore'), 'node_modules/\n');
    expect(await rootGitignoreState(root)).toEqual({ available: true, exists: true, mode: 'shared' });
    const repo = await tmp();
    await fs.mkdir(path.join(repo, '.git'));
    const inner = path.join(repo, 'apps', 'juego');
    await fs.mkdir(inner, { recursive: true });
    expect(await insideGitRepo(inner)).toBe(true);
    expect(await rootGitignoreState(inner)).toEqual({ available: true, exists: false, mode: 'shared' });
    for (const line of ['.orquestador', '.orquestador/', '/.orquestador', '/.orquestador/', '  .orquestador/  ']) expect(ignoresOrq(`dist\n${line}\n`)).toBe(true);
    for (const line of ['.orquestador/runs/', '# .orquestador/', '!.orquestador/', 'x.orquestador']) expect(ignoresOrq(`${line}\n`)).toBe(false);
  });

  it('[R96.10] «No subir nada» añade comentario y .orquestador/ con los saltos del archivo; lo crea si falta y no repite', async () => {
    expect(withOrqIgnored('dist\r\nnode_modules')).toBe(`dist\r\nnode_modules\r\n${ROOT_GITIGNORE_NOTE}\r\n.orquestador/\r\n`);
    expect(withOrqIgnored('dist\n')).toBe(`dist\n${ROOT_GITIGNORE_NOTE}\n.orquestador/\n`);
    expect(withOrqIgnored('')).toBe(`${ROOT_GITIGNORE_NOTE}\n.orquestador/\n`);
    expect(withOrqIgnored('/.orquestador\n')).toBe('/.orquestador\n');
    const root = await tmp();
    await fs.mkdir(path.join(root, '.git'));
    expect(await setRootGitignore(root, 'all')).toEqual({ available: true, exists: true, mode: 'all' });
    const first = await fs.readFile(path.join(root, '.gitignore'), 'utf8');
    expect(first).toBe(`${ROOT_GITIGNORE_NOTE}\n.orquestador/\n`);
    await setRootGitignore(root, 'all');
    expect(await fs.readFile(path.join(root, '.gitignore'), 'utf8')).toBe(first);
  });

  it('[R96.11] «Compartir» quita solo esas líneas y el comentario de la app; no toca lo demás ni .orquestador/.gitignore', async () => {
    expect(withoutOrqIgnored(`dist\r\n${ROOT_GITIGNORE_NOTE}\r\n.orquestador/\r\n# mío\r\n.env\r\n`)).toBe('dist\r\n# mío\r\n.env\r\n');
    expect(withoutOrqIgnored('dist\n.orquestador/runs/\n')).toBe('dist\n.orquestador/runs/\n');
    const root = await tmp();
    const store = await ProjectStore.create(root, { name: 'p' });
    const inner = await fs.readFile(path.join(store.paths.orq, '.gitignore'), 'utf8');
    await fs.writeFile(path.join(root, '.gitignore'), 'dist\r\nnode_modules');
    await setRootGitignore(root, 'all');
    expect((await rootGitignoreState(root)).mode).toBe('all');
    expect(await setRootGitignore(root, 'shared')).toEqual({ available: true, exists: true, mode: 'shared' });
    expect(await fs.readFile(path.join(root, '.gitignore'), 'utf8')).toBe('dist\r\nnode_modules\r\n');
    expect(await fs.readFile(path.join(store.paths.orq, '.gitignore'), 'utf8')).toBe(inner);
    // «Compartir» sin .gitignore no crea ninguno.
    const bare = await tmp();
    await setRootGitignore(bare, 'shared');
    expect(await exists(path.join(bare, '.gitignore'))).toBe(false);
  });
});
