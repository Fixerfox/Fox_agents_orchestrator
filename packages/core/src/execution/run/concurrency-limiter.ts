/** Si un paso tiene ahora mismo su hueco de concurrencia. */
export interface Slot {
  held: boolean;
}

/** Huecos de concurrencia; un paso suelta el suyo mientras espera al usuario [R56.13]. */
export class ConcurrencyLimiter {
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) next();
    else this.active--;
  }

  /** Ejecuta `wait` sin ocupar hueco y lo recupera al acabar, salvo que la ejecución se haya cancelado. */
  async whileWaiting<T>(slot: Slot, signal: AbortSignal, wait: () => Promise<T>): Promise<T> {
    slot.held = false;
    this.release();
    try {
      return await wait();
    } finally {
      if (!signal.aborted) {
        await this.acquire();
        slot.held = true;
      }
    }
  }
}
