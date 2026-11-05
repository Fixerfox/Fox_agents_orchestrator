import { SECRET_NAME, deliverableProblems, isRelativeInside } from '@orquestador/core';
import type {
  DeliverableSpec,
  McpServerDefinition,
  AgentDefinition,
  AppSettings,
  ContextDefinition,
  Diagram,
  Id,
  ImportReport,
  ImportResult,
  PendingQuestion,
  RecentView,
  RunEvent,
  SkillDefinition,
  LibraryFolders,
} from '@orquestador/core';
import type { ExampleTemplate } from './templates';
import { ASSISTANT_MAX_MESSAGES, ASSISTANT_MAX_TEXT, type AssistantEvent, type AssistantMessage } from './assistant';

/** Resultado uniforme de toda operación IPC: nunca lanza hacia el renderer ni filtra trazas. */
export interface ApiError {
  code: string;
  message: string;
  /** Campos con problemas de validación, para mostrarlos junto al campo [R22.5]. */
  fields?: { field: string; message: string }[];
}
export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: ApiError };

/** Ajustes tal como los ve el renderer: la clave API nunca viaja, solo si existe [R23.3]. */
export type ImportKind = 'folder' | 'zip';

/** Resultado de «Probar conexión» [R27.12]. */
export interface ConnectionResult {
  ok: boolean;
  message: string;
  model: string;
  ms: number;
}

export interface SettingsView extends AppSettings {
  apiKeyStored: boolean;
}

export interface ProjectInfo {
  name: string;
}
export interface DiagramSummary {
  id: Id;
  name: string;
}

export interface StartRunRequest {
  diagramId: Id;
  order: string;
  maxTokens?: number;
  maxCostUsd?: number;
  /** Entregable solo para esta ejecución; `null` lo quita [R46.12]. */
  deliverable?: DeliverableSpec | null;
  /** Archivos del proyecto para la entrada, relativos a la carpeta de trabajo [R48.6]. */
  files?: string[];
  /** Adjuntos preparados con `stageAttachment` o `pickAttachments` [R48.6]. */
  attachments?: string[];
  /** Si ya hay otra de este diagrama en marcha: a la vez (por defecto) o en cola [R52.3]. */
  whenBusy?: 'parallel' | 'queue';
}

/** Lo que devuelve lanzar: la ejecución, o el lanzamiento en cola [R52.4]. */
export type StartRunResult = { runId: string; queuedId?: undefined } | { queuedId: string; runId?: undefined };

/** Un lanzamiento en la cola de su diagrama [R52.3]. */
export interface QueuedRunView {
  queuedId: string;
  diagramId: Id;
  diagramName: string;
  order: string;
  /** ISO 8601. */
  at: string;
}

/** Un diagrama listo para lanzar, para la pantalla Trabajos [R52.4]. */
export interface JobInfo {
  id: Id;
  name: string;
  /** Nodos que no son entrada ni salida, también dentro de bucles. */
  steps: number;
  /** Problemas de validación: con alguno no se puede lanzar. */
  problems: number;
}

/** Adjunto de la entrada ya guardado en el proyecto; nunca lleva rutas absolutas [R48.6]. */
export interface InputAttachment {
  id: string;
  name: string;
  size: number;
  image: boolean;
}
/** Archivo del proyecto elegido para la entrada [R48.6]. */
export interface InputProjectFile {
  path: string;
  size: number;
  image: boolean;
}
/** Límites de la entrada [R48.3]. */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_INPUT_FILES = 20;
export type RunAction = 'pause' | 'resume' | 'cancel';
export interface RunSummary {
  runId: string;
  diagramId: string;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
  reason?: string;
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
  eventCount: number;
  order?: string;
  /** Nombre del diagrama al ejecutarse (R35.16). */
  diagramName?: string;
  /** Ejecución que esta reanuda, y la que la reanudó [R41.2]. */
  resumedFrom?: string;
  resumedBy?: string;
  /** Ejecución que esta corrige, y las que la corrigieron [R53.14]. */
  correctedFrom?: string;
  correctedBy?: string[];
}
/** Vista previa de un archivo que hizo un paso [R54.4]. */
export interface FilePreview {
  path: string;
  kind: 'image' | 'html' | 'markdown' | 'text' | 'other' | 'missing';
  source?: 'run' | 'previous' | 'live';
  fromRunId?: string;
  dataUrl?: string;
  url?: string;
  srcdoc?: string;
  text?: string;
  truncated?: boolean;
  size?: number;
}

/** Propuesta para corregir una ejecución [R53.10]. */
export interface CorrectionProposal {
  candidates: { nodeId: string; label: string }[];
  proposal: { nodeId: string; reason: string };
}

export interface OutputFileInfo {
  path: string;
  size: number;
}

/** Un fichero que tocó una ejecución, para el visor: lo de ahora y la copia de antes [R45.11]. */
export interface RunFileContent {
  path: string;
  missing: boolean;
  binary: boolean;
  current?: { text: string; truncated: boolean };
  before?: { text: string; truncated: boolean };
}

