import type { DeliverableSpec } from '../../diagrams';
import type { Id } from '../../shared';
import { deliverableBrief, deliverableGoal } from '../deliverable';

/** Aviso del entregable para un agente según «Avisar a» [R46.4]. */
export function deliverableNotice(spec: DeliverableSpec | undefined, finalIds: ReadonlySet<Id>, nodeId: Id, path: readonly Id[]): { role: 'final' | 'goal'; text: string } | undefined {
  if (!spec) return undefined;
  const notify = spec.notify ?? 'final';
  if (notify === 'none') return undefined;
  if (path.length === 0 && finalIds.has(nodeId)) return { role: 'final', text: deliverableBrief(spec) };
  if (notify === 'all') return { role: 'goal', text: deliverableGoal(spec) };
  return undefined;
}
