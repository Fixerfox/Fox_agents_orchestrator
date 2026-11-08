/** Ejecuta las comprobaciones que tocan el disco o lanzan procesos; lo implementa la app [R75.4][R75.6]. */
export interface CheckRunner {
  /** ¿Está aprobado este comando en el proyecto (por su texto exacto)? [R75.6] */
  approved(run: string): Promise<boolean>;
  approve(run: string): Promise<void>;
  /**
   * Ejecuta el comando en la carpeta del paso (`dir`, o la de trabajo), sin las claves de la app en el entorno y
   * matando su árbol de procesos al pasar el tiempo [R75.4].
   */
  command(o: { run: string; timeoutSec: number; dir?: string }, signal: AbortSignal): Promise<{ exitCode: number | null; output: string; timedOut: boolean; durationMs: number }>;
  /** De los patrones, los que no encuentran ningún archivo en la carpeta [R75.1]. */
  missing(patterns: readonly string[], dir?: string): Promise<string[]>;
}

/** Lo que cambió un paso, para que la revisión juzgue por la evidencia [R75.7]. */
export interface EvidenceSource {
  /**
   * Diff unificado de lo que tocó el paso respecto a cómo estaba (copia de R31.6), con los `priority` primero y los
   * más pequeños después, hasta `maxChars`; de todos, sus líneas añadidas y quitadas.
   */
  diff(o: { runId: string; files: { path: string; change?: 'created' | 'modified'; via?: string }[]; dir?: string; priority: readonly string[]; maxChars: number }): Promise<{ diff: string; lines: { path: string; added: number; removed: number }[] }>;
}
