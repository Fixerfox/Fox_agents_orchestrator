import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { BranchSpaces, ConflictChoice, SpaceMerge, SpaceRef } from '@orquestador/core';
import { DEFAULT_IGNORE, copyFileTo, copyFiles, manifestOf, readIfExists, totalSize, type Manifest } from './files';

const run = promisify(execFile);
const sha1 = (b: Buffer) => createHash('sha1').update(b).digest('hex');
const safeName = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60) || 'rama';
const MARKER = /^(<{7}|>{7})( |$)/m;

export interface BranchSpacesOptions {
  /** Carpeta de trabajo de los agentes (R31.1): de aquí parte cada rama y aquí se fusiona [R73.4]. */
  workRoot: string | (() => Promise<string>);
  /** Carpeta de la ejecución, para `conflicts/` y `discarded/` [R73.16][R73.17]. */
  runDir: string;
  /** Carpeta de los espacios, fuera de la de trabajo [R73.6]. */
  spacesRoot?: string;
  ignore?: string[];
  /** Por encima de este tamaño se avisa del coste de copiar (R13.8). Por defecto 200 MB. */
  warnBytes?: number;
}

interface Open extends SpaceRef {
  label: string;
  git: boolean;
  /** Foto del espacio al abrirlo: la base de la fusión [R73.5]. */
  base: Manifest;
  /** Conflictos de la última fusión: destino y archivos. */
  conflicts?: { into: string; files: string[] };
}

/**
 * Espacios de las ramas en paralelo [R73.2]–[R73.18]. Con git, un worktree con encima los cambios sin guardar de la
 * carpeta; si no, una copia. Se fusionan de uno en uno, por archivo y, si los dos cambiaron el mismo texto, por líneas.
 */
export class BranchSpaceManager implements BranchSpaces {
  private readonly ignore: string[];
  private readonly open_ = new Map<string, Open>();
  /** Contenido de antes de cada archivo que una fusión sobrescribe, por su hash: la base de las siguientes [R73.12]. */
  private readonly preimages = new Map<string, Buffer>();
  private chain: Promise<unknown> = Promise.resolve();
  private seq = 0;
  readonly spacesRoot: string;

  constructor(private readonly o: BranchSpacesOptions) {
    this.ignore = [...DEFAULT_IGNORE, ...(o.ignore ?? [])];
    this.spacesRoot = o.spacesRoot ?? join(tmpdir(), 'orquestador-spaces');
  }

  private root: string | undefined;
  private readonly steps = new Map<string, string>();

  /** La carpeta de trabajo, leída una vez por ejecución [R73.4]. */
  private async work(): Promise<string> {
    this.root ??= typeof this.o.workRoot === 'string' ? this.o.workRoot : await this.o.workRoot();
    return this.root;
  }

  bind(space: SpaceRef, stepKey: string): void {
    this.steps.set(stepKey, space.id);
  }

  /** Carpeta en la que trabaja ahora un paso, si su espacio sigue abierto [R73.19]. */
  dirForStep(stepKey: string): string | undefined {
    const id = this.steps.get(stepKey);
    return id === undefined ? undefined : this.open_.get(id)?.dir;
  }

  private static async gitRoot(dir: string): Promise<boolean> {
    try {
      const { stdout } = await run('git', ['-C', dir, 'rev-parse', '--show-toplevel']);
      const [a, b] = await Promise.all([fs.realpath(stdout.trim()), fs.realpath(dir)]);
      if (a !== b) return false;
      await run('git', ['-C', dir, 'rev-parse', '--verify', 'HEAD']);
      return true;
    } catch {
      return false;
    }
  }

