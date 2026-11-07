import { splitBranchIds, type DiagramNode } from '../../diagrams';
import { isCoordinator, mergeExtra, stepExtra, type Id, type Payload } from '../../shared';
import { AgentError, type AgentQuestion, type AnsweredQuestion, type FileChange, type KnowledgeRef } from '../adapter';
import type { Slot } from '../run/concurrency-limiter';
import { CONFIRM_APPROVE, CONFIRM_QUESTION, composeConfirmInput, isApproval } from '../text/confirm';
import { deliverableNotice } from '../text/deliverable-notice';
import { composeSplitFix, declaredFiles, describeSplitProblem, parseSplit, splitRule, type SplitBranch } from '../text/split';
import { explainTouchedFiles } from '../text/touched-files';
import { UNFINISHED_OPTIONS, unfinishedDecision, unfinishedQuestion } from '../text/unfinished';
import { errorMessage, failStep, type NodeHandler, type Outcome, type StepContext } from './handler';

/** Lo que dura todos los intentos de un paso. */
interface AgentTurn {
  slot: Slot;
  answered: AnsweredQuestion[];
  missing: KnowledgeRef[];
  /** Intentos ya hechos, para seguir contando al repetir por el reparto [R59.8]. */
  attempts: number;
  base: number;
  /** Memoria al arrancar el paso: no cambia entre intentos [R60.23]. */
  memory?: string;
  /** Límites del paso, si los declaró el Coordinador [R60.16]. */
  scope?: string[];
}

/** Veces que se repite un paso que no reparte bien, antes de fallar [R59.8]. */
const MAX_SPLIT_FIXES = 2;
const SPLIT_INVALID = 'split-invalid';

/** Lo que declaró el Coordinador para esta rama; solo con el Supervisor activo [R60.16]. */
function scopeOf(step: StepContext, node: DiagramNode, input: Payload): string[] | undefined {
  if (!step.supervisor) return undefined;
  const fromCoordinator = step.level.diagram.edges.some((e) => e.to === node.id && isCoordinator(step.nodeById.get(e.from) ?? {}));
  return fromCoordinator ? declaredFiles(input.text) : undefined;
}

/** Ramas de un paso que reparte, tal como las ve su agente [R59.4]. */
function branchesOf(step: StepContext, node: DiagramNode): Promise<SplitBranch[]> {
  return Promise.all(
    splitBranchIds(step.level.diagram, node.id).map(async (id) => {
      const n = step.nodeById.get(id);
      // Sin ficha, la regla sigue con lo que hay: repartir no debe fallar por esto [R59.18].
      const profile = n?.agentId ? await step.agentProfile?.(n.agentId, n.extra, step.emitter.runId).catch(() => undefined) : undefined;
      const agent = n?.agentId ? (profile?.name ?? step.describeAgent?.(n.agentId)?.name ?? n.agentId) : undefined;
      return { id, name: n?.label ?? id, ...(agent ? { agent } : {}), ...(profile ? { skills: profile.skills, mcp: profile.mcp, ...(profile.purpose ? { purpose: profile.purpose } : {}) } : {}), ...(n?.task ? { task: n.task } : {}) };
    }),
  );
}

