import type { Payload } from '../../shared';
import type { RunEvent } from '../events';
import { normalStepKey, type ReplayDecision } from '../replay-plan';
import type { RunOptions } from '../run-types';

const byKey = <T>(rec: Readonly<Record<string, T>> | undefined): Map<string, T> => new Map(Object.entries(rec ?? {}).map(([k, v]) => [normalStepKey(k), v]));

/**
 * Lo que una ejecución trae de otra, por clave de paso [R74.2]: salidas, decisiones, respuestas, aprobaciones, lo que
 * tocaban los pasos cortados y la corrección. Cada cosa se usa una vez [R56.13].
 */
export class ResumeCache {
  private readonly reusable: Map<string, Payload>;
  private readonly approved: Set<string>;
  private readonly decisions: Map<string, ReplayDecision[]>;
  private readonly answers: Map<string, { question: string; answer: string }[]>;
  private readonly interrupted: Map<string, { files: string[] }>;
  private readonly costs: Map<string, number>;
  /** Corrección pendiente de aplicar a su paso [R53.8]. */
  private correction: RunOptions['correction'];
  readonly reuseFrom: string | undefined;
  private readonly trail: Map<string, readonly RunEvent[]>;

  constructor(options: Pick<RunOptions, 'reuse' | 'correction'>) {
    const r = options.reuse;
    this.reuseFrom = r?.fromRunId;
    this.reusable = byKey(r?.outputs);
    this.approved = new Set((r?.approvedReviews ?? []).map(normalStepKey));
    this.trail = byKey(r?.trail);
    this.decisions = byKey(r?.decisions);
    this.answers = byKey(r?.answers);
    this.interrupted = byKey(r?.interrupted);
    this.costs = byKey(r?.costs);
    this.correction = options.correction;
  }

  /** Rastro de un paso reutilizado [R41.7]. */
  trailOf(key: string): readonly RunEvent[] {
    return this.trail.get(normalStepKey(key)) ?? [];
  }

  takeApproved(key: string): boolean {
    return this.approved.delete(normalStepKey(key));
  }

  takeCorrection(nodeId: string): RunOptions['correction'] {
    if (this.correction?.nodeId !== nodeId) return undefined;
    const c = this.correction;
    this.correction = undefined;
    return c;
  }

  takeReused(key: string): Payload | undefined {
    const k = normalStepKey(key);
    const out = this.reusable.get(k);
    this.reusable.delete(k);
    return out;
  }

  /** Decisiones de un paso y pasada, en el orden en que se tomaron [R74.3]. */
  takeDecisions(key: string): ReplayDecision[] {
    const k = normalStepKey(key);
    const out = this.decisions.get(k) ?? [];
    this.decisions.delete(k);
    return [...out];
  }

  /** Respuestas que dio la persona en ese paso y pasada [R74.5][R74.6]. */
  takeAnswers(key: string): { question: string; answer: string }[] {
    const k = normalStepKey(key);
    const out = this.answers.get(k) ?? [];
    this.answers.delete(k);
    return [...out];
  }

  /** Lo que tocaba el paso cuando se cortó la ejecución [R74.5]. */
  takeInterrupted(key: string): { files: string[] } | undefined {
    const k = normalStepKey(key);
    const out = this.interrupted.get(k);
    this.interrupted.delete(k);
    return out;
  }

  /** Lo que costó el paso en la ejecución anterior [R74.13]. */
  costOf(key: string): number | undefined {
    return this.costs.get(normalStepKey(key));
  }
}
