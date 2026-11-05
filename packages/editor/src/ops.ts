import {
  CURRENT_SCHEMA_VERSION,
  mergeExtra,
  type KnowledgeExtra,
  type DeliverableSpec,
  type Diagram,
  type DiagramNode,
  type Edge,
  type Id,
  type LoopConfig,
  type RouterConfig,
  type TransformConfig,
  type ReviewConfig,
  type ReviewPort,
  MAX_REVIEW_ROUNDS,
  returnEdges,
  isKnownModel,
} from '@orquestador/core';
import { EditorError, type EditorErrorCode } from './errors';
import { t, type MessageKey } from './i18n';

export type Position = { x: number; y: number };

const ERR = (code: EditorErrorCode) => new EditorError(code, t(`error.${code}` as MessageKey));

/** Diagrama nuevo: entrada y salida ya conectadas (válido y ejecutable). */
export function createDiagram(id: Id, name: string): Diagram {
  return {
    id,
    name,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    nodes: [
      { id: 'entry', kind: 'entry', label: t('node.entry'), position: { x: 0, y: 120 } },
      { id: 'output', kind: 'output', label: t('node.output'), position: { x: 420, y: 120 } },
    ],
    edges: [{ id: 'entry->output', from: 'entry', to: 'output' }],
  };
}

export function getLevel(root: Diagram, path: readonly Id[]): Diagram {
  let current = root;
  for (const id of path) {
    const node = current.nodes.find((n) => n.id === id);
    if (!node) throw ERR('unknown-node');
    if (node.kind !== 'loop' || !node.loop) throw ERR('not-a-loop');
    current = node.loop.body;
  }
  return current;
}

export function updateLevel(root: Diagram, path: readonly Id[], fn: (level: Diagram) => Diagram): Diagram {
  const [head, ...rest] = path;
  if (head === undefined) return fn(root);
  let found = false;
  const nodes = root.nodes.map((n) => {
    if (n.id !== head) return n;
    if (n.kind !== 'loop' || !n.loop) throw ERR('not-a-loop');
    found = true;
    return { ...n, loop: { ...n.loop, body: updateLevel(n.loop.body, rest, fn) } };
  });
  if (!found) throw ERR('unknown-node');
  return { ...root, nodes };
}

/** Recorta la ruta hasta el último bucle que aún existe. */
export function validPath(root: Diagram, path: readonly Id[]): Id[] {
  const out: Id[] = [];
  let current = root;
  for (const id of path) {
    const node = current.nodes.find((n) => n.id === id);
    if (!node || node.kind !== 'loop' || !node.loop) break;
    out.push(id);
    current = node.loop.body;
  }
  return out;
}

function nextId(level: Diagram, prefix: string): Id {
  const used = new Set(level.nodes.map((n) => n.id));
  for (let n = 1; ; n++) {
    if (!used.has(`${prefix}-${n}`)) return `${prefix}-${n}`;
  }
}

export type NewNodeSpec =
  | { kind: 'agent'; agentId: Id; label?: string; position: Position }
  | { kind: 'router'; label?: string; position: Position }
  | { kind: 'loop'; label?: string; position: Position }
  /** `human`: revisión humana, que espera al usuario [R53.16]. */
  | { kind: 'review'; label?: string; position: Position; human?: boolean }
  /** Convierte lo que llega a JSON, Markdown o texto; empieza en reglas y JSON [R37.11]. */
  | { kind: 'transform'; label?: string; position: Position }
  /** Otro diagrama del proyecto usado como un solo paso, siempre en su última versión [R33.7]. */
  | { kind: 'subdiagram'; diagramId: Id; label?: string; position: Position };