/** Agente: intentos, preguntas al usuario y confirmación antes de terminar [R27.6][R43.5]. */
export const agentHandler: NodeHandler = {
  kind: 'agent',
  async run(step, node, input, path) {
    const memory = step.supervisor?.memory();
    const scope = scopeOf(step, node, input);
    const turn: AgentTurn = { slot: { held: false }, answered: [], missing: [], attempts: 0, base: 0, ...(memory ? { memory } : {}), ...(scope ? { scope } : {}) };
    let fixes = 0;
    await step.limiter.acquire();
    turn.slot.held = true;
    try {
      if (step.signal.aborted) return { status: 'cancelled' };
      step.emitter.emit({ type: 'node.started', nodeId: node.id, input }, path);
      let current = input;
      for (let round = 1; ; round++) {
        const out = await attemptsOf(step, node, current, path, turn);
        if (out.status !== 'succeeded' || !out.output) return out;
        // Un paso que no terminó lo pedido no pasa de largo: decide la persona [R62.4].
        // Sin ficha se revisa con lo demás: esto no debe fallar el paso.
        const profile = step.supervisor && node.agentId ? await step.agentProfile?.(node.agentId, node.extra, step.emitter.runId).catch(() => undefined) : undefined;
        // Mientras espera a su revisión no ocupa hueco de concurrencia [R63.9].
        const supervisor = step.supervisor;
        const missing = supervisor ? await step.limiter.whileWaiting(turn.slot, step.signal, () => supervisor.check(node.id, path, out.output!, profile?.purpose)) : undefined;
        if (step.signal.aborted) return { status: 'cancelled' };
        if (missing !== undefined) {
          let answer: string;
          try {
            answer = await step.limiter.whileWaiting(turn.slot, step.signal, () => step.questions.ask(node.id, path, { text: unfinishedQuestion(missing), options: UNFINISHED_OPTIONS, kind: 'unfinished' }));
          } catch (err) {
            if (step.signal.aborted) return { status: 'cancelled' };
            return failStep(step, node, errorMessage(err), path);
          }
          if (step.signal.aborted) return { status: 'cancelled' };
          const decision = unfinishedDecision(answer, missing);
          if (decision.action === 'stop') return failStep(step, node, `Parado porque no terminó lo pedido: ${missing}`, path);
          if (decision.action === 'retry') {
            turn.answered.push({ question: 'El Supervisor dijo que faltaba algo', answer: decision.request });
            current = composeConfirmInput({ round, original: input, previous: out.output, request: decision.request });
            continue;
          }
        }
        if (node.confirm) {
          // Confirmar antes de terminar: espera a que el usuario apruebe o pida cambios [R43.5].
          let reply: string;
          try {
            reply = await step.limiter.whileWaiting(turn.slot, step.signal, () => step.questions.ask(node.id, path, { text: out.output!.text, options: [CONFIRM_APPROVE], confirm: { round } }));
          } catch (err) {
            if (step.signal.aborted) return { status: 'cancelled' };
            return failStep(step, node, errorMessage(err), path);
          }
          if (step.signal.aborted) return { status: 'cancelled' };
          if (!isApproval(reply)) {
            step.emitter.emit({ type: 'confirm.decided', nodeId: node.id, round, verdict: 'changes', text: reply.trim() }, path);
            turn.answered.push({ question: CONFIRM_QUESTION, answer: reply.trim() });
            current = composeConfirmInput({ round, original: input, previous: out.output, request: reply.trim() });
            continue;
          }
          step.emitter.emit({ type: 'confirm.decided', nodeId: node.id, round, verdict: 'approved' }, path);
        }
        if (!isCoordinator(node)) return out;
        // Se reparte lo que ya se dio por bueno; si no se puede, ninguna rama arranca [R59.8][R59.9].
        const split = parseSplit(out.output.text, splitBranchIds(step.level.diagram, node.id));
        if (split.ok) return out;
        step.emitter.emit({ type: 'split.rejected', nodeId: node.id, attempt: turn.attempts, problems: split.problems }, path);
        if (fixes >= MAX_SPLIT_FIXES) {
          step.failRun(SPLIT_INVALID);
          return failStep(step, node, `${SPLIT_INVALID}: ${split.problems.map(describeSplitProblem).join(' ')}`, path);
        }
        fixes++;
        turn.base = turn.attempts;
        current = composeSplitFix(input, split.problems);
      }
    } finally {
      if (turn.slot.held) step.limiter.release();
    }
  },
};

/** Intentos de un agente con reintentos por error, sobre una entrada [R27.6]. */
async function attemptsOf(step: StepContext, node: DiagramNode, input: Payload, path: Id[], turn: AgentTurn): Promise<Outcome> {
  if (step.signal.aborted) return { status: 'cancelled' };
  const { maxAttempts } = step.retry;
  for (let attempt = 1; ; attempt++) {
    try {
      turn.attempts = turn.base + attempt;
      return await attemptAgent(step, node, input, turn.attempts, path, turn);
    } catch (err) {
      if (step.signal.aborted) return { status: 'cancelled' };
      const retriable = err instanceof AgentError && err.retriable;
      const message = errorMessage(err);
      if (err instanceof AgentError && err.missed.length > 0) turn.missing.splice(0, turn.missing.length, ...err.missed);
      step.emitter.emit({ type: 'error', nodeId: node.id, message, retriable }, path);
      if (!retriable || attempt >= maxAttempts) return { status: 'failed' };
      const delayMs = step.retry.delayAfter(attempt);
      step.emitter.emit({ type: 'node.retrying', nodeId: node.id, attempt, max: maxAttempts, delayMs, message }, path);
      await step.retry.wait(delayMs, step.signal);
      if (step.signal.aborted) return { status: 'cancelled' };
    }
  }
}

