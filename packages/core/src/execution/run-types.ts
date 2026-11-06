import type { DeliverableSpec } from '../diagrams';
import type { Payload } from '../shared';

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