  /** Lleva al worktree lo que la carpeta tiene sin guardar en git: cambiado, nuevo no ignorado y borrado [R73.5]. */
  private static async syncUncommitted(src: string, dst: string): Promise<void> {
    const { stdout } = await run('git', ['-C', src, 'status', '--porcelain=v1', '-z', '--untracked-files=all'], { maxBuffer: 64 * 1024 * 1024 });
    const parts = stdout.split('\0');
    for (let i = 0; i < parts.length; i++) {
      const entry = parts[i]!;
      if (entry.length < 4) continue;
      const xy = entry.slice(0, 2);
      const rel = entry.slice(3);
      // En un renombrado, la ruta de antes va en la siguiente entrada.
      if (xy[0] === 'R' || xy[0] === 'C') {
        const from = parts[++i];
        if (xy[0] === 'R' && from) await fs.rm(join(dst, ...from.split('/')), { force: true });
      }
      const target = join(dst, ...rel.split('/'));
      if (xy.includes('D')) {
        await fs.rm(target, { force: true });
        continue;
      }
      const stat = await fs.stat(join(src, ...rel.split('/'))).catch(() => undefined);
      if (stat?.isFile()) await copyFileTo(join(src, ...rel.split('/')), target);
    }
  }

  async open(o: { regionId: string; label: string; parent?: SpaceRef }): Promise<{ space: SpaceRef; strategy: 'git' | 'copy'; warning?: string }> {
    const source = o.parent?.dir ?? (await this.work());
    const id = `${String(++this.seq).padStart(3, '0')}-${safeName(o.label)}-${randomBytes(3).toString('hex')}`;
    const dir = join(this.spacesRoot, id);
    await fs.mkdir(this.spacesRoot, { recursive: true });
    // Un abanico dentro de una rama parte del espacio de la rama: copia [R73.3].
    const git = !o.parent && (await BranchSpaceManager.gitRoot(source));
    let warning: string | undefined;
    if (git) {
      await run('git', ['-C', source, 'worktree', 'add', '--detach', dir, 'HEAD']);
      await BranchSpaceManager.syncUncommitted(source, dir);
    } else {
      const src = await manifestOf(source, this.ignore);
      const size = totalSize(src);
      if (size > (this.o.warnBytes ?? 200 * 1024 * 1024)) warning = `La carpeta ocupa ${(size / 1048576).toFixed(0)} MB y se copia para cada rama en paralelo.`;
      await fs.mkdir(dir, { recursive: true });
      await copyFiles(source, dir, src.keys());
    }
    const space: Open = { id, dir, label: o.label, git, base: await manifestOf(dir, this.ignore) };
    this.open_.set(id, space);
    return { space: { id, dir }, strategy: git ? 'git' : 'copy', ...(warning ? { warning } : {}) };
  }

  private serial<T>(f: () => Promise<T>): Promise<T> {
    const next = this.chain.then(f);
    this.chain = next.catch(() => undefined);
    return next;
  }

  /** Escribe (o borra) un archivo del destino guardando antes lo que había [R73.12]. */
  private async put(intoDir: string, rel: string, data: Buffer | undefined): Promise<void> {
    const target = join(intoDir, ...rel.split('/'));
    const before = await readIfExists(target);
    if (before) this.preimages.set(sha1(before), before);
    if (data === undefined) await fs.rm(target, { force: true });
    else {
      await fs.mkdir(join(target, '..'), { recursive: true });
      await fs.writeFile(target, data);
    }
  }

  /** La base de un archivo por su hash: lo que había antes de una fusión o lo que hay si no ha cambiado. */
  private async baseOf(hash: string, intoDir: string, rel: string, cur: string | undefined): Promise<Buffer | undefined> {
    const kept = this.preimages.get(hash);
    if (kept) return kept;
    if (cur === hash) return readIfExists(join(intoDir, ...rel.split('/')));
    return undefined;
  }

