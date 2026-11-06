import type { Id, Payload } from '../../shared';
import { pathKey } from '../replay';
import type { Decider, SupervisorVerdict } from '../adapter';
import type { RunEvent } from '../events';
import type { RunOptions } from '../run-types';
import type { BudgetTracker } from './budget-tracker';
import type { RunEmitter } from './run-emitter';
import { applyRules, branchMemoryLine, newBranchMemory, newRuleState, rememberBranch } from './supervisor-rules';

/** Tiempo que se espera a las revisiones pendientes al terminar [R60.13]. */
const SETTLE_MS = 10_000;
/** Tope de la memoria [R60.24]. */
const MEMORY_MAX = 8000;
const MAX_ACTIONS = 40;
const ACTION_CHARS = 160;

interface Entry {
  label: string;
  text: string;
  files: readonly string[];
}

/** Lo que el Supervisor sabe de un paso mientras trabaja. */
interface StepTrail {
  nodeId: Id;
  path: readonly Id[];
  input: Payload;
  task?: string;
  actions: string[];
  files: Set<string>;
}

export interface SupervisorDeps {
  emitter: RunEmitter;
  decider: Decider;
  budget: BudgetTracker;
  limits: RunOptions['budget'];
  signal: AbortSignal;
  /** ¿Se revisa con IA? Se pregunta en cada paso. */
  review(): boolean;
  /** Modelo con el que revisa [R60.28]. */
  model?(): string;
  labelOf(nodeId: Id): string;
  settleMs?: number;
}

const entryLine = (e: Entry, full: boolean): string => {
  const files = e.files.length > 0 ? ` (archivos: ${e.files.join(', ')})` : '';
  return full && e.text ? `- ${e.label}: ${e.text}${files}` : `- ${e.label}${files}`;
};

/** Vigila una ejecución: reglas, revisión con IA y memoria [R60.1][R60.12][R60.18]. */
export class Supervisor {
  private readonly rules = newRuleState();
  private readonly told = new Set<string>();
  private readonly trails = new Map<string, StepTrail>();
  private readonly entries: Entry[] = [];
  private readonly branches = newBranchMemory();
  private readonly pending = new Set<Promise<void>>();
  private reviewsOff = false;
  private closed = false;

  constructor(private readonly d: SupervisorDeps) {}

  /** Escucha cada evento; un fallo aquí nunca llega a la ejecución [R60.3]. */
  observe(e: RunEvent): void {
    if (e.type.startsWith('supervisor.')) return;
    try {
      if (e.type === 'run.started') this.started();
      for (const a of applyRules(this.rules, e, this.d.limits)) this.alert(a.nodeId, a.path, a.rule, a.detail);
      this.follow(e);
    } catch {
      // El Supervisor nunca rompe una ejecución.
    }
  }

  private started(): void {
    const review = this.d.decider.supervise !== undefined && this.d.review();
    const model = review ? this.d.model?.() : undefined;
    this.d.emitter.emit({ type: 'supervisor.started', review, ...(model ? { model } : {}) });
  }

  private alert(nodeId: Id, path: readonly Id[], rule: string, detail: string): void {
    const key = `${rule}|${pathKey(path, nodeId)}`;
    if (this.told.has(key)) return;
    this.told.add(key);
    this.d.emitter.emit({ type: 'supervisor.alert', nodeId, rule, severity: 'warning', detail }, path);
  }

  private follow(e: RunEvent): void {
    const path = e.nodePath ?? [];
    if (e.type === 'git.branch') {
      rememberBranch(this.branches, e, this.d.labelOf(e.nodeId));
      return;
    }
    if (e.type === 'agent.request') {
      const key = pathKey(path, e.nodeId);
      if (!this.trails.has(key)) this.trails.set(key, { nodeId: e.nodeId, path, input: e.input, ...(e.task ? { task: e.task } : {}), actions: [], files: new Set() });
      return;
    }
    if (e.type !== 'tool.called' && e.type !== 'file.produced' && e.type !== 'node.finished') return;
    const key = pathKey(path, e.nodeId);
    const trail = this.trails.get(key);
    if (!trail) return;
    if (e.type === 'tool.called') {
      if (trail.actions.length < MAX_ACTIONS) trail.actions.push(`${e.tool}: ${JSON.stringify(e.input ?? {}).slice(0, ACTION_CHARS)}`);
    } else if (e.type === 'file.produced') {
      trail.files.add(e.path);
    } else {
      this.trails.delete(key);
      this.finished(trail, e.output ?? { text: '', files: [] });
    }
  }

