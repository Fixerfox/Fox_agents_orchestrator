export type Id = string;

export const CURRENT_SCHEMA_VERSION = 1;

/** Longitud máxima de la tarea de un nodo [R32.1]. */
export const MAX_TASK_LENGTH = 20_000;

/** Lo que viaja por una conexión entre nodos: texto de salida + archivos del espacio de trabajo. */
export interface Payload {
  text: string;
  files: string[];
}

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

/**
 * Conocimiento añadido sin tocar al agente: skills, contextos y servidores MCP que valen solo para un paso
 * o para todo un diagrama [R33.1].
 */
export interface KnowledgeExtra {
  skillIds?: Id[];
  contextIds?: Id[];
  mcpIds?: Id[];
  /** Cuáles de las listas anteriores son obligatorios en esta asignación; es un subconjunto de ellas [R36.1]. */
  required?: KnowledgeLists;
}

/** Las tres listas de ids de un conocimiento añadido. */
export interface KnowledgeLists {
  skillIds?: Id[];
  contextIds?: Id[];
  mcpIds?: Id[];
}

/** Tipo de elemento de conocimiento [R36.13]. */
export type KnowledgeKind = 'skill' | 'context' | 'mcp';
export const KNOWLEDGE_LIST_KEYS = ['skillIds', 'contextIds', 'mcpIds'] as const;
export const KNOWLEDGE_KIND_OF = { skillIds: 'skill', contextIds: 'context', mcpIds: 'mcp' } as const;
/** Máximo de elementos de cada tipo en un conocimiento añadido [R33.2]. */
export const MAX_EXTRA_ITEMS = 50;

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

/**
 * Une listas de ids sin repetir, en orden [R33.3]. Lo obligatorio en cualquier parte lo es en el resultado
 * (aunque en otra sea opcional) y solo se conserva si sigue en la lista [R36.3][R36.4].
 */
export function mergeExtra(...parts: (KnowledgeExtra | undefined)[]): KnowledgeExtra {
  const out: KnowledgeExtra = {};
  const required: KnowledgeLists = {};
  for (const k of KNOWLEDGE_LIST_KEYS) {
    const v = [...new Set(parts.flatMap((p) => p?.[k] ?? []))];
    if (v.length === 0) continue;
    out[k] = v;
    const r = [...new Set(parts.flatMap((p) => p?.required?.[k] ?? []))].filter((id) => v.includes(id));
    if (r.length > 0) required[k] = r;
  }
  if (Object.keys(required).length > 0) out.required = required;
  return out;
}

/** Listas cuyo contenido es obligatorio siempre que está enchufado a un paso [R36.21]. */
export const STEP_FORCED_KEYS = ['skillIds', 'mcpIds'] as const;

/**
 * Conocimiento de un paso tal como se ejecuta: toda skill y todo MCP enchufado es obligatorio, esté o no en
 * `required`; los contextos conservan su marca [R36.21]. No cambia el diagrama guardado.
 */
export function stepExtra(extra: KnowledgeExtra | undefined): KnowledgeExtra | undefined {
  if (!extra) return undefined;
  const required: KnowledgeLists = { ...extra.required };
  for (const k of STEP_FORCED_KEYS) if ((extra[k] ?? []).length > 0) required[k] = [...new Set([...(extra.required?.[k] ?? []), ...(extra[k] ?? [])])];
  return mergeExtra({ ...extra, required });
}

export type NodeStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'waiting_input'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'skipped';

export type RunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface RunOptions {
  budget?: { maxTokens?: number; maxCostUsd?: number };
  /** Agentes en paralelo. Por defecto 4. */
  maxConcurrency?: number;
  /** Profundidad máxima de anidación (bucles y subdiagramas). Por defecto 8. */
  maxDepth?: number;
  /** Tiempo máximo esperando la respuesta del usuario a una pregunta de un agente. Sin límite por defecto. */
  questionTimeoutMs?: number;
  /** Reintentos ante errores temporales: intentos totales y espera inicial (se duplica en cada intento). */
  retry?: { maxAttempts: number; baseDelayMs: number };
  /** Reanudar: salidas de pasos del nivel principal que no se vuelven a ejecutar, y de qué ejecución vienen [R41.1]. */
  reuse?: {
    fromRunId: string;
    outputs: Record<string, Payload>;
    /** Revisiones humanas ya aprobadas en la anterior: aprueban sin preguntar la primera vez [R53.9]. */
    approvedReviews?: string[];
  };
  /** Corregir: el paso del nivel principal que recibe la corrección y su entrega anterior [R53.8]. */
  correction?: { fromRunId: string; nodeId: string; text: string; previous: Payload; files?: string[] };
  /** Entregable solo para esta ejecución; sustituye al del diagrama, y `null` lo quita [R46.3]. */
  deliverable?: DeliverableSpec | null;
}
