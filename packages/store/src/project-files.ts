import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isRelativeInside, type Id } from '@orquestador/core';
import { StoreError } from './errors';
import type { ProjectPaths } from './paths';
import { readRunLog } from './run-log';

/** Lo que necesitan estas funciones del proyecto. */
export interface ProjectFiles {
  readonly paths: ProjectPaths;
  getWorkFolder(): Promise<string | undefined>;
}

/** Límites de los adjuntos de la entrada [R48.3][R48.4]. */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_INPUT_FILES = 20;
const RESERVED_DIRS = new Set(['.git', '.orquestador', 'node_modules']);
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;
export const isImageName = (name: string): boolean => IMAGE_EXT.test(name);

/** Nombre de archivo sin rutas ni caracteres que Windows no admite [R48.4]. */
export function safeFileName(name: string): string {
  const last = name.split(/[\\/]/).pop() ?? '';
  const visible = [...last].map((c) => (c.charCodeAt(0) < 32 ? '_' : c)).join('');
  const clean = visible.replace(/[<>:"|?*]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 120);
  return clean || 'adjunto';
}

export interface AttachmentView {
  id: string;
  name: string;
  size: number;
  image: boolean;
}

export interface RunFileView {
  path: string;
  /** El fichero ya no existe en la carpeta. */
  missing: boolean;
  /** No es texto: no se muestra el contenido. */
  binary: boolean;
  current?: { text: string; truncated: boolean };
  /** Copia de antes de que la ejecución lo modificara, si la hay. */
  before?: { text: string; truncated: boolean };
}

export const RUN_FILE_MAX = 200_000;

/** Copia un adjunto de la entrada en `.orquestador/attachments/<id>/` [R48.4]. */
export async function stageAttachment(project: ProjectFiles, name: string, data: Uint8Array): Promise<AttachmentView> {
  if (data.byteLength === 0) throw new StoreError('invalid', `«${name}» está vacío`);
  if (data.byteLength > MAX_ATTACHMENT_BYTES) throw new StoreError('invalid', `«${name}» supera los 20 MB`);
  const clean = safeFileName(name);
  const id = randomUUID();
  const dir = project.paths.attachmentDir(id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, clean), data);
  return { id, name: clean, size: data.byteLength, image: isImageName(clean) };
}

/** Ruta de un adjunto relativa a la carpeta de trabajo, como la recibe el agente [R48.4]. */
export async function attachmentInputPath(project: ProjectFiles, id: string): Promise<string> {
  const dir = project.paths.attachmentDir(id);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    throw new StoreError('not-found', 'Ese adjunto ya no existe');
  }
  if (names.length !== 1) throw new StoreError('not-found', 'Ese adjunto ya no existe');
  const base = (await project.getWorkFolder()) ?? project.paths.root;
  return path.relative(base, path.join(dir, names[0]!)).split(path.sep).join('/');
}

/** Comprueba archivos del proyecto para la entrada: dentro de la carpeta de trabajo y fuera de lo reservado [R48.4]. */
export async function inputFiles(project: ProjectFiles, rels: string[]): Promise<{ path: string; size: number; image: boolean }[]> {
  const base = (await project.getWorkFolder()) ?? project.paths.root;
  const out: { path: string; size: number; image: boolean }[] = [];
  for (const rel of rels) {
    const norm = rel.split('\\').join('/');
    if (!isRelativeInside(norm) || norm.split('/').some((seg) => RESERVED_DIRS.has(seg))) throw new StoreError('outside-root', `«${rel}» no es un archivo del proyecto que se pueda adjuntar`);
    let stat;
    try {
      const real = await fs.realpath(path.join(base, ...norm.split('/')));
      const inside = path.relative(await fs.realpath(base), real);
      if (inside.startsWith('..') || path.isAbsolute(inside)) throw new Error('fuera');
      stat = await fs.stat(real);
    } catch {
      throw new StoreError('not-found', `«${rel}» no existe en la carpeta de trabajo`);
    }
    if (!stat.isFile()) throw new StoreError('invalid', `«${rel}» no es un archivo`);
    out.push({ path: norm, size: stat.size, image: isImageName(norm) });
  }
  return out;
}

/** Carpeta donde abrir el diálogo de «Del proyecto…» [R48.6]. */
export async function inputBase(project: ProjectFiles): Promise<string> {
  return (await project.getWorkFolder()) ?? project.paths.root;
}

