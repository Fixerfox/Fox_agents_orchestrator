import { branchesOf, type RunBranches } from './branches';
import type { KnowledgeState } from './knowledge';
import { pathKey, type Id, type NodeStatus, type Payload, type ReviewQuestion, type RunEvent, type RunStatus } from '@orquestador/core';

export interface PendingItem {
  questionId: string;
  nodeId: Id;
  nodePath: Id[];
  text: string;
  options?: string[];
  /** Confirmación del paso antes de terminar [R43.9]. */
  confirm?: { round: number };
  /** Pregunta de una revisión humana [R53.15]. */
  review?: ReviewQuestion;
}

export interface LoopInfo {
  n: number;
  max: number;
  verdict: 'continue' | 'done';
  reason?: string;
}

/** Última decisión de una revisión [R34.18]. */
export interface ReviewInfo {
  n: number;
  max: number;
  verdict: 'approved' | 'rejected' | 'exhausted';
  reason?: string;
}

/**
 * Estado de un paso tal como se muestra. `interrupted`: quedó abierto (en cola, ejecutando o esperando)
 * en una ejecución que ya no está en marcha; no lo emite el motor, lo deduce `settleLive` (R35.14).
 */
export type LiveNodeStatus = NodeStatus | 'interrupted';

export interface LiveView {
  /** Último intento de cada paso: qué skills, contextos y MCP se incluyeron, usaron o faltaron (`nodo` → `skill:id`…) [R36.18]. */
  knowledge: Record<string, Record<string, KnowledgeState>>;
  status: RunStatus | 'idle';
  reason?: string;
  paused: boolean;
  /** Estado por nodo; la clave es la ruta completa (`bucle/nodo`). */
  nodeStatus: Record<string, LiveNodeStatus>;
  /** Aristas recorridas (`bucle/arista`). */
  edges: Set<string>;
  /** Último estado de cada bucle (`bucle`). */
  loops: Record<string, LoopInfo>;
  /** Última decisión de cada revisión (`bucle/revisión`) [R34.18]. */
  reviews: Record<string, ReviewInfo>;
  /** Revisiones que acabaron por ⏱ Agotado, con su ruta [R34.18]. */
  exhausted: { nodeId: Id; nodePath: Id[] }[];
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
  budgetReached?: { limit: 'tokens' | 'cost'; used: number; max: number };
  pending: PendingItem[];
  /** Texto de salida de la ejecución (nodo `output` raíz). */
  finalOutput?: string;
  produced: { nodeId: Id; path: string; nodePath: Id[] }[];
  /** Ramas de git de cada paso, por orden de uso [R58.6]. */
  branches: Record<string, string[]>;
  /** Lo que hizo cada paso en las ramas: commit, push… [R58.12]. */
  gitActions: RunBranches['actions'];
  /** PR o merge request que creó cada paso [R58.15]. */
  gitLinks: RunBranches['links'];
  needsAttention: boolean;
}

export const EMPTY_LIVE: LiveView = {
  knowledge: {},
  status: 'idle',
  paused: false,
  nodeStatus: {},
  edges: new Set(),
  loops: {},
  reviews: {},
  exhausted: [],
  usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  pending: [],
  produced: [],
  branches: {},
  gitActions: {},
  gitLinks: {},
  needsAttention: false,
};

const textOf = (p: Payload | undefined): string | undefined => (p ? p.text : undefined);

