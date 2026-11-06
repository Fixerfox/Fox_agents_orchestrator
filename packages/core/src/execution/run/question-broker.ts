import type { Id } from '../../shared';
import { AgentError, type AgentQuestion, type ReviewQuestion } from '../adapter';
import type { RunEmitter } from './run-emitter';

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

/** Preguntas al usuario, permisos y confirmaciones, con sus respuestas [R56.13]. */
export class QuestionBroker {
  private seq = 0;
  private readonly pending = new Map<string, PendingEntry>();

  constructor(
    private readonly emitter: RunEmitter,
    private readonly signal: AbortSignal,
    private readonly timeoutMs: number | undefined,
  ) {}

  ask(nodeId: Id, path: Id[], question: AgentQuestion): Promise<string> {
    const questionId = `q-${++this.seq}`;
    return new Promise<string>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
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
      if (this.timeoutMs !== undefined) {
        timer = setTimeout(() => {
          this.pending.delete(questionId);
          cleanup();
          reject(new AgentError('Tiempo de espera de la respuesta del usuario agotado', false));
        }, this.timeoutMs);
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

  answer(questionId: string, text: string): boolean {
    const entry = this.pending.get(questionId);
    if (!entry) return false;
    this.pending.delete(questionId);
    this.emitter.emit({ type: 'agent.answer', nodeId: entry.nodeId, questionId, text }, entry.nodePath);
    entry.resolve(text);
    return true;
  }

  list(): PendingQuestion[] {
    return [...this.pending.values()].map(({ resolve: _resolve, ...q }) => q);
  }
}
