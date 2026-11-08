import { type Id, type KnowledgeExtra, MAX_EXTRA_ITEMS, MODELS, isCoordinator, limitProblems } from '../shared';
import { deliverableProblems } from './deliverable-spec';
import { correctionCandidates, returnEdges, segmentShapeOk, splitBranchIds } from './graph';
import { CURRENT_SCHEMA_VERSION, type Diagram, type DiagramNode, type Edge, MAX_REVIEW_ROUNDS, MAX_TASK_LENGTH, REVIEW_PORTS } from './model';
import { transformProblems } from './transform-spec';

/** El modelo es uno de los que se pueden asignar a un agente [R40.1]. */
export const isKnownModel = (m: unknown): m is string => MODELS.some((x) => x.id === m);

const EXTRA_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const isValidId = (x: unknown): x is string => typeof x === 'string' && EXTRA_ID.test(x) && !x.includes('..');
const validList = (v: unknown): v is string[] => Array.isArray(v) && v.length <= MAX_EXTRA_ITEMS && v.every(isValidId);

/** Un conocimiento añadido solo lleva listas cortas de ids válidos [R33.2]; lo obligatorio, un subconjunto [R36.2]. */
export function extraProblem(extra: KnowledgeExtra | undefined): string | undefined {
  if (extra === undefined) return undefined;
  if (typeof extra !== 'object' || extra === null || Array.isArray(extra)) return 'no es un objeto';
  for (const [k, v] of Object.entries(extra)) {
    if (k === 'required') continue;
    if (k !== 'skillIds' && k !== 'contextIds' && k !== 'mcpIds') return `campo desconocido ${k}`;
    if (!validList(v)) return `${k} no válido`;
  }
  const req: unknown = extra.required;
  if (req === undefined) return undefined;
  if (typeof req !== 'object' || req === null || Array.isArray(req)) return 'required no es un objeto';
  for (const [k, v] of Object.entries(req)) {
    if (k !== 'skillIds' && k !== 'contextIds' && k !== 'mcpIds') return `required: campo desconocido ${k}`;
    if (!validList(v)) return `required.${k} no válido`;
    const all = extra[k] ?? [];
    if (v.some((id) => !all.includes(id))) return `required.${k} tiene ids que no están en ${k}`;
  }
  return undefined;
}

export interface ValidationIssue {
  code: string;
  message: string;
  nodeId?: Id;
  /** Cadena de bucles contenedores donde está el problema (vacía en el nivel raíz). */
  path: Id[];
}

/**
 * Valida un diagrama. Cada nivel (raíz y cuerpo de cada bucle) debe ser un grafo sin ciclos:
 * los ciclos solo existen a través de nodos `loop`, que repiten su diagrama interno.
 */