/** Guarda el original de un archivo antes de que un agente lo modifique; solo la primera vez en cada ejecución [R31.6]. */
export async function backupFile(project: ProjectFiles, runId: Id, abs: string, rel: string): Promise<void> {
  if (!isRelativeInside(rel)) throw new StoreError('outside-root', 'Ruta de copia no válida');
  const dest = path.join(project.paths.backupsDir(runId), ...rel.split('/'));
  try {
    await fs.access(dest);
    return;
  } catch {
    /* aún no hay copia */
  }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(abs, dest);
}

export async function listBackups(project: ProjectFiles, runId: Id): Promise<string[]> {
  const root = project.paths.backupsDir(runId);
  const out: string[] = [];
  const walk = async (dir: string, rel: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(path.join(dir, e.name), r);
      else out.push(r);
    }
  };
  await walk(root, '');
  return out.sort();
}

/**
 * Contenido actual y copia previa de un fichero que tocó una ejecución, para el visor [R45.11]. Solo vale para rutas
 * que la ejecución registró en `file.produced` o de las que tiene copia, dentro de la carpeta de trabajo (o la del
 * proyecto) y fuera de `.orquestador`, `.git` y de lo que `blocked` considere secreto.
 */
export async function readRunFile(project: ProjectFiles, runId: Id, rel: string, opts: { blocked?: (rel: string) => boolean; maxBytes?: number } = {}): Promise<RunFileView> {
  const max = opts.maxBytes ?? RUN_FILE_MAX;
  const segs = rel.split('/');
  if (!isRelativeInside(rel) || rel.includes('\\') || segs.some((s) => s === '' || s === '.' || s === '..')) throw new StoreError('outside-root', 'Ruta de fichero no válida');
  if (['.orquestador', '.git'].includes(segs[0]!.toLowerCase()) || opts.blocked?.(rel)) throw new StoreError('outside-root', 'Ese fichero no se puede mostrar: puede contener secretos o es interno');
  const backups = await listBackups(project, runId);
  let recorded = backups.includes(rel);
  if (!recorded) {
    try {
      const { events } = await readRunLog(project.paths.runDir(runId));
      recorded = events.some((e) => e.type === 'file.produced' && e.path.replace(/\\/g, '/') === rel);
    } catch {
      recorded = false;
    }
  }
  if (!recorded) throw new StoreError('not-found', 'Esa ejecución no tocó ese fichero');
  const base = (await project.getWorkFolder()) ?? project.paths.root;
  const read = async (abs: string, root: string): Promise<{ text: string; truncated: boolean; binary: boolean } | undefined> => {
    let real: string;
    try {
      real = await fs.realpath(abs);
    } catch {
      return undefined;
    }
    const realRoot = await fs.realpath(root);
    const inside = path.relative(realRoot, real);
    if (inside.startsWith('..') || path.isAbsolute(inside)) throw new StoreError('outside-root', 'El fichero queda fuera de la carpeta de trabajo');
    const stat = await fs.stat(real);
    if (!stat.isFile()) return undefined;
    const fh = await fs.open(real, 'r');
    try {
      const buf = Buffer.alloc(Math.min(stat.size, max));
      await fh.read(buf, 0, buf.length, 0);
      const binary = buf.subarray(0, 8000).includes(0);
      return { text: binary ? '' : buf.toString('utf8'), truncated: stat.size > max, binary };
    } finally {
      await fh.close();
    }
  };
  const current = await read(path.join(base, ...segs), base);
  const copyRoot = project.paths.backupsDir(runId);
  const before = backups.includes(rel) ? await read(path.join(copyRoot, ...segs), copyRoot) : undefined;
  const binary = (current?.binary ?? false) || (before?.binary ?? false);
  return {
    path: rel,
    missing: current === undefined,
    binary,
    ...(current ? { current: { text: current.text, truncated: current.truncated } } : {}),
    ...(before ? { before: { text: before.text, truncated: before.truncated } } : {}),
  };
}

/** Devuelve un archivo a su estado anterior a la ejecución [R31.6]; `dir`, otra carpeta (el espacio de una rama) [R73.8]. */
export async function restoreBackup(project: ProjectFiles, runId: Id, rel: string, dir?: string): Promise<boolean> {
  if (!isRelativeInside(rel)) throw new StoreError('outside-root', 'Ruta de copia no válida');
  const folder = dir ?? (await project.getWorkFolder());
  if (!folder) throw new StoreError('not-found', 'No hay carpeta de trabajo');
  const from = path.join(project.paths.backupsDir(runId), ...rel.split('/'));
  const to = path.join(folder, ...rel.split('/'));
  try {
    await fs.access(from);
  } catch {
    return false;
  }
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);
  return true;
}
