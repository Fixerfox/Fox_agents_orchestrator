import type { RunEvent } from './events';
import type { RetryConfig } from './run/retry-policy';
import type { DeliverableSpec } from '../diagrams';
import type { Payload, StepLimits, UnansweredPolicy } from '../shared';

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
  /**
   * Antiguo tiempo máximo de una pregunta; equivale a `unanswered` con `action: 'fail'` [R70.18].
   * @deprecated usa `unanswered`.
   */
  questionTimeoutMs?: number;
  /** Qué hacer con una pregunta que nadie responde; por defecto, esperar [R70.14]. */
  unanswered?: UnansweredPolicy;
  /** Límites de los pasos de agente de esta ejecución (los de Ajustes); el paso y la ficha mandan [R70.7]. */
  limits?: StepLimits;
  /** Tiempo máximo de cada decisión (router, juez, transformar…); 120 s por defecto [R70.12]. */
  decisionTimeoutMs?: number;
  /** Reintentos ante errores temporales: intentos totales y espera inicial (se duplica en cada intento). */
  retry?: RetryConfig;
  /** Reanudar: salidas de pasos del nivel principal que no se vuelven a ejecutar, y de qué ejecución vienen [R41.1]. */
  reuse?: {
    fromRunId: string;
    outputs: Record<string, Payload>;
    /** Revisiones humanas ya aprobadas en la anterior: aprueban sin preguntar la primera vez [R53.9]. */
    approvedReviews?: string[];
    /** Rastro de cada paso reutilizado [R41.7]. */
    trail?: Record<string, readonly RunEvent[]>;
  };
  /** Corregir: el paso del nivel principal que recibe la corrección y su entrega anterior [R53.8]. */
  correction?: {
    fromRunId: string;
    nodeId: string;
    text: string;
    previous: Payload;
    files?: string[];
    /** Lo que entregaron en la anterior los pasos que se repiten [R62.16]. */
    before?: { step: string; text: string; files: string[] }[];
  };
  /** Entregable solo para esta ejecución; sustituye al del diagrama, y `null` lo quita [R46.3]. */
  deliverable?: DeliverableSpec | null;
}
