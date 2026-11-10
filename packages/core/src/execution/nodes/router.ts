import type { Edge } from '../../diagrams';
import type { Id } from '../../shared';
import { replayedIn } from '../run/replay-decider';
import { targetDescriber } from './flow';
import { chargeDecision, failStep, nodeStarted, type NodeHandler } from './handler';

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
      const asked = outEdges.filter((e) => e.condition).map((e) => ({ edgeId: e.id, condition: e.condition! }));
      // Todas las condiciones en una sola consulta si el motor sabe hacerlo [R63.16].
      let batch: Record<Id, boolean> | undefined;
      if (asked.length > 0 && decider.conditions) {
        const res = await decider.conditions({ conditions: asked, input }, signal);
        batch = res.results;
        chargeDecision(step, node, path, res.usage);
      }
      for (const edge of outEdges) {
        const matched = edge.condition ? (batch ? batch[edge.id] === true : await decider.condition({ condition: edge.condition, input }, signal)) : true;
        results.push({ edgeId: edge.id, ...(edge.condition ? { condition: edge.condition } : {}), matched });
        if (matched) chosen.push(edge);
      }
      emitter.emit({ type: 'decision', nodeId: node.id, kind: 'condition', request: { input }, response: results, ...(replayedIn(decider, 'condition') ? { reused: true } : {}) }, path);
      reason = 'reglas de las aristas';
    } else {
      // Con la app, cada opción lleva qué hay en ella; el criterio, siempre que lo haya [R81.2][R81.3].
      const describe = targetDescriber(step, path);
      const candidates = outEdges.map((e) => ({ edgeId: e.id, to: e.to, label: nodeById.get(e.to)?.label ?? e.to, ...(describe ? { description: describe(e.to) } : {}) }));
      const criteria = node.router?.criteria?.trim() || undefined;
      const { usage, ...res } = await decider.route({ nodeId: node.id, candidates, input, ...(criteria ? { criteria } : {}) }, signal);
      emitter.emit({ type: 'decision', nodeId: node.id, kind: 'route', request: { candidates, input, ...(criteria ? { criteria } : {}) }, response: res, ...(replayedIn(decider, 'route') ? { reused: true } : {}) }, path);
      chargeDecision(step, node, path, usage);
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