export function addNode(root: Diagram, path: readonly Id[], spec: NewNodeSpec): { diagram: Diagram; id: Id } {
  const kind = (spec as { kind: string }).kind;
  if (kind === 'entry' || kind === 'output') throw ERR('protected');
  let id = '';
  const diagram = updateLevel(root, path, (level) => {
    id = nextId(level, spec.kind);
    let node: DiagramNode;
    switch (spec.kind) {
      case 'agent':
        if (!spec.agentId) throw ERR('invalid');
        node = { id, kind: 'agent', agentId: spec.agentId, label: spec.label ?? spec.agentId, position: spec.position };
        break;
      case 'router':
        node = { id, kind: 'router', label: spec.label ?? t('node.router'), router: { mode: 'ai' }, position: spec.position };
        break;
      case 'review':
        // Revisión con tres salidas; por defecto 3 vueltas y lee el veredicto [R34.15].
        node = spec.human
          ? { id, kind: 'review', label: spec.label ?? t('node.humanReview'), review: { maxRounds: 3, mode: 'human' }, position: spec.position }
          : { id, kind: 'review', label: spec.label ?? t('node.review'), review: { maxRounds: 3, mode: 'verdict' }, position: spec.position };
        break;
      case 'loop': {
        const label = spec.label ?? t('node.loop');
        node = {
          id,
          kind: 'loop',
          label,
          position: spec.position,
          loop: { mode: 'count', count: 3, maxIterations: 5, body: createDiagram(`${id}-cuerpo`, label) },
        };
        break;
      }
      case 'transform':
        node = { id, kind: 'transform', label: spec.label ?? t('node.transform'), transform: { mode: 'rules', format: 'json' }, position: spec.position };
        break;
      case 'subdiagram':
        if (!spec.diagramId) throw ERR('invalid');
        if (spec.diagramId === root.id) throw ERR('self-subdiagram');
        node = { id, kind: 'subdiagram', label: spec.label ?? spec.diagramId, subdiagram: { templateId: spec.diagramId, version: 'latest' }, position: spec.position };
        break;
    }
    return { ...level, nodes: [...level.nodes, node] };
  });
  return { diagram, id };
}

const mapNode = (level: Diagram, id: Id, fn: (n: DiagramNode) => DiagramNode): Diagram => {
  if (!level.nodes.some((n) => n.id === id)) throw ERR('unknown-node');
  return { ...level, nodes: level.nodes.map((n) => (n.id === id ? fn(n) : n)) };
};

export function moveNode(root: Diagram, path: readonly Id[], id: Id, position: Position): Diagram {
  return updateLevel(root, path, (l) => mapNode(l, id, (n) => ({ ...n, position })));
}

export function moveNodes(root: Diagram, path: readonly Id[], moves: { id: Id; position: Position }[]): Diagram {
  return updateLevel(root, path, (l) => {
    const by = new Map(moves.map((m) => [m.id, m.position]));
    for (const m of moves) if (!l.nodes.some((n) => n.id === m.id)) throw ERR('unknown-node');
    return { ...l, nodes: l.nodes.map((n) => (by.has(n.id) ? { ...n, position: by.get(n.id)! } : n)) };
  });
}

export interface NodePatch {
  label?: string;
  agentId?: Id;
  /** Tarea del nodo agente; cadena vacía la quita [R32.1]. */
  task?: string;
  /** Conocimiento solo de este paso; vacío lo quita [R33.1]. */
  extra?: KnowledgeExtra;
  /** Modelo del paso; `''` lo quita y vuelve al del agente [R40.2]. */
  model?: string;
  /** Confirmar antes de terminar; `false` lo quita [R43.2]. */
  confirm?: boolean;
  router?: Partial<RouterConfig>;
  loop?: Partial<Omit<LoopConfig, 'body'>>;
  /** Cambios del nodo transformar; un texto vacío quita ese campo [R37.12]. */
  transform?: Partial<TransformConfig>;
  review?: Partial<ReviewConfig>;
}

