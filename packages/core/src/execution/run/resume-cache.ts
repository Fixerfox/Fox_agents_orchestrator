import type { Payload } from '../../shared';
import type { RunEvent } from '../events';
import type { RunOptions } from '../run-types';

/** Lo que una ejecución trae de otra: salidas, aprobaciones y la corrección; cada cosa se usa una vez [R56.13]. */
export class ResumeCache {
  /** Salidas por reutilizar al reanudar [R41.1]. */
  private readonly reusable = new Map<string, Payload>();
  /** Revisiones humanas ya aprobadas en la anterior [R53.9]. */
  private readonly approved: Set<string>;
  /** Corrección pendiente de aplicar a su paso [R53.8]. */
  private correction: RunOptions['correction'];
  readonly reuseFrom: string | undefined;
  private readonly trail: Readonly<Record<string, readonly RunEvent[]>>;

  constructor(options: Pick<RunOptions, 'reuse' | 'correction'>) {
    this.reuseFrom = options.reuse?.fromRunId;
    for (const [id, out] of Object.entries(options.reuse?.outputs ?? {})) this.reusable.set(id, out);
    this.approved = new Set(options.reuse?.approvedReviews ?? []);
    this.trail = options.reuse?.trail ?? {};
    this.correction = options.correction;
  }

  /** Rastro de un paso reutilizado [R41.7]. */
  trailOf(nodeId: string): readonly RunEvent[] {
    return this.trail[nodeId] ?? [];
  }

  takeApproved(reviewId: string): boolean {
    return this.approved.delete(reviewId);
  }

  takeCorrection(nodeId: string): RunOptions['correction'] {
    if (this.correction?.nodeId !== nodeId) return undefined;
    const c = this.correction;
    this.correction = undefined;
    return c;
  }

  takeReused(nodeId: string): Payload | undefined {
    const out = this.reusable.get(nodeId);
    this.reusable.delete(nodeId);
    return out;
  }
}
