import { AgentError } from '../adapter';

/** Configuración de los reintentos [R7.5][R71.3]–[R71.5]. */
export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  /** Tope de cada espera; 60 s por defecto [R71.3]. */
  maxDelayMs?: number;
  /** Intentos ante límites de uso, aparte de `maxAttempts`; 5 por defecto [R71.5]. */
  limitAttempts?: number;
  /** Espera aleatoria entre 0 y el tope (jitter completo); la app la activa [R71.3]. */
  jitter?: boolean;
  /** Intentos de cada decisión; 3 por defecto [R71.13]. */
  decisionAttempts?: number;
}

const DEFAULT_RETRY: RetryConfig = { maxAttempts: 3, baseDelayMs: 1000 };
export const MAX_DELAY_MS = 60_000;
export const LIMIT_ATTEMPTS = 5;
/** Lo más que se espera por un `retry-after` [R71.4]. */
export const MAX_RETRY_AFTER_MS = 10 * 60_000;

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

/** Intentos y espera creciente, con jitter y `retry-after` [R7.5][R71.3][R71.4]. */
export class RetryPolicy {
  readonly maxAttempts: number;
  readonly limitAttempts: number;
  readonly decisionAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly jitter: boolean;

  constructor(
    config: RetryConfig = DEFAULT_RETRY,
    private readonly sleep: Sleep = defaultSleep,
    /** Aleatorio entre 0 y 1, inyectable para los tests [R71.3]. */
    private readonly random: () => number = Math.random,
  ) {
    this.maxAttempts = config.maxAttempts;
    this.baseDelayMs = config.baseDelayMs;
    this.maxDelayMs = config.maxDelayMs ?? MAX_DELAY_MS;
    this.limitAttempts = config.limitAttempts ?? LIMIT_ATTEMPTS;
    this.decisionAttempts = config.decisionAttempts ?? 3;
    this.jitter = config.jitter ?? false;
  }

  /** Espera tras el intento `attempt` (el primero es 1); con `retry-after`, lo que diga, con tope [R71.4]. */
  delayAfter(attempt: number, err?: unknown): number {
    const cap = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** (attempt - 1));
    const delay = this.jitter ? Math.floor(this.random() * cap) : cap;
    const after = err instanceof AgentError ? err.retryAfterMs : undefined;
    return after !== undefined ? Math.min(MAX_RETRY_AFTER_MS, Math.max(after, delay)) : delay;
  }

  wait(ms: number, signal: AbortSignal): Promise<void> {
    return this.sleep(ms, signal);
  }
}