async function attemptAgent(step: StepContext, node: DiagramNode, input: Payload, attempt: number, path: Id[], turn: AgentTurn): Promise<Outcome> {
  const agentId = node.agentId!;
  const { answered, slot } = turn;
  const missing = [...turn.missing];
  const snapshot = step.describeAgent?.(agentId);
  const task = node.task?.trim() ? node.task.trim() : undefined;
  // Lo enchufado al paso (skills y MCP) es obligatorio siempre [R36.21].
  const own = stepExtra(node.extra);
  const extra = mergeExtra(step.rootExtra, own);
  const hasExtra = Object.keys(extra).length > 0;
  const deliverable = deliverableNotice(step.deliverable, step.finalIds, node.id, path);
  const split = isCoordinator(node) ? splitRule(await branchesOf(step, node)) : undefined;
  const origin = {
    ...(step.rootExtra && Object.keys(mergeExtra(step.rootExtra)).length > 0 ? { diagram: mergeExtra(step.rootExtra) } : {}),
    ...(own && Object.keys(own).length > 0 ? { node: own } : {}),
  };
  step.emitter.emit(
    {
      type: 'agent.request',
      nodeId: node.id,
      agentId,
      attempt,
      input,
      ...(task ? { task } : {}),
      ...(node.model ? { model: node.model } : {}),
      ...(node.confirm ? { confirm: true } : {}),
      ...(split ? { split } : {}),
      ...(turn.memory ? { memory: turn.memory } : {}),
      ...(turn.scope ? { scope: turn.scope } : {}),
      ...(deliverable ? { deliverable } : {}),
      ...(hasExtra ? { extra: origin } : {}),
      ...(snapshot ? { snapshot } : {}),
      ...(answered.length > 0 ? { previousAnswers: [...answered] } : {}),
    },
    path,
  );
  const adapter = step.getAdapter(agentId);
  let streamed = '';
  let resultText: string | undefined;
  const files = new Map<string, FileChange | undefined>();

  // Mientras espera al usuario el agente libera su hueco de concurrencia.
  const ask = (q: AgentQuestion): Promise<string> =>
    step.limiter.whileWaiting(slot, step.signal, async () => {
      const answer = await step.questions.ask(node.id, path, q);
      answered.push({ question: q.text, answer });
      return answer;
    });
  const request = { nodeId: node.id, agentId, runId: step.emitter.runId, input, ...(task ? { task } : {}), ...(node.model ? { model: node.model } : {}), ...(node.confirm ? { confirm: true } : {}), ...(split ? { split } : {}), ...(turn.memory ? { memory: turn.memory } : {}), ...(turn.scope ? { scope: turn.scope } : {}), ...(deliverable ? { deliverable } : {}), ...(hasExtra ? { extra } : {}), ...(missing.length > 0 ? { missing } : {}), attempt, ask, previousAnswers: [...answered] };

  for await (const ev of adapter.run(request, step.signal)) {
    await step.gate.wait(step.signal);
    if (step.signal.aborted) return { status: 'cancelled' };
    switch (ev.type) {
      case 'token':
        streamed += ev.text;
        step.emitter.emit({ type: 'token.stream', nodeId: node.id, text: ev.text }, path);
        break;
      case 'tool_call':
        step.emitter.emit({ type: 'tool.called', nodeId: node.id, tool: ev.tool, input: ev.input }, path);
        break;
      case 'tool_result':
        step.emitter.emit({ type: 'tool.result', nodeId: node.id, tool: ev.tool, ok: ev.ok, ...(ev.output !== undefined ? { output: ev.output } : {}) }, path);
        break;
      case 'knowledge':
        step.emitter.emit({ type: 'knowledge.used', nodeId: node.id, attempt, kind: ev.kind, id: ev.id, via: ev.via, required: ev.required }, path);
        break;
      case 'knowledge_unmet':
        step.emitter.emit({ type: 'knowledge.unmet', nodeId: node.id, attempt, kind: ev.kind, id: ev.id }, path);
        break;
      case 'usage':
        step.emitter.emit({ type: 'agent.usage', nodeId: node.id, inputTokens: ev.inputTokens, outputTokens: ev.outputTokens, ...(ev.costUsd !== undefined ? { costUsd: ev.costUsd } : {}) }, path);
        step.budget.add(ev.inputTokens, ev.outputTokens, ev.costUsd);
        break;
      case 'file':
        // Un archivo creado y luego retocado sigue contando como creado [R31.12].
        {
          const prev = files.get(ev.path);
          files.set(ev.path, prev === 'created' || ev.change === 'created' ? 'created' : (ev.change ?? prev));
        }
        step.emitter.emit({ type: 'file.produced', nodeId: node.id, path: ev.path, ...(ev.change ? { change: ev.change } : {}), ...(ev.via ? { via: ev.via } : {}) }, path);
        break;
      case 'blocked':
        step.emitter.emit({ type: 'supervisor.alert', nodeId: node.id, rule: 'blocked', severity: 'warning', detail: ev.detail }, path);
        break;
      case 'branch':
        step.emitter.emit({ type: 'git.branch', nodeId: node.id, branch: ev.branch, via: ev.via, ...(ev.created ? { created: true } : {}) }, path);
        break;
      case 'git_action':
        step.emitter.emit({ type: 'git.action', nodeId: node.id, branch: ev.branch, action: ev.action, ...(ev.url ? { url: ev.url } : {}) }, path);
        break;
      case 'result':
        resultText = ev.text;
        for (const f of ev.files ?? []) if (!files.has(f)) files.set(f, undefined);
        break;
    }
  }
  if (step.signal.aborted) return { status: 'cancelled' };
  const text = explainTouchedFiles(resultText ?? streamed, files);
  return { status: 'succeeded', output: { text, files: [...files.keys()] } };
}
