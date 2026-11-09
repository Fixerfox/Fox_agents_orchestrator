import { finalSteps, forwardEdges, returnEdges, splitBranchIds, validateDiagram, type Diagram, type DiagramNode, type Edge, type ReturnInfo } from '../diagrams';
import { isCoordinator, mergeLimits, type Id, type KnowledgeExtra, type Payload } from '../shared';
import type { FileChange, MemoryProposalRequest, TransformUsage } from './adapter';
import { MAX_PROPOSALS, ruleProposals, type MemoryProposal } from './memory-proposals';
import { proposeCorrectionWith } from './corrections';
import { EventBus, type RunEvent } from './events';
import { pathKey } from './replay';
import { trailBody } from './resume';
import { errorMessage, type DiagramOutcome, type Outcome, type ReviewLevel, type RunServices, type StepContext } from './nodes/handler';
import { defaultNodeRegistry, type NodeRegistry } from './nodes/registry';
import { composeRoundInput } from './review';
import { composeCorrectionInput } from './resume';
import { BudgetTracker } from './run/budget-tracker';
import { ConcurrencyLimiter } from './run/concurrency-limiter';
import { PauseGate } from './run/pause-gate';
import { QuestionBroker, unansweredPolicy, type PendingQuestion } from './run/question-broker';
import { realTimers } from './run/timers';
import { ResumeCache } from './run/resume-cache';
import { RetryPolicy } from './run/retry-policy';
import { DECISION_TIMEOUT_MS, guardDecider } from './run/guarded-decider';
import { RunAbort } from './run/run-abort';
import { RunEmitter } from './run/run-emitter';
import { Supervisor } from './run/supervisor';
import { RunMemoryService } from './run/memory-service';
import { LevelIsolation } from './run/isolation';
import { replayDecider } from './run/replay-decider';
import { stepKey } from './replay-plan';
import { validateTree } from './run/prevalidate';
import { supervisorExtras } from './run/supervisor-extras';
import type { SpaceRef } from './branch-spaces';
import type { NodeStatus, RunOptions, RunStatus } from './run-types';
import { mergeInputs } from './text/merge-inputs';
import { splitInputs } from './text/split';

