import { type DeliverableSpec, type Diagram, type DiagramNode, type Edge, type ReturnInfo, correctionCandidates, deliverableFileName, finalSteps, forwardEdges, returnEdges, segmentOf, validateDiagram } from '../diagrams';
import { type Id, type KnowledgeExtra, type Payload, mergeExtra, stepExtra } from '../shared';
import { type AgentAdapter, AgentError, type AgentQuestion, type AgentSnapshot, type AnsweredQuestion, type BlameCandidate, type Decider, type FileChange, type KnowledgeRef, type ReviewQuestion } from './adapter';
import { DELIVERABLE_ATTEMPTS, type DeliverableItemResult, type DeliverableLinks, collectLinks, deliverableBrief, deliverableContext, deliverableGoal, deliverableInstructions, deliverableMarkdown, itemTitle, linksMarkdown } from './deliverable';
import { EventBus, type RunEvent } from './events';
import { composeCorrectionInput, correctionTargets, resumePlan } from './resume';
import { DEFAULT_REVIEW_CRITERIA, composeRoundInput, parseVerdict } from './review';
import type { NodeStatus, RunOptions, RunStatus } from './run-types';
import { applyTransformRules, checkFormat, transformAttempts } from './transform';

export interface OrchestratorDeps {
  getAdapter(agentId: Id): AgentAdapter;
  decider: Decider;
  /** Foto de la configuración del agente para dejarla en el log. */
  describeAgent?(agentId: Id): AgentSnapshot | undefined;
  /** `runId`: un subdiagrama se lee de la copia que se hizo al lanzar la ejecución [R52.1]. */
  resolveTemplate?(templateId: Id, version: number | 'latest', runId?: Id): Promise<Diagram> | Diagram;
  sleep?(ms: number, signal: AbortSignal): Promise<void>;
  now?(): Date;
  newRunId?(): Id;
}

export interface RunResult {
  runId: Id;
  status: RunStatus;
  reason?: string;
  output?: Payload;
  events: readonly RunEvent[];
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
}

export interface PendingQuestion {
  questionId: string;
  nodeId: Id;
  nodePath: Id[];
  text: string;
  options?: string[];
  confirm?: { round: number };
  /** Pregunta de una revisión humana [R53.3]. */
  review?: ReviewQuestion;
}

interface PendingEntry extends PendingQuestion {
  resolve(answer: string): void;
}

export interface RunHandle {
  runId: Id;
  bus: EventBus;
  result: Promise<RunResult>;
  /** Pausa cooperativa: se detiene antes de empezar nodos y entre pasos de un agente. */
  pause(): void;
  resume(): void;
  cancel(reason?: string): void;
  /** Responde a una pregunta de un agente. `false` si no existe o ya se respondió. */
  answer(questionId: string, text: string): boolean;
  pendingQuestions(): PendingQuestion[];
}

type Outcome = {
  status: 'succeeded' | 'failed' | 'cancelled';
  output?: Payload;
  /** Aristas elegidas por un router; si falta, se entregan todas. */
  chosen?: Set<Id>;
  /** Retorno de una revisión que rechaza: se repite el tramo [R34.8]. */
  back?: ReturnInfo;
};

const DEFAULT_RETRY = { maxAttempts: 3, baseDelayMs: 1000 };

class Gate {
  private paused = false;
  private waiters: (() => void)[] = [];
  pause(): void {
    this.paused = true;
  }
  resume(): void {
    this.paused = false;
    for (const w of this.waiters.splice(0)) w();
  }
  get isPaused(): boolean {
    return this.paused;
  }
  async wait(signal: AbortSignal): Promise<void> {
    while (this.paused && !signal.aborted) {
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
    }
  }
}

class Semaphore {
  private active = 0;
  private readonly queue: (() => void)[] = [];
  constructor(private readonly max: number) {}
  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
  }
  release(): void {
    const next = this.queue.shift();
    if (next) next();
    else this.active--;
  }
}

/** Tipos de paso cuya salida se puede reutilizar al reanudar [R41.1]. */
const REUSABLE = new Set<DiagramNode['kind']>(['agent', 'transform', 'subdiagram']);

class RunCtx {
  readonly controller = new AbortController();
  readonly gate = new Gate();
  readonly semaphore: Semaphore;
  readonly usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  readonly maxDepth: number;
  readonly retry: { maxAttempts: number; baseDelayMs: number };
  reason?: 'cancelled' | 'budget_exceeded';
  detail?: string;
  private budgetHit = false;
  private questionSeq = 0;
  private readonly pending = new Map<string, PendingEntry>();
  /** Conocimiento del diagrama raíz, que reciben todos sus agentes [R33.3]. */
  rootExtra: KnowledgeExtra | undefined;
  /** Entregable efectivo de la ejecución y pasos finales del nivel principal [R46.3][R46.2]. */
  deliverable: DeliverableSpec | undefined;
  finalIds = new Set<Id>();
  /** Diagrama principal (etiquetas y entrada para componer el entregable). */
  root: Diagram | undefined;
  /** Motivo con el que falla la ejecución cuando lo da un paso (p. ej. el entregable) [R46.8]. */
  failReason: string | undefined;
  /** Salidas por reutilizar al reanudar; cada una se usa una vez [R41.1]. */
  private readonly reusable = new Map<string, Payload>();
  readonly reuseFrom: string | undefined;
  /** Revisiones humanas ya aprobadas en la anterior; cada una se usa una vez [R53.9]. */
  private readonly approved: Set<string>;
  /** Corrección pendiente de aplicar a su paso [R53.8]. */
  private correction: RunOptions['correction'];

  constructor(
    readonly bus: EventBus,
    readonly deps: Required<Pick<OrchestratorDeps, 'sleep'>> & OrchestratorDeps,
    readonly options: RunOptions,
  ) {
    this.semaphore = new Semaphore(Math.max(1, options.maxConcurrency ?? 4));
    this.maxDepth = options.maxDepth ?? 8;
    this.retry = options.retry ?? DEFAULT_RETRY;
    this.reuseFrom = options.reuse?.fromRunId;
    for (const [id, out] of Object.entries(options.reuse?.outputs ?? {})) this.reusable.set(id, out);
    this.approved = new Set(options.reuse?.approvedReviews ?? []);
    this.correction = options.correction;
  }

  takeApproved(reviewId: string): boolean {
    return this.approved.delete(reviewId);
  }

  takeCorrection(nodeId: string): RunOptions['correction'] {
    if (this.correction?.nodeId !== nodeId) return undefined;
    const c = this.correction;
    this.correction = undefined;
    return c;
  }

