import { promises as fs } from 'node:fs';
import { extname, join } from 'node:path';
import { isSensitivePath } from '@orquestador/claude';
import {
  approvedReviews,
  canResume,
  correctionPlan,
  correctionTargets,
  deliverableProblems,
  resumePlan,
  validateDiagram,
  type DeliverableSpec,
  type Diagram,
  type Orchestrator,
  type Payload,
  type PendingQuestion,
  type RunEvent,
  type RunHandle,
  type RunOptions,
} from '@orquestador/core';
import { MAX_INPUT_FILES, dismissInterruptedRun, encodeStepKey, findPreview, listRuns, markCorrectedBy, markResumedBy, safePreviewPath, snapshotStep, readRunDiagram, readRunLog, startLoggedRun, type ProjectStore, type RunMeta } from '@orquestador/store';
import { manifestOf, resolveInside } from '@orquestador/workspace';
import { RunError } from './errors';
import { takeSnapshot, type LibrarySnapshot, type RunSnapshots } from './snapshot';

export interface StartRunInput {
  diagramId: string;
  order: string;
  maxTokens?: number;
  maxCostUsd?: number;
  /** Entregable solo para esta ejecución; sustituye al del diagrama y `null` lo quita [R46.11]. */
  deliverable?: DeliverableSpec | null;
  /** Archivos del proyecto (rutas relativas a la carpeta de trabajo) para la entrada [R48.5]. */
  files?: string[];
  /** Adjuntos preparados con `stageAttachment` [R48.5]. */
  attachments?: string[];
  /** Si ya hay otra de este diagrama: a la vez (por defecto) o en cola [R52.3]. */
  whenBusy?: 'parallel' | 'queue';
}

/** Un lanzamiento en la cola de su diagrama [R52.3]. */
export interface QueuedRun {
  queuedId: string;
  diagramId: string;
  diagramName: string;
  order: string;
  /** ISO 8601. */
  at: string;
}

interface QueueEntry extends QueuedRun {
  diagram: Diagram;
  payload: string | Payload;
  options: RunOptions;
  snapshot?: LibrarySnapshot;
}

export interface OutputFile {
  path: string;
  size: number;
}

export const MAX_READ_BYTES = 1024 * 1024;

interface Live {
  handle: RunHandle;
  finished: boolean;
  diagram: Diagram;
  /** Copias para la vista previa en curso; `settled` las espera [R54.3]. */
  previews: Promise<unknown>[];
}

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

/** Ruta real de `rel` dentro de `root`, sin salir de ella ni por enlaces; `undefined` si no [R54.4]. */
async function realInside(root: string, rel: string): Promise<string | undefined> {
  try {
    const real = await fs.realpath(resolveInside(root, rel));
    const realRoot = await fs.realpath(root);
    return real === realRoot || !real.startsWith(realRoot) || !resolveInside(realRoot, real.slice(realRoot.length + 1)) ? undefined : real;
  } catch {
    return undefined;
  }
}



/** Arranca, controla y observa ejecuciones del proyecto abierto. */
export class RunService {
  private readonly runs = new Map<string, Live>();
  private queue: QueueEntry[] = [];
  private queueSeq = 0;

  constructor(
    private readonly store: ProjectStore,
    private readonly orchestrator: Orchestrator,
    /** Opciones por defecto de cada ejecución (p. ej. agentes en paralelo de los ajustes) [R23.6]. */
    private readonly defaults: () => RunOptions = () => ({}),
    /** Copias de lo que usa cada ejecución; las comparte con el motor [R52.1]. */
    private readonly snapshots?: RunSnapshots,
  ) {}

  /** ¿Hay alguna ejecución de este diagrama en marcha? */
  private hasLive(diagramId: string): boolean {
    return [...this.runs.values()].some((l) => !l.finished && l.diagram.id === diagramId);
  }