/** Estado visible de una ejecución, reconstruido solo con sus eventos (vivo o replay). */
export function deriveLive(events: readonly RunEvent[]): LiveView {
  if (events.length === 0) return EMPTY_LIVE;
  const v: LiveView = { ...EMPTY_LIVE, knowledge: {}, status: 'running', nodeStatus: {}, edges: new Set(), loops: {}, reviews: {}, exhausted: [], usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, pending: [], produced: [] };
  const open = new Map<string, PendingItem>();
  // Orden en que empezó cada paso y se recorrió cada conexión, para reiniciar la vuelta al volver atrás [R38.18].
  const startedAt = new Map<string, number>();
  const edgeAt = new Map<string, number>();
  /** Revisiones que han mandado volver: su «correcto» sería engañoso, así que no se pinta [R38.18]. */
  const sentBack = new Set<string>();
  let idx = 0;
  for (const e of events) {
    idx++;
    const np = e.nodePath ?? [];
    switch (e.type) {
      case 'run.finished':
        v.status = e.status;
        if (e.reason !== undefined) v.reason = e.reason;
        v.paused = false;
        break;
      case 'run.paused':
        v.paused = true;
        break;
      case 'run.resumed':
        v.paused = false;
        break;
      case 'run.budget_reached':
        v.budgetReached = { limit: e.limit, used: e.used, max: e.max };
        break;
      case 'agent.request':
        // Cada intento empieza de cero: lo que se ve es el estado del último [R36.18].
        v.knowledge[pathKey(np, e.nodeId)] = {};
        break;
      case 'knowledge.used':
        (v.knowledge[pathKey(np, e.nodeId)] ??= {})[`${e.kind}:${e.id}`] = e.via === 'inline' ? 'included' : 'used';
        break;
      case 'knowledge.unmet':
        (v.knowledge[pathKey(np, e.nodeId)] ??= {})[`${e.kind}:${e.id}`] = 'missing';
        break;
      case 'node.queued':
        v.nodeStatus[pathKey(np, e.nodeId)] = 'queued';
        break;
      case 'node.started':
        v.nodeStatus[pathKey(np, e.nodeId)] = 'running';
        startedAt.set(pathKey(np, e.nodeId), idx);
        break;
      case 'node.finished':
        if (sentBack.delete(pathKey(np, e.nodeId)) && e.status === 'succeeded') delete v.nodeStatus[pathKey(np, e.nodeId)];
        else v.nodeStatus[pathKey(np, e.nodeId)] = e.status;
        if (np.length === 0 && e.nodeId === 'output') {
          const t = textOf(e.output);
          if (t !== undefined) v.finalOutput = t;
        }
        break;
      case 'agent.question': {
        const item: PendingItem = { questionId: e.questionId, nodeId: e.nodeId, nodePath: [...np], text: e.text, ...(e.options ? { options: e.options } : {}), ...(e.confirm ? { confirm: e.confirm } : {}), ...(e.review ? { review: e.review } : {}) };
        open.set(e.questionId, item);
        v.nodeStatus[pathKey(np, e.nodeId)] = 'waiting_input';
        break;
      }
      case 'agent.answer':
        open.delete(e.questionId);
        v.nodeStatus[pathKey(np, e.nodeId)] = 'running';
        break;
      case 'agent.usage':
        v.usage.inputTokens += e.inputTokens;
        v.usage.outputTokens += e.outputTokens;
        v.usage.costUsd += e.costUsd ?? 0;
        break;
      case 'edge.traversed':
        v.edges.add(pathKey(np, e.edgeId));
        edgeAt.set(pathKey(np, e.edgeId), idx);
        break;
      case 'loop.iteration':
        v.loops[pathKey(np, e.loopId)] = { n: e.n, max: e.max, verdict: e.verdict, ...(e.reason !== undefined ? { reason: e.reason } : {}) };
        break;
      case 'review.decided':
        v.reviews[pathKey(np, e.nodeId)] = { n: e.round, max: e.max, verdict: e.verdict, ...(e.reason !== undefined ? { reason: e.reason } : {}) };
        if (e.verdict === 'exhausted') v.exhausted.push({ nodeId: e.nodeId, nodePath: [...np] });
        if (e.verdict === 'rejected' && e.returnTo !== undefined) {
          // Vuelve atrás: lo recorrido desde que empezó el paso de destino es de la vuelta anterior; se borra para
          // que no parezca que la nueva ya ha pasado por ahí. La decisión de la revisión se sigue viendo [R38.18].
          const back = startedAt.get(pathKey(np, e.returnTo));
          if (back !== undefined) {
            for (const [k, at] of edgeAt) {
              if (at <= back) continue;
              v.edges.delete(k);
              edgeAt.delete(k);
            }
            for (const [k, at] of startedAt) {
              if (at <= back) continue;
              delete v.nodeStatus[k];
              startedAt.delete(k);
            }
            delete v.nodeStatus[pathKey(np, e.returnTo)];
          }
          sentBack.add(pathKey(np, e.nodeId));
        }
        break;
      case 'file.produced':
        v.produced.push({ nodeId: e.nodeId, path: e.path, nodePath: [...np] });
        break;
      case 'workspace.conflict':
        v.needsAttention = true;
        break;
      default:
        break;
    }
  }
  v.pending = [...open.values()];
  const git = branchesOf(events);
  v.branches = git.byStep;
  v.gitActions = git.actions;
  v.gitLinks = git.links;
  return v;
}