import type { OrchestratorDeps, RunHandle, RunResult } from './orchestrator-types';
export type { OrchestratorDeps, RunHandle, RunResult, PendingQuestion };

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
    const timers = this.deps.timers ?? realTimers;
    // Los tokens seguidos de un paso van juntos al bus [R77.15].
    const emitter = new RunEmitter(bus, this.deps.coalesceTokens ? { ...this.deps.coalesceTokens, timers } : undefined);
    const gate = new PauseGate();
    const questions = new QuestionBroker(emitter, stop.signal, unansweredPolicy(options), timers);
    const budget = new BudgetTracker(options.budget, emitter, stop, options.onBudget);
    const deliverable = options.deliverable === null ? undefined : (options.deliverable ?? diagram.deliverable);
    // El motor queda fijado para toda la ejecución [R63.13].
    const engine = this.deps.forRun?.() ?? { getAdapter: (agentId: Id) => this.deps.getAdapter(agentId), decider: this.deps.decider };
    // Etiquetas de cada paso por ruta, también dentro de bucles y subdiagramas [R63.6].
    const labels = new Map<string, string>();
    let finalOutput: Payload | undefined;
    const labelOf = (id: Id, path: readonly Id[] = []) => labels.get(pathKey(path, id)) ?? diagram.nodes.find((n) => n.id === id)?.label ?? id;
    const outputId = diagram.nodes.find((n) => n.kind === 'output')?.id;
    let failReason: string | undefined;
    const watch = this.deps.supervisor;
    const supervisor = watch
      ? new Supervisor({ ...supervisorExtras(watch, this.deps.checks, diagram, { emitter, questions, signal: stop.signal, final: () => finalOutput }), ...(this.deps.falseAlarms ? { falseAlarms: (agentId?: Id) => this.deps.falseAlarms!(runId, { diagramId: diagram.id, ...(agentId ? { agentId } : {}) }).catch(() => []) } : {}), order: typeof order === 'string' ? { text: order, files: [] } : order, ...(options.correction ? { correction: { text: options.correction.text, ...(options.correction.before ? { before: options.correction.before } : {}) } } : {}), ...(deliverable ? { deliverable: JSON.stringify(deliverable) } : {}), ...(watch.checkMs !== undefined ? { checkMs: watch.checkMs } : {}), emitter, decider: engine.decider, budget, limits: options.budget, signal: stop.signal, review: () => watch.review() && (engine.review?.() ?? true), ...(watch.model ? { model: () => watch.model!() } : {}), ...(watch.humanChecks ? { humanChecks: () => watch.humanChecks!() } : {}), ...(watch.burnRate ? { burnRate: () => watch.burnRate!() } : {}), labelOf, ...(outputId !== undefined ? { outputId } : {}), ...(watch.settleMs !== undefined ? { settleMs: watch.settleMs } : {}) })
      : undefined;
    if (supervisor) bus.subscribe((e) => supervisor.observe(e));
    // La memoria va con el Supervisor (como antes) o sola si se pide [R72.3].
    const memory = watch || this.deps.memory ? new RunMemoryService(emitter, labels, new Map(), () => this.deps.memory?.tokens?.()) : undefined;
    const spaces = this.deps.spaces?.(runId);
    const passes = new Map<string, number>();
    const services: RunServices = {
      signal: stop.signal,
      emitter,
      gate,
      limiter: new ConcurrencyLimiter(Math.max(1, options.maxConcurrency ?? 4)),
      budget,
      ...(this.deps.resources ? { resources: this.deps.resources } : {}),
      ...(supervisor ? { supervisor } : {}),
      ...(memory ? { memory } : {}),
      ...(this.deps.flow ? { flow: { levels: new Map() } } : {}),
      ...(spaces ? { spaces } : {}),
      ...(this.deps.checks?.runner ? { checkRunner: this.deps.checks.runner } : {}),
      ...(this.deps.projectMemory ? { projectMemory: (agentId: Id) => this.deps.projectMemory!(runId, { diagramId: diagram.id, agentId }).catch(() => undefined) } : {}),
      ...(this.deps.checks?.agentChecks ? { agentChecks: (agentId: Id) => this.deps.checks!.agentChecks!(agentId, runId) } : {}),
      ...(this.deps.canWrite ? { canWrite: async (agentId: Id) => this.deps.canWrite!(agentId, runId) } : {}),
      halt: (reason) => {
        failReason = reason;
        stop.abort('cancelled', reason);
      },
      questions,
      retry: new RetryPolicy(options.retry, this.deps.sleep, this.deps.random),
      cache: new ResumeCache(options),
      decider: engine.decider,
      getAdapter: (agentId) => engine.getAdapter(agentId),
      labels,
      ...(this.deps.describeAgent ? { describeAgent: (agentId: Id) => this.deps.describeAgent!(agentId) } : {}),
      ...(this.deps.agentProfile ? { agentProfile: (agentId: Id, extra: KnowledgeExtra | undefined, run: Id) => this.deps.agentProfile!(agentId, extra, run) } : {}),
      ...(this.deps.resolveTemplate ? { resolveTemplate: (id: Id, version: number | 'latest', run?: Id) => this.deps.resolveTemplate!(id, version, run) } : {}),
      maxDepth: options.maxDepth ?? 8,
      decisionTimeoutMs: options.decisionTimeoutMs ?? DECISION_TIMEOUT_MS,
      root: diagram,
      rootExtra: diagram.extra,
      deliverable,
      finalIds: new Set(deliverable ? finalSteps(diagram) : []),
      failRun: (reason) => {
        failReason = reason;
      },
      timers,
      ...(this.deps.restoreFiles ? { restoreFiles: (files: { path: string; change?: FileChange }[], dir?: string) => this.deps.restoreFiles!(runId, files, dir) } : {}),
      limitsFor: async (node) => mergeLimits(node.limits, node.agentId ? await Promise.resolve(this.deps.agentLimits?.(node.agentId, runId)).catch(() => undefined) : undefined, options.limits),
      nextPass: (path, nodeId) => {
        const k = pathKey(path, nodeId);
        const n = (passes.get(k) ?? 0) + 1;
        passes.set(k, n);
        return n;
      },
      templates: new Map(),
      execute: (d, input, path, depth, stack, space) => executeDiagram(services, this.nodes, d, input, path, depth, stack, space),
    };
    const input: Payload = typeof order === 'string' ? { text: order, files: [] } : order;

    const result = (async (): Promise<RunResult> => {
      emitter.emit({ type: 'run.started', diagramId: diagram.id, ...(options.reuse && !options.correction ? { resumedFrom: options.reuse.fromRunId } : {}), ...(options.correction ? { correctedFrom: options.correction.fromRunId } : {}), ...(deliverable ? { deliverable } : {}) });
      let outcome: DiagramOutcome;
      // Todo el árbol se valida antes de ejecutar nada: nada se paga para fallar a mitad [R74.9].
      const problems = await validateTree(diagram, services, this.nodes);
      try {
        if (problems.length > 0) {
          for (const p of problems) emitter.emit({ type: 'error', message: p.message, retriable: false }, p.path);
          failReason = problems.some((p) => p.message.startsWith('No se sabe ejecutar')) ? NO_HANDLER : 'invalid-diagram';
          outcome = { status: 'failed' };
        } else outcome = await services.execute(diagram, input, [], 0, [diagram.id]);
      } catch (err) {
        emitter.emit({ type: 'error', message: errorMessage(err), retriable: false });
        outcome = { status: 'failed' };
      }
      // Ningún espacio sobrevive a la ejecución [R73.18].
      await spaces?.closeAll().catch(() => undefined);
      let status: RunStatus = outcome.status;
      let reason: string | undefined;
      if (stop.reason === 'cancelled') {
        status = 'cancelled';
        reason = stop.detail;
        emitter.emit({ type: 'run.cancelled', ...(reason !== undefined ? { reason } : {}) });
      } else if (stop.reason === 'budget_exceeded' || budget.exhausted) {
        status = 'failed';
        reason = 'budget_exceeded';
      } else if (status === 'failed' && failReason) {
        reason = failReason;
      }
      if (outcome.output) finalOutput = outcome.output;
      await supervisor?.settle();
      // Acabar bien exige haber conseguido lo pedido [R62.10].
      const unmet = status === 'succeeded' ? await supervisor?.verify() : undefined;
      if (unmet !== undefined) {
        status = 'failed';
        reason = unmet;
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
      feedback: (alertSeq, verdict, note) => {
        const alert = bus.history().find((e) => e.type === 'supervisor.alert' && e.seq === alertSeq);
        if (!alert || alert.type !== 'supervisor.alert') return false;
        emitter.emit({ type: 'supervisor.feedback', alertSeq, verdict, ...(note?.trim() ? { note: note.trim().slice(0, 1000) } : {}), ...(alert.nodeId !== undefined ? { nodeId: alert.nodeId } : {}) }, alert.nodePath ?? []);
        return true;
      },
      pendingQuestions: () => questions.list(),
    };
  }

  /**
   * Propuestas para la memoria del proyecto [R76.6]: con el motor, una consulta de un turno; sin `proposeMemory`
   * (el simulado), la regla fija [R76.9].
   */
  async proposeMemory(req: MemoryProposalRequest, signal: AbortSignal): Promise<{ proposals: MemoryProposal[]; usage?: TransformUsage }> {
    const decider = this.deps.forRun?.().decider ?? this.deps.decider;
    if (!decider.proposeMemory) return { proposals: ruleProposals(req.signals) };
    const r = await decider.proposeMemory(req, signal);
    return { proposals: r.proposals.slice(0, MAX_PROPOSALS).map((p, i) => ({ ...p, id: `p${i + 1}` })), ...(r.usage ? { usage: r.usage } : {}) };
  }

  /** Candidatos y propuesta para corregir una ejecución terminada [R53.10]. */
  proposeCorrection(args: { diagram: Diagram; events: readonly RunEvent[]; text: string; prefer?: Id; signal?: AbortSignal }) {
    return proposeCorrectionWith(this.deps.decider, args);
  }
}

