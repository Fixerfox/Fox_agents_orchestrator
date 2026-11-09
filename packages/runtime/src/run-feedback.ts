import { feedbackStats, supervisorCase, type FeedbackVerdict, type RuleStats, type RunEvent, type RunRepository } from '@orquestador/core';
import { RunError } from './errors';
import type { LiveRuns } from './run-types';

/** Ejecuciones que cuentan para la calibración del Supervisor [R75.22]. */
export const STATS_RUNS = 50;

/** Lo que dice la persona de los avisos del Supervisor y cuánto acierta [R75.21]–[R75.23]. */
export class RunFeedback {
  constructor(
    private readonly live: LiveRuns,
    private readonly runs: RunRepository,
  ) {}

  private async eventsOf(runId: string): Promise<readonly RunEvent[]> {
    // Terminada, lo marcado después está en su registro y no en el bus.
    const l = this.live.find(runId);
    if (l && !l.finished) return l.handle.bus.history();
    return this.runs.readEvents(runId).catch(() => {
      throw new RunError('not-found', 'No existe esa ejecución');
    });
  }

  /**
   * Marca un aviso como falso o acertado [R75.21]: en vivo va al bus; con la ejecución terminada, al final de su
   * registro, como `run.accepted`. Además queda como caso de referencia [R75.23].
   */
  async give(runId: string, req: { alertSeq: number; verdict: FeedbackVerdict; note?: string }, now = new Date()): Promise<boolean> {
    const events = await this.eventsOf(runId);
    const alert = events.find((e) => e.type === 'supervisor.alert' && e.seq === req.alertSeq);
    if (!alert || alert.type !== 'supervisor.alert') throw new RunError('bad-request', 'Ese aviso no existe en esta ejecución');
    const l = this.live.find(runId);
    if (l && !l.finished) l.handle.feedback(req.alertSeq, req.verdict, req.note);
    else await this.runs.addFeedback?.(runId, { alertSeq: req.alertSeq, verdict: req.verdict, ...(req.note?.trim() ? { note: req.note.trim().slice(0, 1000) } : {}), ...(alert.nodeId !== undefined ? { nodeId: alert.nodeId } : {}) });
    const c = supervisorCase(events, req.alertSeq, req.verdict, req.note, now.toISOString());
    if (c) await this.runs.addSupervisorCase?.(c).catch(() => undefined);
    return true;
  }

  /** Por regla, en esta ejecución y en las últimas 50 del proyecto [R75.22]. */
  async stats(runId: string): Promise<{ run: RuleStats[]; recent: RuleStats[] }> {
    const run = feedbackStats([await this.eventsOf(runId)]);
    const metas = (await this.runs.list({ live: new Set() }).catch(() => [])).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, STATS_RUNS);
    const all = await Promise.all(metas.map((m) => this.eventsOf(m.runId).catch(() => [] as readonly RunEvent[])));
    return { run, recent: feedbackStats(all) };
  }
}
