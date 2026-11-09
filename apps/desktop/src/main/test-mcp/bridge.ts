import { parseTestReply, type TestCall } from '@orquestador/editor';

/** Llamadas a la interfaz y sus respuestas, con límite de tiempo [R82.17]. */
export class RendererBridge {
  private readonly pending = new Map<string, { resolve(v: unknown): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private readyWaiters: (() => void)[] = [];
  private seq = 0;

  constructor(private readonly send: (call: TestCall) => boolean) {}

  /** Ejecuta en la interfaz y espera su respuesta, como mucho `timeoutMs`. */
  call(tool: string, args: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    const id = `t${++this.seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`La interfaz no respondió en ${Math.round(timeoutMs / 1000)} s.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      if (!this.send({ id, tool, args })) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error('No hay ventana de la app.'));
      }
    });
  }

  /** Lo que responde la interfaz; lo que no encaja se ignora. */
  reply(raw: unknown): void {
    const r = parseTestReply(raw);
    const p = r && this.pending.get(r.id);
    if (!r || !p) return;
    clearTimeout(p.timer);
    this.pending.delete(r.id);
    if (r.ok) p.resolve(r.result);
    else p.reject(new Error(typeof r.result === 'string' ? r.result : JSON.stringify(r.result)));
  }

  /** La interfaz está lista: las llamadas que quedaban de antes de recargar ya no tendrán respuesta [R82.16]. */
  ready(): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('La interfaz se recargó.'));
      this.pending.delete(id);
    }
    const waiters = this.readyWaiters;
    this.readyWaiters = [];
    waiters.forEach((w) => w());
  }

  /** Espera a la siguiente vez que la interfaz diga que está lista. */
  nextReady(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('La interfaz no volvió a estar lista.')), timeoutMs);
      this.readyWaiters.push(() => (clearTimeout(timer), resolve()));
    });
  }
}

/** Rutas para los siguientes diálogos de archivos [R82.11]. */
export class DialogQueue {
  private readonly queue: string[][] = [];

  push(paths: string[]): void {
    this.queue.push([...paths]);
  }

  /** Lo siguiente en la cola: rutas, `[]` (cancelar) o nada si no hay que responder. */
  take(): string[] | undefined {
    return this.queue.shift();
  }

  /** Un diálogo de una sola ruta: la de la cola, `null` si se canceló, o el diálogo de verdad. */
  async one(real: () => Promise<string | null>): Promise<string | null> {
    const q = this.take();
    return q === undefined ? real() : (q[0] ?? null);
  }

  /** Un diálogo de varias rutas. */
  async many(real: () => Promise<string[] | null>): Promise<string[] | null> {
    const q = this.take();
    return q === undefined ? real() : q.length > 0 ? q : null;
  }
}

/** Errores y avisos de la interfaz desde que arrancó, con tope [R82.15]. */
export class ConsoleLog {
  private readonly lines: string[] = [];

  constructor(private readonly max = 500) {}

  add(line: string): void {
    this.lines.push(`${new Date().toISOString()} ${line}`);
    if (this.lines.length > this.max) this.lines.splice(0, this.lines.length - this.max);
  }

  last(n: number): string[] {
    return this.lines.slice(-n);
  }
}

/** Nivel y texto de un mensaje de consola de Electron (forma nueva con objeto o antigua con argumentos). */
export function consoleEntry(args: readonly unknown[]): { level: string; message: string } | undefined {
  const first = args[0] as { level?: unknown; message?: unknown } | undefined;
  if (typeof first?.message === 'string') return { level: typeof first.level === 'string' ? first.level : 'info', message: first.message };
  if (typeof args[2] === 'string') {
    const n = typeof args[1] === 'number' ? args[1] : 0;
    return { level: ['verbose', 'info', 'warning', 'error'][n] ?? 'info', message: args[2] };
  }
  return undefined;
}
