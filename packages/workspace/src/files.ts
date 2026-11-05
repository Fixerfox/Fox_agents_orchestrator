import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

export type Manifest = Map<string, { hash: string; size: number }>;

/** Nombres que nunca se copian ni se comparan. */
export const DEFAULT_IGNORE = ['.git', '.orquestador', 'node_modules'];

const posix = (p: string) => p.split(sep).join('/');

export function isIgnored(rel: string, ignore: readonly string[]): boolean {
  const parts = rel.split('/');
  return ignore.some((pattern) => {
    const pat = pattern.replace(/\/+$/, '');
    return pat.includes('/') ? rel === pat || rel.startsWith(pat + '/') : parts.includes(pat);
  });
}

export async function manifestOf(root: string, ignore: readonly string[] = DEFAULT_IGNORE): Promise<Manifest> {
  const out: Manifest = new Map();
  async function walk(dir: string, prefix: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (isIgnored(rel, ignore)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full, rel);
      else if (e.isFile()) {
        const buf = await fs.readFile(full);
        out.set(rel, { hash: createHash('sha1').update(buf).digest('hex'), size: buf.length });
      }
    }
  }
  await walk(root, '');
  return out;
}

export function totalSize(m: Manifest): number {
  let n = 0;
  for (const f of m.values()) n += f.size;
  return n;
}

/** Resuelve `rel` dentro de `root`; lanza si intenta salir (../, rutas absolutas). */
export function resolveInside(root: string, rel: string): string {
  const base = resolve(root);
  const full = resolve(base, rel);
  if (rel === '' || full === base || !full.startsWith(base + sep) || /^[A-Za-z]:|^[\\/]/.test(rel)) {
    throw new Error(`Ruta fuera del espacio permitido: ${rel}`);
  }
  return full;
}

export async function copyFileTo(from: string, to: string): Promise<void> {
  await fs.mkdir(dirname(to), { recursive: true });
  await fs.copyFile(from, to);
}

export async function copyFiles(srcRoot: string, dstRoot: string, rels: Iterable<string>): Promise<void> {
  for (const rel of rels) await copyFileTo(join(srcRoot, ...rel.split('/')), join(dstRoot, ...rel.split('/')));
}

export async function readIfExists(path: string): Promise<Buffer | undefined> {
  try {
    return await fs.readFile(path);
  } catch {
    return undefined;
  }
}

export { posix };
