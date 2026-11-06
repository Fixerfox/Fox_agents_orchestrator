import { nodeStarted, type NodeHandler } from '../handler';
import { runAiReview } from './ai';
import { runHumanReview } from './human';

/** Revisión: la decide el veredicto o la IA, o espera al usuario [R34.6][R53.3]. */
export const reviewHandler: NodeHandler = {
  kind: 'review',
  async run(step, node, input, path) {
    nodeStarted(step, node, input, path);
    return node.review!.mode === 'human' ? runHumanReview(step, node, input, path) : runAiReview(step, node, input, path);
  },
};
