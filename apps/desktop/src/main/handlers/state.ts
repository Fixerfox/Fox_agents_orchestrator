import { defaultSettings, type AppSettings, type ImportPlan, type Orchestrator, type RunEvent } from '@orquestador/core';
import type { AssistantEvent, ImportKind } from '@orquestador/editor';
import type { CreateAppServer, QueryFn } from '@orquestador/claude';
import { createHash } from 'node:crypto';
import type { Batcher, RunService } from '@orquestador/runtime';
import { StoreError, type ApiKeyVault, type McpSecretVault, type ProjectStore, type RecentStore, type SettingsStore } from '@orquestador/store';
import type { OrchestratorContext } from '../composition';
import type { TerminalService } from '../terminal';

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

export interface Sub {
  batcher: Batcher<RunEvent>;
  unsubscribe: () => void;
}

/** Lo que devuelve el manejador de un contexto cuando el canal no es suyo. */
export const UNHANDLED = Symbol('unhandled');

/** Estado del proceso principal que comparten los manejadores de todos los contextos [R56.18]. */
export interface HandlerState {
  readonly deps: DesktopDeps;
  store: ProjectStore | undefined;
  root: string | undefined;
  runs: RunService | undefined;
  readonly subs: Map<string, Sub>;
  settings: AppSettings;
  /** Turnos del asistente en curso y sus herramientas esperando respuesta de la interfaz [R29.4]. */
  readonly turns: Map<string, { controller: AbortController; pending: Map<string, (r: { ok: boolean; result: unknown }) => void> }>;
  /** Importación analizada y pendiente de confirmar; solo hay una [R25.7]. */
  pending: { id: string; plan: ImportPlan } | undefined;
}

export function createHandlerState(deps: DesktopDeps): HandlerState {
  return { deps, store: undefined, root: undefined, runs: undefined, subs: new Map(), settings: defaultSettings(), turns: new Map(), pending: undefined };
}

export function requireStore(h: HandlerState): ProjectStore {
  if (!h.store) throw new StoreError('not-found', 'No hay un proyecto abierto');
  return h.store;
}

export function requireRuns(h: HandlerState): RunService {
  if (!h.runs) throw new StoreError('not-found', 'No hay un proyecto abierto');
  return h.runs;
}

/** Cierra las suscripciones (al cambiar de proyecto o salir). */
export function disposeHandlers(h: HandlerState): void {
  for (const sub of h.subs.values()) {
    sub.unsubscribe();
    sub.batcher.dispose();
  }
  h.subs.clear();
  for (const turn of h.turns.values()) turn.controller.abort();
  h.deps.terminals?.killAll(); // al cambiar de proyecto o salir se cierran [R30.13]
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
