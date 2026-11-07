import type { Diagram, DiagramNode } from '../diagrams';
import type { Id } from '../shared';
import type { BlameCandidate, Decider } from './adapter';
import type { RunEvent } from './events';
import { correctionTargets, resumePlan } from './resume';

export const stepLabel = (n: DiagramNode | undefined, id: Id): string => n?.label?.trim() || n?.agentId || id;

/**
 * Qué paso tiene que rehacer el trabajo: lo que diga `Decider.blame` si es uno de los candidatos; si no, el último
 * (el más cercano) [R53.5][R53.10].
 */
export async function blameStep(decider: Decider, feedback: string, candidates: BlameCandidate[], signal: AbortSignal, fallbackReason: string): Promise<{ nodeId: Id; reason: string }> {
  const fallback = { nodeId: candidates[candidates.length - 1]!.nodeId, reason: fallbackReason };
  if (!decider.blame) return fallback;
  try {
    const res = await decider.blame({ feedback, candidates }, signal);
    return candidates.some((c) => c.nodeId === res.nodeId) ? { nodeId: res.nodeId, reason: res.reason ?? '' } : fallback;
  } catch {
    return fallback;
  }
}

/** Paso elegido por el usuario: por id o por nombre, sin distinguir mayúsculas; si no coincide, la propuesta [R53.5]. */
export function matchCandidate(answer: string, candidates: readonly { nodeId: Id; label: string }[], proposal: Id): Id {
  const a = answer.trim().toLowerCase();
  return candidates.find((c) => c.nodeId.toLowerCase() === a || c.label.trim().toLowerCase() === a)?.nodeId ?? proposal;
}

/** Candidatos y propuesta para corregir una ejecución que ya no está en marcha [R53.10]. */
export async function proposeCorrectionWith(
  decider: Decider,
  args: { diagram: Diagram; events: readonly RunEvent[]; text: string; prefer?: Id; signal?: AbortSignal },
): Promise<{ candidates: { nodeId: Id; label: string }[]; proposal: { nodeId: Id; reason: string } }> {
  const ids = correctionTargets(args.diagram, args.events);
  if (ids.length === 0) throw new Error('Esta ejecución no tiene pasos que se puedan corregir');
  const outputs = resumePlan(args.diagram, args.events);
  const byId = new Map(args.diagram.nodes.map((n) => [n.id, n]));
  const full: BlameCandidate[] = ids.map((id) => {
    const n = byId.get(id);
    return { nodeId: id, label: stepLabel(n, id), ...(n?.task ? { task: n.task } : {}), ...(outputs[id] ? { output: outputs[id] } : {}) };
  });
  const candidates = full.map((c) => ({ nodeId: c.nodeId, label: c.label }));
  if (args.prefer !== undefined && ids.includes(args.prefer)) return { candidates, proposal: { nodeId: args.prefer, reason: '' } };
  const proposal = await blameStep(decider, args.text, full, args.signal ?? new AbortController().signal, 'Es el último paso que se puede corregir.');
  return { candidates, proposal };
}
