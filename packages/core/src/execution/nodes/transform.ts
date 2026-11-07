import { AgentError } from '../adapter';
import { applyTransformRules, checkFormat, transformAttempts } from '../transform';
import { errorMessage, failStep, nodeStarted, type NodeHandler, type Outcome } from './handler';

/** Nodo «Transformar»: reglas sin IA o Claude con reintentos si no cumple el formato [R37.3]–[R37.10]. */
export const transformHandler: NodeHandler = {
  kind: 'transform',
  async run(step, node, input, path) {
    nodeStarted(step, node, input, path);
    const { emitter, signal } = step;
    const cfg = node.transform!;
    const done = (attempts: number, ok: boolean, errors: string[], warnings: string[]) =>
      emitter.emit({ type: 'transform.done', nodeId: node.id, mode: cfg.mode, format: cfg.format, attempts, ok, ...(errors.length > 0 ? { errors } : {}), ...(warnings.length > 0 ? { warnings } : {}) }, path);
    const fail = (message: string): Outcome => failStep(step, node, message, path);

    if (cfg.mode === 'rules') {
      const r = applyTransformRules(cfg, input);
      if (!r.ok) {
        done(1, false, r.errors, r.warnings);
        return fail(`No se pudo transformar: ${r.errors.join('; ')}`);
      }
      done(1, true, [], r.warnings);
      return { status: 'succeeded', output: { text: r.text, files: [...input.files] } };
    }

    const transform = step.decider.transform?.bind(step.decider);
    if (!transform) {
      done(0, false, ['El motor activo no sabe transformar con Claude'], []);
      return fail('El motor activo no sabe transformar con Claude; usa el modo por reglas.');
    }
    const max = transformAttempts(cfg);
    let lastError = '';
    let used = 0;
    for (let attempt = 1; attempt <= max; attempt++) {
      used = attempt;
      await step.gate.wait(signal);
      if (signal.aborted) return { status: 'cancelled' };
      let text: string;
      try {
        ({ text } = await transform(
          {
            nodeId: node.id,
            format: cfg.format,
            instructions: cfg.instructions ?? '',
            ...(cfg.schema?.trim() ? { schema: cfg.schema } : {}),
            input,
            attempt,
            ...(lastError ? { previousError: lastError } : {}),
          },
          signal,
        ));
      } catch (err) {
        if (signal.aborted) return { status: 'cancelled' };
        lastError = errorMessage(err);
        const retriable = err instanceof AgentError && err.retriable;
        emitter.emit({ type: 'error', nodeId: node.id, message: lastError, retriable: retriable && attempt < max }, path);
        if (!retriable) break;
        if (attempt < max) {
          // Error temporal del motor: misma espera creciente que los agentes [R37.7].
          const delayMs = step.retry.delayAfter(attempt);
          emitter.emit({ type: 'node.retrying', nodeId: node.id, attempt, max, delayMs, message: lastError }, path);
          await step.retry.wait(delayMs, signal);
        }
        continue;
      }
      if (signal.aborted) return { status: 'cancelled' };
      const r = checkFormat(text, cfg.format, cfg.schema, true);
      if (r.ok) {
        done(attempt, true, [], []);
        return { status: 'succeeded', output: { text: r.text, files: [...input.files] } };
      }
      lastError = r.errors.join('; ');
      if (attempt < max) emitter.emit({ type: 'node.retrying', nodeId: node.id, attempt, max, delayMs: 0, message: lastError }, path);
    }
    done(used, false, [lastError], []);
    return fail(`No se pudo transformar tras ${used} intento${used === 1 ? '' : 's'}: ${lastError}`);
  },
};
