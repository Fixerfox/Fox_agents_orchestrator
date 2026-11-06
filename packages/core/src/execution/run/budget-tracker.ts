import type { RunOptions } from '../run-types';
import type { RunAbort } from './run-abort';
import type { RunEmitter } from './run-emitter';

/** Uso acumulado de la ejecución y su límite: al alcanzarlo, avisa y la detiene [R56.13]. */
export class BudgetTracker {
  readonly usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  private hit = false;

  constructor(
    private readonly budget: RunOptions['budget'],
    private readonly emitter: RunEmitter,
    private readonly stop: RunAbort,
  ) {}

  add(inputTokens: number, outputTokens: number, costUsd = 0): void {
    this.usage.inputTokens += inputTokens;
    this.usage.outputTokens += outputTokens;
    this.usage.costUsd += costUsd;
    if (this.hit) return;
    const { maxTokens, maxCostUsd } = this.budget ?? {};
    const tokens = this.usage.inputTokens + this.usage.outputTokens;
    if (maxTokens !== undefined && tokens >= maxTokens) {
      this.reach('tokens', tokens, maxTokens);
    } else if (maxCostUsd !== undefined && this.usage.costUsd >= maxCostUsd) {
      this.reach('cost', this.usage.costUsd, maxCostUsd);
    }
  }

  private reach(limit: 'tokens' | 'cost', used: number, max: number): void {
    this.hit = true;
    this.emitter.emit({ type: 'run.budget_reached', limit, used, max });
    this.stop.abort('budget_exceeded', `límite de ${limit} alcanzado (${used}/${max})`);
  }
}
