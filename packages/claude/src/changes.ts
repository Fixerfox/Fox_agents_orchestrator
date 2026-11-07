import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { FileChange } from '@orquestador/core';

/** Carpetas que no se miran: las mismas que nunca se escriben ni se resumen [R31.2][R55.2]. */
const SKIP = new Set(['.git', 'node_modules', '.orquestador']);
/** Tope de archivos por foto; pasado el tope, lo que queda fuera no se vigila [R55.2]. */
export const MAX_WATCHED = 20000;

export interface FileStamp {
  size: number;
  mtimeMs: number;
}

export interface FolderSnapshot {
  files: Map<string, FileStamp>;
  /** Se llegó al tope y faltan archivos. */
  truncated: boolean;
}

/**
 * Carpetas de caché que, si git las ignora, no se miran: las de Unity, Unreal, Python, Rust, Java y los
 * empaquetadores. Lo demás que git ignora (`dist/`, `build/`, `_site/`…) sí, porque suele ser lo que genera un
 * comando [R63.18].
 */
export const HEAVY_IGNORED = new Set(['Library', 'Temp', 'Logs', 'obj', 'UserSettings', 'MemoryCaptures', 'Intermediate', 'Saved', 'DerivedDataCache', 'Binaries', 'DerivedData', '.venv', 'venv', '__pycache__', '.mypy_cache', '.pytest_cache', 'target', '.gradle', '.idea', '.vs', '.cache', '.next', '.nuxt', '.turbo', '.parcel-cache', '.angular', '.svelte-kit', 'coverage']);

/** Lo que git sabe de una carpeta: archivos que no ignora y lo ignorado (las carpetas acaban en «/»). */
export interface GitListing {
  files: string[];
  ignored: string[];
}

