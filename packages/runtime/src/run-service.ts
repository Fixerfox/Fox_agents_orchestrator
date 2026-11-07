import type { Diagram, Orchestrator, PendingQuestion, RunAcceptance, RunEvent, RunMeta, RunOptions } from '@orquestador/core';
import { RunControl } from './run-control';
import { RunCorrections } from './run-corrections';
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
    this.files = new RunFiles(live, ports.runs, ports.policy, ports.files, this.history);
    this.launcher = new RunLauncher(ports.runs, ports.library, defaults, snapshots);
    this.queue = new RunQueue(live, ports.runs, orchestrator, snapshots, (runId, key, files) => this.files.snapshotStep(runId, key, files));
    this.control = new RunControl(live);
    this.corrections = new RunCorrections(live, ports.runs, orchestrator, this.history, this.launcher, this.queue);
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