export function validateDiagram(diagram: Diagram, path: Id[] = []): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (code: string, message: string, nodeId?: Id) =>
    issues.push({ code, message, ...(nodeId !== undefined ? { nodeId } : {}), path });

  if (diagram.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    add(
      'schema-version',
      `schemaVersion ${diagram.schemaVersion} no soportada (actual: ${CURRENT_SCHEMA_VERSION})`,
    );
  }

  const dx = extraProblem(diagram.extra);
  if (dx) add('bad-extra', `Conocimiento del diagrama: ${dx}`);
  // Entregable de la ejecución [R46.1].
  // Se marcan en el nodo Salida, que es donde se edita.
  const outId = diagram.nodes.find((n) => n.kind === 'output')?.id;
  if (diagram.deliverable !== undefined) for (const p of deliverableProblems(diagram.deliverable)) add(p.code, p.message, outId);

  const nodes = new Map<Id, DiagramNode>();
  for (const node of diagram.nodes) {
    const nx = extraProblem(node.extra);
    if (nx) add('bad-extra', `Conocimiento de ${node.label ?? node.id}: ${nx}`, node.id);
    if (nodes.has(node.id)) add('duplicate-node-id', `Id de nodo duplicado: ${node.id}`, node.id);
    else nodes.set(node.id, node);
    if (node.task !== undefined && node.task.length > MAX_TASK_LENGTH) {
      add('task-too-long', `La tarea de ${node.label ?? node.id} supera ${MAX_TASK_LENGTH} caracteres`, node.id);
    }
    // Modelo por paso: solo en agentes y solo uno conocido [R40.1].
    if (node.model !== undefined) {
      if (node.kind !== 'agent') add('node-model-not-agent', `${node.label ?? node.id}: solo los pasos de agente eligen modelo`, node.id);
      else if (!isKnownModel(node.model)) add('node-unknown-model', `${node.label ?? node.id}: modelo desconocido «${String(node.model)}»`, node.id);
    }
    // Confirmar antes de terminar: solo en agentes [R43.2].
    if (node.confirm !== undefined && node.kind !== 'agent') add('node-confirm-not-agent', `${node.label ?? node.id}: solo los pasos de agente confirman antes de terminar`, node.id);
    // Límites y reintentos solo en pasos de agente, y con valores válidos [R70.7][R71.10].
    if ((node.limits !== undefined || node.onRetry !== undefined) && node.kind !== 'agent') add('node-limits-not-agent', `${node.label ?? node.id}: solo los pasos de agente tienen límites de tiempo y reintentos`, node.id);
    const badLimit = limitProblems(node.limits)[0];
    if (badLimit) add('node-limits-invalid', `${node.label ?? node.id}: ${badLimit.message}`, node.id);
    if (node.onRetry !== undefined && node.onRetry !== 'keep' && node.onRetry !== 'restore') add('node-limits-invalid', `${node.label ?? node.id}: «Al reintentar» no es válido`, node.id);
    // Un Coordinador necesita al menos dos ramas [R59.3].
    if (isCoordinator(node) && splitBranchIds(diagram, node.id).length < 2) add('node-split-needs-two', `${node.label ?? node.id}: para repartir hacen falta al menos 2 ramas`, node.id);
  }

  const edgeIds = new Set<Id>();
  const edges: Edge[] = [];
  for (const edge of diagram.edges) {
    if (edgeIds.has(edge.id)) {
      add('duplicate-edge-id', `Id de arista duplicado: ${edge.id}`);
      continue;
    }
    edgeIds.add(edge.id);
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) {
      add('unknown-node', `La arista ${edge.id} apunta a un nodo inexistente`);
      continue;
    }
    if (edge.from === edge.to) {
      add('self-edge', `La arista ${edge.id} conecta un nodo consigo mismo`, edge.from);
      continue;
    }
    edges.push(edge);
  }

  const incoming = new Map<Id, Edge[]>();
  const outgoing = new Map<Id, Edge[]>();
  for (const edge of edges) {
    (incoming.get(edge.to) ?? incoming.set(edge.to, []).get(edge.to)!).push(edge);
    (outgoing.get(edge.from) ?? outgoing.set(edge.from, []).get(edge.from)!).push(edge);
  }

  const entries = [...nodes.values()].filter((n) => n.kind === 'entry');
  const outputs = [...nodes.values()].filter((n) => n.kind === 'output');
  if (entries.length !== 1) add('entry-count', `Debe haber exactamente 1 nodo entry (hay ${entries.length})`);
  if (outputs.length !== 1) add('output-count', `Debe haber exactamente 1 nodo output (hay ${outputs.length})`);

  for (const node of nodes.values()) {
    if (node.kind === 'entry' && (incoming.get(node.id)?.length ?? 0) > 0) {
      add('entry-has-incoming', 'El nodo entry no puede tener conexiones de entrada', node.id);
    }
    if (node.kind === 'output' && (outgoing.get(node.id)?.length ?? 0) > 0) {
      add('output-has-outgoing', 'El nodo output no puede tener conexiones de salida', node.id);
    }
    validateNodeConfig(node, outgoing.get(node.id)?.length ?? 0, add, issues, path);
  }

  // Revisiones: puertos y retornos [R34.2]–[R34.5].
  const returns = returnEdges({ nodes: [...nodes.values()], edges });
  const forward = edges.filter((e) => !returns.has(e.id));
  for (const edge of edges) {
    const from = nodes.get(edge.from)!;
    if (edge.port !== undefined && from.kind !== 'review') {
      add('edge-port-not-review', `La arista ${edge.id} tiene una salida de revisión pero no sale de una revisión`, edge.from);
    }
  }
  for (const node of nodes.values()) {
    if (node.kind !== 'review') continue;
    const outs = outgoing.get(node.id) ?? [];
    const used = new Set<string>();
    for (const e of outs) {
      if (e.port === undefined || !REVIEW_PORTS.includes(e.port)) add('review-edge-no-port', `La arista ${e.id} no dice de qué salida de la revisión parte`, node.id);
      else if (used.has(e.port)) add('review-duplicate-port', `La salida ${e.port} de la revisión tiene más de una conexión`, node.id);
      else used.add(e.port);
    }
    if (!used.has('approved')) add('review-no-approved', 'La revisión no tiene conectada la salida Aprobado', node.id);
    const back = [...returns.values()].find((r) => r.reviewId === node.id);
    if (back) {
      if (!used.has('exhausted')) add('review-no-exhausted', 'La revisión vuelve atrás y necesita conectada la salida Agotado', node.id);
      if (!segmentShapeOk(forward, back)) add('review-return-shape', 'El tramo que se repite debe tener una sola entrada y una sola salida', node.id);
    }
    // Revisión humana con ✗ sin conectar: vuelve donde elija el asistente [R53.1].
    if (node.review?.mode === 'human' && !used.has('rejected')) {
      if (!used.has('exhausted')) add('review-no-exhausted', 'La revisión vuelve atrás y necesita conectada la salida Agotado', node.id);
      if (correctionCandidates({ nodes: [...nodes.values()], edges }, node.id).length === 0) {
        add('review-human-no-target', 'La revisión humana no tiene a qué paso volver: añade antes un paso de agente o conecta la salida Rechazado', node.id);
      }
    }
  }
  const infos = [...returns.values()];
  for (let i = 0; i < infos.length; i++) {
    for (let j = i + 1; j < infos.length; j++) {
      const a = infos[i]!.segment;
      const b = infos[j]!.segment;
      const shared = [...a].some((id) => b.has(id));
      const nested = [...a].every((id) => b.has(id)) || [...b].every((id) => a.has(id));
      if (shared && !nested) add('review-return-crossed', 'Dos vueltas atrás se cruzan; una tiene que quedar dentro de la otra', infos[j]!.reviewId);
    }
  }

  // Ciclos (algoritmo de Kahn), sin contar los retornos.
  const fwdOut = new Map<Id, Edge[]>();
  const fwdIn = new Map<Id, number>();
  for (const e of forward) {
    (fwdOut.get(e.from) ?? fwdOut.set(e.from, []).get(e.from)!).push(e);
    fwdIn.set(e.to, (fwdIn.get(e.to) ?? 0) + 1);
  }
  const indegree = new Map<Id, number>([...nodes.keys()].map((id) => [id, fwdIn.get(id) ?? 0]));
  const queue = [...indegree].filter(([, d]) => d === 0).map(([id]) => id);
  let processed = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    processed++;
    for (const edge of fwdOut.get(id) ?? []) {
      const d = (indegree.get(edge.to) ?? 0) - 1;
      indegree.set(edge.to, d);
      if (d === 0) queue.push(edge.to);
    }
  }
  if (processed < nodes.size) {
    add('cycle', 'El diagrama contiene un ciclo; para repetir pasos usa un nodo loop o una revisión que vuelva atrás');
  }

  // Alcanzabilidad desde el entry.
  if (entries.length === 1) {
    const seen = new Set<Id>([entries[0]!.id]);
    const stack = [entries[0]!.id];
    while (stack.length > 0) {
      const id = stack.pop()!;
      for (const edge of outgoing.get(id) ?? []) {
        if (!seen.has(edge.to)) {
          seen.add(edge.to);
          stack.push(edge.to);
        }
      }
    }
    for (const node of nodes.values()) {
      if (!seen.has(node.id)) add('unreachable', `El nodo ${node.id} no es alcanzable desde el entry`, node.id);
    }
  }

  return issues;
}

