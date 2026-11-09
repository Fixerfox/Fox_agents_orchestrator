import type { DiagramNode } from '../../diagrams';
import type { Id } from '../../shared';
import type { Decider } from '../adapter';
import type { ReplayDecision } from '../replay-plan';
import type { RunEmitter } from './run-emitter';

/** Marca de las decisiones que se repitieron de la ejecución anterior [R74.4]. */
const REPLAYED = Symbol('replayed');
type Replaying = Decider & { [REPLAYED]?: Set<ReplayDecision['kind']> };

/** ¿La última decisión de este tipo se tomó de la ejecución anterior? [R74.4] */
export const replayedIn = (decider: Decider, kind: ReplayDecision['kind']): boolean => (decider as Replaying)[REPLAYED]?.has(kind) === true;

/**
 * Las decisiones de un paso que ya se tomaron en la ejecución que se reanuda: se devuelven tal cual, en orden, sin
 * consultar al motor ni gastar [R74.3][R74.4]. Si la ruta ya no existe en el diagrama, se decide otra vez y se avisa.
 */
export function replayDecider(inner: Decider, recorded: ReplayDecision[], o: { emitter: RunEmitter; node: DiagramNode; path: Id[] }): Decider {
  if (recorded.length === 0) return inner;
  const queue = [...recorded];
  const used = new Set<ReplayDecision['kind']>();
  const take = (kind: ReplayDecision['kind']) => {
    const i = queue.findIndex((d) => d.kind === kind);
    if (i < 0) return undefined;
    const [d] = queue.splice(i, 1);
    used.add(kind);
    return d!.response as Record<string, unknown>;
  };
  const diverged = (detail: string) => o.emitter.emit({ type: 'supervisor.alert', nodeId: o.node.id, rule: 'resume-diverged', severity: 'warning', detail }, o.path);
  /** Condiciones de un router, una a una en el orden de sus aristas. */
  let conditions: { condition?: string; matched: boolean }[] | undefined;
  const out: Replaying = {
    ...inner,
    route: async (req, signal) => {
      const r = take('route');
      const ids = Array.isArray(r?.['edgeIds']) ? (r['edgeIds'] as Id[]) : undefined;
      if (r && ids && ids.every((id) => req.candidates.some((c) => c.edgeId === id))) return { edgeIds: ids, reason: String(r['reason'] ?? '') };
      used.delete('route');
      if (r) diverged('La ruta que eligió la ejecución anterior ya no existe en el diagrama: se ha vuelto a decidir.');
      return inner.route(req, signal);
    },
    judge: async (req, signal) => {
      const r = take('judge');
      if (r && typeof r['done'] === 'boolean') return { done: r['done'], reason: String(r['reason'] ?? '') };
      used.delete('judge');
      return inner.judge(req, signal);
    },
    condition: async (req, signal) => {
      if (!conditions) {
        const r = take('condition') as unknown;
        conditions = Array.isArray(r) ? (r as { condition?: string; matched: boolean }[]).filter((c) => c.condition !== undefined) : [];
      }
      const next = conditions.shift();
      if (next && next.condition === req.condition) return next.matched;
      used.delete('condition');
      return inner.condition(req, signal);
    },
    ...(inner.conditions
      ? {
          conditions: async (req, signal) => {
            const r = take('condition') as unknown;
            const list = Array.isArray(r) ? (r as { edgeId: Id; matched: boolean }[]) : undefined;
            if (list && req.conditions.every((c) => list.some((x) => x.edgeId === c.edgeId))) return { results: Object.fromEntries(list.map((x) => [x.edgeId, x.matched])) };
            used.delete('condition');
            if (list) diverged('Las condiciones del router cambiaron desde la ejecución anterior: se han vuelto a evaluar.');
            return inner.conditions!(req, signal);
          },
        }
      : {}),
    ...(inner.judgeReview
      ? {
          judgeReview: async (req, signal) => {
            const r = take('judge');
            if (r && typeof r['done'] === 'boolean') return { approved: r['done'], reason: String(r['reason'] ?? '') };
            used.delete('judge');
            return inner.judgeReview!(req, signal);
          },
        }
      : {}),
  };
  out[REPLAYED] = used;
  return out;
}
