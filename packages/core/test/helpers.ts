import {
  MockAgent,
  type AgentAdapter,
  type AgentRequest,
  MockDecider,
  Orchestrator,
  type AgentSnapshot,
  type Diagram,
  type DiagramNode,
  type Edge,
  type EventBus,
  type Id,
  type LoopConfig,
  type MockAgentScript,
  type MockDeciderConfig,
  type RunEvent,
} from '../src';

export const ENTRY: DiagramNode = { id: 'entry', kind: 'entry' };
export const OUTPUT: DiagramNode = { id: 'output', kind: 'output' };

export const agent = (id: Id, label?: string): DiagramNode => ({
  id,
  kind: 'agent',
  agentId: id,
  label: label ?? id,
});
export const router = (id: Id, mode: 'ai' | 'rules'): DiagramNode => ({
  id,
  kind: 'router',
  label: id,
  router: { mode },
});
export const loop = (id: Id, cfg: LoopConfig): DiagramNode => ({ id, kind: 'loop', label: id, loop: cfg });
export const sub = (id: Id, templateId: Id, version: number | 'latest' = 'latest'): DiagramNode => ({
  id,
  kind: 'subdiagram',
  label: id,
  subdiagram: { templateId, version },
});
export const edge = (from: Id, to: Id, condition?: string): Edge => ({
  id: `${from}->${to}`,
  from,
  to,
  ...(condition !== undefined ? { condition } : {}),
});
export const diagram = (nodes: DiagramNode[], edges: Edge[], id = 'd'): Diagram => ({
  id,
  name: id,
  schemaVersion: 1,
  nodes,
  edges,
});

/** entry → a → b → … → output */
export function chain(ids: Id[], id = 'd'): Diagram {
  const all = ['entry', ...ids, 'output'];
  return diagram(
    [ENTRY, ...ids.map((i) => agent(i)), OUTPUT],
    all.slice(1).map((to, i) => edge(all[i]!, to)),
    id,
  );
}

/** entry → (a, b, c…) en paralelo → output */
export function fan(ids: Id[], id = 'd'): Diagram {
  return diagram(
    [ENTRY, ...ids.map((i) => agent(i)), OUTPUT],
    ids.flatMap((i) => [edge('entry', i), edge(i, 'output')]),
    id,
  );
}

export interface SetupOptions {
  scripts?: Record<Id, MockAgentScript>;
  decider?: MockDeciderConfig;
  templates?: Record<Id, Diagram>;
  describeAgent?: (agentId: Id) => AgentSnapshot | undefined;
  /** Adaptador propio en lugar del simulado. */
  adapter?: AgentAdapter;
}

export function setup(opts: SetupOptions = {}) {
  const agents = new MockAgent(opts.scripts);
  const decider = new MockDecider(opts.decider);
  const sleeps: number[] = [];
  const templates = opts.templates;
  const resolved: [Id, number | 'latest'][] = [];
  const orch = new Orchestrator({
    getAdapter: () => opts.adapter ?? agents,
    decider,
    ...(opts.describeAgent ? { describeAgent: opts.describeAgent } : {}),
    ...(templates
      ? {
          resolveTemplate: (id: Id, version: number | 'latest') => {
            resolved.push([id, version]);
            const t = templates[id];
            if (!t) throw new Error(`plantilla desconocida: ${id}`);
            return t;
          },
        }
      : {}),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    newRunId: () => 'run-1',
  });
  return { agents, decider, orch, sleeps, resolved };
}

export function ofType<T extends RunEvent['type']>(
  events: readonly RunEvent[],
  type: T,
): Extract<RunEvent, { type: T }>[] {
  return events.filter((e): e is Extract<RunEvent, { type: T }> => e.type === type);
}

export const types = (events: readonly RunEvent[]) => events.map((e) => e.type);

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

export const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function waitForEvent(bus: EventBus, pred: (e: RunEvent) => boolean): Promise<RunEvent> {
  return new Promise((resolve) => {
    let done = false;
    const off = bus.subscribe(
      (e) => {
        if (!done && pred(e)) {
          done = true;
          resolve(e);
          // `off` aún puede no existir si el evento llega durante el replay del historial
          queueMicrotask(() => off());
        }
      },
      { fromSeq: 1 },
    );
  });
}

export function nodeFinished(events: readonly RunEvent[], nodeId: Id, nodePath?: Id[]) {
  return ofType(events, 'node.finished').find(
    (e) => e.nodeId === nodeId && JSON.stringify(e.nodePath ?? []) === JSON.stringify(nodePath ?? []),
  );
}

export function req(agentId: Id, text = 'hola', over: Partial<AgentRequest> = {}): AgentRequest {
  return {
    nodeId: agentId,
    agentId,
    input: { text, files: [] },
    attempt: 1,
    ask: async () => '',
    previousAnswers: [],
    ...over,
  };
}