  takeReused(nodeId: string): Payload | undefined {
    const out = this.reusable.get(nodeId);
    this.reusable.delete(nodeId);
    return out;
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  abort(reason: 'cancelled' | 'budget_exceeded', detail?: string): void {
    if (!this.reason) {
      this.reason = reason;
      if (detail !== undefined) this.detail = detail;
    }
    this.controller.abort();
  }

  addUsage(inputTokens: number, outputTokens: number, costUsd = 0): void {
    this.usage.inputTokens += inputTokens;
    this.usage.outputTokens += outputTokens;
    this.usage.costUsd += costUsd;
    if (this.budgetHit) return;
    const { maxTokens, maxCostUsd } = this.options.budget ?? {};
    const tokens = this.usage.inputTokens + this.usage.outputTokens;
    if (maxTokens !== undefined && tokens >= maxTokens) {
      this.hitBudget('tokens', tokens, maxTokens);
    } else if (maxCostUsd !== undefined && this.usage.costUsd >= maxCostUsd) {
      this.hitBudget('cost', this.usage.costUsd, maxCostUsd);
    }
  }

  askUser(nodeId: Id, path: Id[], question: AgentQuestion): Promise<string> {
    const questionId = `q-${++this.questionSeq}`;
    return new Promise<string>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        this.signal.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        this.pending.delete(questionId);
        cleanup();
        reject(new Error('aborted'));
      };
      this.pending.set(questionId, {
        questionId,
        nodeId,
        nodePath: [...path],
        text: question.text,
        ...(question.options ? { options: [...question.options] } : {}),
        ...(question.confirm ? { confirm: { ...question.confirm } } : {}),
        ...(question.review ? { review: { ...question.review } } : {}),
        resolve: (answer) => {
          cleanup();
          resolve(answer);
        },
      });
      this.signal.addEventListener('abort', onAbort, { once: true });
      const timeoutMs = this.options.questionTimeoutMs;
      if (timeoutMs !== undefined) {
        timer = setTimeout(() => {
          this.pending.delete(questionId);
          cleanup();
          reject(new AgentError('Tiempo de espera de la respuesta del usuario agotado', false));
        }, timeoutMs);
      }
      this.bus.emit(
        {
          type: 'agent.question',
          nodeId,
          questionId,
          text: question.text,
          ...(question.options ? { options: question.options } : {}),
          ...(question.confirm ? { confirm: question.confirm } : {}),
          ...(question.kind ? { kind: question.kind } : {}),
          ...(question.review ? { review: question.review } : {}),
        },
        path,
      );
    });
  }

  answer(questionId: string, text: string): boolean {
    const entry = this.pending.get(questionId);
    if (!entry) return false;
    this.pending.delete(questionId);
    this.bus.emit({ type: 'agent.answer', nodeId: entry.nodeId, questionId, text }, entry.nodePath);
    entry.resolve(text);
    return true;
  }

  pendingQuestions(): PendingQuestion[] {
    return [...this.pending.values()].map(({ resolve: _resolve, ...q }) => q);
  }

  private hitBudget(limit: 'tokens' | 'cost', used: number, max: number): void {
    this.budgetHit = true;
    this.bus.emit({ type: 'run.budget_reached', limit, used, max });
    this.abort('budget_exceeded', `límite de ${limit} alcanzado (${used}/${max})`);
  }
}

const defaultSleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function mergeInputs(parts: { label: string; payload: Payload }[]): Payload {
  if (parts.length === 1) {
    const only = parts[0]!.payload;
    return { text: only.text, files: [...only.files] };
  }
  return {
    text: parts.map((p) => `## ${p.label}\n${p.payload.text}`).join('\n\n'),
    files: [...new Set(parts.flatMap((p) => p.payload.files))],
  };
}

export class Orchestrator {
  private readonly deps: RunCtx['deps'];

  constructor(deps: OrchestratorDeps) {
    this.deps = { ...deps, sleep: deps.sleep ?? defaultSleep };
  }

  start(diagram: Diagram, order: string | Payload, options: RunOptions = {}): RunHandle {
    const runId = this.deps.newRunId?.() ?? globalThis.crypto.randomUUID();
    const bus = new EventBus(runId, this.deps.now);
    const rc = new RunCtx(bus, this.deps, options);
    rc.rootExtra = diagram.extra;
    rc.root = diagram;
    rc.deliverable = options.deliverable === null ? undefined : (options.deliverable ?? diagram.deliverable);
    if (rc.deliverable) rc.finalIds = new Set(finalSteps(diagram));
    const input: Payload = typeof order === 'string' ? { text: order, files: [] } : order;

    const result = (async (): Promise<RunResult> => {
      bus.emit({ type: 'run.started', diagramId: diagram.id, ...(options.reuse && !options.correction ? { resumedFrom: options.reuse.fromRunId } : {}), ...(options.correction ? { correctedFrom: options.correction.fromRunId } : {}), ...(rc.deliverable ? { deliverable: rc.deliverable } : {}) });
      let outcome: DiagramOutcome;
      try {
        outcome = await executeDiagram(rc, diagram, input, [], 0, [diagram.id]);
      } catch (err) {
        bus.emit({ type: 'error', message: errorMessage(err), retriable: false });
        outcome = { status: 'failed' };
      }
      let status: RunStatus = outcome.status;
      let reason: string | undefined;
      if (rc.reason === 'cancelled') {
        status = 'cancelled';
        reason = rc.detail;
        bus.emit({ type: 'run.cancelled', ...(reason !== undefined ? { reason } : {}) });
      } else if (rc.reason === 'budget_exceeded') {
        status = 'failed';
        reason = 'budget_exceeded';
      } else if (status === 'failed' && rc.failReason) {
        reason = rc.failReason;
      }
      bus.emit({ type: 'run.finished', status, ...(reason !== undefined ? { reason } : {}) });
      return {
        runId,
        status,
        ...(reason !== undefined ? { reason } : {}),
        ...(outcome.output ? { output: outcome.output } : {}),
        events: bus.history(),
        usage: { ...rc.usage },
      };
    })();

    return {
      runId,
      bus,
      result,
      pause: () => {
        if (rc.gate.isPaused || rc.signal.aborted) return;
        rc.gate.pause();
        bus.emit({ type: 'run.paused' });
      },
      resume: () => {
        if (!rc.gate.isPaused) return;
        rc.gate.resume();
        bus.emit({ type: 'run.resumed' });
      },
      cancel: (reason) => rc.abort('cancelled', reason),
      answer: (questionId, text) => rc.answer(questionId, text),
      pendingQuestions: () => rc.pendingQuestions(),
    };
  }

  /** Candidatos y propuesta para corregir una ejecución terminada [R53.10]. */
  proposeCorrection(args: { diagram: Diagram; events: readonly RunEvent[]; text: string; prefer?: Id; signal?: AbortSignal }) {
    return proposeCorrectionWith(this.deps.decider, args);
  }
}

interface DiagramOutcome {
  status: 'succeeded' | 'failed' | 'cancelled';
  output?: Payload;
}