const git = (root: string, args: string[]): Promise<string[] | undefined> =>
  new Promise((resolve) => {
    execFile('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout) => resolve(err ? undefined : stdout.split('\0').filter((f) => f !== '')));
  });

/** Archivos de `root` según git (rutas relativas con «/»), o `undefined` si no es un repositorio o git falla [R63.18]. */
export async function gitFiles(root: string): Promise<GitListing | undefined> {
  const [files, ignored] = await Promise.all([git(root, ['ls-files', '-co', '--exclude-standard', '-z']), git(root, ['ls-files', '-oi', '--exclude-standard', '--directory', '-z'])]);
  return files && ignored ? { files, ignored } : undefined;
}

/** Foto de la carpeta: tamaño y fecha de cada archivo, con rutas relativas separadas por «/» [R55.2]. */
export async function snapshotFolder(root: string, max = MAX_WATCHED, list: (root: string) => Promise<GitListing | undefined> = gitFiles): Promise<FolderSnapshot> {
  const files = new Map<string, FileStamp>();
  let truncated = false;
  const listed = await list(root);
  const skipped = (r: string) => r.split('/').some((part) => SKIP.has(part));
  const stat = async (rels: string[]) => {
    for (let i = 0; i < rels.length; i += 256) {
      await Promise.all(
        rels.slice(i, i + 256).map((r) =>
          fs.stat(path.join(root, r)).then(
            (st) => void (st.isFile() && files.set(r, { size: st.size, mtimeMs: st.mtimeMs })),
            () => undefined,
          ),
        ),
      );
    }
  };
  const visit = async (dir: string, rel: string, heavy: (name: string) => boolean): Promise<void> => {
    if (truncated) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const subdirs: [string, string][] = [];
    const stats: Promise<void>[] = [];
    for (const e of entries) {
      if (SKIP.has(e.name) || heavy(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) subdirs.push([abs, r]);
      else if (e.isFile()) {
        if (files.size + stats.length >= max) {
          truncated = true;
          break;
        }
        stats.push(
          fs.stat(abs).then(
            (s) => void files.set(r, { size: s.size, mtimeMs: s.mtimeMs }),
            () => undefined,
          ),
        );
      }
    }
    await Promise.all(stats);
    for (const [abs, r] of subdirs) await visit(abs, r, heavy);
  };
  if (listed) {
    // En un repositorio: lo que git no ignora, y de lo ignorado todo menos las carpetas de caché [R63.18].
    const tracked = listed.files.filter((r) => !skipped(r));
    const loose = listed.ignored.filter((r) => !r.endsWith('/') && !skipped(r));
    const wanted = [...tracked, ...loose].slice(0, max);
    truncated = tracked.length + loose.length > max;
    await stat(wanted);
    for (const dir of listed.ignored.filter((r) => r.endsWith('/'))) {
      const rel = dir.slice(0, -1);
      if (skipped(rel) || rel.split('/').some((part) => HEAVY_IGNORED.has(part))) continue;
      await visit(path.join(root, rel), rel, (name) => HEAVY_IGNORED.has(name));
    }
    return { files, truncated };
  }
  await visit(root, '', () => false);
  return { files, truncated };
}

/** Lo que es nuevo o ha cambiado de tamaño o de fecha entre dos fotos, ordenado por ruta [R55.3]. */
export function diffSnapshots(before: FolderSnapshot, after: FolderSnapshot): { path: string; change: FileChange }[] {
  const out: { path: string; change: FileChange }[] = [];
  for (const [rel, now] of after.files) {
    const was = before.files.get(rel);
    if (!was) {
      // Con la foto de antes recortada, un archivo que no estaba en ella puede ser viejo: no se afirma nada.
      if (!before.truncated) out.push({ path: rel, change: 'created' });
    } else if (was.size !== now.size || was.mtimeMs !== now.mtimeMs) out.push({ path: rel, change: 'modified' });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Vigila lo que cambian los comandos de un paso [R55.1–R55.4]. Antes de que se ejecute un comando permitido se
 * hace una foto si no hay ninguna abierta; cuando vuelve su resultado (o al final del paso) se hace otra y se
 * entrega la diferencia. Mientras quede otro comando abierto, la siguiente comparación parte de la última foto, así
 * nada se cuenta dos veces; sin comandos abiertos no se mira nada, y lo que cambie otro paso entonces no es de este.
 */
export class CommandWatch {
  private base: FolderSnapshot | undefined;
  private readonly open = new Set<string>();
  private anon = 0;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly root: string,
    private readonly snapshot: (root: string) => Promise<FolderSnapshot> = snapshotFolder,
  ) {}

  /** Lo llama la política al permitir un comando, antes de que se ejecute; `id` es el de la llamada. */
  opening(id?: string): Promise<void> {
    return this.serial(async () => {
      this.open.add(id ?? `sin-id-${++this.anon}`);
      if (!this.base) this.base = await this.snapshot(this.root);
    });
  }

  /**
   * Mira qué ha cambiado desde la foto abierta. `done`: ha vuelto el resultado del comando `id` (si no se abrió, no
   * hace nada; sin id cierra uno cualquiera); `flush`: ha vuelto un subagente, cuyos comandos pasan por la política
   * pero cuyos resultados pueden no llegar; `final`: termina el paso y se cierra todo.
   */
  closing(how: 'done' | 'flush' | 'final', id?: string): Promise<{ path: string; change: FileChange }[]> {
    return this.serial(async () => {
      if (!this.base) return [];
      if (how === 'final') this.open.clear();
      else if (how === 'done') {
        const key = id !== undefined ? id : this.open.values().next().value;
        if (key === undefined || !this.open.delete(key)) return [];
      }
      const now = await this.snapshot(this.root);
      const changes = diffSnapshots(this.base, now);
      this.base = this.open.size > 0 ? now : undefined;
      return changes;
    });
  }

  /** Una cosa detrás de otra: dos comandos en paralelo no comparan fotos cruzadas. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.pending.then(fn);
    this.pending = p.catch(() => undefined);
    return p;
  }
}
