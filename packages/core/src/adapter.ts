import type { Id, KnowledgeExtra, KnowledgeKind, Payload, TransformFormat } from './types';

export type FileChange = 'created' | 'modified';
/** Cómo se cambió: con un comando, sin pasar por las herramientas de edición ni dejar copia [R55.3]. */
export type FileVia = 'command';

export type AgentStreamEvent =
  | { type: 'token'; text: string }
  | { type: 'tool_call'; tool: string; input: unknown }
  | { type: 'tool_result'; tool: string; ok: boolean; output?: string; /** Id de la llamada, si el motor lo da [R55.2]. */ id?: string }
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

export interface AgentQuestion {
  text: string;
  options?: string[];
  /** Confirmación del paso antes de terminar (vuelta N) [R43.5]. */
  confirm?: { round: number };
  /** Quién pregunta: el agente, la app pidiendo permiso o la supervisión de R39.4 [R45.3]. */
  kind?: QuestionKind;
  /** Pregunta de una revisión humana: qué cambiar o a qué paso volver [R53.3][R53.5]. */
  review?: ReviewQuestion;
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

export type QuestionKind = 'question' | 'permission' | 'gate';

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
  /** Qué se entregará al final: contrato completo (pasos finales) o una línea de objetivo [R46.4]. */
  deliverable?: { role: 'final' | 'goal'; text: string };
  /** Número de intento (1 = primero). */
  attempt: number;
  /** Pregunta al usuario y espera su respuesta (chat en el nodo). */
  ask(question: AgentQuestion): Promise<string>;
  /** Preguntas ya respondidas en intentos anteriores del mismo nodo. */
  previousAnswers: AnsweredQuestion[];
}

/** Contrato que implementa cada motor de agentes (Claude Agent SDK, simulado, ...). */
export interface AgentAdapter {
  run(request: AgentRequest, signal: AbortSignal): AsyncIterable<AgentStreamEvent>;
}

/** Error de un adapter. `retriable` indica si el orquestador puede reintentar. */
export class AgentError extends Error {
  constructor(
    message: string,
    readonly retriable = false,
    /** Obligatorios sin usar que provocaron el error [R36.11]. */
    readonly missed: KnowledgeRef[] = [],
  ) {
    super(message);
    this.name = 'AgentError';
  }
}

export interface RouteCandidate {
  edgeId: Id;
  to: Id;
  label: string;
}

/** Decisiones que toma la IA fuera de los agentes de trabajo: enrutado, condiciones y evaluador de bucles. */
export interface Decider {
  route(
    request: { nodeId: Id; candidates: RouteCandidate[]; input: Payload },
    signal: AbortSignal,
  ): Promise<{ edgeIds: Id[]; reason: string }>;
  judge(
    request: { prompt: string; output: Payload; iteration: number },
    signal: AbortSignal,
  ): Promise<{ done: boolean; reason: string }>;
  condition(
    request: { condition: string; input: Payload },
    signal: AbortSignal,
  ): Promise<boolean>;
  /** Qué paso tiene que rehacer el trabajo según las correcciones del usuario. Opcional [R53.5][R53.17]. */
  blame?(request: { feedback: string; candidates: BlameCandidate[] }, signal: AbortSignal): Promise<{ nodeId: Id; reason: string }>;
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