async function executeDiagram(
  rc: RunCtx,
  diagram: Diagram,
  input: Payload,
  path: Id[],
  depth: number,
  stack: Id[],
): Promise<DiagramOutcome> {
  const issues = validateDiagram(diagram);
  if (issues.length > 0) {
    rc.bus.emit(
      {
        type: 'error',
        message: `Diagrama inválido: ${issues.map((i) => `${i.code}: ${i.message}`).join('; ')}`,
        retriable: false,
      },
      path,
    );
    return { status: 'failed' };
  }

  const nodeById = new Map(diagram.nodes.map((n) => [n.id, n]));
  const returns = returnEdges(diagram);
  const incoming = new Map<Id, Edge[]>();
  const outgoing = new Map<Id, Edge[]>();
  for (const e of diagram.edges) {
    // El retorno no es una entrada que haya que esperar [R34.3].
    if (!returns.has(e.id)) incoming.set(e.to, [...(incoming.get(e.to) ?? []), e]);
    outgoing.set(e.from, [...(outgoing.get(e.from) ?? []), e]);
  }
  const returnOf = new Map([...returns.values()].map((r) => [r.reviewId, r]));
  // Estado de las revisiones con retorno: vuelta, correcciones y entrada original del destino [R34.11][R34.13].
  const rounds = new Map<Id, { round: number; feedback: string[] }>();
  const original = new Map<Id, Payload>();
  const lastOutput = new Map<Id, Payload>();
  const override = new Map<Id, Payload>();
  // Primera entrada de cada paso en este nivel: la «entrada original» de un retorno elegido al vuelo [R53.6].
  const firstInput = new Map<Id, Payload>();
  const level: ReviewLevel = { diagram, lastOutput, forward: forwardEdges(diagram, returns) };

  const edgeState = new Map<Id, 'delivered' | 'dead'>();
  const edgePayload = new Map<Id, Payload>();
  const status = new Map<Id, NodeStatus>(diagram.nodes.map((n) => [n.id, 'idle']));
  const running = new Map<Id, Promise<void>>();
  let anyFailed = false;
  let output: Payload | undefined;

  const killOutgoing = (id: Id) => {
    for (const e of outgoing.get(id) ?? []) edgeState.set(e.id, 'dead');
  };

  const apply = (node: DiagramNode, outcome: Outcome) => {
    status.set(node.id, outcome.status);
    rc.bus.emit(
      {
        type: 'node.finished',
        nodeId: node.id,
        status: outcome.status,
        ...(outcome.output ? { output: outcome.output } : {}),
      },
      path,
    );
    if (outcome.status !== 'succeeded' || !outcome.output) {
      if (outcome.status === 'failed') anyFailed = true;
      killOutgoing(node.id);
      return;
    }
    if (node.kind === 'output') output = outcome.output;
    lastOutput.set(node.id, outcome.output);
    if (outcome.back) {
      repeat(node, outcome.back, outcome.output);
      return;
    }
    for (const e of outgoing.get(node.id) ?? []) {
      if (outcome.chosen && !outcome.chosen.has(e.id)) {
        edgeState.set(e.id, 'dead');
        continue;
      }
      edgeState.set(e.id, 'delivered');
      edgePayload.set(e.id, outcome.output);
      rc.bus.emit({ type: 'edge.traversed', edgeId: e.id, fromNodeId: e.from, toNodeId: e.to }, path);
    }
  };

  /** Rechazo con retorno: el tramo vuelve a estar pendiente y el destino recibe las correcciones [R34.8][R34.11][R34.13]. */
  const repeat = (review: DiagramNode, info: ReturnInfo, feedback: Payload) => {
    const st = rounds.get(review.id) ?? { round: 0, feedback: [] };
    st.round += 1;
    const earlier = [...st.feedback];
    st.feedback.push(feedback.text);
    rounds.set(review.id, st);
    if (info.edge.id !== '') rc.bus.emit({ type: 'edge.traversed', edgeId: info.edge.id, fromNodeId: review.id, toNodeId: info.targetId }, path);
    const next = composeRoundInput({
      round: st.round + 1,
      max: review.review!.maxRounds,
      original: original.get(review.id) ?? firstInput.get(info.targetId) ?? feedback,
      previous: lastOutput.get(info.targetId),
      feedback,
      earlier,
      ...(review.review!.mode === 'human' ? { human: true } : {}),
    });
    for (const id of info.segment) {
      status.set(id, 'idle');
      if (id !== review.id && nodeById.get(id)?.kind === 'review') {
        rounds.delete(id);
        original.delete(id);
      }
    }
    for (const e of diagram.edges) {
      if (info.segment.has(e.from) && info.segment.has(e.to) && !returns.has(e.id)) {
        edgeState.delete(e.id);
        edgePayload.delete(e.id);
      }
    }
    override.set(info.targetId, next);
  };

  const start = (node: DiagramNode, nodeInput: Payload) => {
    // Corregir: el paso elegido arranca con la corrección del usuario [R53.8].
    const fix = path.length === 0 ? rc.takeCorrection(node.id) : undefined;
    if (fix) {
      nodeInput = composeCorrectionInput({ input: nodeInput, previous: fix.previous, text: fix.text, ...(fix.files ? { files: fix.files } : {}) });
      rc.bus.emit({ type: 'correction.applied', nodeId: node.id, fromRunId: fix.fromRunId, text: fix.text }, path);
    }
    if (!firstInput.has(node.id)) firstInput.set(node.id, nodeInput);
    for (const r of returns.values()) {
      if (r.targetId === node.id && !original.has(r.reviewId)) original.set(r.reviewId, nodeInput);
    }
    status.set(node.id, 'queued');
    rc.bus.emit({ type: 'node.queued', nodeId: node.id }, path);
    const task = (async () => {
      let outcome: Outcome;
      try {
        await rc.gate.wait(rc.signal);
        outcome = rc.signal.aborted
          ? { status: 'cancelled' }
          : node.kind === 'review'
            ? await runReview(rc, node, nodeInput, outgoing.get(node.id) ?? [], (rounds.get(node.id)?.round ?? 0) + 1, returnOf.get(node.id), path, level)
            : await runNode(rc, node, nodeInput, outgoing.get(node.id) ?? [], nodeById, path, depth, stack);
      } catch (err) {
        if (rc.signal.aborted) {
          outcome = { status: 'cancelled' };
        } else {
          rc.bus.emit({ type: 'error', nodeId: node.id, message: errorMessage(err), retriable: false }, path);
          outcome = { status: 'failed' };
        }
      }
      apply(node, outcome);
    })().finally(() => running.delete(node.id));
    running.set(node.id, task);
  };

  while (true) {
    if (rc.signal.aborted) {
      await Promise.allSettled([...running.values()]);
      break;
    }
    let progressed = false;
    for (const node of diagram.nodes) {
      if (status.get(node.id) !== 'idle') continue;
      const again = override.get(node.id);
      if (again) {
        override.delete(node.id);
        start(node, again);
        progressed = true;
        continue;
      }
      if (node.kind === 'entry') {
        start(node, input);
        progressed = true;
        continue;
      }
      const inc = incoming.get(node.id) ?? [];
      if (!inc.every((e) => edgeState.has(e.id))) continue;
      const delivered = inc.filter((e) => edgeState.get(e.id) === 'delivered');
      progressed = true;
      if (delivered.length === 0) {
        status.set(node.id, 'skipped');
        rc.bus.emit({ type: 'node.finished', nodeId: node.id, status: 'skipped' }, path);
        killOutgoing(node.id);
        continue;
      }
      start(
        node,
        mergeInputs(
          delivered.map((e) => ({
            label: nodeById.get(e.from)?.label ?? e.from,
            payload: edgePayload.get(e.id)!,
          })),
        ),
      );
    }
    if (running.size > 0) await Promise.race(running.values());
    else if (!progressed) break;
  }

  if (rc.signal.aborted) return { status: 'cancelled' };
  if (anyFailed) return { status: 'failed', ...(output ? { output } : {}) };
  if (!output) {
    // Invariante: sin fallos ni cancelación el output siempre se alcanza (el router sin rutas falla).
    rc.bus.emit({ type: 'error', message: 'Estado inconsistente: output no alcanzado', retriable: false }, path);
    return { status: 'failed' };
  }
  return { status: 'succeeded', output };
}

