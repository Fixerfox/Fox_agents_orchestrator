import type { Id, Payload } from '../shared';
import type { RunEvent } from './events';
import { pathKey } from './replay';

/** Clave estable de un paso: ruta de contenedores, nodo y pasada (1, 2…) [R74.1]. */
export const stepKey = (path: readonly Id[] | undefined, nodeId: Id, pass: number): string => `${pathKey(path, nodeId)}#${pass}`;

/** Una clave sin pasada (como las de antes de esta spec) es la primera pasada del nivel principal [R74.2]. */
export const normalStepKey = (key: string): string => (key.includes('#') ? key : `${key}#1`);

/** Una decisión tal como se tomó, para repetirla sin consultar al motor [R74.3]. */
export interface ReplayDecision {
  kind: 'route' | 'condition' | 'judge';
  response: unknown;
}

/** Todo lo que se puede reutilizar de una ejecución, por clave de paso [R74.2][R74.3]. */
export interface ReplayPlan {
  outputs: Record<string, Payload>;
  trail: Record<string, RunEvent[]>;
  decisions: Record<string, ReplayDecision[]>;
  answers: Record<string, { question: string; answer: string }[]>;
  approvedReviews: string[];
  /** Pasos que estaban en marcha al cortarse, con lo que habían tocado [R74.5]. */
  interrupted: Record<string, { files: string[] }>;
  /** Lo que costó cada paso en la ejecución anterior, para decir cuánto se ahorra [R74.13]. */
  costs: Record<string, number>;
}

const TRAIL = new Set<RunEvent['type']>(['git.branch', 'git.action', 'file.produced', 'supervisor.note', 'supervisor.alert', 'memory.note']);

/** Dueño de un evento: el nodo y la ruta en la que ocurrió. */
function ownerOf(e: RunEvent): { path: Id[]; nodeId: Id } | undefined {
  const nodeId = 'nodeId' in e && typeof e.nodeId === 'string' ? e.nodeId : e.type === 'route.decided' ? e.fromNodeId : e.type === 'loop.iteration' ? e.loopId : undefined;
  return nodeId === undefined ? undefined : { path: [...(e.nodePath ?? [])], nodeId };
}

/**
 * Pasada de cada evento que pertenece a un paso [R74.1]: cuenta los `node.started` de la misma ruta. Es una función de
 * los eventos: no hace falta guardar la pasada aparte.
 */
export function stepKeysOf(events: readonly RunEvent[]): Map<number, string> {
  const passes = new Map<string, number>();
  const out = new Map<number, string>();
  for (const e of events) {
    const o = ownerOf(e);
    if (!o) continue;
    const pk = pathKey(o.path, o.nodeId);
    if (e.type === 'node.started') passes.set(pk, (passes.get(pk) ?? 0) + 1);
    out.set(e.seq, `${pk}#${passes.get(pk) ?? 1}`);
  }
  return out;
}

const WORK = new Set<RunEvent['type']>(['agent.request', 'transform.done', 'subdiagram.started', 'node.reused']);

/**
 * Lo que se reutiliza al reanudar [R74.2]–[R74.8][R74.14]: la salida de cada paso de agente, transformación o
 * subdiagrama que terminó bien, en cualquier nivel; las decisiones y las respuestas de cada paso y pasada; las
 * revisiones humanas aprobadas; lo que tocaban los pasos cortados. Lo de una rama aislada que no llegó a juntarse no
 * se reutiliza: su trabajo se perdió con su espacio.
 */
export function replayPlan(events: readonly RunEvent[]): ReplayPlan {
  const keys = stepKeysOf(events);
  const plan: ReplayPlan = { outputs: {}, trail: {}, decisions: {}, answers: {}, approvedReviews: [], interrupted: {}, costs: {} };
  const work = new Set<string>();
  const started = new Map<string, number>();
  const finished = new Map<string, number>();
  const ended = new Map<string, string>();
  const asked = new Map<string, string>();
  const approved = new Set<string>();
  // Ramas aisladas abiertas y sin juntar: sus pasos no se reutilizan [R74.14].
  const open = new Map<string, Set<string>>();
  for (const e of events) {
    const key = keys.get(e.seq);
    if (e.type === 'workspace.opened') open.set(`${(e.nodePath ?? []).join('/')}|${e.regionId}|${e.branchNodeIds.join(',')}`, new Set(e.branchNodeIds.map((id) => pathKey(e.nodePath, id))));
    if (e.type === 'workspace.merged' && e.regionId !== undefined && e.branchNodeIds) open.delete(`${(e.nodePath ?? []).join('/')}|${e.regionId}|${e.branchNodeIds.join(',')}`);
    if (!key) continue;
    if (WORK.has(e.type)) work.add(key);
    switch (e.type) {
      case 'node.started':
        started.set(key, e.seq);
        break;
      case 'node.finished':
        finished.set(key, e.seq);
        ended.set(key, e.status);
        if (e.status === 'succeeded' && e.output) plan.outputs[key] = { text: e.output.text, files: [...(e.output.files ?? [])] };
        break;
      case 'decision':
        (plan.decisions[key] ??= []).push({ kind: e.kind, response: e.response });
        break;
      case 'agent.question':
        asked.set(e.questionId, e.text);
        break;
      case 'agent.answer': {
        const q = asked.get(e.questionId);
        if (q !== undefined) (plan.answers[key] ??= []).push({ question: q, answer: e.text });
        break;
      }
      case 'review.decided':
        if (e.verdict === 'approved' && (e.source === 'human' || e.source === 'reused')) approved.add(key);
        break;
      case 'agent.usage':
        plan.costs[key] = (plan.costs[key] ?? 0) + (e.costUsd ?? 0);
        break;
      default:
        break;
    }
  }
  for (const key of Object.keys(plan.outputs)) if (!work.has(key)) delete plan.outputs[key];
  plan.approvedReviews = [...approved];
  const lost = new Set([...open.values()].flatMap((s) => [...s]));
  const inLost = (key: string) => {
    const pk = key.slice(0, key.lastIndexOf('#'));
    return [...lost].some((l) => pk === l || pk.startsWith(`${l}/`));
  };
  for (const key of Object.keys(plan.outputs)) if (inLost(key)) delete plan.outputs[key];
  for (const key of Object.keys(plan.decisions)) if (inLost(key)) delete plan.decisions[key];
  // El rastro de cada paso reutilizado: lo suyo y, si es un subdiagrama, lo de dentro, mientras corría [R41.7].
  for (const key of Object.keys(plan.outputs)) {
    const pk = key.slice(0, key.lastIndexOf('#'));
    const from = started.get(key) ?? 0;
    const to = finished.get(key) ?? Number.POSITIVE_INFINITY;
    const trail = events.filter((e) => {
      if (!TRAIL.has(e.type) || e.seq < from || e.seq > to) return false;
      const o = ownerOf(e);
      if (!o) return false;
      const own = pathKey(o.path, o.nodeId);
      return own === pk || o.path.join('/') === pk || o.path.join('/').startsWith(`${pk}/`);
    });
    if (trail.length > 0) plan.trail[key] = trail;
  }
  // Pasos de agente cortados: se repiten con lo que habían tocado [R74.5].
  for (const [key, seq] of started) {
    if ((finished.has(key) && ended.get(key) !== 'cancelled') || !work.has(key)) continue;
    const files = [...new Set(events.filter((e) => e.type === 'file.produced' && e.seq > seq && keys.get(e.seq) === key).map((e) => (e as Extract<RunEvent, { type: 'file.produced' }>).path))];
    plan.interrupted[key] = { files };
  }
  return plan;
}
