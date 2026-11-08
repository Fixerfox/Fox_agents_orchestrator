import type { Id } from '../shared';
import type { RunEvent } from './events';

/** Lo que costó y lo que tardó un paso de la ejecución [R77.17]. */
export interface StepMetrics {
  /** `ruta/nodo#pasada`. */
  key: string;
  nodeId: Id;
  path: Id[];
  pass: number;
  agentId?: Id;
  model?: string;
  status?: string;
  /** Milisegundos desde el principio de la ejecución. */
  startMs: number;
  endMs: number;
  /** Trabajando, esperando a la persona y en cola (antes de empezar y por el hueco global). */
  workMs: number;
  waitMs: number;
  queueMs: number;
  attempts: number;
  retries: { kind: string; message: string }[];
  tokens: number;
  costUsd: number;
}

export interface Totals {
  steps: number;
  attempts: number;
  retries: number;
  workMs: number;
  waitMs: number;
  queueMs: number;
  tokens: number;
  costUsd: number;
}

export interface RunMetrics {
  durationMs: number;
  steps: StepMetrics[];
  total: Totals;
  byAgent: (Totals & { agentId: Id })[];
  byModel: { model: string; tokens: number; costUsd: number }[];
  /** Lo del Supervisor, el juez y las decisiones, aparte [R77.17]. */
  supervisor: { tokens: number; costUsd: number };
}

/** Modelo sin elegir en el paso ni en la ficha: el de Ajustes. */
export const DEFAULT_MODEL_LABEL = 'predeterminado';

const empty = (): Totals => ({ steps: 0, attempts: 0, retries: 0, workMs: 0, waitMs: 0, queueMs: 0, tokens: 0, costUsd: 0 });
const addTo = (t: Totals, s: StepMetrics) => {
  t.steps++;
  t.attempts += s.attempts;
  t.retries += s.retries.length;
  t.workMs += s.workMs;
  t.waitMs += s.waitMs;
  t.queueMs += s.queueMs;
  t.tokens += s.tokens;
  t.costUsd += s.costUsd;
};

/**
 * Métricas de una ejecución, solo con sus eventos [R77.17]: por paso, duración trabajando, esperando a la persona y en
 * cola, intentos y por qué se repitieron, tokens y coste; y por ejecución, totales, por agente, por modelo y lo del
 * Supervisor aparte.
 */
