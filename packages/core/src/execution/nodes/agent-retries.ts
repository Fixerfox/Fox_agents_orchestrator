import type { DiagramNode } from '../../diagrams';
import { clipMiddle, type Id, type Payload } from '../../shared';
import { AgentError, isLimitError, type PreviousAttempt, type RestoreResult } from '../adapter';
import { attemptAgent, type AgentTurn } from './agent-attempt';
import { errorMessage, type Outcome, type StepContext } from './handler';

export type { AgentTurn } from './agent-attempt';

/** Tope de lo que se le cuenta al siguiente intento [R71.8]. */
export const PREVIOUS_ATTEMPT_CHARS = 3000;
/** Acciones del intento anterior que viajan [R71.7]. */
const PREVIOUS_ACTIONS = 10;

/** Cómo acabó un intento, para contárselo al siguiente [R71.7]. */
function endedOf(err: unknown, turn: AgentTurn): PreviousAttempt['ended'] {
  if (turn.ended) return turn.ended;
  if (err instanceof AgentError && err.kind === 'unmet') return 'unmet';
  return 'error';
}

/**
 * Vuelve al punto de partida lo que tocó el intento [R71.10]–[R71.12]. Solo se restaura lo que este intento tocó por
 * primera vez en la ejecución y nadie más tocó después; lo que cambió un comando no tiene copia.
 */
async function restore(step: StepContext, node: DiagramNode, path: Id[], turn: AgentTurn, attempt: number): Promise<RestoreResult | undefined> {
  if (node.onRetry !== 'restore' || !step.restoreFiles || turn.trace.files.size === 0) return undefined;
  const history = step.emitter.history();
  const key = [...path, node.id].join('/');
  const failed: RestoreResult['failed'] = [];
  const asked: { path: string; change?: 'created' | 'modified' }[] = [];
  for (const [rel, f] of turn.trace.files) {
    const touches = history.filter((e) => e.type === 'file.produced' && e.path === rel);
    const before = touches.some((e) => e.seq < turn.trace.startSeq);
    const others = touches.some((e) => e.seq >= turn.trace.startSeq && [...(e.nodePath ?? []), (e as { nodeId: Id }).nodeId].join('/') !== key);
    if (f.via === 'command') failed.push({ path: rel, reason: 'cambiado por un comando' });
    else if (before) failed.push({ path: rel, reason: 'ya estaba cambiado antes de este intento' });
    else if (others) failed.push({ path: rel, reason: 'lo cambió otro paso después' });
    else asked.push({ path: rel, ...(f.change ? { change: f.change } : {}) });
  }
  let result: RestoreResult = { restored: [], removed: [], failed };
  if (asked.length > 0) {
    try {
      const r = await step.restoreFiles(asked, step.space?.dir);
      result = { restored: r.restored, removed: r.removed, failed: [...failed, ...r.failed] };
    } catch (err) {
      result = { restored: [], removed: [], failed: [...failed, ...asked.map((a) => ({ path: a.path, reason: errorMessage(err) }))] };
    }
  }
  step.emitter.emit({ type: 'files.restored', nodeId: node.id, attempt, restored: result.restored, removed: result.removed, failed: result.failed }, path);
  return result;
}

/** Lo que el siguiente intento sabe del anterior [R71.7]. */
async function previousOf(step: StepContext, node: DiagramNode, path: Id[], turn: AgentTurn, attempt: number, err: unknown): Promise<PreviousAttempt> {
  const restored = await restore(step, node, path, turn, attempt);
  const back = new Set([...(restored?.restored ?? []), ...(restored?.removed ?? [])]);
  return {
    attempt,
    kind: err instanceof AgentError ? err.kind : 'fatal',
    message: clipMiddle(errorMessage(err), 600),
    ended: endedOf(err, turn),
    actions: turn.trace.actions.slice(-PREVIOUS_ACTIONS),
    files: [...turn.trace.files].map(([p, f]) => ({ path: p, ...(f.change ? { change: f.change } : {}), ...(f.via ? { via: f.via } : {}), ...(back.has(p) ? { restored: true } : {}) })),
  };
}