const OPEN: readonly LiveNodeStatus[] = ['queued', 'running', 'waiting_input'];

/** ¿Sigue abierto este estado (en cola, ejecutando o esperando respuesta)? */
export const isOpenStatus = (s: LiveNodeStatus | undefined): boolean => s !== undefined && OPEN.includes(s);

/**
 * Estado de una ejecución que ya no está en marcha: ningún paso queda «ejecutando», «en cola» ni
 * «esperando tu respuesta» (pasan a `interrupted`), no hay preguntas que contestar ni pausa (R35.14).
 */
export function settleLive(live: LiveView): LiveView {
  const nodeStatus: Record<string, LiveNodeStatus> = {};
  for (const [k, s] of Object.entries(live.nodeStatus)) nodeStatus[k] = isOpenStatus(s) ? 'interrupted' : s;
  return { ...live, nodeStatus, pending: [], paused: false };
}

export interface BudgetLimits {
  maxTokens?: number;
  maxCostUsd?: number;
}

/** Lo que queda de presupuesto (R15.9). `undefined` en lo que no tiene límite. */
export function budgetRemaining(live: LiveView, limits: BudgetLimits): { tokens?: number; costUsd?: number } {
  const used = live.usage.inputTokens + live.usage.outputTokens;
  return {
    ...(limits.maxTokens !== undefined ? { tokens: Math.max(0, limits.maxTokens - used) } : {}),
    ...(limits.maxCostUsd !== undefined ? { costUsd: Math.max(0, limits.maxCostUsd - live.usage.costUsd) } : {}),
  };
}

export type TranscriptItem =
  /** `pass` solo aparece cuando el nodo se ejecutó más de una vez [R15.14]. */
  | { kind: 'input'; attempt: number; pass?: number; agentId: Id; text: string; config?: unknown; model?: string }
  /** Empieza la pasada `n` (≥ 2); `by` y `reason`, si la devolvió una revisión [R15.14]. */
  | { kind: 'pass'; n: number; by?: Id; reason?: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; tool: string; input?: unknown; ok?: boolean; output?: string }
  | { kind: 'question'; questionId: string; text: string; options?: string[]; answer?: string; /** Confirmación del paso [R43.9]. */ confirm?: { round: number }; /** Tipo de pregunta [R45.3]. */ ask?: 'question' | 'permission' | 'gate'; /** Revisión humana [R53.15]. */ review?: ReviewQuestion }
  | { kind: 'retry'; attempt: number; max: number; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'usage'; inputTokens: number; outputTokens: number; costUsd: number }
  | { kind: 'output'; status: NodeStatus; text?: string };

/**
 * Transcripción legible de un nodo: lo que recibió, lo que fue diciendo y haciendo, y su salida (R15.2).
 * Si el nodo se ejecutó más de una vez, cada pasada desde la segunda empieza con un elemento `pass` y las entradas llevan su pasada [R15.14].
 */
