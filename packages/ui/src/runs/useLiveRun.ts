import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { RunEvent } from '@orquestador/core';
import { RunClient, type ProjectApi } from '@orquestador/editor';

/** Ejecución que se sigue en vivo y el diagrama que tiene en marcha [R38.11]. */
export function useLiveRun(api: ProjectApi) {
  const client = useMemo(() => new RunClient(api), [api]);
  useEffect(() => () => client.dispose(), [client]);
  const run = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const runningDiagramId = run.live.status === 'running' ? run.events.find((e): e is Extract<RunEvent, { type: 'run.started' }> => e.type === 'run.started')?.diagramId : undefined;
  return { client, run, runningDiagramId };
}

/** Diagramas con preguntas sin responder: las de la ejecución abierta y las de las demás en curso [R39.6]. */
export const askingIdsOf = (pending: { runId: string }[], runs: { runId: string; diagramId: string }[], main: string | undefined, mainAsking: boolean) => [
  ...new Set([...(mainAsking && main ? [main] : []), ...pending.map((q) => runs.find((r) => r.runId === q.runId)?.diagramId).filter((x): x is string => x !== undefined)]),
];

/** Diagrama de la ejecución en curso y de las que siguen en marcha, para marcarlos [R38.11]. */
export const runningIdsOf = (runs: { status: string; diagramId: string }[], main: string | undefined) => [...new Set([...(main ? [main] : []), ...runs.filter((r) => r.status === 'running').map((r) => r.diagramId)])];