async function runNode(
  rc: RunCtx,
  node: DiagramNode,
  input: Payload,
  outEdges: Edge[],
  nodeById: Map<Id, DiagramNode>,
  path: Id[],
  depth: number,
  stack: Id[],
): Promise<Outcome> {
  // Reanudar: lo que ya terminó bien en la anterior no se repite, la primera vez que se llega a ello [R41.1].
  const reused = path.length === 0 && REUSABLE.has(node.kind) ? rc.takeReused(node.id) : undefined;
  if (reused) {
    rc.bus.emit({ type: 'node.started', nodeId: node.id, input }, path);
    rc.bus.emit({ type: 'node.reused', nodeId: node.id, fromRunId: rc.reuseFrom! }, path);
    return { status: 'succeeded', output: reused };
  }
  switch (node.kind) {
    case 'entry':
    case 'output':
      rc.bus.emit({ type: 'node.started', nodeId: node.id, input }, path);
      // La Salida del nivel principal compone el entregable [R46.6].
      if (node.kind === 'output' && path.length === 0 && rc.deliverable) return runDeliverable(rc, node, input, rc.deliverable);
      return { status: 'succeeded', output: input };
    case 'agent':
      return runAgent(rc, node, input, path);
    case 'router':
      return runRouter(rc, node, input, outEdges, nodeById, path);
    case 'loop':
      return runLoop(rc, node, input, path, depth, stack);
    case 'subdiagram':
      return runSubdiagram(rc, node, input, path, depth, stack);
    case 'review':
      return runReview(rc, node, input, outEdges, 1, undefined, path);
    case 'transform':
      return runTransform(rc, node, input, path);
  }
}

/** Nodo «Transformar»: reglas sin IA o Claude con reintentos si no cumple el formato [R37.3]–[R37.10]. */
async function runTransform(rc: RunCtx, node: DiagramNode, input: Payload, path: Id[]): Promise<Outcome> {
  rc.bus.emit({ type: 'node.started', nodeId: node.id, input }, path);
  const cfg = node.transform!;
  const done = (attempts: number, ok: boolean, errors: string[], warnings: string[]) =>
    rc.bus.emit(
      {
        type: 'transform.done',
        nodeId: node.id,
        mode: cfg.mode,
        format: cfg.format,
        attempts,
        ok,
        ...(errors.length > 0 ? { errors } : {}),
        ...(warnings.length > 0 ? { warnings } : {}),
      },
      path,
    );
  const fail = (message: string): Outcome => {
    rc.bus.emit({ type: 'error', nodeId: node.id, message, retriable: false }, path);
    return { status: 'failed' };
  };

  if (cfg.mode === 'rules') {
    const r = applyTransformRules(cfg, input);
    if (!r.ok) {
      done(1, false, r.errors, r.warnings);
      return fail(`No se pudo transformar: ${r.errors.join('; ')}`);
    }
    done(1, true, [], r.warnings);
    return { status: 'succeeded', output: { text: r.text, files: [...input.files] } };
  }

  const transform = rc.deps.decider.transform?.bind(rc.deps.decider);
  if (!transform) {
    done(0, false, ['El motor activo no sabe transformar con Claude'], []);
    return fail('El motor activo no sabe transformar con Claude; usa el modo por reglas.');
  }
  const max = transformAttempts(cfg);
  let lastError = '';
  let used = 0;
  for (let attempt = 1; attempt <= max; attempt++) {
    used = attempt;
    await rc.gate.wait(rc.signal);
    if (rc.signal.aborted) return { status: 'cancelled' };
    let text: string;
    try {
      ({ text } = await transform(
        {
          nodeId: node.id,
          format: cfg.format,
          instructions: cfg.instructions ?? '',
          ...(cfg.schema?.trim() ? { schema: cfg.schema } : {}),
          input,
          attempt,
          ...(lastError ? { previousError: lastError } : {}),
        },
        rc.signal,
      ));
    } catch (err) {
      if (rc.signal.aborted) return { status: 'cancelled' };
      lastError = errorMessage(err);
      const retriable = err instanceof AgentError && err.retriable;
      rc.bus.emit({ type: 'error', nodeId: node.id, message: lastError, retriable: retriable && attempt < max }, path);
      if (!retriable) break;
      if (attempt < max) {
        // Error temporal del motor: misma espera creciente que los agentes [R37.7].
        const delayMs = rc.retry.baseDelayMs * 2 ** (attempt - 1);
        rc.bus.emit({ type: 'node.retrying', nodeId: node.id, attempt, max, delayMs, message: lastError }, path);
        await rc.deps.sleep(delayMs, rc.signal);
      }
      continue;
    }
    if (rc.signal.aborted) return { status: 'cancelled' };
    const r = checkFormat(text, cfg.format, cfg.schema, true);
    if (r.ok) {
      done(attempt, true, [], []);
      return { status: 'succeeded', output: { text: r.text, files: [...input.files] } };
    }
    lastError = r.errors.join('; ');
    if (attempt < max) {
      rc.bus.emit({ type: 'node.retrying', nodeId: node.id, attempt, max, delayMs: 0, message: lastError }, path);
    }
  }
  done(used, false, [lastError], []);
  return fail(`No se pudo transformar tras ${used} intento${used === 1 ? '' : 's'}: ${lastError}`);
}

/** Revisión: lee el veredicto (o pregunta a la IA) y elige ✓, ✗ (retorno o rama) o ⏱ [R34.6]–[R34.10][R34.12]. */
async function runReview(
  rc: RunCtx,
  node: DiagramNode,
  input: Payload,
  outEdges: Edge[],
  round: number,
  back: ReturnInfo | undefined,
  path: Id[],
  level?: ReviewLevel,
): Promise<Outcome> {
  rc.bus.emit({ type: 'node.started', nodeId: node.id, input }, path);
  const cfg = node.review!;
  if (cfg.mode === 'human') return runHumanReview(rc, node, input, outEdges, round, back, path, level);
  const max = cfg.maxRounds;
  let approved: boolean;
  let source: 'verdict' | 'ai' = 'verdict';
  let reason: string | undefined;
  const written = cfg.mode === 'verdict' ? parseVerdict(input.text) : undefined;
  if (written) {
    approved = written === 'approved';
  } else {
    source = 'ai';
    const request = { prompt: cfg.criteria?.trim() || DEFAULT_REVIEW_CRITERIA, output: input, iteration: round };
    const res = await rc.deps.decider.judge(request, rc.signal);
    rc.bus.emit({ type: 'decision', nodeId: node.id, kind: 'judge', request, response: res }, path);
    approved = res.done;
    reason = res.reason;
  }
  if (rc.signal.aborted) return { status: 'cancelled' };

  const byPort = (p: string) => outEdges.find((e) => e.port === p);
  const decided = (verdict: 'approved' | 'rejected' | 'exhausted', returnTo?: Id) =>
    rc.bus.emit(
      {
        type: 'review.decided',
        nodeId: node.id,
        round,
        max,
        verdict,
        source,
        ...(reason !== undefined ? { reason } : {}),
        ...(returnTo !== undefined ? { returnTo } : {}),
      },
      path,
    );
  const go = (edge: Edge | undefined, verdict: 'approved' | 'rejected' | 'exhausted'): Outcome => {
    decided(verdict);
    if (!edge) {
      const label = verdict === 'approved' ? 'Aprobado' : verdict === 'rejected' ? 'Rechazado' : 'Agotado';
      rc.bus.emit({ type: 'error', nodeId: node.id, message: `La revisión no tiene conectada la salida «${label}»`, retriable: false }, path);
      return { status: 'failed' };
    }
    return { status: 'succeeded', output: input, chosen: new Set([edge.id]) };
  };

  if (approved) return go(byPort('approved'), 'approved');
  if (back) {
    if (round >= max) return go(byPort('exhausted'), 'exhausted');
    decided('rejected', back.targetId);
    return { status: 'succeeded', output: input, back };
  }
  return go(byPort('rejected'), 'rejected');
}

