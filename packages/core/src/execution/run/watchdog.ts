import { MINUTE_MS, type Timers } from './timers';

export type TimeoutKind = 'idle' | 'tool' | 'total' | 'loop';

export interface WatchdogOptions {
  idleMinutes: number;
  toolMinutes: number;
  maxMinutes?: number;
  timers: Timers;
  /** ¿Está la ejecución en pausa? Entonces el reloj no corta [R70.3]. */
  paused(): boolean;
  /** A la mitad del umbral [R70.4]. */
  onHalf(kind: 'idle' | 'tool', minutes: number, tool: string | undefined): void;
  /** Al llegar al umbral [R70.5][R70.6]. */
  onFire(kind: TimeoutKind, minutes: number, tool: string | undefined): void;
}

/** Herramientas iguales seguidas que dan aviso y que cortan el intento [R70.10][R70.11]. */
export const LOOP_WARN = 4;
export const LOOP_CUT = 8;

/** Firma de una llamada a una herramienta, con los espacios normalizados [R70.10]. */
export function toolSignature(tool: string, input: unknown): string {
  let json: string;
  try {
    json = JSON.stringify(input ?? {});
  } catch {
    json = String(input);
  }
  return `${tool}:${json.replace(/\s+/g, ' ').trim()}`;
}

/**
 * Latido de un intento de agente [R70.1]–[R70.6]: dos umbrales de inactividad (sin herramienta y con una en
 * curso) y una duración máxima opcional que no cuenta la espera a la persona.
 */
export class StepWatchdog {
  private tools: string[] = [];
  private suspended = 0;
  private half: unknown;
  private full: unknown;
  private total: unknown;
  private totalLeft: number | undefined;
  private totalFrom = 0;
  private stopped = false;
  private fired = false;

  constructor(private readonly o: WatchdogOptions) {}

  start(): void {
    if (this.o.maxMinutes !== undefined) this.totalLeft = this.o.maxMinutes * MINUTE_MS;
    this.arm();
    this.armTotal();
  }

  /** Una señal de vida [R70.1]; `tool_call` y `tool_result` cuentan las herramientas en curso [R70.2]. */
  activity(kind: 'tool_call' | 'tool_result' | 'other', tool?: string): void {
    if (kind === 'tool_call' && tool) this.tools.push(tool);
    if (kind === 'tool_result') {
      const i = tool ? this.tools.lastIndexOf(tool) : this.tools.length - 1;
      if (i >= 0) this.tools.splice(i, 1);
    }
    if (this.suspended === 0) this.arm();
  }

  /** Esperando a la persona: el reloj se detiene [R70.3]. */
  suspend(): void {
    this.suspended++;
    if (this.suspended > 1) return;
    this.clearIdle();
    if (this.total !== undefined) {
      this.o.timers.clear(this.total);
      this.total = undefined;
      this.totalLeft = Math.max(0, (this.totalLeft ?? 0) - (this.o.timers.now() - this.totalFrom));
    }
  }

  /** Sigue: el reloj vuelve a cero [R70.3]. */
  resume(): void {
    if (this.suspended === 0) return;
    this.suspended--;
    if (this.suspended > 0) return;
    this.arm();
    this.armTotal();
  }

  /** Corta por repetir la misma acción [R70.11]. */
  loop(tool: string): void {
    this.fire('loop', 0, tool);
  }

  stop(): void {
    this.stopped = true;
    this.clearIdle();
    if (this.total !== undefined) this.o.timers.clear(this.total);
  }

  private clearIdle(): void {
    if (this.half !== undefined) this.o.timers.clear(this.half);
    if (this.full !== undefined) this.o.timers.clear(this.full);
    this.half = this.full = undefined;
  }

  private arm(): void {
    if (this.stopped || this.fired) return;
    this.clearIdle();
    const kind = this.tools.length > 0 ? 'tool' : 'idle';
    const minutes = kind === 'tool' ? this.o.toolMinutes : this.o.idleMinutes;
    const tool = this.tools.at(-1);
    const ms = minutes * MINUTE_MS;
    this.half = this.o.timers.set(() => {
      if (this.o.paused()) return this.arm();
      this.o.onHalf(kind, minutes / 2, tool);
    }, ms / 2);
    this.full = this.o.timers.set(() => {
      if (this.o.paused()) return this.arm();
      this.fire(kind, minutes, tool);
    }, ms);
  }

  private armTotal(): void {
    if (this.stopped || this.fired || this.totalLeft === undefined) return;
    this.totalFrom = this.o.timers.now();
    this.total = this.o.timers.set(() => {
      // En pausa no se corta: se vuelve a mirar en un minuto [R70.3].
      if (this.o.paused()) {
        this.totalLeft = MINUTE_MS;
        return this.armTotal();
      }
      this.fire('total', this.o.maxMinutes!, this.tools.at(-1));
    }, this.totalLeft);
  }

  private fire(kind: TimeoutKind, minutes: number, tool: string | undefined): void {
    if (this.stopped || this.fired) return;
    this.fired = true;
    this.stop();
    this.o.onFire(kind, minutes, tool);
  }
}