function validateNodeConfig(
  node: DiagramNode,
  outgoingCount: number,
  add: (code: string, message: string, nodeId?: Id) => void,
  issues: ValidationIssue[],
  path: Id[],
): void {
  switch (node.kind) {
    case 'agent':
      if (!node.agentId) add('agent-missing-id', 'El nodo agent necesita un agentId', node.id);
      break;
    case 'router':
      if (!node.router) add('router-missing-config', 'El nodo router necesita configuración', node.id);
      if (outgoingCount < 1) add('router-no-outgoing', 'El router necesita al menos una salida', node.id);
      break;
    case 'loop': {
      const loop = node.loop;
      if (!loop) {
        add('loop-missing-config', 'El nodo loop necesita configuración', node.id);
        break;
      }
      if (!Number.isInteger(loop.maxIterations) || loop.maxIterations < 1) {
        add('loop-invalid-max', 'maxIterations es obligatorio y debe ser un entero >= 1', node.id);
      }
      if (loop.mode === 'count') {
        if (!Number.isInteger(loop.count) || (loop.count ?? 0) < 1) {
          add('loop-invalid-count', 'En modo count, count debe ser un entero >= 1', node.id);
        } else if (loop.count! > loop.maxIterations) {
          add('loop-invalid-count', 'count no puede superar maxIterations', node.id);
        }
      } else if (!loop.prompt?.trim()) {
        add('loop-missing-prompt', 'En modo ai-judge el bucle necesita un prompt', node.id);
      }
      issues.push(...validateDiagram(loop.body, [...path, node.id]));
      break;
    }
    case 'review': {
      const r = node.review;
      if (!r) {
        add('review-missing-config', 'El nodo review necesita configuración', node.id);
        break;
      }
      if (!Number.isInteger(r.maxRounds) || r.maxRounds < 1 || r.maxRounds > MAX_REVIEW_ROUNDS) {
        add('review-invalid-max', `maxRounds debe ser un entero entre 1 y ${MAX_REVIEW_ROUNDS}`, node.id);
      }
      if (r.route !== undefined && r.mode !== 'human') add('review-route-not-human', 'Solo una revisión humana elige a qué paso volver', node.id);
      break;
    }
    case 'subdiagram':
      if (!node.subdiagram?.templateId) {
        add('subdiagram-missing-template', 'El nodo subdiagram necesita un templateId', node.id);
      }
      break;
    case 'transform':
      for (const p of transformProblems(node.transform)) add(p.code, p.message, node.id);
      break;
    default:
      break;
  }
}

/** Agentes que usa un diagrama, también dentro de bucles [R32.37]. */
/** Pasos de un diagrama: los nodos que no son entrada ni salida, también dentro de bucles [R52.4]. */
export function stepCount(d: Diagram): number {
  let n = 0;
  for (const node of d.nodes) {
    if (node.kind === 'entry' || node.kind === 'output') continue;
    n += 1;
    if (node.kind === 'loop' && node.loop) n += stepCount(node.loop.body);
  }
  return n;
}

export function agentsOfDiagram(d: Diagram, out = new Set<string>()): Set<string> {
  for (const n of d.nodes) {
    if (n.kind === 'agent' && n.agentId) out.add(n.agentId);
    if (n.kind === 'loop' && n.loop) agentsOfDiagram(n.loop.body, out);
  }
  return out;
}
