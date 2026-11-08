import { splitBranchIds, type DiagramNode } from '../../diagrams';
import { DEFAULT_IDLE_MINUTES, DEFAULT_TOOL_MINUTES, isCoordinator, mergeExtra, stepExtra, type Id, type Payload } from '../../shared';
import { AgentError, type AgentQuestion, type AgentStreamEvent, type AnsweredQuestion, type FileChange, type FileVia, type KnowledgeRef, type PreviousAttempt } from '../adapter';
import type { Slot } from '../run/concurrency-limiter';
import { LOOP_CUT, StepWatchdog, toolSignature, type TimeoutKind } from '../run/watchdog';
import { deliverableNotice } from '../text/deliverable-notice';
import { splitRule, type SplitBranch } from '../text/split';
import { explainTouchedFiles } from '../text/touched-files';
import type { Outcome, StepContext } from './handler';

/** Lo que dura todos los intentos de un paso. */
export interface AgentTurn {
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
  /** Lo que va haciendo el intento en curso, para contárselo al siguiente [R71.7]. */
  trace: { startSeq: number; actions: string[]; files: Map<string, { change?: FileChange; via?: FileVia }> };
  /** Cómo cortó el motor el intento en curso, si lo cortó [R70.5][R70.11]. */
  ended?: 'timeout' | 'loop' | undefined;
  /** Lo que dejó el intento anterior [R71.7]. */
  previous?: PreviousAttempt;
}

/** Traza vacía de un intento [R71.7]. */
export const newTrace = (startSeq = 0): AgentTurn['trace'] => ({ startSeq, actions: [], files: new Map() });

/** Lo que se espera a que el motor devuelva el control tras cortar un intento [R70.8]. */
const ABANDON_GRACE_MS = 10_000;

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

