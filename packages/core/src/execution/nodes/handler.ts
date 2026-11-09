import type { DeliverableSpec, Diagram, DiagramNode, Edge, ReturnInfo } from '../../diagrams';
import type { SharedResources } from '../resources-port';
import type { Id, KnowledgeExtra, Payload, StepCheck, StepLimits } from '../../shared';
import type { CheckRunner } from '../checks-port';
import type { AgentAdapter, AgentProfile, AgentSnapshot, Decider, FileChange, RestoreResult, TransformUsage } from '../adapter';
import type { BudgetTracker } from '../run/budget-tracker';
import type { ConcurrencyLimiter } from '../run/concurrency-limiter';
import type { PauseGate } from '../run/pause-gate';
import type { QuestionBroker } from '../run/question-broker';
import type { ResumeCache } from '../run/resume-cache';
import type { RetryPolicy } from '../run/retry-policy';
import type { RunEmitter } from '../run/run-emitter';
import type { Supervisor } from '../run/supervisor';
import type { RunMemoryService } from '../run/memory-service';
import type { Timers } from '../run/timers';
import type { BranchSpaces, SpaceRef } from '../branch-spaces';

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
  /** Hueco global y enfriamiento de los proveedores, si la app los comparte [R77.1][R77.4]. */
  resources?: SharedResources;
  /** Vigila la ejecución, si la app lo activa [R60.1]. */
  supervisor?: Supervisor;
  /** La memoria de la ejecución, con el Supervisor o si se pide [R72.3]. */
  memory?: RunMemoryService;
  questions: QuestionBroker;
  retry: RetryPolicy;
  cache: ResumeCache;
  decider: Decider;
  getAdapter(agentId: Id): AgentAdapter;
  /** Etiqueta de cada paso por ruta, para el Supervisor [R63.6]. */
  labels: Map<string, string>;
  describeAgent?(agentId: Id): AgentSnapshot | undefined;
  /** Ficha de un agente, con lo enchufado a su paso [R59.18]. */
  agentProfile?(agentId: Id, extra: KnowledgeExtra | undefined, runId: Id): Promise<AgentProfile | undefined>;
  resolveTemplate?(templateId: Id, version: number | 'latest', runId?: Id): Promise<Diagram> | Diagram;
  maxDepth: number;
  /** Tiempo máximo de cada decisión [R70.12]. */
  decisionTimeoutMs: number;
  /** Diagrama principal (etiquetas y entrada para componer el entregable). */
  root: Diagram;
  /** Conocimiento del diagrama raíz, que reciben todos sus agentes [R33.3]. */
  rootExtra: KnowledgeExtra | undefined;
  /** Entregable efectivo de la ejecución y pasos finales del nivel principal [R46.3][R46.2]. */
  deliverable: DeliverableSpec | undefined;
  finalIds: ReadonlySet<Id>;
  /** Motivo con el que falla la ejecución cuando lo da un paso (p. ej. el entregable) [R46.8]. */
  failRun(reason: string): void;
  /** Devuelve al punto de partida archivos de un intento fallido, si la app sabe hacerlo [R71.10]. */
  restoreFiles?(files: { path: string; change?: FileChange }[], dir?: string): Promise<RestoreResult>;
  /** Ejecuta las comprobaciones que lanzan procesos o miran el disco [R75.4]. */
  checkRunner?: CheckRunner;
  /** Memoria del proyecto que recibe un agente [R76.14]. */
  projectMemory?(agentId: Id): Promise<{ text: string; ids: Id[]; scopes?: string[] } | undefined>;
  /** Comprobaciones de la ficha de un agente [R75.2]. */
  agentChecks?(agentId: Id): Promise<StepCheck[] | undefined>;
  /** Espacios de las ramas en paralelo, si la app las aísla [R73.2]. */
  spaces?: BranchSpaces;
  /** ¿Puede escribir este agente? Una rama solo de lectura no se aísla [R73.2]. */
  canWrite?(agentId: Id): Promise<boolean>;
  /** Para la ejecución con un motivo (p. ej. un conflicto que la persona no quiere resolver) [R73.14]. */
  halt(reason: string): void;
  /** Reloj de la ejecución, inyectable [R70.9]. */
  timers: Timers;
  /** Límites efectivos de un paso: los suyos, los de su agente y los de la ejecución [R70.7]. */
  limitsFor(node: DiagramNode): Promise<StepLimits>;
  /** Siguiente pasada de un nodo en una ruta (1, 2…) [R74.1]. */
  nextPass(path: readonly Id[], nodeId: Id): number;
  /** Plantillas de los subdiagramas, resueltas y validadas antes de empezar [R74.9]. */
  templates?: Map<string, Diagram>;
  /** Ejecuta un diagrama anidado (cuerpo de bucle o subdiagrama). */
  execute(diagram: Diagram, input: Payload, path: Id[], depth: number, stack: Id[], space?: SpaceRef): Promise<DiagramOutcome>;
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
  /** Espacio aislado de la rama en la que está el paso, si lo hay [R73.2]. */
  space?: SpaceRef;
  /** Clave estable del paso: ruta, nodo y pasada [R74.1]. */
  stepKey: string;
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

/** Lo que gasta una decisión (router, condiciones, evaluador de bucles) cuenta en el presupuesto y en el uso [R63.15]. */
export function chargeDecision(step: Pick<StepContext, 'emitter' | 'budget'>, node: DiagramNode, path: Id[], usage: TransformUsage | undefined): void {
  if (!usage) return;
  step.emitter.emit({ type: 'agent.usage', nodeId: node.id, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, ...(usage.costUsd !== undefined ? { costUsd: usage.costUsd } : {}), source: 'decision' }, path);
  step.budget.add(usage.inputTokens, usage.outputTokens, usage.costUsd);
}
