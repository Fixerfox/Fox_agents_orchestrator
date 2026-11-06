/** Por qué se detiene una ejecución antes de tiempo; manda el primer motivo. */
export class RunAbort {
  private readonly controller = new AbortController();
  reason?: 'cancelled' | 'budget_exceeded';
  detail?: string;

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  abort(reason: 'cancelled' | 'budget_exceeded', detail?: string): void {
    if (!this.reason) {
      this.reason = reason;
      if (detail !== undefined) this.detail = detail;
    }
    this.controller.abort();
  }
}
