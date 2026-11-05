import { createHash, randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import { basename, isAbsolute, join, relative, sep } from 'node:path';
import { AgentError, analyzeImport, defaultSettings, folderLabel, installImport, type AgentDefinition, type McpServerDefinition, type ImportPlan, type SkillDefinition, type AppSettings, type ContextDefinition, type Diagram, type Orchestrator, type RecentView, type RunEvent, type LibraryFolders } from '@orquestador/core';
import {
  ASSISTANT_TOOLS,
  installSpecKitInto,
  type SpecKitTarget,
  CHANNELS,
  ContractError,
  type AssistantEvent,
  type AssistantMessage,
  type TerminalStartRequest,
  exampleTemplates,
  fail,
  ok,
  parseRequest,
  type ApiResult,
  type DiagramSummary,
  type DraftRequest,
  type ProjectInfo,
  type ImportKind,
  type RunAction,
  type SettingsView,
  type StartRunRequest,
} from '@orquestador/editor';
import { draftWithClaude, isSensitivePath, runAssistantTurn, summarizeFolder, testConnection, testMcpServer, type CreateAppServer, type QueryFn } from '@orquestador/claude';
import { TerminalError, type TerminalService } from './terminal';
import { ApiKeyVault, MAX_ATTACHMENT_BYTES, MAX_INPUT_FILES, McpSecretVault, ProjectStore, RecentStore, SettingsStore, StoreError, readFiles, readFolder, readFolderNamed, readZipFile } from '@orquestador/store';
import { Batcher, RunError, RunService, RunSnapshots, jobsOf } from '@orquestador/runtime';

/** Documentos guía de la raíz de la carpeta del proyecto que se ofrecen como contexto común [R32.16]. */
const GUIDE_DOCS = ['CLAUDE.md', 'TRABAJO.md', 'AGENTS.md'] as const;
const DOC_MAX = 20_000;
const isDir = async (p: string) => fsp.stat(p).then((s) => s.isDirectory(), () => false);
/** Lee un archivo de texto si existe; lo recorta a `max` caracteres. */
async function readSmall(p: string, max: number): Promise<string | undefined> {
  try {
    const st = await fsp.stat(p);
    if (!st.isFile()) return undefined;
    const text = (await fsp.readFile(p, 'utf8')).replace(/^\uFEFF/, '');
    return text.length > max ? `${text.slice(0, max)}\n…` : text;
  } catch {
    return undefined;
  }
}

export interface OrchestratorContext {
  store: ProjectStore;
  projectRoot: string;
  settings(): AppSettings;
  apiKey(): Promise<string | undefined>;
  /** Secretos de un servidor MCP del proyecto [R30.4]. */
  mcpSecrets?(id: string, scope?: 'project' | 'app'): Promise<Record<string, string>>;
  /** Copias de lo que usa cada ejecución [R52.1]. */
  snapshots?: RunSnapshots;
}

export interface DesktopDeps {
  /** Los proyectos nuevos traen Spec Kit (skills y agentes en la carpeta «Spec Kit») [R38.15]. La app lo activa. */
  preinstallSpecKit?: boolean;
  /** Diálogo del sistema para elegir carpeta; `null` si se cancela. El renderer nunca elige rutas. */
  pickFolder(purpose: 'create' | 'open' | 'work'): Promise<string | null>;
  /** Diálogo para elegir la carpeta o el Zip a instalar; `null` si se cancela [R25.1]. */
  pickImport?(kind: ImportKind): Promise<string | null>;
  /** Diálogo para elegir archivos o una carpeta de referencia de una skill [R24.9]. */
  pickSkillFiles?(kind: 'files' | 'folder'): Promise<string[] | null>;
  /** Diálogo del sistema para elegir archivos de la entrada; `defaultPath` abre en esa carpeta [R48.6]. */
  pickInputFiles?(defaultPath?: string): Promise<string[] | null>;
  /** Crea el orquestador de cada proyecto; recibe Ajustes y la clave siempre al día [R27.1]. */
  createOrchestrator(ctx: OrchestratorContext): Orchestrator;
  /** Consulta al SDK de Claude; se inyecta para probar sin red [R27.12]. */
  claudeQuery?: QueryFn;
  /** Ajustes globales y clave API cifrada (carpeta de datos de la app) [R23.2][R23.3]. */
  settings?: SettingsStore;
  /** Proyectos recientes en la carpeta de datos de la app [R28.2]. */
  recents?: RecentStore;
  vault?: ApiKeyVault;
  /** Secretos de los servidores MCP, cifrados [R30.8]. */
  mcpVault?: McpSecretVault;
  /** Terminales integradas [R30.13]. */
  terminals?: TerminalService;
  /** Abre un archivo con el programa del sistema («Abrir fuera» de la vista previa) [R54.5]. */
  openFile?(abs: string): Promise<void>;
  /** Carpeta de los servidores MCP de «Todos mis proyectos» (configuración de la app) [R30.9]. */
  appMcpDir?: string;
  /** Servidor MCP de la app en proceso, para el asistente [R29.4]. */
  createAppServer?: CreateAppServer;
  /** Envía un evento del asistente al renderer [R29.4]. */
  pushAssistant?(turnId: string, event: AssistantEvent): void;
  /** Tiempo máximo de espera de una herramienta (permiso del usuario incluido). */
  assistantToolTimeoutMs?: number;
  /** Carpetas que el asistente nunca lee (la de datos de la app, con la clave y los secretos) [R29.8]. */
  assistantProtectedDirs?: string[];
  /** Envía un lote de eventos al renderer (R15.7/R20.4). */
  push?(runId: string, events: RunEvent[]): void;
  /** Ventana de agrupación en ms (por defecto 50). */
  batchMs?: number;
}

interface Sub {
  batcher: Batcher<RunEvent>;
  unsubscribe: () => void;
}

/** Quita rutas absolutas de un mensaje: ni la raíz del proyecto ni otras salen hacia la interfaz [R19.6]. */
export function scrubPaths(message: string, root?: string): string {
  let out = message;
  if (root) out = out.split(root).join('<proyecto>');
  return out
    .replace(/[A-Za-z]:\\[^\s"']+/g, '<ruta>')
    .replace(/(?:^|(?<=[\s"'(]))\/(?:[^\s"'/]+\/)+[^\s"'/]*/g, '<ruta>');
}

/** Clave de los secretos de un servidor MCP: proyecto (por su carpeta) e id, o `app:<id>` si es de la app [R30.8][R30.9]. */
export function mcpVaultKey(root: string, id: string, scope?: 'project' | 'app'): string {
  if (scope === 'app') return `app:${id}`;
  return `${createHash('sha256').update(root).digest('hex').slice(0, 16)}:${id}`;
}

export class DesktopHandlers {
  private store: ProjectStore | undefined;
  private root: string | undefined;
  private runs: RunService | undefined;
  private readonly subs = new Map<string, Sub>();
  private settings: AppSettings = defaultSettings();
  /** Turnos del asistente en curso y sus herramientas esperando respuesta de la interfaz [R29.4]. */
  private readonly turns = new Map<string, { controller: AbortController; pending: Map<string, (r: { ok: boolean; result: unknown }) => void> }>();
  /** Importación analizada y pendiente de confirmar; solo hay una [R25.7]. */
  private pending: { id: string; plan: ImportPlan } | undefined;

  constructor(private readonly deps: DesktopDeps) {}

  /** Único punto de entrada IPC: valida la petición, ejecuta y devuelve siempre un `ApiResult` [R19.3][R19.6]. */
  async invoke(channel: string, payload: unknown): Promise<ApiResult<unknown>> {
    try {
      const arg = parseRequest(channel, payload);
      return ok(await this.dispatch(channel, arg));
    } catch (err) {
      return this.toFailure(err);
    }
  }

  private toFailure(err: unknown): ApiResult<never> {
    if (err instanceof ContractError) return fail(err.code, scrubPaths(err.message, this.root));
    if (err instanceof StoreError) return fail(err.code, scrubPaths(err.message, this.root), err.fields);
    if (err instanceof RunError) return fail(err.code, scrubPaths(err.message, this.root));
    if (err instanceof TerminalError) return fail(err.code, err.message);
    return fail('internal', 'Error interno');
  }

  private requireStore(): ProjectStore {
    if (!this.store) throw new StoreError('not-found', 'No hay un proyecto abierto');
    return this.store;
  }

  private requireRuns(): RunService {
    if (!this.runs) throw new StoreError('not-found', 'No hay un proyecto abierto');
    return this.runs;
  }

  /** Archivo que pide una web previsualizada por el protocolo propio; `undefined` si no se puede servir [R54.4]. */
  async previewAsset(url: string): Promise<string | undefined> {
    return this.runs?.previewAsset(url);
  }

  /** Cierra las suscripciones (al cambiar de proyecto o salir). */
  dispose(): void {
    for (const sub of this.subs.values()) {
      sub.unsubscribe();
      sub.batcher.dispose();
    }
    this.subs.clear();
    for (const turn of this.turns.values()) turn.controller.abort();
    this.deps.terminals?.killAll(); // al cambiar de proyecto o salir se cierran [R30.13]
  }

  private async setProject(root: string, store: ProjectStore): Promise<ProjectInfo> {
    this.dispose();
    this.pending = undefined;
    this.settings = (await this.deps.settings?.load()) ?? defaultSettings();
    // Copias de lo que usa cada ejecución, compartidas por el motor y el servicio [R52.1].
    const snapshots = new RunSnapshots();
    this.runs = new RunService(store, this.deps.createOrchestrator({
        store,
        snapshots,
        projectRoot: root,
        settings: () => this.settings,
        apiKey: async () => (await this.deps.vault?.read()),
        mcpSecrets: async (id, scope) => (await this.deps.mcpVault?.read(mcpVaultKey(root, id, scope))) ?? {},
      }), () => ({ maxConcurrency: this.settings.maxParallel }), snapshots);
    store.useAppMcp(this.deps.appMcpDir);
    this.store = store; // como máximo un proyecto abierto: el anterior se sustituye [R19.5]
    this.root = root;
    const name = (await store.info()).name;
    await this.deps.recents?.touch(root, name).catch(() => undefined); // un fallo al recordar no impide abrir [R28.2]
    return { name };
  }

  private async settingsView(): Promise<SettingsView> {
    return { ...this.settings, apiKeyStored: (await this.deps.vault?.has()) ?? false };
  }

  private unsubscribe(runId: string): void {
    const sub = this.subs.get(runId);
    if (!sub) return;
    this.subs.delete(runId);
    sub.unsubscribe();
    sub.batcher.dispose();
  }

  /** Historial desde `fromSeq` y, a partir de ahí, envío en vivo por lotes (sin huecos ni duplicados). */
  private async subscribe(runId: string, fromSeq: number): Promise<RunEvent[]> {
    this.unsubscribe(runId);
    const batcher = new Batcher<RunEvent>((batch) => this.deps.push?.(runId, batch), this.deps.batchMs ?? 50);
    const { backlog, unsubscribe } = await this.requireRuns().subscribe(runId, fromSeq, (e) => {
      batcher.push(e);
      if (e.type === 'run.finished') batcher.flush();
    });
    this.subs.set(runId, { batcher, unsubscribe });
    return backlog;
  }

  private async dispatch(channel: string, arg: unknown): Promise<unknown> {
    switch (channel) {
      case CHANNELS.createProject: {
        const root = await this.deps.pickFolder('create');
        if (!root) return null;
        const created = await ProjectStore.create(root, { name: basename(root) || 'Proyecto' });
        // Los proyectos nuevos traen Spec Kit preinstalado (skills y agentes en la carpeta «Spec Kit») [R38.15].
        if (this.deps.preinstallSpecKit) await installSpecKitInto(specKitTarget(created)).catch(() => undefined);
        return this.setProject(root, created);
      }
      case CHANNELS.openProject: {
        const root = await this.deps.pickFolder('open');
        if (!root) return null;
        return this.setProject(root, await ProjectStore.open(root));
      }
      case CHANNELS.listRecent: {
        const out: RecentView[] = [];
        for (const r of (await this.deps.recents?.list()) ?? []) {
          const missing = !(await fsp.stat(join(r.root, '.orquestador')).then((s) => s.isDirectory(), () => false));
          out.push({ id: r.id, name: r.name, folder: folderLabel(r.root), openedAt: r.openedAt, missing });
        }
        return out;
      }
      case CHANNELS.openRecent: {
        const entry = await this.deps.recents?.find((arg as { id: string }).id);
        if (!entry) throw new StoreError('not-found', 'Ese proyecto ya no está en la lista');
        const gone = new StoreError('not-found', 'La carpeta del proyecto ya no existe o no es un proyecto. Puedes quitarlo de la lista.');
        const store = await ProjectStore.open(entry.root).catch(() => {
          throw gone;
        });
        return this.setProject(entry.root, store);
      }
      case CHANNELS.forgetRecent:
        return (await this.deps.recents?.forget(arg as string)) ?? false;
      case CHANNELS.closeProject: {
        this.runs?.cancelAll();
        this.dispose();
        this.pending = undefined;
        this.runs = undefined;
        this.store = undefined;
        this.root = undefined;
        return null;
      }
      case CHANNELS.listDiagrams: {
        const store = this.requireStore();
        const list: DiagramSummary[] = [];
        for (const id of await store.diagrams.list()) {
          try {
            list.push({ id, name: (await store.diagrams.load(id)).name });
          } catch {
            list.push({ id, name: id });
          }
        }
        return list;
      }
      case CHANNELS.loadDiagram:
        return this.requireStore().diagrams.load(arg as string);
      case CHANNELS.saveDiagram:
        await this.requireStore().diagrams.save(arg as Diagram);
        return null;
      case CHANNELS.deleteDiagram:
        return this.requireStore().diagrams.delete(arg as string);
      case CHANNELS.listExamples:
        return exampleTemplates();
      case CHANNELS.startRun:
        return this.requireRuns().submit(arg as StartRunRequest);
      case CHANNELS.listQueue:
        return this.requireRuns().queued();
      case CHANNELS.unqueue:
        return this.requireRuns().unqueue(arg as string);
      case CHANNELS.listJobs:
        return jobsOf(this.requireStore());
      case CHANNELS.resumeRun:
        return this.requireRuns().resumeRun(arg as string);
      case CHANNELS.proposeCorrection: {
        const { runId, text, prefer } = arg as { runId: string; text: string; prefer?: string };
        return this.requireRuns().proposeCorrection(runId, text, prefer);
      }
      case CHANNELS.previewFile: {
        const { runId, key, path } = arg as { runId: string; key: string; path: string };
        return this.requireRuns().previewFile(runId, key, path);
      }
      case CHANNELS.openPreview: {
        const { runId, key, path } = arg as { runId: string; key: string; path: string };
        const loc = await this.requireRuns().locatePreview(runId, key, path);
        if (!loc || !this.deps.openFile) return false;
        await this.deps.openFile(loc.abs);
        return true;
      }
      case CHANNELS.correctRun: {
        const { runId, ...req } = arg as { runId: string; text: string; nodeId: string; files?: string[]; attachments?: string[] };
        return this.requireRuns().correctRun(runId, req);
      }
      case CHANNELS.dismissRun:
        return this.requireRuns().dismiss(arg as string);
      case CHANNELS.controlRun: {
        const { runId, action } = arg as { runId: string; action: RunAction };
        const runs = this.requireRuns();
        if (action === 'pause') runs.pause(runId);
        else if (action === 'resume') runs.resume(runId);
        else runs.cancel(runId);
        return null;
      }
      case CHANNELS.answerRun: {
        const { runId, questionId, text } = arg as { runId: string; questionId: string; text: string };
        return this.requireRuns().answer(runId, questionId, text);
      }
      case CHANNELS.subscribeRun: {
        const { runId, fromSeq } = arg as { runId: string; fromSeq: number };
        return this.subscribe(runId, fromSeq);
      }
      case CHANNELS.unsubscribeRun: {
        this.unsubscribe(arg as string);
        return null;
      }
      case CHANNELS.listRuns:
        return this.requireRuns().list();
      case CHANNELS.pendingQuestions:
        return this.requireRuns().pending(arg as string);
      case CHANNELS.runDiagram:
        return this.requireRuns().runDiagram(arg as string);
      case CHANNELS.listOutput:
        return this.requireRuns().listOutput(arg as string);
      case CHANNELS.readOutput: {
        const { runId, path } = arg as { runId: string; path: string };
        return this.requireRuns().readOutput(runId, path);
      }
      case CHANNELS.listSkills:
        return this.requireStore().listSkills();
      case CHANNELS.saveSkill:
        await this.requireStore().saveSkill(arg as SkillDefinition);
        return null;
      case CHANNELS.deleteSkill:
        return this.requireStore().deleteSkill(arg as string);
      case CHANNELS.skillUsage:
        return this.requireStore().usageOfSkill(arg as string);
      case CHANNELS.skillFiles:
        return this.requireStore().skillFiles(arg as string);
      case CHANNELS.addSkillFiles: {
        const { id, kind } = arg as { id: string; kind: 'files' | 'folder' };
        const store = this.requireStore();
        await store.loadSkill(id);
        const picked = await this.deps.pickSkillFiles?.(kind);
        if (!picked || picked.length === 0) return null;
        const tree = kind === 'folder' ? await readFolderNamed(picked[0]!) : await readFiles(picked);
        return store.addSkillFiles(id, tree.files);
      }
      case CHANNELS.addContextFiles: {
        const { id, kind } = arg as { id: string; kind: 'files' | 'folder' };
        const store = this.requireStore();
        const picked = await this.deps.pickSkillFiles?.(kind);
        if (!picked || picked.length === 0) return null;
        const tree = kind === 'folder' ? await readFolderNamed(picked[0]!) : await readFiles(picked);
        return store.addContextFiles(id, tree.files);
      }
      case CHANNELS.removeSkillFile: {
        const { id, path } = arg as { id: string; path: string };
        return this.requireStore().removeSkillFile(id, path);
      }
      case CHANNELS.saveSkillFile: {
        const { id, path, text } = arg as { id: string; path: string; text: string };
        await this.requireStore().saveSkillText(id, path, text);
        return null;
      }
      case CHANNELS.readSkillFile: {
        const { id, path } = arg as { id: string; path: string };
        return this.requireStore().readSkillFile(id, path);
      }
      case CHANNELS.inspectImport: {
        const store = this.requireStore();
        this.pending = undefined;
        const source = await this.deps.pickImport?.(arg as ImportKind);
        if (!source) return null;
        const tree = (arg as ImportKind) === 'zip' ? await readZipFile(source) : await readFolder(source);
        const plan = analyzeImport(tree, {
          agentIds: new Set((await store.listAgents()).map((a) => a.id)),
          skillIds: new Set(await store.listSkillIds()),
        });
        this.pending = { id: randomUUID(), plan };
        return { importId: this.pending.id, report: plan.report };
      }
      case CHANNELS.confirmImport: {
        const { importId, keys } = arg as { importId: string; keys: string[] };
        const store = this.requireStore();
        if (!this.pending || this.pending.id !== importId) throw new StoreError('not-found', 'Esa importación ya no está disponible; vuelve a elegir el paquete');
        const { plan } = this.pending;
        this.pending = undefined; // una importación solo se confirma una vez
        return installImport(store, plan, keys);
      }
      case CHANNELS.cancelImport:
        if (this.pending?.id === (arg as string)) this.pending = undefined;
        return null;
      case CHANNELS.listAgents:
        return this.requireStore().listAgents();
      case CHANNELS.saveAgent:
        await this.requireStore().saveAgent(arg as AgentDefinition);
        return null;
      case CHANNELS.deleteAgent:
        return this.requireStore().deleteAgent(arg as string);
      case CHANNELS.agentUsage:
        return this.requireStore().usageOfAgent(arg as string);
      case CHANNELS.listContexts:
        return this.requireStore().listContexts();
      case CHANNELS.getLibraryFolders:
        return this.requireStore().getLibraryFolders();
      case CHANNELS.saveLibraryFolders:
        return this.requireStore().saveLibraryFolders(arg as LibraryFolders);
      case CHANNELS.saveContext:
        await this.requireStore().saveContext(arg as ContextDefinition);
        return null;
      case CHANNELS.deleteContext:
        return this.requireStore().deleteContext(arg as string);
      case CHANNELS.contextUsage:
        return this.requireStore().usageOfContext(arg as string);
      case CHANNELS.getSettings: {
        if (this.deps.settings) this.settings = await this.deps.settings.load();
        return this.settingsView();
      }
      case CHANNELS.saveSettings: {
        if (!this.deps.settings) throw new StoreError('unavailable', 'Los ajustes no están disponibles');
        this.settings = await this.deps.settings.save(arg as AppSettings);
        return this.settingsView();
      }
      case CHANNELS.listMcp: {
        const store = this.requireStore();
        const root = this.root!;
        return Promise.all((await store.listMcp()).map(async (m) => ({ ...m, secretsSet: (await this.deps.mcpVault?.names(mcpVaultKey(root, m.id, m.scope))) ?? [] })));
      }
      case CHANNELS.saveMcp: {
        const store = this.requireStore();
        const def = arg as McpServerDefinition;
        const before = await store.scopeOfMcp(def.id);
        await store.saveMcp(def);
        const after = def.scope ?? 'project';
        // al cambiar de ámbito, los secretos se mueven con el servidor [R30.9]
        if (before && before !== after) await this.deps.mcpVault?.move(mcpVaultKey(this.root!, def.id, before), mcpVaultKey(this.root!, def.id, after));
        return null;
      }
      case CHANNELS.deleteMcp: {
        const id = arg as string;
        const store = this.requireStore();
        const scope = await store.scopeOfMcp(id);
        const gone = await store.deleteMcp(id);
        if (scope) await this.deps.mcpVault?.remove(mcpVaultKey(this.root!, id, scope));
        return gone;
      }
      case CHANNELS.mcpUsage:
        return this.requireStore().usageOfMcp(arg as string);
      case CHANNELS.setMcpSecret: {
        const { id, name, value } = arg as { id: string; name: string; value: string };
        const scope = await this.requireStore().scopeOfMcp(id);
        if (!scope) throw new StoreError('not-found', 'Guarda primero el servidor MCP');
        if (!this.deps.mcpVault) throw new StoreError('unavailable', 'Este sistema no ofrece almacenamiento cifrado: el secreto no se guarda');
        await this.deps.mcpVault.set(mcpVaultKey(this.root!, id, scope), name, value);
        return null;
      }
      case CHANNELS.clearMcpSecret: {
        const { id, name } = arg as { id: string; name: string };
        const scope = await this.requireStore().scopeOfMcp(id);
        if (scope) await this.deps.mcpVault?.remove(mcpVaultKey(this.root!, id, scope), name);
        return null;
      }
      case CHANNELS.testMcp: {
        const store = this.requireStore();
        const root = this.root!;
        if (!this.deps.claudeQuery) throw new StoreError('unavailable', 'El motor de Claude no está disponible');
        const def = (await store.listMcp()).find((m) => m.id === (arg as string));
        if (!def) throw new StoreError('not-found', 'No existe ese servidor MCP');
        const secrets = (await this.deps.mcpVault?.read(mcpVaultKey(root, def.id, def.scope))) ?? {};
        const r = await testMcpServer({ query: this.deps.claudeQuery, server: { def, secrets }, settings: this.settings, apiKey: await this.deps.vault?.read(), cwd: root });
        return { ...r, message: scrubPaths(r.message, root) };
      }
      case CHANNELS.terminalStart: {
        if (!this.deps.terminals) throw new StoreError('unavailable', 'La terminal no está disponible');
        const root = this.root;
        if (!root) throw new StoreError('not-found', 'Abre un proyecto para usar la terminal');
        return this.deps.terminals.start(root, arg as TerminalStartRequest); // siempre en la carpeta del proyecto [R30.13]
      }
      case CHANNELS.terminalWrite: {
        const { id, data } = arg as { id: string; data: string };
        return this.deps.terminals?.write(id, data) ?? false;
      }
      case CHANNELS.terminalResize: {
        const { id, cols, rows } = arg as { id: string; cols: number; rows: number };
        return this.deps.terminals?.resize(id, cols, rows) ?? false;
      }
      case CHANNELS.terminalKill:
        return this.deps.terminals?.kill(arg as string) ?? false;
      case CHANNELS.assistantSend: {
        const { turnId, messages } = arg as { turnId: string; messages: AssistantMessage[] };
        const root = this.root;
        if (!root) throw new StoreError('not-found', 'Abre un proyecto para usar el asistente');
        if (this.turns.has(turnId)) throw new StoreError('exists', 'Ese turno ya está en marcha');
        const push = (event: AssistantEvent) => this.deps.pushAssistant?.(turnId, event);
        if (this.settings.engine !== 'claude' || !this.deps.claudeQuery || !this.deps.createAppServer) {
          // Sin el motor de Claude el asistente no puede trabajar: lo explica y termina [R29.6].
          const text = 'Estoy en modo simulado. Para que pueda crear agentes, skills y diagramas por ti, elige el motor «Claude» en Ajustes.';
          queueMicrotask(() => (push({ type: 'text', text }), push({ type: 'done', text })));
          return null;
        }
        const turn = { controller: new AbortController(), pending: new Map<string, (r: { ok: boolean; result: unknown }) => void>() };
        this.turns.set(turnId, turn);
        const timeout = this.deps.assistantToolTimeoutMs ?? 10 * 60_000;
        void runAssistantTurn({
          query: this.deps.claudeQuery,
          createServer: this.deps.createAppServer,
          tools: ASSISTANT_TOOLS.map((t) => ({ name: t.name, description: t.description, params: t.params })),
          messages,
          settings: this.settings,
          apiKey: await this.deps.vault?.read(),
          cwd: root,
          protectedDirs: this.deps.assistantProtectedDirs ?? [],
          signal: turn.controller.signal,
          emit: (e) => push(e.type === 'error' ? { ...e, message: scrubPaths(e.message, root) } : e.type === 'read' ? { ...e, target: scrubPaths(e.target, root) } : e),
          newId: () => randomUUID(),
          callTool: (callId) =>
            new Promise((resolve) => {
              const timer = setTimeout(() => (turn.pending.delete(callId), resolve({ ok: false, result: 'La interfaz no respondió a tiempo.' })), timeout);
              turn.pending.set(callId, (r) => (clearTimeout(timer), turn.pending.delete(callId), resolve(r)));
              turn.controller.signal.addEventListener('abort', () => turn.pending.get(callId)?.({ ok: false, result: 'Detenido.' }), { once: true });
            }),
        }).finally(() => this.turns.delete(turnId));
        return null;
      }
      case CHANNELS.assistantToolResult: {
        const { turnId, callId, ok, result } = arg as { turnId: string; callId: string; ok: boolean; result: unknown };
        const resolve = this.turns.get(turnId)?.pending.get(callId);
        if (!resolve) return false;
        resolve({ ok, result });
        return true;
      }
      case CHANNELS.assistantCancel: {
        const turn = this.turns.get(arg as string);
        if (!turn) return false;
        turn.controller.abort();
        return true;
      }
      case CHANNELS.testConnection: {
        const root = this.root;
        if (!root) throw new StoreError('not-found', 'Abre un proyecto para probar la conexión');
        if (!this.deps.claudeQuery) throw new StoreError('unavailable', 'El motor de Claude no está disponible');
        const r = await testConnection({ query: this.deps.claudeQuery, settings: this.settings, apiKey: await this.deps.vault?.read(), cwd: root });
        return r;
      }
      case CHANNELS.draftWithClaude: {
        const store = this.requireStore();
        const root = this.root;
        if (!root) throw new StoreError('not-found', 'Abre un proyecto para redactar con Claude');
        if (!this.deps.claudeQuery) throw new StoreError('unavailable', 'El motor de Claude no está disponible');
        const req = arg as DraftRequest;
        try {
          return await draftWithClaude({
            query: this.deps.claudeQuery,
            settings: this.settings,
            apiKey: await this.deps.vault?.read(),
            cwd: root,
            kind: req.kind,
            instruction: req.instruction,
            ...(req.current ? { current: req.current } : {}),
            contexts: await store.listContexts(),
            skills: await store.listSkills(),
          });
        } catch (e) {
          if (e instanceof AgentError) throw new StoreError('unavailable', e.message);
          throw e;
        }
      }
      case CHANNELS.getWorkFolder: {
        const folder = await this.requireStore().getWorkFolder();
        if (!folder) return null;
        const s = await summarizeFolder(folder);
        return { name: s.name, files: s.files };
      }
      case CHANNELS.stageAttachment: {
        const { name, data } = arg as { name: string; data: Uint8Array };
        return this.requireStore().stageAttachment(name, data);
      }
      case CHANNELS.pickAttachments: {
        // El diálogo lo abre el proceso principal: el renderer solo recibe nombre, tamaño e id [R48.6].
        const store = this.requireStore();
        const picked = await this.deps.pickInputFiles?.();
        if (!picked || picked.length === 0) return null;
        if (picked.length > MAX_INPUT_FILES) throw new StoreError('invalid', `Como mucho ${MAX_INPUT_FILES} archivos en la entrada`);
        const out = [];
        for (const abs of picked) {
          const st = await fsp.stat(abs);
          if (st.size > MAX_ATTACHMENT_BYTES) throw new StoreError('invalid', `«${basename(abs)}» supera los 20 MB`);
          out.push(await store.stageAttachment(basename(abs), new Uint8Array(await fsp.readFile(abs))));
        }
        return out;
      }
      case CHANNELS.pickProjectFiles: {
        const store = this.requireStore();
        const base = await store.inputBase();
        const picked = await this.deps.pickInputFiles?.(base);
        if (!picked || picked.length === 0) return null;
        const rels = picked.map((abs) => {
          const rel = relative(base, abs);
          if (rel.startsWith('..') || isAbsolute(rel)) throw new StoreError('outside-root', `«${basename(abs)}» no está en la carpeta de trabajo; para archivos de fuera usa «Adjuntar»`);
          return rel.split(sep).join('/');
        });
        return store.inputFiles(rels);
      }
      case CHANNELS.pickWorkFolder: {
        const store = this.requireStore();
        const picked = await this.deps.pickFolder('work');
        if (!picked) return null;
        await store.setWorkFolder(picked);
        const s = await summarizeFolder(picked);
        return { name: s.name, files: s.files };
      }
      case CHANNELS.clearWorkFolder:
        await this.requireStore().setWorkFolder(null);
        return null;
      case CHANNELS.inspectWorkFolder: {
        const store = this.requireStore();
        const folder = await store.getWorkFolder();
        if (!folder) throw new StoreError('not-found', 'Elige primero la carpeta del proyecto');
        this.pending = undefined;
        const files = (await isDir(join(folder, '.claude'))) ? (await readFolder(join(folder, '.claude'))).files : [];
        const mcp = await readSmall(join(folder, '.mcp.json'), 200_000);
        if (mcp !== undefined) files.push({ path: '.mcp.json', data: new TextEncoder().encode(mcp) });
        const plan = analyzeImport({ files }, { agentIds: new Set((await store.listAgents()).map((a) => a.id)), skillIds: new Set(await store.listSkillIds()) });
        this.pending = { id: randomUUID(), plan };
        const s = await summarizeFolder(folder);
        const docs: { name: string; text: string }[] = [];
        for (const name of GUIDE_DOCS) {
          const text = await readSmall(join(folder, name), DOC_MAX);
          if (text !== undefined && text.trim() !== '') docs.push({ name, text });
        }
        return { importId: this.pending.id, report: plan.report, folder: { name: s.name, files: s.files }, summary: s.text, docs };
      }
      case CHANNELS.listBackups:
        return this.requireStore().listBackups(arg as string);
      case CHANNELS.restoreBackup: {
        const r = arg as { runId: string; path: string };
        return this.requireStore().restoreBackup(r.runId, r.path);
      }
      case CHANNELS.readRunFile: {
        const r = arg as { runId: string; path: string };
        // Nunca un secreto, aunque un agente lo escribiera [R45.11].
        return this.requireStore().readRunFile(r.runId, r.path, { blocked: (rel) => isSensitivePath(rel) });
      }
      case CHANNELS.setApiKey: {
        if (!this.deps.vault) throw new StoreError('unavailable', 'La clave no se puede guardar en este sistema');
        await this.deps.vault.set(arg as string);
        return this.settingsView();
      }
      case CHANNELS.clearApiKey: {
        await this.deps.vault?.clear();
        return this.settingsView();
      }
      default:
        throw new ContractError(`Canal desconocido: ${channel}`);
    }
  }
}

/** El almacén del proyecto como destino de la instalación de Spec Kit [R38.15]. */
export function specKitTarget(store: ProjectStore): SpecKitTarget {
  return {
    skillIds: () => store.listSkillIds(),
    agentIds: async () => (await store.listAgents()).map((a) => a.id),
    saveSkill: (k) => store.saveSkill(k),
    saveSkillFile: (id, path, text) => store.writeSkillFile(id, path, new TextEncoder().encode(text)),
    saveAgent: (a) => store.saveAgent(a),
    getFolders: () => store.getLibraryFolders(),
    saveFolders: async (f) => void (await store.saveLibraryFolders(f)),
  };
}