export async function attemptAgent(step: StepContext, node: DiagramNode, input: Payload, attempt: number, path: Id[], turn: AgentTurn): Promise<Outcome> {
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
  turn.trace = newTrace(step.emitter.history().length + 1);
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
      ...(turn.previous ? { previousAttempt: turn.previous } : {}),
    },
    path,
  );
  const adapter = step.getAdapter(agentId);
  let streamed = '';
  let resultText: string | undefined;
  const files = new Map<string, FileChange | undefined>();

  // Señal propia del intento: el motor puede cortarlo sin cancelar la ejecución [R70.5].
  const attemptAbort = new AbortController();
  const onRunAbort = () => attemptAbort.abort();
  if (step.signal.aborted) attemptAbort.abort();
  else step.signal.addEventListener('abort', onRunAbort, { once: true });
  const limits = await step.limitsFor(node);
  let timedOut: { kind: TimeoutKind; minutes: number; tool?: string } | undefined;
  let abandon: (() => void) | undefined;
  const abandoned = new Promise<never>((_, reject) => {
    abandon = () => reject(new Error('abandoned'));
  });
  abandoned.catch(() => undefined);
  let grace: unknown;
  const watchdog = new StepWatchdog({
    idleMinutes: limits.idleMinutes ?? DEFAULT_IDLE_MINUTES,
    toolMinutes: limits.toolMinutes ?? DEFAULT_TOOL_MINUTES,
    ...(limits.maxMinutes !== undefined ? { maxMinutes: limits.maxMinutes } : {}),
    timers: step.timers,
    paused: () => step.gate.isPaused,
    onHalf: (kind, minutes, tool) => {
      // Aviso a mitad de camino [R70.4].
      step.emitter.emit({ type: 'supervisor.alert', nodeId: node.id, rule: 'stalled', severity: 'info', detail: `Sin actividad desde hace ${Math.round(minutes)} min${tool ? ` (con ${tool} en curso)` : ''}.` }, path);
    },
    onFire: (kind, minutes, tool) => {
      timedOut = { kind, minutes, ...(tool ? { tool } : {}) };
      turn.ended = kind === 'loop' ? 'loop' : 'timeout';
      step.emitter.emit({ type: 'node.timeout', nodeId: node.id, attempt, kind, minutes, ...(tool ? { tool } : {}) }, path);
      attemptAbort.abort();
      // Si el motor no devuelve el control, se abandona el intento [R70.8].
      grace = step.timers.set(() => abandon?.(), ABANDON_GRACE_MS);
    },
  });

  // Mientras espera al usuario el agente libera su hueco de concurrencia, y el reloj se detiene [R70.3].
  const ask = (q: AgentQuestion): Promise<string> =>
    step.limiter.whileWaiting(slot, step.signal, async () => {
      watchdog.suspend();
      try {
        const answer = await step.questions.ask(node.id, path, q);
        answered.push({ question: q.text, answer });
        return answer;
      } finally {
        watchdog.resume();
      }
    });
  const request = { nodeId: node.id, agentId, runId: step.emitter.runId, input, ...(task ? { task } : {}), ...(node.model ? { model: node.model } : {}), ...(node.confirm ? { confirm: true } : {}), ...(split ? { split } : {}), ...(turn.memory ? { memory: turn.memory } : {}), ...(turn.scope ? { scope: turn.scope } : {}), ...(deliverable ? { deliverable } : {}), ...(hasExtra ? { extra } : {}), ...(missing.length > 0 ? { missing } : {}), attempt, ask, previousAnswers: [...answered], ...(turn.previous ? { previousAttempt: turn.previous } : {}) };

  // Misma acción seguida sin cambiar archivos [R70.10][R70.11].
  let lastSig = '';
  let same = 0;
  const timeoutError = () => {
    const t = timedOut!;
    const message =
      t.kind === 'loop'
        ? `Repitió la misma acción ${LOOP_CUT} veces sin avanzar`
        : t.kind === 'total'
          ? `El intento llegó a su duración máxima de ${t.minutes} min`
          : `El paso no dio señales de vida en ${t.minutes} min${t.tool ? ` (con ${t.tool} en curso)` : ''}`;
    return new AgentError(message, true, [], { kind: 'timeout' });
  };

  watchdog.start();
  const iterator = adapter.run(request, attemptAbort.signal)[Symbol.asyncIterator]();
  try {
    while (true) {
      let next: IteratorResult<AgentStreamEvent>;
      try {
        next = await Promise.race([iterator.next(), abandoned]);
      } catch (err) {
        if (timedOut) throw timeoutError();
        throw err;
      }
      if (next.done) break;
      const ev = next.value;
      if (timedOut) throw timeoutError();
      if (ev.type === 'tool_call') watchdog.activity('tool_call', ev.tool);
      else if (ev.type === 'tool_result') watchdog.activity('tool_result', ev.tool);
      else watchdog.activity('other');
      watchdog.suspend();
      try {
        await step.gate.wait(step.signal);
      } finally {
        watchdog.resume();
      }
      if (step.signal.aborted) return { status: 'cancelled' };
      switch (ev.type) {
        case 'token':
          streamed += ev.text;
          step.emitter.emit({ type: 'token.stream', nodeId: node.id, text: ev.text }, path);
          break;
        case 'tool_call': {
          step.emitter.emit({ type: 'tool.called', nodeId: node.id, tool: ev.tool, input: ev.input }, path);
          turn.trace.actions.push(`${ev.tool}: ${JSON.stringify(ev.input ?? {}).slice(0, 160)}`);
          const sig = toolSignature(ev.tool, ev.input);
          same = sig === lastSig ? same + 1 : 1;
          lastSig = sig;
          if (same >= LOOP_CUT) watchdog.loop(ev.tool);
          break;
        }
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
            const tr = turn.trace.files.get(ev.path);
            turn.trace.files.set(ev.path, { ...((tr?.change === 'created' || ev.change === 'created') ? { change: 'created' as const } : ev.change ? { change: ev.change } : tr?.change ? { change: tr.change } : {}), ...(ev.via ?? tr?.via ? { via: (ev.via ?? tr?.via)! } : {}) });
          }
          same = 0;
          lastSig = '';
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
      if (timedOut) throw timeoutError();
    }
    if (timedOut) throw timeoutError();
  } catch (err) {
    if (timedOut && !step.signal.aborted) throw err instanceof AgentError && err.retriable ? err : timeoutError();
    throw err;
  } finally {
    watchdog.stop();
    if (grace !== undefined) step.timers.clear(grace);
    step.signal.removeEventListener('abort', onRunAbort);
    if (timedOut) void Promise.resolve(iterator.return?.()).catch(() => undefined);
  }
  if (step.signal.aborted) return { status: 'cancelled' };
  const text = explainTouchedFiles(resultText ?? streamed, files);
  return { status: 'succeeded', output: { text, files: [...files.keys()] } };
}