/** Planifica un diagrama: qué paso está listo, espera a sus entradas, las combina y reparte su resultado [R56.14]. */
async function executeDiagram(run: RunServices, nodes: NodeRegistry, diagram: Diagram, input: Payload, path: Id[], depth: number, stack: Id[], levelSpace?: SpaceRef): Promise<DiagramOutcome> {
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
  run.memory?.levels.set(path.join('/'), diagram);
  run.flow?.levels.set(path.join('/'), diagram);
  for (const n of diagram.nodes) run.labels.set(pathKey(path, n.id), n.label ?? n.id);
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
  // Las ramas en paralelo, cada una en su espacio, si la app las aísla [R73.2].
  const iso = LevelIsolation.for(run, diagram, path, levelSpace);

  const edgeState = new Map<Id, 'delivered' | 'dead'>();
  const edgePayload = new Map<Id, Payload>();
  const status = new Map<Id, NodeStatus>(diagram.nodes.map((n) => [n.id, 'idle']));
  const running = new Map<string, Promise<void>>();
  let anyFailed = false;
  let output: Payload | undefined;

  const killOutgoing = (id: Id) => {
    for (const e of outgoing.get(id) ?? []) edgeState.set(e.id, 'dead');
  };

  const partsOf = (node: DiagramNode, payload: Payload) => (isCoordinator(node) ? splitInputs(payload, splitBranchIds(diagram, node.id)) : undefined);

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
    // Quien reparte manda a cada rama lo suyo; las salidas reciben el texto entero [R59.2][R59.7].
    const parts = partsOf(node, outcome.output);
    for (const e of outgoing.get(node.id) ?? []) {
      if (outcome.chosen && !outcome.chosen.has(e.id)) {
        edgeState.set(e.id, 'dead');
        continue;
      }
      edgeState.set(e.id, 'delivered');
      const part = parts?.get(e.to);
      edgePayload.set(e.id, part ?? outcome.output);
      emitter.emit({ type: 'edge.traversed', edgeId: e.id, fromNodeId: e.from, toNodeId: e.to, ...(part ? { input: part } : {}) }, path);
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
  const stepOf = (node: DiagramNode, space: SpaceRef | undefined, key: string): StepContext => ({
    ...run,
    // Las decisiones del paso, con tiempo máximo y reintentos [R70.12][R71.13]; al reanudar, las de entonces [R74.3].
    decider: replayDecider(guardDecider(run.decider, { emitter, retry: run.retry, timers: run.timers, signal, timeoutMs: run.decisionTimeoutMs, attempts: run.retry.decisionAttempts }, node.id, path), run.cache.takeDecisions(key), { emitter, node, path }),
    stepKey: key,
    outEdges: outgoing.get(node.id) ?? [],
    nodeById,
    depth,
    stack,
    round: (rounds.get(node.id)?.round ?? 0) + 1,
    back: returnOf.get(node.id),
    level,
    ...(space ? { space } : {}),
  });

  const runNode = async (node: DiagramNode, nodeInput: Payload): Promise<Outcome> => {
    const key = stepKey(path, node.id, run.nextPass(path, node.id));
    // Reanudar: lo que ya terminó bien en la anterior no se repite, en cualquier nivel y pasada [R41.1][R74.2].
    const reused = REUSABLE.has(node.kind) ? run.cache.takeReused(key) : undefined;
    // Lo reutilizado se reparte otra vez; si ya no cumple el formato, el paso se ejecuta de nuevo [R59.9].
    if (reused && (!isCoordinator(node) || partsOf(node, reused))) {
      emitter.emit({ type: 'node.started', nodeId: node.id, input: nodeInput }, path);
      const cost = run.cache.costOf(key);
      emitter.emit({ type: 'node.reused', nodeId: node.id, fromRunId: run.cache.reuseFrom!, ...(cost ? { costUsd: cost } : {}) }, path);
      // Su rastro viaja con él: ramas, archivos, avisos y memoria siguen en la ejecución nueva [R41.7].
      for (const past of run.cache.trailOf(key)) {
        const body = trailBody(past);
        if (body.type === 'supervisor.note' || body.type === 'supervisor.alert') run.supervisor?.restore(body, past.nodePath ?? []);
        else emitter.emit(body, past.nodePath ?? []);
      }
      run.supervisor?.reused(node.id, reused);
      return { status: 'succeeded', output: reused };
    }
    const space = iso ? await iso.spaceFor(node.id) : levelSpace;
    return nodes.find(node.kind)!.run(stepOf(node, space, key), node, nodeInput, path);
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
    // Las ramas que han terminado se fusionan antes de que arranque lo que las junta [R73.11].
    for (const { key, task } of iso?.settle(status) ?? []) running.set(key, task.finally(() => running.delete(key)));
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
      if (iso && inc.some((e) => iso.blocks(e.from, node.id))) continue;
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

  await iso?.finish();
  if (signal.aborted) return { status: 'cancelled' };
  if (anyFailed) return { status: 'failed', ...(output ? { output } : {}) };
  if (!output) {
    // Invariante: sin fallos ni cancelación el output siempre se alcanza (el router sin rutas falla).
    emitter.emit({ type: 'error', message: 'Estado inconsistente: output no alcanzado', retriable: false }, path);
    return { status: 'failed' };
  }
  return { status: 'succeeded', output };
}
