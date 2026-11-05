import {
  analyzeImport,
  planSkillFiles,
  installImport,
  defaultSettings,
  validateSkill,
  withoutSkill,
  normalizeSettings,
  validateAgent,
  validateContext,
  validateMcpServer,
  type McpServerDefinition,
  validateSettings,
  withoutContext,
  MockAgent,
  MockDecider,
  Orchestrator,
  validateDiagram,
  type AgentDefinition,
  type ImportPlan,
  type RecentView,
  type SkillDefinition,
  type SourceTree,
  type AppSettings,
  type ContextDefinition,
  type Diagram,
  type RunEvent,
  type RunHandle,
  emptyLibraryFolders,
  tidyLibraryFolders,
  validateLibraryFolders,
  type LibraryFolders,
  canResume,
  resumePlan,
  approvedReviews,
  correctionPlan,
  correctionTargets,
  type RunOptions,
  stepCount,
} from '@orquestador/core';
import {
  createDiagram,
  exampleTemplates,
  fail,
  ok,
  type ApiResult,
  type FilePreview,
  type DiagramSummary,
  type ProjectApi,
  CHANNELS,
  ContractError,
  parseRequest,
  type ConnectionResult,
  type DraftRequest,
  type DraftResult,
  type McpTestResult,
  type AssistantEvent,
  type AssistantMessage,
  type TerminalEvent,
  type TerminalProgram,
  type SettingsView,
  type RunSummary,
  type QueuedRunView,
} from '@orquestador/editor';

export interface MemoryApiOptions {
  /** Orquestador a usar; por defecto agentes simulados que responden «salida de <agente>». */
  orchestrator?: Orchestrator;
  /** Archivos de salida por ejecución (nombre → texto). */
  outputs?: Record<string, string>;
  /** Vistas previas de los archivos de los pasos, por `runId|key|ruta`; si falta, se usa `outputs` [R54.4]. */
  previews?: Record<string, FilePreview>;
  /** Agentes y contextos iniciales del proyecto. */
  agents?: AgentDefinition[];
  contexts?: ContextDefinition[];
  /** Servidores MCP del proyecto y secretos guardados («id» → nombre → valor) [R30.1]. */
  mcp?: McpServerDefinition[];
  mcpSecrets?: Record<string, Record<string, string>>;
  /** Carpetas de la biblioteca [R38.13]. */
  folders?: LibraryFolders;
  /** Asistente simulado: pasos (texto o herramienta) que responde a cada turno [R29.6]. */
  assistant?: (messages: AssistantMessage[]) => AssistantStep[];
  /** Resultado de «Probar conexión» de un servidor MCP [R30.5]. */
  mcpTest?: McpTestResult | ((id: string) => McpTestResult);
  skills?: SkillDefinition[];
  /** Archivos incluidos en cada skill (id → ruta → contenido). */
  skillFiles?: Record<string, Record<string, string>>;
  /** Archivos que «elegirá» el usuario al añadir referencias; sin ellos el diálogo se cancela [R24.9]. */
  pickedFiles?: SourceTree;
  /** Carpeta que «elegirá» el usuario como carpeta de trabajo; sin ella el diálogo se cancela [R31.1]. */
  workFolderPick?: { name: string; files: number };
  /** Lo que devuelven «Adjuntar» y «Del proyecto…» (en los tests) [R48.3]. */
  attachPick?: { name: string; size: number }[];
  projectPick?: { path: string; size: number }[];
  /** Copias de seguridad por ejecución (ruta → texto original) [R31.6]. */
  backups?: Record<string, Record<string, string>>;
  /** Contenido actual de los ficheros que tocaron las ejecuciones, por ejecución y ruta [R45.10]. */
  runFiles?: Record<string, Record<string, string>>;
  /** Proyectos recientes iniciales [R28.3]. */
  recent?: RecentView[];
  /** Resultado de «Probar conexión» [R27.12]. */
  connection?: ConnectionResult;
  /** Resultado de «Elegir archivos/carpeta» en un contexto; `'cancel'` simula cancelar el diálogo. */
  contextPick?: 'cancel' | { value: string; files: number; bytes: number; renamed: number; scripts: string[] };
  /** Respuesta de «Redactar con Claude»; por defecto una propuesta fija. Una función puede fallar con `fail`. */
  draft?: DraftResult | ((req: DraftRequest) => ApiResult<DraftResult> | Promise<ApiResult<DraftResult>>);
  /** Paquete que «elegirá» el usuario al instalar; sin él, el diálogo se cancela [R25.1]. */
  importTree?: SourceTree;
  /** Contenido simulado de la carpeta de trabajo para `inspectWorkFolder` [R32.16]. */
  workFolderTree?: { files: SourceTree['files']; summary: string; docs: { name: string; text: string }[] };
  /** Simula un sistema sin almacenamiento cifrado [R23.3]. */
  noEncryption?: boolean;
  /** Terminal simulada: `external` simula que se abrió la del sistema; `fail` que no hay ninguna [R30.13][R30.14]. */
  terminal?: { external?: boolean; fail?: boolean };
  /** Ejecuciones anteriores ya terminadas (historial) con sus eventos [R35.7]. */
  pastRuns?: { summary: RunSummary; events: RunEvent[]; diagram?: Diagram }[];
}

