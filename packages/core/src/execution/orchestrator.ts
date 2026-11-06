import { finalSteps, forwardEdges, returnEdges, validateDiagram, type Diagram, type DiagramNode, type Edge, type ReturnInfo } from '../diagrams';
import type { Id, Payload } from '../shared';
import type { AgentAdapter, AgentSnapshot, Decider } from './adapter';
import { proposeCorrectionWith } from './corrections';
import { EventBus, type RunEvent } from './events';
import { errorMessage, type DiagramOutcome, type Outcome, type ReviewLevel, type RunServices, type StepContext } from './nodes/handler';
import { defaultNodeRegistry, type NodeRegistry } from './nodes/registry';
import { composeRoundInput } from './review';
import { composeCorrectionInput } from './resume';
import { BudgetTracker } from './run/budget-tracker';
import { ConcurrencyLimiter } from './run/concurrency-limiter';
import { PauseGate } from './run/pause-gate';
import { QuestionBroker, type PendingQuestion } from './run/question-broker';
import { ResumeCache } from './run/resume-cache';
import { RetryPolicy } from './run/retry-policy';
import { RunAbort } from './run/run-abort';
import { RunEmitter } from './run/run-emitter';
import type { NodeStatus, RunOptions, RunStatus } from './run-types';
import { mergeInputs } from './text/merge-inputs';

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
  /** Tipos de nodo; por defecto, los de la aplicación [R56.12]. */
  nodes?: NodeRegistry;
}

export interface RunResult {
  runId: Id;
  status: RunStatus;
  reason?: string;
  output?: Payload;
  events: readonly RunEvent[];
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
}

export type { PendingQuestion };

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

/** Tipos de paso cuya salida se puede reutilizar al reanudar [R41.1]. */
const REUSABLE = new Set<string>(['agent', 'transform', 'subdiagram']);

/** Motivo con el que termina una ejecución que usa un tipo de nodo sin handler [R56.12]. */
const NO_HANDLER = 'node-no-handler';

export class Orchestrator {
  private readonly nodes: NodeRegistry;

  constructor(private readonly deps: OrchestratorDeps) {
    this.nodes = deps.nodes ?? defaultNodeRegistry();
  }

