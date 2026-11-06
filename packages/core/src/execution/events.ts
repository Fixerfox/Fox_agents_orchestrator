import type { DeliverableSpec, TransformFormat } from '../diagrams';
import { type Id, type KnowledgeExtra, type KnowledgeKind, type Payload, redactSecrets } from '../shared';
import type { AgentSnapshot, AnsweredQuestion, FileChange, FileVia, KnowledgeVia, QuestionKind, ReviewQuestion } from './adapter';
import type { DeliverableItemResult, DeliverableLinks } from './deliverable';
import type { NodeStatus, RunStatus } from './run-types';

export type EventBody =
  | { type: 'run.started'; diagramId: Id; /** Ejecución que esta reanuda [R41.1]. */ resumedFrom?: string; /** Ejecución que esta corrige [R53.8]. */ correctedFrom?: string; /** Entregable efectivo [R46.3]. */ deliverable?: DeliverableSpec }
  | { type: 'run.finished'; status: RunStatus; reason?: string }
  | { type: 'run.cancelled'; reason?: string }
  | { type: 'run.paused' }
  | { type: 'run.resumed' }
  | { type: 'run.budget_reached'; limit: 'tokens' | 'cost'; used: number; max: number }
  | { type: 'node.queued'; nodeId: Id }
  | { type: 'node.started'; nodeId: Id; input?: Payload }
  | {
      /** Lo que recibe exactamente el agente en cada intento, con la configuración usada. */
      type: 'agent.request';
      nodeId: Id;
      agentId: Id;
      attempt: number;
      input: Payload;
      task?: string;
      /** Modelo elegido en el paso, si lo tiene [R40.3]. */
      model?: string;
      /** El paso confirma antes de terminar [R43.4]. */
      confirm?: boolean;
      /** Aviso del entregable que recibe este paso [R46.4]. */
      deliverable?: { role: 'final' | 'goal'; text: string };
      /** Lo añadido por el diagrama y por el paso, para saber de dónde vino cada cosa [R33.4]. */
      extra?: { diagram?: KnowledgeExtra; node?: KnowledgeExtra };
      snapshot?: AgentSnapshot;
      previousAnswers?: AnsweredQuestion[];
    }
  | {
      /** Decisión tomada por la IA fuera de los agentes de trabajo (enrutado, condición, evaluador de bucle). */
      type: 'decision';
      nodeId: Id;
      kind: 'route' | 'condition' | 'judge';
      request: unknown;
      response: unknown;
    }
  | { type: 'node.finished'; nodeId: Id; status: NodeStatus; output?: Payload }
  /** El paso no se ejecuta: se reutiliza la salida que dio en la ejecución reanudada [R41.1]. */
  | { type: 'node.reused'; nodeId: Id; fromRunId: string }
  | {
      type: 'node.retrying';
      nodeId: Id;
      attempt: number;
      max: number;
      delayMs: number;
      message: string;
    }
  | { type: 'token.stream'; nodeId: Id; text: string }
  | { type: 'tool.called'; nodeId: Id; tool: string; input: unknown }
  | { type: 'tool.result'; nodeId: Id; tool: string; ok: boolean; output?: string }
  /** Skill, contexto o MCP entregado o usado por el agente en un intento [R36.13]. */
  | { type: 'knowledge.used'; nodeId: Id; attempt: number; kind: KnowledgeKind; id: Id; via: KnowledgeVia; required: boolean }
  /** Obligatorio que el agente no usó en un intento [R36.13]. */
  | { type: 'knowledge.unmet'; nodeId: Id; attempt: number; kind: KnowledgeKind; id: Id }
  | { type: 'agent.question'; nodeId: Id; questionId: string; text: string; options?: string[]; /** Confirmación del paso [R43.5]. */ confirm?: { round: number }; /** [R45.3] */ kind?: QuestionKind; /** Revisión humana [R53.3] */ review?: ReviewQuestion }
  /** Respuesta a una confirmación: aprobada o con cambios pedidos [R43.6][R43.7]. */
  | { type: 'confirm.decided'; nodeId: Id; round: number; verdict: 'approved' | 'changes'; text?: string }
  | { type: 'agent.answer'; nodeId: Id; questionId: string; text: string }
  /** Revisión humana: a qué paso vuelve el trabajo y quién lo decidió [R53.5]. */
  | { type: 'correction.routed'; nodeId: Id; round: number; targetId: Id; reason: string; by: 'assistant' | 'user' }
  /** El paso corregido de una corrección arranca con la corrección del usuario [R53.8]. */
  | { type: 'correction.applied'; nodeId: Id; fromRunId: string; text: string }
  | {
      type: 'agent.usage';
      nodeId: Id;
      inputTokens: number;
      outputTokens: number;
      costUsd?: number;
    }
  /** Archivo escrito por el paso; `change` dice si es nuevo o modificado (los adaptadores que no lo saben lo omiten) [R45.2]. */
  | { type: 'file.produced'; nodeId: Id; path: string; change?: FileChange; /** [R55.3] */ via?: FileVia }
  | { type: 'workspace.merged'; nodeId: Id; files: string[] }
  | { type: 'workspace.conflict'; nodeIds: Id[]; files: string[] }
  | { type: 'iteration.snapshot'; loopId: Id; n: number; path: string }
  | {
      type: 'route.decided';
      fromNodeId: Id;
      /** Ids de los nodos destino elegidos. */
      chosen: Id[];
      mode: 'ai' | 'rules';
      reason: string;
    }
  | { type: 'edge.traversed'; edgeId: Id; fromNodeId: Id; toNodeId: Id }
  | {
      type: 'loop.iteration';
      loopId: Id;
      n: number;
      max: number;
      verdict: 'continue' | 'done';
      reason?: string;
    }
  | {
      /** Decisión de una revisión: aprobado, rechazado (vuelve atrás o sigue por ✗) o agotado [R34.12]. */
      type: 'review.decided';
      nodeId: Id;
      round: number;
      max: number;
      verdict: 'approved' | 'rejected' | 'exhausted';
      /** `human`: la decidió el usuario; `reused`: ya se aprobó en la ejecución anterior [R53.3][R53.9]. */
      source: 'verdict' | 'ai' | 'human' | 'reused';
      reason?: string;
      /** Nodo al que vuelve cuando se recorre el retorno. */
      returnTo?: Id;
    }
  | { type: 'subdiagram.started'; nodeId: Id; templateId: Id; version: number | 'latest' }
  | { type: 'subdiagram.finished'; nodeId: Id; status: NodeStatus }
  | {
      /** Resultado del nodo «Transformar»: intentos usados, errores de formato y huecos vacíos [R37.10]. */
      type: 'transform.done';
      nodeId: Id;
      mode: 'rules' | 'ai';
      format: TransformFormat;
      attempts: number;
      ok: boolean;
      errors?: string[];
      warnings?: string[];
    }
  | {
      /** Entregable compuesto por la Salida del nivel principal [R46.7]. */
      type: 'deliverable.done';
      nodeId: Id;
      ok: boolean;
      fileName: string;
      markdown: string;
      json?: string;
      links?: DeliverableLinks;
      items: DeliverableItemResult[];
    }
  | { type: 'error'; nodeId?: Id; message: string; retriable: boolean };

