import type { DeliverableSpec, Diagram, LibraryReader, Payload, PathPolicy, RunHandle, RunOptions, RunRepository, WorkspaceFiles } from '@orquestador/core';
import { RunError } from './errors';
import type { LibrarySnapshot } from './snapshot';

/** Puertos del servicio de ejecución [R56.4]. */
export interface RunPorts {
  runs: RunRepository;
  library: LibraryReader;
  policy: PathPolicy;
  files: WorkspaceFiles;
}

export interface StartRunInput {
  diagramId: string;
  order: string;
  maxTokens?: number;
  maxCostUsd?: number;
  /** Entregable solo para esta ejecución; sustituye al del diagrama y `null` lo quita [R46.11]. */
  deliverable?: DeliverableSpec | null;
  /** Archivos del proyecto (rutas relativas a la carpeta de trabajo) para la entrada [R48.5]. */
  files?: string[];
  /** Adjuntos preparados con `stageAttachment` [R48.5]. */
  attachments?: string[];
  /** Si ya hay otra de este diagrama: a la vez (por defecto) o en cola [R52.3]. */
  whenBusy?: 'parallel' | 'queue';
}

/** Una ejecución lista para arrancar. */
export interface PreparedRun {
  diagram: Diagram;
  order: string | Payload;
  options: RunOptions;
  snapshot?: LibrarySnapshot;
}

/** Una ejecución arrancada en esta sesión. */
export interface Live {
  handle: RunHandle;
  finished: boolean;
  diagram: Diagram;
  /** Copias para la vista previa en curso; `settled` las espera [R54.3]. */
  previews: Promise<unknown>[];
}

/** Ejecuciones arrancadas en esta sesión, por `runId`. */
export class LiveRuns {
  private readonly runs = new Map<string, Live>();

  /** Terminadas que se guardan en memoria; las demás se leen del disco [R63.19]. */
  static readonly KEEP_FINISHED = 10;

  add(live: Live): void {
    this.runs.set(live.handle.runId, live);
    this.prune();
  }

  /** Suelta las terminadas más antiguas por encima del tope, con su historial de eventos [R63.19]. */
  prune(): void {
    const finished = [...this.runs.values()].filter((l) => l.finished);
    for (const old of finished.slice(0, Math.max(0, finished.length - LiveRuns.KEEP_FINISHED))) this.runs.delete(old.handle.runId);
  }
  find(runId: string): Live | undefined {
    return this.runs.get(runId);
  }
  /** La ejecución de esta sesión, o error si no existe. */
  get(runId: string): Live {
    const live = this.runs.get(runId);
    if (!live) throw new RunError('not-found', 'No existe esa ejecución en curso');
    return live;
  }
  /** ¿Hay alguna ejecución de este diagrama en marcha? */
  hasDiagram(diagramId: string): boolean {
    return this.running().some((l) => l.diagram.id === diagramId);
  }
  running(): Live[] {
    return [...this.runs.values()].filter((l) => !l.finished);
  }
  isRunning(runId: string): boolean {
    return this.runs.get(runId)?.finished === false;
  }
  runningIds(): Set<string> {
    return new Set(this.running().map((l) => l.handle.runId));
  }
}
