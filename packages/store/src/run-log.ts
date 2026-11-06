import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  redactString,
  type Diagram,
  type EventBus,
  type Orchestrator,
  type Payload,
  type RunEvent,
  type RunHandle,
  type RunOptions,
  type RunMeta,
  type RunResult,
} from '@orquestador/core';
import { atomicWriteSync } from './fs-util';
import type { ProjectStore } from './project';

export type { RunMeta } from '@orquestador/core';

export const RUN_META_VERSION = 1;

/** Copia del diagrama tal como estaba al arrancar la ejecución (R35.16). */
export const RUN_DIAGRAM_FILE = 'diagram.json';

/** Escribe `events.jsonl` de forma incremental (una línea por evento) y mantiene `meta.json`. */
export class RunLogWriter {
  private fd: number | undefined;
  private unsubscribe: (() => void) | undefined;
  private finalized = false;
  private resolveDone!: () => void;
  /** Se cumple cuando la ejecución ha terminado y los archivos están cerrados. */
  readonly done: Promise<void> = new Promise((r) => (this.resolveDone = r));
  private readonly meta: RunMeta;

  private constructor(
    private readonly runDir: string,
    init: { runId: string; diagramId: string; order?: string; diagram?: Diagram },
  ) {
    mkdirSync(runDir, { recursive: true });
    this.fd = openSync(path.join(runDir, 'events.jsonl'), 'a');
    this.meta = {
      schemaVersion: RUN_META_VERSION,
      runId: init.runId,
      diagramId: init.diagramId,
      startedAt: new Date().toISOString(),
      status: 'running',
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      eventCount: 0,
      ...(init.order !== undefined ? { order: redactString(init.order).slice(0, 200) } : {}),
      ...(init.diagram ? { diagramName: init.diagram.name } : {}),
    };
    if (init.diagram) atomicWriteSync(path.join(runDir, RUN_DIAGRAM_FILE), `${JSON.stringify(init.diagram, null, 2)}\n`);
    this.writeMeta();
  }

  static attach(
    bus: EventBus,
    runDir: string,
    init: { diagramId: string; order?: string; diagram?: Diagram },
  ): RunLogWriter {
    const writer = new RunLogWriter(runDir, { runId: bus.runId, ...init });
    // fromSeq 1: también recoge lo emitido antes de engancharse.
    const off = bus.subscribe((e) => writer.onEvent(e), { fromSeq: 1 });
    if (writer.finalized) off();
    else writer.unsubscribe = off;
    return writer;
  }

  private writeMeta(): void {
    atomicWriteSync(path.join(this.runDir, 'meta.json'), `${JSON.stringify(this.meta, null, 2)}\n`);
  }

  private onEvent(e: RunEvent): void {
    if (this.fd === undefined) return;
    writeSync(this.fd, `${JSON.stringify(e)}\n`);
    this.meta.eventCount++;
    if (e.type === 'run.started') {
      this.meta.startedAt = e.ts;
      if (e.resumedFrom) this.meta.resumedFrom = e.resumedFrom;
      if (e.correctedFrom) this.meta.correctedFrom = e.correctedFrom;
    }
    if (e.type === 'agent.usage') {
      this.meta.usage.inputTokens += e.inputTokens;
      this.meta.usage.outputTokens += e.outputTokens;
      this.meta.usage.costUsd += e.costUsd ?? 0;
      // Se guarda al momento: si la aplicación se cierra a medias, el uso de lo hecho no se pierde (R35.15).
      this.writeMeta();
    }
    if (e.type === 'deliverable.done') this.writeDeliverable(e);
    if (e.type === 'run.finished') {
      this.meta.status = e.status;
      this.meta.finishedAt = e.ts;
      if (e.reason !== undefined) this.meta.reason = e.reason;
      this.close();
    }
  }

  /** Guarda el entregable en `output/` y anota si quedó algo sin completar [R46.11]. */
  private writeDeliverable(e: Extract<RunEvent, { type: 'deliverable.done' }>): void {
    try {
      const name = /^[a-z0-9][a-z0-9_-]{0,40}$/.test(e.fileName) ? e.fileName : 'entregable';
      const dir = path.join(this.runDir, 'output');
      mkdirSync(dir, { recursive: true });
      atomicWriteSync(path.join(dir, `${name}.md`), e.markdown);
      if (e.json !== undefined) atomicWriteSync(path.join(dir, `${name}.json`), `${e.json}\n`);
    } catch {
      // No poder escribir el archivo no debe romper el registro: el entregable sigue en events.jsonl.
    }
    if (!e.ok) {
      const missing = e.items.filter((i) => !i.ok).map((i) => i.title).join(', ');
      this.meta.warnings = [...(this.meta.warnings ?? []), `El entregable no se pudo completar del todo (${missing}).`];
      this.writeMeta();
    }
  }

  /** Cierra los archivos y deja `meta.json` actualizado. Es seguro llamarlo más de una vez. */
  close(): void {
    if (this.finalized) return;
    this.finalized = true;
    this.unsubscribe?.();
    if (this.fd !== undefined) {
      closeSync(this.fd);
      this.fd = undefined;
    }
    this.writeMeta();
    this.resolveDone();
  }
}

export interface LoadedRunLog {
  events: RunEvent[];
  /** El último registro estaba incompleto (cierre inesperado) y se ha ignorado. */
  truncated: boolean;
  /** Líneas intermedias ilegibles que se han saltado. */
  corruptLines: number;
}

