import { useRef, useState } from 'react';
import type { DeliverableSpec, Diagram, UnansweredPolicy } from '@orquestador/core';
import { t, type EditorSession, type ProjectApi, type RunClient } from '@orquestador/editor';
import type { RunInputs } from './RunDialog';
import type { RunsNav } from './runsTypes';

interface Options {
  api: ProjectApi;
  session: EditorSession;
  project: string | undefined;
  client: RunClient;
  save: () => Promise<void>;
  fail: (message: string) => void;
  setMessage: (message: string | undefined) => void;
  refreshRuns: () => void;
  /** Va a Ejecuciones en ese apartado. */
  goRuns: (nav: RunsNav) => void;
  /** Cambia el apartado de Ejecuciones sin cambiar de sección. */
  setRunsNav: (nav: RunsNav) => void;
}

/** Lanzar diagramas: el diálogo, la última entrada y el límite usados [R52.7]. */
export function useRunLauncher({ api, session, project, client, save, fail, setMessage, refreshRuns, goRuns, setRunsNav }: Options) {
  /** Lanzar un diagrama desde Trabajos o desde el Diseñador [R52.7]. */
  const [launch, setLaunch] = useState<Diagram>();
  /** Última entrada usada con cada diagrama [R52.7]. */
  const lastInputs = useRef(new Map<string, string>());
  /** Qué hacer si nadie responde, la última vez con cada diagrama [R70.19]. */
  const lastUnanswered = useRef(new Map<string, UnansweredPolicy>());
  const [lastInput, setLastInput] = useState('');
  const [maxTokens, setMaxTokens] = useState<number>();

  const onStart = async (order: string, limit?: number, deliverable?: DeliverableSpec | null, inputs?: RunInputs): Promise<string | undefined> => {
    if (project === undefined) {
      fail(t('run.noProject'));
      return undefined;
    }
    setLastInput(order);
    await save();
    setMaxTokens(limit);
    goRuns({ section: 'live' });
    const id = await client.start({ diagramId: session.diagram.id, order, ...(limit !== undefined ? { maxTokens: limit } : {}), ...(deliverable !== undefined ? { deliverable } : {}), ...(inputs && inputs.files.length > 0 ? { files: inputs.files } : {}), ...(inputs && inputs.attachments.length > 0 ? { attachments: inputs.attachments } : {}) });
    if (id) {
      setMessage(undefined);
      // Se abre la vista de la nueva ejecución, con «Volver» a En directo [R35.11].
      setRunsNav({ section: 'live', runId: id });
      refreshRuns();
    }
    return id;
  };
  /** «Lanzar» de Trabajos o «Lanzar…» del Diseñador: abre el diálogo con ese diagrama [R52.7]. */
  const openLaunch = async (diagramId: string) => {
    if (project === undefined) return fail(t('run.noProject'));
    if (diagramId === session.diagram.id) {
      await save();
      return setLaunch(session.diagram);
    }
    const r = await api.loadDiagram(diagramId);
    if (r.ok) setLaunch(r.value);
    else fail(r.error.message);
  };
  /** Lanza el diagrama del diálogo: a la vez o en cola, y va a la ejecución salvo «Quedarme donde estoy» [R52.7]. */
  const onLaunch = async (d: Diagram, order: string, limit: number | undefined, deliverable: DeliverableSpec | null | undefined, inputs: RunInputs | undefined, opts: { whenBusy?: 'parallel' | 'queue'; stay: boolean; unanswered?: UnansweredPolicy }) => {
    if (opts.unanswered) lastUnanswered.current.set(d.id, opts.unanswered);
    setLaunch(undefined);
    lastInputs.current.set(d.id, order);
    if (d.id === session.diagram.id) {
      setLastInput(order);
      await save();
    }
    setMaxTokens(limit);
    const res = await api.startRun({
      diagramId: d.id,
      order,
      ...(limit !== undefined ? { maxTokens: limit } : {}),
      ...(deliverable !== undefined ? { deliverable } : {}),
      ...(inputs && inputs.files.length > 0 ? { files: inputs.files } : {}),
      ...(inputs && inputs.attachments.length > 0 ? { attachments: inputs.attachments } : {}),
      ...(opts.whenBusy ? { whenBusy: opts.whenBusy } : {}),
      ...(opts.unanswered ? { unanswered: opts.unanswered } : {}),
    });
    if (!res.ok) return fail(res.error.message);
    refreshRuns();
    const runId = res.value.runId;
    // La última lanzada es la que se sigue en vivo.
    if (runId) void client.attach(runId);
    if (opts.stay) return setMessage(runId ? t('jobs.launched', { name: d.name }) : t('jobs.launchedQueued', { name: d.name }));
    setMessage(undefined);
    goRuns(runId ? { section: 'live', runId } : { section: 'live' });
  };
  /** Guarda el entregable en el diagrama del diálogo, esté abierto o no [R52.7]. */
  const saveDeliverableTo = (d: Diagram, spec: DeliverableSpec | undefined) => {
    if (d.id === session.diagram.id) return session.setDeliverable(spec);
    const next: Diagram = { ...d };
    if (spec) next.deliverable = spec;
    else delete next.deliverable;
    void api.saveDiagram(next).then((r) => (r.ok ? setLaunch((cur) => (cur && cur.id === d.id ? next : cur)) : fail(r.error.message)));
  };
  const closeLaunch = () => setLaunch(undefined);
  return { launch, lastInput, lastInputs, lastUnanswered, maxTokens, onStart, openLaunch, onLaunch, saveDeliverableTo, closeLaunch };
}

export type RunLauncher = ReturnType<typeof useRunLauncher>;
