import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { EventBody, Id } from '@orquestador/core';
import {
  DEFAULT_IGNORE,
  copyFileTo,
  copyFiles,
  manifestOf,
  readIfExists,
  resolveInside,
  totalSize,
  type Manifest,
} from './files';

const run = promisify(execFile);
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface WorkspaceOptions {
  projectRoot: string;
  /** Carpeta de la ejecución: `.orquestador/runs/<runId>`. */
  runDir: string;
  /** Carpeta de espacios temporales (se vacía al arrancar). */
  tmpRoot: string;
  emit?: (body: EventBody) => void;
  /** Fuerza la estrategia; por defecto `git` si el proyecto es un repositorio. */
  strategy?: 'git' | 'copy';
  /** Nombres o rutas extra que no se copian (R13.8). */
  ignore?: string[];
  /** Por encima de este tamaño se avisa del coste de copiar (R13.8). Por defecto 200 MB. */
  warnBytes?: number;
}

export interface Workspace {
  id: string;
  nodeId: Id;
  /** Carpeta donde trabaja el agente. */
  dir: string;
  isolated: boolean;
  strategy: 'git' | 'copy' | 'none';
  warning?: string;
}

interface Internal extends Workspace {
  base: Manifest;
  done: boolean;
}

export interface MergeResult {
  merged: string[];
  conflicts: string[];
}

export class WorkspaceManager {
  private readonly ignore: string[];
  private readonly open = new Map<string, Internal>();
  private mergeChain: Promise<unknown> = Promise.resolve();
  private seq = 0;
  /** Conflictos acumulados en la ejecución: si no está vacío, requiere atención. */
  readonly conflicts: { nodeId: Id; files: string[] }[] = [];

  constructor(private readonly o: WorkspaceOptions) {
    this.ignore = [...DEFAULT_IGNORE, ...(o.ignore ?? [])];
  }

  get needsAttention(): boolean {
    return this.conflicts.length > 0;
  }

  private async isGitRepo(): Promise<boolean> {
    try {
      await fs.access(join(this.o.projectRoot, '.git'));
      await run('git', ['-C', this.o.projectRoot, 'rev-parse', '--verify', 'HEAD']);
      return true;
    } catch {
      return false;
    }
  }

  /** R13.1/R13.4: abre un espacio. Los agentes de solo lectura usan el proyecto directamente. */
  async acquire(nodeId: Id, opts: { readOnly?: boolean } = {}): Promise<Workspace> {
    if (opts.readOnly) {
      return { id: `ro-${++this.seq}`, nodeId, dir: this.o.projectRoot, isolated: false, strategy: 'none' };
    }
    const id = `${String(++this.seq).padStart(3, '0')}-${nodeId.replace(/[^A-Za-z0-9._-]/g, '_')}-${randomBytes(3).toString('hex')}`;
    const dir = join(this.o.tmpRoot, id);
    await fs.mkdir(this.o.tmpRoot, { recursive: true });
    const wantGit = (this.o.strategy ?? ((await this.isGitRepo()) ? 'git' : 'copy')) === 'git';
    let strategy: 'git' | 'copy' = 'copy';
    let warning: string | undefined;

    if (wantGit && (await this.isGitRepo())) {
      await run('git', ['-C', this.o.projectRoot, 'worktree', 'add', '--detach', dir, 'HEAD']);
      strategy = 'git';
    } else {
      const src = await manifestOf(this.o.projectRoot, this.ignore);
      const size = totalSize(src);
      const limit = this.o.warnBytes ?? 200 * 1024 * 1024;
      if (size > limit) {
        warning = `El proyecto ocupa ${(size / 1048576).toFixed(0)} MB y se copiará para cada agente; limita lo que se copia para ahorrar tiempo y espacio.`;
      }
      await fs.mkdir(dir, { recursive: true });
      await copyFiles(this.o.projectRoot, dir, src.keys());
    }
    const ws: Internal = {
      id,
      nodeId,
      dir,
      isolated: true,
      strategy,
      ...(warning ? { warning } : {}),
      base: await manifestOf(dir, this.ignore),
      done: false,
    };
    this.open.set(id, ws);
    return ws;
  }

  /** R13.2/R13.3: fusiona los cambios del espacio en el proyecto, de uno en uno (orden de finalización). */
  merge(ws: Workspace): Promise<MergeResult> {
    const next = this.mergeChain.then(() => this.doMerge(ws));
    this.mergeChain = next.catch(() => undefined);
    return next;
  }