/** API que el renderer ve como `window.orquestador`. Solo ids, nunca rutas. */
export interface ProjectApi {
  /** Diálogo del sistema; `null` si el usuario cancela. */
  createProject(): Promise<ApiResult<ProjectInfo | null>>;
  openProject(): Promise<ApiResult<ProjectInfo | null>>;
  /** Proyectos abiertos antes, el más reciente primero; sin rutas absolutas [R28.3]. */
  listRecent(): Promise<ApiResult<RecentView[]>>;
  /** Abre un reciente por su id; falla con claridad si la carpeta ya no existe [R28.3]. */
  openRecent(request: { id: string }): Promise<ApiResult<ProjectInfo>>;
  /** Quita un reciente de la lista sin tocar el disco [R28.4]. */
  forgetRecent(id: string): Promise<ApiResult<boolean>>;
  /** Cierra el proyecto abierto [R28.7]. */
  closeProject(): Promise<ApiResult<null>>;
  listDiagrams(): Promise<ApiResult<DiagramSummary[]>>;
  loadDiagram(id: Id): Promise<ApiResult<Diagram>>;
  saveDiagram(diagram: Diagram): Promise<ApiResult<null>>;
  /** Borra un diagrama del proyecto; `false` si no existía [R32.38]. */
  deleteDiagram(id: Id): Promise<ApiResult<boolean>>;
  listExamples(): Promise<ApiResult<ExampleTemplate[]>>;
  // --- ejecución (R19.7) ---
  startRun(req: StartRunRequest): Promise<ApiResult<StartRunResult>>;
  /** Cola de lanzamientos y quitar uno [R52.3]. */
  listQueue(): Promise<ApiResult<QueuedRunView[]>>;
  unqueue(queuedId: string): Promise<ApiResult<boolean>>;
  /** Diagramas del proyecto con sus pasos y problemas [R52.4]. */
  listJobs(): Promise<ApiResult<JobInfo[]>>;
  controlRun(req: { runId: string; action: RunAction }): Promise<ApiResult<null>>;
  /** Reanuda una ejecución interrumpida, fallida o cancelada en otra nueva que reutiliza lo hecho [R41.2]. */
  resumeRun(runId: string): Promise<ApiResult<{ runId: string }>>;
  /** Cierra como cancelada una ejecución interrumpida [R41.3]. */
  dismissRun(runId: string): Promise<ApiResult<boolean>>;
  /** Pasos que se pueden corregir de una ejecución que no está en marcha y cuál propone el asistente [R53.12]. */
  proposeCorrection(req: { runId: string; text: string; prefer?: string }): Promise<ApiResult<CorrectionProposal>>;
  /** Vista previa de un archivo que hizo el paso `key` (`ruta/id`) en una ejecución [R54.4]. */
  previewFile(req: { runId: string; key: string; path: string }): Promise<ApiResult<FilePreview>>;
  /** Abre fuera de la app (con el programa del sistema) la copia que se previsualiza [R54.5]. */
  openPreview(req: { runId: string; key: string; path: string }): Promise<ApiResult<boolean>>;
  /** Corrige una ejecución en otra nueva desde el paso elegido [R53.12]. */
  correctRun(req: { runId: string; text: string; nodeId: string; files?: string[]; attachments?: string[] }): Promise<ApiResult<{ runId: string }>>;
  answerRun(req: { runId: string; questionId: string; text: string }): Promise<ApiResult<boolean>>;
  /** Devuelve el historial desde `fromSeq` y empieza a enviar los eventos en vivo a `onRunEvents`. */
  subscribeRun(req: { runId: string; fromSeq: number }): Promise<ApiResult<RunEvent[]>>;
  unsubscribeRun(runId: string): Promise<ApiResult<null>>;
  listRuns(): Promise<ApiResult<RunSummary[]>>;
  pendingQuestions(runId: string): Promise<ApiResult<PendingQuestion[]>>;
  /** Diagrama tal como estaba al arrancar la ejecución; `null` si es anterior y no se guardó (R35.16). */
  runDiagram(runId: string): Promise<ApiResult<Diagram | null>>;
  listOutput(runId: string): Promise<ApiResult<OutputFileInfo[]>>;
  readOutput(req: { runId: string; path: string }): Promise<ApiResult<{ text: string; truncated: boolean }>>;
  /** Un fichero que tocó la ejecución, con su copia previa; solo los que registró [R45.11]. */
  readRunFile(req: { runId: string; path: string }): Promise<ApiResult<RunFileContent>>;
  // --- skills e instalación (SPEC-024, SPEC-025) ---
  listSkills(): Promise<ApiResult<SkillDefinition[]>>;
  saveSkill(skill: SkillDefinition): Promise<ApiResult<null>>;
  deleteSkill(id: Id): Promise<ApiResult<boolean>>;
  skillUsage(id: Id): Promise<ApiResult<{ agentId: Id; name: string }[]>>;
  skillFiles(id: Id): Promise<ApiResult<{ path: string; size: number }[]>>;
  /** Abre el diálogo del sistema y copia los archivos o la carpeta elegidos a la skill; `null` si se cancela [R24.9]. */
  addSkillFiles(req: { id: Id; kind: 'files' | 'folder' }): Promise<ApiResult<{ added: { path: string; size: number }[]; scripts: string[]; renamed: number } | null>>;
  /** Abre el diálogo del sistema y copia archivos o una carpeta al contexto; devuelve la ruta a guardar, o `null` si se cancela [R22.14]. */
  addContextFiles(req: { id: Id; kind: 'files' | 'folder' }): Promise<ApiResult<{ value: string; files: number; bytes: number; renamed: number; scripts: string[] } | null>>;
  removeSkillFile(req: { id: Id; path: string }): Promise<ApiResult<boolean>>;
  readSkillFile(req: { id: Id; path: string }): Promise<ApiResult<{ text: string; truncated: boolean }>>;
  /** Crea o reescribe un archivo de texto de la skill (no `SKILL.md`) [R32.35]. */
  saveSkillFile(req: { id: Id; path: string; text: string }): Promise<ApiResult<null>>;
  /** Abre el diálogo del sistema y analiza el paquete; `null` si se cancela. No instala nada. */
  inspectImport(kind: ImportKind): Promise<ApiResult<{ importId: string; report: ImportReport } | null>>;
  confirmImport(req: { importId: string; keys: string[] }): Promise<ApiResult<ImportResult>>;
  cancelImport(importId: string): Promise<ApiResult<null>>;
  // --- agentes, contextos y ajustes (SPEC-022, SPEC-023) ---
  listAgents(): Promise<ApiResult<AgentDefinition[]>>;
  saveAgent(agent: AgentDefinition): Promise<ApiResult<null>>;
  deleteAgent(id: Id): Promise<ApiResult<boolean>>;
  agentUsage(id: Id): Promise<ApiResult<{ diagramId: Id; name: string }[]>>;
  listContexts(): Promise<ApiResult<ContextDefinition[]>>;
  /** Carpetas de agentes, skills, contextos y MCP del proyecto [R38.13]. */
  getLibraryFolders(): Promise<ApiResult<LibraryFolders>>;
  /** Guarda el documento entero de carpetas y devuelve cómo ha quedado [R38.13]. */
  saveLibraryFolders(folders: LibraryFolders): Promise<ApiResult<LibraryFolders>>;
  saveContext(context: ContextDefinition): Promise<ApiResult<null>>;
  deleteContext(id: Id): Promise<ApiResult<boolean>>;
  contextUsage(id: Id): Promise<ApiResult<{ agentId: Id; name: string }[]>>;
  /** Servidores MCP del proyecto, con los nombres de secreto que ya tienen valor (nunca los valores) [R30.1]. */
  listMcp(): Promise<ApiResult<McpView[]>>;
  saveMcp(server: McpServerDefinition): Promise<ApiResult<null>>;
  deleteMcp(id: Id): Promise<ApiResult<boolean>>;
  mcpUsage(id: Id): Promise<ApiResult<{ agentId: Id; name: string }[]>>;
  /** Guarda cifrado el valor de un secreto; el valor nunca vuelve a la interfaz [R30.8]. */
  setMcpSecret(req: { id: Id; name: string; value: string }): Promise<ApiResult<null>>;
  clearMcpSecret(req: { id: Id; name: string }): Promise<ApiResult<null>>;
  /** Arranca el servidor y lista sus herramientas sin gastar tokens [R30.5]. */
  testMcp(id: Id): Promise<ApiResult<McpTestResult>>;
  getSettings(): Promise<ApiResult<SettingsView>>;
  saveSettings(settings: AppSettings): Promise<ApiResult<SettingsView>>;
  /** Consulta mínima a Claude con los ajustes guardados [R27.12]. */
  testConnection(): Promise<ApiResult<ConnectionResult>>;
  /** Pide a Claude que redacte o mejore un agente o una skill; no guarda nada [R26.1][R26.2]. */
  draftWithClaude(req: DraftRequest): Promise<ApiResult<DraftResult>>;
  // --- carpeta de trabajo y copias (SPEC-031) ---
  /** Carpeta de trabajo del proyecto: solo nombre y número de archivos, nunca la ruta [R31.1]. */
  getWorkFolder(): Promise<ApiResult<WorkFolderView | null>>;
  /** Abre el diálogo del sistema y guarda la carpeta elegida; `null` si se cancela [R31.1]. */
  pickWorkFolder(): Promise<ApiResult<WorkFolderView | null>>;
  /** Guarda un archivo arrastrado o pegado en la Entrada (bytes, nunca rutas) [R48.6]. */
  stageAttachment(req: { name: string; data: Uint8Array }): Promise<ApiResult<InputAttachment>>;
  /** Diálogo del sistema para adjuntar archivos de fuera [R48.6]. */
  pickAttachments(): Promise<ApiResult<InputAttachment[] | null>>;
  /** Diálogo del sistema en la carpeta de trabajo: rutas relativas [R48.6]. */
  pickProjectFiles(): Promise<ApiResult<InputProjectFile[] | null>>;
  clearWorkFolder(): Promise<ApiResult<null>>;
  /**
   * Analiza la carpeta de trabajo: agentes y skills de `.claude/`, MCP de `.mcp.json`, resumen del proyecto y
   * documentos guía (CLAUDE.md, TRABAJO.md, AGENTS.md). No instala nada; se confirma con `confirmImport` [R32.16].
   */
  inspectWorkFolder(): Promise<ApiResult<WorkFolderInspection>>;
  /** Archivos que los agentes modificaron en una ejecución y de los que hay copia [R31.6]. */
  listBackups(runId: Id): Promise<ApiResult<string[]>>;
  /** Devuelve un archivo de la carpeta de trabajo a como estaba antes de la ejecución [R31.6]. */
  restoreBackup(req: { runId: Id; path: string }): Promise<ApiResult<boolean>>;
  setApiKey(key: string): Promise<ApiResult<SettingsView>>;
  clearApiKey(): Promise<ApiResult<SettingsView>>;
  /** Eventos en vivo (por lotes). Devuelve la función para darse de baja. */
  onRunEvents(listener: (runId: string, events: RunEvent[]) => void): () => void;
  /** Asistente: lanza un turno con la conversación reciente; las respuestas llegan por `onAssistantEvents` [R29.4]. */
  assistantSend(req: { turnId: string; messages: AssistantMessage[] }): Promise<ApiResult<null>>;
  /** Resultado de una herramienta que ejecutó la interfaz [R29.2]. */
  assistantToolResult(req: { turnId: string; callId: string; ok: boolean; result: unknown }): Promise<ApiResult<boolean>>;
  assistantCancel(turnId: string): Promise<ApiResult<boolean>>;
  onAssistantEvents(listener: (turnId: string, event: AssistantEvent) => void): () => void;
  // --- terminal integrada (SPEC-030, M8d) ---
  /**
   * Abre una terminal con `claude` (y una petición opcional) o la consola del sistema, en la carpeta del proyecto.
   * La interfaz solo elige el programa: nunca rutas ni comandos libres. `external` si se abrió la del sistema [R30.13][R30.14].
   */
  terminalStart(req: TerminalStartRequest): Promise<ApiResult<{ id: string; external: boolean }>>;
  terminalWrite(req: { id: string; data: string }): Promise<ApiResult<boolean>>;
  terminalResize(req: { id: string; cols: number; rows: number }): Promise<ApiResult<boolean>>;
  terminalKill(id: string): Promise<ApiResult<boolean>>;
  onTerminalEvents(listener: (id: string, event: TerminalEvent) => void): () => void;
}

