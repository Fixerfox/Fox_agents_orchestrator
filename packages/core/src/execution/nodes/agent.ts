import type { DiagramNode } from '../../diagrams';
import { mergeExtra, stepExtra, type Id, type Payload } from '../../shared';
import { AgentError, type AgentQuestion, type AnsweredQuestion, type FileChange, type KnowledgeRef } from '../adapter';
import type { Slot } from '../run/concurrency-limiter';
import { CONFIRM_APPROVE, CONFIRM_QUESTION, composeConfirmInput, isApproval } from '../text/confirm';
import { deliverableNotice } from '../text/deliverable-notice';
import { explainTouchedFiles } from '../text/touched-files';
import { errorMessage, failStep, type NodeHandler, type Outcome, type StepContext } from './handler';

/** Lo que dura todos los intentos de un paso. */
interface AgentTurn {
  slot: Slot;
  answered: AnsweredQuestion[];
  missing: KnowledgeRef[];
}

/** Agente: intentos, preguntas al usuario y confirmación antes de terminar [R27.6][R43.5]. */
export const agentHandler: NodeHandler = {
  kind: 'agent',
  async run(step, node, input, path) {
    const turn: AgentTurn = { slot: { held: false }, answered: [], missing: [] };
    await step.limiter.acquire();
    turn.slot.held = true;
    try {
      if (step.signal.aborted) return { status: 'cancelled' };
      step.emitter.emit({ type: 'node.started', nodeId: node.id, input }, path);
      let current = input;
      for (let round = 1; ; round++) {
        const out = await attemptsOf(step, node, current, path, turn);
        if (out.status !== 'succeeded' || !node.confirm || !out.output) return out;
        // Confirmar antes de terminar: espera a que el usuario apruebe o pida cambios [R43.5].
        let reply: string;
        try {
          reply = await step.limiter.whileWaiting(turn.slot, step.signal, () => step.questions.ask(node.id, path, { text: out.output!.text, options: [CONFIRM_APPROVE], confirm: { round } }));
        } catch (err) {
          if (step.signal.aborted) return { status: 'cancelled' };
          return failStep(step, node, errorMessage(err), path);
        }
        if (step.signal.aborted) return { status: 'cancelled' };
        if (isApproval(reply)) {
          step.emitter.emit({ type: 'confirm.decided', nodeId: node.id, round, verdict: 'approved' }, path);
          return out;
        }
        step.emitter.emit({ type: 'confirm.decided', nodeId: node.id, round, verdict: 'changes', text: reply.trim() }, path);
        turn.answered.push({ question: CONFIRM_QUESTION, answer: reply.trim() });
        current = composeConfirmInput({ round, original: input, previous: out.output, request: reply.trim() });
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
      return await attemptAgent(step, node, input, attempt, path, turn);
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
  const request = { nodeId: node.id, agentId, runId: step.emitter.runId, input, ...(task ? { task } : {}), ...(node.model ? { model: node.model } : {}), ...(node.confirm ? { confirm: true } : {}), ...(deliverable ? { deliverable } : {}), ...(hasExtra ? { extra } : {}), ...(missing.length > 0 ? { missing } : {}), attempt, ask, previousAnswers: [...answered] };

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
