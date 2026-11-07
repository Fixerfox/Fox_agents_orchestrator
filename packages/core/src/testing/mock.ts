import { type AgentAdapter, AgentError, type AgentRequest, type AgentStreamEvent, type BlameCandidate, type Decider, type RouteCandidate, type TransformRequest, simulateTransform } from '../execution';
import { type Id, KNOWLEDGE_KIND_OF, KNOWLEDGE_LIST_KEYS, type Payload } from '../shared';

export interface MockAgentScript {
  output?: string | ((req: AgentRequest, answers: string[]) => string);
  /** Preguntas que el agente hace al usuario antes de responder. */
  asks?: { question: string; options?: string[] }[];
  tokens?: string[];
  tools?: { tool: string; input?: unknown; ok?: boolean; output?: string }[];
  usage?: { inputTokens: number; outputTokens: number; costUsd?: number };
  files?: string[];
  /** Acciones que simula que le frenaron [R60.16]. */
  blocked?: string[];
  /** Lo que simula hacer en las ramas [R58.11]. */
  gitActions?: { branch: string; action: 'commit' | 'push' | 'pr' | 'merge' | 'delete' | 'switch'; url?: string }[];
  /** Ramas de git que simula haber tocado [R58.1]. */
  branches?: { branch: string; via: 'head' | 'command' | 'mcp' | 'ran'; created?: boolean }[];
  latencyMs?: number;
  /** El agente se queda esperando hasta que se resuelva esta promesa (o se cancele). */
  waitFor?: Promise<void>;
  /** Las N primeras llamadas fallan. */
  failTimes?: number;
  /** `true` por defecto: el fallo es temporal y se puede reintentar. */
  failRetriable?: boolean;
  /** Los N primeros intentos ignoran lo obligatorio que reciba (fallan como el adaptador real) [R36.11]. */
  ignoreRequired?: number;
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('aborted'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

/** Agente simulado y determinista: permite probar orquestador y UI sin red ni coste. */
export class MockAgent implements AgentAdapter {
  readonly calls: AgentRequest[] = [];
  active = 0;
  maxActive = 0;
  /** Agentes cuya llamada observó la cancelación (`signal.aborted`). */
  readonly observedAbort: Id[] = [];
  private readonly failures = new Map<Id, number>();

  constructor(private readonly scripts: Record<Id, MockAgentScript> = {}) {}

  callsOf(agentId: Id): AgentRequest[] {
    return this.calls.filter((c) => c.agentId === agentId);
  }

  async *run(request: AgentRequest, signal: AbortSignal): AsyncIterable<AgentStreamEvent> {
    this.calls.push(request);
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      const script = this.scripts[request.agentId] ?? {};
      if (script.latencyMs) {
        await abortable(new Promise<void>((r) => setTimeout(r, script.latencyMs)), signal);
      }
      if (script.waitFor) await abortable(script.waitFor, signal);
      if (script.failTimes) {
        const done = this.failures.get(request.agentId) ?? 0;
        if (done < script.failTimes) {
          this.failures.set(request.agentId, done + 1);
          throw new AgentError(`fallo simulado de ${request.agentId}`, script.failRetriable ?? true);
        }
      }
      const answers: string[] = [];
      for (const a of script.asks ?? []) {
        const prev = request.previousAnswers.find((p) => p.question === a.question);
        answers.push(
          prev
            ? prev.answer
            : await request.ask({ text: a.question, ...(a.options ? { options: a.options } : {}) }),
        );
      }
      for (const text of script.tokens ?? []) {
        yield { type: 'token', text };
        if (signal.aborted) throw new Error('aborted');
      }
      for (const t of script.tools ?? []) {
        yield { type: 'tool_call', tool: t.tool, input: t.input ?? {} };
        yield {
          type: 'tool_result',
          tool: t.tool,
          ok: t.ok ?? true,
          ...(t.output !== undefined ? { output: t.output } : {}),
        };
      }
      // Lo obligatorio: se «usa» (incluido) salvo que el guion lo ignore; así se prueban eventos y reintentos [R36.11][R36.13].
      const required = KNOWLEDGE_LIST_KEYS.flatMap((k) => (request.extra?.required?.[k] ?? []).map((id) => ({ kind: KNOWLEDGE_KIND_OF[k], id })));
      if (required.length > 0 && request.attempt <= (script.ignoreRequired ?? 0)) {
        for (const r of required) yield { type: 'knowledge_unmet', ...r };
        throw new AgentError(`${request.agentId} terminó sin usar lo obligatorio`, true, required);
      }
      for (const r of required) yield { type: 'knowledge', ...r, via: 'inline', required: true };
      if (script.usage) yield { type: 'usage', ...script.usage };
      for (const path of script.files ?? []) yield { type: 'file', path };
      for (const b of script.branches ?? []) yield { type: 'branch', ...b };
      for (const detail of script.blocked ?? []) yield { type: 'blocked', detail };
      for (const a of script.gitActions ?? []) yield { type: 'git_action', ...a };
      const text =
        typeof script.output === 'function'
          ? script.output(request, answers)
          : (script.output ?? `[${request.agentId}] ${request.input.text}`);
      yield { type: 'result', text, ...(script.files ? { files: script.files } : {}) };
    } finally {
      if (signal.aborted) this.observedAbort.push(request.agentId);
      this.active--;
    }
  }
}

export interface MockDeciderConfig {
  route?: (req: { nodeId: Id; candidates: RouteCandidate[]; input: Payload }) => {
    edgeIds: Id[];
    reason: string;
  };
  judge?: (req: { prompt: string; output: Payload; iteration: number }) => {
    done: boolean;
    reason: string;
  };
  condition?: (req: { condition: string; input: Payload }) => boolean;
  /** Si se da, el router por reglas consulta todas sus condiciones a la vez [R63.16]. */
  conditions?: NonNullable<Decider['conditions']>;
  /** Gasto simulado de cada decisión de router o bucle [R63.15]. */
  decisionUsage?: { inputTokens: number; outputTokens: number; costUsd?: number };
  /** Respuesta del nodo «Transformar» con Claude; por defecto, la conversión simulada [R37.8]. */
  transform?: (req: TransformRequest) => string | Error;
  /** Paso culpable de una corrección; por defecto, el último candidato [R53.17]. */
  blame?: (req: { feedback: string; candidates: BlameCandidate[] }) => { nodeId: Id; reason: string } | Error;
  /** Sin esto, el simulado no revisa [R60.12]. */
  supervise?: NonNullable<Decider['supervise']>;
  judgeReview?: NonNullable<Decider['judgeReview']>;
  verifyRun?: NonNullable<Decider['verifyRun']>;
}

export class MockDecider implements Decider {
  readonly routeCalls: unknown[] = [];
  readonly judgeCalls: unknown[] = [];
  readonly conditionCalls: unknown[] = [];