async function runAgent(rc: RunCtx, node: DiagramNode, input: Payload, path: Id[]): Promise<Outcome> {
  const agentId = node.agentId!;
  const slot = { held: false };
  const answered: AnsweredQuestion[] = [];
  const missing: KnowledgeRef[] = [];
  await rc.semaphore.acquire();
  slot.held = true;
  try {
    if (rc.signal.aborted) return { status: 'cancelled' };
    rc.bus.emit({ type: 'node.started', nodeId: node.id, input }, path);
    let current = input;
    for (let round = 1; ; round++) {
      const out = await attemptsOf(rc, node, agentId, current, path, slot, answered, missing);
      if (out.status !== 'succeeded' || !node.confirm || !out.output) return out;
      // Confirmar antes de terminar: espera a que el usuario apruebe o pida cambios [R43.5].
      let reply: string;
      try {
        reply = await waitUser(rc, node, path, slot, { text: out.output.text, options: [CONFIRM_APPROVE], confirm: { round } });
      } catch (err) {
        if (rc.signal.aborted) return { status: 'cancelled' };
        rc.bus.emit({ type: 'error', nodeId: node.id, message: errorMessage(err), retriable: false }, path);
        return { status: 'failed' };
      }
      if (rc.signal.aborted) return { status: 'cancelled' };
      if (isApproval(reply)) {
        rc.bus.emit({ type: 'confirm.decided', nodeId: node.id, round, verdict: 'approved' }, path);
        return out;
      }
      rc.bus.emit({ type: 'confirm.decided', nodeId: node.id, round, verdict: 'changes', text: reply.trim() }, path);
      answered.push({ question: CONFIRM_QUESTION, answer: reply.trim() });
      current = composeConfirmInput({ round, original: input, previous: out.output, request: reply.trim() });
    }
  } finally {
    if (slot.held) rc.semaphore.release();
  }
}

/** Respuesta que aprueba una confirmación [R43.6]. */
export const CONFIRM_APPROVE = 'Aprobar';
const CONFIRM_QUESTION = '¿Apruebas lo que has hecho o quieres cambios?';
export const isApproval = (answer: string): boolean => answer.trim().toLowerCase() === CONFIRM_APPROVE.toLowerCase();

/** Entrada de la vuelta siguiente tras pedir cambios en una confirmación [R43.7]. */
export function composeConfirmInput(args: { round: number; original: Payload; previous: Payload; request: string }): Payload {
  const text = [
    args.original.text,
    `## Cambios pedidos antes de confirmar (vuelta ${args.round})`,
    `### Tu entrega anterior\n\n${args.previous.text}`,
    `### Lo que pide el usuario\n\n${args.request}`,
  ].join('\n\n');
  return { text, files: [...new Set([...args.original.files, ...args.previous.files])] };
}

/** Espera al usuario sin ocupar hueco de concurrencia (como las preguntas del agente). */
async function waitUser(rc: RunCtx, node: DiagramNode, path: Id[], slot: { held: boolean }, q: AgentQuestion): Promise<string> {
  slot.held = false;
  rc.semaphore.release();
  try {
    return await rc.askUser(node.id, path, q);
  } finally {
    if (!rc.signal.aborted) {
      await rc.semaphore.acquire();
      slot.held = true;
    }
  }
}

/** Intentos de un agente con reintentos por error, sobre una entrada [R27.6]. */
async function attemptsOf(
  rc: RunCtx,
  node: DiagramNode,
  agentId: Id,
  input: Payload,
  path: Id[],
  slot: { held: boolean },
  answered: AnsweredQuestion[],
  missing: KnowledgeRef[],
): Promise<Outcome> {
  if (rc.signal.aborted) return { status: 'cancelled' };
  const { maxAttempts, baseDelayMs } = rc.retry;
  for (let attempt = 1; ; attempt++) {
    try {
      return await attemptAgent(rc, node, agentId, input, attempt, path, slot, answered, [...missing]);
    } catch (err) {
      if (rc.signal.aborted) return { status: 'cancelled' };
      const retriable = err instanceof AgentError && err.retriable;
      const message = errorMessage(err);
      if (err instanceof AgentError && err.missed.length > 0) missing.splice(0, missing.length, ...err.missed);
      rc.bus.emit({ type: 'error', nodeId: node.id, message, retriable }, path);
      if (!retriable || attempt >= maxAttempts) return { status: 'failed' };
      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      rc.bus.emit(
        { type: 'node.retrying', nodeId: node.id, attempt, max: maxAttempts, delayMs, message },
        path,
      );
      await rc.deps.sleep(delayMs, rc.signal);
      if (rc.signal.aborted) return { status: 'cancelled' };
    }
  }
}

async function attemptAgent(
  rc: RunCtx,
  node: DiagramNode,
  agentId: Id,
  input: Payload,
  attempt: number,
  path: Id[],
  slot: { held: boolean },
  answered: AnsweredQuestion[],
  missing: KnowledgeRef[],
): Promise<Outcome> {
  const snapshot = rc.deps.describeAgent?.(agentId);
  const task = node.task?.trim() ? node.task.trim() : undefined;
  // Lo enchufado al paso (skills y MCP) es obligatorio siempre [R36.21].
  const own = stepExtra(node.extra);
  const extra = mergeExtra(rc.rootExtra, own);
  const hasExtra = Object.keys(extra).length > 0;
  const deliverable = deliverableNotice(rc, node, path);
  const origin = {
    ...(rc.rootExtra && Object.keys(mergeExtra(rc.rootExtra)).length > 0 ? { diagram: mergeExtra(rc.rootExtra) } : {}),
    ...(own && Object.keys(own).length > 0 ? { node: own } : {}),
  };
  rc.bus.emit(
    {
      type: 'agent.request',
      nodeId: node.id,
      agentId,
      attempt,
      input,
      ...(task ? { task } : {}),
      ...(node.model ? { model: node.model } : {}),
      ...(node.confirm ? { confirm: true } : {}),
      ...(deliverable ? { deliverable } : {}),
      ...(hasExtra ? { extra: origin } : {}),
      ...(snapshot ? { snapshot } : {}),
      ...(answered.length > 0 ? { previousAnswers: [...answered] } : {}),
    },
    path,
  );
  const adapter = rc.deps.getAdapter(agentId);
  let streamed = '';
  let resultText: string | undefined;
  const files = new Map<string, FileChange | undefined>();

  // Mientras espera al usuario el agente libera su hueco de concurrencia.
  const ask = async (q: AgentQuestion): Promise<string> => {
    slot.held = false;
    rc.semaphore.release();
    try {
      const answer = await rc.askUser(node.id, path, q);
      answered.push({ question: q.text, answer });
      return answer;
    } finally {
      if (!rc.signal.aborted) {
        await rc.semaphore.acquire();
        slot.held = true;
      }
    }
  };
  const request = { nodeId: node.id, agentId, runId: rc.bus.runId, input, ...(task ? { task } : {}), ...(node.model ? { model: node.model } : {}), ...(node.confirm ? { confirm: true } : {}), ...(deliverable ? { deliverable } : {}), ...(hasExtra ? { extra } : {}), ...(missing.length > 0 ? { missing } : {}), attempt, ask, previousAnswers: [...answered] };

  for await (const ev of adapter.run(request, rc.signal)) {
    await rc.gate.wait(rc.signal);
    if (rc.signal.aborted) return { status: 'cancelled' };
    switch (ev.type) {
      case 'token':
        streamed += ev.text;
        rc.bus.emit({ type: 'token.stream', nodeId: node.id, text: ev.text }, path);
        break;
      case 'tool_call':
        rc.bus.emit({ type: 'tool.called', nodeId: node.id, tool: ev.tool, input: ev.input }, path);
        break;
      case 'tool_result':
        rc.bus.emit(
          {
            type: 'tool.result',
            nodeId: node.id,
            tool: ev.tool,
            ok: ev.ok,
            ...(ev.output !== undefined ? { output: ev.output } : {}),
          },
          path,
        );
        break;
      case 'knowledge':
        rc.bus.emit({ type: 'knowledge.used', nodeId: node.id, attempt, kind: ev.kind, id: ev.id, via: ev.via, required: ev.required }, path);
        break;
      case 'knowledge_unmet':
        rc.bus.emit({ type: 'knowledge.unmet', nodeId: node.id, attempt, kind: ev.kind, id: ev.id }, path);
        break;
      case 'usage':
        rc.bus.emit(
          {
            type: 'agent.usage',
            nodeId: node.id,
            inputTokens: ev.inputTokens,
            outputTokens: ev.outputTokens,
            ...(ev.costUsd !== undefined ? { costUsd: ev.costUsd } : {}),
          },
          path,
        );
        rc.addUsage(ev.inputTokens, ev.outputTokens, ev.costUsd);
        break;
      case 'file':
        // Un archivo creado y luego retocado sigue contando como creado [R31.12].
        {
          const prev = files.get(ev.path);
          files.set(ev.path, prev === 'created' || ev.change === 'created' ? 'created' : (ev.change ?? prev));
        }
        rc.bus.emit({ type: 'file.produced', nodeId: node.id, path: ev.path, ...(ev.change ? { change: ev.change } : {}), ...(ev.via ? { via: ev.via } : {}) }, path);
        break;
      case 'result':
        resultText = ev.text;
        for (const f of ev.files ?? []) if (!files.has(f)) files.set(f, undefined);
        break;
    }
  }
  if (rc.signal.aborted) return { status: 'cancelled' };
  const text = explainTouchedFiles(resultText ?? streamed, files);
  return { status: 'succeeded', output: { text, files: [...files.keys()] } };
}

