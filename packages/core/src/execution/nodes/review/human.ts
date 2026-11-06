import { correctionCandidates, segmentOf, type DiagramNode, type ReturnInfo } from '../../../diagrams';
import type { Id, Payload } from '../../../shared';
import type { AgentQuestion, BlameCandidate } from '../../adapter';
import { blameStep, matchCandidate, stepLabel } from '../../corrections';
import { CONFIRM_APPROVE, isApproval } from '../../text/confirm';
import { errorMessage, failStep, type Outcome, type StepContext } from '../handler';
import { portLabel } from './port-label';

type Verdict = 'approved' | 'rejected' | 'exhausted';

/** Espera al usuario y, si pide cambios, vuelve al paso que corresponda [R53.3]–[R53.6][R53.9]. */
export async function runHumanReview(step: StepContext, node: DiagramNode, input: Payload, path: Id[]): Promise<Outcome> {
  const { back, emitter, level, outEdges, round, signal } = step;
  const cfg = node.review!;
  const max = cfg.maxRounds;
  const byPort = (p: string) => outEdges.find((e) => e.port === p);
  const decided = (verdict: Verdict, source: 'human' | 'reused', returnTo?: Id) =>
    emitter.emit({ type: 'review.decided', nodeId: node.id, round, max, verdict, source, ...(returnTo !== undefined ? { returnTo } : {}) }, path);
  const fail = (message: string): Outcome => failStep(step, node, message, path);
  const go = (verdict: Verdict, source: 'human' | 'reused', output: Payload = input): Outcome => {
    decided(verdict, source);
    const edge = byPort(verdict);
    if (!edge) return fail(`La revisión no tiene conectada la salida «${portLabel(verdict)}»`);
    return { status: 'succeeded', output, chosen: new Set([edge.id]) };
  };
  const ask = async (q: AgentQuestion): Promise<string | Outcome> => {
    try {
      return await step.questions.ask(node.id, path, q);
    } catch (err) {
      if (signal.aborted) return { status: 'cancelled' };
      return fail(errorMessage(err));
    }
  };

  // Ya aprobada en la ejecución anterior: no vuelve a preguntar [R53.9].
  if (step.cache.takeApproved(node.id)) return go('approved', 'reused');

  const reply = await ask({ text: input.text, options: [CONFIRM_APPROVE], review: { round, max, phase: 'feedback' } });
  if (typeof reply !== 'string') return reply;
  if (signal.aborted) return { status: 'cancelled' };
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
  const ids = correctionCandidates(level.diagram, node.id);
  if (ids.length === 0) return fail('La revisión no tiene a qué paso volver: conecta la salida «Rechazado» o añade antes un paso de agente');
  const byId = new Map(level.diagram.nodes.map((n) => [n.id, n]));
  const candidates: BlameCandidate[] = ids.map((id) => {
    const n = byId.get(id);
    const out = level.lastOutput.get(id);
    return { nodeId: id, label: stepLabel(n, id), ...(n?.task ? { task: n.task } : {}), ...(out ? { output: out } : {}) };
  });
  const proposal = await blameStep(step.decider, feedback.text, candidates, signal, 'Es el paso más cercano a la revisión.');
  if (signal.aborted) return { status: 'cancelled' };
  let targetId = proposal.nodeId;
  let by: 'assistant' | 'user' = 'assistant';
  if ((cfg.route ?? 'propose') === 'propose') {
    const list = candidates.map((c) => ({ nodeId: c.nodeId, label: c.label }));
    const first = list.find((c) => c.nodeId === proposal.nodeId)!;
    const options = [first, ...list.filter((c) => c !== first)].map((c) => c.label);
    const text = [`Propuesta: volver a **${first.label}**.`, proposal.reason].filter(Boolean).join(' ');
    const answer = await ask({ text, options, review: { round, max, phase: 'route', proposal: proposal.nodeId, reason: proposal.reason, candidates: list } });
    if (typeof answer !== 'string') return answer;
    if (signal.aborted) return { status: 'cancelled' };
    targetId = matchCandidate(answer, list, proposal.nodeId);
    by = 'user';
  }
  emitter.emit({ type: 'correction.routed', nodeId: node.id, round, targetId, reason: targetId === proposal.nodeId ? proposal.reason : '', by }, path);
  decided('rejected', 'human', targetId);
  const info: ReturnInfo = { edge: { id: '', from: node.id, to: targetId }, reviewId: node.id, targetId, segment: segmentOf(level.forward, targetId, node.id) };
  return { status: 'succeeded', output: feedback, back: info };
}