/** Deja un conocimiento añadido sin listas vacías; `undefined` si no queda nada [R33.1]. */
function cleanExtra(extra: KnowledgeExtra | undefined): KnowledgeExtra | undefined {
  const m = mergeExtra(extra);
  return Object.keys(m).length > 0 ? m : undefined;
}

/** Fija el conocimiento que reciben todos los agentes del diagrama [R33.1]. */
export function setDiagramExtra(root: Diagram, extra: KnowledgeExtra | undefined): Diagram {
  const clean = cleanExtra(extra);
  const { extra: _old, ...rest } = root;
  void _old;
  return clean ? { ...rest, extra: clean } : rest;
}

export function updateNode(root: Diagram, path: readonly Id[], id: Id, patch: NodePatch): Diagram {
  return updateLevel(root, path, (l) =>
    mapNode(l, id, (n) => {
      const next: DiagramNode = { ...n };
      if (patch.label !== undefined) next.label = patch.label;
      if (patch.agentId !== undefined) {
        if (n.kind !== 'agent') throw ERR('invalid');
        next.agentId = patch.agentId;
      }
      if (patch.task !== undefined) {
        if (n.kind !== 'agent') throw ERR('invalid');
        if (patch.task.trim() === '') delete next.task;
        else next.task = patch.task;
      }
      if (patch.model !== undefined) {
        if (n.kind !== 'agent') throw ERR('invalid');
        if (patch.model === '') delete next.model;
        else if (isKnownModel(patch.model)) next.model = patch.model;
        else throw ERR('invalid');
      }
      if (patch.confirm !== undefined) {
        if (n.kind !== 'agent') throw ERR('invalid');
        if (patch.confirm) next.confirm = true;
        else delete next.confirm;
      }
      if (patch.extra !== undefined) {
        if (n.kind !== 'agent') throw ERR('invalid');
        const clean = cleanExtra(patch.extra);
        if (clean) next.extra = clean;
        else delete next.extra;
      }
      if (patch.router) {
        if (n.kind !== 'router') throw ERR('invalid');
        next.router = { mode: 'ai', ...n.router, ...patch.router };
      }
      if (patch.review) {
        if (n.kind !== 'review') throw ERR('invalid');
        const merged: ReviewConfig = { maxRounds: 3, mode: 'verdict', ...n.review, ...patch.review };
        merged.maxRounds = Math.min(MAX_REVIEW_ROUNDS, Math.max(1, Math.round(merged.maxRounds)));
        if (!merged.criteria?.trim()) delete merged.criteria;
        // «route» solo vale en una revisión humana [R53.1].
        if (merged.mode !== 'human') delete merged.route;
        next.review = merged;
      }
      if (patch.loop) {
        if (n.kind !== 'loop' || !n.loop) throw ERR('invalid');
        next.loop = { ...n.loop, ...patch.loop };
      }
      if (patch.transform) {
        if (n.kind !== 'transform') throw ERR('invalid');
        const merged: TransformConfig = { mode: 'rules', format: 'json', ...n.transform, ...patch.transform };
        for (const k of ['template', 'instructions', 'schema', 'sample'] as const) {
          if (merged[k] !== undefined && merged[k]!.trim() === '') delete merged[k];
        }
        if (merged.maxAttempts === undefined) delete merged.maxAttempts;
        next.transform = merged;
      }
      return next;
    }),
  );
}

export function removeNode(root: Diagram, path: readonly Id[], id: Id): Diagram {
  return updateLevel(root, path, (l) => {
    const node = l.nodes.find((n) => n.id === id);
    if (!node) throw ERR('unknown-node');
    if (node.kind === 'entry' || node.kind === 'output') throw ERR('protected');
    return {
      ...l,
      nodes: l.nodes.filter((n) => n.id !== id),
      edges: l.edges.filter((e) => e.from !== id && e.to !== id),
    };
  });
}

