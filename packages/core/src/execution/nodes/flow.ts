import type { DiagramNode } from '../../diagrams';
import type { Id } from '../../shared';
import { describeTarget, flowContext } from '../text/flow-context';
import type { StepContext } from './handler';

/** Bucles y subdiagramas por la ruta, del más cercano al más lejano, y la vuelta del bucle más cercano [R80.6]. */
function containersOf(step: StepContext, path: readonly Id[]): { containers: DiagramNode[]; loopRound?: number } {
  const levels = step.flow?.levels;
  const containers: DiagramNode[] = [];
  let loopRound: number | undefined;
  if (!levels) return { containers };
  for (let i = path.length - 1; i >= 0; i--) {
    const at = path.slice(0, i);
    const container = levels.get(at.join('/'))?.nodes.find((n) => n.id === path[i]);
    if (!container) continue;
    containers.push(container);
    if (container.kind === 'loop' && loopRound === undefined) {
      const done = step.emitter.history().filter((e) => e.type === 'loop.iteration' && e.loopId === container.id && (e.nodePath ?? []).join('/') === at.join('/')).length;
      loopRound = done + 1;
    }
  }
  return { containers, ...(loopRound !== undefined ? { loopRound } : {}) };
}

const agentNameOf = (step: StepContext) => (id: Id) => step.describeAgent?.(id)?.name;

/** Su sitio en el flujo, si la app lo pide [R80.1][R80.10]. */
export function flowOf(step: StepContext, node: DiagramNode, path: readonly Id[]): string | undefined {
  if (!step.flow) return undefined;
  return flowContext({ diagram: step.level.diagram, nodeId: node.id, ...containersOf(step, path), agentName: agentNameOf(step) });
}

/** Descripción de un destino para el router con IA, si la app lo pide [R81.2]. */
export function targetDescriber(step: StepContext, path: readonly Id[]): ((id: Id) => string) | undefined {
  if (!step.flow) return undefined;
  const { containers } = containersOf(step, path);
  return (id) => describeTarget({ diagram: step.level.diagram, containers, agentName: agentNameOf(step) }, id);
}
