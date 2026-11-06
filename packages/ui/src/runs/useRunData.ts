import { useState, useEffect, useMemo } from 'react';
import { type Diagram, type RunEvent } from '@orquestador/core';
import { type ProjectApi, type RunSnapshot, type HistoryRow, RunClient, settleLive, runTimeline, t } from '@orquestador/editor';
import { nodeLabel, money, diagramLabel } from './runFormat';

/** Reloj que avanza cada segundo mientras algo sigue en marcha (barras abiertas del cronograma). */
export function useNow(active: boolean, now: () => number): number {
  const [value, setValue] = useState(now);
  useEffect(() => {
    setValue(now());
    if (!active) return;
    const id = setInterval(() => setValue(now()), 1000);
    return () => clearInterval(id);
  }, [active, now]);
  return value;
}

/** Diagramas de las ejecuciones, cargados bajo demanda; `null` si ya no existe. */
export function useDiagrams(api: ProjectApi, ids: readonly string[]): Record<string, Diagram | null> {
  const [cache, setCache] = useState<Record<string, Diagram | null>>({});
  const key = [...new Set(ids)].sort().join('|');
  useEffect(() => {
    let alive = true;
    for (const id of key ? key.split('|') : []) {
      if (id in cache) continue;
      void api.loadDiagram(id).then((r) => alive && setCache((c) => ({ ...c, [id]: r.ok ? r.value : null })));
    }
    return () => {
      alive = false;
    };
  }, [api, key]);
  return cache;
}

/**
 * Todo lo que se ve de una ejecución, a partir de sus eventos: lo comparten la vista de la ejecución y su modal
 * [R35.8][R44.1]. `ready` es falso mientras se carga.
 */
export function useRunData(api: ProjectApi, runId: string, main: RunSnapshot, row: HistoryRow | undefined, listLoaded: boolean, now: () => number) {
  const isMain = runId === main.runId;
  // Un cliente propio para ejecuciones que no son la que se sigue en vivo: así no se deja de seguir aquella [R35.12].
  const [viewSnap, setViewSnap] = useState<RunSnapshot | undefined>(undefined);
  useEffect(() => {
    if (isMain) return;
    const viewer = new RunClient(api);
    const off = viewer.subscribe(() => setViewSnap(viewer.getSnapshot()));
    void viewer.attach(runId);
    return () => {
      off();
      void viewer.detach();
      viewer.dispose();
    };
  }, [api, runId, isMain]);
  const snap = isMain ? main : viewSnap;
  const events = snap?.events ?? [];
  const rawLive = snap?.live;
  // Si sigue en marcha lo decide quien la ejecuta (la que se sigue en vivo o la lista), nunca solo sus eventos [R35.13].
  const running = isMain ? rawLive?.status === 'running' : row?.status === 'running';
  const finishedEv = events.find((e): e is Extract<RunEvent, { type: 'run.finished' }> => e.type === 'run.finished');
  // Con eventos pero sin `run.finished` y sin nadie que la ejecute: se interrumpió [R35.13].
  const interrupted = !running && events.length > 0 && !finishedEv;
  const live = useMemo(() => (rawLive && !running ? settleLive(rawLive) : rawLive), [rawLive, running]);
  const nowValue = useNow(running, now);
  const started = events.find((e): e is Extract<RunEvent, { type: 'run.started' }> => e.type === 'run.started');
  const diagramId = row?.diagramId ?? started?.diagramId;
  const { diagram, old } = useRunDiagram(api, runId, diagramId);
  // Las marcas de retorno nombran la revisión como se ve en el diagrama [R35.17].
  const timeline = useMemo(
    () => runTimeline(events, nowValue, { settled: !running, label: (id, path) => nodeLabel(diagram ?? undefined, id, path) }),
    [events, nowValue, running, diagram],
  );
  const label = (nodeId: string, nodePath: readonly string[] = []) => nodeLabel(diagram ?? undefined, nodeId, nodePath);
  // Sin la lista no se sabe si una ejecución ajena sigue en marcha: se espera antes de afirmar nada [R35.13].
  const ready = !!snap && !!live && events.length > 0 && (isMain || listLoaded);
  const measured = events.some((e) => e.type === 'agent.usage');
  const tokens = live ? live.usage.inputTokens + live.usage.outputTokens : 0;
  const usageText = !measured && !running ? t('runs.noUsage') : `${tokens.toLocaleString('es-ES')} tokens · ${money(live?.usage.costUsd ?? 0)}`;
  const input = row?.input || (events.find((e) => e.type === 'node.started' && e.nodeId === 'entry' && !e.nodePath) as { input?: { text?: string } } | undefined)?.input?.text || '';
  const startTs = events[0]?.ts;
  const endTs = finishedEv?.ts ?? (running ? undefined : events[events.length - 1]?.ts);
  const duration = startTs ? Math.max(0, ((endTs ? Date.parse(endTs) : nowValue) - Date.parse(startTs)) / 1000) : 0;
  const status = interrupted ? 'interrupted' : running ? 'running' : (finishedEv?.status ?? live?.status ?? 'running');
  const reason = finishedEv?.reason ?? row?.reason;
  const title = diagram?.name ?? diagramLabel(row);
  return { snap, events, live, running, diagram, old, timeline, label, ready, measured, tokens, usageText, input, duration, status, reason, title };
}

export type RunData = ReturnType<typeof useRunData>;

/**
 * Diagrama de una ejecución tal como estaba al arrancar (R35.16). Si no se guardó (ejecuciones
 * anteriores) se usa el actual y `old` lo indica; `null` si tampoco existe ya.
 */
function useRunDiagram(api: ProjectApi, runId: string, diagramId: string | undefined): { diagram: Diagram | null | undefined; old: boolean } {
  const [state, setState] = useState<{ diagram: Diagram | null | undefined; old: boolean }>({ diagram: undefined, old: false });
  useEffect(() => {
    let alive = true;
    setState({ diagram: undefined, old: false });
    void (async () => {
      const own = await api.runDiagram(runId);
      if (!alive) return;
      if (own.ok && own.value) return setState({ diagram: own.value, old: false });
      if (!diagramId) return;
      const now = await api.loadDiagram(diagramId);
      if (alive) setState({ diagram: now.ok ? now.value : null, old: now.ok });
    })();
    return () => {
      alive = false;
    };
  }, [api, runId, diagramId]);
  return state;
}