function reaches(edges: readonly Edge[], from: Id, target: Id): boolean {
  const seen = new Set<Id>([from]);
  const stack = [from];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === target) return true;
    for (const e of edges) {
      if (e.from === id && !seen.has(e.to)) {
        seen.add(e.to);
        stack.push(e.to);
      }
    }
  }
  return false;
}

/**
 * Conecta dos nodos. Desde una revisión hay que decir la salida (`port`), que no puede estar ya conectada; solo la
 * salida ✗ Rechazado puede volver atrás (retorno). Los retornos existentes no cuentan al buscar ciclos [R34.16].
 */
export function connect(root: Diagram, path: readonly Id[], from: Id, to: Id, port?: ReviewPort): { diagram: Diagram; edgeId: Id } {
  // Dos salidas de una revisión pueden ir al mismo nodo (✓ y ⏱ a Salida): el id lleva el puerto.
  const edgeId = port ? `${from}.${port}->${to}` : `${from}->${to}`;
  const diagram = updateLevel(root, path, (l) => {
    const a = l.nodes.find((n) => n.id === from);
    const b = l.nodes.find((n) => n.id === to);
    if (!a || !b) throw ERR('unknown-node');
    if (from === to) throw ERR('self-edge');
    if (a.kind === 'output') throw ERR('from-output');
    if (b.kind === 'entry') throw ERR('into-entry');
    if (a.kind === 'review') {
      if (!port) throw ERR('port-required');
      if (l.edges.some((e) => e.from === from && e.port === port)) throw ERR('port-taken');
    } else if (port) throw ERR('invalid');
    if (l.edges.some((e) => e.id === edgeId || (e.from === from && e.to === to && e.port === port))) throw ERR('duplicate-edge');
    const returns = returnEdges(l);
    const forward = l.edges.filter((e) => !returns.has(e.id));
    if (reaches(forward, to, from) && !(a.kind === 'review' && port === 'rejected')) throw ERR('cycle');
    return { ...l, edges: [...l.edges, { id: edgeId, from, to, ...(port ? { port } : {}) }] };
  });
  return { diagram, edgeId };
}

export function disconnect(root: Diagram, path: readonly Id[], edgeId: Id): Diagram {
  return updateLevel(root, path, (l) => {
    if (!l.edges.some((e) => e.id === edgeId)) throw ERR('unknown-edge');
    return { ...l, edges: l.edges.filter((e) => e.id !== edgeId) };
  });
}

/**
 * Inserta un nodo en medio de una conexión: from → nuevo → to, en un solo cambio. Va al punto medio si cabe;
 * si no, a un paso del origen y desplaza a la derecha los nodos que quedan detrás.
 * La condición de la arista original se conserva en el tramo que sale del router [R32.8][R32.9].
 */
export function insertOnEdge(
  root: Diagram,
  path: readonly Id[],
  edgeId: Id,
  spec: DistributiveOmit<NewNodeSpec, 'position'>,
): { diagram: Diagram; id: Id } {
  const level = getLevel(root, path);
  const edge = level.edges.find((e) => e.id === edgeId);
  if (!edge) throw ERR('unknown-edge');
  // En un retorno no se inserta nada: el paso nuevo cerraría un ciclo [R34.17].
  if (returnEdges(level).has(edgeId)) throw ERR('invalid');
  const a = level.nodes.find((n) => n.id === edge.from)?.position ?? { x: 0, y: 0 };
  const b = level.nodes.find((n) => n.id === edge.to)?.position ?? { x: a.x + 2 * INSERT_STEP, y: a.y };
  let base = root;
  let position: Position;
  if (b.x - a.x >= 2 * INSERT_STEP) position = { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) };
  else {
    // Sin hueco: el nuevo nodo va un paso a la derecha del origen y lo que queda a su derecha se desplaza.
    position = { x: a.x + INSERT_STEP, y: a.y };
    const shift = a.x + 2 * INSERT_STEP - b.x;
    base = updateLevel(root, path, (l) => ({
      ...l,
      nodes: l.nodes.map((n) => (n.position && n.id !== edge.from && n.position.x > a.x ? { ...n, position: { x: n.position.x + shift, y: n.position.y } } : n)),
    }));
  }
  const added = addNode(base, path, { ...spec, position } as NewNodeSpec);
  let next = disconnect(added.diagram, path, edgeId);
  // El tramo que sale de una revisión conserva su salida [R34.17].
  const first = connect(next, path, edge.from, added.id, edge.port);
  next = first.diagram;
  if (edge.condition !== undefined) next = setCondition(next, path, first.edgeId, edge.condition);
  next = connect(next, path, added.id, edge.to).diagram;
  return { diagram: next, id: added.id };
}