async function runRouter(
  rc: RunCtx,
  node: DiagramNode,
  input: Payload,
  outEdges: Edge[],
  nodeById: Map<Id, DiagramNode>,
  path: Id[],
): Promise<Outcome> {
  rc.bus.emit({ type: 'node.started', nodeId: node.id, input }, path);
  const mode = node.router!.mode;
  let chosen: Edge[] = [];
  let reason: string;

  if (mode === 'rules') {
    const results: { edgeId: Id; condition?: string; matched: boolean }[] = [];
    for (const edge of outEdges) {
      const matched = edge.condition
        ? await rc.deps.decider.condition({ condition: edge.condition, input }, rc.signal)
        : true;
      results.push({ edgeId: edge.id, ...(edge.condition ? { condition: edge.condition } : {}), matched });
      if (matched) chosen.push(edge);
    }
    rc.bus.emit(
      { type: 'decision', nodeId: node.id, kind: 'condition', request: { input }, response: results },
      path,
    );
    reason = 'reglas de las aristas';
  } else {
    const candidates = outEdges.map((e) => ({
      edgeId: e.id,
      to: e.to,
      label: nodeById.get(e.to)?.label ?? e.to,
    }));
    const res = await rc.deps.decider.route({ nodeId: node.id, candidates, input }, rc.signal);
    rc.bus.emit(
      { type: 'decision', nodeId: node.id, kind: 'route', request: { candidates, input }, response: res },
      path,
    );
    const wanted = new Set(res.edgeIds);
    chosen = outEdges.filter((e) => wanted.has(e.id));
    reason = res.reason;
  }
  if (rc.signal.aborted) return { status: 'cancelled' };

  if (chosen.length === 0) {
    rc.bus.emit({ type: 'error', nodeId: node.id, message: 'El router no eligió ninguna ruta', retriable: false }, path);
    return { status: 'failed' };
  }
  rc.bus.emit(
    { type: 'route.decided', fromNodeId: node.id, chosen: chosen.map((e) => e.to), mode, reason },
    path,
  );
  return { status: 'succeeded', output: input, chosen: new Set(chosen.map((e) => e.id)) };
}

function toOutcome(r: DiagramOutcome): Outcome {
  return { status: r.status, ...(r.output ? { output: r.output } : {}) };
}

async function runLoop(
  rc: RunCtx,
  node: DiagramNode,
  input: Payload,
  path: Id[],
  depth: number,
  stack: Id[],
): Promise<Outcome> {
  rc.bus.emit({ type: 'node.started', nodeId: node.id, input }, path);
  if (depth + 1 > rc.maxDepth) {
    rc.bus.emit({ type: 'error', nodeId: node.id, message: `Profundidad máxima (${rc.maxDepth}) superada`, retriable: false }, path);
    return { status: 'failed' };
  }
  const cfg = node.loop!;
  const max = cfg.mode === 'count' ? Math.min(cfg.count ?? 1, cfg.maxIterations) : cfg.maxIterations;
  let current = input;
  for (let n = 1; n <= max; n++) {
    const r = await executeDiagram(rc, cfg.body, current, [...path, node.id], depth + 1, stack);
    if (r.status === 'cancelled') return { status: 'cancelled' };
    if (r.status === 'failed' || !r.output) return { status: 'failed' };
    current = r.output;

    let done = n >= max;
    let reason: string | undefined;
    if (cfg.mode === 'ai-judge') {
      const request = { prompt: cfg.prompt!, output: current, iteration: n };
      const verdict = await rc.deps.decider.judge(request, rc.signal);
      rc.bus.emit({ type: 'decision', nodeId: node.id, kind: 'judge', request, response: verdict }, path);
      if (rc.signal.aborted) return { status: 'cancelled' };
      reason = verdict.reason;
      if (verdict.done) done = true;
      else if (n >= max) reason = `${reason} · máximo de iteraciones alcanzado`;
    }
    rc.bus.emit(
      {
        type: 'loop.iteration',
        loopId: node.id,
        n,
        max,
        verdict: done ? 'done' : 'continue',
        ...(reason !== undefined ? { reason } : {}),
      },
      path,
    );
    if (done) break;
  }
  return { status: 'succeeded', output: current };
}

async function runSubdiagram(
  rc: RunCtx,
  node: DiagramNode,
  input: Payload,
  path: Id[],
  depth: number,
  stack: Id[],
): Promise<Outcome> {
  rc.bus.emit({ type: 'node.started', nodeId: node.id, input }, path);
  const { templateId, version } = node.subdiagram!;
  const fail = (message: string): Outcome => {
    rc.bus.emit({ type: 'error', nodeId: node.id, message, retriable: false }, path);
    return { status: 'failed' };
  };
  if (depth + 1 > rc.maxDepth) return fail(`Profundidad máxima (${rc.maxDepth}) superada`);
  if (stack.includes(templateId)) return fail(`Referencia circular a la plantilla ${templateId}`);
  if (!rc.deps.resolveTemplate) return fail('No hay resolvedor de plantillas configurado');

  const template = await rc.deps.resolveTemplate(templateId, version, rc.bus.runId);
  rc.bus.emit({ type: 'subdiagram.started', nodeId: node.id, templateId, version }, path);
  const r = await executeDiagram(rc, template, input, [...path, node.id], depth + 1, [...stack, templateId]);
  rc.bus.emit({ type: 'subdiagram.finished', nodeId: node.id, status: r.status }, path);
  return toOutcome(r);
}

const norm = (p: string) => p.replace(/\\/g, '/');
const CHANGE_LABEL: Record<FileChange, string> = { created: 'creado', modified: 'modificado' };

/**
 * La salida de un agente explica todo lo que ha tocado [R31.13]: si el texto no menciona algún archivo
 * registrado, se añade al final la lista de los que faltan.
 */
