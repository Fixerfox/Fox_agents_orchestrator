import type { PendingQuestion } from '@orquestador/core';
import type { LiveRuns } from './run-types';

/** Control de las ejecuciones en marcha: pausar, reanudar, cancelar y responder [R56.16]. */
export class RunControl {
  constructor(private readonly live: LiveRuns) {}

  /** R20.2 */
  pause(runId: string): void {
    this.live.get(runId).handle.pause();
  }
  resume(runId: string): void {
    this.live.get(runId).handle.resume();
  }
  cancel(runId: string): void {
    this.live.get(runId).handle.cancel('Cancelada por el usuario');
  }
  /** Cancela todas las ejecuciones en curso, p. ej. al cerrar el proyecto [R28.7]. */
  cancelAll(): void {
    for (const live of this.live.running()) live.handle.cancel('Proyecto cerrado');
  }
  answer(runId: string, questionId: string, text: string): boolean {
    return this.live.get(runId).handle.answer(questionId, text);
  }

  /** R20.5 */
  pending(runId: string): PendingQuestion[] {
    return this.live.get(runId).handle.pendingQuestions();
  }

  /** Espera a que termine la ejecución y se haya escrito su registro (útil para tests y cierre). */
  async settled(runId: string): Promise<void> {
    const live = this.live.get(runId);
    await live.handle.result;
    // Se sigue con la misma: al terminar puede soltarse de la sesión [R63.19].
    for (let i = 0; i < 200 && !live.finished; i++) await new Promise((r) => setTimeout(r, 5));
    await Promise.allSettled(live.previews);
  }
}