/** Ramas en paralelo: varios agentes a la vez y, opcionalmente, un agente que junta sus resultados [R32.36]. */
export interface ParallelSpec {
  branches: { agentId: Id; label?: string; task?: string }[];
  join?: { agentId: Id; label?: string; task?: string };
}
/** Separación vertical entre ramas en paralelo [R32.36]. */
export const BRANCH_STEP = 150;
/** Máximo de ramas que se insertan de una vez [R32.36]. */
export const MAX_BRANCHES = 8;

/**
 * Sustituye la conexión A → B por varias ramas en paralelo: A → cada rama → (unión →) B. Las ramas se apilan
 * en columna centrada en A; si no cabe, se desplaza a la derecha lo que queda detrás. Si A es un router, cada
 * tramo que sale de él conserva la condición original [R32.36].
 */
export function insertParallel(root: Diagram, path: readonly Id[], edgeId: Id, spec: ParallelSpec): { diagram: Diagram; ids: Id[]; joinId?: Id } {
  if (spec.branches.length < 2 || spec.branches.length > MAX_BRANCHES) throw ERR('invalid');
  const level = getLevel(root, path);
  const edge = level.edges.find((e) => e.id === edgeId);
  if (!edge) throw ERR('unknown-edge');
  // Cada salida de una revisión lleva una sola conexión: las ramas se ponen detrás de un paso [R34.16].
  if (edge.port !== undefined) throw ERR('invalid');
  const a = level.nodes.find((n) => n.id === edge.from)?.position ?? { x: 0, y: 0 };
  const b = level.nodes.find((n) => n.id === edge.to)?.position;
  const columns = spec.join ? 2 : 1;
  const need = a.x + (columns + 1) * INSERT_STEP;
  let next = root;
  if (b && b.x < need) {
    const shift = need - b.x;
    next = updateLevel(root, path, (l) => ({
      ...l,
      nodes: l.nodes.map((n) => (n.position && n.id !== edge.from && n.position.x > a.x ? { ...n, position: { x: n.position.x + shift, y: n.position.y } } : n)),
    }));
  }
  next = disconnect(next, path, edgeId);
  const top = a.y - ((spec.branches.length - 1) * BRANCH_STEP) / 2;
  const ids: Id[] = [];
  for (const [i, br] of spec.branches.entries()) {
    const added = addNode(next, path, { kind: 'agent', agentId: br.agentId, ...(br.label ? { label: br.label } : {}), position: { x: a.x + INSERT_STEP, y: Math.round(top + i * BRANCH_STEP) } });
    next = br.task?.trim() ? updateNode(added.diagram, path, added.id, { task: br.task }) : added.diagram;
    const c = connect(next, path, edge.from, added.id);
    next = edge.condition !== undefined ? setCondition(c.diagram, path, c.edgeId, edge.condition) : c.diagram;
    ids.push(added.id);
  }
  let joinId: Id | undefined;
  if (spec.join) {
    const j = addNode(next, path, { kind: 'agent', agentId: spec.join.agentId, ...(spec.join.label ? { label: spec.join.label } : {}), position: { x: a.x + 2 * INSERT_STEP, y: a.y } });
    joinId = j.id;
    next = spec.join.task?.trim() ? updateNode(j.diagram, path, j.id, { task: spec.join.task }) : j.diagram;
    for (const id of ids) next = connect(next, path, id, j.id).diagram;
    next = connect(next, path, j.id, edge.to).diagram;
  } else {
    for (const id of ids) next = connect(next, path, id, edge.to).diagram;
  }
  return { diagram: next, ids, ...(joinId ? { joinId } : {}) };
}