export function transcriptItems(events: readonly RunEvent[], nodeId: Id, nodePath: readonly Id[] = []): TranscriptItem[] {
  const key = pathKey(nodePath, nodeId);
  const items: TranscriptItem[] = [];
  const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  let sawUsage = false;
  let pass = 0;
  let open = false;
  // Última revisión que devolvió el flujo a este nodo, para explicar la pasada siguiente [R15.14].
  let returned: { by: Id; reason?: string } | undefined;
  for (const e of events) {
    const nid = 'nodeId' in e ? e.nodeId : undefined;
    if (nid === undefined) continue;
    if (e.type === 'review.decided' && e.verdict === 'rejected' && e.returnTo === nodeId && pathKey(e.nodePath, e.returnTo) === key) {
      returned = { by: e.nodeId, ...(e.reason !== undefined ? { reason: e.reason } : {}) };
    }
    if (pathKey(e.nodePath, nid) !== key) continue;
    switch (e.type) {
      case 'node.started':
        // Un `node.started` repetido sin haber terminado no es otra pasada.
        if (!open) {
          pass++;
          if (pass > 1) items.push({ kind: 'pass', n: pass, ...(returned ?? {}) });
        }
        open = true;
        returned = undefined;
        break;
      case 'agent.request':
        items.push({ kind: 'input', attempt: e.attempt, pass: Math.max(1, pass), agentId: e.agentId, text: e.input.text, ...(e.snapshot ? { config: e.snapshot } : {}), ...(e.model ? { model: e.model } : {}) });
        break;
      case 'token.stream': {
        const last = items[items.length - 1];
        if (last?.kind === 'text') last.text += e.text;
        else items.push({ kind: 'text', text: e.text });
        break;
      }
      case 'tool.called':
        items.push({ kind: 'tool', tool: e.tool, input: e.input });
        break;
      case 'tool.result': {
        const open = [...items].reverse().find((i) => i.kind === 'tool' && i.tool === e.tool && i.ok === undefined);
        if (open && open.kind === 'tool') {
          open.ok = e.ok;
          if (e.output !== undefined) open.output = e.output;
        } else items.push({ kind: 'tool', tool: e.tool, ok: e.ok, ...(e.output !== undefined ? { output: e.output } : {}) });
        break;
      }
      case 'agent.question':
        items.push({ kind: 'question', questionId: e.questionId, text: e.text, ...(e.options ? { options: e.options } : {}), ...(e.confirm ? { confirm: e.confirm } : {}), ...(e.kind ? { ask: e.kind } : {}), ...(e.review ? { review: e.review } : {}) });
        break;
      case 'agent.answer': {
        const q = items.find((i) => i.kind === 'question' && i.questionId === e.questionId);
        if (q && q.kind === 'question') q.answer = e.text;
        break;
      }
      case 'node.retrying':
        items.push({ kind: 'retry', attempt: e.attempt, max: e.max, message: e.message });
        break;
      case 'error':
        items.push({ kind: 'error', message: e.message });
        break;
      case 'agent.usage':
        sawUsage = true;
        usage.inputTokens += e.inputTokens;
        usage.outputTokens += e.outputTokens;
        usage.costUsd += e.costUsd ?? 0;
        break;
      case 'node.finished': {
        open = false;
        const t = textOf(e.output);
        items.push({ kind: 'output', status: e.status, ...(t !== undefined ? { text: t } : {}) });
        break;
      }
      default:
        break;
    }
  }
  // Con una sola pasada no se habla de pasadas: se ve como siempre.
  if (pass <= 1) for (const it of items) if (it.kind === 'input') delete it.pass;
  // El consumo es el total de todas las pasadas: va justo antes de la última salida [R15.14].
  if (sawUsage) {
    const lastOut = items.map((i) => i.kind).lastIndexOf('output');
    items.splice(lastOut === -1 ? items.length : lastOut, 0, { kind: 'usage', ...usage });
  }
  return items;
}
