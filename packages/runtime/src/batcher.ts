/** Agrupa elementos y los entrega por lotes cada `ms` conservando el orden [R20.4]. */
export class Batcher<T> {
  private buffer: T[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly send: (batch: T[]) => void,
    private readonly ms = 50,
  ) {}

  push(item: T): void {
    this.buffer.push(item);
    if (this.timer === undefined) {
      this.timer = setTimeout(() => this.flush(), this.ms);
    }
  }

  /** Entrega lo pendiente ahora (p. ej. al terminar la ejecución). */
  flush(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    this.send(batch);
  }

  dispose(): void {
    this.flush();
  }
}