export function runMetrics(events: readonly RunEvent[]): RunMetrics {
  const at = (e: RunEvent) => Date.parse(e.ts);
  const t0 = events.length > 0 ? at(events[0]!) : 0;
  const tEnd = events.length > 0 ? at(events[events.length - 1]!) : 0;
  const finished = events.find((e) => e.type === 'run.finished');
  const steps: StepMetrics[] = [];
  const open = new Map<string, StepMetrics & { waiting: Map<string, number>; queuedAt?: number; globalAt?: number; globalMs: number }>();
  const passes = new Map<string, number>();
  const queuedBefore = new Map<string, number>();
  const supervisor = { tokens: 0, costUsd: 0 };
  for (const e of events) {
    const t = at(e) - t0;
    const nodeId = 'nodeId' in e ? e.nodeId : undefined;
    if (nodeId === undefined) continue;
    const base = [...(e.nodePath ?? []), nodeId].join('/');
    const s = open.get(base);
    switch (e.type) {
      case 'node.queued':
        // Antes de empezar: en cola de la ejecución; ya empezado: esperando hueco en toda la app [R77.3].
        if (s && e.others !== undefined) s.globalAt = t;
        else if (!s) queuedBefore.set(base, t);
        break;
      case 'node.started': {
        const pass = (passes.get(base) ?? 0) + 1;
        passes.set(base, pass);
        const q = queuedBefore.get(base);
        queuedBefore.delete(base);
        open.set(base, { key: `${base}#${pass}`, nodeId, path: [...(e.nodePath ?? [])], pass, startMs: t, endMs: t, workMs: 0, waitMs: 0, queueMs: q !== undefined ? Math.max(0, t - q) : 0, attempts: 0, retries: [], tokens: 0, costUsd: 0, waiting: new Map(), globalMs: 0 });
        break;
      }
      case 'agent.request':
        if (!s) break;
        if (e.kind === undefined) s.attempts++;
        s.agentId ??= e.agentId;
        s.model ??= e.model ?? e.snapshot?.model ?? DEFAULT_MODEL_LABEL;
        if (s.globalAt !== undefined) {
          s.globalMs += t - s.globalAt;
          s.globalAt = undefined;
        }
        break;
      case 'agent.question':
        s?.waiting.set(e.questionId, t);
        break;
      case 'agent.answer': {
        const from = s?.waiting.get(e.questionId);
        if (s && from !== undefined) {
          s.waitMs += t - from;
          s.waiting.delete(e.questionId);
        }
        break;
      }
      case 'node.retrying':
        s?.retries.push({ kind: e.cause && e.cause !== 'error' ? e.cause : (e.kind ?? 'transient'), message: e.message });
        break;
      case 'agent.usage':
        if (e.source) {
          supervisor.tokens += e.inputTokens + e.outputTokens;
          supervisor.costUsd += e.costUsd ?? 0;
        } else if (s) {
          s.tokens += e.inputTokens + e.outputTokens;
          s.costUsd += e.costUsd ?? 0;
        }
        break;
      case 'node.finished':
        if (!s) break;
        s.status = e.status;
        s.endMs = t;
        open.delete(base);
        steps.push(close(s, t));
        break;
      default:
        break;
    }
  }
  // Lo que seguía abierto cuenta hasta el último evento.
  for (const s of open.values()) steps.push(close({ ...s, endMs: tEnd - t0 }, tEnd - t0));
  steps.sort((a, b) => a.startMs - b.startMs);
  const total = empty();
  const agents = new Map<Id, Totals & { agentId: Id }>();
  const models = new Map<string, { model: string; tokens: number; costUsd: number }>();
  for (const s of steps) {
    addTo(total, s);
    if (s.agentId) {
      const a = agents.get(s.agentId) ?? { ...empty(), agentId: s.agentId };
      addTo(a, s);
      agents.set(s.agentId, a);
      const m = models.get(s.model ?? DEFAULT_MODEL_LABEL) ?? { model: s.model ?? DEFAULT_MODEL_LABEL, tokens: 0, costUsd: 0 };
      m.tokens += s.tokens;
      m.costUsd += s.costUsd;
      models.set(m.model, m);
    }
  }
  return {
    durationMs: Math.max(0, (finished ? at(finished) : tEnd) - t0),
    steps,
    total,
    byAgent: [...agents.values()].sort((a, b) => b.costUsd - a.costUsd || b.workMs - a.workMs),
    byModel: [...models.values()].sort((a, b) => b.costUsd - a.costUsd),
    supervisor,
  };
}

function close(s: StepMetrics & { waiting: Map<string, number>; globalAt?: number; globalMs: number }, now: number): StepMetrics {
  // Una pregunta sin responder y una cola sin salir cuentan hasta ahora.
  let waitMs = s.waitMs;
  for (const from of s.waiting.values()) waitMs += now - from;
  const globalMs = s.globalMs + (s.globalAt !== undefined ? now - s.globalAt : 0);
  const out: StepMetrics = { key: s.key, nodeId: s.nodeId, path: s.path, pass: s.pass, ...(s.agentId ? { agentId: s.agentId } : {}), ...(s.model && s.agentId ? { model: s.model } : {}), ...(s.status ? { status: s.status } : {}), startMs: s.startMs, endMs: s.endMs, workMs: Math.max(0, s.endMs - s.startMs - waitMs - globalMs), waitMs, queueMs: s.queueMs + globalMs, attempts: s.attempts, retries: s.retries, tokens: s.tokens, costUsd: s.costUsd };
  return out;
}
