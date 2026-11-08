import {
  feedbackStats,
  MockAgent,
  MockDecider,
  Orchestrator,
  approvedReviews,
  canResume,
  correctionPlan,
  correctionTargets,
  resumePlan,
  validateDiagram,
  type Diagram,
  type RunEvent,
  type RunOptions,
} from '@orquestador/core';
import { fail, ok, type ApiResult, type QueuedRunView, type RunSummary } from '@orquestador/editor';
import type { MemoryApi, MemoryApiOptions, MemoryState, RunEntry } from './types';

function defaultOrchestrator(saved: Map<string, Diagram>): Orchestrator {
  const agents = new Proxy({} as Record<string, never>, {
    get: (_t, id: string) => ({ output: `salida de ${id}`, tokens: [`salida de ${id}`], usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 }, latencyMs: 5 }),
  });
  return new Orchestrator({
    getAdapter: () => new MockAgent(agents),
    decider: new MockDecider(),
    // Subdiagramas: otro diagrama guardado, en su última versión [R33.7].
    resolveTemplate: (id) => {
      const d = saved.get(id);
      if (!d) throw new Error(`No existe el diagrama «${id}»`);
      return structuredClone(d);
    },
  });
}

/** Ejecuciones: lanzar y controlar, cola, entrada, resultados, correcciones y copias. */
export function memoryRuns(s: MemoryState, options: MemoryApiOptions) {
  const { saved, runs } = s;
  const orchestrator = options.orchestrator ?? defaultOrchestrator(saved);
  const listeners = new Set<(runId: string, events: RunEvent[]) => void>();
  /** Ejecución que reanudó a cada una [R41.2]. */
  const resumedBy = new Map<string, string>();
  /** Ejecuciones que corrigieron a cada una [R53.11]. */
  const correctedBy = new Map<string, string[]>();
  /** Diagrama, eventos y entrada de una ejecución que ya no está en marcha [R53.11]. */
  const finishedRun = (runId: string): { diagram: Diagram; events: RunEvent[]; order: string } | { error: ApiResult<never> } => {
    const live = runs.get(runId);
    const past = options.pastRuns?.find((p) => p.summary.runId === runId);
    if (!live && !past) return { error: missing() };
    if (live && !live.events.some((e) => e.type === 'run.finished')) return { error: fail('bad-request', 'Está en marcha: se corrige cuando termine.') };
    const events = live?.events ?? past!.events;
    const diagram = live?.diagram ?? past?.diagram ?? saved.get(past!.summary.diagramId);
    if (!diagram) return { error: fail('not-found', 'No existe ese diagrama') };
    const order = events.find((e): e is Extract<RunEvent, { type: 'node.started' }> => e.type === 'node.started' && e.nodeId === 'entry' && !e.nodePath?.length)?.input?.text ?? live?.order ?? past?.summary.order ?? '';
    return { diagram, events, order };
  };
  const staged = new Map<string, { id: string; name: string; size: number; image: boolean }>();
  let attSeq = 0;
  const launch = (d: Diagram, order: string, opts: RunOptions, files: string[] = []): { runId: string } => {
    const handle = orchestrator.start(d, files.length > 0 ? { text: order, files } : order, opts);
    const entry: RunEntry = { handle, events: [], diagramId: d.id, subscribed: false, order, diagram: structuredClone(d) };
    runs.set(handle.runId, entry);
    handle.bus.subscribe(
      (e) => {
        entry.events.push(e);
        if (entry.subscribed) queueMicrotask(() => listeners.forEach((l) => l(handle.runId, [e])));
      },
      { fromSeq: 1 }, // incluye lo emitido antes de suscribirse
    );
    // Al terminar, arranca el siguiente de la cola de su diagrama [R52.3].
    const done = () => drainQueue(d.id);
    void handle.result.then(done, done);
    return { runId: handle.runId };
  };
  /** Cola por diagrama, como `RunService` [R52.3]. */
  const queue: (QueuedRunView & { start: () => void })[] = [];
  let queueSeq = 0;
  const isLive = (diagramId: string) => [...runs.values()].some((r) => r.diagramId === diagramId && !r.events.some((e) => e.type === 'run.finished'));
  const drainQueue = (diagramId: string) => {
    if (isLive(diagramId)) return;
    const i = queue.findIndex((q) => q.diagramId === diagramId);
    if (i >= 0) queue.splice(i, 1)[0]!.start();
  };
  const restored: string[] = [];
  const run = (id: string) => runs.get(id);
  const missing = () => fail('not-found', 'No existe esa ejecución en curso');

  return {
    restored,
    async resumeRun(runId) {
      // Reanudar en otra ejecución que reutiliza lo que terminó bien [R41.1][R41.2].
      const live = run(runId);
      const past = options.pastRuns?.find((p) => p.summary.runId === runId);
      if (!live && !past) return missing();
      const end = (live?.events ?? []).find((e) => e.type === 'run.finished');
      const status = live ? (end && end.type === 'run.finished' ? end.status : 'running') : past!.summary.status;
      if (!canResume(status, resumedBy.get(runId) ?? past?.summary.resumedBy)) return fail('bad-request', 'Solo se reanuda una ejecución interrumpida, fallida o cancelada.');
      const events = live?.events ?? past!.events;
      const d = live?.diagram ?? past?.diagram ?? saved.get(past!.summary.diagramId);
      if (!d) return fail('not-found', 'No existe ese diagrama');
      const entryInput = events.find((e): e is Extract<RunEvent, { type: 'node.started' }> => e.type === 'node.started' && e.nodeId === 'entry' && !e.nodePath?.length)?.input?.text ?? live?.order ?? past?.summary.order ?? '';
      const r = launch(d, entryInput, { reuse: { fromRunId: runId, outputs: resumePlan(d, events), approvedReviews: approvedReviews(d, events) } });
      resumedBy.set(runId, r.runId);
      return ok({ runId: r.runId });
    },
    async previewFile({ runId, key, path }) {
      // Vista previa: la que se dé en `previews`; si no, el texto de `outputs`, con las webs en línea [R54.4].
      if (!run(runId) && !options.pastRuns?.some((p) => p.summary.runId === runId)) return missing();
      const given = options.previews?.[`${runId}|${key}|${path}`];
      if (given) return ok(structuredClone(given));
      const text = options.outputs?.[path];
      if (text === undefined) return ok({ path, kind: 'missing' as const });
      if (/\.html?$/i.test(path)) return ok({ path, kind: 'html' as const, source: 'run' as const, srcdoc: text });
      return ok({ path, kind: /\.md$/i.test(path) ? ('markdown' as const) : ('text' as const), source: 'run' as const, text });
    },
    async openPreview({ runId }) {
      return run(runId) || options.pastRuns?.some((p) => p.summary.runId === runId) ? ok(true) : missing();
    },
    async proposeCorrection({ runId, text, prefer }) {
      // Pasos corregibles y propuesta del asistente [R53.10][R53.11].
      const found = finishedRun(runId);
      if ('error' in found) return found.error;
      try {
        return ok(await orchestrator.proposeCorrection({ diagram: found.diagram, events: found.events, text: text.trim(), ...(prefer ? { prefer } : {}) }));
      } catch (e) {
        return fail('bad-request', e instanceof Error ? e.message : String(e));
      }
    },
    async correctRun({ runId, text, nodeId, files }) {
      // Ejecución nueva enlazada desde el paso elegido [R53.11].
      if (!text.trim()) return fail('bad-request', 'Escribe qué hay que corregir');
      const found = finishedRun(runId);
      if ('error' in found) return found.error;
      if (!correctionTargets(found.diagram, found.events).includes(nodeId)) return fail('bad-request', 'Ese paso no se puede corregir en esta ejecución');
      const plan = correctionPlan(found.diagram, found.events, nodeId);
      const r = launch(found.diagram, found.order, {
        reuse: { fromRunId: runId, outputs: plan.outputs, approvedReviews: plan.approvedReviews },
        correction: { fromRunId: runId, nodeId, text: text.trim(), previous: plan.previous!, ...(files && files.length > 0 ? { files } : {}) },
      });
      correctedBy.set(runId, [...(correctedBy.get(runId) ?? []), r.runId]);
      return ok({ runId: r.runId });
    },
    async acceptRun({ runId, by, reason }) {
      // Igual que el almacén: se añade `run.accepted` y la ejecución pasa a terminada bien [R65.5][R65.6].
      const text = reason.trim();
      if (text === '' || text.length > 2000) return fail('bad-request', 'Escribe por qué la das por buena (hasta 2000 caracteres).');
      const live = runs.get(runId);
      const past = options.pastRuns?.find((p) => p.summary.runId === runId);
      if (!live && !past) return missing();
      const events = live?.events ?? past!.events;
      const end = events.find((e): e is Extract<RunEvent, { type: 'run.finished' }> => e.type === 'run.finished');
      if (!end) return fail('bad-request', 'Está en marcha: espera a que termine.');
      if (end.status !== 'failed' || events.some((e) => e.type === 'run.accepted')) return ok(false);
      const seq = events.reduce((m, e) => Math.max(m, e.seq), 0) + 1;
      const ts = new Date().toISOString();
      const event = { runId, seq, ts, type: 'run.accepted', by, reason: text, ...(end.reason !== undefined ? { previousReason: end.reason } : {}) } as RunEvent;
      events.push(event);
      if (live) for (const l of listeners) l(runId, [event]);
      if (past) past.summary = { ...past.summary, status: 'succeeded', reason: text, accepted: { by, reason: text, at: ts, ...(end.reason !== undefined ? { previousReason: end.reason } : {}) } };
      return ok(true);
    },
    async supervisorFeedback({ runId, alertSeq, verdict, note }) {
      // Como el almacén: se añade `supervisor.feedback` al registro [R75.21].
      const live = runs.get(runId);
      const past = options.pastRuns?.find((p) => p.summary.runId === runId);
      if (!live && !past) return missing();
      const events = live?.events ?? past!.events;
      const alert = events.find((e) => e.type === 'supervisor.alert' && e.seq === alertSeq);
      if (!alert || alert.type !== 'supervisor.alert') return fail('bad-request', 'Ese aviso no existe en esta ejecución');
      const seq = events.reduce((m, e) => Math.max(m, e.seq), 0) + 1;
      const event = { runId, seq, ts: new Date().toISOString(), type: 'supervisor.feedback', alertSeq, verdict, ...(note?.trim() ? { note: note.trim() } : {}), ...(alert.nodeId !== undefined ? { nodeId: alert.nodeId } : {}), ...(alert.nodePath ? { nodePath: alert.nodePath } : {}) } as RunEvent;
      events.push(event);
      if (live) for (const l of listeners) l(runId, [event]);
      return ok(true);
    },
    async tryCheck(check) {
      // En memoria no hay comandos que ejecutar: se dice qué pasaría [R75.24].
      return ok({ checkId: check.id, label: check.label, kind: check.kind, ok: check.kind !== 'command', detail: check.kind === 'command' ? `Se ejecutaría: ${check.run}` : 'Se comprueba al ejecutar el paso', durationMs: 0 });
    },
    async supervisorStats(runId) {
      const live = runs.get(runId);
      const past = options.pastRuns?.find((p) => p.summary.runId === runId);
      if (!live && !past) return missing();
      const all = [...runs.values()].map((r) => r.events).concat((options.pastRuns ?? []).map((p) => p.events));
      return ok({ run: feedbackStats([live?.events ?? past!.events]), recent: feedbackStats(all.slice(-50)) });
    },
    async dismissRun(runId) {
      const past = options.pastRuns?.find((p) => p.summary.runId === runId);
      if (!past || past.summary.status !== 'interrupted') return ok(false);
      const seq = past.events.reduce((m, e) => Math.max(m, e.seq), 0) + 1;
      const ts = new Date().toISOString();
      past.events.push({ runId, seq, ts, type: 'run.finished', status: 'cancelled', reason: 'Se interrumpió y la cancelaste' } as RunEvent);
      past.summary = { ...past.summary, status: 'cancelled', finishedAt: ts, reason: 'Se interrumpió y la cancelaste' };
      return ok(true);
    },
    async startRun(req) {
      const d = saved.get(req.diagramId);
      if (!d) return fail('not-found', 'No existe ese diagrama');
      const issues = validateDiagram(d);
      if (issues.length > 0) return fail('invalid-diagram', `El diagrama tiene ${issues.length} problema(s)`);
      for (const id of req.attachments ?? []) if (!staged.has(id)) return fail('bad-request', 'Ese adjunto ya no existe');
      const files = [...(req.files ?? []), ...(req.attachments ?? []).map((id) => `.orquestador/attachments/${id}/${staged.get(id)!.name}`)];
      if (!req.order.trim() && files.length === 0) return fail('bad-request', 'Escribe la entrada o adjunta algún archivo');
      const opts: RunOptions = { ...(req.maxTokens !== undefined ? { budget: { maxTokens: req.maxTokens } } : {}), ...(req.deliverable !== undefined ? { deliverable: req.deliverable } : {}) };
      if (req.whenBusy === 'queue' && (isLive(d.id) || queue.some((q) => q.diagramId === d.id))) {
        const snapshot = structuredClone(d);
        const queuedId = `q${++queueSeq}`;
        queue.push({ queuedId, diagramId: d.id, diagramName: d.name, order: req.order, at: new Date().toISOString(), start: () => void launch(snapshot, req.order, opts, files) });
        return ok({ queuedId });
      }
      return ok(launch(d, req.order, opts, files));
    },
    async listQueue() {
      return ok(queue.map(({ queuedId, diagramId, diagramName, order, at }) => ({ queuedId, diagramId, diagramName, order, at })));
    },
    async unqueue(queuedId) {
      const i = queue.findIndex((q) => q.queuedId === queuedId);
      if (i >= 0) queue.splice(i, 1);
      return ok(i >= 0);
    },
    async stageAttachment({ name, data }) {
      const a = { id: `att-${++attSeq}`, name: name.split(/[\\/]/).pop() || 'adjunto', size: data.byteLength, image: /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(name) };
      staged.set(a.id, a);
      return ok({ ...a });
    },
    async pickAttachments() {
      if (!options.attachPick) return ok(null);
      return ok(options.attachPick.map((f) => {
        const a = { id: `att-${++attSeq}`, name: f.name, size: f.size, image: /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(f.name) };
        staged.set(a.id, a);
        return { ...a };
      }));
    },
    async pickProjectFiles() {
      return ok(options.projectPick ? options.projectPick.map((f) => ({ ...f, image: /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(f.path) })) : null);
    },

    async controlRun({ runId, action }) {
      const r = run(runId);
      if (!r) return missing();
      if (action === 'pause') r.handle.pause();
      else if (action === 'resume') r.handle.resume();
      else r.handle.cancel('Cancelada por el usuario');
      return ok(null);
    },
    async answerRun({ runId, questionId, text }) {
      const r = run(runId);
      return r ? ok(r.handle.answer(questionId, text)) : missing();
    },
    async subscribeRun({ runId, fromSeq }) {
      const r = run(runId);
      const past = options.pastRuns?.find((p) => p.summary.runId === runId);
      if (!r && past) return ok(past.events.filter((e) => e.seq >= fromSeq));
      if (!r) return missing();
      r.subscribed = true;
      return ok(r.events.filter((e) => e.seq >= fromSeq));
    },
    async unsubscribeRun(runId) {
      const r = run(runId);
      if (r) r.subscribed = false;
      return ok(null);
    },
    async listRuns() {
      const list: RunSummary[] = [...runs].map(([runId, r]) => {
        const end = r.events.find((e) => e.type === 'run.finished');
        const accepted = r.events.find((e): e is Extract<RunEvent, { type: 'run.accepted' }> => e.type === 'run.accepted');
        const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
        for (const e of r.events)
          if (e.type === 'agent.usage') {
            usage.inputTokens += e.inputTokens;
            usage.outputTokens += e.outputTokens;
            usage.costUsd += e.costUsd ?? 0;
          }
        return {
          runId,
          diagramId: r.diagramId,
          startedAt: r.events[0]?.ts ?? '',
          ...(end ? { finishedAt: end.ts } : {}),
          status: accepted ? 'succeeded' : end && end.type === 'run.finished' ? end.status : 'running',
          ...(accepted ? { reason: accepted.reason } : end && end.type === 'run.finished' && end.reason !== undefined ? { reason: end.reason } : {}),
          ...(accepted ? { accepted: { by: accepted.by, reason: accepted.reason, at: accepted.ts, ...(accepted.previousReason !== undefined ? { previousReason: accepted.previousReason } : {}) } } : {}),
          usage,
          eventCount: r.events.length,
          order: r.order,
          diagramName: r.diagram.name,
          ...((): { resumedFrom?: string; correctedFrom?: string } => {
            const st = r.events.find((e) => e.type === 'run.started');
            if (!st || st.type !== 'run.started') return {};
            return { ...(st.resumedFrom ? { resumedFrom: st.resumedFrom } : {}), ...(st.correctedFrom ? { correctedFrom: st.correctedFrom } : {}) };
          })(),
          ...(resumedBy.has(runId) ? { resumedBy: resumedBy.get(runId)! } : {}),
          ...(correctedBy.has(runId) ? { correctedBy: [...correctedBy.get(runId)!] } : {}),
        };
      });
      return ok([
        ...list,
        ...(options.pastRuns ?? []).map((p) => {
          const summary = structuredClone(p.summary);
          return { ...summary, ...(resumedBy.has(p.summary.runId) ? { resumedBy: resumedBy.get(p.summary.runId)! } : {}), ...(correctedBy.has(p.summary.runId) ? { correctedBy: [...(summary.correctedBy ?? []), ...correctedBy.get(p.summary.runId)!] } : {}) };
        }),
      ]);
    },
    async runDiagram(runId) {
      const r = run(runId);
      if (r) return ok(structuredClone(r.diagram));
      const past = options.pastRuns?.find((p) => p.summary.runId === runId);
      return past ? ok(past.diagram ? structuredClone(past.diagram) : null) : missing();
    },
    async pendingQuestions(runId) {
      const r = run(runId);
      return r ? ok(r.handle.pendingQuestions()) : missing();
    },
    async listOutput() {
      return ok(Object.entries(options.outputs ?? {}).map(([path, text]) => ({ path, size: text.length })));
    },
    async readRunFile({ runId, path }) {
      const now = options.runFiles?.[runId]?.[path];
      const before = options.backups?.[runId]?.[path];
      if (now === undefined && before === undefined) return fail('not-found', 'Esa ejecución no tocó ese fichero');
      return ok({ path, missing: now === undefined, binary: false, ...(now !== undefined ? { current: { text: now, truncated: false } } : {}), ...(before !== undefined ? { before: { text: before, truncated: false } } : {}) });
    },
    async readOutput({ path }) {
      const text = options.outputs?.[path];
      return text === undefined ? fail('not-found', 'No existe ese archivo') : ok({ text, truncated: false });
    },
    async listBackups(runId) {
      return ok(Object.keys(options.backups?.[runId] ?? {}).sort());
    },
    async restoreBackup(req) {
      const has = options.backups?.[req.runId]?.[req.path] !== undefined;
      if (has) restored.push(`${req.runId}:${req.path}`);
      return ok(has);
    },
    onRunEvents(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    onOpenRun: () => () => {},
  } satisfies Partial<MemoryApi>;
}