export function explainTouchedFiles(text: string, files: ReadonlyMap<string, FileChange | undefined>): string {
  const said = norm(text);
  const missing = [...files].filter(([p]) => !said.includes(norm(p)));
  if (missing.length === 0) return text;
  const lines = missing.map(([p, c]) => `- ${p}${c ? ` (${CHANGE_LABEL[c]})` : ''}`);
  return `${text.trimEnd()}${text.trim() ? '\n\n' : ''}Archivos tocados (registrados por el orquestador):\n${lines.join('\n')}`;
}

/** Aviso del entregable para un agente según «Avisar a» [R46.4]. */
function deliverableNotice(rc: RunCtx, node: DiagramNode, path: Id[]): { role: 'final' | 'goal'; text: string } | undefined {
  const spec = rc.deliverable;
  if (!spec) return undefined;
  const notify = spec.notify ?? 'final';
  if (notify === 'none') return undefined;
  if (path.length === 0 && rc.finalIds.has(node.id)) return { role: 'final', text: deliverableBrief(spec) };
  if (notify === 'all') return { role: 'goal', text: deliverableGoal(spec) };
  return undefined;
}

/** Compone el entregable en la Salida: enlaces sin IA y el resto con un turno de Claude por elemento [R46.6]–[R46.9]. */
async function runDeliverable(rc: RunCtx, node: DiagramNode, input: Payload, spec: DeliverableSpec): Promise<Outcome> {
  const events = rc.bus.history();
  // Agentes: los que pidieron un turno y, al reanudar, los reutilizados de la ejecución anterior [R41.1].
  const agentKeys = new Set(events.filter((e) => e.type === 'agent.request' || e.type === 'node.reused').map((e) => [...(e.nodePath ?? []), (e as { nodeId: Id }).nodeId].join('/')));
  const links: DeliverableLinks = collectLinks(events, (id, p) => agentKeys.has([...p, id].join('/')));
  const root = rc.root!;
  const kindOf = new Map(root.nodes.map((n) => [n.id, n]));
  const last = new Map<Id, { status: string; text: string }>();
  for (const e of events) {
    if (e.type !== 'node.finished' || (e.nodePath?.length ?? 0) > 0) continue;
    const n = kindOf.get(e.nodeId);
    if (!n || !['agent', 'subdiagram', 'transform'].includes(n.kind)) continue;
    last.set(e.nodeId, { status: e.status, text: e.output?.text ?? '' });
  }
  const steps = [...last].map(([id, v]) => ({ label: kindOf.get(id)?.label ?? id, ...v }));
  const entryId = root.nodes.find((n) => n.kind === 'entry')?.id;
  const started = events.find((e): e is Extract<RunEvent, { type: 'node.started' }> => e.type === 'node.started' && e.nodeId === entryId && !e.nodePath?.length);
  const context = deliverableContext({ request: started?.input?.text ?? '', input, steps, links });
  const ctxPayload: Payload = { text: context, files: [...input.files] };

  const sections: { title: string; body: string }[] = [];
  const items: DeliverableItemResult[] = [];
  let json: string | undefined;
  for (const it of spec.items) {
    const title = itemTitle(it);
    if (it.kind === 'links') {
      sections.push({ title, body: linksMarkdown(links) });
      items.push({ kind: 'links', title, ok: true, attempts: 0 });
      continue;
    }
    const r = await composeItem(rc, node, it, ctxPayload, { steps: steps.length, files: links.files.length });
    if (r === 'cancelled') return { status: 'cancelled' };
    items.push({ kind: it.kind, title, ok: r.ok, ...(r.ok ? {} : { error: r.error }), attempts: r.attempts, ...(r.tokens ? { tokens: r.tokens } : {}) });
    if (!r.ok) {
      sections.push({ title, body: `No se pudo completar: ${r.error}` });
      continue;
    }
    if (it.kind === 'json') {
      json = r.text;
      sections.push({ title, body: '```json\n' + r.text + '\n```' });
    } else sections.push({ title, body: r.text });
  }
  const ok = items.every((i) => i.ok);
  const markdown = deliverableMarkdown(sections);
  rc.bus.emit({ type: 'deliverable.done', nodeId: node.id, ok, fileName: deliverableFileName(spec), markdown, ...(json !== undefined ? { json } : {}), links, items });
  if (!ok && spec.onMissing === 'fail') {
    const why = items.filter((i) => !i.ok).map((i) => `${i.title}: ${i.error}`).join('; ');
    rc.failReason = `El entregable no se pudo completar: ${why}`;
    rc.bus.emit({ type: 'error', nodeId: node.id, message: rc.failReason, retriable: false });
    return { status: 'failed' };
  }
  return { status: 'succeeded', output: { text: markdown, files: [...input.files] } };
}

/** Un elemento compuesto con `Decider.transform`, con un reintento si no cumple el formato [R46.6]. */
async function composeItem(
  rc: RunCtx,
  node: DiagramNode,
  it: Exclude<DeliverableSpec['items'][number], { kind: 'links' }>,
  input: Payload,
  counts: { steps: number; files: number },
): Promise<{ ok: true; text: string; attempts: number; tokens: number } | { ok: false; error: string; attempts: number; tokens: number } | 'cancelled'> {
  const transform = rc.deps.decider.transform?.bind(rc.deps.decider);
  if (!transform) return { ok: false, error: 'el motor activo no sabe componer con Claude', attempts: 0, tokens: 0 };
  const format = it.kind === 'json' ? 'json' : 'markdown';
  const schema = it.kind === 'json' && it.schema?.trim() ? it.schema : undefined;
  let lastError = '';
  let tokens = 0;
  for (let attempt = 1; attempt <= DELIVERABLE_ATTEMPTS; attempt++) {
    await rc.gate.wait(rc.signal);
    if (rc.signal.aborted) return 'cancelled';
    try {
      const res = await transform(
        {
          nodeId: node.id,
          format,
          instructions: deliverableInstructions(it),
          ...(schema ? { schema } : {}),
          input,
          attempt,
          ...(lastError ? { previousError: lastError } : {}),
          deliverable: { kind: it.kind, ...(it.kind === 'custom' ? { title: it.title.trim() } : {}), ...counts },
        },
        rc.signal,
      );
      if (rc.signal.aborted) return 'cancelled';
      if (res.usage) {
        tokens += res.usage.inputTokens + res.usage.outputTokens;
        rc.bus.emit({ type: 'agent.usage', nodeId: node.id, inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens, ...(res.usage.costUsd !== undefined ? { costUsd: res.usage.costUsd } : {}) });
        rc.addUsage(res.usage.inputTokens, res.usage.outputTokens, res.usage.costUsd);
        if (rc.signal.aborted) return 'cancelled';
      }
      const r = checkFormat(res.text, format, schema, true);
      if (r.ok) return { ok: true, text: r.text, attempts: attempt, tokens };
      lastError = r.errors.join('; ');
    } catch (err) {
      if (rc.signal.aborted) return 'cancelled';
      lastError = errorMessage(err);
      if (!(err instanceof AgentError && err.retriable)) return { ok: false, error: lastError, attempts: attempt, tokens };
    }
  }
  return { ok: false, error: lastError, attempts: DELIVERABLE_ATTEMPTS, tokens };
}

/** Lo que una revisión necesita de su nivel para volver a un paso elegido al vuelo [R53.5]. */
interface ReviewLevel {
  diagram: Diagram;
  lastOutput: Map<Id, Payload>;
  forward: Edge[];
}

const stepLabel = (n: DiagramNode | undefined, id: Id): string => n?.label?.trim() || n?.agentId || id;