  constructor(private readonly config: MockDeciderConfig = {}) {}

  route: Decider['route'] = async (request) => {
    this.routeCalls.push(request);
    const r = this.config.route?.(request) ?? { edgeIds: request.candidates.map((c) => c.edgeId), reason: 'todas las rutas (simulado)' };
    return this.config.decisionUsage ? { ...r, usage: this.config.decisionUsage } : r;
  };

  judge: Decider['judge'] = async (request) => {
    this.judgeCalls.push(request);
    const r = this.config.judge?.(request) ?? { done: true, reason: 'cumplido (simulado)' };
    return this.config.decisionUsage ? { ...r, usage: this.config.decisionUsage } : r;
  };

  condition: Decider['condition'] = async (request) => {
    this.conditionCalls.push(request);
    return this.config.condition?.(request) ?? true;
  };

  readonly blameCalls: { feedback: string; candidates: BlameCandidate[] }[] = [];
  get judgeReview(): Decider['judgeReview'] {
    return this.config.judgeReview;
  }

  get verifyRun(): Decider['verifyRun'] {
    return this.config.verifyRun;
  }

  get conditions(): Decider['conditions'] {
    return this.config.conditions;
  }

  get supervise(): Decider['supervise'] {
    return this.config.supervise;
  }
  blame = async (request: { feedback: string; candidates: BlameCandidate[] }): Promise<{ nodeId: Id; reason: string }> => {
    this.blameCalls.push(request);
    const r = this.config.blame?.(request) ?? { nodeId: request.candidates[request.candidates.length - 1]!.nodeId, reason: 'el paso más cercano (simulado)' };
    if (r instanceof Error) throw r;
    return r;
  };

  readonly transformCalls: TransformRequest[] = [];
  transform = async (request: TransformRequest): Promise<{ text: string }> => {
    this.transformCalls.push(request);
    const r = this.config.transform?.(request) ?? (request.deliverable ? simulateDeliverable(request) : simulateTransform(request.format, request.schema, request.input));
    if (r instanceof Error) throw r;
    return { text: r };
  };
}

/** Texto determinista del entregable en el motor simulado, sin tokens [R46.10]. */
export function simulateDeliverable(request: TransformRequest): string {
  const d = request.deliverable!;
  if (d.kind === 'json') return simulateTransform('json', request.schema, { text: '{}', files: [] });
  if (d.kind === 'custom') return `Sección «${d.title ?? ''}» generada por el motor simulado.`;
  return `Ejecución simulada: ${d.steps} paso${d.steps === 1 ? '' : 's'} y ${d.files} archivo${d.files === 1 ? '' : 's'} creados o cambiados.`;
}
