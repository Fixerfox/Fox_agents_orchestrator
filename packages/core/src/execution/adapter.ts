import type { TransformFormat } from '../diagrams';
import type { Id, KnowledgeExtra, KnowledgeKind, Payload } from '../shared';

export type FileChange = 'created' | 'modified';
/** Cómo se cambió: con un comando, sin pasar por las herramientas de edición ni dejar copia [R55.3]. */
export type FileVia = 'command';

export type AgentStreamEvent =
  | { type: 'token'; text: string }
  | { type: 'tool_call'; tool: string; input: unknown }
  | { type: 'tool_result'; tool: string; ok: boolean; output?: string; /** Id de la llamada, si el motor lo da [R55.2]. */ id?: string }
  /** Rama de git que el agente creó o en la que actuó [R58.1]. */
  | { type: 'branch'; branch: string; via: 'head' | 'command' | 'mcp' | 'ran'; created?: boolean }
  /** Lo que el agente hizo en una rama [R58.11]. */
  | { type: 'git_action'; branch: string; action: 'commit' | 'push' | 'pr' | 'merge' | 'delete' | 'switch'; /** PR o merge request [R58.14]. */ url?: string }
  /** Acción frenada antes de ocurrir [R60.16]. */
  | { type: 'blocked'; detail: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number; costUsd?: number }
  /** Archivo creado o modificado por el agente [R31.12]; `change` es opcional para adaptadores que no lo saben. */
  | { type: 'file'; path: string; change?: FileChange; /** Lo cambió un comando (sin copia) [R55.3]. */ via?: FileVia }
  | { type: 'result'; text: string; files?: string[] }
  /** Un elemento de conocimiento se ha entregado o usado en este intento [R36.13]. */
  | { type: 'knowledge'; kind: KnowledgeKind; id: Id; via: KnowledgeVia; required: boolean }
  /** Un elemento obligatorio no se usó [R36.13]. */
  | { type: 'knowledge_unmet'; kind: KnowledgeKind; id: Id };

/** Cómo llegó a usarse: incluido en el prompt, leído de un archivo o llamando a una herramienta [R36.13]. */
export type KnowledgeVia = 'inline' | 'read' | 'tool';

/** Un elemento de conocimiento concreto. */
export interface KnowledgeRef {
  kind: KnowledgeKind;
  id: Id;
}

/** Foto de la configuración del agente usada en una ejecución (para poder analizarla después). */
export interface AgentSnapshot {
  name?: string;
  model?: string;
  version?: number;
  instructions?: string;
  skillIds?: Id[];
  contextIds?: Id[];
  allowedTools?: string[];
  mcpServers?: string[];
}

/** Ficha corta de un agente para quien reparte el trabajo [R59.18]. */
export interface AgentProfile {
  name: string;
  purpose?: string;
  skills: string[];
  mcp: string[];
}

/** Lo que el Supervisor revisa de un paso [R60.12]. */
export interface SupervisorReview {
  step: string;
  /** Lo que pidió la persona: es el criterio [R62.2]. */
  order?: string;
  /** Para qué sirve el agente según su ficha [R62.2]. */
  purpose?: string;
  /** Corrección que pidió la persona: es lo que le toca ahora [R62.15]. */
  correction?: string;
  input: Payload;
  task?: string;
  actions: string[];
  output: Payload;
}

/** Veredicto de la revisión, con la entrada de la memoria [R60.12][R60.19]. */
export interface SupervisorVerdict {
  ok: boolean;
  reason: string;
  summary: string;
  outOfScope?: string;
  /** Lo que el paso decidió por su cuenta, solo si lo dice o lo hace explícitamente [R72.10]. */
  decided?: string[];
  usage?: { inputTokens: number; outputTokens: number; costUsd?: number };
}

/** Lo que se compara al final: lo pedido con lo hecho [R62.9]. */
export interface RunVerification {
  order: Payload;
  /** Entregable acordado, si lo hay. */
  deliverable?: string;
  steps: { step: string; text: string; files: string[] }[];
  /** Corrección que pidió la persona [R62.16]. */
  correction?: string;
  /** Lo que entregaron antes los pasos que la corrección repite [R62.16]. */
  before?: { step: string; text: string; files: string[] }[];
  /** Lo que decidió la persona durante la ejecución [R62.17]. */
  decisions?: string[];
}