/** Pone o quita el entregable del diagrama; los problemas se ven en la validación [R46.12]. */
export function setDeliverable(root: Diagram, spec: DeliverableSpec | undefined): Diagram {
  const { deliverable: _old, ...rest } = root;
  void _old;
  return spec ? { ...rest, deliverable: structuredClone(spec) } : rest;
}

/** Subtítulo del entregable: «enlaces + resumen .md + 1 sección» [R46.12]. */
export function deliverableLabel(spec: DeliverableSpec | undefined): string | undefined {
  if (!spec || spec.items.length === 0) return undefined;
  const parts: string[] = [];
  const kinds = spec.items.map((i) => i.kind);
  if (kinds.includes('links')) parts.push('enlaces');
  if (kinds.includes('summary')) parts.push('resumen .md');
  const json = kinds.filter((k) => k === 'json').length;
  if (json > 0) parts.push(json === 1 ? 'JSON' : `${json} JSON`);
  const custom = kinds.filter((k) => k === 'custom').length;
  if (custom > 0) parts.push(`${custom} ${custom === 1 ? 'sección' : 'secciones'}`);
  return parts.join(' + ');
}

/** Largo máximo del nombre de un diagrama [R32.38]. */
export const MAX_DIAGRAM_NAME = 80;

/** Cambia el nombre del diagrama; vacío o igual no cambia nada [R32.38]. */
export function renameDiagram(root: Diagram, name: string): Diagram {
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, MAX_DIAGRAM_NAME);
  if (clean === '' || clean === root.name) return root;
  return { ...root, name: clean };
}

/** Separación horizontal que deja un nodo insertado (ancho de tarjeta + aire) [R32.9]. */
export const INSERT_STEP = 280;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Fija o quita la condición de una conexión. Solo las que salen de un router la admiten. */
export function setCondition(root: Diagram, path: readonly Id[], edgeId: Id, text: string | undefined): Diagram {
  return updateLevel(root, path, (l) => {
    const edge = l.edges.find((e) => e.id === edgeId);
    if (!edge) throw ERR('unknown-edge');
    const source = l.nodes.find((n) => n.id === edge.from);
    if (source?.kind !== 'router') throw ERR('invalid');
    const value = text?.trim();
    return {
      ...l,
      edges: l.edges.map((e) => {
        if (e.id !== edgeId) return e;
        const next: Edge = { id: e.id, from: e.from, to: e.to };
        return value ? { ...next, condition: value } : next;
      }),
    };
  });
}

/** Duplica un nodo (sin sus conexiones) con id nuevo y posición desplazada [R14.15]. */
export function duplicateNode(root: Diagram, path: readonly Id[], id: Id): { diagram: Diagram; id: Id } {
  let newId = '';
  const diagram = updateLevel(root, path, (level) => {
    const node = level.nodes.find((n) => n.id === id);
    if (!node) throw ERR('unknown-node');
    if (node.kind === 'entry' || node.kind === 'output') throw ERR('protected');
    newId = nextId(level, node.kind);
    const copy: DiagramNode = structuredClone(node);
    copy.id = newId;
    copy.position = { x: (node.position?.x ?? 0) + 40, y: (node.position?.y ?? 0) + 40 };
    if (copy.label !== undefined) copy.label = `${copy.label} (copia)`;
    return { ...level, nodes: [...level.nodes, copy] };
  });
  return { diagram, id: newId };
}