interface RunEntry {
  handle: RunHandle;
  events: RunEvent[];
  diagramId: string;
  subscribed: boolean;
  order: string;
  /** Copia del diagrama al arrancar (R35.16). */
  diagram: Diagram;
}

/** Un paso del asistente simulado: decir algo o llamar a una herramienta de la app [R29.6]. */
export type AssistantStep = { text: string } | { tool: string; args: Record<string, unknown> } | { read: string; target: string; ok?: boolean };

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

export type MemoryApi = ProjectApi & {
  saved: Map<string, Diagram>;
  runs: Map<string, RunEntry>;
  agents: Map<string, AgentDefinition>;
  contexts: Map<string, ContextDefinition>;
  mcp: Map<string, McpServerDefinition>;
  mcpSecrets: Map<string, Record<string, string>>;
  /** Carpetas guardadas [R38.13]. */
  folders: () => LibraryFolders;
  skills: Map<string, SkillDefinition>;
  /** Copias restauradas con `restoreBackup` («ejecución:ruta») [R31.6]. */
  restored: string[];
  /** Terminales simuladas abiertas: programa, petición y lo escrito [R30.13]. */
  terminals: Map<string, { program: TerminalProgram; prompt?: string; written: string; alive: boolean }>;
  /** Simula que la terminal escribe algo (salida del programa). */
  terminalOutput(id: string, data: string): void;
  /** Lo que la interfaz devolvió a Claude por cada herramienta (para comprobar que no lleva secretos) [R30.12]. */
  assistantResults: { name: string; ok: boolean; result: unknown }[];
  /** Mensajes que recibió el asistente en cada turno. */
  assistantTurns: AssistantMessage[][];
};

