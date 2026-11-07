/** Pausa cooperativa: quien pasa por `wait` se detiene mientras esté pausada [R56.13]. */
export class PauseGate {
  private paused = false;
  private waiters: (() => void)[] = [];

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    for (const w of this.waiters.splice(0)) w();
  }

  get isPaused(): boolean {
    return this.paused;
  }

  async wait(signal: AbortSignal): Promise<void> {
    while (this.paused && !signal.aborted) {
      await new Promise<void>((resolve) => {
        // Sin oyentes colgados en la señal de la ejecución [R63.14].
        const done = () => {
          signal.removeEventListener('abort', done);
          resolve();
        };
        this.waiters.push(done);
        signal.addEventListener('abort', done, { once: true });
      });
    }
  }
}
