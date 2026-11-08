import { pathKey, type RunEvent } from '@orquestador/core';
/** Desde cuántos caracteres o líneas una pregunta se responde en un modal [R78.1]. */
export const LONG_QUESTION_CHARS = 600;
export const LONG_QUESTION_LINES = 8;

/** ¿Se responde en un modal? Confirmaciones, revisiones humanas y preguntas largas [R78.1]. */
export function questionNeedsModal(q: { text: string; confirm?: unknown; review?: unknown }): boolean {
  if (q.confirm !== undefined || q.review !== undefined) return true;
  return q.text.length > LONG_QUESTION_CHARS || q.text.split('\n').length > LONG_QUESTION_LINES;
}

/** El principio del texto, sin Markdown, para la línea compacta [R78.2]. */
export function questionPreview(text: string, max = 160): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+\.|>)\s+/gm, '')
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}


/** Lo que hizo un paso según sus eventos, para decidir una confirmación con datos [R78.7]. */
export interface StepFacts {
  files: { path: string; change: 'created' | 'modified' | 'command' }[];
  tokens: number;
  costUsd: number;
  /** Desde que empezó su última pasada hasta su último evento. */
  durationMs: number;
  alerts: string[];
}

/** Archivos, gasto, tiempo y avisos de la última pasada de un paso [R78.7]. */
export function stepFacts(events: readonly RunEvent[], nodeId: string, nodePath: readonly string[] = []): StepFacts {
  const key = pathKey(nodePath, nodeId);
  const mine = (e: RunEvent) => 'nodeId' in e && e.nodeId === nodeId && pathKey(e.nodePath, nodeId) === key;
  const from = events.map((e, i) => (e.type === 'node.started' && mine(e) ? i : -1)).filter((i) => i >= 0).pop() ?? 0;
  const files = new Map<string, StepFacts['files'][number]['change']>();
  let tokens = 0;
  let costUsd = 0;
  let last = from;
  const alerts: string[] = [];
  for (let i = from; i < events.length; i++) {
    const e = events[i]!;
    if (!mine(e)) continue;
    last = i;
    if (e.type === 'file.produced') {
      const prev = files.get(e.path);
      files.set(e.path, prev === 'created' || e.change === 'created' ? 'created' : e.via === 'command' ? 'command' : 'modified');
    }
    if (e.type === 'agent.usage' && !e.source) {
      tokens += e.inputTokens + e.outputTokens;
      costUsd += e.costUsd ?? 0;
    }
    if (e.type === 'supervisor.alert' && e.severity === 'warning') alerts.push(e.detail);
  }
  const at = (i: number) => {
    const e = events[i];
    return e ? Date.parse(e.ts) : 0;
  };
  const t0 = at(from);
  const t1 = events[last] ? at(last) : t0;
  return { files: [...files].map(([path, change]) => ({ path, change })).sort((a, b) => a.path.localeCompare(b.path)), tokens, costUsd, durationMs: Math.max(0, t1 - t0), alerts };
}
