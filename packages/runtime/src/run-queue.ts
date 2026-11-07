import type { Diagram, Orchestrator, Payload, RunEvent, RunOptions, RunRepository } from '@orquestador/core';
import type { LibrarySnapshot, RunSnapshots } from './snapshot';
import type { Live, LiveRuns, PreparedRun } from './run-types';

/** Un lanzamiento en la cola de su diagrama [R52.3]. */
export interface QueuedRun {
  queuedId: string;
  diagramId: string;
  diagramName: string;
  order: string;
  /** ISO 8601. */
  at: string;
}

interface QueueEntry extends QueuedRun {
  run: PreparedRun;
}

/** Copia lo que hizo un paso que terminó bien [R54.3]. */
export type StepFilesHandler = (runId: string, key: string, files: string[]) => Promise<unknown>;

/** Oyente de los eventos de todas las ejecuciones, con su diagrama [R61.9]. */
export type RunWatcher = (event: RunEvent, diagram: Diagram) => void;

/** Lanzamiento de ejecuciones y cola por diagrama [R52.3][R56.16]. */
export class RunQueue {
  private queue: QueueEntry[] = [];
  private queueSeq = 0;
  private readonly watchers = new Set<RunWatcher>();

  constructor(
    private readonly live: LiveRuns,
    private readonly runs: RunRepository,
    private readonly orchestrator: Orchestrator,
    private readonly snapshots: RunSnapshots | undefined,
    private readonly onStepFiles: StepFilesHandler,
  ) {}

  /**
   * Arranca una ejecución con su copia [R52.1]. La copia se registra antes de que empiece ningún paso (el
   * orquestador no ejecuta nada hasta el siguiente turno) y se suelta al terminar; entonces arranca la siguiente
   * de la cola de su diagrama [R52.3].
   */
  launch(diagram: Diagram, order: string | Payload, options: RunOptions, snapshot?: LibrarySnapshot): Live {
    const { handle, logged } = this.runs.start(this.orchestrator, diagram, order, options);
    if (snapshot) this.snapshots?.set(handle.runId, snapshot);
    const live: Live = { handle, finished: false, diagram, previews: [] };
    this.live.add(live);
    handle.bus.subscribe((e) => this.tell(e, diagram), { fromSeq: 1 });
    // Al terminar bien un paso, se copia lo que hizo para que la ejecución lo enseñe siempre igual [R54.3].
    const touched = new Map<string, Set<string>>();
    handle.bus.subscribe(
      (e) => {
        if (e.type !== 'file.produced' && e.type !== 'node.finished') return;
        const key = [...(e.nodePath ?? []), e.nodeId].join('/');
        if (e.type === 'file.produced') {
          if (e.reused) return; // ya se copió en su ejecución [R41.9]
          (touched.get(key) ?? touched.set(key, new Set()).get(key)!).add(e.path.replace(/\\/g, '/'));
          return;
        }
        const files = touched.get(key);
        touched.delete(key);
        if (e.status === 'succeeded' && files && files.size > 0) live.previews.push(this.onStepFiles(handle.runId, key, [...files]));
      },
      { fromSeq: 1 },
    );
    const done = () => {
      live.finished = true;
      this.live.prune();
      this.snapshots?.delete(handle.runId);
      this.drain(diagram.id);
    };
    void logged.then(done, done);
    return live;
  }

  /** Escucha todas las ejecuciones que arranquen desde ahora; devuelve la función para dejar de hacerlo [R61.9]. */
  watch(watcher: RunWatcher): () => void {
    this.watchers.add(watcher);
    return () => void this.watchers.delete(watcher);
  }

  /** Un oyente que falla no puede impedir arrancar: el historial se entrega fuera de la protección del bus [R61.9]. */
  private tell(event: RunEvent, diagram: Diagram): void {
    for (const watcher of this.watchers) {
      try {
        watcher(event, diagram);
      } catch {
        /* un aviso perdido no importa a la ejecución */
      }
    }
  }

  /** Cuántas ejecuciones siguen en marcha [R61.9]. */
  runningCount(): number {
    return this.live.running().length;
  }

  launchPrepared(p: PreparedRun): Live {
    return this.launch(p.diagram, p.order, p.options, p.snapshot);
  }

  /** Arranca el primero de la cola de un diagrama si ya no queda ninguna en marcha [R52.3]. */
  private drain(diagramId: string): void {
    while (!this.live.hasDiagram(diagramId)) {
      const i = this.queue.findIndex((q) => q.diagramId === diagramId);
      if (i < 0) return;
      const [next] = this.queue.splice(i, 1);
      try {
        this.launchPrepared(next!.run);
      } catch {
        /* si no arranca, se pasa a la siguiente */
      }
    }
  }

  /** ¿Tiene que esperar? Sí si ya hay alguna de ese diagrama en marcha o en cola [R52.3]. */
  isBusy(diagramId: string): boolean {
    return this.live.hasDiagram(diagramId) || this.queue.some((q) => q.diagramId === diagramId);
  }

  /** Pone un lanzamiento al final de la cola de su diagrama [R52.3]. */
  enqueue(run: PreparedRun, order: string): { queuedId: string } {
    const queuedId = `q${++this.queueSeq}`;
    this.queue.push({ queuedId, diagramId: run.diagram.id, diagramName: run.diagram.name, order, at: new Date().toISOString(), run });
    return { queuedId };
  }

  /** Lanzamientos en cola, en orden [R52.3]. */
  queued(): QueuedRun[] {
    return this.queue.map(({ queuedId, diagramId, diagramName, order, at }) => ({ queuedId, diagramId, diagramName, order, at }));
  }

  /** Quita un lanzamiento de la cola; `false` si ya no estaba [R52.3]. */
  unqueue(queuedId: string): boolean {
    const before = this.queue.length;
    this.queue = this.queue.filter((q) => q.queuedId !== queuedId);
    return this.queue.length < before;
  }

  clear(): void {
    this.queue = [];
  }
}