/** Implementación en memoria de `ProjectApi`: para tests y para desarrollar la interfaz sin Electron. */
export function createMemoryApi(
  initial: Diagram[] = [createDiagram('principal', 'Principal')],
  options: MemoryApiOptions = {},
): MemoryApi {
  const saved = new Map(initial.map((d) => [d.id, structuredClone(d)]));
  const runs = new Map<string, RunEntry>();
  const orchestrator = options.orchestrator ?? defaultOrchestrator(saved);
  const listeners = new Set<(runId: string, events: RunEvent[]) => void>();
  const assistantListeners = new Set<(turnId: string, event: AssistantEvent) => void>();
  const turns = new Map<string, { cancelled: boolean; pending: Map<string, (r: { ok: boolean; result: unknown }) => void> }>();
  const agents = new Map((options.agents ?? []).map((a) => [a.id, structuredClone(a)]));
  const contexts = new Map((options.contexts ?? []).map((c) => [c.id, structuredClone(c)]));
  const mcp = new Map((options.mcp ?? []).map((m) => [m.id, structuredClone(m)]));
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
  let folders = tidyLibraryFolders(options.folders ?? emptyLibraryFolders());
  const mcpSecrets = new Map(Object.entries(options.mcpSecrets ?? {}).map(([k, v]) => [k, { ...v }]));
  const skills = new Map((options.skills ?? []).map((k) => [k.id, structuredClone(k)]));
  const enc = new TextEncoder();
  const skillData = new Map<string, Map<string, Uint8Array>>(
    Object.entries(options.skillFiles ?? {}).map(([id, files]) => [id, new Map(Object.entries(files).map(([p, text]) => [p, enc.encode(text)]))]),
  );
  const filesOf = (id: string) => skillData.get(id) ?? skillData.set(id, new Map()).get(id)!;
  const listFiles = (id: string) => [...filesOf(id)].map(([path, d]) => ({ path, size: d.length })).sort((a, b) => a.path.localeCompare(b.path));
  let pending: { id: string; plan: ImportPlan } | undefined;
  let importCount = 0;
  let settings: AppSettings = defaultSettings();
  let keyStored = false;
  let workFolder: { name: string; files: number } | null = null;
  const view = (): SettingsView => ({ ...settings, apiKeyStored: keyStored });
  const invalid = (problems: { field: string; message: string }[]) => fail('invalid', problems[0]!.message, problems);
  const usesAgent = (d: Diagram, id: string): boolean =>
    d.nodes.some((n) => (n.kind === 'agent' && n.agentId === id) || (n.kind === 'loop' && n.loop !== undefined && usesAgent(n.loop.body, id)));
  let open = false;
  let recent: RecentView[] = (options.recent ?? []).map((r) => ({ ...r }));
  const res = async <T,>(v: T): Promise<ApiResult<T>> => ok(v);
  const restored: string[] = [];
  const terminals: MemoryApi['terminals'] = new Map();
  const assistantResults: MemoryApi['assistantResults'] = [];
  const assistantTurns: MemoryApi['assistantTurns'] = [];
  const callNames = new Map<string, string>();
  const terminalListeners = new Set<(id: string, event: TerminalEvent) => void>();
  let termSeq = 0;
  const termEmit = (id: string, event: TerminalEvent) => {
    for (const l of terminalListeners) l(id, event);
  };
  const run = (id: string) => runs.get(id);
  const missing = () => fail('not-found', 'No existe esa ejecución en curso');

  const impl: MemoryApi = {
    saved,
    runs,
    agents,
    contexts,
    mcp,
    mcpSecrets,
    folders: () => structuredClone(folders),
    skills,
    restored,
    terminals,
    assistantResults,
    assistantTurns,
    terminalOutput: (id, data) => termEmit(id, { type: 'data', data }),
    async terminalStart(req) {
      if (!open) return fail('not-found', 'Abre un proyecto para usar la terminal');
      if (options.terminal?.fail) return fail('unavailable', 'No se pudo abrir ninguna terminal en este equipo');
      if ([...terminals.values()].filter((t) => t.alive).length >= 3) return fail('limit', 'Como mucho 3 terminales abiertas: cierra alguna');
      const id = `term-${++termSeq}`;
      if (options.terminal?.external) return ok({ id, external: true });
      terminals.set(id, { program: req.program, ...(req.prompt ? { prompt: req.prompt } : {}), written: '', alive: true });
      queueMicrotask(() => termEmit(id, { type: 'data', data: req.program === 'claude' ? 'Claude Code (simulado)\r\n> ' : '$ ' }));
      return ok({ id, external: false });
    },
    async terminalWrite({ id, data }) {
      const t = terminals.get(id);
      if (!t?.alive) return ok(false);
      t.written += data;
      return ok(true);
    },
    async terminalResize({ id }) {
      return ok(terminals.get(id)?.alive === true);
    },
    async terminalKill(id) {
      const t = terminals.get(id);
      if (!t?.alive) return ok(false);
      t.alive = false;
      termEmit(id, { type: 'exit', code: 0 });
      return ok(true);
    },
    onTerminalEvents(listener) {
      terminalListeners.add(listener);
      return () => void terminalListeners.delete(listener);
    },
    createProject: () => ((open = true), res({ name: 'Proyecto de prueba' })),
    openProject: () => ((open = true), res({ name: 'Proyecto de prueba' })),
    async listRecent() {
      return ok(recent.map((r) => ({ ...r })));
    },
    async openRecent({ id }) {
      const r = recent.find((x) => x.id === id);
      if (!r) return fail('not-found', 'Ese proyecto ya no está en la lista');
      if (r.missing) return fail('not-found', 'La carpeta del proyecto ya no existe o no es un proyecto. Puedes quitarlo de la lista.');
      open = true;
      return ok({ name: r.name });
    },
    async forgetRecent(id) {
      const before = recent.length;
      recent = recent.filter((r) => r.id !== id);
      return ok(recent.length !== before);
    },
    async closeProject() {
      open = false;
      return ok(null);
    },
    async listDiagrams() {
      if (!open) return fail('no-project', 'No hay proyecto abierto');
      const list: DiagramSummary[] = [...saved.values()].map((d) => ({ id: d.id, name: d.name }));
      return ok(list);
    },
    async loadDiagram(id) {
      const d = saved.get(id);
      return d ? ok(structuredClone(d)) : fail('not-found', 'No existe ese diagrama');
    },
    async saveDiagram(diagram) {
      saved.set(diagram.id, structuredClone(diagram));
      return ok(null);
    },
    async deleteDiagram(id) {
      if (!open) return fail('no-project', 'No hay proyecto abierto');
      return ok(saved.delete(id));
    },
    listExamples: () => res(exampleTemplates()),

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
    async listJobs() {
      return ok([...saved.values()].map((d) => ({ id: d.id, name: d.name, steps: stepCount(d), problems: validateDiagram(d).length })));
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
          status: end && end.type === 'run.finished' ? end.status : 'running',
          ...(end && end.type === 'run.finished' && end.reason !== undefined ? { reason: end.reason } : {}),
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
    async listAgents() {
      return ok([...agents.values()].map((a) => structuredClone(a)));
    },
    async saveAgent(agent) {
      const problems = validateAgent(agent, { contextIds: new Set(contexts.keys()), skillIds: new Set(skills.keys()), mcpIds: new Set(mcp.keys()) });
      if (problems.length > 0) return invalid(problems);
      agents.set(agent.id, structuredClone({ ...agent, name: agent.name.trim() }));
      return ok(null);
    },
    async deleteAgent(id) {
      return ok(agents.delete(id));
    },
    async agentUsage(id) {
      return ok([...saved.values()].filter((d) => usesAgent(d, id)).map((d) => ({ diagramId: d.id, name: d.name })));
    },
    async listSkills() {
      return ok([...skills.values()].map((k) => structuredClone(k)));
    },
    async saveSkill(skill) {
      const problems = validateSkill(skill);
      if (problems.length > 0) return invalid(problems);
      skills.set(skill.id, structuredClone({ ...skill, name: skill.name.trim(), description: skill.description.trim() }));
      return ok(null);
    },
    async deleteSkill(id) {
      for (const a of withoutSkill([...agents.values()], id)) agents.set(a.id, a);
      return ok(skills.delete(id));
    },
    async skillUsage(id) {
      return ok([...agents.values()].filter((a) => a.skillIds.includes(id)).map((a) => ({ agentId: a.id, name: a.name })));
    },
    async skillFiles(id) {
      return skills.has(id) ? ok(listFiles(id)) : fail('not-found', `No existe la skill ${id}`);
    },
    async addSkillFiles({ id }) {
      if (!skills.has(id)) return fail('not-found', `No existe la skill ${id}`);
      if (!options.pickedFiles) return ok(null);
      const plan = planSkillFiles(listFiles(id), options.pickedFiles.files);
      if (!plan.ok) return fail('invalid', plan.message);
      for (const f of plan.add) filesOf(id).set(f.path, f.data);
      return ok({ added: plan.add.map((f) => ({ path: f.path, size: f.data.length })), scripts: plan.scripts, renamed: plan.renamed });
    },
    async addContextFiles({ id }) {
      const pick = options.contextPick ?? { value: `.orquestador/context-files/${id}/archivos`, files: 3, bytes: 4200, renamed: 0, scripts: [] };
      return ok(pick === 'cancel' ? null : structuredClone(pick));
    },
    async removeSkillFile({ id, path }) {
      if (path === 'SKILL.md' || path.includes('..')) return fail('outside-root', 'Ruta de archivo no válida en la skill');
      return ok(filesOf(id).delete(path));
    },
    async saveSkillFile({ id, path, text }) {
      if (path === 'SKILL.md' || path.includes('..')) return fail('outside-root', 'Ruta de archivo no válida en la skill');
      if (!skills.has(id)) return fail('not-found', `No existe la skill ${id}`);
      const old = filesOf(id).get(path);
      if (old && old.subarray(0, 8000).includes(0)) return fail('invalid', 'Ese archivo no es de texto y no se puede editar aquí');
      filesOf(id).set(path, new TextEncoder().encode(text));
      return ok(null);
    },
    async readSkillFile({ id, path }) {
      const d = filesOf(id).get(path);
      if (!d) return fail('not-found', 'No existe ese archivo');
      if (d.subarray(0, 8000).includes(0)) return fail('invalid', 'Este archivo no es de texto y no se puede mostrar');
      const text = new TextDecoder().decode(d);
      return ok(text.length > 200_000 ? { text: text.slice(0, 200_000), truncated: true } : { text, truncated: false });
    },
    async inspectImport() {
      pending = undefined;
      if (!options.importTree) return ok(null);
      const plan = analyzeImport(options.importTree, { agentIds: new Set(agents.keys()), skillIds: new Set(skills.keys()) });
      pending = { id: `import-${++importCount}`, plan };
      return ok({ importId: pending.id, report: plan.report });
    },
    async confirmImport({ importId, keys }) {
      if (!pending || pending.id !== importId) return fail('not-found', 'Esa importación ya no está disponible; vuelve a elegir el paquete');
      const { plan } = pending;
      pending = undefined;
      return ok(
        await installImport(
          {
            listAgents: async () => [...agents.values()],
            listSkillIds: async () => [...skills.keys()],
            saveSkill: async (k) => void skills.set(k.id, structuredClone(k)),
            writeSkillFile: async (id, rel, data) => void filesOf(id).set(rel, data),
            deleteSkill: async (id) => skills.delete(id),
            saveAgent: async (a) => void agents.set(a.id, structuredClone(a)),
          },
          plan,
          keys,
        ),
      );
    },
    async cancelImport(importId) {
      if (pending?.id === importId) pending = undefined;
      return ok(null);
    },
    async getLibraryFolders() {
      return ok(structuredClone(folders));
    },
    async saveLibraryFolders(next) {
      const problem = validateLibraryFolders(next);
      if (problem) return fail('invalid', problem);
      folders = tidyLibraryFolders(next);
      return ok(structuredClone(folders));
    },
    async listContexts() {
      return ok([...contexts.values()].map((c) => structuredClone(c)));
    },
    async saveContext(context) {
      const problems = validateContext(context);
      if (problems.length > 0) return invalid(problems);
      contexts.set(context.id, structuredClone({ ...context, name: context.name.trim() }));
      return ok(null);
    },
    async deleteContext(id) {
      for (const a of withoutContext([...agents.values()], id)) agents.set(a.id, a);
      return ok(contexts.delete(id));
    },
    async contextUsage(id) {
      return ok([...agents.values()].filter((a) => a.contextIds.includes(id)).map((a) => ({ agentId: a.id, name: a.name })));
    },
    async listMcp() {
      if (!open) return fail('no-project', 'No hay proyecto abierto');
      return ok([...mcp.values()].map((m) => ({ ...structuredClone(m), scope: m.scope ?? 'project', secretsSet: Object.keys(mcpSecrets.get(m.id) ?? {}).sort() })));
    },
    async saveMcp(server) {
      const problems = validateMcpServer(server);
      if (problems.length > 0) return invalid(problems);
      mcp.set(server.id, structuredClone({ ...server, name: server.name.trim() }));
      return ok(null);
    },
    async deleteMcp(id) {
      for (const a of agents.values()) if ((a.mcpIds ?? []).includes(id)) a.mcpIds = (a.mcpIds ?? []).filter((x) => x !== id);
      mcpSecrets.delete(id);
      return ok(mcp.delete(id));
    },
    async mcpUsage(id) {
      return ok([...agents.values()].filter((a) => (a.mcpIds ?? []).includes(id)).map((a) => ({ agentId: a.id, name: a.name })));
    },
    async setMcpSecret({ id, name, value }) {
      if (!mcp.has(id)) return fail('not-found', 'No existe ese servidor MCP');
      mcpSecrets.set(id, { ...(mcpSecrets.get(id) ?? {}), [name]: value });
      return ok(null);
    },
    async clearMcpSecret({ id, name }) {
      const cur = { ...(mcpSecrets.get(id) ?? {}) };
      delete cur[name];
      mcpSecrets.set(id, cur);
      return ok(null);
    },
    async testMcp(id) {
      const m = mcp.get(id);
      if (!m) return fail('not-found', 'No existe ese servidor MCP');
      const t = options.mcpTest;
      if (typeof t === 'function') return ok(t(id));
      return ok(t ?? { ok: true, message: `«${m.name}» responde (simulado).`, tools: ['buscar', 'leer'], ms: 40 });
    },
    async getSettings() {
      return ok(view());
    },
    async testConnection() {
      return ok(options.connection ?? { ok: true, message: 'Claude responde correctamente.', model: settings.defaultModel, ms: 120 });
    },
    async draftWithClaude(req) {
      const d = options.draft;
      if (typeof d === 'function') return d(req);
      if (d) return ok(structuredClone(d));
      const fields: Record<string, unknown> =
        req.kind === 'agent'
          ? { name: 'Revisor', description: req.instruction.slice(0, 120), instructions: `# Objetivo\n${req.instruction}`, model: settings.defaultModel, contextIds: [], skillIds: [] }
          : req.kind === 'skill'
            ? { name: 'Guía de estilo', description: req.instruction.slice(0, 120), body: `# Pasos\n${req.instruction}` }
            : { name: 'Glosario', value: `# Glosario\n${req.instruction}` };
      return ok({ fields, problems: [], ms: 90 });
    },
    async saveSettings(next) {
      const problems = validateSettings(next);
      if (problems.length > 0) return invalid(problems);
      settings = normalizeSettings(next);
      return ok(view());
    },
    async getWorkFolder() {
      if (!open) return fail('not-found', 'Abre un proyecto');
      return ok(workFolder ? { ...workFolder } : null);
    },
    async pickWorkFolder() {
      if (!options.workFolderPick) return ok(null);
      workFolder = { ...options.workFolderPick };
      return ok({ ...workFolder });
    },
    async inspectWorkFolder() {
      if (!workFolder) return fail('not-found', 'Elige primero la carpeta del proyecto');
      const tree = options.workFolderTree ?? { files: [], summary: `${workFolder.name}/`, docs: [] };
      const plan = analyzeImport({ files: tree.files }, { agentIds: new Set(agents.keys()), skillIds: new Set(skills.keys()) });
      pending = { id: `import-${++importCount}`, plan };
      return ok({ importId: pending.id, report: plan.report, folder: { ...workFolder }, summary: tree.summary, docs: tree.docs.map((d) => ({ ...d })) });
    },
    async clearWorkFolder() {
      workFolder = null;
      return ok(null);
    },
    async listBackups(runId) {
      return ok(Object.keys(options.backups?.[runId] ?? {}).sort());
    },
    async restoreBackup(req) {
      const has = options.backups?.[req.runId]?.[req.path] !== undefined;
      if (has) restored.push(`${req.runId}:${req.path}`);
      return ok(has);
    },
    async setApiKey(key) {
      const field = (message: string) => fail('invalid', message, [{ field: 'apiKey', message }]);
      if (key.length === 0) return field('Escribe la clave');
      if (/\s/.test(key)) return field('La clave no puede llevar espacios');
      if (key.length > 500) return field('La clave es demasiado larga (máximo 500)');
      if (options.noEncryption) return fail('unavailable', 'Este sistema no ofrece almacenamiento cifrado: la clave no se guarda');
      keyStored = true;
      return ok(view());
    },
    async clearApiKey() {
      keyStored = false;
      return ok(view());
    },
    onRunEvents(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    async assistantSend({ turnId, messages }) {
      if (!open) return fail('not-found', 'Abre un proyecto para usar el asistente');
      assistantTurns.push(structuredClone(messages));
      const steps = options.assistant?.(messages) ?? [{ text: 'Estoy en modo simulado. Para que pueda crear agentes, skills y diagramas por ti, elige el motor «Claude» en Ajustes.' }];
      const turn = { cancelled: false, pending: new Map<string, (r: { ok: boolean; result: unknown }) => void>() };
      turns.set(turnId, turn);
      const emit = (e: AssistantEvent) => queueMicrotask(() => assistantListeners.forEach((l) => l(turnId, e)));
      void (async () => {
        let text = '';
        let n = 0;
        for (const step of steps) {
          if (turn.cancelled) break;
          if ('text' in step) {
            text += step.text;
            emit({ type: 'text', text: step.text });
          } else if ('read' in step) {
            emit({ type: 'read', tool: step.read, target: step.target, ok: step.ok ?? true });
          } else {
            const callId = `${turnId}-c${++n}`;
            callNames.set(callId, step.tool);
            const done = new Promise<{ ok: boolean; result: unknown }>((resolve) => turn.pending.set(callId, resolve));
            emit({ type: 'tool', callId, name: step.tool, args: step.args });
            await done;
          }
          await new Promise((r) => setTimeout(r, 0));
        }
        turns.delete(turnId);
        emit(turn.cancelled ? { type: 'error', message: 'Detenido.' } : { type: 'done', text });
      })();
      return ok(null);
    },
    async assistantToolResult({ turnId, callId, ok: good, result }) {
      const r = turns.get(turnId)?.pending.get(callId);
      if (!r) return ok(false);
      assistantResults.push({ name: callNames.get(callId) ?? '?', ok: good, result: structuredClone(result) });
      r({ ok: good, result });
      return ok(true);
    },
    async assistantCancel(turnId) {
      const turn = turns.get(turnId);
      if (!turn) return ok(false);
      turn.cancelled = true;
      for (const r of turn.pending.values()) r({ ok: false, result: 'Detenido.' });
      return ok(true);
    },
    onAssistantEvents(listener) {
      assistantListeners.add(listener);
      return () => void assistantListeners.delete(listener);
    },
  };
  // Cada llamada pasa por el mismo contrato que el IPC real: lo que el renderer no podría enviar en la app tampoco funciona aquí.
  const checked: Record<string, unknown> = { ...impl };
  for (const [name, channel] of Object.entries(CHANNELS)) {
    const fn = (impl as unknown as Record<string, unknown>)[name];
    if (typeof fn !== 'function') continue;
    checked[name] = (arg: unknown) => {
      try {
        parseRequest(channel, arg);
      } catch (e) {
        if (e instanceof ContractError) return Promise.resolve(fail('invalid', e.message));
        throw e;
      }
      return (fn as (a: unknown) => unknown)(arg);
    };
  }
  return checked as unknown as MemoryApi;
}
