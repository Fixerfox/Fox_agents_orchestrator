/** Historial lineal con deshacer/rehacer ilimitado y marca de "guardado". */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  private saved: T;

  constructor(private current: T) {
    this.saved = current;
  }

  get present(): T {
    return this.current;
  }
  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
  /** Hay cambios respecto al último estado guardado (se compara por identidad). */
  get dirty(): boolean {
    return this.current !== this.saved;
  }

  push(next: T): void {
    if (next === this.current) return;
    this.past.push(this.current);
    this.current = next;
    this.future = [];
  }

  undo(): boolean {
    const prev = this.past.pop();
    if (prev === undefined) return false;
    this.future.push(this.current);
    this.current = prev;
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (next === undefined) return false;
    this.past.push(this.current);
    this.current = next;
    return true;
  }

  markSaved(): void {
    this.saved = this.current;
  }

  /** Sustituye todo (al abrir otro diagrama): vacía el historial y deja el estado como guardado. */
  reset(state: T): void {
    this.past = [];
    this.future = [];
    this.current = state;
    this.saved = state;
  }
}
