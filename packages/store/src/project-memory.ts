import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PROJECT_MEMORY_VERSION, memoryEntryProblems, memoryIndexMarkdown, redactSecrets, type MemoryEntry } from '@orquestador/core';
import { StoreError } from './errors';
import { atomicWrite } from './fs-util';
import type { ProjectPaths } from './paths';
import { readVersioned, writeVersioned, type VersionedSpec } from './versioned-json';

const spec: VersionedSpec = { kind: 'memoria del proyecto', current: PROJECT_MEMORY_VERSION };

/** La carpeta de la memoria, comprobada de verdad: nada se lee ni escribe fuera de ella [R76.3]. */
async function memoryDir(paths: ProjectPaths): Promise<string> {
  const dir = path.join(paths.orq, 'memory');
  await fs.mkdir(dir, { recursive: true });
  const real = await fs.realpath(dir);
  const orq = await fs.realpath(paths.orq);
  if (real !== path.join(orq, 'memory')) throw new StoreError('outside-root', 'La carpeta de la memoria no está donde debe');
  return real;
}

/** Las entradas de la memoria del proyecto; sin archivo, ninguna [R76.2]. */
export async function loadProjectMemory(paths: ProjectPaths): Promise<MemoryEntry[]> {
  const dir = await memoryDir(paths);
  try {
    const { data } = await readVersioned<{ entries: MemoryEntry[] }>(path.join(dir, 'entries.json'), spec);
    return Array.isArray(data.entries) ? data.entries : [];
  } catch (e) {
    if (e instanceof StoreError && e.code === 'not-found') return [];
    throw e;
  }
}

/**
 * Guarda la memoria y vuelve a escribir `MEMORIA.md` [R76.2]. Antes oculta lo que parezca un secreto y rechaza las
 * entradas que no valen [R76.3].
 */
export async function saveProjectMemory(paths: ProjectPaths, entries: readonly MemoryEntry[]): Promise<void> {
  // Se valida lo que llega, antes de ocultar nada: una clave se rechaza, no se guarda tapada.
  for (const e of entries.filter((x) => x.status === 'active')) {
    const bad = memoryEntryProblems(e)[0];
    if (bad) throw new StoreError('invalid', `«${e.title}»: ${bad}`);
  }
  const clean = redactSecrets(entries) as MemoryEntry[];
  const dir = await memoryDir(paths);
  await writeVersioned(path.join(dir, 'entries.json'), { schemaVersion: PROJECT_MEMORY_VERSION, entries: clean }, spec);
  await atomicWrite(path.join(dir, 'MEMORIA.md'), memoryIndexMarkdown(clean));
}
