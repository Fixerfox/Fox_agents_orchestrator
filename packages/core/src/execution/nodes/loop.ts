import { chargeDecision, failStep, nodeStarted, type NodeHandler } from './handler';

/** Bucle: repite su cuerpo un número de veces o hasta que el evaluador diga que basta. */
export const loopHandler: NodeHandler = {
  kind: 'loop',
  async run(step, node, input, path) {
    nodeStarted(step, node, input, path);
    const { depth, emitter, signal } = step;
    if (depth + 1 > step.maxDepth) return failStep(step, node, `Profundidad máxima (${step.maxDepth}) superada`, path);
    const cfg = node.loop!;
    const max = cfg.mode === 'count' ? Math.min(cfg.count ?? 1, cfg.maxIterations) : cfg.maxIterations;
    let current = input;
    for (let n = 1; n <= max; n++) {
      const r = await step.execute(cfg.body, current, [...path, node.id], depth + 1, step.stack, step.space);
      if (r.status === 'cancelled') return { status: 'cancelled' };
      if (r.status === 'failed' || !r.output) return { status: 'failed' };
      current = r.output;

      let done = n >= max;
      let reason: string | undefined;
      if (cfg.mode === 'ai-judge') {
        const request = { prompt: cfg.prompt!, output: current, iteration: n };
        const { usage, ...verdict } = await step.decider.judge(request, signal);
        emitter.emit({ type: 'decision', nodeId: node.id, kind: 'judge', request, response: verdict }, path);
        chargeDecision(step, node, path, usage);
        if (signal.aborted) return { status: 'cancelled' };
        reason = verdict.reason;
        if (verdict.done) done = true;
        else if (n >= max) reason = `${reason} · máximo de iteraciones alcanzado`;
      }
      emitter.emit({ type: 'loop.iteration', loopId: node.id, n, max, verdict: done ? 'done' : 'continue', ...(reason !== undefined ? { reason } : {}) }, path);
      if (done) break;
    }
    return { status: 'succeeded', output: current };
  },
};