  start(diagram: Diagram, order: string | Payload, options: RunOptions = {}): RunHandle {
    const runId = this.deps.newRunId?.() ?? globalThis.crypto.randomUUID();
    const bus = new EventBus(runId, this.deps.now);
    const stop = new RunAbort();
    const emitter = new RunEmitter(bus);
    const gate = new PauseGate();
    const questions = new QuestionBroker(emitter, stop.signal, options.questionTimeoutMs);
    const budget = new BudgetTracker(options.budget, emitter, stop);
    const deliverable = options.deliverable === null ? undefined : (options.deliverable ?? diagram.deliverable);
    let failReason: string | undefined;
    const services: RunServices = {
      signal: stop.signal,
      emitter,
      gate,
      limiter: new ConcurrencyLimiter(Math.max(1, options.maxConcurrency ?? 4)),
      budget,
      questions,
      retry: new RetryPolicy(options.retry, this.deps.sleep),
      cache: new ResumeCache(options),
      decider: this.deps.decider,
      getAdapter: (agentId) => this.deps.getAdapter(agentId),
      ...(this.deps.describeAgent ? { describeAgent: (agentId: Id) => this.deps.describeAgent!(agentId) } : {}),
      ...(this.deps.resolveTemplate ? { resolveTemplate: (id: Id, version: number | 'latest', run?: Id) => this.deps.resolveTemplate!(id, version, run) } : {}),
      maxDepth: options.maxDepth ?? 8,
      root: diagram,
      rootExtra: diagram.extra,
      deliverable,
      finalIds: new Set(deliverable ? finalSteps(diagram) : []),
      failRun: (reason) => {
        failReason = reason;
      },
      execute: (d, input, path, depth, stack) => executeDiagram(services, this.nodes, d, input, path, depth, stack),
    };
    const input: Payload = typeof order === 'string' ? { text: order, files: [] } : order;

    const result = (async (): Promise<RunResult> => {
      emitter.emit({ type: 'run.started', diagramId: diagram.id, ...(options.reuse && !options.correction ? { resumedFrom: options.reuse.fromRunId } : {}), ...(options.correction ? { correctedFrom: options.correction.fromRunId } : {}), ...(deliverable ? { deliverable } : {}) });
      let outcome: DiagramOutcome;
      try {
        outcome = await services.execute(diagram, input, [], 0, [diagram.id]);
      } catch (err) {
        emitter.emit({ type: 'error', message: errorMessage(err), retriable: false });
        outcome = { status: 'failed' };
      }
      let status: RunStatus = outcome.status;
      let reason: string | undefined;
      if (stop.reason === 'cancelled') {
        status = 'cancelled';
        reason = stop.detail;
        emitter.emit({ type: 'run.cancelled', ...(reason !== undefined ? { reason } : {}) });
      } else if (stop.reason === 'budget_exceeded') {
        status = 'failed';
        reason = 'budget_exceeded';
      } else if (status === 'failed' && failReason) {
        reason = failReason;
      }
      emitter.emit({ type: 'run.finished', status, ...(reason !== undefined ? { reason } : {}) });
      return {
        runId,
        status,
        ...(reason !== undefined ? { reason } : {}),
        ...(outcome.output ? { output: outcome.output } : {}),
        events: bus.history(),
        usage: { ...budget.usage },
      };
    })();

    return {
      runId,
      bus,
      result,
      pause: () => {
        if (gate.isPaused || stop.signal.aborted) return;
        gate.pause();
        emitter.emit({ type: 'run.paused' });
      },
      resume: () => {
        if (!gate.isPaused) return;
        gate.resume();
        emitter.emit({ type: 'run.resumed' });
      },
      cancel: (reason) => stop.abort('cancelled', reason),
      answer: (questionId, text) => questions.answer(questionId, text),
      pendingQuestions: () => questions.list(),
    };
  }

  /** Candidatos y propuesta para corregir una ejecución terminada [R53.10]. */
  proposeCorrection(args: { diagram: Diagram; events: readonly RunEvent[]; text: string; prefer?: Id; signal?: AbortSignal }) {
    return proposeCorrectionWith(this.deps.decider, args);
  }
}

