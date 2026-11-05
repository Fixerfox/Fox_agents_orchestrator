import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PendingItem, ProjectApi, QueuedRunView, RunSnapshot, RunSummary } from '@orquestador/editor';

/** Pregunta pendiente de una ejecución concreta [R35.6]. */
export interface InboxItem extends PendingItem {
  runId: string;
}

export interface RunsIndex {
  runs: RunSummary[];
  /** Nombre de cada diagrama del proyecto por id. */
  diagramNames: Record<string, string>;
  /** Preguntas pendientes de todas las ejecuciones en curso [R35.6]. */
  pending: InboxItem[];
  /** Lanzamientos en cola [R52.9]. */
  queue: QueuedRunView[];
  /** `true` cuando ya se ha leído la lista al menos una vez (antes no se sabe qué sigue en marcha) [R35.13]. */
  loaded: boolean;
  refresh: () => void;
}

/** Cada cuánto se revisan las ejecuciones en curso que no se siguen en vivo. */
export const RUNS_POLL_MS = 3000;

/**
 * Índice de ejecuciones del proyecto: el historial, los nombres de los diagramas y las preguntas
 * pendientes de todas las ejecuciones en curso. La que se sigue en vivo (`main`) aporta sus preguntas
 * al momento; las demás se consultan al refrescar [R35.6][R35.12].
 */
export function useRunsIndex(api: ProjectApi, main: RunSnapshot, projectKey: unknown): RunsIndex {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [queue, setQueue] = useState<QueuedRunView[]>([]);
  const [diagramNames, setNames] = useState<Record<string, string>>({});
  const [others, setOthers] = useState<InboxItem[]>([]);
  const [tick, setTick] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [r, d, q] = await Promise.all([api.listRuns(), api.listDiagrams(), api.listQueue()]);
      if (!alive) return;
      const list = r.ok ? r.value : [];
      setRuns(list);
      setQueue(q.ok ? q.value : []);
      setLoaded(true);
      if (d.ok) setNames(Object.fromEntries(d.value.map((x) => [x.id, x.name])));
      const extra: InboxItem[] = [];
      for (const run of list) {
        if (run.status !== 'running' || run.runId === main.runId) continue;
        const q = await api.pendingQuestions(run.runId);
        if (q.ok) extra.push(...q.value.map((x) => ({ ...x, runId: run.runId })));
      }
      if (alive) setOthers(extra);
    })();
    return () => {
      alive = false;
    };
  }, [api, main.runId, main.live.status, main.live.pending.length, tick, projectKey]);

  const anyRunning = runs.some((r) => r.status === 'running') || queue.length > 0;
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(refresh, RUNS_POLL_MS);
    return () => clearInterval(id);
  }, [anyRunning, refresh]);

  const pending = useMemo<InboxItem[]>(
    () => [...(main.runId && main.live.status === 'running' ? main.live.pending.map((p) => ({ ...p, runId: main.runId! })) : []), ...others],
    [main.runId, main.live.status, main.live.pending, others],
  );
  return { runs, queue, diagramNames, pending, loaded, refresh };
}