  /**
   * Arranca una ejecución con su copia [R52.1]. La copia se registra antes de que empiece ningún paso (el
   * orquestador no ejecuta nada hasta el siguiente turno) y se suelta al terminar; entonces arranca la siguiente
   * de la cola de su diagrama [R52.3].
   */
  private launch(diagram: Diagram, order: string | Payload, options: RunOptions, snapshot?: LibrarySnapshot): Live {
    const { handle, logged } = startLoggedRun(this.orchestrator, this.store, diagram, order, options);
    if (snapshot) this.snapshots?.set(handle.runId, snapshot);
    const live: Live = { handle, finished: false, diagram, previews: [] };
    this.runs.set(handle.runId, live);
    // Al terminar bien un paso, se copia lo que hizo para que la ejecución lo enseñe siempre igual [R54.3].
    const touched = new Map<string, Set<string>>();
    handle.bus.subscribe(
      (e) => {
        if (e.type !== 'file.produced' && e.type !== 'node.finished') return;
        const key = [...(e.nodePath ?? []), e.nodeId].join('/');
        if (e.type === 'file.produced') {
          (touched.get(key) ?? touched.set(key, new Set()).get(key)!).add(e.path.replace(/\\/g, '/'));
          return;
        }
        const files = touched.get(key);
        touched.delete(key);
        if (e.status === 'succeeded' && files && files.size > 0) live.previews.push(this.snapshotStep(handle.runId, key, [...files]));
      },
      { fromSeq: 1 },
    );
    const done = () => {
      live.finished = true;
      this.snapshots?.delete(handle.runId);
      this.drain(diagram.id);
    };
    void logged.then(done, done);
    return live;
  }

  /** Arranca el primero de la cola de un diagrama si ya no queda ninguna en marcha [R52.3]. */
  private drain(diagramId: string): void {
    while (!this.hasLive(diagramId)) {
      const i = this.queue.findIndex((q) => q.diagramId === diagramId);
      if (i < 0) return;
      const [next] = this.queue.splice(i, 1);
      try {
        this.launch(next!.diagram, next!.payload, next!.options, next!.snapshot);
      } catch {
        /* si no arranca, se pasa a la siguiente */
      }
    }
  }

  /** Lanzamientos en cola, en orden [R52.3]. */
  queued(): QueuedRun[] {
    return this.queue.map(({ queuedId, diagramId, diagramName, order, at }) => ({ queuedId, diagramId, diagramName, order, at }));
  }

  /** Quita un lanzamiento de la cola; `false` si ya no estaba [R52.3]. */
  unqueue(queuedId: string): boolean {
    const before = this.queue.length;
    this.queue = this.queue.filter((q) => q.queuedId !== queuedId);
    return this.queue.length < before;
  }

  /** R20.1: arranca ya, aunque haya otras del mismo diagrama [R52.2]. */
  async start(input: StartRunInput): Promise<{ runId: string }> {
    const p = await this.prepare(input);
    return { runId: this.launch(p.diagram, p.order, p.options, p.snapshot).handle.runId };
  }

  /** Lanza según `whenBusy`: a la vez, o en la cola del diagrama si ya hay alguna en marcha o en cola [R52.3]. */
  async submit(input: StartRunInput): Promise<{ runId: string } | { queuedId: string }> {
    const p = await this.prepare(input);
    if (input.whenBusy === 'queue' && (this.hasLive(p.diagram.id) || this.queue.some((q) => q.diagramId === p.diagram.id))) {
      const queuedId = `q${++this.queueSeq}`;
      this.queue.push({ queuedId, diagramId: p.diagram.id, diagramName: p.diagram.name, order: input.order, at: new Date().toISOString(), diagram: p.diagram, payload: p.order, options: p.options, ...(p.snapshot ? { snapshot: p.snapshot } : {}) });
      return { queuedId };
    }
    return { runId: this.launch(p.diagram, p.order, p.options, p.snapshot).handle.runId };
  }

  private async prepare(input: StartRunInput): Promise<{ diagram: Diagram; order: string | Payload; options: RunOptions; snapshot?: LibrarySnapshot }> {
    const diagram = await this.store.diagrams.load(input.diagramId);
    const issues = validateDiagram(diagram);
    if (issues.length > 0) {
      throw new RunError('invalid-diagram', `El diagrama tiene ${issues.length} problema(s): ${issues[0]!.message}`);
    }
    const options: RunOptions = { ...this.defaults() };
    if (input.deliverable === null) options.deliverable = null;
    else if (input.deliverable !== undefined) {
      const problems = deliverableProblems(input.deliverable);
      if (problems.length > 0) throw new RunError('bad-request', `Entregable no válido: ${problems[0]!.message}`);
      options.deliverable = input.deliverable;
    }
    if (input.maxTokens !== undefined || input.maxCostUsd !== undefined) {
      options.budget = {
        ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
        ...(input.maxCostUsd !== undefined ? { maxCostUsd: input.maxCostUsd } : {}),
      };
    }
    const order = await this.inputPayload(input);
    const snapshot = this.snapshots ? await takeSnapshot(this.store, diagram) : undefined;
    return { diagram, order, options, ...(snapshot ? { snapshot } : {}) };
  }

