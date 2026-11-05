import type { Diagram, Edge, Id, Payload } from './types';

/** Criterio que usa la IA cuando la revisión no tiene uno propio [R34.6]. */
export const DEFAULT_REVIEW_CRITERIA =
  'La entrega cumple todo lo pedido y el revisor no deja correcciones pendientes.';

/** Largo máximo de cada corrección anterior en el contexto de la vuelta siguiente [R34.11]. */
export const PREVIOUS_FEEDBACK_CLIP = 600;

/** Información de un retorno: la arista, su revisión, su destino y el tramo que se repite [R34.3][R34.4]. */
export interface ReturnInfo {
  edge: Edge;
  reviewId: Id;
  targetId: Id;
  segment: Set<Id>;
}

function reachesVia(edges: readonly Edge[], from: Id, target: Id): boolean {
  const seen = new Set<Id>([from]);
  const stack = [from];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === target) return true;
    for (const e of edges) {
      if (e.from === id && !seen.has(e.to)) {
        seen.add(e.to);
        stack.push(e.to);
      }
    }
  }
  return false;
}

const isReviewRejected = (d: Pick<Diagram, 'nodes'>, e: Edge): boolean =>
  e.port === 'rejected' && d.nodes.some((n) => n.id === e.from && n.kind === 'review');

/**
 * Retornos de un nivel: aristas ✗ Rechazado de una revisión cuyo destino llega a la revisión por aristas
 * hacia delante (todas salvo las ✗ de revisiones) [R34.3].
 */
export function returnEdges(d: Pick<Diagram, 'nodes' | 'edges'>): Map<Id, ReturnInfo> {
  const base = d.edges.filter((e) => !isReviewRejected(d, e));
  const out = new Map<Id, ReturnInfo>();
  for (const e of d.edges) {
    if (!isReviewRejected(d, e) || e.from === e.to) continue;
    if (!reachesVia(base, e.to, e.from)) continue;
    out.set(e.id, { edge: e, reviewId: e.from, targetId: e.to, segment: new Set() });
  }
  const forward = d.edges.filter((e) => !out.has(e.id));
  for (const info of out.values()) info.segment = segmentOf(forward, info.targetId, info.reviewId);
  return out;
}

/** Aristas que no son retornos. */
export function forwardEdges(d: Pick<Diagram, 'nodes' | 'edges'>, returns = returnEdges(d)): Edge[] {
  return d.edges.filter((e) => !returns.has(e.id));
}

/** Nodos que están en algún camino de `from` a `to` (ambos incluidos) [R34.4]. */
export function segmentOf(edges: readonly Edge[], from: Id, to: Id): Set<Id> {
  const down = new Set<Id>([from]);
  const stack = [from];
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const e of edges) {
      if (e.from === id && !down.has(e.to)) {
        down.add(e.to);
        stack.push(e.to);
      }
    }
  }
  const up = new Set<Id>([to]);
  stack.push(to);
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const e of edges) {
      if (e.to === id && !up.has(e.from)) {
        up.add(e.from);
        stack.push(e.from);
      }
    }
  }
  return new Set([...down].filter((id) => up.has(id)));
}

/** ¿El tramo tiene una sola entrada (el destino) y una sola salida (la revisión)? [R34.4] */
export function segmentShapeOk(forward: readonly Edge[], info: ReturnInfo): boolean {
  for (const e of forward) {
    const fromIn = info.segment.has(e.from);
    const toIn = info.segment.has(e.to);
    if (!fromIn && toIn && e.to !== info.targetId) return false;
    if (fromIn && !toIn && e.from !== info.reviewId) return false;
  }
  return true;
}

