import { clipMiddle, type Id, type Payload } from '../../shared';
import { pathKey } from '../replay';
import type { Decider, SupervisorReview, SupervisorVerdict } from '../adapter';
import type { EventBody, RunEvent } from '../events';
import type { RunOptions } from '../run-types';
import type { BudgetTracker } from './budget-tracker';
import type { RunEmitter } from './run-emitter';
import { REQUIREMENTS_UNMET } from '../text/unfinished';
import { applyRules, newRuleState } from './supervisor-rules';

/** Tiempo que se espera a las revisiones pendientes al terminar [R60.13]. */
const SETTLE_MS = 10_000;
/** Lo que espera un paso a su revisión antes de seguir sin ella [R62.8]. */
const CHECK_MS = 60_000;
const RESULT_CHARS = 3000;
/** Acciones que ve la revisión: las primeras y las últimas [R63.1]. */
const HEAD_ACTIONS = 10;
const TAIL_ACTIONS = 30;
const ACTION_CHARS = 160;
/** Fallos seguidos que apagan la revisión en segundo plano [R63.8]. */
const MAX_FAILURES = 3;

/** Lo que el Supervisor sabe de un paso mientras trabaja. */
interface StepTrail {
  nodeId: Id;
  path: readonly Id[];
  input: Payload;
  task?: string;
  /** Primeras acciones, últimas y cuántas se omitieron entre ambas [R63.1]. */
  head: string[];
  tail: string[];
  omitted: number;
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
  /** Etiqueta de un paso; `path` distingue los de bucles y subdiagramas [R63.6]. */
  labelOf(nodeId: Id, path?: readonly Id[]): string;
  /** Nodo de salida del diagrama principal, al que se apunta el gasto de la comprobación final [R63.5]. */
  outputId?: Id;
  settleMs?: number;
  /** Lo que pidió la persona [R62.2]. */
  order: Payload;
  /** Entregable acordado, en texto [R62.9]. */
  deliverable?: string;
  /** Si es una corrección: qué se pidió y lo que ya se había entregado [R62.15][R62.16]. */
  correction?: { text: string; before?: { step: string; text: string; files: string[] }[] };
  checkMs?: number;
  /** Lo que solo puede comprobar una persona: avisar o fallar [R65.3]. */
  humanChecks?(): 'warn' | 'fail';
}

function pushAction(trail: StepTrail, text: string): void {
  if (trail.head.length < HEAD_ACTIONS) return void trail.head.push(text);
  trail.tail.push(text);
  if (trail.tail.length > TAIL_ACTIONS) {
    trail.tail.shift();
    trail.omitted++;
  }
}

const actionsOf = (t: StepTrail): string[] => [...t.head, ...(t.omitted > 0 ? [`… (${t.omitted} acciones omitidas) …`] : []), ...t.tail];