/** Programas que puede abrir la terminal integrada [R30.13]. */
export type TerminalProgram = 'claude' | 'shell';
export interface TerminalStartRequest {
  program: TerminalProgram;
  /** Petición inicial para `claude`. */
  prompt?: string;
  cols: number;
  rows: number;
}
export type TerminalEvent = { type: 'data'; data: string } | { type: 'exit'; code: number };
/** Canal por el que el proceso principal empuja la salida de las terminales. */
export const TERMINAL_EVENTS_CHANNEL = 'terminal:events';
/** Límites de la terminal [R30.13]. */
export const TERMINAL_LIMITS = { max: 3, prompt: 4_000, write: 65_536, cols: 500, rows: 200 } as const;

export interface DraftRequest {
  kind: 'agent' | 'skill' | 'context';
  /** Lo que el usuario quiere, con sus palabras. */
  instruction: string;
  /** Borrador actual del formulario, si se quiere mejorar [R26.3]. */
  current?: Record<string, unknown>;
}

export interface DraftResult {
  fields: Record<string, unknown>;
  problems: { field: string; message: string }[];
  ms: number;
}

/** Resultado de analizar la carpeta del proyecto [R32.16]. */
export interface WorkFolderInspection {
  importId: string;
  report: ImportReport;
  folder: WorkFolderView;
  /** Resumen de la carpeta para los agentes (árbol y comienzo de los documentos). */
  summary: string;
  /** Documentos guía encontrados en la raíz, recortados. */
  docs: { name: string; text: string }[];
}