const VERDICT_RE = /\b(?:VEREDICTO|VERDICT)\s*[:：]\s*[*_`"«]*\s*(APROBAD[OA]|RECHAZAD[OA]|APPROVED|REJECTED)/gi;

/** Último veredicto escrito por el revisor, o `undefined` si no hay [R34.6]. */
export function parseVerdict(text: string): 'approved' | 'rejected' | undefined {
  let last: string | undefined;
  for (const m of text.matchAll(VERDICT_RE)) last = m[1]!.toUpperCase();
  if (last === undefined) return undefined;
  return last.startsWith('APROBAD') || last === 'APPROVED' ? 'approved' : 'rejected';
}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Entrada del destino en la vuelta `round` (≥ 2) [R34.11]. */
export function composeRoundInput(args: {
  round: number;
  max: number;
  original: Payload;
  previous?: Payload | undefined;
  feedback: Payload;
  /** Correcciones de vueltas anteriores a la última, de la más antigua a la más reciente. */
  earlier: readonly string[];
  /** Las correcciones las pidió el usuario en una revisión humana [R53.6]. */
  human?: boolean;
}): Payload {
  const { round, max, original, previous, feedback, earlier } = args;
  const parts = [
    original.text,
    '---',
    `## ${args.human ? 'Revisión humana' : 'Revisión'} · vuelta ${round} de ${max}`,
    args.human
      ? 'El usuario revisó la entrega anterior y pide cambios. Corrige lo que se indica y entrega de nuevo el trabajo completo.'
      : 'La revisión rechazó la entrega anterior. Corrige lo que se indica y entrega de nuevo el trabajo completo.',
  ];
  if (previous) parts.push('### Tu entrega anterior', previous.text);
  parts.push('### Correcciones pedidas', feedback.text);
  if (earlier.length > 0) {
    parts.push(
      '### Correcciones de vueltas anteriores',
      earlier.map((f, i) => `- Vuelta ${i + 1}: ${clip(f.trim(), PREVIOUS_FEEDBACK_CLIP)}`).join('\n'),
    );
  }
  const files = [...new Set([...original.files, ...(previous?.files ?? []), ...feedback.files])];
  return { text: parts.join('\n\n'), files };
}

/** Tipos de paso a los que se puede volver para corregir [R53.2][R53.7]. */
export const CORRECTABLE_KINDS: ReadonlySet<string> = new Set(['agent', 'transform', 'subdiagram']);

/** Ids de un nivel en orden del flujo (aristas hacia delante); los que no se pueden ordenar van al final en su orden. */
export function flowOrder(d: Pick<Diagram, 'nodes' | 'edges'>, forward: readonly Edge[] = forwardEdges(d)): Id[] {
  const indeg = new Map(d.nodes.map((n) => [n.id, 0]));
  for (const e of forward) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  const queue = d.nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  const out: Id[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    out.push(id);
    for (const e of forward) {
      if (e.from !== id) continue;
      const left = (indeg.get(e.to) ?? 0) - 1;
      indeg.set(e.to, left);
      if (left === 0) queue.push(e.to);
    }
  }
  for (const n of d.nodes) if (!out.includes(n.id)) out.push(n.id);
  return out;
}

/** Ids a los que se llega desde `from` por aristas hacia delante (sin incluirlo) [R53.7]. */
export function downstreamOf(forward: readonly Edge[], from: Id): Set<Id> {
  const seen = new Set<Id>();
  const stack = [from];
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const e of forward) {
      if (e.from === id && !seen.has(e.to) && e.to !== from) {
        seen.add(e.to);
        stack.push(e.to);
      }
    }
  }
  return seen;
}

/**
 * Pasos de un nivel a los que una revisión puede devolver el trabajo sin flecha dibujada: agente, transformación o
 * subdiagrama que llegan a la revisión, cuyo tramo tiene una sola entrada y una sola salida y no se cruza con un
 * retorno dibujado [R53.2].
 */
export function correctionCandidates(d: Pick<Diagram, 'nodes' | 'edges'>, reviewId: Id): Id[] {
  const returns = returnEdges(d);
  const forward = forwardEdges(d, returns);
  const kinds = new Map(d.nodes.map((n) => [n.id, n.kind]));
  const out: Id[] = [];
  for (const id of flowOrder(d, forward)) {
    if (!CORRECTABLE_KINDS.has(kinds.get(id) ?? '') || !reachesVia(forward, id, reviewId) || id === reviewId) continue;
    const info: ReturnInfo = { edge: { id: '', from: reviewId, to: id }, reviewId, targetId: id, segment: segmentOf(forward, id, reviewId) };
    if (!segmentShapeOk(forward, info)) continue;
    const crosses = [...returns.values()].some((r) => {
      if (r.reviewId === reviewId) return false;
      const shared = [...r.segment].some((x) => info.segment.has(x));
      const nested = [...r.segment].every((x) => info.segment.has(x)) || [...info.segment].every((x) => r.segment.has(x));
      return shared && !nested;
    });
    if (!crosses) out.push(id);
  }
  return out;
}
