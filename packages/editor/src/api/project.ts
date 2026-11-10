import type { ImportReport, RecentView } from '@orquestador/core';
import { UNHANDLED, isObject, safeId, type RequestCheck } from './check';
import { CHANNELS } from './contract';
import type { ApiResult } from './result';

export interface ProjectInfo {
  name: string;
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

function termSize(cols: unknown, rows: unknown, bad: (m: string) => Error): void {
  const okN = (n: unknown, max: number) => typeof n === 'number' && Number.isInteger(n) && n >= 2 && n <= max;
  if (!okN(cols, TERMINAL_LIMITS.cols) || !okN(rows, TERMINAL_LIMITS.rows)) throw bad('tamaño no válido');
}

/** Proyecto: abrir y cerrar, recientes, carpeta de trabajo y terminal integrada. */
export interface ProjectSessionApi {
  /** Proyecto abierto en el proceso principal, para volver a él al recargarse la interfaz [R19.12]. */
  currentProject(): Promise<ApiResult<ProjectInfo | null>>;
  /** Lo que trae la configuración de Claude Code del proyecto y si se confía en ella [R88.6]. */
  projectTrust(): Promise<ApiResult<ProjectTrustInfo>>;
  /** Confiar en la configuración de Claude Code del proyecto o ignorarla, para lo que trae ahora [R88.6]. */
  setProjectTrust(decision: 'trusted' | 'ignored'): Promise<ApiResult<null>>;
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
  // --- carpeta de trabajo y copias (SPEC-031) ---
  /** Carpeta de trabajo del proyecto: solo nombre y número de archivos, nunca la ruta [R31.1]. */
  getWorkFolder(): Promise<ApiResult<WorkFolderView | null>>;
  /** Abre el diálogo del sistema y guarda la carpeta elegida; `null` si se cancela [R31.1]. */
  pickWorkFolder(): Promise<ApiResult<WorkFolderView | null>>;
  clearWorkFolder(): Promise<ApiResult<null>>;
  /**
   * Analiza la carpeta de trabajo: agentes y skills de `.claude/`, MCP de `.mcp.json`, resumen del proyecto y
   * documentos guía (CLAUDE.md, TRABAJO.md, AGENTS.md). No instala nada; se confirma con `confirmImport` [R32.16].
   */
  inspectWorkFolder(): Promise<ApiResult<WorkFolderInspection>>;
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

/** Lo arriesgado de la configuración de Claude Code del proyecto abierto, sin rutas [R88.6]. */
export interface ProjectTrustInfo {
  items: { file: string; key: string; detail: string }[];
  decision: 'trusted' | 'ignored' | null;
}

export function parseProjectRequest(channel: string, payload: unknown, { bad, exact, str }: RequestCheck): unknown {
  switch (channel) {
    case CHANNELS.currentProject:
    case CHANNELS.projectTrust:
    case CHANNELS.createProject:
    case CHANNELS.openProject:
    case CHANNELS.listRecent:
    case CHANNELS.closeProject:
    case CHANNELS.getWorkFolder:
    case CHANNELS.pickWorkFolder:
    case CHANNELS.clearWorkFolder:
    case CHANNELS.inspectWorkFolder:
      if (payload !== undefined && payload !== null) throw bad('no admite argumentos');
      return undefined;
    case CHANNELS.forgetRecent:
      if (!safeId(payload)) throw bad('id no válido');
      return payload;
    case CHANNELS.setProjectTrust:
      if (payload !== 'trusted' && payload !== 'ignored') throw bad('decisión no válida');
      return payload;
    case CHANNELS.openRecent: {
      if (!isObject(payload)) throw bad('se esperaba un id');
      exact(payload, ['id']);
      if (!safeId(payload.id)) throw bad('id no válido');
      return payload;
    }
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
    default:
      return UNHANDLED;
  }
}
