import type { Id } from '../../shared';
import type { EventBody, EventBus, RunEvent } from '../events';

/** Emisión de eventos de una ejecución, con `seq` creciente [R56.13]. */
export class RunEmitter {
  constructor(private readonly bus: EventBus) {}

  get runId(): Id {
    return this.bus.runId;
  }

  emit(body: EventBody, path: readonly Id[] = []): RunEvent {
    return this.bus.emit(body, path);
  }

  /** Error definitivo de un paso. */
  error(nodeId: Id, message: string, path: readonly Id[]): void {
    this.emit({ type: 'error', nodeId, message, retriable: false }, path);
  }

  history(): readonly RunEvent[] {
    return this.bus.history();
  }
}
