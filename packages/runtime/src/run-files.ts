import { promises as fs } from 'node:fs';
import { extname } from 'node:path';
import { CONFLICT_PREVIEW_KEY, encodeStepKey, type PathPolicy, type RunEvent, type RunRepository, type WorkspaceFiles } from '@orquestador/core';
import { RunError } from './errors';
import type { RunHistory } from './run-history';
import type { LiveRuns } from './run-types';

export interface OutputFile {
  path: string;
  size: number;
}

export const MAX_READ_BYTES = 1024 * 1024;

/** Vista previa de un archivo de un paso [R54.4]. */
export interface FilePreview {
  path: string;
  kind: 'image' | 'html' | 'markdown' | 'text' | 'other' | 'missing';
  /** De dónde sale: la copia de esta ejecución, la de una anterior (paso reutilizado) o la carpeta tal como está. */
  source?: 'run' | 'previous' | 'live';
  /** Ejecución de la que es la copia. */
  fromRunId?: string;
  /** Imagen como datos. */
  dataUrl?: string;
  /** Web: dirección del protocolo propio de solo lectura. */
  url?: string;
  /** Web sin protocolo propio (memoria, pruebas). */
  srcdoc?: string;
  text?: string;
  truncated?: boolean;
  size?: number;
}

/** Esquema del protocolo propio que sirve las vistas previas [R54.4]. */
export const PREVIEW_SCHEME = 'orq-preview';
const IMAGE_MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.bmp': 'image/bmp', '.ico': 'image/x-icon' };
const IMAGE_MAX = 8 * 1024 * 1024;
const encPath = (rel: string) => rel.split('/').map(encodeURIComponent).join('/');

/** Archivos de una ejecución: vista previa, recursos de webs y resultados [R56.16]. */
export class RunFiles {
  constructor(
    private readonly live: LiveRuns,
    private readonly runs: RunRepository,
    private readonly policy: PathPolicy,
    private readonly files: WorkspaceFiles,
    private readonly history: RunHistory,
    /** Carpeta de la rama aislada en la que trabaja un paso en marcha [R73.19]. */
    private readonly stepDir?: (runId: string, key: string) => string | undefined,
  ) {}

  /** Ruta real de `rel` dentro de `root`, sin salir de ella ni por enlaces; `undefined` si no [R54.4]. */
  private async realInside(root: string, rel: string): Promise<string | undefined> {
    try {
      const real = await fs.realpath(this.files.resolveInside(root, rel));
      const realRoot = await fs.realpath(root);
      return real === realRoot || !real.startsWith(realRoot) || !this.files.resolveInside(realRoot, real.slice(realRoot.length + 1)) ? undefined : real;
    } catch {
      return undefined;
    }
  }

  /** Copia lo que hizo un paso; un fallo no afecta a la ejecución [R54.3]. */
  snapshotStep(runId: string, key: string, files: string[]): Promise<unknown> {
    const take = (workRoot: string) => this.runs.snapshotStep({ runId, workRoot, key, files, blocked: (rel) => this.policy.isSensitive(rel) });
    // En una rama aislada, lo hecho está en su espacio; si se fusionó mientras tanto, en la carpeta [R73.19].
    const space = this.stepDir?.(runId, key);
    return (space ? take(space).then(() => (this.stepDir?.(runId, key) ? undefined : this.runs.workRoot().then(take))) : this.runs.workRoot().then(take)).catch(() => undefined);
  }

  /**
   * Vista previa de un archivo que hizo un paso: la copia de esta ejecución; si el paso se reutilizó, la de la que
   * viene; si no hay copia (ejecución antigua o paso en marcha), el archivo tal como está, si la ejecución lo tocó [R54.4].
   */
  async previewFile(runId: string, key: string, rel: string): Promise<FilePreview> {
    const loc = await this.locatePreview(runId, key, rel);
    if (!loc) return { path: rel, kind: 'missing' };
    const { abs, source, from } = loc;
    const stat = await fs.stat(abs);
    const ext = extname(rel).toLowerCase();
    const base = { path: rel, source, fromRunId: from, size: stat.size };
    if (IMAGE_MIME[ext]) {
      if (stat.size > IMAGE_MAX) return { ...base, kind: 'other' };
      return { ...base, kind: 'image', dataUrl: `data:${IMAGE_MIME[ext]};base64,${(await fs.readFile(abs)).toString('base64')}` };
    }
    if (ext === '.html' || ext === '.htm') {
      const url = source === 'live' ? `${PREVIEW_SCHEME}://live/${encodeURIComponent(runId)}/${encPath(rel)}` : `${PREVIEW_SCHEME}://run/${encodeURIComponent(from)}/${encodeURIComponent(encodeStepKey(key))}/${encPath(rel)}`;
      return { ...base, kind: 'html', url };
    }
    const buf = Buffer.alloc(Math.min(stat.size, MAX_READ_BYTES));
    const fh = await fs.open(abs, 'r');
    try {
      await fh.read(buf, 0, buf.length, 0);
    } finally {
      await fh.close();
    }
    if (buf.subarray(0, 8000).includes(0)) return { ...base, kind: 'other' };
    return { ...base, kind: ext === '.md' || ext === '.markdown' ? 'markdown' : 'text', text: buf.toString('utf8'), truncated: stat.size > MAX_READ_BYTES };
  }

