import type { Diagram, MemoryEntry, Orchestrator, PendingQuestion, RunAcceptance, RunEvent, RunMeta, RunOptions } from '@orquestador/core';
import { RunControl } from './run-control';
import { RunCorrections } from './run-corrections';
import { RunFeedback } from './run-feedback';
import { RunMemory } from './run-memory';
import { RunError } from './errors';
import { RunFiles, type FilePreview, type OutputFile } from './run-files';
import { RunHistory } from './run-history';
import { RunLauncher } from './run-launcher';
import { RunQueue, type QueuedRun, type RunWatcher } from './run-queue';
import { LiveRuns, type RunPorts, type StartRunInput } from './run-types';
import type { RunSnapshots } from './snapshot';

export type { StartRunInput, RunPorts } from './run-types';
export type { QueuedRun, RunWatcher } from './run-queue';
export { MAX_READ_BYTES, PREVIEW_SCHEME, type FilePreview, type OutputFile } from './run-files';

/** Arranca, controla y observa ejecuciones del proyecto abierto. Fachada de las piezas de R56.16. */
export class RunService {
  private readonly control: RunControl;
  private readonly corrections: RunCorrections;
  private readonly files: RunFiles;
  private readonly history: RunHistory;
  private readonly launcher: RunLauncher;
  private readonly queue: RunQueue;

  constructor(
    ports: RunPorts,
    orchestrator: Orchestrator,
    /** Opciones por defecto de cada ejecución (p. ej. agentes en paralelo de los ajustes) [R23.6]. */
    defaults: () => RunOptions = () => ({}),
    /** Copias de lo que usa cada ejecución; las comparte con el motor [R52.1]. */
    snapshots?: RunSnapshots,
  ) {
    const live = new LiveRuns();
    this.history = new RunHistory(live, ports.runs, ports.library);
    this.files = new RunFiles(live, ports.runs, ports.policy, ports.files, this.history, ports.stepDir ? (runId, key) => ports.stepDir!(runId, key) : undefined);
    this.launcher = new RunLauncher(ports.runs, ports.library, defaults, snapshots);
    this.memory = ports.memory ? new RunMemory(ports.runs, orchestrator, ports.memory) : undefined;
    this.queue = new RunQueue(live, ports.runs, orchestrator, snapshots, (runId, key, files) => this.files.snapshotStep(runId, key, files), (runId, diagram) => void this.proposeAfter(runId, diagram));
    this.control = new RunControl(live);
    this.corrections = new RunCorrections(live, ports.runs, orchestrator, this.history, this.launcher, this.queue);
    this.feedback = new RunFeedback(live, ports.runs);
  }

  private readonly feedback: RunFeedback;
  private readonly memory: RunMemory | undefined;
  /** Propuestas pendientes, para esperar a ellas (pruebas y cierre). */
  private readonly proposing = new Map<string, Promise<unknown>>();
  private readonly memoryWatchers = new Set<(n: { runId: string; diagramName: string; count: number }) => void>();

  /** Al terminar, qué recordar; un fallo aquí no afecta a la ejecución [R76.5]. */
  private proposeAfter(runId: string, diagram: Diagram): void {
    if (!this.memory) return;
    const job = this.memory
      .afterRun(runId)
      .then((ps) => {
        if (ps.length > 0) for (const w of this.memoryWatchers) w({ runId, diagramName: diagram.name, count: ps.length });
      })
      .catch(() => undefined)
      .finally(() => this.proposing.delete(runId));
    this.proposing.set(runId, job);
  }

  /** Avisa cuando una ejecución deja cosas para recordar (para la bandeja) [R76.10]. */
  onMemoryProposals(watcher: (n: { runId: string; diagramName: string; count: number }) => void): () => void {
    this.memoryWatchers.add(watcher);
    return () => void this.memoryWatchers.delete(watcher);
  }

  /** Espera a que estén las propuestas de una ejecución [R76.8]. */
  async memoryProposed(runId: string): Promise<void> {
    await this.settled(runId);
    await this.proposing.get(runId);
  }

  private requireMemory(): RunMemory {
    if (!this.memory) throw new RunError('bad-request', 'Este proyecto no tiene memoria');
    return this.memory;
  }

  /** «Guardar», «Editar y guardar» o «Descartar» una propuesta [R76.10]. */
  decideMemory(runId: string, req: Parameters<RunMemory['decide']>[1]): Promise<MemoryEntry[]> {
    return this.requireMemory().decide(runId, req);
  }

  /** La pantalla de memoria: listar y editar, archivar o restaurar [R76.21]. */
  projectMemory(): Promise<MemoryEntry[]> {
    return this.requireMemory().list();
  }

  saveMemoryEntry(entry: Parameters<RunMemory['upsert']>[0], by: 'user' | 'assistant' = 'user'): Promise<MemoryEntry[]> {
    return this.requireMemory().upsert(entry, by);
  }

  /** «No era un problema» / «Sí lo era» en un aviso del Supervisor [R75.21]. */
  supervisorFeedback(runId: string, req: { alertSeq: number; verdict: 'false-alarm' | 'confirmed'; note?: string }): Promise<boolean> {
    return this.feedback.give(runId, req);
  }

  /** Cuánto acierta el Supervisor, por regla [R75.22]. */
  supervisorStats(runId: string): ReturnType<RunFeedback['stats']> {
    return this.feedback.stats(runId);
  }

  /** Escucha todas las ejecuciones, no solo la que muestra la interfaz [R61.9]. */
  watch(watcher: RunWatcher): () => void {
    return this.queue.watch(watcher);
  }

