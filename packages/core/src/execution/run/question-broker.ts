import { DEFAULT_UNANSWERED, type Id, type UnansweredPolicy } from '../../shared';
import { AgentError, type AgentQuestion, type ReviewQuestion } from '../adapter';
import type { RunEmitter } from './run-emitter';
import { MINUTE_MS, realTimers, type Timers } from './timers';

export interface PendingQuestion {
  questionId: string;
  nodeId: Id;
  nodePath: Id[];
  text: string;
  options?: string[];
  confirm?: { round: number };
  /** Pregunta de una revisión humana [R53.3]. */
  review?: ReviewQuestion;
}

interface PendingEntry extends PendingQuestion {
  resolve(answer: string): void;
}

/** Recordatorio de una pregunta sin responder [R70.16]. */
export const REMINDER_MINUTES = 15;

/** Cómo se fija la política: `unanswered` o, en ejecuciones antiguas, `questionTimeoutMs` [R70.18]. */
export function unansweredPolicy(options: { unanswered?: UnansweredPolicy; questionTimeoutMs?: number }): UnansweredPolicy {
  if (options.unanswered) return options.unanswered;
  if (options.questionTimeoutMs !== undefined) return { afterMinutes: options.questionTimeoutMs / MINUTE_MS, action: 'fail' };
  return DEFAULT_UNANSWERED;
}

const minutesText = (m: number) => (m >= 1 ? `${Math.round(m)} min` : `${Math.round(m * 60)} s`);

/** Preguntas al usuario, permisos y confirmaciones, con sus respuestas [R56.13]; y lo que pasa si nadie responde [R70.14]. */
export class QuestionBroker {
  private seq = 0;
  private readonly pending = new Map<string, PendingEntry>();

  constructor(
    private readonly emitter: RunEmitter,
    private readonly signal: AbortSignal,
    private readonly policy: UnansweredPolicy = DEFAULT_UNANSWERED,
    private readonly timers: Timers = realTimers,
  ) {}

  ask(nodeId: Id, path: Id[], question: AgentQuestion): Promise<string> {
    const questionId = `q-${++this.seq}`;
    return new Promise<string>((resolve, reject) => {
      const handles: unknown[] = [];
      const cleanup = () => {
        for (const h of handles) this.timers.clear(h);
        this.signal.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        this.pending.delete(questionId);
        cleanup();
        reject(new Error('aborted'));
      };
      this.pending.set(questionId, {
        questionId,
        nodeId,
        nodePath: [...path],
        text: question.text,
        ...(question.options ? { options: [...question.options] } : {}),
        ...(question.confirm ? { confirm: { ...question.confirm } } : {}),
        ...(question.review ? { review: { ...question.review } } : {}),
        resolve: (answer) => {
          cleanup();
          resolve(answer);
        },
      });
      this.signal.addEventListener('abort', onAbort, { once: true });
      // Un recordatorio por pregunta [R70.16].
      handles.push(
        this.timers.set(() => {
          if (this.pending.has(questionId)) this.emitter.emit({ type: 'question.reminder', nodeId, questionId, text: question.text, minutes: REMINDER_MINUTES }, path);
        }, REMINDER_MINUTES * MINUTE_MS),
      );
      const { action, afterMinutes } = this.policy;
      if (action !== 'wait') {
        handles.push(
          this.timers.set(() => {
            if (!this.pending.has(questionId)) return;
            // La respuesta segura solo si la pregunta la tiene; si no, el paso falla [R70.14].
            if (action === 'fallback' && question.fallback !== undefined) {
              this.answer(questionId, question.fallback, true);
              return;
            }
            this.pending.delete(questionId);
            cleanup();
            reject(new AgentError(`Tiempo de espera de la respuesta del usuario agotado: nadie respondió en ${minutesText(afterMinutes)}`, false));
          }, afterMinutes * MINUTE_MS),
        );
      }
      this.emitter.emit(
        {
          type: 'agent.question',
          nodeId,
          questionId,
          text: question.text,
          ...(question.options ? { options: question.options } : {}),
          ...(question.confirm ? { confirm: question.confirm } : {}),
          ...(question.kind ? { kind: question.kind } : {}),
          ...(question.review ? { review: question.review } : {}),
        },
        path,
      );
    });
  }

  /** `auto`: respondida sola porque nadie respondió [R70.15]. */
  answer(questionId: string, text: string, auto = false): boolean {
    const entry = this.pending.get(questionId);
    if (!entry) return false;
    this.pending.delete(questionId);
    this.emitter.emit({ type: 'agent.answer', nodeId: entry.nodeId, questionId, text, ...(auto ? { auto: true as const } : {}) }, entry.nodePath);
    entry.resolve(text);
    return true;
  }

  list(): PendingQuestion[] {
    return [...this.pending.values()].map(({ resolve: _resolve, ...q }) => q);
  }
}
