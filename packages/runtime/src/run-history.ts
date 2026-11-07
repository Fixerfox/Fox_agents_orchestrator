import type { DeliverableSpec, Diagram, LibraryReader, Payload, RunEvent, RunMeta, RunRepository } from '@orquestador/core';
import { RunError } from './errors';
import type { LiveRuns } from './run-types';

/** Lo que queda de una ejecución que ya no está en marcha [R53.11]. */
export interface PastRun {
  meta: RunMeta;
  diagram: Diagram;
  events: RunEvent[];
  order: string | Payload;
  deliverable?: DeliverableSpec;
}

/** Ejecuciones guardadas y de esta sesión: listar, suscribirse, linaje y terminadas [R56.16]. */
export class RunHistory {
  constructor(
    private readonly live: LiveRuns,
    private readonly runs: RunRepository,
    private readonly library: LibraryReader,
  ) {}

  list(): Promise<RunMeta[]> {
    return this.runs.list({ live: this.live.runningIds() });
  }

  /** Diagrama tal como estaba al arrancar la ejecución; `null` si no se guardó (R35.16). */
  runDiagram(runId: string): Promise<Diagram | null> {
    return this.runs.readDiagram(runId);
  }

  isFinished(runId: string): boolean {
    return this.live.find(runId)?.finished ?? true;
  }

  /** Diagrama, eventos, entrada y entregable de una ejecución guardada [R41.1][R53.11]. */
  async past(runId: string): Promise<PastRun> {
    const meta = (await this.list()).find((m) => m.runId === runId);
    if (!meta) throw new RunError('not-found', 'No existe esa ejecución');
    const events = await this.runs.readEvents(runId);
    const diagram = (await this.runs.readDiagram(runId)) ?? (await this.library.diagram(meta.diagramId));
    const entry = events.find((e): e is Extract<RunEvent, { type: 'node.started' }> => e.type === 'node.started' && e.nodeId === 'entry' && !e.nodePath?.length);
    // El entregable con el que arrancó, aunque se hubiera cambiado solo para ella [R46.11].
    const started = events.find((e): e is Extract<RunEvent, { type: 'run.started' }> => e.type === 'run.started');
    return { meta, diagram, events, order: entry?.input ?? meta.order ?? '', ...(started?.deliverable ? { deliverable: started.deliverable } : {}) };
  }

  /** Cierra como cancelada una ejecución interrumpida [R41.3]. */
  async dismiss(runId: string): Promise<boolean> {
    if (this.live.isRunning(runId)) throw new RunError('bad-request', 'Está en marcha: cancélala desde su vista.');
    return this.runs.dismissInterrupted(runId);
  }

  /**
   * R20.3: devuelve el historial desde `fromSeq` y registra `onLive` para lo que llegue después.
   * Para ejecuciones vivas o de esta sesión usa el bus (sin huecos ni duplicados); si no, lee el disco.
   */
  async subscribe(runId: string, fromSeq: number, onLive: (event: RunEvent) => void): Promise<{ backlog: RunEvent[]; unsubscribe: () => void }> {
    if (!Number.isInteger(fromSeq) || fromSeq < 1) throw new RunError('bad-request', 'fromSeq debe ser un entero ≥ 1');
    const live = this.live.find(runId);
    if (live) {
      const backlog: RunEvent[] = [];
      let replaying = true;
      const unsubscribe = live.handle.bus.subscribe((e) => (replaying ? backlog.push(e) : onLive(e)), { fromSeq });
      replaying = false;
      return { backlog, unsubscribe };
    }
    try {
      const events = await this.runs.readEvents(runId);
      return { backlog: events.filter((e) => e.seq >= fromSeq), unsubscribe: () => {} };
    } catch {
      throw new RunError('not-found', 'No existe esa ejecución');
    }
  }

  /** Ejecución y las anteriores de las que viene (reanudada o corregida), hasta 5 [R54.4]. */
  async lineage(runId: string): Promise<string[]> {
    const metas = new Map((await this.list()).map((m) => [m.runId, m]));
    const out = [runId];
    let cur = metas.get(runId);
    while (cur && out.length < 6) {
      const prev = cur.correctedFrom ?? cur.resumedFrom;
      if (!prev || out.includes(prev)) break;
      out.push(prev);
      cur = metas.get(prev);
    }
    return out;
  }
}
