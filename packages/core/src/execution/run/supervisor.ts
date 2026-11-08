import { clipMiddle, stops, type AiReviewMode, type CheckResult, type Id, type Payload, type Severity, type StopAt } from '../../shared';
import type { EvidenceSource } from '../checks-port';
import type { ReviewEvidence, VerifyFinding } from '../adapter';
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
  /** Cómo cambió cada archivo, para la evidencia [R75.7]. */
  changes: Map<string, { change?: 'created' | 'modified'; via?: string }>;
  /** Herramientas que fallaron y sus últimos mensajes [R75.7]. */
  toolErrors: { count: number; last: string[] };
  checks: CheckResult[];
  verification?: { met: boolean; findings: VerifyFinding[] };
  /** Ya se revisó antes de cerrarse [R62.1]. */
  checked?: boolean;
}

/** Tope del diff que ve la revisión [R75.7]. */
export const EVIDENCE_DIFF_CHARS = 12_000;

/** Cómo se revisa este paso: el modo, si es final y si tiene comprobaciones [R75.11]. */
export interface CheckMode {
  mode?: AiReviewMode;
  final?: boolean;
  hasChecks?: boolean;
  /** Archivos declarados para el paso (R60.16) o del entregable: van primero en el diff [R75.7]. */
  priority?: readonly string[];
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
  /** Desde qué gravedad se para y se pregunta; por defecto, «grave» [R75.10]. */
  stopAt?(): StopAt;
  /** Si no se puede comprobar el resultado: avisar (por defecto) o hacer fallar [R75.20]. */
  unverified?(): 'warn' | 'fail';
  /** El diff de lo que tocó un paso [R75.7]. */
  evidence?: EvidenceSource;
  /** Comprobaciones del diagrama, al ir a acabar bien [R75.17]. */
  runChecks?(): Promise<CheckResult[]>;
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
  private closed = false;
  /** Pasada de cada paso: una vuelta de bucle o un retorno de revisión es otra [R63.11]. */
  private readonly passes = new Map<string, number>();
  /** Consultas en segundo plano, para cancelarlas si no llegan a tiempo [R63.7]. */
  private readonly inflight = new Set<() => void>();
  /** Gravedad y problemas de cada paso revisado, para la comprobación final [R75.18]. */
  private readonly reviews: { step: string; severity: Severity; problems: string[] }[] = [];
  /** Archivos que tocó la ejecución, para la comprobación final [R75.18]. */
  private readonly touched = new Map<string, { change?: 'created' | 'modified'; via?: string }>();
  private deliverableItems: { item: string; ok: boolean; detail?: string }[] | undefined;

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

