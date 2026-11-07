import type { Id, Payload } from '../../shared';
import { pathKey } from '../replay';
import type { Decider, SupervisorReview, SupervisorVerdict } from '../adapter';
import type { EventBody, RunEvent } from '../events';
import type { RunOptions } from '../run-types';
import type { BudgetTracker } from './budget-tracker';
import type { RunEmitter } from './run-emitter';
import { REQUIREMENTS_UNMET } from '../text/unfinished';
import { applyRules, branchMemoryLine, newBranchMemory, newRuleState, rememberBranch } from './supervisor-rules';

/** Tiempo que se espera a las revisiones pendientes al terminar [R60.13]. */
const SETTLE_MS = 10_000;
/** Tope de la memoria [R60.24]. */
const MEMORY_MAX = 8000;
/** Lo que espera un paso a su revisión antes de seguir sin ella [R62.8]. */
const CHECK_MS = 60_000;
const RESULT_CHARS = 3000;
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
  /** Ya se revisó antes de cerrarse [R62.1]. */
  checked?: boolean;
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
  /** Lo que pidió la persona [R62.2]. */
  order: Payload;
  /** Entregable acordado, en texto [R62.9]. */
  deliverable?: string;
  /** Si es una corrección: qué se pidió y lo que ya se había entregado [R62.15][R62.16]. */
  correction?: { text: string; before?: { step: string; text: string; files: string[] }[] };
  checkMs?: number;
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
  /** Preguntas sin responder y lo que decidió la persona [R62.17]. */
  private readonly asked = new Map<string, string>();
  private readonly decisions: string[] = [];
  /** Lo que entregó cada paso que acabó bien [R62.9]. */
  private readonly results: { step: string; text: string; files: string[] }[] = [];
  private reviewsOff = false;
  private closed = false;

  constructor(private readonly d: SupervisorDeps) {}

  /** Escucha cada evento; un fallo aquí nunca llega a la ejecución [R60.3]. */
  observe(e: RunEvent): void {
    if (e.type.startsWith('supervisor.')) return;
    try {
      if (e.type === 'run.started') this.started();
      if (e.type === 'agent.question') this.asked.set(e.questionId, e.text);
      if (e.type === 'agent.answer') this.decisions.push(`${(this.asked.get(e.questionId) ?? '').slice(0, 300)} → ${e.text.slice(0, 300)}`);
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

  private alert(nodeId: Id | undefined, path: readonly Id[], rule: string, detail: string): void {
    const key = `${rule}|${pathKey(path, nodeId ?? '')}`;
    if (this.told.has(key)) return;
    this.told.add(key);
    this.d.emitter.emit({ type: 'supervisor.alert', ...(nodeId !== undefined ? { nodeId } : {}), rule, severity: 'warning', detail }, path);
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
    if (e.type !== 'tool.called' && e.type !== 'file.produced' && e.type !== 'node.finished' && e.type !== 'agent.question' && e.type !== 'agent.answer') return;
    const key = pathKey(path, e.nodeId);
    const trail = this.trails.get(key);
    if (!trail) return;
    if (e.type === 'agent.question' || e.type === 'agent.answer') {
      // Sin esto la revisión cree que nadie respondió [R62.2].
      trail.actions.push(`${e.type === 'agent.question' ? 'Preguntó a la persona' : 'La persona respondió'}: ${e.text.slice(0, ACTION_CHARS * 2)}`);
    } else if (e.type === 'tool.called') {
      if (trail.actions.length < MAX_ACTIONS) trail.actions.push(`${e.tool}: ${JSON.stringify(e.input ?? {}).slice(0, ACTION_CHARS)}`);
    } else if (e.type === 'file.produced') {
      trail.files.add(e.path);
    } else {
      this.trails.delete(key);
      if (e.status === 'succeeded') this.results.push({ step: this.d.labelOf(trail.nodeId), text: (e.output?.text ?? '').slice(0, RESULT_CHARS), files: [...trail.files] });
      if (!trail.checked) this.finished(trail, e.output ?? { text: '', files: [] });
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
    const ask = decider.supervise(this.request(trail, output), signal);
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

  private request(trail: StepTrail, output: Payload): SupervisorReview {
    return { step: this.d.labelOf(trail.nodeId), order: this.d.order.text, ...(this.d.correction ? { correction: this.d.correction.text } : {}), input: trail.input, ...(trail.task ? { task: trail.task } : {}), actions: trail.actions, output: { text: output.text, files: [...new Set([...output.files, ...trail.files])] } };
  }

  /** Lo que tarde de más cuenta como revisión fallida [R62.8]. */
  private async limited<T>(job: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('tiempo agotado')), this.d.checkMs ?? CHECK_MS);
    });
    try {
      return await Promise.race([job, limit]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Revisa un paso antes de que se cierre; devuelve qué falta si no terminó lo pedido [R62.1][R62.4]. */
  async check(nodeId: Id, path: readonly Id[], output: Payload, purpose?: string): Promise<string | undefined> {
    const { decider, review, signal } = this.d;
    const trail = this.trails.get(pathKey(path, nodeId));
    if (!trail || !decider.supervise || !review() || signal.aborted) return undefined;
    trail.checked = true;
    this.d.emitter.emit({ type: 'supervisor.reviewing', nodeId }, path);
    try {
      const verdict = await this.limited(decider.supervise({ ...this.request(trail, output), ...(purpose ? { purpose } : {}) }, signal));
      this.reviewed(trail, verdict);
      return verdict.ok ? undefined : verdict.reason || 'Lo hecho no corresponde a lo pedido.';
    } catch {
      if (signal.aborted) return undefined;
      this.alert(nodeId, path, 'unchecked', 'No se pudo comprobar si este paso hizo lo pedido.');
      this.note(trail, '');
      return undefined;
    }
  }

  /** Devuelve a la memoria lo anotado de un paso reutilizado, sin revisarlo ni gastar [R41.8][R41.9]. */
  restore(past: Extract<EventBody, { type: 'supervisor.note' | 'supervisor.alert' }>, path: readonly Id[]): void {
    if (past.type === 'supervisor.alert') return this.alert(past.nodeId, path, past.rule, past.detail);
    this.entries.push({ label: this.d.labelOf(past.nodeId), text: past.text, files: past.files });
    this.d.emitter.emit(past, path);
  }

  /** Lo que entregó un paso reutilizado cuenta en la comprobación final [R41.8]. */
  reused(nodeId: Id, output: Payload): void {
    this.results.push({ step: this.d.labelOf(nodeId), text: output.text.slice(0, RESULT_CHARS), files: [...output.files] });
  }

  /** Compara lo pedido con lo conseguido; devuelve el motivo si no se cumple [R62.9][R62.10]. */
  async verify(): Promise<string | undefined> {
    const { decider, review, signal, order, deliverable, correction } = this.d;
    if (!decider.verifyRun || !review() || signal.aborted) return undefined;
    try {
      const v = await this.limited(decider.verifyRun({ order, ...(deliverable ? { deliverable } : {}), ...(correction ? { correction: correction.text, before: correction.before ?? [] } : {}), ...(this.decisions.length > 0 ? { decisions: this.decisions } : {}), steps: this.results }, signal));
      if (v.usage) this.d.budget.track(v.usage.inputTokens, v.usage.outputTokens, v.usage.costUsd);
      this.d.emitter.emit({ type: 'supervisor.verified', met: v.met, detail: v.missing });
      if (v.met) return undefined;
      this.alert(undefined, [], 'requirements-unmet', v.missing);
      return `${REQUIREMENTS_UNMET}: ${v.missing}`;
    } catch {
      if (!signal.aborted) this.alert(undefined, [], 'unchecked', 'No se pudo comprobar si el resultado cumple lo pedido.');
      return undefined;
    }
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