  private note(trail: StepTrail, text: string, reviewed = false): void {
    const label = this.d.labelOf(trail.nodeId);
    const files = [...trail.files];
    this.entries.push({ label, text, files });
    this.d.emitter.emit({ type: 'supervisor.note', nodeId: trail.nodeId, text, files, ...(reviewed ? { reviewed } : {}) }, trail.path);
  }

  private finished(trail: StepTrail, output: Payload): void {
    const { decider, review, signal } = this.d;
    // Sin revisión, la entrada sale de lo que se sabe: el paso y sus archivos [R60.20].
    if (this.reviewsOff || !decider.supervise || !review() || signal.aborted) return this.note(trail, '');
    this.d.emitter.emit({ type: 'supervisor.reviewing', nodeId: trail.nodeId }, trail.path);
    const ask = decider.supervise(
      { step: this.d.labelOf(trail.nodeId), input: trail.input, ...(trail.task ? { task: trail.task } : {}), actions: trail.actions, output: { text: output.text, files: [...new Set([...output.files, ...trail.files])] } },
      signal,
    );
    const job: Promise<void> = ask
      .then((verdict) => this.reviewed(trail, verdict))
      .catch(() => {
        if (this.closed || signal.aborted) return;
        if (!this.reviewsOff) this.d.emitter.emit({ type: 'supervisor.skipped', count: 1, reason: 'failed' });
        this.reviewsOff = true;
        this.note(trail, '');
      })
      .finally(() => this.pending.delete(job));
    this.pending.add(job);
  }

  private reviewed(trail: StepTrail, v: SupervisorVerdict): void {
    if (this.closed) return;
    if (v.usage) {
      // Cuenta en el uso, sin disparar el límite: el Supervisor no corta una ejecución [R60.14].
      this.d.budget.track(v.usage.inputTokens, v.usage.outputTokens, v.usage.costUsd);
      this.d.emitter.emit({ type: 'agent.usage', nodeId: trail.nodeId, inputTokens: v.usage.inputTokens, outputTokens: v.usage.outputTokens, ...(v.usage.costUsd !== undefined ? { costUsd: v.usage.costUsd } : {}), source: 'supervisor' }, trail.path);
    }
    if (!v.ok) this.alert(trail.nodeId, trail.path, 'ai-review', v.reason || 'Lo hecho no corresponde a lo pedido.');
    if (v.outOfScope) this.alert(trail.nodeId, trail.path, 'out-of-scope', v.outOfScope);
    this.note(trail, v.summary, true);
  }

  /** Espera a las revisiones pendientes, con un tope [R60.13]. */
  async settle(): Promise<void> {
    if (this.pending.size > 0) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const limit = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, this.d.settleMs ?? SETTLE_MS);
      });
      await Promise.race([Promise.allSettled([...this.pending]), limit]);
      clearTimeout(timer);
    }
    if (this.pending.size > 0 && !this.d.signal.aborted) this.d.emitter.emit({ type: 'supervisor.skipped', count: this.pending.size, reason: 'timeout' });
    this.closed = true;
  }

  /** La memoria tal como está ahora: la rama y el diario, que no pasa del tope [R60.23][R60.24][R60.26]. */
  memory(): string | undefined {
    const head = branchMemoryLine(this.branches);
    const diary = this.diary(MEMORY_MAX - (head ? head.length + 1 : 0));
    return [head, diary].filter(Boolean).join('\n') || undefined;
  }

  /** El diario con su tope; recorta primero lo más antiguo [R60.24]. */
  private diary(max: number): string {
    const lines = this.entries.map((e) => entryLine(e, true));
    for (let i = 0; i < lines.length && lines.join('\n').length > max; i++) lines[i] = entryLine(this.entries[i]!, false);
    const text = lines.join('\n');
    return text.length > max ? text.slice(text.length - max) : text;
  }
}