export type RunEvent = EventBody & {
  runId: Id;
  /** Estrictamente creciente por ejecución, empieza en 1. */
  seq: number;
  ts: string;
  /** Ruta de nodos contenedores (bucles/subdiagramas) hasta el emisor. Ausente en el nivel raíz. */
  nodePath?: Id[];
};

export type EventListener = (event: RunEvent) => void;

export class EventBus {
  private seq = 0;
  private readonly log: RunEvent[] = [];
  private readonly listeners = new Set<EventListener>();

  constructor(
    readonly runId: Id,
    private readonly now: () => Date = () => new Date(),
    /** Se aplica a todo lo que entra en el log (por defecto, oculta claves y tokens). */
    private readonly redact: (value: unknown) => unknown = redactSecrets,
  ) {}

  emit(body: EventBody, nodePath: readonly Id[] = []): RunEvent {
    const event = {
      ...(this.redact(body) as EventBody),
      runId: this.runId,
      seq: ++this.seq,
      ts: this.now().toISOString(),
      ...(nodePath.length > 0 ? { nodePath: [...nodePath] } : {}),
    } as RunEvent;
    this.log.push(event);
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // Un listener defectuoso nunca debe romper la ejecución.
      }
    }
    return event;
  }

  /**
   * Suscribe un listener. Con `fromSeq` primero recibe el historial desde ese número
   * (útil para reconectar la UI a una ejecución en curso) y después los eventos en vivo.
   */
  subscribe(listener: EventListener, opts: { fromSeq?: number } = {}): () => void {
    if (opts.fromSeq !== undefined) {
      for (const event of this.log) {
        if (event.seq >= opts.fromSeq) listener(event);
      }
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  history(): readonly RunEvent[] {
    return this.log;
  }
}
