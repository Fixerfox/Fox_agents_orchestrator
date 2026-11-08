import type { Diagram } from '../diagrams';
import type { Id, KnowledgeExtra, Payload, StepCheck, StepLimits, StopAt } from '../shared';
import type { AgentAdapter, AgentProfile, AgentSnapshot, Decider, FileChange, RestoreResult } from './adapter';
import type { BranchSpaces } from './branch-spaces';
import type { CheckRunner, EvidenceSource } from './checks-port';
import type { EventBus, RunEvent } from './events';
import type { NodeRegistry } from './nodes/registry';
import type { PendingQuestion } from './run/question-broker';
import type { RunStatus } from './run-types';
import type { Timers } from './run/timers';

export interface OrchestratorDeps {
  getAdapter(agentId: Id): AgentAdapter;
  decider: Decider;
  /** Foto de la configuración del agente para dejarla en el log. */
  describeAgent?(agentId: Id): AgentSnapshot | undefined;
  /** Ficha de un agente para quien reparte [R59.18]. */
  agentProfile?(agentId: Id, extra: KnowledgeExtra | undefined, runId: Id): Promise<AgentProfile | undefined>;
  /** `runId`: un subdiagrama se lee de la copia que se hizo al lanzar la ejecución [R52.1]. */
  resolveTemplate?(templateId: Id, version: number | 'latest', runId?: Id): Promise<Diagram> | Diagram;
  sleep?(ms: number, signal: AbortSignal): Promise<void>;
  now?(): Date;
  newRunId?(): Id;
  /** Activa el Supervisor; `review` dice si revisa con IA, y se pregunta en cada paso [R60.1]. */
  supervisor?: { review(): boolean; model?(): string; humanChecks?(): 'warn' | 'fail'; settleMs?: number; checkMs?: number; stopAt?(): StopAt; unverified?(): 'warn' | 'fail' };
  /** Comprobaciones deterministas y evidencia para la revisión [R75.1]–[R75.7]. */
  checks?: { runner?: CheckRunner; evidence?: EvidenceSource; agentChecks?(agentId: Id, runId: Id): Promise<StepCheck[] | undefined> };
  /** Tipos de nodo; por defecto, los de la aplicación [R56.12]. */
  nodes?: NodeRegistry;
  /**
   * Fija al arrancar cada ejecución el motor que usará hasta el final: agentes, decisiones y si el Supervisor revisa
   * con IA. Sin él se usan `getAdapter` y `decider` tal cual [R63.13].
   */
  forRun?(): { getAdapter(agentId: Id): AgentAdapter; decider: Decider; review?(): boolean };
  /** Memoria de la ejecución; va con el Supervisor, o sola con esto; `tokens`, su tope [R72.3][R72.15]. */
  memory?: { tokens?(): number | undefined };
  /** Temporizadores y reloj; por defecto, los del sistema [R70.9]. */
  timers?: Timers;
  /** Límites de la ficha de un agente [R70.7]. */
  agentLimits?(agentId: Id, runId: Id): StepLimits | undefined | Promise<StepLimits | undefined>;
  /** Aleatorio de las esperas con jitter [R71.3]. */
  random?(): number;
  /** Devuelve al punto de partida lo que tocó un intento fallido [R71.10]. */
  restoreFiles?(runId: Id, files: { path: string; change?: FileChange }[], dir?: string): Promise<RestoreResult>;
  /** Espacios para aislar las ramas en paralelo de esta ejecución; sin él, comparten carpeta [R73.2]. */
  spaces?(runId: Id): BranchSpaces | undefined;
  /** ¿Puede escribir el agente? Por defecto, sí [R73.2]. */
  canWrite?(agentId: Id, runId: Id): boolean | Promise<boolean>;
}

export interface RunResult {
  runId: Id;
  status: RunStatus;
  reason?: string;
  output?: Payload;
  events: readonly RunEvent[];
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
}


export interface RunHandle {
  runId: Id;
  bus: EventBus;
  result: Promise<RunResult>;
  /** Pausa cooperativa: se detiene antes de empezar nodos y entre pasos de un agente. */
  pause(): void;
  resume(): void;
  cancel(reason?: string): void;
  /** Responde a una pregunta de un agente. `false` si no existe o ya se respondió. */
  answer(questionId: string, text: string): boolean;
  pendingQuestions(): PendingQuestion[];
  /** La persona dice si un aviso era cierto [R75.21]. */
  feedback(alertSeq: number, verdict: 'false-alarm' | 'confirmed', note?: string): boolean;
}

