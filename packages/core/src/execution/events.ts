import type { DeliverableSpec, TransformFormat } from '../diagrams';
import { type Id, type KnowledgeExtra, type KnowledgeKind, type Payload, redactSecrets } from '../shared';
import type { AgentErrorKind, AgentSnapshot, AnsweredQuestion, ConflictQuestion, FileChange, FileVia, KnowledgeVia, PreviousAttempt, QuestionKind, ReviewQuestion } from './adapter';
import type { DeliverableItemResult, DeliverableLinks } from './deliverable';
import type { NodeStatus, RunStatus } from './run-types';
import type { SplitProblem } from './text/split';
import type { MemoryStats } from './memory/memory-render';

export type EventBody =
  | { type: 'run.started'; diagramId: Id; /** Ejecución que esta reanuda [R41.1]. */ resumedFrom?: string; /** Ejecución que esta corrige [R53.8]. */ correctedFrom?: string; /** Entregable efectivo [R46.3]. */ deliverable?: DeliverableSpec }
  | { type: 'run.finished'; status: RunStatus; reason?: string }
  /** La persona (o el asistente, con su permiso) dio por buena una ejecución fallida; va después de `run.finished` [R65.5]. */
  | { type: 'run.accepted'; by: 'user' | 'assistant'; reason: string; previousReason?: string }
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
      /** Regla de reparto que recibe este paso [R59.4]. */
      split?: string;
      /** Memoria que recibe este paso [R60.25]. */
      memory?: string;
      /** Tokens estimados de cada bloque de la memoria y cuáles se recortaron [R72.19]. */
      memoryStats?: MemoryStats;
      /** Archivos a los que se limita [R60.16]. */
      scope?: string[];
      /** Paso interno: un agente que junta los archivos en conflicto [R73.15]. */
      kind?: 'merge';
      /** El paso trabaja en el espacio aislado de su rama (sin la ruta) [R73.8]. */
      isolated?: boolean;
      /** Aviso del entregable que recibe este paso [R46.4]. */
      deliverable?: { role: 'final' | 'goal'; text: string };
      /** Lo añadido por el diagrama y por el paso, para saber de dónde vino cada cosa [R33.4]. */
      extra?: { diagram?: KnowledgeExtra; node?: KnowledgeExtra };
      snapshot?: AgentSnapshot;
      previousAnswers?: AnsweredQuestion[];
      /** Lo que se le contó del intento anterior [R71.8]. */
      previousAttempt?: PreviousAttempt;
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
      /** Tipo del error [R71.6]. */
      kind?: AgentErrorKind;
      /** Por qué se reintenta: un error, un corte por tiempo o por repetir la misma acción [R71.6]. */
      cause?: 'error' | 'timeout' | 'loop';
    }
  | { type: 'token.stream'; nodeId: Id; text: string }
  | { type: 'tool.called'; nodeId: Id; tool: string; input: unknown }
  | { type: 'tool.result'; nodeId: Id; tool: string; ok: boolean; output?: string }
  /** Skill, contexto o MCP entregado o usado por el agente en un intento [R36.13]. */
  | { type: 'knowledge.used'; nodeId: Id; attempt: number; kind: KnowledgeKind; id: Id; via: KnowledgeVia; required: boolean }
  /** Obligatorio que el agente no usó en un intento [R36.13]. */
  | { type: 'knowledge.unmet'; nodeId: Id; attempt: number; kind: KnowledgeKind; id: Id }
  | { type: 'agent.question'; nodeId: Id; questionId: string; text: string; options?: string[]; /** Confirmación del paso [R43.5]. */ confirm?: { round: number }; /** [R45.3] */ kind?: QuestionKind; /** Revisión humana [R53.3] */ review?: ReviewQuestion; /** Conflicto al juntar ramas [R73.14] */ conflict?: ConflictQuestion }
  /** Respuesta a una confirmación: aprobada o con cambios pedidos [R43.6][R43.7]. */
  | { type: 'confirm.decided'; nodeId: Id; round: number; verdict: 'approved' | 'changes'; text?: string }
  | { type: 'agent.answer'; nodeId: Id; questionId: string; text: string; /** Nadie respondió y se tomó la respuesta segura [R70.15]. */ auto?: true }
  /** Recordatorio de una pregunta que sigue sin respuesta [R70.16]. */
  | { type: 'question.reminder'; nodeId: Id; questionId: string; text: string; minutes: number }
  /** Archivos devueltos al punto de partida antes de reintentar [R71.10]. */
  | { type: 'files.restored'; nodeId: Id; attempt: number; restored: string[]; removed: string[]; failed: { path: string; reason: string }[] }
  /** El motor cortó un intento por inactividad, por su duración o por repetir la misma acción [R70.5][R70.11]. */
  | { type: 'node.timeout'; nodeId: Id; attempt: number; kind: 'idle' | 'tool' | 'total' | 'loop'; minutes: number; tool?: string }
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
      /** Gasto de una pieza interna, no del paso [R60.30][R34.28]; `decision`: router y bucles [R63.15]. */
      source?: 'supervisor' | 'judge' | 'decision';
    }
  /** Archivo escrito por el paso; `change` dice si es nuevo o modificado (los adaptadores que no lo saben lo omiten) [R45.2]. */
  | { type: 'file.produced'; nodeId: Id; path: string; change?: FileChange; /** [R55.3] */ via?: FileVia; /** Viene de un paso reutilizado [R41.9]. */ reused?: boolean }
  /** El paso creó una rama de git o actuó en ella [R58.1]. */
  | { type: 'git.branch'; nodeId: Id; branch: string; via: 'head' | 'command' | 'mcp' | 'ran'; created?: boolean }
  /** El paso hizo esto en una rama [R58.11]. */
  | { type: 'git.action'; nodeId: Id; branch: string; action: 'commit' | 'push' | 'pr' | 'merge' | 'delete' | 'switch'; /** PR o merge request [R58.14]. */ url?: string }
  /** El Supervisor detecta algo o frena una acción [R60.1]. */
  | { type: 'supervisor.alert'; nodeId?: Id; rule: string; severity: 'info' | 'warning'; detail: string }
  /** Si el resultado final cumple lo pedido [R62.9]. */
  | { type: 'supervisor.verified'; met: boolean; detail: string; /** Lo que queda para una persona [R65.3]. */ forPerson?: string }
  /** Entrada de la memoria de la ejecución [R60.18]. */
  | { type: 'supervisor.note'; nodeId: Id; text: string; files: string[]; /** Salió de una revisión con IA [R60.29]. */ reviewed?: boolean; /** Lo que el paso decidió por su cuenta [R72.10]. */ decided?: string[] }
  /** Nota que un paso deja a los siguientes, sacada de su salida [R72.11]. */
  | { type: 'memory.note'; nodeId: Id; text: string }
  /** La persona dice si un aviso era un problema o no [R75.21]. */
  | { type: 'supervisor.feedback'; alertSeq: number; verdict: 'false-alarm' | 'confirmed'; note?: string; nodeId?: Id }
  /** El Supervisor empieza a vigilar [R60.28]. */
  | { type: 'supervisor.started'; review: boolean; model?: string }
  /** Empieza a revisar un paso con IA [R60.29]. */
  | { type: 'supervisor.reviewing'; nodeId: Id }
  /** Revisiones que no se pudieron hacer [R60.13][R60.15]. */
  | { type: 'supervisor.skipped'; count: number; reason: 'timeout' | 'failed' }
  /** Una rama en paralelo empieza a trabajar en su propio espacio [R73.7]; la ruta nunca sale en el evento. */
  | { type: 'workspace.opened'; regionId: Id; branchNodeIds: Id[]; strategy: 'git' | 'copy'; warning?: string }
  /** Lo de una rama llegó al destino; `nodeId`, el nodo que las junta [R73.13]. */
  | { type: 'workspace.merged'; nodeId: Id; files: string[]; regionId?: Id; branchNodeIds?: Id[]; mergedByLines?: string[] }
  | { type: 'workspace.conflict'; nodeIds: Id[]; files: string[]; regionId?: Id; branchNodeIds?: Id[]; savedTo?: string }
  /** La persona (o un agente) resolvió un conflicto [R73.14][R73.15]. */
  | { type: 'workspace.resolved'; regionId: Id; nodeIds: Id[]; files: string[]; choice: 'target' | 'branch' | 'agent' }
  /** Una rama que falló o se canceló no se fusiona; lo cambiado queda aparte [R73.17]. */
  | { type: 'workspace.discarded'; regionId: Id; branchNodeIds: Id[]; files: string[] }
  | { type: 'iteration.snapshot'; loopId: Id; n: number; path: string }
  | {
      type: 'route.decided';
      fromNodeId: Id;
      /** Ids de los nodos destino elegidos. */
      chosen: Id[];
      mode: 'ai' | 'rules';
      reason: string;
    }
  | { type: 'edge.traversed'; edgeId: Id; fromNodeId: Id; toNodeId: Id; /** La parte enviada, si el origen reparte [R59.7]. */ input?: Payload }
  /** El paso no repartió bien su trabajo y se repite [R59.8]. */
  | { type: 'split.rejected'; nodeId: Id; attempt: number; problems: SplitProblem[] }
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
  /** Eventos por entregar: el que emite un oyente espera a que acabe el actual [R2.9]. */
  private readonly outbox: RunEvent[] = [];
  private delivering = false;

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
    this.outbox.push(event);
    if (!this.delivering) this.deliver();
    return event;
  }

  private deliver(): void {
    this.delivering = true;
    for (let next = this.outbox.shift(); next; next = this.outbox.shift()) {
      for (const listener of [...this.listeners]) {
        try {
          listener(next);
        } catch {
          // Un listener defectuoso nunca debe romper la ejecución.
        }
      }
    }
    this.delivering = false;
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
