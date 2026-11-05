import path from 'node:path';
import { RECENT_SCHEMA_VERSION, forgetRecent, normalizeRecents, touchRecent, type RecentProject } from '@orquestador/core';
import { StoreError } from './errors';
import { readVersioned, writeVersioned, type VersionedSpec } from './versioned-json';

const recentSpec: VersionedSpec = { kind: 'recientes', current: RECENT_SCHEMA_VERSION };

/** Proyectos recientes en la carpeta de datos de la app [R28.2]. */
export class RecentStore {
  constructor(
    readonly dir: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get file(): string {
    return path.join(this.dir, 'recent.json');
  }

  /** Lista el más reciente primero; un archivo ausente o dañado es una lista vacía. */
  async list(): Promise<RecentProject[]> {
    try {
      return normalizeRecents((await readVersioned<{ items: unknown[] }>(this.file, recentSpec)).data);
    } catch (err) {
      if (err instanceof StoreError && (err.code === 'not-found' || err.code === 'corrupt')) return [];
      throw err;
    }
  }

  private async save(items: RecentProject[]): Promise<void> {
    await writeVersioned(this.file, { schemaVersion: RECENT_SCHEMA_VERSION, items }, recentSpec);
  }

  async touch(root: string, name: string): Promise<void> {
    await this.save(touchRecent(await this.list(), { root, name }, this.now()));
  }

  async forget(id: string): Promise<boolean> {
    const list = await this.list();
    const next = forgetRecent(list, id);
    if (next.length === list.length) return false;
    await this.save(next);
    return true;
  }

  async find(id: string): Promise<RecentProject | undefined> {
    return (await this.list()).find((r) => r.id === id);
  }
}
