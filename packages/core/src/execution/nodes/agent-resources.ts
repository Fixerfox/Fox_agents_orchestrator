import type { Id } from '../../shared';
import type { RunServices } from './handler';

type Step = Pick<RunServices, 'resources' | 'signal' | 'emitter' | 'gate'>;

/** El hueco global de un intento, que se suelta y se recupera mientras espera a la persona [R77.1][R77.2]. */
export class SharedSlot {
  private release: (() => void) | undefined;

  constructor(
    private readonly step: Step,
    private readonly nodeId: Id,
    private readonly path: readonly Id[],
  ) {}

  /** Espera al proveedor y a que haya hueco en toda la app; lo dice en el paso [R77.3][R77.4]. */
  async take(): Promise<void> {
    const r = this.step.resources;
    if (!r || this.release) return;
    this.release = await r.agentSlot({
      signal: this.step.signal,
      queued: (others) => this.step.emitter.emit({ type: 'node.queued', nodeId: this.nodeId, others }, this.path),
      cooling: (c) => this.step.emitter.emit({ type: 'provider.cooldown', nodeId: this.nodeId, ...c }, this.path),
    });
  }

  drop(): void {
    const r = this.release;
    this.release = undefined;
    r?.();
  }

  /** Mientras `wait`, sin hueco global [R77.2]. */
  async without<T>(wait: () => Promise<T>): Promise<T> {
    this.drop();
    try {
      return await wait();
    } finally {
      if (!this.step.signal.aborted) await this.take();
    }
  }
}

/**
 * Retiene el paso mientras la ejecución está en pausa [R77.12]; la primera vez de cada pausa lo dice con
 * `node.paused` (su siguiente herramienta, o el final del turno) [R77.13].
 */
export function pauseHold(step: Step, nodeId: Id, path: readonly Id[], around: { suspend(): void; resume(): void }) {
  let said = -1;
  return async (tool?: string): Promise<void> => {
    if (!step.gate.isPaused) return;
    if (said !== step.gate.epoch) {
      said = step.gate.epoch;
      step.emitter.emit({ type: 'node.paused', nodeId, ...(tool ? { tool } : {}) }, path);
    }
    around.suspend();
    try {
      await step.gate.wait(step.signal);
    } finally {
      around.resume();
    }
  };
}