/** Lo único que la interfaz sabe de la carpeta de trabajo [R31.1]. */
export interface WorkFolderView {
  name: string;
  files: number;
}

/** Tamaño máximo de un archivo de texto de skill editado desde la interfaz [R32.35]. */
export const SKILL_FILE_MAX = 200_000;

/** Servidor MCP tal como lo ve la interfaz [R30.1]. */
export type McpView = McpServerDefinition & { secretsSet: string[] };
export interface McpTestResult {
  ok: boolean;
  message: string;
  tools: string[];
  ms: number;
}

export type InvokeMethod = Exclude<keyof ProjectApi, 'onRunEvents' | 'onAssistantEvents' | 'onTerminalEvents'>;

/** Contrato único de canales IPC (método → canal). */
export const CHANNELS = {
  createProject: 'project:create',
  openProject: 'project:open',
  listRecent: 'project:recent',
  openRecent: 'project:open-recent',
  forgetRecent: 'project:forget-recent',
  closeProject: 'project:close',
  listDiagrams: 'diagram:list',
  loadDiagram: 'diagram:load',
  saveDiagram: 'diagram:save',
  deleteDiagram: 'diagram:delete',
  listExamples: 'examples:list',
  startRun: 'run:start',
  controlRun: 'run:control',
  resumeRun: 'run:resume',
  dismissRun: 'run:dismiss',
  proposeCorrection: 'run:correct-propose',
  correctRun: 'run:correct',
  previewFile: 'run:preview',
  openPreview: 'run:preview-open',
  answerRun: 'run:answer',
  subscribeRun: 'run:subscribe',
  unsubscribeRun: 'run:unsubscribe',
  listRuns: 'run:list',
  listQueue: 'run:queue',
  unqueue: 'run:unqueue',
  listJobs: 'diagram:jobs',
  pendingQuestions: 'run:pending',
  runDiagram: 'run:diagram',
  listOutput: 'run:output-list',
  readOutput: 'run:output-read',
  readRunFile: 'run:file-read',
  listSkills: 'skill:list',
  saveSkill: 'skill:save',
  deleteSkill: 'skill:delete',
  skillUsage: 'skill:usage',
  skillFiles: 'skill:files',
  addSkillFiles: 'skill:add-files',
  addContextFiles: 'context:add-files',
  removeSkillFile: 'skill:remove-file',
  readSkillFile: 'skill:read-file',
  saveSkillFile: 'skill:save-file',
  inspectImport: 'import:inspect',
  confirmImport: 'import:confirm',
  cancelImport: 'import:cancel',
  listAgents: 'agent:list',
  saveAgent: 'agent:save',
  deleteAgent: 'agent:delete',
  agentUsage: 'agent:usage',
  listContexts: 'context:list',
  getLibraryFolders: 'library:get-folders',
  saveLibraryFolders: 'library:save-folders',
  saveContext: 'context:save',
  deleteContext: 'context:delete',
  contextUsage: 'context:usage',
  listMcp: 'mcp:list',
  saveMcp: 'mcp:save',
  deleteMcp: 'mcp:delete',
  mcpUsage: 'mcp:usage',
  setMcpSecret: 'mcp:set-secret',
  clearMcpSecret: 'mcp:clear-secret',
  testMcp: 'mcp:test',
  assistantSend: 'assistant:send',
  assistantToolResult: 'assistant:tool-result',
  assistantCancel: 'assistant:cancel',
  terminalStart: 'terminal:start',
  terminalWrite: 'terminal:write',
  terminalResize: 'terminal:resize',
  terminalKill: 'terminal:kill',
  getSettings: 'settings:get',
  saveSettings: 'settings:save',
  testConnection: 'settings:test-connection',
  draftWithClaude: 'ai:draft',
  getWorkFolder: 'workfolder:get',
  pickWorkFolder: 'workfolder:pick',
  stageAttachment: 'input:stage',
  pickAttachments: 'input:pick',
  pickProjectFiles: 'input:pick-project',
  clearWorkFolder: 'workfolder:clear',
  inspectWorkFolder: 'workfolder:inspect',
  listBackups: 'backup:list',
  restoreBackup: 'backup:restore',
  setApiKey: 'settings:set-key',
  clearApiKey: 'settings:clear-key',
} as const satisfies Record<InvokeMethod, string>;

/** Canal por el que el proceso principal empuja lotes de eventos al renderer. */
export const RUN_EVENTS_CHANNEL = 'run:events';

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS];

