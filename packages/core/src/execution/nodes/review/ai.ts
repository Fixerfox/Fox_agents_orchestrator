import type { DiagramNode, Edge } from '../../../diagrams';
import type { Id, Payload } from '../../../shared';
import type { JudgeRequest } from '../../adapter';
import { DEFAULT_REVIEW_CRITERIA, parseVerdict } from '../../review';
import { failStep, type Outcome, type StepContext } from '../handler';
import { portLabel } from './port-label';

type Verdict = 'approved' | 'rejected' | 'exhausted';

/** Pregunta al Juez; su gasto cuenta en el uso, sin disparar el límite [R34.26][R34.28]. */
async function askJudge(step: StepContext, node: DiagramNode, request: JudgeRequest, path: Id[]): Promise<{ done: boolean; reason: string }> {
  const v = await step.decider.judgeReview!(request, step.signal);
  if (v.usage) {
    step.budget.track(v.usage.inputTokens, v.usage.outputTokens, v.usage.costUsd);
    step.emitter.emit({ type: 'agent.usage', nodeId: node.id, inputTokens: v.usage.inputTokens, outputTokens: v.usage.outputTokens, ...(v.usage.costUsd !== undefined ? { costUsd: v.usage.costUsd } : {}), source: 'judge' }, path);
  }
  return { done: v.approved, reason: v.reason };
}

/** Lee el veredicto (o pregunta a la IA) y elige ✓, ✗ (retorno o rama) o ⏱ [R34.6]–[R34.10][R34.12]. */
export async function runAiReview(step: StepContext, node: DiagramNode, input: Payload, path: Id[]): Promise<Outcome> {
  const { back, emitter, outEdges, round, signal } = step;
  const cfg = node.review!;
  const max = cfg.maxRounds;
  let approved: boolean;
  let source: 'verdict' | 'ai' = 'verdict';
  let reason: string | undefined;
  const written = cfg.mode === 'verdict' ? parseVerdict(input.text) : undefined;
  if (written) {
    approved = written === 'approved';
  } else {
    source = 'ai';
    const criteria = cfg.criteria?.trim();
    const request = { prompt: criteria || DEFAULT_REVIEW_CRITERIA, output: input, iteration: round };
    const res = step.decider.judgeReview ? await askJudge(step, node, { ...(criteria ? { criteria } : {}), output: input, round, max }, path) : await step.decider.judge(request, signal);
    emitter.emit({ type: 'decision', nodeId: node.id, kind: 'judge', request, response: res }, path);
    approved = res.done;
    reason = res.reason;
  }
  if (signal.aborted) return { status: 'cancelled' };

  const byPort = (p: string) => outEdges.find((e) => e.port === p);
  const decided = (verdict: Verdict, returnTo?: Id) =>
    emitter.emit({ type: 'review.decided', nodeId: node.id, round, max, verdict, source, ...(reason !== undefined ? { reason } : {}), ...(returnTo !== undefined ? { returnTo } : {}) }, path);
  const go = (edge: Edge | undefined, verdict: Verdict): Outcome => {
    decided(verdict);
    if (!edge) return failStep(step, node, `La revisión no tiene conectada la salida «${portLabel(verdict)}»`, path);
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
