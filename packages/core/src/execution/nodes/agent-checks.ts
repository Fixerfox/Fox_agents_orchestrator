import type { DiagramNode } from '../../diagrams';
import { CHECKS_RETRY, type Id, type Payload } from '../../shared';
import { describeFailedChecks, mergeChecks, runChecks } from '../run/checks';
import { runVerifier } from '../run/verifier';
import { composeConfirmInput } from '../text/confirm';
import type { AgentTurn } from './agent-attempt';
import type { StepContext } from './handler';

/** Lo que dicen las comprobaciones y el verificador de un paso que acabó bien [R75.3][R75.5][R75.13]. */
export interface StepVerdict {
  /** Repetir el paso solo, con esta entrada [R75.5]. */
  retry?: Payload;
  /** Lo que falta: se pregunta a la persona como en R62.4. */
  missing?: string;
  hasChecks: boolean;
}

/**
 * Comprobaciones deterministas y, si se pidió, el verificador, antes de la revisión con IA [R75.3][R75.13]. Si falla
 * una comprobación, el paso se repite solo una vez con lo que falló; si vuelve a fallar, se pregunta [R75.5].
 */
export async function verifyStep(step: StepContext, node: DiagramNode, path: Id[], input: Payload, output: Payload, turn: AgentTurn & { checkRetries?: number }, round: number, final: boolean): Promise<StepVerdict> {
  const own = node.agentId ? await step.agentChecks?.(node.agentId).catch(() => undefined) : undefined;
  const checks = mergeChecks(own, node.checks);
  const at = { nodeId: node.id, path };
  if (checks.length > 0) {
    const results = await step.limiter.whileWaiting(turn.slot, step.signal, () => runChecks({ emitter: step.emitter, questions: step.questions, runner: step.checkRunner, signal: step.signal, ...(step.space ? { dir: step.space.dir } : {}) }, at, checks, output, output.files));
    if (results.some((r) => !r.ok)) {
      const why = describeFailedChecks(results);
      const tries = turn.checkRetries ?? 0;
      if (tries < CHECKS_RETRY) {
        turn.checkRetries = tries + 1;
        return { retry: composeConfirmInput({ round, original: input, previous: output, request: `Fallan estas comprobaciones; arréglalo:\n${why}` }), hasChecks: true };
      }
      return { missing: `Fallan las comprobaciones:\n${why}`, hasChecks: true };
    }
  }
  // Verificar con un agente: el del paso o, en un paso final, el del diagrama [R75.13].
  const settings = node.verify ?? (final ? step.root.verify : undefined);
  if (settings) {
    const v = await step.limiter.whileWaiting(turn.slot, step.signal, () => runVerifier(step, { nodeId: node.id, path, label: node.label ?? node.id, ...(node.task ? { task: node.task } : {}) }, output, settings));
    // Sin Supervisor, un «no cumple» grave también para: es lo que pidió la persona al activarlo [R75.15].
    if (v && !v.met && v.findings.some((f) => f.severity === 'high') && !step.supervisor) {
      return { missing: `El verificador dice que no cumple:\n${v.findings.filter((f) => f.severity === 'high').map((f) => `- ${f.where} — ${f.what}`).join('\n')}`, hasChecks: checks.length > 0 };
    }
  }
  return { hasChecks: checks.length > 0 };
}
