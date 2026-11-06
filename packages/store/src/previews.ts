import { promises as fs } from 'node:fs';
import path from 'node:path';
import { encodeStepKey, safePreviewPath } from '@orquestador/core';

export { encodeStepKey, safePreviewPath };

/** Tope de lo que se copia por paso para la vista previa [R54.3]. */
export const PREVIEW_STEP_MAX_BYTES = 20 * 1024 * 1024;
/** Carpeta de las copias dentro de la de cada ejecución [R54.3]. */
export const PREVIEWS_DIR = 'previews';

/** Carpeta con la copia de lo que hizo un paso en una ejecución [R54.3]. */
export const previewDir = (runDir: string, key: string): string => path.join(runDir, PREVIEWS_DIR, encodeStepKey(key));

const HTML_RE = /\.html?$/i;
const CSS_RE = /\.css$/i;
const REF_RE = /(?:\b(?:src|href|poster)\s*=\s*["']([^"']+)["'])|(?:url\(\s*["']?([^"')]+)["']?\s*\))/gi;

/** Recursos relativos que enlaza una web o una hoja de estilos (CSS, JS, imágenes…), resueltos desde su carpeta [R54.3]. */
export function relativeAssets(text: string, rel: string): string[] {
  const dir = path.posix.dirname(rel);
  const out = new Set<string>();
  for (const m of text.matchAll(REF_RE)) {
    const raw = (m[1] ?? m[2] ?? '').trim().split(/[?#]/)[0]!;
    if (!raw || raw.startsWith('/') || raw.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) continue;
    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      /* se usa tal cual */
    }
    const joined = path.posix.normalize(dir === '.' ? decoded : `${dir}/${decoded}`);
    if (safePreviewPath(joined)) out.add(joined);
  }
  return [...out];
}

/** ¿`abs` (ya resuelto) queda dentro de `root`? */
async function inside(root: string, abs: string): Promise<string | undefined> {
  try {
    const real = await fs.realpath(abs);
    const rel = path.relative(await fs.realpath(root), real);
    return rel.startsWith('..') || path.isAbsolute(rel) ? undefined : real;
  } catch {
    return undefined;
  }
}

/**
 * Copia lo que hizo un paso (y lo que enlazan sus webs y hojas de estilos) a la carpeta de vista previa de la
 * ejecución, hasta `maxBytes`. Lo que no existe, es secreto o no cabe se salta [R54.3].
 */
export async function snapshotStep(opts: {
  runDir: string;
  workRoot: string;
  key: string;
  files: readonly string[];
  blocked?: (rel: string) => boolean;
  maxBytes?: number;
}): Promise<{ copied: string[]; skipped: string[] }> {
  const max = opts.maxBytes ?? PREVIEW_STEP_MAX_BYTES;
  const dest = previewDir(opts.runDir, opts.key);
  const queue = opts.files.map((f) => f.replace(/\\/g, '/'));
  const seen = new Set<string>();
  const copied: string[] = [];
  const skipped: string[] = [];
  let total = 0;
  while (queue.length > 0) {
    const rel = queue.shift()!;
    if (seen.has(rel)) continue;
    seen.add(rel);
    if (!safePreviewPath(rel) || opts.blocked?.(rel)) {
      skipped.push(rel);
      continue;
    }
    const real = await inside(opts.workRoot, path.join(opts.workRoot, ...rel.split('/')));
    const stat = real ? await fs.stat(real).catch(() => undefined) : undefined;
    if (!real || !stat?.isFile() || total + stat.size > max) {
      skipped.push(rel);
      continue;
    }
    const target = path.join(dest, ...rel.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(real, target);
    total += stat.size;
    copied.push(rel);
    if (HTML_RE.test(rel) || CSS_RE.test(rel)) {
      const text = await fs.readFile(real, 'utf8').catch(() => '');
      for (const a of relativeAssets(text, rel)) if (!seen.has(a)) queue.push(a);
    }
  }
  return { copied, skipped };
}

/** Ruta absoluta de la copia de un archivo de un paso, si existe y no se sale de su carpeta [R54.4]. */
export async function findPreview(runDir: string, key: string, rel: string): Promise<string | undefined> {
  if (!safePreviewPath(rel)) return undefined;
  const dir = previewDir(runDir, key);
  const real = await inside(dir, path.join(dir, ...rel.split('/')));
  if (!real) return undefined;
  const stat = await fs.stat(real).catch(() => undefined);
  return stat?.isFile() ? real : undefined;
}
