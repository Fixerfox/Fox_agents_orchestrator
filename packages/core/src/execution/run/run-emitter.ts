import type { Id } from '../../shared';
import type { EventBody, EventBus, RunEvent } from '../events';
import type { Timers } from './timers';

/** Cada cuánto y desde cuántos caracteres se emite un grupo de `token.stream` [R77.15]. */
export const TOKEN_GROUP_MS = 250;
export const TOKEN_GROUP_CHARS = 2000;

interface Group {
  nodeId: Id;
  path: readonly Id[];
  text: string;
  timer: unknown;
}

/**
 * Emisión de eventos de una ejecución, con `seq` creciente [R56.13]. Con `coalesce`, los `token.stream` seguidos de un
 * mismo paso se juntan en uno cada `ms` o cada `chars` caracteres; cualquier otro evento de ese paso, o de la
 * ejecución, cierra el grupo antes, para que el orden se mantenga [R77.15].
 */
export class RunEmitter {
  private readonly groups = new Map<string, Group>();

  constructor(
    private readonly bus: EventBus,
    private readonly coalesce?: { ms: number; chars: number; timers: Timers },
  ) {}

  get runId(): Id {
    return this.bus.runId;
  }

  emit(body: EventBody, path: readonly Id[] = []): void {
    const nodeId = 'nodeId' in body ? body.nodeId : undefined;
    if (this.coalesce && body.type === 'token.stream') return this.group(body.nodeId, body.text, path);
    if (this.groups.size > 0) {
      if (nodeId !== undefined) this.flush([...path, nodeId].join('/'));
      else if (body.type.startsWith('run.')) for (const k of [...this.groups.keys()]) this.flush(k);
    }
    this.bus.emit(body, path);
  }

  private group(nodeId: Id, text: string, path: readonly Id[]): void {
    const c = this.coalesce!;
    const key = [...path, nodeId].join('/');
    let g = this.groups.get(key);
    if (!g) {
      g = { nodeId, path: [...path], text: '', timer: c.timers.set(() => this.flush(key), c.ms) };
      this.groups.set(key, g);
    }
    g.text += text;
    if (g.text.length >= c.chars) this.flush(key);
  }

  /** Emite lo que haya juntado un paso. */
  private flush(key: string): void {
    const g = this.groups.get(key);
    if (!g) return;
    this.groups.delete(key);
    this.coalesce!.timers.clear(g.timer);
    if (g.text) this.bus.emit({ type: 'token.stream', nodeId: g.nodeId, text: g.text }, g.path);
  }

  /** Error definitivo de un paso. */
  error(nodeId: Id, message: string, path: readonly Id[]): void {
    this.emit({ type: 'error', nodeId, message, retriable: false }, path);
  }

  history(): readonly RunEvent[] {
    return this.bus.history();
  }
}
