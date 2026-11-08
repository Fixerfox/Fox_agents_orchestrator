import type { Diagram } from '../diagrams';
import type { Orchestrator, RunEvent, RunHandle, RunOptions, RunResult, RunStatus } from '../execution';
import type { Payload } from '../shared';

export interface RunMeta {
  schemaVersion: number;
  runId: string;
  diagramId: string;
  startedAt: string;
  finishedAt?: string;
  status: RunStatus | 'interrupted';
  reason?: string;
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
  eventCount: number;
  /** Extracto de la orden, sin secretos. */
  order?: string;
  /** Nombre del diagrama al arrancar (R35.16). */
  diagramName?: string;
  /** Ejecución que esta reanuda, y la que reanudó a esta [R41.2]. */
  resumedFrom?: string;
  resumedBy?: string;
  /** Ejecución que esta corrige, y las que corrigieron a esta [R53.11]. */
  correctedFrom?: string;
  correctedBy?: string[];
  /** Avisos de una ejecución que terminó bien con algo pendiente, p. ej. el entregable [R46.11]. */
  warnings?: string[];
  /** Último paso que terminó bien (`ruta/nodo#pasada`) y cuántos terminaron, para la bandeja [R74.11]. */
  lastStepKey?: string;
  stepsDone?: number;
  /** Reintentos de toda la ejecución, para ordenar y filtrar [R77.19]. */
  retries?: number;
  /** Dada por buena tras fallar: quién, por qué, cuándo y el motivo del fallo [R65.5]. */
  accepted?: RunAcceptance & { at: string; previousReason?: string };
}

/** Quién da por buena una ejecución fallida y por qué [R65.5]. */
export interface RunAcceptance {
  by: 'user' | 'assistant';
  reason: string;
}

/** Ejecución arrancada: `logged` se cumple cuando su registro está cerrado. */
export interface LoggedRun {
  handle: RunHandle;
  logged: Promise<RunResult>;
}

/** Archivo del proyecto admitido como entrada de una ejecución [R48.5]. */
export interface InputFile {
  path: string;
  size: number;
  image: boolean;
}

/** Dónde y cómo se guardan las ejecuciones del proyecto abierto [R56.3]. */
export interface RunRepository {
  /** Máximo de archivos en la entrada de una ejecución [R48.5]. */
  readonly maxInputFiles: number;
  /** Arranca una ejecución y abre su registro. */
  start(orchestrator: Orchestrator, diagram: Diagram, order: string | Payload, options: RunOptions): LoggedRun;
  /** Las `live` siguen en marcha; una que figura en marcha y no lo está se lista como interrumpida. */
  list(opts: { live: ReadonlySet<string> }): Promise<RunMeta[]>;
  /** Eventos guardados; rechaza si la ejecución no existe. */
  readEvents(runId: string): Promise<RunEvent[]>;
  /** Diagrama tal como estaba al arrancar; `null` si no se guardó (R35.16). */
  readDiagram(runId: string): Promise<Diagram | null>;
  markResumedBy(runId: string, by: string): Promise<void>;
  markCorrectedBy(runId: string, by: string): Promise<void>;
  /** Da por buena una ejecución fallida: añade `run.accepted` y la marca terminada bien; `false` si no había fallado [R65.5]. */
  acceptRun(runId: string, acceptance: RunAcceptance): Promise<boolean>;
  /** Cierra como cancelada una ejecución interrumpida; `false` si ya había terminado [R41.3]. */
  dismissInterrupted(runId: string): Promise<boolean>;
  /** Copia lo que hizo un paso para enseñarlo siempre igual [R54.3]. */
  snapshotStep(args: { runId: string; workRoot: string; key: string; files: readonly string[]; blocked: (rel: string) => boolean }): Promise<unknown>;
  /** Ruta absoluta de la copia de un archivo de un paso, si existe [R54.4]. */
  findPreview(runId: string, key: string, rel: string): Promise<string | undefined>;
  /** Añade lo que dijo la persona de un aviso a una ejecución terminada [R75.21]. */
  addFeedback?(runId: string, body: { alertSeq: number; verdict: 'false-alarm' | 'confirmed'; note?: string; nodeId?: string }): Promise<void>;
  /** Añade un evento al final del registro de una ejecución terminada (propuestas de memoria y lo decidido) [R76.8]. */
  appendEvent?(runId: string, body: Record<string, unknown>): Promise<void>;
  /** Guarda un caso de referencia del Supervisor [R75.23]. */
  addSupervisorCase?(c: unknown): Promise<void>;
  /** Ruta absoluta de una versión guardada de un conflicto (`<rama>/rama|destino/<ruta>`), si existe [R73.16]. */
  findConflict?(runId: string, rel: string): Promise<string | undefined>;
  /** Carpeta de los resultados de una ejecución (R20.6). */
  outputFolder(runId: string): string;
  /** Carpeta en la que trabajan los agentes [R48.5]. */
  workRoot(): Promise<string>;
  /** Comprueba y describe archivos del proyecto para la entrada [R48.5]. */
  inputFiles(rels: string[]): Promise<InputFile[]>;
  /** Ruta de entrada de un adjunto preparado [R48.5]. */
  attachmentInputPath(id: string): Promise<string>;
}
