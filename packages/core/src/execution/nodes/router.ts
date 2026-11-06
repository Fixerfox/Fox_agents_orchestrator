import type { Edge } from '../../diagrams';
import type { Id } from '../../shared';
import { failStep, nodeStarted, type NodeHandler } from './handler';

/** Router: elige por las condiciones de las aristas o con la IA. */
export const routerHandler: NodeHandler = {
  kind: 'router',
  async run(step, node, input, path) {
    nodeStarted(step, node, input, path);
    const { decider, emitter, outEdges, nodeById, signal } = step;
    const mode = node.router!.mode;
    let chosen: Edge[] = [];
    let reason: string;

    if (mode === 'rules') {
      const results: { edgeId: Id; condition?: string; matched: boolean }[] = [];
      for (const edge of outEdges) {
        const matched = edge.condition ? await decider.condition({ condition: edge.condition, input }, signal) : true;
        results.push({ edgeId: edge.id, ...(edge.condition ? { condition: edge.condition } : {}), matched });
        if (matched) chosen.push(edge);
      }
      emitter.emit({ type: 'decision', nodeId: node.id, kind: 'condition', request: { input }, response: results }, path);
      reason = 'reglas de las aristas';
    } else {
      const candidates = outEdges.map((e) => ({ edgeId: e.id, to: e.to, label: nodeById.get(e.to)?.label ?? e.to }));
      const res = await decider.route({ nodeId: node.id, candidates, input }, signal);
      emitter.emit({ type: 'decision', nodeId: node.id, kind: 'route', request: { candidates, input }, response: res }, path);
      const wanted = new Set(res.edgeIds);
      chosen = outEdges.filter((e) => wanted.has(e.id));
      reason = res.reason;
    }
    if (signal.aborted) return { status: 'cancelled' };

    if (chosen.length === 0) return failStep(step, node, 'El router no eligió ninguna ruta', path);
    emitter.emit({ type: 'route.decided', fromNodeId: node.id, chosen: chosen.map((e) => e.to), mode, reason }, path);
    return { status: 'succeeded', output: input, chosen: new Set(chosen.map((e) => e.id)) };
  },
};