/** Planifica un diagrama: qué paso está listo, espera a sus entradas, las combina y reparte su resultado [R56.14]. */
async function executeDiagram(run: RunServices, nodes: NodeRegistry, diagram: Diagram, input: Payload, path: Id[], depth: number, stack: Id[]): Promise<DiagramOutcome> {
  const { emitter, signal } = run;
  const missing = nodes.missingIn(diagram);
  if (missing !== undefined) {
    run.failRun(NO_HANDLER);
    emitter.emit({ type: 'error', message: `No se sabe ejecutar el tipo de nodo «${missing}»`, retriable: false }, path);
    return { status: 'failed' };
  }
  const issues = validateDiagram(diagram);
  if (issues.length > 0) {
    emitter.emit({ type: 'error', message: `Diagrama inválido: ${issues.map((i) => `${i.code}: ${i.message}`).join('; ')}`, retriable: false }, path);
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
    emitter.emit({ type: 'node.finished', nodeId: node.id, status: outcome.status, ...(outcome.output ? { output: outcome.output } : {}) }, path);
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
      emitter.emit({ type: 'edge.traversed', edgeId: e.id, fromNodeId: e.from, toNodeId: e.to }, path);
    }
  };

  /** Rechazo con retorno: el tramo vuelve a estar pendiente y el destino recibe las correcciones [R34.8][R34.11][R34.13]. */
  const repeat = (review: DiagramNode, info: ReturnInfo, feedback: Payload) => {
    const st = rounds.get(review.id) ?? { round: 0, feedback: [] };
    st.round += 1;
    const earlier = [...st.feedback];
    st.feedback.push(feedback.text);
    rounds.set(review.id, st);
    if (info.edge.id !== '') emitter.emit({ type: 'edge.traversed', edgeId: info.edge.id, fromNodeId: review.id, toNodeId: info.targetId }, path);
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

  /** Lo que ve el paso; se arma al ejecutarlo porque la vuelta de una revisión cambia entre pasadas. */
  const stepOf = (node: DiagramNode): StepContext => ({
    ...run,
    outEdges: outgoing.get(node.id) ?? [],
    nodeById,
    depth,
    stack,
    round: (rounds.get(node.id)?.round ?? 0) + 1,
    back: returnOf.get(node.id),
    level,
  });

  const runNode = (node: DiagramNode, nodeInput: Payload): Promise<Outcome> => {
    // Reanudar: lo que ya terminó bien en la anterior no se repite, la primera vez que se llega a ello [R41.1].
    const reused = path.length === 0 && REUSABLE.has(node.kind) ? run.cache.takeReused(node.id) : undefined;
    if (reused) {
      emitter.emit({ type: 'node.started', nodeId: node.id, input: nodeInput }, path);
      emitter.emit({ type: 'node.reused', nodeId: node.id, fromRunId: run.cache.reuseFrom! }, path);
      return Promise.resolve({ status: 'succeeded', output: reused });
    }
    return nodes.find(node.kind)!.run(stepOf(node), node, nodeInput, path);
  };

  const start = (node: DiagramNode, given: Payload) => {
    let nodeInput = given;
    // Corregir: el paso elegido arranca con la corrección del usuario [R53.8].
    const fix = path.length === 0 ? run.cache.takeCorrection(node.id) : undefined;
    if (fix) {
      nodeInput = composeCorrectionInput({ input: nodeInput, previous: fix.previous, text: fix.text, ...(fix.files ? { files: fix.files } : {}) });
      emitter.emit({ type: 'correction.applied', nodeId: node.id, fromRunId: fix.fromRunId, text: fix.text }, path);
    }
    if (!firstInput.has(node.id)) firstInput.set(node.id, nodeInput);
    for (const r of returns.values()) {
      if (r.targetId === node.id && !original.has(r.reviewId)) original.set(r.reviewId, nodeInput);
    }
    status.set(node.id, 'queued');
    emitter.emit({ type: 'node.queued', nodeId: node.id }, path);
    const task = (async () => {
      let outcome: Outcome;
      try {
        await run.gate.wait(signal);
        outcome = signal.aborted ? { status: 'cancelled' } : await runNode(node, nodeInput);
      } catch (err) {
        if (signal.aborted) {
          outcome = { status: 'cancelled' };
        } else {
          emitter.emit({ type: 'error', nodeId: node.id, message: errorMessage(err), retriable: false }, path);
          outcome = { status: 'failed' };
        }
      }
      apply(node, outcome);
    })().finally(() => running.delete(node.id));
    running.set(node.id, task);
  };

  while (true) {
    if (signal.aborted) {
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
        emitter.emit({ type: 'node.finished', nodeId: node.id, status: 'skipped' }, path);
        killOutgoing(node.id);
        continue;
      }
      start(node, mergeInputs(delivered.map((e) => ({ label: nodeById.get(e.from)?.label ?? e.from, payload: edgePayload.get(e.id)! }))));
    }
    if (running.size > 0) await Promise.race(running.values());
    else if (!progressed) break;
  }

  if (signal.aborted) return { status: 'cancelled' };
  if (anyFailed) return { status: 'failed', ...(output ? { output } : {}) };
  if (!output) {
    // Invariante: sin fallos ni cancelación el output siempre se alcanza (el router sin rutas falla).
    emitter.emit({ type: 'error', message: 'Estado inconsistente: output no alcanzado', retriable: false }, path);
    return { status: 'failed' };
  }
  return { status: 'succeeded', output };
}
