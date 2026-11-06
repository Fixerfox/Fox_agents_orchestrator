import type { DeliverableSpec, Diagram, DiagramNode, Edge, ReturnInfo } from '../../diagrams';
import type { Id, KnowledgeExtra, Payload } from '../../shared';
import type { AgentAdapter, AgentProfile, AgentSnapshot, Decider } from '../adapter';
import type { BudgetTracker } from '../run/budget-tracker';
import type { ConcurrencyLimiter } from '../run/concurrency-limiter';
import type { PauseGate } from '../run/pause-gate';
import type { QuestionBroker } from '../run/question-broker';
import type { ResumeCache } from '../run/resume-cache';
import type { RetryPolicy } from '../run/retry-policy';
import type { RunEmitter } from '../run/run-emitter';

/** Cómo acaba un paso. */
export interface Outcome {
  status: 'succeeded' | 'failed' | 'cancelled';
  output?: Payload;
  /** Aristas elegidas por un router; si falta, se entregan todas. */
  chosen?: Set<Id>;
  /** Retorno de una revisión que rechaza: se repite el tramo [R34.8]. */
  back?: ReturnInfo;
}

/** Cómo acaba un diagrama entero (el principal, el cuerpo de un bucle o un subdiagrama). */
export interface DiagramOutcome {
  status: 'succeeded' | 'failed' | 'cancelled';
  output?: Payload;
}

/** Lo que una revisión necesita de su nivel para volver a un paso elegido al vuelo [R53.5]. */
export interface ReviewLevel {
  diagram: Diagram;
  lastOutput: Map<Id, Payload>;
  forward: Edge[];
}

/** Servicios y datos de toda la ejecución, iguales para todos sus pasos [R56.13]. */
export interface RunServices {
  signal: AbortSignal;
  emitter: RunEmitter;
  gate: PauseGate;
  limiter: ConcurrencyLimiter;
  budget: BudgetTracker;
  questions: QuestionBroker;
  retry: RetryPolicy;
  cache: ResumeCache;
  decider: Decider;
  getAdapter(agentId: Id): AgentAdapter;
  describeAgent?(agentId: Id): AgentSnapshot | undefined;
  /** Ficha de un agente, con lo enchufado a su paso [R59.18]. */
  agentProfile?(agentId: Id, extra: KnowledgeExtra | undefined, runId: Id): Promise<AgentProfile | undefined>;
  resolveTemplate?(templateId: Id, version: number | 'latest', runId?: Id): Promise<Diagram> | Diagram;
  maxDepth: number;
  /** Diagrama principal (etiquetas y entrada para componer el entregable). */
  root: Diagram;
  /** Conocimiento del diagrama raíz, que reciben todos sus agentes [R33.3]. */
  rootExtra: KnowledgeExtra | undefined;
  /** Entregable efectivo de la ejecución y pasos finales del nivel principal [R46.3][R46.2]. */
  deliverable: DeliverableSpec | undefined;
  finalIds: ReadonlySet<Id>;
  /** Motivo con el que falla la ejecución cuando lo da un paso (p. ej. el entregable) [R46.8]. */
  failRun(reason: string): void;
  /** Ejecuta un diagrama anidado (cuerpo de bucle o subdiagrama). */
  execute(diagram: Diagram, input: Payload, path: Id[], depth: number, stack: Id[]): Promise<DiagramOutcome>;
}

/** Todo lo que ve un paso: los servicios de la ejecución y su sitio en el diagrama [R56.13]. */
export interface StepContext extends RunServices {
  outEdges: Edge[];
  nodeById: ReadonlyMap<Id, DiagramNode>;
  depth: number;
  stack: Id[];
  /** Solo en revisiones: vuelta actual, retorno conectado y su nivel [R34.11][R53.5]. */
  round: number;
  back: ReturnInfo | undefined;
  level: ReviewLevel;
}

/** Comportamiento de un tipo de nodo [R56.12]. */
export interface NodeHandler {
  kind: string;
  run(step: StepContext, node: DiagramNode, input: Payload, path: Id[]): Promise<Outcome>;
}

export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Falla el paso con un error definitivo. */
export function failStep(step: Pick<StepContext, 'emitter'>, node: DiagramNode, message: string, path: Id[]): Outcome {
  step.emitter.error(node.id, message, path);
  return { status: 'failed' };
}

/** Marca que el paso ha empezado. */
export const nodeStarted = (step: Pick<StepContext, 'emitter'>, node: DiagramNode, input: Payload, path: Id[]): void => {
  step.emitter.emit({ type: 'node.started', nodeId: node.id, input }, path);
};
