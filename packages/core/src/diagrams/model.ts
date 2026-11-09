import type { AiReviewMode, Id, KnowledgeExtra, StepCheck, StepLimits, VerifySettings } from '../shared';

export const CURRENT_SCHEMA_VERSION = 1;

/** Longitud máxima de la tarea de un nodo [R32.1]. */
export const MAX_TASK_LENGTH = 20_000;

export type NodeKind = 'entry' | 'output' | 'agent' | 'router' | 'loop' | 'subdiagram' | 'review' | 'transform';

export type TransformFormat = 'json' | 'markdown' | 'text';

/** Convierte lo que llega a un formato fijo, por reglas o con Claude [R37.1]. */
export interface TransformConfig {
  mode: 'rules' | 'ai';
  format: TransformFormat;
  /** Reglas: plantilla con `{{entrada}}`, `{{archivos}}`, `{{json}}` y `{{json.ruta}}` [R37.3]. */
  template?: string;
  /** Con Claude: qué tiene que producir [R37.6]. */
  instructions?: string;
  /** Texto de un JSON Schema; solo con formato `json` [R37.9]. */
  schema?: string;
  /** Con Claude: intentos si el resultado no cumple el formato (1–5, por defecto 2) [R37.7]. */
  maxAttempts?: number;
  /** Ejemplo de entrada para la vista previa del editor; no influye en la ejecución [R37.13]. */
  sample?: string;
}

/** Límite de los textos de un nodo transformar [R37.2]. */
export const MAX_TRANSFORM_TEXT = 20_000;

export const DEFAULT_TRANSFORM_ATTEMPTS = 2;

export const MAX_TRANSFORM_ATTEMPTS = 5;

/** Salidas fijas de una revisión [R34.1]. */
export type ReviewPort = 'approved' | 'rejected' | 'exhausted';

export const REVIEW_PORTS: readonly ReviewPort[] = ['approved', 'rejected', 'exhausted'];

/** Tope de vueltas de una revisión [R34.1]. */
export const MAX_REVIEW_ROUNDS = 10;

export interface ReviewConfig {
  /** Vueltas como máximo (1..10); al agotarse sale por `exhausted` [R34.1]. */
  maxRounds: number;
  /**
   * `verdict`: lee «VEREDICTO: …» del texto y, si falta, pregunta a la IA. `ai`: siempre la IA [R34.6].
   * `human`: la ejecución espera a que el usuario apruebe o pida cambios [R53.1].
   */
  mode: 'verdict' | 'ai' | 'human';
  /** Solo en modo `human` con ✗ sin conectar: el asistente propone y el usuario confirma, o decide solo [R53.1]. */
  route?: 'propose' | 'auto';
  /** Criterio para la IA. */
  criteria?: string;
}

export interface RouterConfig {
  /** `ai`: lo decide un Decider (IA). `rules`: se evalúa la condición de cada arista saliente. */
  mode: 'ai' | 'rules';
  /** Solo en modo `ai`: cómo elegir, escrito por la persona [R81.1]. */
  criteria?: string;
}

export interface LoopConfig {
  mode: 'count' | 'ai-judge';
  /** Solo en modo `count`. */
  count?: number;
  /** Solo en modo `ai-judge`: condición que evalúa el evaluador IA. */
  prompt?: string;
  /** Obligatorio: tope de seguridad de vueltas. */
  maxIterations: number;
  /** Diagrama interno que se repite (con su propio `entry` y `output`). */
  body: Diagram;
}

export interface SubdiagramConfig {
  templateId: Id;
  version: number | 'latest';
}

export interface DiagramNode {
  id: Id;
  kind: NodeKind;
  label?: string;
  agentId?: Id;
  /** Solo en nodos `agent`: qué tiene que hacer en este paso; la entrada va debajo [R32.1]. */
  task?: string;
  /** Solo en nodos `agent`: conocimiento que el agente usa únicamente en este paso [R33.1]. */
  extra?: KnowledgeExtra;
  /** Solo en nodos `agent`: modelo de IA de este paso; sin él, el de la ficha del agente [R40.1]. */
  model?: string;
  /** Solo en nodos `agent`: al terminar, espera a que el usuario apruebe o pida cambios [R43.2]. */
  confirm?: boolean;
  /** Solo en nodos `agent`: latido, duración y presupuesto propios [R70.7][R77.9]. */
  limits?: StepLimits;
  /** Solo en nodos `agent`: qué hacer con lo que dejó un intento fallido; por defecto, conservarlo [R71.10]. */
  onRetry?: 'keep' | 'restore';
  /** Solo en nodos `agent`: comprobaciones deterministas al terminar [R75.1]. */
  checks?: StepCheck[];
  /** Solo en nodos `agent`: cuándo lo revisa la IA; por defecto, siempre [R75.11]. */
  aiReview?: AiReviewMode;
  /** Solo en nodos `agent`: verificar con un agente que ejecuta y observa [R75.13]. */
  verify?: VerifySettings;
  router?: RouterConfig;
  loop?: LoopConfig;
  review?: ReviewConfig;
  subdiagram?: SubdiagramConfig;
  transform?: TransformConfig;
  /** Posición en el lienzo del editor; no influye en la ejecución. */
  position?: { x: number; y: number };
}

export interface Edge {
  id: Id;
  from: Id;
  to: Id;
  /** Condición de la arista cuando sale de un router en modo `rules`. */
  condition?: string;
  /** Salida de la revisión de la que parte la arista [R34.1]. */
  port?: ReviewPort;
}

export interface Diagram {
  id: Id;
  name: string;
  schemaVersion: number;
  nodes: DiagramNode[];
  edges: Edge[];
  /** Conocimiento que reciben todos los agentes de este diagrama (también dentro de sus bucles) [R33.1]. */
  extra?: KnowledgeExtra;
  /** Qué se entrega al final de la ejecución; solo cuenta en el diagrama principal [R46.3]. */
  deliverable?: DeliverableSpec;
  /** Comprobaciones de la ejecución entera, antes de la comprobación final [R75.17]. */
  checks?: StepCheck[];
  /** Verificar con un agente cada paso final [R75.13]. */
  verify?: VerifySettings;
}

/** Un elemento del entregable de una ejecución [R46.1]. */
export type DeliverableItem =
  | { kind: 'links' }
  | { kind: 'summary'; instructions?: string }
  | { kind: 'json'; schema?: string; instructions?: string }
  | { kind: 'custom'; title: string; instructions: string };

export type DeliverableKind = DeliverableItem['kind'];

/** Lo que el usuario quiere recibir al terminar la ejecución [R46.1]. */
export interface DeliverableSpec {
  items: DeliverableItem[];
  /** A quién se avisa: pasos finales (por defecto), todos o nadie [R46.4]. */
  notify?: 'final' | 'all' | 'none';
  /** Si algún elemento no se completa: aviso (por defecto) o fallar la ejecución [R46.8]. */
  onMissing?: 'warn' | 'fail';
  /** Nombre del archivo sin extensión; por defecto `entregable` [R46.11]. */
  fileName?: string;
}