export async function readRunLog(runDir: string): Promise<LoadedRunLog> {
  const text = await fs.readFile(path.join(runDir, 'events.jsonl'), 'utf8');
  const lines = text.split('\n');
  const endsClean = text.endsWith('\n');
  const events: RunEvent[] = [];
  let truncated = false;
  let corruptLines = 0;
  lines.forEach((line, i) => {
    if (line === '') return;
    const isLast = i === lines.length - 1 || (i === lines.length - 2 && endsClean && lines[i + 1] === '');
    try {
      events.push(JSON.parse(line) as RunEvent);
    } catch {
      if (isLast && !endsClean) truncated = true;
      else corruptLines++;
    }
  });
  return { events, truncated, corruptLines };
}

/** Diagrama guardado al arrancar la ejecución; `null` si es una ejecución anterior que no lo guardó (R35.16). */
export async function readRunDiagram(runDir: string): Promise<Diagram | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(runDir, RUN_DIAGRAM_FILE), 'utf8')) as Diagram;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function readRunMeta(runDir: string): Promise<RunMeta> {
  return JSON.parse(await fs.readFile(path.join(runDir, 'meta.json'), 'utf8')) as RunMeta;
}

/**
 * Lista las ejecuciones a partir de sus `meta.json` (sin leer `events.jsonl`), de la más reciente a la más antigua.
 * Una ejecución que figura como `running` pero no está viva se muestra como `interrupted`.
 */
export async function listRuns(runsDir: string, opts: { live?: ReadonlySet<string> } = {}): Promise<RunMeta[]> {
  let names: string[];
  try {
    names = await fs.readdir(runsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const metas: RunMeta[] = [];
  for (const name of names) {
    try {
      const meta = await readRunMeta(path.join(runsDir, name));
      if (meta.status === 'running' && !opts.live?.has(meta.runId)) meta.status = 'interrupted';
      metas.push(meta);
    } catch {
      // carpeta sin meta.json legible: se ignora
    }
  }
  return metas.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export interface RetentionPolicy {
  /** Máximo de ejecuciones terminadas a conservar (las más recientes). */
  maxRuns?: number;
  maxAgeMs?: number;
  now?: Date;
  live?: ReadonlySet<string>;
}

/** Borra ejecuciones antiguas según la política. Nunca borra las que están en curso. */
export async function applyRetention(runsDir: string, policy: RetentionPolicy): Promise<string[]> {
  const runs = await listRuns(runsDir, policy.live ? { live: policy.live } : {});
  const now = (policy.now ?? new Date()).getTime();
  const removable = runs.filter((r) => r.status !== 'running');
  const doomed = new Set<string>();
  if (policy.maxRuns !== undefined) {
    removable.slice(Math.max(0, policy.maxRuns)).forEach((r) => doomed.add(r.runId));
  }
  if (policy.maxAgeMs !== undefined) {
    for (const r of removable) {
      if (now - new Date(r.startedAt).getTime() > policy.maxAgeMs) doomed.add(r.runId);
    }
  }
  for (const id of doomed) await fs.rm(path.join(runsDir, id), { recursive: true, force: true });
  return [...doomed];
}

/** Anota en la ejecución anterior qué ejecución la reanudó [R41.2]. */
export async function markResumedBy(runDir: string, newRunId: string): Promise<void> {
  const meta = await readRunMeta(runDir);
  atomicWriteSync(path.join(runDir, 'meta.json'), `${JSON.stringify({ ...meta, resumedBy: newRunId }, null, 2)}\n`);
}

/** Anota en la ejecución anterior una ejecución que la corrigió [R53.11]. */
export async function markCorrectedBy(runDir: string, newRunId: string): Promise<void> {
  const meta = await readRunMeta(runDir);
  const list = [...(meta.correctedBy ?? []).filter((id) => id !== newRunId), newRunId];
  atomicWriteSync(path.join(runDir, 'meta.json'), `${JSON.stringify({ ...meta, correctedBy: list }, null, 2)}\n`);
}

export const DISMISS_REASON = 'Se interrumpió y la cancelaste';

/**
 * Cierra como cancelada una ejecución interrumpida: añade `run.finished` a su registro y actualiza `meta.json`
 * [R41.3]. Una ejecución que ya terminó no se toca.
 */
export async function dismissInterruptedRun(runDir: string, now: Date = new Date()): Promise<boolean> {
  const meta = await readRunMeta(runDir);
  if (meta.status !== 'running') return false;
  const { events } = await readRunLog(runDir);
  const seq = events.reduce((m, e) => Math.max(m, e.seq), 0) + 1;
  const ts = now.toISOString();
  const event = { runId: meta.runId, seq, ts, type: 'run.finished', status: 'cancelled', reason: DISMISS_REASON } as RunEvent;
  const file = path.join(runDir, 'events.jsonl');
  // Si el último registro quedó a medias (cierre inesperado), el nuevo va en su propia línea.
  const text = await fs.readFile(file, 'utf8');
  await fs.appendFile(file, `${text === '' || text.endsWith('\n') ? '' : '\n'}${JSON.stringify(event)}\n`);
  atomicWriteSync(path.join(runDir, 'meta.json'), `${JSON.stringify({ ...meta, status: 'cancelled', finishedAt: ts, reason: DISMISS_REASON, eventCount: meta.eventCount + 1 }, null, 2)}\n`);
  return true;
}

/** Arranca una ejecución y la registra en `.orquestador/runs/<runId>/`. */
export function startLoggedRun(
  orch: Orchestrator,
  project: ProjectStore,
  diagram: Diagram,
  order: string | Payload,
  options?: RunOptions,
): { handle: RunHandle; logged: Promise<RunResult> } {
  const handle = orch.start(diagram, order, options);
  const writer = RunLogWriter.attach(handle.bus, project.paths.runDir(handle.runId), {
    diagramId: diagram.id,
    order: typeof order === 'string' ? order : order.text,
    diagram,
  });
  const logged = handle.result.then(async (result) => {
    await writer.done;
    return result;
  });
  return { handle, logged };
}
