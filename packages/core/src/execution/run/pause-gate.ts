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
        this.waiters.push(resolve);
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
    }
  }
}
