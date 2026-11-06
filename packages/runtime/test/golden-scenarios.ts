import {
  MockAgent,
  MockDecider,
  Orchestrator,
  correctionPlan,
  resumePlan,
  type Diagram,
  type DiagramNode,
  type Edge,
  type Id,
  type MockAgentScript,
  type MockDeciderConfig,
  type ReviewPort,
  type RunEvent,
  type RunHandle,
  type RunOptions,
} from '@orquestador/core';

/** Cómo se compara: orden global (secuencial) u orden por nodo (ramas paralelas) [R56.6]. */
export type GoldenOrder = 'global' | 'per-node';

export interface GoldenScenario {
  name: string;
  order: GoldenOrder;
  diagram: Diagram;
  /** Ejecuta el caso y devuelve los eventos de cada ejecución, en orden. */
  play(): Promise<RunEvent[][]>;
}

const ENTRY: DiagramNode = { id: 'entry', kind: 'entry' };
const OUTPUT: DiagramNode = { id: 'output', kind: 'output' };
const agent = (id: Id, over: Partial<DiagramNode> = {}): DiagramNode => ({ id, kind: 'agent', agentId: id, label: id, ...over });
const edge = (from: Id, to: Id, over: Partial<Edge> = {}): Edge => ({ id: `${from}->${to}`, from, to, ...over });
const port = (from: Id, to: Id, p: ReviewPort): Edge => ({ id: `${from}->${to}:${p}`, from, to, port: p });
const diagram = (id: Id, nodes: DiagramNode[], edges: Edge[], over: Partial<Diagram> = {}): Diagram => ({ id, name: id, schemaVersion: 1, nodes, edges, ...over });
const chain = (id: Id, ids: Id[]): Diagram => {
  const all = ['entry', ...ids, 'output'];
  return diagram(id, [ENTRY, ...ids.map((i) => agent(i)), OUTPUT], all.slice(1).map((to, i) => edge(all[i]!, to)));
};

interface Parts {
  scripts?: Record<Id, MockAgentScript>;
  decider?: MockDeciderConfig;
  templates?: Record<Id, Diagram>;
}

/** Orquestador determinista: reloj que avanza 1 ms por lectura, ids en orden y esperas instantáneas. */
function rig(parts: Parts = {}): Orchestrator {
  const adapter = new MockAgent(parts.scripts);
  let tick = 0;
  let run = 0;
  const templates = parts.templates;
  return new Orchestrator({
    getAdapter: () => adapter,
    decider: new MockDecider(parts.decider),
    ...(templates ? { resolveTemplate: (id: Id) => templates[id]! } : {}),
    sleep: async () => {},
    now: () => new Date(Date.UTC(2026, 10, 5) + tick++),
    newRunId: () => `run-${++run}`,
  });
}

/** Responde a las preguntas en orden, como lo haría el usuario: en un turno posterior a la pregunta. */
function answering(handle: RunHandle, answers: string[]): void {
  const queue = [...answers];
  handle.bus.subscribe((e) => {
    if (e.type !== 'agent.question') return;
    const text = queue.shift();
    if (text !== undefined) setTimeout(() => handle.answer(e.questionId, text), 0);
  });
}

async function once(d: Diagram, parts: Parts = {}, answers: string[] = [], options: RunOptions = {}): Promise<RunEvent[][]> {
  const handle = rig(parts).start(d, 'pedido inicial', options);
  answering(handle, answers);
  const result = await handle.result;
  return [[...result.events]];
}

const SCRIPT: MockAgentScript = {
  tokens: ['Hola ', 'mundo'],
  tools: [{ tool: 'Write', input: { file: 'a.txt' }, ok: true, output: 'ok' }],
  usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.01 },
  files: ['a.txt'],
};

const linear = chain('lineal', ['a', 'b']);

const parallel = diagram(
  'paralelo',
  [ENTRY, agent('a'), agent('b'), agent('junta'), OUTPUT],
  [edge('entry', 'a'), edge('entry', 'b'), edge('a', 'junta'), edge('b', 'junta'), edge('junta', 'output')],
);