  /** Cuántas ejecuciones siguen en marcha [R61.9]. */
  runningCount(): number {
    return this.queue.runningCount();
  }

  /** Lanzamientos en cola, en orden [R52.3]. */
  queued(): QueuedRun[] {
    return this.queue.queued();
  }

  /** Quita un lanzamiento de la cola; `false` si ya no estaba [R52.3]. */
  unqueue(queuedId: string): boolean {
    return this.queue.unqueue(queuedId);
  }

  /** R20.1: arranca ya, aunque haya otras del mismo diagrama [R52.2]. */
  async start(input: StartRunInput): Promise<{ runId: string }> {
    const run = await this.launcher.prepare(input);
    return { runId: this.queue.launchPrepared(run).handle.runId };
  }

  /** Lanza según `whenBusy`: a la vez, o en la cola del diagrama si ya hay alguna en marcha o en cola [R52.3]. */
  async submit(input: StartRunInput): Promise<{ runId: string } | { queuedId: string }> {
    const run = await this.launcher.prepare(input);
    if (input.whenBusy === 'queue' && this.queue.isBusy(run.diagram.id)) return this.queue.enqueue(run, input.order);
    return { runId: this.queue.launchPrepared(run).handle.runId };
  }

  resumeRun(runId: string): Promise<{ runId: string }> {
    return this.corrections.resumeRun(runId);
  }
  proposeCorrection(runId: string, text: string, prefer?: string): Promise<{ candidates: { nodeId: string; label: string }[]; proposal: { nodeId: string; reason: string } }> {
    return this.corrections.proposeCorrection(runId, text, prefer);
  }
  correctRun(runId: string, req: { text: string; nodeId: string; files?: string[]; attachments?: string[] }): Promise<{ runId: string }> {
    return this.corrections.correctRun(runId, req);
  }
  dismiss(runId: string): Promise<boolean> {
    return this.history.dismiss(runId);
  }
  /** «Dar por bueno» una ejecución fallida [R65.6]. */
  accept(runId: string, acceptance: RunAcceptance): Promise<boolean> {
    return this.history.accept(runId, acceptance);
  }

  pause(runId: string): void {
    this.control.pause(runId);
  }
  resume(runId: string): void {
    this.control.resume(runId);
  }
  cancel(runId: string): void {
    this.control.cancel(runId);
  }
  /** Cancela todas las ejecuciones en curso y vacía la cola, p. ej. al cerrar el proyecto [R28.7][R52.3]. */
  cancelAll(): void {
    this.queue.clear();
    this.control.cancelAll();
  }
  answer(runId: string, questionId: string, text: string): boolean {
    return this.control.answer(runId, questionId, text);
  }
  pending(runId: string): PendingQuestion[] {
    return this.control.pending(runId);
  }
  settled(runId: string): Promise<void> {
    return this.control.settled(runId);
  }

  /**
   * Ejecuciones interrumpidas de las últimas `hours` horas, para ofrecer reanudarlas al abrir [R74.12]: el diagrama y
   * el último paso que terminó, sin leer el registro entero (R74.11).
   */
  async interruptedRecent(now = Date.now(), hours = 72): Promise<{ runId: string; diagramName: string; lastStep?: string }[]> {
    const recent = (await this.list()).filter((m) => m.status === 'interrupted' && !m.resumedBy && now - Date.parse(m.startedAt) <= hours * 3_600_000);
    return Promise.all(
      recent.map(async (m) => {
        const diagram = await this.runDiagram(m.runId).catch(() => null);
        const id = m.lastStepKey?.slice(0, m.lastStepKey.lastIndexOf('#')).split('/').pop();
        const label = id === undefined ? undefined : (findLabel(diagram, id) ?? id);
        return { runId: m.runId, diagramName: m.diagramName ?? diagram?.name ?? m.diagramId, ...(label ? { lastStep: label } : {}) };
      }),
    );
  }

  runDiagram(runId: string): Promise<Diagram | null> {
    return this.history.runDiagram(runId);
  }
  list(): Promise<RunMeta[]> {
    return this.history.list();
  }
  subscribe(runId: string, fromSeq: number, onLive: (event: RunEvent) => void): Promise<{ backlog: RunEvent[]; unsubscribe: () => void }> {
    return this.history.subscribe(runId, fromSeq, onLive);
  }
  isFinished(runId: string): boolean {
    return this.history.isFinished(runId);
  }

  previewFile(runId: string, key: string, rel: string): Promise<FilePreview> {
    return this.files.previewFile(runId, key, rel);
  }
  locatePreview(runId: string, key: string, rel: string): Promise<{ abs: string; source: 'run' | 'previous' | 'live'; from: string } | undefined> {
    return this.files.locatePreview(runId, key, rel);
  }
  previewAsset(url: string): Promise<string | undefined> {
    return this.files.previewAsset(url);
  }
  listOutput(runId: string): Promise<OutputFile[]> {
    return this.files.listOutput(runId);
  }
  readOutput(runId: string, rel: string): Promise<{ text: string; truncated: boolean }> {
    return this.files.readOutput(runId, rel);
  }
}

/** Etiqueta de un nodo en cualquier nivel del diagrama (bucles incluidos). */
function findLabel(d: Pick<Diagram, 'nodes'> | null, id: string): string | undefined {
  for (const n of d?.nodes ?? []) {
    if (n.id === id) return n.label ?? n.id;
    const inner = n.loop ? findLabel(n.loop.body, id) : undefined;
    if (inner) return inner;
  }
  return undefined;
}