  private alert(nodeId: Id | undefined, path: readonly Id[], rule: string, detail: string, more: { severity?: 'info' | 'warning'; gravity?: Severity; evidence?: string[] } = {}): void {
    const step = pathKey(path, nodeId ?? '');
    const key = `${rule}|${step}|${this.passes.get(step) ?? 0}`;
    if (this.told.has(key)) return;
    this.told.add(key);
    this.d.emitter.emit({ type: 'supervisor.alert', ...(nodeId !== undefined ? { nodeId } : {}), rule, severity: more.severity ?? 'warning', detail, ...(more.gravity ? { gravity: more.gravity } : {}), ...(more.evidence && more.evidence.length > 0 ? { evidence: more.evidence } : {}) }, path);
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
      // Los pasos internos (verificar, juntar) no son un paso nuevo [R75.14].
      if (!this.trails.has(key) && e.kind === undefined) this.trails.set(key, { nodeId: e.nodeId, path, input: e.input, ...(e.task ? { task: e.task } : {}), head: [], tail: [], omitted: 0, files: new Set(), changes: new Map(), toolErrors: { count: 0, last: [] }, checks: [] });
      return;
    }
    if (e.type === 'deliverable.done') {
      this.deliverableItems = e.items.map((i) => ({ item: i.title, ok: i.ok, ...(i.error ? { detail: i.error } : {}) }));
      return;
    }
    if (e.type === 'file.produced' && !e.reused) this.touched.set(e.path, { ...(e.change ? { change: e.change } : {}), ...(e.via ? { via: e.via } : {}) });
    if (e.type !== 'tool.called' && e.type !== 'tool.result' && e.type !== 'check.result' && e.type !== 'verify.result' && e.type !== 'file.produced' && e.type !== 'node.finished' && e.type !== 'agent.question' && e.type !== 'agent.answer') return;
    const key = pathKey(path, e.nodeId);
    const trail = this.trails.get(key);
    if (!trail) return;
    if (e.type === 'agent.question' || e.type === 'agent.answer') {
      // Sin esto la revisión cree que nadie respondió [R62.2].
      pushAction(trail, `${e.type === 'agent.question' ? 'Preguntó a la persona' : 'La persona respondió'}: ${e.text.slice(0, ACTION_CHARS * 2)}`);
    } else if (e.type === 'tool.called') {
      pushAction(trail, `${e.tool}: ${JSON.stringify(e.input ?? {}).slice(0, ACTION_CHARS)}`);
    } else if (e.type === 'tool.result') {
      if (!e.ok) {
        trail.toolErrors.count++;
        trail.toolErrors.last = [...trail.toolErrors.last, `${e.tool}: ${String(e.output ?? '').slice(0, 200)}`].slice(-5);
      }
    } else if (e.type === 'check.result') {
      trail.checks.push({ checkId: e.checkId, label: e.label, kind: e.kind, ok: e.ok, detail: e.detail, durationMs: e.durationMs });
    } else if (e.type === 'verify.result') {
      trail.verification = { met: e.met, findings: e.findings };
    } else if (e.type === 'file.produced') {
      trail.files.add(e.path);
      const prev = trail.changes.get(e.path);
      trail.changes.set(e.path, { ...(prev?.change === 'created' || e.change === 'created' ? { change: 'created' as const } : e.change ? { change: e.change } : prev?.change ? { change: prev.change } : {}), ...(e.via ? { via: e.via } : {}) });
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

  /**
   * Un paso que se cierra sin haberse revisado (falló, se canceló o no tocaba revisarlo) deja su nota determinista: no
   * se gasta revisando fallos [R75.12].
   */
  private finished(trail: StepTrail, _output: Payload): void {
    this.note(trail, '');
  }

  /** La evidencia del paso: diff, comprobaciones, errores de herramientas y recuento de archivos [R75.7]. */
  private async evidenceOf(trail: StepTrail, priority: readonly string[], signal: AbortSignal): Promise<ReviewEvidence> {
    const files = [...trail.changes].map(([path, c]) => ({ path, ...c }));
    let diff = '';
    if (this.d.evidence && files.length > 0 && !signal.aborted) {
      try {
        diff = (await this.d.evidence.diff({ runId: this.d.emitter.runId, files, priority, maxChars: EVIDENCE_DIFF_CHARS })).diff;
      } catch {
        diff = '';
      }
    }
    const created = files.filter((f) => f.change === 'created').length;
    return {
      diff,
      checks: trail.checks.map((c) => ({ label: c.label, ok: c.ok, detail: c.detail })),
      toolErrors: { count: trail.toolErrors.count, last: [...trail.toolErrors.last] },
      stats: { created, modified: files.length - created, removed: 0 },
      ...(trail.verification ? { verification: trail.verification } : {}),
    };
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

  /**
   * Revisa un paso antes de que se cierre [R62.1]: con la evidencia [R75.7] y, según su gravedad y el umbral, devuelve
   * qué falta (y se pregunta) o solo avisa [R75.10]. El modo del paso decide si revisa la IA [R75.11].
   */
  async check(nodeId: Id, path: readonly Id[], output: Payload, purpose?: string, how: CheckMode = {}): Promise<string | undefined> {
    const { decider, review, signal } = this.d;
    const trail = this.trails.get(pathKey(path, nodeId));
    if (!trail) return undefined;
    const mode = how.mode ?? 'always';
    const skip = mode === 'never' || (mode === 'final-or-checks' && !how.final && !how.hasChecks);
    if (skip || !decider.supervise || !review() || signal.aborted) return undefined;
    trail.checked = true;
    this.d.emitter.emit({ type: 'supervisor.reviewing', nodeId }, path);
    try {
      const verdict = await this.limited(async (s) => decider.supervise!({ ...this.request(trail, output), ...(purpose ? { purpose } : {}), evidence: await this.evidenceOf(trail, how.priority ?? [], s) }, s));
      const severity = this.reviewed(trail, verdict);
      if (verdict.ok && !(trail.verification && !trail.verification.met && severity === 'high')) return undefined;
      return stops(severity, this.d.stopAt?.() ?? 'high') ? verdict.reason || verdict.problems?.[0]?.text || 'Lo hecho no corresponde a lo pedido.' : undefined;
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
    if (signal.aborted) return undefined;
    // Las comprobaciones del diagrama van antes que la IA; si fallan, no se pregunta a nadie [R75.17].
    const checks = (await this.d.runChecks?.().catch(() => [])) ?? [];
    const bad = checks.find((c) => !c.ok);
    if (bad) {
      const missing = `falló «${bad.label}»: ${bad.detail.split('\n').slice(0, 4).join(' ').slice(0, 400)}`;
      this.d.emitter.emit({ type: 'supervisor.verified', met: false, detail: missing });
      this.alert(undefined, [], 'requirements-unmet', missing);
      return `${REQUIREMENTS_UNMET}: ${missing}`;
    }
    if (!decider.verifyRun || !review()) return undefined;
    try {
      const files = await this.fileLines(signal);
      const v = await this.limited((s) => decider.verifyRun!({ order, ...(deliverable ? { deliverable } : {}), ...(correction ? { correction: correction.text, before: correction.before ?? [] } : {}), ...(this.decisions.length > 0 ? { decisions: this.decisions } : {}), steps: this.results, ...(files.length > 0 ? { files } : {}), ...(checks.length > 0 ? { checks: checks.map((c) => ({ label: c.label, ok: c.ok, detail: c.detail })) } : {}), ...(this.deliverableItems ? { deliverableItems: this.deliverableItems } : {}), ...(this.reviews.length > 0 ? { reviews: this.reviews } : {}) }, s));
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
      if (signal.aborted) return undefined;
      this.alert(undefined, [], 'unchecked', 'No se pudo comprobar si el resultado cumple lo pedido.');
      // Con «Hacer fallar la ejecución», no poder comprobarlo es no cumplirlo [R75.20].
      return this.d.unverified?.() === 'fail' ? `${REQUIREMENTS_UNMET}: no se pudo comprobar si el resultado cumple lo pedido` : undefined;
    }
  }

  /** Archivos que cambió la ejecución, con sus líneas añadidas y quitadas [R75.18]. */
  private async fileLines(signal: AbortSignal): Promise<{ path: string; added: number; removed: number }[]> {
    const files = [...this.touched].map(([path, c]) => ({ path, ...c }));
    if (files.length === 0) return [];
    if (!this.d.evidence || signal.aborted) return files.map((f) => ({ path: f.path, added: 0, removed: 0 }));
    try {
      return (await this.d.evidence.diff({ runId: this.d.emitter.runId, files, priority: [], maxChars: 0 })).lines.slice(0, 200);
    } catch {
      return files.map((f) => ({ path: f.path, added: 0, removed: 0 }));
    }
  }

  /**
   * Lo que dijo la revisión: su gasto, sus avisos con gravedad y evidencia, y la nota del paso. Un «no» sin ninguna
   * evidencia citada cuenta como leve [R75.9]; un «no cumple» grave del verificador, como grave [R75.15].
   */
  private reviewed(trail: StepTrail, v: SupervisorVerdict): Severity {
    if (this.closed) return 'none';
    if (v.usage) {
      // Cuenta en el uso, sin disparar el límite: el Supervisor no corta una ejecución [R60.14].
      this.d.budget.track(v.usage.inputTokens, v.usage.outputTokens, v.usage.costUsd);
      this.d.emitter.emit({ type: 'agent.usage', nodeId: trail.nodeId, inputTokens: v.usage.inputTokens, outputTokens: v.usage.outputTokens, ...(v.usage.costUsd !== undefined ? { costUsd: v.usage.costUsd } : {}), source: 'supervisor' }, trail.path);
    }
    let severity: Severity = v.ok ? 'none' : (v.severity ?? 'high');
    const cited = (v.problems ?? []).filter((p) => p.evidence.trim() !== '');
    if (!v.ok && v.severity !== undefined && cited.length === 0) {
      severity = 'low';
      this.alert(trail.nodeId, trail.path, 'unsupported-verdict', 'La revisión dijo que no, sin citar ninguna evidencia: no se para por ello.', { severity: 'info' });
    }
    const failed = trail.verification && !trail.verification.met && trail.verification.findings.some((f) => f.severity === 'high');
    if (failed) severity = 'high';
    if (!v.ok || failed) {
      const evidence = [...cited.map((p) => `${p.text} — ${p.evidence}`), ...(failed ? trail.verification!.findings.filter((f) => f.severity === 'high').map((f) => `${f.where} — ${f.what}`) : [])];
      this.alert(trail.nodeId, trail.path, 'ai-review', v.reason || v.problems?.[0]?.text || 'Lo hecho no corresponde a lo pedido.', { gravity: severity, evidence });
    }
    if (v.outOfScope) this.alert(trail.nodeId, trail.path, 'out-of-scope', v.outOfScope);
    this.reviews.push({ step: this.d.labelOf(trail.nodeId, trail.path), severity, problems: (v.problems ?? []).map((p) => p.text).slice(0, 5) });
    this.note(trail, v.summary, true, (v.decided ?? []).map((d) => d.trim().slice(0, 160)).filter(Boolean).slice(0, 3));
    return severity;
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