/** Vigila una ejecución: reglas, revisión con IA y memoria [R60.1][R60.12][R60.18]. */
export class Supervisor {
  private readonly rules = newRuleState();
  private readonly told = new Set<string>();
  private readonly trails = new Map<string, StepTrail>();
  private readonly pending = new Set<Promise<void>>();
  /** Preguntas sin responder y lo que decidió la persona [R62.17]. */
  private readonly asked = new Map<string, string>();
  private readonly decisions: string[] = [];
  /** Lo que entregó cada paso que acabó bien [R62.9]. */
  private readonly results: { step: string; text: string; files: string[] }[] = [];
  private reviewsOff = false;
  private failures = 0;
  private closed = false;
  /** Pasada de cada paso: una vuelta de bucle o un retorno de revisión es otra [R63.11]. */
  private readonly passes = new Map<string, number>();
  /** Consultas en segundo plano, para cancelarlas si no llegan a tiempo [R63.7]. */
  private readonly inflight = new Set<() => void>();

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
    const step = pathKey(path, nodeId ?? '');
    const key = `${rule}|${step}|${this.passes.get(step) ?? 0}`;
    if (this.told.has(key)) return;
    this.told.add(key);
    this.d.emitter.emit({ type: 'supervisor.alert', ...(nodeId !== undefined ? { nodeId } : {}), rule, severity: 'warning', detail }, path);
  }

  private follow(e: RunEvent): void {
    const path = e.nodePath ?? [];
    if (e.type === 'node.started') {
      const step = pathKey(path, e.nodeId);
      this.passes.set(step, (this.passes.get(step) ?? 0) + 1);
      return;
    }
    if (e.type === 'agent.request') {
      const key = pathKey(path, e.nodeId);
      if (!this.trails.has(key)) this.trails.set(key, { nodeId: e.nodeId, path, input: e.input, ...(e.task ? { task: e.task } : {}), head: [], tail: [], omitted: 0, files: new Set() });
      return;
    }
    if (e.type !== 'tool.called' && e.type !== 'file.produced' && e.type !== 'node.finished' && e.type !== 'agent.question' && e.type !== 'agent.answer') return;
    const key = pathKey(path, e.nodeId);
    const trail = this.trails.get(key);
    if (!trail) return;
    if (e.type === 'agent.question' || e.type === 'agent.answer') {
      // Sin esto la revisión cree que nadie respondió [R62.2].
      pushAction(trail, `${e.type === 'agent.question' ? 'Preguntó a la persona' : 'La persona respondió'}: ${e.text.slice(0, ACTION_CHARS * 2)}`);
    } else if (e.type === 'tool.called') {
      pushAction(trail, `${e.tool}: ${JSON.stringify(e.input ?? {}).slice(0, ACTION_CHARS)}`);
    } else if (e.type === 'file.produced') {
      trail.files.add(e.path);
    } else {
      this.trails.delete(key);
      if (e.status === 'succeeded') this.results.push({ step: this.d.labelOf(trail.nodeId, trail.path), text: clipMiddle(e.output?.text ?? '', RESULT_CHARS), files: [...trail.files] });
      if (!trail.checked) this.finished(trail, e.output ?? { text: '', files: [] });
    }
  }

  /** La nota del paso: la memoria la lee de los eventos [R72.1][R72.10]. */
  private note(trail: StepTrail, text: string, reviewed = false, decided: string[] = []): void {
    const files = [...trail.files];
    this.d.emitter.emit({ type: 'supervisor.note', nodeId: trail.nodeId, text, files, ...(reviewed ? { reviewed } : {}), ...(decided.length > 0 ? { decided } : {}) }, trail.path);
  }

  private finished(trail: StepTrail, output: Payload): void {
    const { decider, review, signal } = this.d;
    // Sin revisión, la entrada sale de lo que se sabe: el paso y sus archivos [R60.20].
    if (this.reviewsOff || !decider.supervise || !review() || signal.aborted) return this.note(trail, '');
    this.d.emitter.emit({ type: 'supervisor.reviewing', nodeId: trail.nodeId }, trail.path);
    const own = this.child();
    this.inflight.add(own.abort);
    const job: Promise<void> = decider
      .supervise(this.request(trail, output), own.signal)
      .then((verdict) => this.reviewed(trail, verdict))
      .catch(() => {
        if (this.closed || signal.aborted) return;
        this.d.emitter.emit({ type: 'supervisor.skipped', count: 1, reason: 'failed' });
        // Un fallo suelto no apaga la revisión: solo varios seguidos [R63.8].
        if (++this.failures >= MAX_FAILURES) this.reviewsOff = true;
        this.note(trail, '');
      })
      .finally(() => {
        own.dispose();
        this.inflight.delete(own.abort);
        this.pending.delete(job);
      });
    this.pending.add(job);
  }

  private request(trail: StepTrail, output: Payload): SupervisorReview {
    return { step: this.d.labelOf(trail.nodeId, trail.path), order: this.d.order.text, ...(this.d.correction ? { correction: this.d.correction.text } : {}), input: trail.input, ...(trail.task ? { task: trail.task } : {}), actions: actionsOf(trail), output: { text: output.text, files: [...new Set([...output.files, ...trail.files])] } };
  }

  /** Señal propia de una consulta, que se cancela con la ejecución o por su cuenta [R63.7]. */
  private child(): { signal: AbortSignal; abort(): void; dispose(): void } {
    const c = new AbortController();
    const parent = this.d.signal;
    const onAbort = () => c.abort();
    if (parent.aborted) c.abort();
    else parent.addEventListener('abort', onAbort, { once: true });
    return { signal: c.signal, abort: () => c.abort(), dispose: () => parent.removeEventListener('abort', onAbort) };
  }

  /** Lo que tarde de más cuenta como revisión fallida [R62.8], y la consulta se cancela [R63.7]. */
  private async limited<T>(ask: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const own = this.child();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        own.abort();
        reject(new Error('tiempo agotado'));
      }, this.d.checkMs ?? CHECK_MS);
    });
    try {
      return await Promise.race([ask(own.signal), limit]);
    } finally {
      clearTimeout(timer);
      own.dispose();
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
      const verdict = await this.limited((s) => decider.supervise!({ ...this.request(trail, output), ...(purpose ? { purpose } : {}) }, s));
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
    this.d.emitter.emit(past, path);
  }

  /** Lo que entregó un paso reutilizado cuenta en la comprobación final [R41.8]. */
  reused(nodeId: Id, output: Payload): void {
    this.results.push({ step: this.d.labelOf(nodeId), text: clipMiddle(output.text, RESULT_CHARS), files: [...output.files] });
  }

  /** Compara lo pedido con lo conseguido; devuelve el motivo si no se cumple [R62.9][R62.10]. */
  async verify(): Promise<string | undefined> {
    const { decider, review, signal, order, deliverable, correction } = this.d;
    if (!decider.verifyRun || !review() || signal.aborted) return undefined;
    try {
      const v = await this.limited((s) => decider.verifyRun!({ order, ...(deliverable ? { deliverable } : {}), ...(correction ? { correction: correction.text, before: correction.before ?? [] } : {}), ...(this.decisions.length > 0 ? { decisions: this.decisions } : {}), steps: this.results }, s));
      if (v.usage) {
        this.d.budget.track(v.usage.inputTokens, v.usage.outputTokens, v.usage.costUsd);
        // Sale en los eventos como el resto del Supervisor, para que el total cuadre [R63.5].
        if (this.d.outputId !== undefined) this.d.emitter.emit({ type: 'agent.usage', nodeId: this.d.outputId, inputTokens: v.usage.inputTokens, outputTokens: v.usage.outputTokens, ...(v.usage.costUsd !== undefined ? { costUsd: v.usage.costUsd } : {}), source: 'supervisor' });
      }
      const forPerson = v.forPerson?.trim() ?? '';
      const strict = forPerson !== '' && this.d.humanChecks?.() === 'fail';
      // Con «Hacer fallar», lo que queda para una persona cuenta como falta [R65.3].
      const met = v.met && !strict;
      const missing = strict ? [v.missing.trim(), forPerson].filter(Boolean).join(' ') : v.missing;
      this.d.emitter.emit({ type: 'supervisor.verified', met, detail: missing, ...(forPerson ? { forPerson } : {}) });
      if (met) {
        if (forPerson) this.alert(undefined, [], 'needs-person', forPerson);
        return undefined;
      }
      this.alert(undefined, [], 'requirements-unmet', missing);
      return `${REQUIREMENTS_UNMET}: ${missing}`;
    } catch {
      if (!signal.aborted) this.alert(undefined, [], 'unchecked', 'No se pudo comprobar si el resultado cumple lo pedido.');
      return undefined;
    }
  }

  private reviewed(trail: StepTrail, v: SupervisorVerdict): void {
    if (this.closed) return;
    this.failures = 0;
    if (v.usage) {
      // Cuenta en el uso, sin disparar el límite: el Supervisor no corta una ejecución [R60.14].
      this.d.budget.track(v.usage.inputTokens, v.usage.outputTokens, v.usage.costUsd);
      this.d.emitter.emit({ type: 'agent.usage', nodeId: trail.nodeId, inputTokens: v.usage.inputTokens, outputTokens: v.usage.outputTokens, ...(v.usage.costUsd !== undefined ? { costUsd: v.usage.costUsd } : {}), source: 'supervisor' }, trail.path);
    }
    if (!v.ok) this.alert(trail.nodeId, trail.path, 'ai-review', v.reason || 'Lo hecho no corresponde a lo pedido.');
    if (v.outOfScope) this.alert(trail.nodeId, trail.path, 'out-of-scope', v.outOfScope);
    this.note(trail, v.summary, true, (v.decided ?? []).map((d) => d.trim().slice(0, 160)).filter(Boolean).slice(0, 3));
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
    // Lo que no llegó se cancela: no sigue gastando [R63.7].
    for (const abort of this.inflight) abort();
  }
}