  /** Dónde está el archivo que se previsualiza: copia de esta ejecución, de una anterior o la carpeta [R54.4]. */
  async locatePreview(runId: string, key: string, rel: string): Promise<{ abs: string; source: 'run' | 'previous' | 'live'; from: string } | undefined> {
    if (!this.policy.isPreviewable(rel)) throw new RunError('bad-request', 'Ese archivo no se puede previsualizar');
    if (!(await this.history.list()).some((m) => m.runId === runId)) throw new RunError('not-found', 'No existe esa ejecución');
    // Las dos versiones de un conflicto, guardadas en la ejecución [R73.16].
    if (key === CONFLICT_PREVIEW_KEY) {
      const found = await this.runs.findConflict?.(runId, rel);
      return found ? { abs: found, source: 'run', from: runId } : undefined;
    }
    let abs: string | undefined;
    let from = runId;
    for (const id of await this.history.lineage(runId)) {
      abs = await this.runs.findPreview(id, key, rel);
      if (abs) {
        from = id;
        break;
      }
    }
    if (abs) return { abs, source: from === runId ? 'run' : 'previous', from };
    const events = this.live.find(runId)?.handle.bus.history() ?? (await this.runs.readEvents(runId).catch(() => [] as RunEvent[]));
    if (!events.some((e) => e.type === 'file.produced' && e.path.replace(/\\/g, '/') === rel)) return undefined;
    const real = await this.realInside(this.stepDir?.(runId, key) ?? (await this.runs.workRoot()), rel);
    if (!real || !(await fs.stat(real).then((st) => st.isFile()).catch(() => false))) return undefined;
    return { abs: real, source: 'live', from: runId };
  }

  /**
   * Archivo que pide una web previsualizada por el protocolo propio: solo de la copia de un paso o, en modo «live», de
   * la carpeta de trabajo de una ejecución que lo tocó o lo enlaza; nunca secretos ni carpetas internas [R54.4].
   */
  async previewAsset(url: string): Promise<string | undefined> {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return undefined;
    }
    if (u.protocol !== `${PREVIEW_SCHEME}:`) return undefined;
    let parts: string[];
    try {
      parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    } catch {
      return undefined;
    }
    const known = new Set((await this.history.list()).map((m) => m.runId));
    if (u.hostname === 'run' && parts.length >= 3) {
      const [runId, encKey, ...rest] = parts;
      const rel = rest.join('/');
      if (!known.has(runId!) || !this.policy.isPreviewable(rel)) return undefined;
      const key = encKey!.split('~').map(decodeURIComponent).join('/');
      return this.runs.findPreview(runId!, key, rel);
    }
    if (u.hostname === 'live' && parts.length >= 2) {
      const [runId, ...rest] = parts;
      const rel = rest.join('/');
      if (!known.has(runId!) || !this.policy.isPreviewable(rel)) return undefined;
      const abs = await this.realInside(await this.runs.workRoot(), rel);
      return abs && (await fs.stat(abs).then((s) => s.isFile()).catch(() => false)) ? abs : undefined;
    }
    return undefined;
  }

  // --- resultados (R20.6) --------------------------------------------------------------------

  async listOutput(runId: string): Promise<OutputFile[]> {
    const m = await this.files.manifestOf(this.runs.outputFolder(runId), []);
    return [...m].map(([path, f]) => ({ path, size: f.size })).sort((a, b) => a.path.localeCompare(b.path));
  }

  async readOutput(runId: string, rel: string): Promise<{ text: string; truncated: boolean }> {
    let full: string;
    try {
      full = this.files.resolveInside(this.runs.outputFolder(runId), rel);
    } catch {
      throw new RunError('bad-request', 'Ruta no permitida');
    }
    let fh;
    try {
      fh = await fs.open(full, 'r');
    } catch {
      throw new RunError('not-found', 'No existe ese archivo');
    }
    try {
      const { size } = await fh.stat();
      const len = Math.min(size, MAX_READ_BYTES);
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, 0);
      return { text: buf.toString('utf8'), truncated: size > MAX_READ_BYTES };
    } finally {
      await fh.close();
    }
  }
}