  private async doMerge(w: Workspace): Promise<MergeResult> {
    const ws = this.open.get(w.id);
    if (!ws || ws.done) return { merged: [], conflicts: [] };
    ws.done = true;
    const now = await manifestOf(ws.dir, this.ignore);
    const project = await manifestOf(this.o.projectRoot, this.ignore);
    const merged: string[] = [];
    const conflicts: string[] = [];

    const rels = new Set([...ws.base.keys(), ...now.keys()]);
    for (const rel of [...rels].sort()) {
      const b = ws.base.get(rel)?.hash;
      const n = now.get(rel)?.hash;
      if (b === n) continue; // sin cambios
      const cur = project.get(rel)?.hash;
      if (cur === n) continue; // el proyecto ya tiene lo mismo
      const target = join(this.o.projectRoot, ...rel.split('/'));
      if (cur === b) {
        if (n === undefined) await fs.rm(target, { force: true });
        else await copyFileTo(join(ws.dir, ...rel.split('/')), target);
        merged.push(rel);
      } else {
        // Cambios incompatibles: el proyecto no se toca y la versión del agente se conserva aparte.
        if (n !== undefined) {
          await copyFileTo(join(ws.dir, ...rel.split('/')), join(this.o.runDir, 'conflicts', ws.id, ...rel.split('/')));
        }
        conflicts.push(rel);
      }
    }
    if (merged.length > 0) this.o.emit?.({ type: 'workspace.merged', nodeId: ws.nodeId, files: merged });
    if (conflicts.length > 0) {
      this.conflicts.push({ nodeId: ws.nodeId, files: conflicts });
      this.o.emit?.({ type: 'workspace.conflict', nodeIds: [ws.nodeId], files: conflicts });
    }
    return { merged, conflicts };
  }

  /** R13.7: borra el espacio (también si se cancela sin fusionar). */
  async release(w: Workspace): Promise<void> {
    const ws = this.open.get(w.id);
    if (!ws) return;
    this.open.delete(w.id);
    await this.remove(ws.dir, ws.strategy === 'git');
  }

  async releaseAll(): Promise<void> {
    await this.mergeChain;
    for (const ws of [...this.open.values()]) await this.release(ws);
  }

  private async remove(dir: string, git: boolean): Promise<void> {
    if (git) {
      try {
        await run('git', ['-C', this.o.projectRoot, 'worktree', 'remove', '--force', dir]);
      } catch {
        /* se borra a mano abajo */
      }
    }
    await fs.rm(dir, { recursive: true, force: true });
  }

  /** R13.7: limpieza al arrancar tras un cierre inesperado. Devuelve cuántos espacios sobraban. */
  async cleanupStale(): Promise<number> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.o.tmpRoot);
    } catch {
      return 0;
    }
    for (const name of entries) await this.remove(join(this.o.tmpRoot, name), true);
    try {
      await run('git', ['-C', this.o.projectRoot, 'worktree', 'prune']);
    } catch {
      /* no es un repositorio */
    }
    return entries.length;
  }

  // --- instantáneas por iteración (R13.5) --------------------------------------------------

  private iterDir(loopId: Id, n?: number): string {
    if (!SAFE.test(loopId) || loopId.includes('..')) throw new Error(`Id de bucle no válido: ${loopId}`);
    const base = join(this.o.runDir, 'iterations', loopId);
    return n === undefined ? base : join(base, String(n));
  }

  /** Guarda el estado de `from` (por defecto el proyecto) y emite `iteration.snapshot`. */
  async snapshotIteration(loopId: Id, n: number, from: string = this.o.projectRoot): Promise<string> {
    if (!Number.isInteger(n) || n < 1) throw new Error('La vuelta debe ser un entero ≥ 1');
    const dest = this.iterDir(loopId, n);
    await fs.rm(dest, { recursive: true, force: true });
    await fs.mkdir(dest, { recursive: true });
    await copyFiles(from, dest, (await manifestOf(from, this.ignore)).keys());
    this.o.emit?.({ type: 'iteration.snapshot', loopId, n, path: `iterations/${loopId}/${n}` });
    return dest;
  }

  async listIterations(loopId: Id): Promise<number[]> {
    try {
      return (await fs.readdir(this.iterDir(loopId)))
        .map(Number)
        .filter((x) => Number.isInteger(x))
        .sort((a, b) => a - b);
    } catch {
      return [];
    }
  }

  /** Recupera una vuelta anterior: copia sus archivos sobre `target`. No borra los que ya no están. */
  async restoreIteration(loopId: Id, n: number, target: string = this.o.projectRoot): Promise<string[]> {
    const src = this.iterDir(loopId, n);
    const m = await manifestOf(src, []);
    if (m.size === 0 && !(await this.listIterations(loopId)).includes(n)) throw new Error(`No existe la vuelta ${n} de ${loopId}`);
    await copyFiles(src, target, m.keys());
    return [...m.keys()].sort();
  }

  // --- archivos producidos (R13.6) -----------------------------------------------------------

  /** Copia los archivos a `output/` y emite `file.produced` por cada uno. */
  async registerProduced(nodeId: Id, files: string[], fromDir: string = this.o.projectRoot): Promise<string[]> {
    const out: string[] = [];
    for (const rel of files) {
      const src = resolveInside(fromDir, rel);
      const data = await readIfExists(src);
      if (!data) continue;
      let dest = resolveInside(join(this.o.runDir, 'output'), rel);
      const existing = await readIfExists(dest);
      let shown = rel;
      if (existing && createHash('sha1').update(existing).digest('hex') !== createHash('sha1').update(data).digest('hex')) {
        shown = `${nodeId}/${rel}`;
        dest = resolveInside(join(this.o.runDir, 'output'), shown);
      }
      await copyFileTo(src, dest);
      out.push(shown);
      this.o.emit?.({ type: 'file.produced', nodeId, path: shown });
    }
    return out;
  }
}
