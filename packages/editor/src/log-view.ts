import { pathKey, type Id, type RunEvent } from '@orquestador/core';

export interface LogFilter {
  /** Solo eventos de los nodos que ejecutan este agente. */
  agentId?: string;
  /** Solo estos tipos de evento (p. ej. `tool.called`). */
  types?: string[];
  /** Texto libre, sin distinguir mayúsculas, buscado en todo el evento. */
  text?: string;
  nodeId?: Id;
}

/** Agentes que aparecen en la ejecución (para el filtro). */
export function agentsIn(events: readonly RunEvent[]): string[] {
  return [...new Set(events.flatMap((e) => (e.type === 'agent.request' ? [e.agentId] : [])))].sort();
}

export function eventTypesIn(events: readonly RunEvent[]): string[] {
  return [...new Set(events.map((e) => e.type))].sort();
}

/** Filtra el registro de una ejecución por agente, tipo de evento y texto (R8.11). */
export function filterEvents(events: readonly RunEvent[], f: LogFilter): RunEvent[] {
  const agentOf = new Map<string, string>();
  for (const e of events) if (e.type === 'agent.request') agentOf.set(pathKey(e.nodePath, e.nodeId), e.agentId);
  const needle = f.text?.trim().toLowerCase();
  return events.filter((e) => {
    if (f.types && f.types.length > 0 && !f.types.includes(e.type)) return false;
    const nid = 'nodeId' in e ? e.nodeId : undefined;
    if (f.nodeId !== undefined && nid !== f.nodeId) return false;
    if (f.agentId !== undefined) {
      if (nid === undefined || agentOf.get(pathKey(e.nodePath, nid)) !== f.agentId) return false;
    }
    if (needle && !JSON.stringify(e).toLowerCase().includes(needle)) return false;
    return true;
  });
}

/** Una línea JSON por evento, como en `events.jsonl`. */
export function eventsToJsonl(events: readonly RunEvent[]): string {
  return events.map((e) => JSON.stringify(e)).join('\n') + (events.length > 0 ? '\n' : '');
}

/** Resumen de una línea para la lista del visor. */
export function summarizeEvent(e: RunEvent): string {
  switch (e.type) {
    case 'agent.request':
      return `${e.agentId} recibe: ${e.input.text}`;
    case 'token.stream':
      return e.text;
    case 'tool.called':
      return `${e.tool} ${JSON.stringify(e.input)}`;
    case 'tool.result':
      return `${e.tool} → ${e.ok ? 'ok' : 'error'}${e.output ? `: ${e.output}` : ''}`;
    case 'node.finished':
      return `${e.status}${e.output ? `: ${e.output.text}` : ''}`;
    case 'agent.question':
      return e.text;
    case 'agent.answer':
      return e.text;
    case 'route.decided':
      return `${e.fromNodeId} → ${e.chosen.join(', ')} (${e.reason})`;
    case 'transform.done':
      // [R37.10] Resumen legible del nodo «Transformar».
      return `${e.format} ${e.mode === 'rules' ? 'por reglas' : 'con Claude'} · ${e.ok ? 'ok' : 'falló'} (${e.attempts} intento${e.attempts === 1 ? '' : 's'})${e.errors?.length ? `: ${e.errors.join('; ')}` : ''}${e.warnings?.length ? ` · avisos: ${e.warnings.join('; ')}` : ''}`;
    case 'error':
      return e.message;
    default: {
      const rest: Record<string, unknown> = { ...e };
      for (const k of ['type', 'runId', 'seq', 'ts', 'nodePath']) delete rest[k];
      const text = JSON.stringify(rest);
      return text === '{}' ? '' : text;
    }
  }
}