const routed = (id: Id, mode: 'rules' | 'ai'): Diagram =>
  diagram(
    id,
    [ENTRY, { id: 'r', kind: 'router', label: 'r', router: { mode } }, agent('si'), agent('no'), OUTPUT],
    [edge('entry', 'r'), edge('r', 'si', mode === 'rules' ? { condition: 'vale' } : {}), edge('r', 'no', mode === 'rules' ? { condition: 'no vale' } : {}), edge('si', 'output'), edge('no', 'output')],
  );

const looped = (id: Id, cfg: { mode: 'count'; count: number } | { mode: 'ai-judge'; prompt: string }): Diagram =>
  diagram(
    id,
    [ENTRY, { id: 'l', kind: 'loop', label: 'l', loop: { ...cfg, maxIterations: 4, body: chain('cuerpo', ['a']) } }, OUTPUT],
    [edge('entry', 'l'), edge('l', 'output')],
  );

const reviewed = diagram(
  'revision-ia',
  [ENTRY, agent('dis'), agent('qa'), { id: 'rev', kind: 'review', label: 'rev', review: { maxRounds: 3, mode: 'ai', criteria: 'Debe estar completo' } }, OUTPUT],
  [edge('entry', 'dis'), edge('dis', 'qa'), edge('qa', 'rev'), port('rev', 'output', 'approved'), port('rev', 'dis', 'rejected'), { ...port('rev', 'output', 'exhausted'), id: 'rev->output:x' }],
);

const humanGate = diagram(
  'revision-humana',
  [ENTRY, agent('a', { label: 'Analista' }), agent('b', { label: 'Builder' }), { id: 'rev', kind: 'review', label: 'rev', review: { maxRounds: 3, mode: 'human' } }, OUTPUT],
  [edge('entry', 'a'), edge('a', 'b'), edge('b', 'rev'), port('rev', 'output', 'approved'), { ...port('rev', 'output', 'exhausted'), id: 'rev->output:x' }],
);

const withSub = diagram(
  'subdiagrama',
  [ENTRY, { id: 's', kind: 'subdiagram', label: 's', subdiagram: { templateId: 'plantilla', version: 'latest' } }, OUTPUT],
  [edge('entry', 's'), edge('s', 'output')],
);

const transformed = diagram(
  'transformar',
  [
    ENTRY,
    agent('a'),
    { id: 'reglas', kind: 'transform', label: 'reglas', transform: { mode: 'rules', format: 'markdown', template: '# {{entrada}}' } },
    { id: 'ia', kind: 'transform', label: 'ia', transform: { mode: 'ai', format: 'json', instructions: 'Saca un objeto', maxAttempts: 2 } },
    OUTPUT,
  ],
  [edge('entry', 'a'), edge('a', 'reglas'), edge('reglas', 'ia'), edge('ia', 'output')],
);

const confirmed = diagram('confirmar', [ENTRY, agent('a', { confirm: true }), OUTPUT], [edge('entry', 'a'), edge('a', 'output')]);

const delivered: Diagram = {
  ...chain('entregable', ['a', 'b']),
  deliverable: { items: [{ kind: 'links' }, { kind: 'summary' }, { kind: 'json' }, { kind: 'custom', title: 'Cómo arrancarlo', instructions: 'Pasos' }], notify: 'all' },
};

const stopped = chain('reanudar', ['a', 'b', 'c']);
const corrected = chain('corregir', ['a', 'b', 'c']);

/** Primera ejecución parada en `b`; la segunda reanuda reutilizando `a`. */
async function resumeCase(): Promise<RunEvent[][]> {
  const orch = rig({ scripts: { a: { output: 'plan' }, b: { waitFor: new Promise<void>(() => {}), output: 'nunca' } } });
  const first = orch.start(stopped, 'pedido inicial');
  first.bus.subscribe((e) => {
    if (e.type === 'agent.request' && e.nodeId === 'b') setTimeout(() => first.cancel('parada'), 0);
  });
  const r1 = await first.result;
  const orch2 = rig({ scripts: { a: { output: 'no debería repetirse' }, b: { output: 'hecho' }, c: { output: 'cierre' } } });
  const r2 = await orch2.start(stopped, 'pedido inicial', { reuse: { fromRunId: r1.runId, outputs: resumePlan(stopped, r1.events) } }).result;
  return [[...r1.events], [...r2.events]];
}