export class ContractError extends Error {
  readonly code = 'bad-request';
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const safeId = (v: unknown): v is string => typeof v === 'string' && SAFE_ID.test(v) && !v.includes('..');
function termSize(cols: unknown, rows: unknown, bad: (m: string) => Error): void {
  const okN = (n: unknown, max: number) => typeof n === 'number' && Number.isInteger(n) && n >= 2 && n <= max;
  if (!okN(cols, TERMINAL_LIMITS.cols) || !okN(rows, TERMINAL_LIMITS.rows)) throw bad('tamaño no válido');
}

/**
 * Valida la forma de la petición de un canal. Devuelve el argumento ya tipado
 * o lanza `ContractError`. Las rutas y campos extra se rechazan.
 */
export function parseRequest(channel: string, payload: unknown): unknown {
  const bad = (m: string) => new ContractError(`Petición no válida en ${channel}: ${m}`);
  const exact = (o: Record<string, unknown>, allowed: string[]) => {
    for (const k of Object.keys(o)) if (!allowed.includes(k)) throw bad(`campo no permitido «${k}»`);
  };
  const str = (v: unknown, name: string, max: number, min = 0): string => {
    if (typeof v !== 'string' || v.length < min || v.length > max) throw bad(`${name} no válido`);
    return v;
  };
  switch (channel) {
    case CHANNELS.createProject:
    case CHANNELS.openProject:
    case CHANNELS.listRecent:
    case CHANNELS.closeProject:
    case CHANNELS.listDiagrams:
    case CHANNELS.listExamples:
    case CHANNELS.listRuns:
    case CHANNELS.listQueue:
    case CHANNELS.listJobs:
    case CHANNELS.listAgents:
    case CHANNELS.listSkills:
    case CHANNELS.listContexts:
    case CHANNELS.getLibraryFolders:
    case CHANNELS.listMcp:
    case CHANNELS.testConnection:
    case CHANNELS.getWorkFolder:
    case CHANNELS.pickWorkFolder:
    case CHANNELS.pickAttachments:
    case CHANNELS.pickProjectFiles:
    case CHANNELS.clearWorkFolder:
    case CHANNELS.inspectWorkFolder:
    case CHANNELS.getSettings:
    case CHANNELS.clearApiKey:
      if (payload !== undefined && payload !== null) throw bad('no admite argumentos');
      return undefined;
    case CHANNELS.forgetRecent:
      if (!safeId(payload)) throw bad('id no válido');
      return payload;
    case CHANNELS.openRecent: {
      if (!isObject(payload)) throw bad('se esperaba un id');
      exact(payload, ['id']);
      if (!safeId(payload.id)) throw bad('id no válido');
      return payload;
    }
    case CHANNELS.draftWithClaude: {
      if (!isObject(payload)) throw bad('se esperaba una petición');
      exact(payload, ['kind', 'instruction', 'current']);
      if (payload.kind !== 'agent' && payload.kind !== 'skill' && payload.kind !== 'context') throw bad('kind no válido');
      str(payload.instruction, 'instruction', 4000, 1);
      if (payload.current !== undefined) {
        if (!isObject(payload.current)) throw bad('current no válido');
        const allowed = payload.kind === 'agent' ? ['name', 'description', 'instructions', 'model', 'contextIds', 'skillIds'] : payload.kind === 'skill' ? ['name', 'description', 'body'] : ['name', 'value'];
        exact(payload.current, allowed);
        for (const [k, v] of Object.entries(payload.current)) {
          if (Array.isArray(v)) {
            if (v.length > 200 || !v.every(safeId)) throw bad(`${k} no válido`);
          } else str(v, k, 200_000);
        }
      }
      return payload;
    }
    case CHANNELS.loadDiagram:
    case CHANNELS.deleteDiagram:
      if (!safeId(payload)) throw bad('id no válido');
      return payload;
    case CHANNELS.saveDiagram: {
      if (!isObject(payload)) throw bad('se esperaba un diagrama');
      if (!safeId(payload.id)) throw bad('id no válido');
      if (typeof payload.name !== 'string') throw bad('falta el nombre');
      if (typeof payload.schemaVersion !== 'number') throw bad('falta la versión');
      if (!Array.isArray(payload.nodes) || !Array.isArray(payload.edges)) throw bad('faltan nodos o aristas');
      return payload as unknown as Diagram;
    }
    case CHANNELS.startRun: {
      if (!isObject(payload)) throw bad('se esperaba un objeto');
      exact(payload, ['diagramId', 'order', 'maxTokens', 'maxCostUsd', 'deliverable', 'files', 'attachments', 'whenBusy']);
      if (payload.whenBusy !== undefined && payload.whenBusy !== 'parallel' && payload.whenBusy !== 'queue') throw bad('whenBusy no válido');
      // Archivos de la entrada: rutas relativas y adjuntos ya guardados [R48.6].
      const files = payload.files ?? [];
      const atts = payload.attachments ?? [];
      if (!Array.isArray(files) || !files.every((f) => typeof f === 'string' && f.length <= 500 && isRelativeInside(f))) throw bad('files no válido');
      if (!Array.isArray(atts) || !atts.every(safeId)) throw bad('attachments no válido');
      if (files.length + atts.length > MAX_INPUT_FILES) throw bad(`como mucho ${MAX_INPUT_FILES} archivos`);
      // El entregable de esta ejecución se comprueba igual que el del diagrama [R46.12].
      if (payload.deliverable !== undefined && payload.deliverable !== null) {
        const problems = deliverableProblems(payload.deliverable);
        if (problems.length > 0) throw bad(`entregable no válido: ${problems[0]!.message}`);
      }
      if (!safeId(payload.diagramId)) throw bad('diagramId no válido');
      str(payload.order, 'order', 20000, files.length + atts.length > 0 ? 0 : 1);
      if (payload.maxTokens !== undefined && !(Number.isInteger(payload.maxTokens) && (payload.maxTokens as number) > 0)) throw bad('maxTokens no válido');
      if (payload.maxCostUsd !== undefined && !(typeof payload.maxCostUsd === 'number' && payload.maxCostUsd > 0 && Number.isFinite(payload.maxCostUsd))) throw bad('maxCostUsd no válido');
      return payload as unknown as StartRunRequest;
    }
    case CHANNELS.stageAttachment: {
      if (!isObject(payload)) throw bad('se esperaba un objeto');
      exact(payload, ['name', 'data']);
      str(payload.name, 'name', 255, 1);
      if (!(payload.data instanceof Uint8Array) || payload.data.byteLength === 0 || payload.data.byteLength > MAX_ATTACHMENT_BYTES) throw bad('el archivo está vacío o supera los 20 MB');
      return payload;
    }
    case CHANNELS.resumeRun:
    case CHANNELS.dismissRun:
    case CHANNELS.unqueue:
      if (!safeId(payload)) throw bad('runId no válido');
      return payload;
    case CHANNELS.proposeCorrection: {
      if (!isObject(payload)) throw bad('se esperaba un objeto');
      exact(payload, ['runId', 'text', 'prefer']);
      if (!safeId(payload.runId)) throw bad('runId no válido');
      str(payload.text, 'text', 20_000);
      if (payload.prefer !== undefined && !safeId(payload.prefer)) throw bad('prefer no válido');
      return payload;
    }
    case CHANNELS.previewFile:
    case CHANNELS.openPreview: {
      if (!isObject(payload)) throw bad('se esperaba un objeto');
      exact(payload, ['runId', 'key', 'path']);
      if (!safeId(payload.runId)) throw bad('runId no válido');
      const key = str(payload.key, 'key', 1000, 1);
      if (!key.split('/').every(safeId)) throw bad('key no válida');
      const rel = str(payload.path, 'path', 1024, 1);
      if (rel.includes('\\') || rel.startsWith('/') || rel.split('/').some((s) => s === '' || s === '.' || s === '..')) throw bad('path no válido');
      return payload;
    }
    case CHANNELS.correctRun: {
      if (!isObject(payload)) throw bad('se esperaba un objeto');
      exact(payload, ['runId', 'text', 'nodeId', 'files', 'attachments']);
      if (!safeId(payload.runId)) throw bad('runId no válido');
      if (!safeId(payload.nodeId)) throw bad('nodeId no válido');
      str(payload.text, 'text', 20_000, 1);
      for (const k of ['files', 'attachments'] as const) {
        const v = payload[k];
        if (v !== undefined && (!Array.isArray(v) || v.length > 20 || !v.every((x) => typeof x === 'string' && x.length > 0 && x.length <= 1024))) throw bad(`${k} no válido`);
      }
      return payload;
    }
    case CHANNELS.controlRun: {
      if (!isObject(payload)) throw bad('se esperaba un objeto');
      exact(payload, ['runId', 'action']);
      if (!safeId(payload.runId)) throw bad('runId no válido');
      if (payload.action !== 'pause' && payload.action !== 'resume' && payload.action !== 'cancel') throw bad('acción no válida');
      return payload;
    }
    case CHANNELS.answerRun: {
      if (!isObject(payload)) throw bad('se esperaba un objeto');
      exact(payload, ['runId', 'questionId', 'text']);
      if (!safeId(payload.runId)) throw bad('runId no válido');
      str(payload.questionId, 'questionId', 200, 1);
      str(payload.text, 'text', 20000);
      return payload;
    }
    case CHANNELS.subscribeRun: {
      if (!isObject(payload)) throw bad('se esperaba un objeto');
      exact(payload, ['runId', 'fromSeq']);
      if (!safeId(payload.runId)) throw bad('runId no válido');
      if (!Number.isInteger(payload.fromSeq) || (payload.fromSeq as number) < 1) throw bad('fromSeq no válido');
      return payload;
    }
    case CHANNELS.unsubscribeRun:
    case CHANNELS.listBackups:
    case CHANNELS.pendingQuestions:
    case CHANNELS.runDiagram:
    case CHANNELS.listOutput:
      if (!safeId(payload)) throw bad('runId no válido');
      return payload;
    case CHANNELS.restoreBackup: {
      if (!isObject(payload)) throw bad('se esperaba un objeto');
      exact(payload, ['runId', 'path']);
      if (!safeId(payload.runId)) throw bad('runId no válido');
      str(payload.path, 'path', 500, 1);
      return payload;
    }
    case CHANNELS.readOutput:
    case CHANNELS.readRunFile: {
      if (!isObject(payload)) throw bad('se esperaba un objeto');
      exact(payload, ['runId', 'path']);
      if (!safeId(payload.runId)) throw bad('runId no válido');
      str(payload.path, 'path', 500, 1);
      return payload;
    }
    case CHANNELS.deleteAgent:
    case CHANNELS.agentUsage:
    case CHANNELS.deleteContext:
    case CHANNELS.contextUsage:
    case CHANNELS.deleteMcp:
    case CHANNELS.mcpUsage:
    case CHANNELS.testMcp:
    case CHANNELS.deleteSkill:
    case CHANNELS.skillUsage:
    case CHANNELS.skillFiles:
    case CHANNELS.cancelImport:
      if (!safeId(payload)) throw bad('id no válido');
      return payload;
    case CHANNELS.saveAgent: {
      if (!isObject(payload)) throw bad('se esperaba un agente');
      exact(payload, ['id', 'schemaVersion', 'name', 'description', 'instructions', 'model', 'contextIds', 'skillIds', 'mcpIds', 'maxTurns', 'askFirst', 'permissions', 'icon', 'tone', 'required']);
      if (!safeId(payload.id)) throw bad('id no válido');
      if (typeof payload.schemaVersion !== 'number') throw bad('falta la versión');
      str(payload.name, 'name', 1000);
      str(payload.description, 'description', 5000);
      str(payload.instructions, 'instructions', 200_000);
      str(payload.model, 'model', 200);
      if (!Array.isArray(payload.contextIds) || payload.contextIds.length > 200 || !payload.contextIds.every(safeId)) throw bad('contextIds no válido');
      if (payload.skillIds !== undefined && (!Array.isArray(payload.skillIds) || payload.skillIds.length > 200 || !payload.skillIds.every(safeId))) throw bad('skillIds no válido');
      if (payload.mcpIds !== undefined && (!Array.isArray(payload.mcpIds) || payload.mcpIds.length > 50 || !payload.mcpIds.every(safeId))) throw bad('mcpIds no válido');
      if (payload.maxTurns !== undefined && typeof payload.maxTurns !== 'number') throw bad('maxTurns no válido');
      if (payload.askFirst !== undefined && typeof payload.askFirst !== 'boolean') throw bad('askFirst no válido');
      if (payload.permissions !== undefined && !['readonly', 'ask', 'auto', 'full'].includes(payload.permissions as string)) throw bad('permissions no válido');
      if (payload.required !== undefined) {
        if (!isObject(payload.required)) throw bad('required no válido');
        exact(payload.required, ['skillIds', 'contextIds', 'mcpIds']);
        for (const v of Object.values(payload.required)) if (!Array.isArray(v) || v.length > 200 || !v.every(safeId)) throw bad('required no válido');
      }
      if (payload.icon !== undefined) str(payload.icon, 'icon', 40);
      if (payload.tone !== undefined) str(payload.tone, 'tone', 40);
      return payload as unknown as AgentDefinition;
    }
    case CHANNELS.saveMcp: {
      if (!isObject(payload)) throw bad('se esperaba un servidor MCP');
      exact(payload, ['id', 'schemaVersion', 'name', 'description', 'transport', 'command', 'args', 'url', 'secretNames', 'enabled', 'trusted', 'scope']);
      if (!safeId(payload.id)) throw bad('id no válido');
      if (typeof payload.schemaVersion !== 'number') throw bad('falta la versión');
      str(payload.name, 'name', 1000);
      str(payload.description, 'description', 5000, 0);
      if (payload.transport !== 'stdio' && payload.transport !== 'http') throw bad('transport no válido');
      if (payload.command !== undefined) str(payload.command, 'command', 2000, 0);
      if (payload.url !== undefined) str(payload.url, 'url', 4000, 0);
      if (payload.args !== undefined && (!Array.isArray(payload.args) || payload.args.length > 100 || payload.args.some((a) => typeof a !== 'string' || a.length > 2000))) throw bad('args no válido');
      if (payload.secretNames !== undefined && (!Array.isArray(payload.secretNames) || payload.secretNames.length > 50 || payload.secretNames.some((a) => typeof a !== 'string' || a.length > 100))) throw bad('secretNames no válido');
      if (typeof payload.enabled !== 'boolean') throw bad('enabled no válido');
      if (payload.trusted !== undefined && typeof payload.trusted !== 'boolean') throw bad('trusted no válido');
      if (payload.scope !== undefined && payload.scope !== 'project' && payload.scope !== 'app') throw bad('scope no válido');
      return payload as unknown as McpServerDefinition;
    }
    case CHANNELS.assistantSend: {
      if (!isObject(payload)) throw bad('se esperaba un objeto');
      exact(payload, ['turnId', 'messages']);
      if (!safeId(payload.turnId)) throw bad('turnId no válido');
      const msgs = payload.messages;
      if (!Array.isArray(msgs) || msgs.length === 0 || msgs.length > ASSISTANT_MAX_MESSAGES) throw bad('mensajes no válidos');
      for (const m of msgs) {
        if (!isObject(m) || (m.role !== 'user' && m.role !== 'assistant')) throw bad('mensaje no válido');
        str(m.text, 'text', ASSISTANT_MAX_TEXT, 0);
      }
      return payload;
    }
    case CHANNELS.assistantToolResult: {
      if (!isObject(payload)) throw bad('se esperaba un objeto');
      exact(payload, ['turnId', 'callId', 'ok', 'result']);
      if (!safeId(payload.turnId) || !safeId(payload.callId)) throw bad('id no válido');
      if (typeof payload.ok !== 'boolean') throw bad('ok no válido');
      if (JSON.stringify(payload.result ?? null).length > 200_000) throw bad('resultado demasiado grande');
      return payload;
    }
    case CHANNELS.assistantCancel:
      if (!safeId(payload)) throw bad('turnId no válido');
      return payload;
    case CHANNELS.terminalStart: {
      if (!isObject(payload)) throw bad('se esperaba un objeto');
      exact(payload, ['program', 'prompt', 'cols', 'rows']);
      if (payload.program !== 'claude' && payload.program !== 'shell') throw bad('programa no permitido');
      if (payload.prompt !== undefined) {
        str(payload.prompt, 'prompt', TERMINAL_LIMITS.prompt, 0);
        if (payload.program !== 'claude') throw bad('la consola no admite petición');
      }
      termSize(payload.cols, payload.rows, bad);
      return payload;
    }
    case CHANNELS.terminalWrite:
      if (!isObject(payload)) throw bad('se esperaba un objeto');
      exact(payload, ['id', 'data']);
      if (!safeId(payload.id)) throw bad('id no válido');
      str(payload.data, 'data', TERMINAL_LIMITS.write, 1);
      return payload;
    case CHANNELS.terminalResize:
      if (!isObject(payload)) throw bad('se esperaba un objeto');
      exact(payload, ['id', 'cols', 'rows']);
      if (!safeId(payload.id)) throw bad('id no válido');
      termSize(payload.cols, payload.rows, bad);
      return payload;
    case CHANNELS.terminalKill:
      if (!safeId(payload)) throw bad('id no válido');
      return payload;
    case CHANNELS.setMcpSecret:
    case CHANNELS.clearMcpSecret: {
      if (!isObject(payload)) throw bad('se esperaba un objeto');
      exact(payload, channel === CHANNELS.setMcpSecret ? ['id', 'name', 'value'] : ['id', 'name']);
      if (!safeId(payload.id)) throw bad('id no válido');
      if (typeof payload.name !== 'string' || !SECRET_NAME.test(payload.name)) throw bad('nombre de secreto no válido');
      if (channel === CHANNELS.setMcpSecret) str(payload.value, 'value', 4000, 1);
      return payload;
    }
    case CHANNELS.saveLibraryFolders: {
      if (!isObject(payload)) throw bad('se esperaban carpetas');
      exact(payload, ['schemaVersion', 'kinds']);
      if (!isObject(payload.kinds)) throw bad('kinds no válido');
      exact(payload.kinds, ['agents', 'skills', 'contexts', 'mcp', 'diagrams']);
      for (const kf of Object.values(payload.kinds)) {
        if (!isObject(kf)) throw bad('kinds no válido');
        exact(kf, ['folders', 'items']);
        if (!Array.isArray(kf.folders) || kf.folders.length > 200 || !kf.folders.every((x) => typeof x === 'string' && x.length <= 200)) throw bad('folders no válido');
        if (!isObject(kf.items) || Object.keys(kf.items).length > 5000) throw bad('items no válido');
        for (const [id, f] of Object.entries(kf.items)) if (!safeId(id) || typeof f !== 'string' || f.length > 200) throw bad('items no válido');
      }
      return payload as unknown as LibraryFolders;
    }
    case CHANNELS.saveContext: {
      if (!isObject(payload)) throw bad('se esperaba un contexto');
      exact(payload, ['id', 'schemaVersion', 'name', 'kind', 'value']);
      if (!safeId(payload.id)) throw bad('id no válido');
      if (typeof payload.schemaVersion !== 'number') throw bad('falta la versión');
      str(payload.name, 'name', 1000);
      if (payload.kind !== 'text' && payload.kind !== 'url' && payload.kind !== 'file') throw bad('kind no válido');
      str(payload.value, 'value', 300_000);
      return payload as unknown as ContextDefinition;
    }
    case CHANNELS.saveSkill: {
      if (!isObject(payload)) throw bad('se esperaba una skill');
      exact(payload, ['id', 'name', 'description', 'body']);
      if (!safeId(payload.id)) throw bad('id no válido');
      str(payload.name, 'name', 1000);
      str(payload.description, 'description', 5000);
      str(payload.body, 'body', 200_000);
      return payload as unknown as SkillDefinition;
    }
    case CHANNELS.addContextFiles:
    case CHANNELS.addSkillFiles: {
      if (!isObject(payload)) throw bad('se esperaba un objeto');
      exact(payload, ['id', 'kind']);
      if (!safeId(payload.id)) throw bad('id no válido');
      if (payload.kind !== 'files' && payload.kind !== 'folder') throw bad('kind no válido');
      return payload;
    }
    case CHANNELS.removeSkillFile:
    case CHANNELS.readSkillFile: {
      if (!isObject(payload)) throw bad('se esperaba un objeto');
      exact(payload, ['id', 'path']);
      if (!safeId(payload.id)) throw bad('id no válido');
      const rel = str(payload.path, 'path', 500, 1);
      if (!isRelativeInside(rel)) throw bad('ruta no válida');
      return payload;
    }
    case CHANNELS.saveSkillFile: {
      if (!isObject(payload)) throw bad('se esperaba un objeto');
      exact(payload, ['id', 'path', 'text']);
      if (!safeId(payload.id)) throw bad('id no válido');
      const rel = str(payload.path, 'path', 500, 1);
      if (!isRelativeInside(rel) || rel === 'SKILL.md') throw bad('ruta no válida');
      str(payload.text, 'text', SKILL_FILE_MAX, 0);
      return payload;
    }
    case CHANNELS.inspectImport:
      if (payload !== 'folder' && payload !== 'zip') throw bad('tipo de origen no válido');
      return payload;
    case CHANNELS.confirmImport: {
      if (!isObject(payload)) throw bad('se esperaba un objeto');
      exact(payload, ['importId', 'keys']);
      if (!safeId(payload.importId)) throw bad('importId no válido');
      if (!Array.isArray(payload.keys) || payload.keys.length > 1000 || !payload.keys.every((k) => typeof k === 'string' && k.length > 0 && k.length <= 600)) throw bad('keys no válido');
      return payload;
    }
    case CHANNELS.saveSettings: {
      if (!isObject(payload)) throw bad('se esperaban ajustes');
      exact(payload, ['schemaVersion', 'authMode', 'engine', 'defaultModel', 'maxParallel', 'defaultMaxTokens', 'permissions', 'claudeConfig']);
      if (typeof payload.schemaVersion !== 'number') throw bad('falta la versión');
      str(payload.authMode, 'authMode', 50);
      str(payload.engine, 'engine', 50);
      str(payload.defaultModel, 'defaultModel', 200);
      if (typeof payload.maxParallel !== 'number') throw bad('maxParallel no válido');
      if (payload.defaultMaxTokens !== undefined && typeof payload.defaultMaxTokens !== 'number') throw bad('defaultMaxTokens no válido');
      if (payload.permissions !== undefined && !['ask', 'auto', 'full'].includes(payload.permissions as string)) throw bad('permissions no válido');
      if (payload.claudeConfig !== undefined && typeof payload.claudeConfig !== 'boolean') throw bad('claudeConfig no válido');
      return payload as unknown as AppSettings;
    }
    case CHANNELS.setApiKey:
      return str(payload, 'clave', 2000);
    default:
      throw new ContractError(`Canal desconocido: ${channel}`);
  }
}

export const ok = <T>(value: T): ApiResult<T> => ({ ok: true, value });
export const fail = (code: string, message: string, fields?: ApiError['fields']): ApiResult<never> => ({
  ok: false,
  error: { code, message, ...(fields ? { fields } : {}) },
});
