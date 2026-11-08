import { MAX_AGENTS_TOTAL, MAX_DECISIONS_TOTAL, type ProviderCooldown, type SharedResources } from '@orquestador/core';

/**
 * Huecos compartidos por todas las ejecuciones, en orden de llegada [R77.1][R77.2]. `max` se lee en cada momento: si
 * baja en Ajustes, los que ya trabajan terminan y no entra nadie hasta que haya sitio.
 */
export class GlobalLimiter {
  private active = 0;
  private readonly queue: { resolve: () => void; signal: AbortSignal; onAbort: () => void }[] = [];

  constructor(private readonly max: () => number) {}

  get busy(): number {
    return this.active;
  }

  /** ¿Hay que esperar? */
  get full(): boolean {
    return this.active >= Math.max(1, this.max()) || this.queue.length > 0;
  }

  /** Espera hueco; con la señal cortada, no espera y no ocupa nada (devuelve `false`). */
  acquire(signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return Promise.resolve(false);
    if (!this.full) {
      this.active++;
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      const item = {
        resolve: () => resolve(true),
        signal,
        onAbort: () => {
          const i = this.queue.indexOf(item);
          if (i >= 0) this.queue.splice(i, 1);
          resolve(false);
          this.pump();
        },
      };
      signal.addEventListener('abort', item.onAbort, { once: true });
      this.queue.push(item);
    });
  }

  release(): void {
    this.active = Math.max(0, this.active - 1);
    this.pump();
  }

  private pump(): void {
    while (this.queue.length > 0 && this.active < Math.max(1, this.max())) {
      const next = this.queue.shift()!;
      next.signal.removeEventListener('abort', next.onAbort);
      this.active++;
      next.resolve();
    }
  }

  /** `fn` con un hueco; sin hueco por cancelación, la ejecuta igual (quien llama ya sabe que se cortó). */
  async run<T>(signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
    const got = await this.acquire(signal);
    try {
      return await fn();
    } finally {
      if (got) this.release();
    }
  }
}

export interface Clock {
  now(): number;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve) => {
      if (signal.aborted) return resolve();
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      signal.addEventListener('abort', done, { once: true });
    }),
};

/** Enfriamiento de cada proveedor tras un límite de uso [R77.4]. */
export class ProviderCooldowns {
  private readonly until = new Map<string, { at: number; reason: ProviderCooldown['reason'] }>();

  constructor(private readonly clock: Clock = realClock) {}

  /** Abre o alarga el enfriamiento; devuelve cómo queda. */
  open(provider: string, retryAfterMs: number, reason: ProviderCooldown['reason']): ProviderCooldown | undefined {
    if (!(retryAfterMs > 0)) return undefined;
    const at = this.clock.now() + retryAfterMs;
    const prev = this.until.get(provider);
    if (!prev || prev.at < at) this.until.set(provider, { at, reason });
    return this.current(provider);
  }

  current(provider: string): ProviderCooldown | undefined {
    const c = this.until.get(provider);
    if (!c) return undefined;
    if (c.at <= this.clock.now()) {
      this.until.delete(provider);
      return undefined;
    }
    return { provider, untilTs: new Date(c.at).toISOString(), reason: c.reason };
  }

  /** Espera a que pase; `cooling` se llama una vez si había que esperar. */
  async wait(provider: string, signal: AbortSignal, cooling?: (c: ProviderCooldown) => void): Promise<void> {
    let told = false;
    for (let c = this.current(provider); c && !signal.aborted; c = this.current(provider)) {
      if (!told) cooling?.(c);
      told = true;
      await this.clock.sleep(Date.parse(c.untilTs) - this.clock.now(), signal);
    }
  }
}

/**
 * Lo que comparten todas las ejecuciones de la app [R77.1]–[R77.4]: agentes y decisiones a la vez, y el enfriamiento
 * del proveedor que esté usando cada una. Uno por app.
 */
export class AppResources implements SharedResources {
  readonly agents: GlobalLimiter;
  readonly decisions: GlobalLimiter;
  readonly cooldowns: ProviderCooldowns;

  constructor(o: { maxAgents?: () => number; maxDecisions?: () => number; provider?: () => string; clock?: Clock } = {}) {
    this.agents = new GlobalLimiter(o.maxAgents ?? (() => MAX_AGENTS_TOTAL));
    this.decisions = new GlobalLimiter(o.maxDecisions ?? (() => MAX_DECISIONS_TOTAL));
    this.cooldowns = new ProviderCooldowns(o.clock);
    this.provider = o.provider ?? (() => 'claude');
  }

  private readonly provider: () => string;

  async agentSlot(o: Parameters<SharedResources['agentSlot']>[0]): Promise<() => void> {
    // Antes el proveedor, para no ocupar hueco mientras se espera [R77.4].
    await this.cooldowns.wait(this.provider(), o.signal, o.cooling);
    if (this.agents.full && !o.signal.aborted) o.queued(this.agents.busy);
    const got = await this.agents.acquire(o.signal);
    let released = !got;
    return () => {
      if (released) return;
      released = true;
      this.agents.release();
    };
  }

  limited(o: Parameters<SharedResources['limited']>[0]): ProviderCooldown | undefined {
    return this.cooldowns.open(this.provider(), o.retryAfterMs, o.reason);
  }

  /** Una decisión, revisión o comprobación con IA: espera al proveedor y su hueco [R77.1][R77.4]. */
  async decision<T>(signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
    await this.cooldowns.wait(this.provider(), signal);
    return this.decisions.run(signal, fn);
  }
}
