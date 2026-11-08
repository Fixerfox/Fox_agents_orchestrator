import type { AgentQuestion } from '../adapter';
import type { RunOptions } from '../run-types';
import type { RunAbort } from './run-abort';
import type { RunEmitter } from './run-emitter';

/** Aviso y freno del presupuesto [R77.6][R77.7]. */
export const BUDGET_WARN = 0.8;
export const BUDGET_BRAKE = 0.9;
export const BUDGET_QUESTION = 'Queda menos del 10 % del presupuesto';
export const BUDGET_GO_ON = 'Seguir hasta el límite';
export const BUDGET_STOP = 'Parar la ejecución';
/** «Subir el límite a…»: con el doble del límite como propuesta; también vale escribir la cifra [R77.7]. */
export const BUDGET_RAISE = 'Subir el límite a';
/** Lo que dice un paso que ya no arranca con `finish-running` [R77.8]. */
export const BUDGET_SPENT = 'No queda presupuesto: lo que estaba en marcha termina y no empieza nada más';

type Limit = 'tokens' | 'cost';
const fmt = (limit: Limit, n: number) => (limit === 'cost' ? `${n.toFixed(2)} $` : `${Math.round(n).toLocaleString('es-ES')} tokens`);

/**
 * Uso acumulado de la ejecución y su límite [R56.13]: avisa al 80 %, frena los pasos nuevos al 90 % y, al 100 %,
 * para la ejecución o deja terminar lo que está en marcha [R77.6]–[R77.8].
 */
export class BudgetTracker {
  readonly usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  /** Lo que cuenta para el presupuesto: sin lo del Supervisor [R60.14][R77.11]. */
  private readonly counted = { tokens: 0, cost: 0 };
  private readonly max: { tokens?: number; cost?: number };
  private hit = false;
  private readonly warned = new Set<Limit>();
  /** «Seguir hasta el límite»: no se vuelve a preguntar. */
  private goOn = false;
  private asking: Promise<'go' | 'stop'> | undefined;
  /** Se llegó al 100 % con `finish-running`: no arranca nada nuevo [R77.8]. */
  exhausted = false;

  constructor(
    budget: RunOptions['budget'],
    private readonly emitter: RunEmitter,
    private readonly stop: RunAbort,
    private readonly onBudget: NonNullable<RunOptions['onBudget']> = 'stop-now',
  ) {
    this.max = { ...(budget?.maxTokens !== undefined ? { tokens: budget.maxTokens } : {}), ...(budget?.maxCostUsd !== undefined ? { cost: budget.maxCostUsd } : {}) };
  }

  /** Suma al uso sin comprobar el límite: lo que gasta el Supervisor no corta la ejecución [R60.14]. */
  track(inputTokens: number, outputTokens: number, costUsd = 0): void {
    this.usage.inputTokens += inputTokens;
    this.usage.outputTokens += outputTokens;
    this.usage.costUsd += costUsd;
  }

  private used(limit: Limit): number {
    return this.counted[limit];
  }

  /** El límite más gastado, en tanto por uno. */
  private worst(): { limit: Limit; used: number; max: number; ratio: number } | undefined {
    let out: { limit: Limit; used: number; max: number; ratio: number } | undefined;
    for (const limit of ['tokens', 'cost'] as const) {
      const max = this.max[limit];
      if (max === undefined || max <= 0) continue;
      const used = this.used(limit);
      if (!out || used / max > out.ratio) out = { limit, used, max, ratio: used / max };
    }
    return out;
  }

  add(inputTokens: number, outputTokens: number, costUsd = 0): void {
    this.track(inputTokens, outputTokens, costUsd);
    this.counted.tokens += inputTokens + outputTokens;
    this.counted.cost += costUsd;
    if (this.hit) return;
    for (const limit of ['tokens', 'cost'] as const) {
      const max = this.max[limit];
      if (max === undefined) continue;
      const used = this.used(limit);
      if (used >= max) return this.reach(limit, used, max);
      // Una vez por límite [R77.6].
      if (used >= max * BUDGET_WARN && !this.warned.has(limit)) {
        this.warned.add(limit);
        this.emitter.emit({ type: 'run.budget_warning', limit, used, max });
      }
    }
  }

  private reach(limit: Limit, used: number, max: number): void {
    this.hit = true;
    this.emitter.emit({ type: 'run.budget_reached', limit, used, max });
    // Con `finish-running` lo que está en marcha termina; la ejecución acaba fallida al final [R77.8].
    if (this.onBudget === 'finish-running') this.exhausted = true;
    else this.stop.abort('budget_exceeded', `límite de ${limit} alcanzado (${used}/${max})`);
  }

  /**
   * Antes de arrancar un paso de agente [R77.7][R77.8]: sin presupuesto, no arranca; desde el 90 %, pregunta una vez
   * para todos los pasos que esperan (`ask` lo hace en el primero) y decide la persona.
   */
  beforeStep(ask: (q: AgentQuestion) => Promise<string>): 'go' | 'stop' | Promise<'go' | 'stop'> {
    if (this.exhausted) return 'stop';
    if (this.asking) return this.asking;
    const w = this.worst();
    if (this.goOn || !w || w.ratio < BUDGET_BRAKE) return 'go';
    const raised = w.limit === 'cost' ? Math.ceil(w.max * 200) / 100 : Math.ceil(w.max * 2);
    const raise = `${BUDGET_RAISE} ${fmt(w.limit, raised)}`;
    this.asking = (async () => {
      const text = `${BUDGET_QUESTION}: se han gastado ${fmt(w.limit, w.used)} de ${fmt(w.limit, w.max)}. ¿Sigo?`;
      const answer = (await ask({ text, options: [BUDGET_GO_ON, raise, BUDGET_STOP], kind: 'budget', fallback: BUDGET_STOP })).trim();
      if (answer === BUDGET_GO_ON) {
        this.goOn = true;
        return 'go';
      }
      const typed = answer === raise ? raised : answer.startsWith(BUDGET_RAISE) || /^[\d.,\s$]+$/.test(answer) ? Number(answer.replace(/[^\d.,]/g, '').replace(',', '.')) : NaN;
      if (Number.isFinite(typed) && typed > w.used) {
        this.max[w.limit] = typed;
        this.warned.delete(w.limit);
        this.emitter.emit({ type: 'run.budget_raised', limit: w.limit, max: typed });
        return 'go';
      }
      this.stop.abort('budget_exceeded', `parada al quedar menos del 10 % del presupuesto (${fmt(w.limit, w.used)} de ${fmt(w.limit, w.max)})`);
      return 'stop';
    })().finally(() => {
      this.asking = undefined;
    });
    return this.asking;
  }
}
