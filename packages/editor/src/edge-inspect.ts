import { pathKey, type AgentSnapshot, type Id, type KnowledgeExtra, type NodeStatus, type Payload, type RunEvent } from '@orquestador/core';

type RequestEvent = Extract<RunEvent, { type: 'agent.request' }>;

/** Una vez que algo pasó por una conexión, y cómo arrancó el destino con ello [R42.1]. */
export interface EdgeTraversal {
  /** Número de vez en esta conexión, desde 1. */
  n: number;
  seq: number;
  ts: string;
  /** `return`: retorno de una revisión que rechazó [R42.2]. */
  kind: 'output' | 'return';
  /** Lo que el origen dejó en la conexión. */
  sent?: Payload;
  /** Lo que recibió el destino al empezar (puede juntar varias entradas) [R42.3]. */
  received?: Payload;
  /** Lo recibido no es igual a lo enviado. */
  combined: boolean;
  /** Pasada del destino que arrancó con esta vez. */
  pass?: number;
  state: 'waiting' | 'running' | 'finished';
  status?: NodeStatus;
  /** Una petición por intento del destino, si es un agente [R42.4]. */
  requests: RequestEvent[];
}

export interface EdgeRef {
  id: Id;
  from: Id;
  to: Id;
}

const sameLevel = (e: RunEvent, path: readonly Id[]): boolean => (e.nodePath ?? []).join('/') === path.join('/');

/** Reconstruye, solo con los eventos, cada vez que pasó algo por una conexión [R42.1–R42.4]. */
export function edgeTraversals(events: readonly RunEvent[], edge: EdgeRef, path: readonly Id[] = []): EdgeTraversal[] {
  const out: EdgeTraversal[] = [];
  const fromKey = pathKey(path, edge.from);
  const toKey = pathKey(path, edge.to);
  let lastOutput: Payload | undefined;
  let lastInput: Payload | undefined;
  let rejection: { reason: string } | undefined;
  let awaiting: EdgeTraversal[] = [];
  let current: EdgeTraversal[] = [];
  let open = false;
  let pass = 0;
  for (const e of events) {
    const nid = 'nodeId' in e ? e.nodeId : undefined;
    const key = nid !== undefined ? pathKey(e.nodePath, nid) : undefined;
    if (key === fromKey) {
      if (e.type === 'node.finished') {
        if (e.output) lastOutput = e.output;
      } else if (e.type === 'node.started') {
        if (e.input) lastInput = e.input;
      } else if (e.type === 'review.decided') {
        rejection = e.verdict === 'rejected' && e.returnTo === edge.to ? { reason: e.reason ?? '' } : undefined;
      }
    }
    if (e.type === 'edge.traversed' && e.edgeId === edge.id && sameLevel(e, path)) {
      const isReturn = rejection !== undefined;
        // En modo veredicto la revisión no da motivo: las correcciones son lo que le llegó (la salida del revisor).
      const feedback = rejection?.reason ? { text: rejection.reason, files: [] } : (lastInput ?? lastOutput);
      // Si el origen reparte, por esta conexión solo salió su parte [R59.7].
      const sent: Payload | undefined = isReturn ? feedback : (e.input ?? lastOutput);
      rejection = undefined;
      const t: EdgeTraversal = { n: out.length + 1, seq: e.seq, ts: e.ts, kind: isReturn ? 'return' : 'output', ...(sent ? { sent } : {}), combined: false, state: 'waiting', requests: [] };
      out.push(t);
      awaiting.push(t);
      continue;
    }
    if (key !== toKey) continue;
    switch (e.type) {
      case 'node.started':
        // Un `node.started` repetido sin haber terminado no es otra pasada (como en R15.14).
        if (open) break;
        open = true;
        pass++;
        for (const t of awaiting) {
          t.state = 'running';
          t.pass = pass;
          if (e.input) {
            t.received = e.input;
            t.combined = !t.sent || t.sent.text !== e.input.text || t.sent.files.join('\n') !== e.input.files.join('\n');
          }
        }
        current = awaiting;
        awaiting = [];
        break;
      case 'agent.request':
        for (const t of current) t.requests.push(e);
        break;
      case 'node.finished':
        open = false;
        for (const t of current) {
          t.state = 'finished';
          t.status = e.status;
        }
        current = [];
        break;
      default:
        break;
    }
  }
  return out;
}

export type KnowledgeOrigin = 'agent' | 'diagram' | 'node';
export interface KnowledgeRow {
  kind: 'skill' | 'context' | 'mcp';
  id: Id;
  origin: KnowledgeOrigin;
}

/** Skills, contextos y MCP de una petición con su origen; gana el más concreto [R42.5]. */
export function requestKnowledge(req: { snapshot?: AgentSnapshot; extra?: { diagram?: KnowledgeExtra; node?: KnowledgeExtra } }): KnowledgeRow[] {
  const rank: Record<KnowledgeOrigin, number> = { agent: 0, diagram: 1, node: 2 };
  const rows = new Map<string, KnowledgeRow>();
  const add = (kind: KnowledgeRow['kind'], ids: readonly Id[] | undefined, origin: KnowledgeOrigin) => {
    for (const id of ids ?? []) {
      const k = `${kind}:${id}`;
      const prev = rows.get(k);
      if (!prev) rows.set(k, { kind, id, origin });
      else if (rank[origin] > rank[prev.origin]) prev.origin = origin;
    }
  };
  const s = req.snapshot;
  add('skill', s?.skillIds, 'agent');
  add('context', s?.contextIds, 'agent');
  add('mcp', s?.mcpServers, 'agent');
  for (const origin of ['diagram', 'node'] as const) {
    const x = req.extra?.[origin];
    add('skill', x?.skillIds, origin);
    add('context', x?.contextIds, origin);
    add('mcp', x?.mcpIds, origin);
  }
  const order = { skill: 0, context: 1, mcp: 2 };
  return [...rows.values()].sort((a, b) => order[a.kind] - order[b.kind]);
}

/** Tokens aproximados de un texto (4 caracteres por token) [R42.6]. */
export const approxTokens = (text: string): number => Math.ceil(text.length / 4);

/** «≈ 1,8 k tokens» / «≈ 420 tokens». */
export function approxTokensLabel(text: string): string {
  const n = approxTokens(text);
  return n >= 1000 ? `≈ ${(n / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} k tokens` : `≈ ${n} tokens`;
}

