import { approvedReviews, canResume, correctionPlan, correctionTargets, redoneSteps, resumePlan, reusedTrail, type Orchestrator, type RunOptions, type RunRepository } from '@orquestador/core';
import { RunError } from './errors';
import type { RunHistory, PastRun } from './run-history';
import type { RunLauncher } from './run-launcher';
import type { RunQueue } from './run-queue';
import type { LiveRuns } from './run-types';

/** Reanudar y corregir ejecuciones: arrancan otra enlazada que reutiliza lo anterior [R56.16]. */
export class RunCorrections {
  constructor(
    private readonly live: LiveRuns,
    private readonly runs: RunRepository,
    private readonly orchestrator: Orchestrator,
    private readonly history: RunHistory,
    private readonly launcher: RunLauncher,
    private readonly queue: RunQueue,
  ) {}

  /**
   * Reanuda una ejecución interrumpida, fallida o cancelada: arranca otra con el diagrama de entonces y la misma
   * entrada, reutilizando lo que ya terminó bien [R41.1][R41.2].
   */
  async resumeRun(runId: string): Promise<{ runId: string }> {
    const meta = (await this.history.list()).find((m) => m.runId === runId);
    if (!meta) throw new RunError('not-found', 'No existe esa ejecución');
    if (!canResume(meta.status, meta.resumedBy)) {
      throw new RunError('bad-request', meta.resumedBy ? 'Esta ejecución ya se reanudó: reanuda la nueva.' : 'Solo se reanuda una ejecución interrumpida, fallida o cancelada.');
    }
    const { diagram, events, order, deliverable } = await this.history.past(runId);
    const outputs = resumePlan(diagram, events);
    const options: RunOptions = { ...this.launcher.defaults(), reuse: { fromRunId: runId, outputs, approvedReviews: approvedReviews(diagram, events), trail: reusedTrail(outputs, events) }, ...(deliverable ? { deliverable } : {}) };
    // Reanudar hace una copia nueva de la biblioteca [R52.1].
    const snapshot = await this.launcher.snapshotOf(diagram);
    const { handle } = this.queue.launch(diagram, order, options, snapshot);
    await this.runs.markResumedBy(runId, handle.runId);
    return { runId: handle.runId };
  }

  /** Lo necesario para corregir una ejecución que ya no está en marcha [R53.11]. */
  private async finishedRun(runId: string): Promise<PastRun> {
    if (this.live.isRunning(runId)) throw new RunError('bad-request', 'Está en marcha: se corrige cuando termine.');
    return this.history.past(runId);
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
      const extra = await this.launcher.inputPayload({ order: text, ...(req.files ? { files: req.files } : {}), ...(req.attachments ? { attachments: req.attachments } : {}) });
      files = typeof extra === 'string' ? [] : extra.files;
    }
    const options: RunOptions = {
      ...this.launcher.defaults(),
      reuse: { fromRunId: runId, outputs: plan.outputs, approvedReviews: plan.approvedReviews, trail: reusedTrail(plan.outputs, run.events) },
      correction: { fromRunId: runId, nodeId: req.nodeId, text, previous: plan.previous!, before: redoneSteps(run.diagram, run.events, plan.outputs), ...(files.length > 0 ? { files } : {}) },
      ...(run.deliverable ? { deliverable: run.deliverable } : {}),
    };
    const snapshot = await this.launcher.snapshotOf(run.diagram);
    const { handle } = this.queue.launch(run.diagram, run.order, options, snapshot);
    await this.runs.markCorrectedBy(runId, handle.runId);
    return { runId: handle.runId };
  }
}
