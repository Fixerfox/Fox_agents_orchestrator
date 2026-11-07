import { CORRECTABLE_KINDS, type Diagram, downstreamOf, flowOrder, forwardEdges } from '../diagrams';
import type { Id, Payload } from '../shared';
import type { EventBody, RunEvent } from './events';

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

/** Lo que entregaron en la anterior los pasos que una corrección repite [R62.16]. */
export function redoneSteps(diagram: Diagram, events: readonly RunEvent[], reused: Readonly<Record<Id, Payload>>): { step: string; text: string; files: string[] }[] {
  return Object.entries(resumePlan(diagram, events))
    .filter(([id]) => !(id in reused))
    .map(([id, out]) => ({ step: diagram.nodes.find((n) => n.id === id)?.label ?? id, text: out.text.slice(0, 3000), files: out.files }));
}

const TRAIL = new Set<RunEvent['type']>(['git.branch', 'git.action', 'file.produced', 'supervisor.note', 'supervisor.alert']);

/** Lo que dejaron en la ejecución los pasos que se van a reutilizar, por paso del nivel principal [R41.7]. */
export function reusedTrail(outputs: Readonly<Record<Id, Payload>>, events: readonly RunEvent[]): Record<Id, RunEvent[]> {
  const out: Record<Id, RunEvent[]> = {};
  for (const e of events) {
    if (!TRAIL.has(e.type) || !('nodeId' in e) || e.nodeId === undefined) continue;
    const step = e.nodePath?.[0] ?? e.nodeId;
    if (step in outputs) (out[step] ??= []).push(e);
  }
  return out;
}

/** Un evento del rastro listo para volver a emitirse: lo propio de la ejecución anterior se queda allí [R41.9]. */
export function trailBody(past: RunEvent): EventBody {
  const body = Object.fromEntries(Object.entries(past).filter(([key]) => !['runId', 'seq', 'ts', 'nodePath'].includes(key))) as EventBody;
  return body.type === 'file.produced' ? { ...body, reused: true } : body;
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