  /** Entrada del primer paso: el texto y los archivos del proyecto y adjuntos, como rutas relativas [R48.5]. */
  private async inputPayload(input: StartRunInput): Promise<string | Payload> {
    const files = input.files ?? [];
    const attachments = input.attachments ?? [];
    if (files.length + attachments.length === 0) {
      if (!input.order.trim()) throw new RunError('bad-request', 'Escribe la entrada o adjunta algún archivo');
      return input.order;
    }
    if (files.length + attachments.length > MAX_INPUT_FILES) throw new RunError('bad-request', `Como mucho ${MAX_INPUT_FILES} archivos en la entrada`);
    try {
      const own = (await this.store.inputFiles(files)).map((f) => f.path);
      const att: string[] = [];
      for (const id of attachments) att.push(await this.store.attachmentInputPath(id));
      return { text: input.order, files: [...new Set([...own, ...att])] };
    } catch (e) {
      throw new RunError('bad-request', e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Reanuda una ejecución interrumpida, fallida o cancelada: arranca otra con el diagrama de entonces y la misma
   * entrada, reutilizando lo que ya terminó bien [R41.1][R41.2].
   */
  async resumeRun(runId: string): Promise<{ runId: string }> {
    const meta = (await this.list()).find((m) => m.runId === runId);
    if (!meta) throw new RunError('not-found', 'No existe esa ejecución');
    if (!canResume(meta.status, meta.resumedBy)) {
      throw new RunError('bad-request', meta.resumedBy ? 'Esta ejecución ya se reanudó: reanuda la nueva.' : 'Solo se reanuda una ejecución interrumpida, fallida o cancelada.');
    }
    const dir = this.store.paths.runDir(runId);
    const { events } = await readRunLog(dir);
    const diagram = (await readRunDiagram(dir)) ?? (await this.store.diagrams.load(meta.diagramId));
    const entry = events.find((e): e is Extract<RunEvent, { type: 'node.started' }> => e.type === 'node.started' && e.nodeId === 'entry' && !e.nodePath?.length);
    const order = entry?.input ?? meta.order ?? '';
    // El entregable con el que arrancó la anterior, aunque se hubiera cambiado solo para ella [R46.11].
    const started = events.find((e): e is Extract<RunEvent, { type: 'run.started' }> => e.type === 'run.started');
    const options: RunOptions = { ...this.defaults(), reuse: { fromRunId: runId, outputs: resumePlan(diagram, events), approvedReviews: approvedReviews(diagram, events) }, ...(started?.deliverable ? { deliverable: started.deliverable } : {}) };
    // Reanudar hace una copia nueva de la biblioteca [R52.1].
    const snapshot = this.snapshots ? await takeSnapshot(this.store, diagram) : undefined;
    const { handle } = this.launch(diagram, order, options, snapshot);
    await markResumedBy(dir, handle.runId);
    return { runId: handle.runId };
  }

  /** Diagrama, eventos, entrada y entregable de una ejecución que ya no está en marcha [R53.11]. */
  private async finishedRun(runId: string): Promise<{ diagram: Diagram; events: RunEvent[]; order: string | Payload; deliverable?: DeliverableSpec }> {
    if (this.runs.get(runId)?.finished === false) throw new RunError('bad-request', 'Está en marcha: se corrige cuando termine.');
    const meta = (await this.list()).find((m) => m.runId === runId);
    if (!meta) throw new RunError('not-found', 'No existe esa ejecución');
    const dir = this.store.paths.runDir(runId);
    const { events } = await readRunLog(dir);
    const diagram = (await readRunDiagram(dir)) ?? (await this.store.diagrams.load(meta.diagramId));
    const entry = events.find((e): e is Extract<RunEvent, { type: 'node.started' }> => e.type === 'node.started' && e.nodeId === 'entry' && !e.nodePath?.length);
    const started = events.find((e): e is Extract<RunEvent, { type: 'run.started' }> => e.type === 'run.started');
    return { diagram, events, order: entry?.input ?? meta.order ?? '', ...(started?.deliverable ? { deliverable: started.deliverable } : {}) };
  }

  /** Pasos que se pueden corregir y cuál propone el asistente [R53.10][R53.11]. */
  async proposeCorrection(runId: string, text: string, prefer?: string): Promise<{ candidates: { nodeId: string; label: string }[]; proposal: { nodeId: string; reason: string } }> {
    const run = await this.finishedRun(runId);
    try {
      return await this.orchestrator.proposeCorrection({ diagram: run.diagram, events: run.events, text: text.trim(), ...(prefer ? { prefer } : {}) });
    } catch (e) {
      throw new RunError('bad-request', e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Corrige una ejecución que ya no está en marcha: arranca otra con el diagrama y la entrada de entonces, reutiliza
   * lo anterior al paso elegido y le pasa la corrección [R53.11].
   */
  async correctRun(runId: string, req: { text: string; nodeId: string; files?: string[]; attachments?: string[] }): Promise<{ runId: string }> {
    const text = req.text.trim();
    if (!text) throw new RunError('bad-request', 'Escribe qué hay que corregir');
    const run = await this.finishedRun(runId);
    if (!correctionTargets(run.diagram, run.events).includes(req.nodeId)) throw new RunError('bad-request', 'Ese paso no se puede corregir en esta ejecución');
    const plan = correctionPlan(run.diagram, run.events, req.nodeId);
    let files: string[] = [];
    if ((req.files?.length ?? 0) + (req.attachments?.length ?? 0) > 0) {
      const extra = await this.inputPayload({ diagramId: run.diagram.id, order: text, ...(req.files ? { files: req.files } : {}), ...(req.attachments ? { attachments: req.attachments } : {}) });
      files = typeof extra === 'string' ? [] : extra.files;
    }
    const options: RunOptions = {
      ...this.defaults(),
      reuse: { fromRunId: runId, outputs: plan.outputs, approvedReviews: plan.approvedReviews },
      correction: { fromRunId: runId, nodeId: req.nodeId, text, previous: plan.previous!, ...(files.length > 0 ? { files } : {}) },
      ...(run.deliverable ? { deliverable: run.deliverable } : {}),
    };
    const snapshot = this.snapshots ? await takeSnapshot(this.store, run.diagram) : undefined;
    const { handle } = this.launch(run.diagram, run.order, options, snapshot);
    await markCorrectedBy(this.store.paths.runDir(runId), handle.runId);
    return { runId: handle.runId };
  }

  /** Cierra como cancelada una ejecución interrumpida [R41.3]. */
  async dismiss(runId: string): Promise<boolean> {
    if (this.runs.get(runId)?.finished === false) throw new RunError('bad-request', 'Está en marcha: cancélala desde su vista.');
    return dismissInterruptedRun(this.store.paths.runDir(runId));
  }

  private live(runId: string): Live {
    const live = this.runs.get(runId);
    if (!live) throw new RunError('not-found', 'No existe esa ejecución en curso');
    return live;
  }

  /** R20.2 */
  pause(runId: string): void {
    this.live(runId).handle.pause();
  }
  resume(runId: string): void {
    this.live(runId).handle.resume();
  }
  cancel(runId: string): void {
    this.live(runId).handle.cancel('Cancelada por el usuario');
  }
  /** Cancela todas las ejecuciones en curso y vacía la cola, p. ej. al cerrar el proyecto [R28.7][R52.3]. */
  cancelAll(): void {
    this.queue = [];
    for (const live of this.runs.values()) if (!live.finished) live.handle.cancel('Proyecto cerrado');
  }
  answer(runId: string, questionId: string, text: string): boolean {
    return this.live(runId).handle.answer(questionId, text);
  }

  /** R20.5 */
  pending(runId: string): PendingQuestion[] {
    return this.live(runId).handle.pendingQuestions();
  }

  /** Diagrama tal como estaba al arrancar la ejecución; `null` si no se guardó (R35.16). */
  async runDiagram(runId: string): Promise<Diagram | null> {
    return readRunDiagram(this.store.paths.runDir(runId));
  }

  async list(): Promise<RunMeta[]> {
    const alive = new Set([...this.runs].filter(([, l]) => !l.finished).map(([id]) => id));
    return listRuns(this.store.paths.runsDir, { live: alive });
  }

  /**
   * R20.3: devuelve el historial desde `fromSeq` y registra `onLive` para lo que llegue después.
   * Para ejecuciones vivas o de esta sesión usa el bus (sin huecos ni duplicados); si no, lee el disco.
   */
  async subscribe(
    runId: string,
    fromSeq: number,
    onLive: (event: RunEvent) => void,
  ): Promise<{ backlog: RunEvent[]; unsubscribe: () => void }> {
    if (!Number.isInteger(fromSeq) || fromSeq < 1) throw new RunError('bad-request', 'fromSeq debe ser un entero ≥ 1');
    const live = this.runs.get(runId);
    if (live) {
      const backlog: RunEvent[] = [];
      let replaying = true;
      const unsubscribe = live.handle.bus.subscribe(
        (e) => (replaying ? backlog.push(e) : onLive(e)),
        { fromSeq },
      );
      replaying = false;
      return { backlog, unsubscribe };
    }
    try {
      const { events } = await readRunLog(this.store.paths.runDir(runId));
      return { backlog: events.filter((e) => e.seq >= fromSeq), unsubscribe: () => {} };
    } catch {
      throw new RunError('not-found', 'No existe esa ejecución');
    }
  }

  isFinished(runId: string): boolean {
    return this.runs.get(runId)?.finished ?? true;
  }

  /** Espera a que termine la ejecución y se haya escrito su registro (útil para tests y cierre). */
  async settled(runId: string): Promise<void> {
    await this.live(runId).handle.result;
    for (let i = 0; i < 200 && !this.live(runId).finished; i++) await new Promise((r) => setTimeout(r, 5));
    await Promise.allSettled(this.live(runId).previews);
  }

  // --- vista previa (SPEC-054) ---------------------------------------------------------------

  private async workRoot(): Promise<string> {
    return (await this.store.getWorkFolder()) ?? this.store.paths.root;
  }

  private snapshotStep(runId: string, key: string, files: string[]): Promise<unknown> {
    return this.workRoot()
      .then((workRoot) => snapshotStep({ runDir: this.store.paths.runDir(runId), workRoot, key, files, blocked: (rel) => isSensitivePath(rel) }))
      .catch(() => undefined);
  }

  /** Ejecución y las anteriores de las que viene (reanudada o corregida), hasta 5 [R54.4]. */
  private async lineage(runId: string): Promise<string[]> {
    const metas = new Map((await this.list()).map((m) => [m.runId, m]));
    const out = [runId];
    let cur = metas.get(runId);
    while (cur && out.length < 6) {
      const prev = cur.correctedFrom ?? cur.resumedFrom;
      if (!prev || out.includes(prev)) break;
      out.push(prev);
      cur = metas.get(prev);
    }
    return out;
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
    if (!safePreviewPath(rel) || isSensitivePath(rel)) throw new RunError('bad-request', 'Ese archivo no se puede previsualizar');
    if (!(await this.list()).some((m) => m.runId === runId)) throw new RunError('not-found', 'No existe esa ejecución');
    let abs: string | undefined;
    let from = runId;
    for (const id of await this.lineage(runId)) {
      abs = await findPreview(this.store.paths.runDir(id), key, rel);
      if (abs) {
        from = id;
        break;
      }
    }
    if (abs) return { abs, source: from === runId ? 'run' : 'previous', from };
    const events = this.runs.get(runId)?.handle.bus.history() ?? (await readRunLog(this.store.paths.runDir(runId)).then((l) => l.events).catch(() => [] as RunEvent[]));
    if (!events.some((e) => e.type === 'file.produced' && e.path.replace(/\\/g, '/') === rel)) return undefined;
    const live = await realInside(await this.workRoot(), rel);
    if (!live || !(await fs.stat(live).then((st) => st.isFile()).catch(() => false))) return undefined;
    return { abs: live, source: 'live', from: runId };
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
    const known = new Set((await this.list()).map((m) => m.runId));
    if (u.hostname === 'run' && parts.length >= 3) {
      const [runId, encKey, ...rest] = parts;
      const rel = rest.join('/');
      if (!known.has(runId!) || !safePreviewPath(rel) || isSensitivePath(rel)) return undefined;
      const key = encKey!.split('~').map(decodeURIComponent).join('/');
      return findPreview(this.store.paths.runDir(runId!), key, rel);
    }
    if (u.hostname === 'live' && parts.length >= 2) {
      const [runId, ...rest] = parts;
      const rel = rest.join('/');
      if (!known.has(runId!) || !safePreviewPath(rel) || isSensitivePath(rel)) return undefined;
      const abs = await realInside(await this.workRoot(), rel);
      return abs && (await fs.stat(abs).then((s) => s.isFile()).catch(() => false)) ? abs : undefined;
    }
    return undefined;
  }

  // --- resultados (R20.6) --------------------------------------------------------------------

  private outputDir(runId: string): string {
    return join(this.store.paths.runDir(runId), 'output');
  }

  async listOutput(runId: string): Promise<OutputFile[]> {
    const m = await manifestOf(this.outputDir(runId), []);
    return [...m].map(([path, f]) => ({ path, size: f.size })).sort((a, b) => a.path.localeCompare(b.path));
  }

  async readOutput(runId: string, rel: string): Promise<{ text: string; truncated: boolean }> {
    let full: string;
    try {
      full = resolveInside(this.outputDir(runId), rel);
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
