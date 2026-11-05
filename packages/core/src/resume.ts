import type { RunEvent } from './events';
import type { Diagram, Id, Payload } from './types';
import { CORRECTABLE_KINDS, downstreamOf, flowOrder, forwardEdges } from './review';

const KINDS = new Set(['agent', 'transform', 'subdiagram']);

/**
 * Qué se puede reutilizar al reanudar una ejecución: por cada paso del nivel principal de tipo agente, transformación
 * o subdiagrama, la última salida con la que terminó bien [R41.1].
 */
export function resumePlan(diagram: Diagram, events: readonly RunEvent[]): Record<Id, Payload> {
  const kinds = new Map(diagram.nodes.map((n) => [n.id, n.kind]));
  const out: Record<Id, Payload> = {};
  for (const e of events) {
    if (e.type !== 'node.finished' || (e.nodePath?.length ?? 0) > 0 || !KINDS.has(kinds.get(e.nodeId) ?? '')) continue;
    if (e.status === 'succeeded' && e.output) out[e.nodeId] = { text: e.output.text, files: [...(e.output.files ?? [])] };
  }
  return out;
}

/** Estados desde los que se puede reanudar [R41.2]. */
export const RESUMABLE_STATUSES = ['interrupted', 'failed', 'cancelled'] as const;
export const canResume = (status: string, resumedBy?: string): boolean => (RESUMABLE_STATUSES as readonly string[]).includes(status) && !resumedBy;

/**
 * Revisiones humanas del nivel principal que la ejecución aprobó (por el usuario o reutilizando una aprobación
 * anterior): en la siguiente no vuelven a preguntar la primera vez [R53.9].
 */
export function approvedReviews(diagram: Diagram, events: readonly RunEvent[]): Id[] {
  const human = new Set(diagram.nodes.filter((n) => n.kind === 'review' && n.review?.mode === 'human').map((n) => n.id));
  const out = new Set<Id>();
  for (const e of events) {
    if (e.type !== 'review.decided' || (e.nodePath?.length ?? 0) > 0 || !human.has(e.nodeId)) continue;
    if (e.verdict === 'approved' && (e.source === 'human' || e.source === 'reused')) out.add(e.nodeId);
    else out.delete(e.nodeId);
  }
  return [...out];
}

/** Pasos que se pueden corregir de una ejecución: los del nivel principal de agente, transformación o subdiagrama que terminaron bien [R53.7]. */
export function correctionTargets(diagram: Diagram, events: readonly RunEvent[]): Id[] {
  const done = new Set(Object.keys(resumePlan(diagram, events)));
  return flowOrder(diagram).filter((id) => done.has(id) && CORRECTABLE_KINDS.has(diagram.nodes.find((n) => n.id === id)?.kind ?? ''));
}

/** Qué se reutiliza al corregir un paso: todo lo terminado menos el paso y lo que depende de él [R53.7]. */
export function correctionPlan(
  diagram: Diagram,
  events: readonly RunEvent[],
  targetId: Id,
): { outputs: Record<Id, Payload>; previous: Payload | undefined; approvedReviews: Id[] } {
  const all = resumePlan(diagram, events);
  const after = downstreamOf(forwardEdges(diagram), targetId);
  const outputs: Record<Id, Payload> = {};
  for (const [id, out] of Object.entries(all)) if (id !== targetId && !after.has(id)) outputs[id] = out;
  return { outputs, previous: all[targetId], approvedReviews: approvedReviews(diagram, events).filter((id) => !after.has(id)) };
}

/** Entrada del paso corregido: su entrada, la entrega anterior y lo que hay que corregir [R53.8]. */
export function composeCorrectionInput(args: { input: Payload; previous: Payload; text: string; files?: readonly string[] }): Payload {
  const text = [
    args.input.text,
    '---',
    '## Corrección pedida por el usuario',
    'El usuario revisó lo que entregaste en una ejecución anterior y pide cambios. Corrige lo que se indica y entrega de nuevo el trabajo completo.',
    `### Tu entrega anterior\n\n${args.previous.text}`,
    `### Lo que hay que corregir\n\n${args.text}`,
  ].join('\n\n');
  return { text, files: [...new Set([...args.input.files, ...args.previous.files, ...(args.files ?? [])])] };
}