/** Intentos de un agente con reintentos por error, sobre una entrada [R27.6][R71.5]–[R71.9]. */
export async function attemptsOf(step: StepContext, node: DiagramNode, input: Payload, path: Id[], turn: AgentTurn): Promise<Outcome> {
  if (step.signal.aborted) return { status: 'cancelled' };
  const { maxAttempts, limitAttempts } = step.retry;
  let normal = 0;
  let limited = 0;
  for (let attempt = 1; ; attempt++) {
    try {
      turn.attempts = turn.base + attempt;
      turn.ended = undefined;
      return await attemptAgent(step, node, input, turn.attempts, path, turn);
    } catch (err) {
      if (step.signal.aborted) return { status: 'cancelled' };
      const retriable = err instanceof AgentError && err.retriable;
      const message = errorMessage(err);
      if (err instanceof AgentError && err.missed.length > 0) turn.missing.splice(0, turn.missing.length, ...err.missed);
      step.emitter.emit({ type: 'error', nodeId: node.id, message, retriable }, path);
      // Los límites de uso tienen su propia cuenta [R71.5].
      const limit = isLimitError(err);
      // El proveedor pidió esperar: ninguna ejecución arranca nada nuevo con él hasta que pase [R77.4].
      if (limit && err instanceof AgentError && err.retryAfterMs !== undefined) {
        const c = step.resources?.limited({ retryAfterMs: err.retryAfterMs, reason: err.kind === 'overloaded' ? 'overloaded' : 'rate_limit' });
        if (c) step.emitter.emit({ type: 'provider.cooldown', nodeId: node.id, ...c }, path);
      }
      const used = limit ? ++limited : ++normal;
      if (!retriable || used >= (limit ? limitAttempts : maxAttempts)) return { status: 'failed' };
      turn.previous = await previousOf(step, node, path, turn, turn.attempts, err);
      const delayMs = step.retry.delayAfter(used, err);
      const cause = turn.ended === 'loop' ? 'loop' : turn.ended === 'timeout' ? 'timeout' : 'error';
      // `kind` y `cause` solo cuando dicen algo: un error temporal normal se ve como siempre [R71.6].
      const kind = err instanceof AgentError && err.kind !== 'transient' ? err.kind : undefined;
      step.emitter.emit({ type: 'node.retrying', nodeId: node.id, attempt, max: limit ? limitAttempts : maxAttempts, delayMs, message, ...(kind ? { kind } : {}), ...(cause !== 'error' ? { cause } : {}) }, path);
      await step.retry.wait(delayMs, step.signal);
      if (step.signal.aborted) return { status: 'cancelled' };
    }
  }
}

/** Texto del intento anterior para el prompt, con tope y recortado por el medio [R71.8]. */
export function describePreviousAttempt(p: PreviousAttempt): string {
  const how = { error: 'falló con un error', timeout: 'se cortó por inactividad o por su duración', loop: 'se cortó por repetir la misma acción', unmet: 'no usó lo obligatorio', interrupted: 'se interrumpió (la aplicación se cerró)' }[p.ended];
  const files = p.files.map((f) => `- ${f.path}${f.change === 'created' ? ' (creado)' : f.change === 'modified' ? ' (modificado)' : ''}${f.via === 'command' ? ' (por un comando)' : ''}${f.restored ? ' — restaurado' : ''}`);
  const left = p.files.filter((f) => !f.restored);
  const text = [
    `El intento ${p.attempt} ${how}: ${p.message}`,
    ...(p.actions.length > 0 ? [`Últimas acciones:\n${p.actions.map((a) => `- ${a}`).join('\n')}`] : []),
    ...(files.length > 0 ? [`Archivos que tocó:\n${files.join('\n')}`] : []),
    left.length > 0 ? 'Revisa esos archivos antes de rehacerlos: puede que parte del trabajo ya esté hecho.' : 'No dejó archivos tocados.',
  ].join('\n\n');
  return clipMiddle(text, PREVIOUS_ATTEMPT_CHARS);
}
