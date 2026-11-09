import { splitBranchIds, type DiagramNode } from '../../diagrams';
import { isCoordinator, type Payload } from '../../shared';
import { CONFIRM_APPROVE, CONFIRM_QUESTION, composeConfirmInput, isApproval } from '../text/confirm';
import { composeSplitFix, declaredFiles, describeSplitProblem, parseSplit } from '../text/split';
import { UNFINISHED_OPTIONS, UNFINISHED_STOP, unfinishedDecision, unfinishedQuestion } from '../text/unfinished';
import { newTrace } from './agent-attempt';
import { attemptsOf, type AgentTurn } from './agent-retries';
import { verifyStep } from './agent-checks';
import { BUDGET_SPENT } from '../run/budget-tracker';
import { errorMessage, failStep, type NodeHandler, type StepContext } from './handler';

/** Veces que se repite un paso que no reparte bien, antes de fallar [R59.8]. */
const MAX_SPLIT_FIXES = 2;
const SPLIT_INVALID = 'split-invalid';

/** Lo que declaró el Coordinador para esta rama; solo con el Supervisor activo [R60.16]. */
function scopeOf(step: StepContext, node: DiagramNode, input: Payload): string[] | undefined {
  if (!step.supervisor) return undefined;
  const fromCoordinator = step.level.diagram.edges.some((e) => e.to === node.id && isCoordinator(step.nodeById.get(e.from) ?? {}));
  return fromCoordinator ? declaredFiles(input.text) : undefined;
}

/** Motivo del intento anterior de un paso que se cortó con la ejecución [R74.5]. */
export const INTERRUPTED_MESSAGE = 'La ejecución se interrumpió mientras este paso trabajaba';

/**
 * Al reanudar un paso que estaba en marcha: recibe lo que la persona ya respondió en esa pasada y, como intento
 * anterior, que la ejecución se interrumpió y qué había tocado [R74.5][R74.6].
 */
function resumeTurn(step: StepContext, turn: AgentTurn): void {
  const answers = step.cache.takeAnswers(step.stepKey);
  if (answers.length > 0) {
    turn.replay = answers;
    turn.answered.push(...answers.map((a) => ({ question: a.question, answer: a.answer })));
  }
  const cut = step.cache.takeInterrupted(step.stepKey);
  if (cut) turn.previous = { attempt: 0, kind: 'transient', message: INTERRUPTED_MESSAGE, ended: 'interrupted', actions: [], files: cut.files.map((path) => ({ path })) };
}

/** Agente: intentos, preguntas al usuario y confirmación antes de terminar [R27.6][R43.5]. */
export const agentHandler: NodeHandler = {
  kind: 'agent',
  async run(step, node, input, path) {
    const scope = scopeOf(step, node, input);
    const turn: AgentTurn = { slot: { held: false }, answered: [], missing: [], attempts: 0, base: 0, trace: newTrace(), ...(scope ? { scope } : {}) };
    resumeTurn(step, turn);
    let fixes = 0;
    await step.limiter.acquire();
    turn.slot.held = true;
    try {
      if (step.signal.aborted) return { status: 'cancelled' };
      step.emitter.emit({ type: 'node.started', nodeId: node.id, input }, path);
      // Desde el 90 % del presupuesto no arranca ningún paso sin que lo diga la persona; sin él, ninguno [R77.7][R77.8].
      // Sin acercarse al límite no se espera nada: el paso arranca en el mismo instante [R7.1].
      const gate = step.budget.beforeStep((q) => step.limiter.whileWaiting(turn.slot, step.signal, () => step.questions.ask(node.id, path, q)));
      const budget = typeof gate === 'string' ? gate : await gate;
      if (step.signal.aborted) return { status: 'cancelled' };
      if (budget === 'stop') return failStep(step, node, BUDGET_SPENT, path);
      // La memoria se fija al arrancar y no cambia entre intentos [R72.9].
      const memory = step.memory?.forStep(node.id, path);
      if (memory?.text) {
        turn.memory = memory.text;
        turn.memoryStats = memory.stats;
      }
      // Y la del proyecto, tal como estaba al lanzar la ejecución [R76.13][R76.14].
      const known = node.agentId && step.projectMemory ? await step.projectMemory(node.agentId) : undefined;
      if (known) turn.projectMemory = known;
      let current = input;
      for (let round = 1; ; round++) {
        const out = await attemptsOf(step, node, current, path, turn);
        if (out.status !== 'succeeded' || !out.output) return out;
        // Un paso que no terminó lo pedido no pasa de largo: decide la persona [R62.4].
        // Sin ficha se revisa con lo demás: esto no debe fallar el paso.
        const profile = step.supervisor && node.agentId ? await step.agentProfile?.(node.agentId, node.extra, step.emitter.runId).catch(() => undefined) : undefined;
        // Comprobaciones y verificador, antes de la revisión con IA [R75.3][R75.13].
        const final = step.finalIds.has(node.id) && path.length === 0;
        const checked = await verifyStep(step, node, path, input, out.output, turn, round, final);
        if (step.signal.aborted) return { status: 'cancelled' };
        if (checked.retry) {
          current = checked.retry;
          continue;
        }
        // Mientras espera a su revisión no ocupa hueco de concurrencia [R63.9].
        const supervisor = step.supervisor;
        const reviewMode = { ...(node.aiReview ? { mode: node.aiReview } : {}), final, hasChecks: checked.hasChecks, ...(turn.scope ? { priority: turn.scope } : {}) };
        const missing = checked.missing ?? (supervisor ? await step.limiter.whileWaiting(turn.slot, step.signal, () => supervisor.check(node.id, path, out.output!, profile?.purpose, reviewMode)) : undefined);
        if (step.signal.aborted) return { status: 'cancelled' };
        if (missing !== undefined) {
          let answer: string;
          try {
            answer = await step.limiter.whileWaiting(turn.slot, step.signal, () => step.questions.askReplaying(node.id, path, { text: unfinishedQuestion(missing), options: UNFINISHED_OPTIONS, kind: 'unfinished', fallback: UNFINISHED_STOP }, turn.replay ?? []));
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
            reply = await step.limiter.whileWaiting(turn.slot, step.signal, () => step.questions.askReplaying(node.id, path, { text: out.output!.text, options: [CONFIRM_APPROVE], confirm: { round } }, turn.replay ?? []));
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
