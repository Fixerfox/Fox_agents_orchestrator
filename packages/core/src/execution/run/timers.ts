/** Reloj y temporizadores de una ejecución; se inyectan para probar los tiempos sin esperar [R70.9]. */
export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
  now(): number;
}

export const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

export const MINUTE_MS = 60_000;
