import type { Id } from '../../shared';
import { AgentError, type Decider } from '../adapter';
import type { RetryPolicy } from './retry-policy';
import type { RunEmitter } from './run-emitter';
import type { Timers } from './timers';

/** Tiempo máximo de una decisión [R70.12]. */
export const DECISION_TIMEOUT_MS = 120_000;
/** Intentos de una decisión [R71.13]. */
export const DECISION_ATTEMPTS = 3;

export interface DecisionGuard {
  emitter: RunEmitter;
  retry: RetryPolicy;
  timers: Timers;
  signal: AbortSignal;
  timeoutMs: number;
  attempts: number;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Llama una vez con su propio tiempo máximo y su propia cancelación [R70.12]. */
async function once<T>(g: DecisionGuard, call: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const own = new AbortController();
  const onAbort = () => own.abort();
  if (g.signal.aborted) own.abort();
  else g.signal.addEventListener('abort', onAbort, { once: true });
  let timer: unknown;
  const limit = new Promise<never>((_, reject) => {
    timer = g.timers.set(() => {
      // Primero el error: la cancelación de la consulta no debe ganar la carrera [R70.12].
      reject(new AgentError(`La decisión tardó más de ${Math.round(g.timeoutMs / 1000)} s`, true, [], { kind: 'timeout' }));
      own.abort();
    }, g.timeoutMs);
  });
  try {
    return await Promise.race([call(own.signal), limit]);
  } finally {
    g.timers.clear(timer);
    g.signal.removeEventListener('abort', onAbort);
  }
}

/** Reintenta lo temporal con la misma espera que los agentes [R71.13]. */
async function withRetries<T>(g: DecisionGuard, nodeId: Id, path: readonly Id[], call: (signal: AbortSignal) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await once(g, call);
    } catch (err) {
      const retriable = err instanceof AgentError && err.retriable;
      if (g.signal.aborted || !retriable || attempt >= g.attempts) throw err;
      const delayMs = g.retry.delayAfter(attempt, err);
      g.emitter.emit({ type: 'node.retrying', nodeId, attempt, max: g.attempts, delayMs, message: errorText(err), ...(err.kind !== 'transient' ? { kind: err.kind } : {}) }, path);
      await g.retry.wait(delayMs, g.signal);
      if (g.signal.aborted) throw err;
    }
  }
}

/**
 * Las decisiones de un paso con tiempo máximo y reintentos [R70.12][R71.13]. `transform` solo lleva tiempo máximo:
 * su nodo ya reintenta [R37.7]. Las opcionales siguen sin estar si el motor no las tiene.
 */
export function guardDecider(decider: Decider, g: DecisionGuard, nodeId: Id, path: readonly Id[]): Decider {
  const guarded = <A, R>(fn: ((a: A, s: AbortSignal) => Promise<R>) | undefined) => (fn ? (a: A) => withRetries(g, nodeId, path, (s) => fn.call(decider, a, s)) : undefined);
  const route = guarded(decider.route)!;
  const judge = guarded(decider.judge)!;
  const condition = guarded(decider.condition)!;
  const conditions = guarded(decider.conditions);
  const judgeReview = guarded(decider.judgeReview);
  const blame = guarded(decider.blame);
  const transform = decider.transform;
  return {
    route: (r) => route(r),
    judge: (r) => judge(r),
    condition: (r) => condition(r),
    ...(conditions ? { conditions: (r) => conditions(r) } : {}),
    ...(judgeReview ? { judgeReview: (r) => judgeReview(r) } : {}),
    ...(blame ? { blame: (r) => blame(r) } : {}),
    ...(decider.supervise ? { supervise: (r, s) => decider.supervise!(r, s) } : {}),
    ...(decider.verifyRun ? { verifyRun: (r, s) => decider.verifyRun!(r, s) } : {}),
    ...(transform ? { transform: (r) => once(g, (s) => transform.call(decider, r, s)) } : {}),
  };
}
