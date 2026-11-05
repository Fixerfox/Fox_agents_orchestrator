import type { Diagram, Id } from '@orquestador/core';

export interface AgentUse {
  /** Camino de bucles hasta el nivel del nodo. */
  path: Id[];
  nodeId: Id;
  label: string;
}

export interface AgentUsage {
  agentId: Id;
  uses: AgentUse[];
}

/** Agentes usados en el diagrama, en todos los niveles, en orden de aparición [R21.15]. */
export function agentUsage(root: Diagram): AgentUsage[] {
  const byAgent = new Map<Id, AgentUse[]>();
  const walk = (level: Diagram, path: Id[]) => {
    for (const n of level.nodes) {
      if (n.kind === 'agent' && n.agentId) {
        const list = byAgent.get(n.agentId) ?? [];
        list.push({ path, nodeId: n.id, label: n.label ?? n.id });
        byAgent.set(n.agentId, list);
      }
      if (n.kind === 'loop' && n.loop) walk(n.loop.body, [...path, n.id]);
    }
  };
  walk(root, []);
  return [...byAgent].map(([agentId, uses]) => ({ agentId, uses }));
}