/**
 * Qué paso tiene que rehacer el trabajo: lo que diga `Decider.blame` si es uno de los candidatos; si no, el último
 * (el más cercano) [R53.5][R53.10].
 */
async function blameStep(decider: Decider, feedback: string, candidates: BlameCandidate[], signal: AbortSignal, fallbackReason: string): Promise<{ nodeId: Id; reason: string }> {
  const fallback = { nodeId: candidates[candidates.length - 1]!.nodeId, reason: fallbackReason };
  if (!decider.blame) return fallback;
  try {
    const res = await decider.blame({ feedback, candidates }, signal);
    return candidates.some((c) => c.nodeId === res.nodeId) ? { nodeId: res.nodeId, reason: res.reason ?? '' } : fallback;
  } catch {
    return fallback;
  }
}

/** Paso elegido por el usuario: por id o por nombre, sin distinguir mayúsculas; si no coincide, la propuesta [R53.5]. */
export function matchCandidate(answer: string, candidates: readonly { nodeId: Id; label: string }[], proposal: Id): Id {
  const a = answer.trim().toLowerCase();
  return candidates.find((c) => c.nodeId.toLowerCase() === a || c.label.trim().toLowerCase() === a)?.nodeId ?? proposal;
}

/** Revisión humana: espera al usuario y, si pide cambios, vuelve al paso que corresponda [R53.3]–[R53.6][R53.9]. */
async function runHumanReview(
  rc: RunCtx,
  node: DiagramNode,
  input: Payload,
  outEdges: Edge[],
  round: number,
  back: ReturnInfo | undefined,
  path: Id[],
  level: ReviewLevel | undefined,
): Promise<Outcome> {
  const cfg = node.review!;
  const max = cfg.maxRounds;
  const byPort = (p: string) => outEdges.find((e) => e.port === p);
  const decided = (verdict: 'approved' | 'rejected' | 'exhausted', source: 'human' | 'reused', returnTo?: Id) =>
    rc.bus.emit({ type: 'review.decided', nodeId: node.id, round, max, verdict, source, ...(returnTo !== undefined ? { returnTo } : {}) }, path);
  const fail = (message: string): Outcome => {
    rc.bus.emit({ type: 'error', nodeId: node.id, message, retriable: false }, path);
    return { status: 'failed' };
  };
  const go = (verdict: 'approved' | 'rejected' | 'exhausted', source: 'human' | 'reused', output: Payload = input): Outcome => {
    decided(verdict, source);
    const edge = byPort(verdict);
    if (!edge) return fail(`La revisión no tiene conectada la salida «${verdict === 'approved' ? 'Aprobado' : verdict === 'rejected' ? 'Rechazado' : 'Agotado'}»`);
    return { status: 'succeeded', output, chosen: new Set([edge.id]) };
  };
  const ask = async (q: AgentQuestion): Promise<string | Outcome> => {
    try {
      return await rc.askUser(node.id, path, q);
    } catch (err) {
      if (rc.signal.aborted) return { status: 'cancelled' };
      return fail(errorMessage(err));
    }
  };

  // Ya aprobada en la ejecución anterior: no vuelve a preguntar [R53.9].
  if (rc.takeApproved(node.id)) return go('approved', 'reused');

  const reply = await ask({ text: input.text, options: [CONFIRM_APPROVE], review: { round, max, phase: 'feedback' } });
  if (typeof reply !== 'string') return reply;
  if (rc.signal.aborted) return { status: 'cancelled' };
  if (isApproval(reply)) return go('approved', 'human');
  const feedback: Payload = { text: reply.trim(), files: [] };

  // ✗ conectada: manda la flecha, como en SPEC-034 [R53.4].
  if (back) {
    if (round >= max) return go('exhausted', 'human');
    decided('rejected', 'human', back.targetId);
    return { status: 'succeeded', output: feedback, back };
  }
  if (byPort('rejected')) {
    return go('rejected', 'human', { text: `${input.text}\n\n## Cambios pedidos en la revisión\n\n${feedback.text}`, files: [...input.files] });
  }

  // ✗ sin conectar: el asistente elige a qué paso volver [R53.5].
  if (round >= max) return go('exhausted', 'human');
  const ids = level ? correctionCandidates(level.diagram, node.id) : [];
  if (!level || ids.length === 0) return fail('La revisión no tiene a qué paso volver: conecta la salida «Rechazado» o añade antes un paso de agente');
  const byId = new Map(level.diagram.nodes.map((n) => [n.id, n]));
  const candidates: BlameCandidate[] = ids.map((id) => {
    const n = byId.get(id);
    const out = level.lastOutput.get(id);
    return { nodeId: id, label: stepLabel(n, id), ...(n?.task ? { task: n.task } : {}), ...(out ? { output: out } : {}) };
  });
  const proposal = await blameStep(rc.deps.decider, feedback.text, candidates, rc.signal, 'Es el paso más cercano a la revisión.');
  if (rc.signal.aborted) return { status: 'cancelled' };
  let targetId = proposal.nodeId;
  let by: 'assistant' | 'user' = 'assistant';
  if ((cfg.route ?? 'propose') === 'propose') {
    const list = candidates.map((c) => ({ nodeId: c.nodeId, label: c.label }));
    const first = list.find((c) => c.nodeId === proposal.nodeId)!;
    const options = [first, ...list.filter((c) => c !== first)].map((c) => c.label);
    const text = [`Propuesta: volver a **${first.label}**.`, proposal.reason].filter(Boolean).join(' ');
    const answer = await ask({ text, options, review: { round, max, phase: 'route', proposal: proposal.nodeId, reason: proposal.reason, candidates: list } });
    if (typeof answer !== 'string') return answer;
    if (rc.signal.aborted) return { status: 'cancelled' };
    targetId = matchCandidate(answer, list, proposal.nodeId);
    by = 'user';
  }
  rc.bus.emit({ type: 'correction.routed', nodeId: node.id, round, targetId, reason: targetId === proposal.nodeId ? proposal.reason : '', by }, path);
  decided('rejected', 'human', targetId);
  const info: ReturnInfo = { edge: { id: '', from: node.id, to: targetId }, reviewId: node.id, targetId, segment: segmentOf(level.forward, targetId, node.id) };
  return { status: 'succeeded', output: feedback, back: info };
}

/** Candidatos y propuesta para corregir una ejecución que ya no está en marcha [R53.10]. */
export async function proposeCorrectionWith(
  decider: Decider,
  args: { diagram: Diagram; events: readonly RunEvent[]; text: string; prefer?: Id; signal?: AbortSignal },
): Promise<{ candidates: { nodeId: Id; label: string }[]; proposal: { nodeId: Id; reason: string } }> {
  const ids = correctionTargets(args.diagram, args.events);
  if (ids.length === 0) throw new Error('Esta ejecución no tiene pasos que se puedan corregir');
  const outputs = resumePlan(args.diagram, args.events);
  const byId = new Map(args.diagram.nodes.map((n) => [n.id, n]));
  const full: BlameCandidate[] = ids.map((id) => {
    const n = byId.get(id);
    return { nodeId: id, label: stepLabel(n, id), ...(n?.task ? { task: n.task } : {}), ...(outputs[id] ? { output: outputs[id] } : {}) };
  });
  const candidates = full.map((c) => ({ nodeId: c.nodeId, label: c.label }));
  if (args.prefer !== undefined && ids.includes(args.prefer)) return { candidates, proposal: { nodeId: args.prefer, reason: '' } };
  const proposal = await blameStep(decider, args.text, full, args.signal ?? new AbortController().signal, 'Es el último paso que se puede corregir.');
  return { candidates, proposal };
}
