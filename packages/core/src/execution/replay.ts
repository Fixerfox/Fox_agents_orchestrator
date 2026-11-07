import type { Id } from '../shared';
import type { RunEvent } from './events';
import type { NodeStatus, RunStatus } from './run-types';

export interface RunState {
  status: RunStatus;
  reason?: string;
  /** Estado por nodo; la clave es la ruta completa (`bucle/nodo`). */
  nodeStatus: Record<string, NodeStatus>;
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
  route: {
    /** Nodos en el orden en que empezaron. */
    visited: string[];
    /** Aristas recorridas. */
    edges: string[];
    decisions: { from: string; chosen: Id[] }[];
    /** Vueltas completadas por cada bucle. */
    loops: Record<string, number>;
  };
}

export const pathKey = (nodePath: readonly Id[] | undefined, id: Id): string =>
  [...(nodePath ?? []), id].join('/');

/** Reconstruye el estado y la ruta de una ejecución solo a partir de sus eventos (vivo o replay). */
export function reduceRunState(events: readonly RunEvent[]): RunState {
  const state: RunState = {
    status: 'running',
    nodeStatus: {},
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    route: { visited: [], edges: [], decisions: [], loops: {} },
  };
  for (const e of events) {
    switch (e.type) {
      case 'run.finished':
        state.status = e.status;
        if (e.reason !== undefined) state.reason = e.reason;
        break;
      case 'run.accepted':
        // Dada por buena: termina bien y el motivo es el de quien la aceptó [R65.7].
        state.status = 'succeeded';
        state.reason = e.reason;
        break;
      case 'node.queued':
        state.nodeStatus[pathKey(e.nodePath, e.nodeId)] = 'queued';
        break;
      case 'node.started':
        state.nodeStatus[pathKey(e.nodePath, e.nodeId)] = 'running';
        state.route.visited.push(pathKey(e.nodePath, e.nodeId));
        break;
      case 'node.finished':
        state.nodeStatus[pathKey(e.nodePath, e.nodeId)] = e.status;
        break;
      case 'agent.question':
        state.nodeStatus[pathKey(e.nodePath, e.nodeId)] = 'waiting_input';
        break;
      case 'agent.answer':
        state.nodeStatus[pathKey(e.nodePath, e.nodeId)] = 'running';
        break;
      case 'agent.usage':
        state.usage.inputTokens += e.inputTokens;
        state.usage.outputTokens += e.outputTokens;
        state.usage.costUsd += e.costUsd ?? 0;
        break;
      case 'edge.traversed':
        state.route.edges.push(pathKey(e.nodePath, e.edgeId));
        break;
      case 'route.decided':
        state.route.decisions.push({ from: pathKey(e.nodePath, e.fromNodeId), chosen: e.chosen });
        break;
      case 'loop.iteration':
        state.route.loops[pathKey(e.nodePath, e.loopId)] = e.n;
        break;
      default:
        break;
    }
  }
  return state;
}

/** Transcripción de un agente: todo lo que recibió, hizo y respondió, en orden. */
export function transcriptOf(events: readonly RunEvent[], nodeId: Id, nodePath: readonly Id[] = []): RunEvent[] {
  const key = pathKey(nodePath, nodeId);
  return events.filter((e) => {
    const nid = 'nodeId' in e ? e.nodeId : undefined;
    return nid !== undefined && pathKey(e.nodePath, nid) === key;
  });
}
