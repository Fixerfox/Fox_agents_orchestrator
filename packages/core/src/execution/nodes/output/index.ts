import { nodeStarted, type NodeHandler } from '../handler';
import { composeDeliverable } from './deliverable';

/** Salida: lo que llega es el resultado; la del nivel principal compone el entregable [R46.6]. */
export const outputHandler: NodeHandler = {
  kind: 'output',
  async run(step, node, input, path) {
    nodeStarted(step, node, input, path);
    if (path.length === 0 && step.deliverable) return composeDeliverable(step, node, input, step.deliverable);
    return { status: 'succeeded', output: input };
  },
};