export interface RunVerdict {
  met: boolean;
  /** Qué falta, si no se cumple. */
  missing: string;
  /** Lo que solo puede hacer o comprobar una persona; no es una falta de los agentes [R65.1]. */
  forPerson?: string;
  usage?: { inputTokens: number; outputTokens: number; costUsd?: number };
}

export interface AgentQuestion {
  text: string;
  options?: string[];
  /** Confirmación del paso antes de terminar (vuelta N) [R43.5]. */
  confirm?: { round: number };
  /** Quién pregunta: el agente, la app pidiendo permiso o la supervisión de R39.4 [R45.3]. */
  kind?: QuestionKind;
  /** Pregunta de una revisión humana: qué cambiar o a qué paso volver [R53.3][R53.5]. */
  review?: ReviewQuestion;
  /** La respuesta segura, que se elige sola si la política lo permite [R70.13]. */
  fallback?: string;
}

/** Datos de una pregunta de revisión humana [R53.3][R53.5]. */
export interface ReviewQuestion {
  round: number;
  max: number;
  phase: 'feedback' | 'route';
  /** Solo en `route`: el paso propuesto, su motivo y los posibles. */
  proposal?: Id;
  reason?: string;
  candidates?: { nodeId: Id; label: string }[];
}

/** Un paso al que se puede volver para corregir [R53.5]. */
export interface BlameCandidate {
  nodeId: Id;
  label: string;
  task?: string;
  output?: Payload;
}

export type QuestionKind = 'question' | 'permission' | 'gate' | 'unfinished';

export interface AnsweredQuestion {
  question: string;
  answer: string;
}

export interface AgentRequest {
  nodeId: Id;
  agentId: Id;
  /** Ejecución a la que pertenece el nodo (para agrupar copias de seguridad). */
  runId?: Id;
  input: Payload;
  /** Encargo del nodo en este paso, si lo tiene [R32.2]. */
  task?: string;
  /** Skills, contextos y MCP añadidos por el diagrama y por el paso, además de los del agente [R33.3]. */
  extra?: KnowledgeExtra;
  /** Obligatorios que el intento anterior no usó; el agente debe recordárselo a Claude [R36.11]. */
  missing?: KnowledgeRef[];
  /** Modelo elegido en el paso; sustituye al de la ficha del agente [R40.3]. */
  model?: string;
  /** El paso confirma antes de terminar: el agente acaba con un resumen detallado [R43.4]. */
  confirm?: boolean;
  /** Regla de reparto: el trabajo de este paso se divide entre sus ramas [R59.4]. */
  split?: string;
  /** Memoria de la ejecución: contexto de fondo, no instrucciones [R60.21]. */
  memory?: string;
  /** Archivos y carpetas a los que se limita este paso [R60.16]. */
  scope?: string[];
  /** Qué se entregará al final: contrato completo (pasos finales) o una línea de objetivo [R46.4]. */
  deliverable?: { role: 'final' | 'goal'; text: string };
  /** Número de intento (1 = primero). */
  attempt: number;
  /** Pregunta al usuario y espera su respuesta (chat en el nodo). */
  ask(question: AgentQuestion): Promise<string>;
  /** Preguntas ya respondidas en intentos anteriores del mismo nodo. */
  previousAnswers: AnsweredQuestion[];
  /** Lo que el intento inmediatamente anterior dejó: error, acciones y archivos [R71.7][R71.8]. */
  previousAttempt?: PreviousAttempt;
}

/** Lo que un intento fallido le deja al siguiente [R71.7]. */
export interface PreviousAttempt {
  attempt: number;
  kind: AgentErrorKind;
  message: string;
  ended: 'error' | 'timeout' | 'loop' | 'unmet' | 'interrupted';
  actions: string[];
  files: { path: string; change?: FileChange; via?: FileVia; restored?: boolean }[];
}

/** Lo que se pudo devolver al punto de partida [R71.10]. */
export interface RestoreResult {
  restored: string[];
  removed: string[];
  failed: { path: string; reason: string }[];
}

/** Contrato que implementa cada motor de agentes (Claude Agent SDK, simulado, ...). */
export interface AgentAdapter {
  run(request: AgentRequest, signal: AbortSignal): AsyncIterable<AgentStreamEvent>;
}

/** Tipo de un error del motor: decide si se reintenta y con qué cuenta [R71.1]. */
export type AgentErrorKind = 'rate_limit' | 'overloaded' | 'transient' | 'timeout' | 'unmet' | 'fatal';

