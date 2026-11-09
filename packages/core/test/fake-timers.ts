import type { Timers } from '../src';

/** Vacía las tareas pendientes de la cola de microtareas y de la de E/S. */
export async function flush(times = 20): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise<void>((r) => setImmediate(r));
}

/** Reloj falso: los temporizadores solo corren al avanzar [R70.9]. */
export class FakeTimers implements Timers {
  t = 0;
  private seq = 0;
  private queue: { id: number; at: number; fn: () => void }[] = [];

  set(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.queue.push({ id, at: this.t + ms, fn });
    return id;
  }

  clear(handle: unknown): void {
    this.queue = this.queue.filter((x) => x.id !== handle);
  }

  now(): number {
    return this.t;
  }

  get pending(): number {
    return this.queue.length;
  }

  /** Avanza `ms`, corriendo en orden lo que vence y dejando que la ejecución reaccione entre medias. */
  async advance(ms: number): Promise<void> {
    const end = this.t + ms;
    for (;;) {
      await flush();
      const next = this.queue.filter((x) => x.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!next) break;
      this.queue = this.queue.filter((x) => x !== next);
      this.t = next.at;
      next.fn();
    }
    this.t = end;
    await flush();
  }
}

export const MIN = 60_000;