  /** Une a tres bandas por líneas con `git merge-file` [R73.12]; `markers` deja las marcas si se solapan. */
  private async mergeLines(ours: Buffer, base: Buffer, theirs: Buffer, markers: boolean, labels: [string, string]): Promise<Buffer | undefined> {
    const tmp = await fs.mkdtemp(join(tmpdir(), 'orq-merge-'));
    try {
      const [a, b, c] = ['destino', 'base', 'rama'].map((n) => join(tmp, n));
      await Promise.all([fs.writeFile(a!, ours), fs.writeFile(b!, base), fs.writeFile(c!, theirs)]);
      try {
        const { stdout } = await run('git', ['merge-file', '-p', '--diff3', '-L', labels[0], '-L', 'base', '-L', labels[1], a!, b!, c!], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
        return stdout as unknown as Buffer;
      } catch (err) {
        // Con solapes, `git merge-file` sale con el número de conflictos y la salida con marcas.
        const e = err as { code?: number; stdout?: Buffer };
        if (markers && typeof e.code === 'number' && e.code > 0 && e.stdout) return e.stdout;
        return undefined;
      }
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  }

  private static binary(b: Buffer | undefined): boolean {
    return b !== undefined && b.subarray(0, 8000).includes(0);
  }

  merge(ref: SpaceRef, into?: SpaceRef): Promise<SpaceMerge> {
    return this.serial(() => this.doMerge(ref, into));
  }

  private async doMerge(ref: SpaceRef, into?: SpaceRef): Promise<SpaceMerge> {
    const ws = this.open_.get(ref.id);
    if (!ws) return { merged: [], mergedByLines: [], conflicts: [] };
    const intoDir = into?.dir ?? (await this.work());
    const now = await manifestOf(ws.dir, this.ignore);
    const dest = await manifestOf(intoDir, this.ignore);
    const merged: string[] = [];
    const byLines: string[] = [];
    const conflicts: string[] = [];
    for (const rel of [...new Set([...ws.base.keys(), ...now.keys()])].sort()) {
      const b = ws.base.get(rel)?.hash;
      const n = now.get(rel)?.hash;
      if (b === n) continue;
      const cur = dest.get(rel)?.hash;
      if (cur === n) continue;
      const mine = n === undefined ? undefined : await fs.readFile(join(ws.dir, ...rel.split('/')));
      if (cur === b) {
        await this.put(intoDir, rel, mine);
        merged.push(rel);
        continue;
      }
      // Los dos lo cambiaron: por líneas si es texto y se sabe la base [R73.12].
      const theirs = cur === undefined ? undefined : await fs.readFile(join(intoDir, ...rel.split('/')));
      const base = b === undefined ? Buffer.alloc(0) : await this.baseOf(b, intoDir, rel, cur);
      if (mine && theirs && base && ![mine, theirs, base].some((x) => BranchSpaceManager.binary(x))) {
        const out = await this.mergeLines(theirs, base, mine, false, ['destino', ws.label]);
        if (out) {
          await this.put(intoDir, rel, out);
          merged.push(rel);
          byLines.push(rel);
          continue;
        }
      }
      conflicts.push(rel);
    }
    let savedTo: string | undefined;
    if (conflicts.length > 0) {
      // Las dos versiones quedan a la vista en la carpeta de la ejecución [R73.16].
      savedTo = `conflicts/${safeName(ws.label)}`;
      for (const rel of conflicts) {
        const mine = await readIfExists(join(ws.dir, ...rel.split('/')));
        const theirs = await readIfExists(join(intoDir, ...rel.split('/')));
        if (mine) await this.write(join(this.o.runDir, savedTo, 'rama', ...rel.split('/')), mine);
        if (theirs) await this.write(join(this.o.runDir, savedTo, 'destino', ...rel.split('/')), theirs);
      }
      ws.conflicts = { into: intoDir, files: conflicts };
    }
    return { merged, mergedByLines: byLines, conflicts, ...(savedTo ? { savedTo } : {}) };
  }

  private async write(abs: string, data: Buffer): Promise<void> {
    await fs.mkdir(join(abs, '..'), { recursive: true });
    await fs.writeFile(abs, data);
  }

  resolve(ref: SpaceRef, into: SpaceRef | undefined, choice: ConflictChoice): Promise<void> {
    return this.serial(async () => {
      const ws = this.open_.get(ref.id);
      if (!ws?.conflicts || choice === 'target') return;
      const intoDir = into?.dir ?? (await this.work());
      for (const rel of ws.conflicts.files) {
        const mine = await readIfExists(join(ws.dir, ...rel.split('/')));
        if (choice === 'branch') {
          await this.put(intoDir, rel, mine);
          continue;
        }
        // Para el agente: el archivo con las marcas de conflicto, base incluida [R73.15].
        const theirs = await readIfExists(join(intoDir, ...rel.split('/')));
        const b = ws.base.get(rel)?.hash;
        const cur = theirs ? sha1(theirs) : undefined;
        const base = b === undefined ? Buffer.alloc(0) : ((await this.baseOf(b, intoDir, rel, cur)) ?? Buffer.alloc(0));
        const out =
          mine && theirs && !BranchSpaceManager.binary(mine) && !BranchSpaceManager.binary(theirs)
            ? await this.mergeLines(theirs, base, mine, true, ['destino', ws.label])
            : undefined;
        await this.put(intoDir, rel, out ?? Buffer.concat([Buffer.from(`<<<<<<< destino\n`), theirs ?? Buffer.alloc(0), Buffer.from(`\n=======\n`), mine ?? Buffer.alloc(0), Buffer.from(`\n>>>>>>> ${ws.label}\n`)]));
      }
    });
  }

  async unresolved(ref: SpaceRef, into?: SpaceRef): Promise<string[]> {
    const ws = this.open_.get(ref.id);
    if (!ws?.conflicts) return [];
    const intoDir = into?.dir ?? (await this.work());
    const out: string[] = [];
    for (const rel of ws.conflicts.files) {
      const data = await readIfExists(join(intoDir, ...rel.split('/')));
      if (data && !BranchSpaceManager.binary(data) && MARKER.test(data.toString('utf8'))) out.push(rel);
    }
    return out;
  }

  async discard(ref: SpaceRef): Promise<string[]> {
    const ws = this.open_.get(ref.id);
    if (!ws) return [];
    const now = await manifestOf(ws.dir, this.ignore);
    const changed = [...now].filter(([rel, f]) => ws.base.get(rel)?.hash !== f.hash).map(([rel]) => rel);
    const dest = join(this.o.runDir, 'discarded', safeName(ws.label));
    await copyFiles(ws.dir, dest, changed);
    await this.close(ref);
    return changed.sort();
  }

  async close(ref: SpaceRef): Promise<void> {
    const ws = this.open_.get(ref.id);
    if (!ws) return;
    this.open_.delete(ref.id);
    await removeSpace(ws.dir, ws.git ? await this.work() : undefined);
  }

  async closeAll(): Promise<void> {
    await this.chain;
    for (const ws of [...this.open_.values()]) await this.close(ws);
  }
}

async function removeSpace(dir: string, repo: string | undefined): Promise<void> {
  if (repo) {
    try {
      await run('git', ['-C', repo, 'worktree', 'remove', '--force', dir]);
    } catch {
      /* se borra a mano abajo */
    }
  }
  await fs.rm(dir, { recursive: true, force: true });
}

/**
 * Tras un cierre inesperado: borra los espacios que quedaron y `git worktree prune` en la carpeta de trabajo
 * [R73.18]. Devuelve cuántos sobraban.
 */
export async function cleanupBranchSpaces(spacesRoot: string, workRoots: readonly string[]): Promise<number> {
  let names: string[] = [];
  try {
    names = await fs.readdir(spacesRoot);
  } catch {
    /* no hay */
  }
  for (const name of names) await fs.rm(join(spacesRoot, name), { recursive: true, force: true });
  for (const root of workRoots) {
    try {
      await run('git', ['-C', root, 'worktree', 'prune']);
    } catch {
      /* no es un repositorio */
    }
  }
  return names.length;
}