/** Ejecución terminada y otra que corrige `b`: reutiliza `a` y rehace `b` y `c`. */
async function correctCase(): Promise<RunEvent[][]> {
  const r1 = await rig({ scripts: { a: { output: 'plan' }, b: { output: 'tareas' }, c: { output: 'web' } } }).start(corrected, 'pedido inicial').result;
  const plan = correctionPlan(corrected, r1.events, 'b');
  const options: RunOptions = {
    reuse: { fromRunId: r1.runId, outputs: plan.outputs, approvedReviews: plan.approvedReviews },
    correction: { fromRunId: r1.runId, nodeId: 'b', text: 'faltan tareas', previous: plan.previous! },
  };
  const r2 = await rig({ scripts: { b: { output: 'tareas completas' }, c: { output: 'web nueva' } } }).start(corrected, 'pedido inicial', options).result;
  return [[...r1.events], [...r2.events]];
}

/** Los 14 casos de R56.6. Cada uno crea su estado: se pueden repetir. */
export function goldenScenarios(): GoldenScenario[] {
  const judgeSecond = (): MockDeciderConfig => {
    let calls = 0;
    return { judge: () => (++calls >= 2 ? { done: true, reason: 'cumple' } : { done: false, reason: 'falta pulir' }) };
  };
  const secondIsJson = (): MockDeciderConfig => {
    let calls = 0;
    return { transform: () => (++calls === 1 ? 'esto no es json' : '{"ok":true}') };
  };
  const rules = routed('router-reglas', 'rules');
  const ai = routed('router-ia', 'ai');
  const count = looped('bucle-veces', { mode: 'count', count: 3 });
  const judged = looped('bucle-evaluador', { mode: 'ai-judge', prompt: '¿Listo?' });
  return [
    {
      name: 'lineal',
      order: 'global',
      diagram: linear,
      play: () => once(linear, { scripts: { a: { ...SCRIPT, failTimes: 1 }, b: { asks: [{ question: '¿Color?', options: ['Rojo', 'Azul'] }], output: (_r, a) => `Elegido ${a[0]}` } } }, ['Azul']),
    },
    { name: 'paralelo', order: 'per-node', diagram: parallel, play: () => once(parallel, { scripts: { a: SCRIPT, b: { output: 'rama b' }, junta: { output: (r) => `juntado: ${r.input.text}` } } }) },
    { name: 'router-reglas', order: 'global', diagram: rules, play: () => once(rules, { decider: { condition: (r) => r.condition === 'vale' } }) },
    { name: 'router-ia', order: 'global', diagram: ai, play: () => once(ai, { decider: { route: (r) => ({ edgeIds: [r.candidates[1]!.edgeId], reason: 'la segunda' }) } }) },
    { name: 'bucle-veces', order: 'global', diagram: count, play: () => once(count) },
    { name: 'bucle-evaluador', order: 'global', diagram: judged, play: () => once(judged, { decider: judgeSecond() }) },
    { name: 'revision-ia', order: 'global', diagram: reviewed, play: () => once(reviewed, { decider: judgeSecond() }) },
    {
      name: 'revision-humana',
      order: 'global',
      diagram: humanGate,
      play: () => once(humanGate, { scripts: { a: { output: 'plan' }, b: { output: 'obra' } }, decider: { blame: () => ({ nodeId: 'a', reason: 'el plan' }) } }, ['Cambia el plan', 'Builder', 'Aprobar']),
    },
    { name: 'subdiagrama', order: 'global', diagram: withSub, play: () => once(withSub, { templates: { plantilla: chain('plantilla', ['x', 'y']) } }) },
    { name: 'transformar', order: 'global', diagram: transformed, play: () => once(transformed, { scripts: { a: { output: 'texto base' } }, decider: secondIsJson() }) },
    { name: 'confirmar', order: 'global', diagram: confirmed, play: () => once(confirmed, { scripts: { a: { output: 'primera versión' } } }, ['Hazlo más corto', 'Aprobar']) },
    { name: 'entregable', order: 'global', diagram: delivered, play: () => once(delivered, { scripts: { a: SCRIPT, b: { output: 'cierre' } } }) },
    { name: 'reanudar', order: 'global', diagram: stopped, play: resumeCase },
    { name: 'corregir', order: 'global', diagram: corrected, play: correctCase },
  ];
}
