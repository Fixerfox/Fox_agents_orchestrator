import { nodeStarted, type NodeHandler } from './handler';

/** Entrada: deja pasar la orden. */
export const entryHandler: NodeHandler = {
  kind: 'entry',
  async run(step, node, input, path) {
    nodeStarted(step, node, input, path);
    return { status: 'succeeded', output: input };
  },
};