/** Error de un adapter. `retriable` indica si el orquestador puede reintentar; `kind`, de qué tipo es [R71.1]. */
export class AgentError extends Error {
  readonly kind: AgentErrorKind;
  readonly retriable: boolean;
  /** Lo que pidió esperar el proveedor, si lo dijo (`retry-after`) [R71.2]. */
  readonly retryAfterMs: number | undefined;

  constructor(
    message: string,
    retriable = false,
    /** Obligatorios sin usar que provocaron el error [R36.11]. */
    readonly missed: KnowledgeRef[] = [],
    opts: { kind?: AgentErrorKind; retryAfterMs?: number } = {},
  ) {
    super(message);
    this.name = 'AgentError';
    this.kind = opts.kind ?? (missed.length > 0 ? 'unmet' : retriable ? 'transient' : 'fatal');
    this.retriable = opts.kind ? opts.kind !== 'fatal' : retriable;
    this.retryAfterMs = opts.retryAfterMs;
  }
}

/** ¿Es un límite de uso del proveedor? Tiene su propia cuenta de intentos [R71.5]. */
export const isLimitError = (err: unknown): boolean => err instanceof AgentError && (err.kind === 'rate_limit' || err.kind === 'overloaded');

export interface RouteCandidate {
  edgeId: Id;
  to: Id;
  label: string;
}

/** Lo que juzga el Juez de una revisión [R34.26]. */
export interface JudgeRequest {
  /** Criterio escrito en el nodo, si lo hay. */
  criteria?: string;
  output: Payload;
  round: number;
  max: number;
}

/** Decisión del Juez [R34.26][R34.28]. */
export interface JudgeVerdict {
  approved: boolean;
  reason: string;
  usage?: { inputTokens: number; outputTokens: number; costUsd?: number };
}

/** Decisiones que toma la IA fuera de los agentes de trabajo: enrutado, condiciones y evaluador de bucles. */
export interface Decider {
  /** `usage`: lo que gastó la decisión, que cuenta en el presupuesto [R63.15]. */
  route(
    request: { nodeId: Id; candidates: RouteCandidate[]; input: Payload },
    signal: AbortSignal,
  ): Promise<{ edgeIds: Id[]; reason: string; usage?: TransformUsage }>;
  judge(
    request: { prompt: string; output: Payload; iteration: number },
    signal: AbortSignal,
  ): Promise<{ done: boolean; reason: string; usage?: TransformUsage }>;
  condition(
    request: { condition: string; input: Payload },
    signal: AbortSignal,
  ): Promise<boolean>;
  /** Todas las condiciones de un router en una sola consulta. Opcional: sin ella, `condition` una por una [R63.16]. */
  conditions?(
    request: { conditions: { edgeId: Id; condition: string }[]; input: Payload },
    signal: AbortSignal,
  ): Promise<{ results: Record<Id, boolean>; usage?: TransformUsage }>;
  /** Qué paso tiene que rehacer el trabajo según las correcciones del usuario. Opcional [R53.5][R53.17]. */
  blame?(request: { feedback: string; candidates: BlameCandidate[] }, signal: AbortSignal): Promise<{ nodeId: Id; reason: string }>;
  /** Decide una revisión sin veredicto escrito. Opcional: sin él, se usa `judge` [R34.26]. */
  judgeReview?(request: JudgeRequest, signal: AbortSignal): Promise<JudgeVerdict>;
  /** ¿Lo que hizo un paso corresponde a lo pedido? [R60.12] */
  supervise?(request: SupervisorReview, signal: AbortSignal): Promise<SupervisorVerdict>;
  /** ¿El resultado cumple lo que pidió la persona? [R62.9] */
  verifyRun?(request: RunVerification, signal: AbortSignal): Promise<RunVerdict>;
  /** Nodo «Transformar» con Claude: devuelve el texto convertido. Opcional: sin él, el nodo falla [R37.6]. */
  transform?(request: TransformRequest, signal: AbortSignal): Promise<{ text: string; usage?: TransformUsage }>;
}

export interface TransformRequest {
  nodeId: Id;
  format: TransformFormat;
  instructions: string;
  schema?: string;
  input: Payload;
  attempt: number;
  /** Por qué no valió el intento anterior [R37.7]. */
  previousError?: string;
  /** Lo pide el entregable de la ejecución: qué elemento compone [R46.6][R46.10]. */
  deliverable?: { kind: 'summary' | 'json' | 'custom'; title?: string; steps: number; files: number };
}

/** Tokens de un turno de composición, si el motor los conoce [R46.9]. */
export interface TransformUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
}
