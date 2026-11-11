import { promises as fs } from 'node:fs';
import path from 'node:path';
import { StoreError } from './errors';
import { ProjectStore } from './project';

const exists = (p: string) => fs.stat(p).then(() => true, () => false);

/** Primer nombre libre para apartar el `.orquestador` antiguo: `.orquestador.unido`, `.orquestador.unido-2`… [R96.5] */
async function freeName(dir: string): Promise<string> {
  for (let n = 1; ; n++) {
    const candidate = path.join(dir, n === 1 ? '.orquestador.unido' : `.orquestador.unido-${n}`);
    if (!(await exists(candidate))) return candidate;
  }
}

export interface JoinResult {
  /** Carpeta del proyecto ya unido. */
  root: string;
  store: ProjectStore;
  /** Dónde quedó el `.orquestador` antiguo; `undefined` si no se pudo renombrar y sigue en su sitio. */
  kept?: string;
}

/**
 * Une un proyecto antiguo con su carpeta de trabajo: copia `.orquestador` dentro de ella (sin `work-folder.json`),
 * comprueba que se abre y aparta el antiguo con otro nombre. Nunca borra el original [R96.5][R96.6].
 */
export async function joinProjectIntoWorkFolder(store: ProjectStore, copy: (from: string, to: string) => Promise<void> = (from, to) => fs.cp(from, to, { recursive: true, errorOnExist: true, force: false })): Promise<JoinResult> {
  const dest = await store.separateWorkFolder();
  if (!dest) throw new StoreError('invalid', 'Este proyecto ya trabaja en su propia carpeta: no hay nada que unir');
  const target = path.join(dest, '.orquestador');
  if (await exists(target)) throw new StoreError('exists', `«${path.basename(dest)}» ya tiene su propio .orquestador. Abre ese proyecto, o aparta esa carpeta antes de unir.`);
  const temp = path.join(dest, `.orquestador.uniendo-${process.pid}`);
  let joined: ProjectStore;
  let placed = false;
  try {
    await copy(store.paths.orq, temp);
    await fs.rm(path.join(temp, 'work-folder.json'), { force: true });
    await fs.rename(temp, target);
    placed = true;
    joined = await ProjectStore.open(dest);
  } catch (err) {
    // Lo copiado se retira (es solo la copia); el proyecto sigue donde estaba [R96.6].
    await fs.rm(placed ? target : temp, { recursive: true, force: true }).catch(() => undefined);
    throw new StoreError('unavailable', `No se pudo unir el proyecto: ${(err as Error).message}. Sigue como estaba.`);
  }
  const aside = await freeName(store.paths.root);
  const kept = await fs.rename(store.paths.orq, aside).then(() => aside, () => undefined);
  return { root: dest, store: joined, ...(kept ? { kept } : {}) };
}
