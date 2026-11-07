const DEFAULT_RETRY = { maxAttempts: 3, baseDelayMs: 1000 };

export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

export const defaultSleep: Sleep = (ms, signal) =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve();
    // Sin oyentes colgados en la señal de la ejecución [R63.14].
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });

/** Intentos y espera creciente: la espera se duplica en cada intento [R56.13]. */
export class RetryPolicy {
  readonly maxAttempts: number;
  private readonly baseDelayMs: number;

  constructor(
    config: { maxAttempts: number; baseDelayMs: number } = DEFAULT_RETRY,
    private readonly sleep: Sleep = defaultSleep,
  ) {
    this.maxAttempts = config.maxAttempts;
    this.baseDelayMs = config.baseDelayMs;
  }

  /** Espera tras el intento `attempt` (el primero es 1). */
  delayAfter(attempt: number): number {
    return this.baseDelayMs * 2 ** (attempt - 1);
  }

  wait(ms: number, signal: AbortSignal): Promise<void> {
    return this.sleep(ms, signal);
  }
}
