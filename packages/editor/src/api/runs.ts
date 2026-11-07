import { deliverableProblems, isRelativeInside } from '@orquestador/core';
import type { DeliverableSpec, Diagram, Id, PendingQuestion, RunEvent } from '@orquestador/core';
import { UNHANDLED, isObject, safeId, type RequestCheck } from './check';
import { CHANNELS } from './contract';
import type { ApiResult } from './result';

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

/** Ejecución que hay que abrir, pedida al pulsar un aviso [R61.12]. */
export interface OpenRunTarget {
  runId: Id;
  /** ¿Sigue en marcha? Decide si se abre en «En directo» o en «Historial» [R61.11]. */
  live: boolean;
}

/** Ejecuciones: lanzar y controlar, cola, entrada, resultados, correcciones y copias. */
export interface RunsApi {
  // --- ejecución (R19.7) ---
  startRun(req: StartRunRequest): Promise<ApiResult<StartRunResult>>;
  /** Cola de lanzamientos y quitar uno [R52.3]. */
  listQueue(): Promise<ApiResult<QueuedRunView[]>>;
  unqueue(queuedId: string): Promise<ApiResult<boolean>>;
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
  /** Guarda un archivo arrastrado o pegado en la Entrada (bytes, nunca rutas) [R48.6]. */
  stageAttachment(req: { name: string; data: Uint8Array }): Promise<ApiResult<InputAttachment>>;
  /** Diálogo del sistema para adjuntar archivos de fuera [R48.6]. */
  pickAttachments(): Promise<ApiResult<InputAttachment[] | null>>;
  /** Diálogo del sistema en la carpeta de trabajo: rutas relativas [R48.6]. */
  pickProjectFiles(): Promise<ApiResult<InputProjectFile[] | null>>;
  /** Archivos que los agentes modificaron en una ejecución y de los que hay copia [R31.6]. */
  listBackups(runId: Id): Promise<ApiResult<string[]>>;
  /** Devuelve un archivo de la carpeta de trabajo a como estaba antes de la ejecución [R31.6]. */
  restoreBackup(req: { runId: Id; path: string }): Promise<ApiResult<boolean>>;
  /** Eventos en vivo (por lotes). Devuelve la función para darse de baja. */
  onRunEvents(listener: (runId: string, events: RunEvent[]) => void): () => void;
  /** Peticiones de abrir una ejecución. Devuelve la función para darse de baja [R61.12]. */
  onOpenRun(listener: (target: OpenRunTarget) => void): () => void;
}

export function parseRunsRequest(channel: string, payload: unknown, { bad, exact, str }: RequestCheck): unknown {
  switch (channel) {
    case CHANNELS.listRuns:
    case CHANNELS.listQueue:
    case CHANNELS.pickAttachments:
    case CHANNELS.pickProjectFiles:
      if (payload !== undefined && payload !== null) throw bad('no admite argumentos');
      return undefined;
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
    default:
      return UNHANDLED;
  }
}
