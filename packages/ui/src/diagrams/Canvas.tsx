import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Background,
  Controls,
  ReactFlow,
  applyNodeChanges,
  type Connection,
  type Edge as FlowEdge,
  useReactFlow,
  type NodeChange,
} from '@xyflow/react';
import { Braces, Copy, GitFork, LogIn, Pencil, Repeat2, ShieldCheck, Trash2, Bot, Workflow } from 'lucide-react';
import { MODELS, finalSteps, returnEdges, type Diagram, type KnowledgeExtra, type ReviewPort, type RunEvent, isCoordinator, splitBranchIds } from '@orquestador/core';
import { deliverableLabel, edgeTraversals, isForcedOnStep, isRequired, knowledgeKey, setRequired, transformSubtitle, type EditorSession, type LiveView } from '@orquestador/editor';
import { EdgeInspector } from './EdgeInspector';
import { OrqNode, type NodeFile, type OrqFlowNode } from './OrqNode';
import { ResNode, type ResFlowNode, type ResNodeData } from './ResNode';
import { BranchNode, branchFlowNodes, withoutBranchBoxes } from './BranchNode';
import { OrqEdge, OrqReturnEdge, type InsertHandler } from './OrqEdge';
import { ContextMenu, type MenuItem } from '../common';
import { useSession } from './useSession';
import type { AgentLook } from '../common';
import { t } from '@orquestador/editor';

export interface Selection {
  nodes: string[];
  edges: string[];
}

interface Props {
  session: EditorSession;
  onSelection: (s: Selection) => void;
  onReject: (message: string) => void;
  /** Estado de la ejecución para pintar en vivo (R15.1). */
  live?: LiveView;
  /** Eventos de la ejecución en pantalla: con ellos, pulsar un hilo abre su inspector [R42.6]. */
  events?: readonly RunEvent[];
  /** Añade un nodo en una posición del lienzo (menú contextual); el agente abre la galería [R21.12]. */
  onAddAt?: (kind: 'agent' | 'router' | 'loop' | 'review' | 'transform' | 'coordinator', position: { x: number; y: number }, opts?: { human?: boolean }) => void;
  /** «Insertar transformación» en el menú de una conexión [R37.11]. */
  onInsertTransform?: (edgeId: string) => void;
  /** Doble clic en un nodo que no es un bucle: abre su ventana de ejecución [R15.12]. */
  onOpenNode?: (id: string) => void;
  /** Pide al inspector que enfoque el campo de nombre o de condición [R21.12]. */
  onEdit?: (what: 'label' | 'condition') => void;
  /** Selecciona un nodo desde fuera (p. ej. «En este diagrama») [R21.15]. */
  selectRequest?: { id: string; n: number };
  /** Nombres de los agentes para el subtítulo de los nodos. */
  agentNames?: Readonly<Record<string, string>>;
  /** Botón «+» de una conexión: insertar un paso en medio [R32.8]. */
  onInsert?: InsertHandler;
  extras?: NodeExtras;
  /** Acciones del agente de un nodo para el menú del botón derecho [R32.34]. */
  agentMenu?: (agentId: string, nodeId: string) => AgentMenu;
  /** Ejecución en curso: no se mueve, conecta, inserta ni borra nada [R32.37]. */
  readOnly?: boolean;
  /** Soltar un diagrama del panel: lo añade como subdiagrama [R33.8]. */
  onAddSubdiagram?: (diagramId: string, position: { x: number; y: number }) => void;
  /** «Abrir el diagrama» desde el menú de un subdiagrama [R33.9]. */
  onOpenDiagram?: (diagramId: string) => void;
  /** «+» de un conector del agente: añadir skill/contexto o MCP solo a ese paso [R33.10]. */
  onAddKnowledge?: (nodeId: string, port: 'know' | 'mcp') => void;
  /** Soltar una skill, contexto o MCP de la paleta sobre un agente [R33.11]. */
  onDropKnowledge?: (nodeId: string, kind: 'skillIds' | 'contextIds' | 'mcpIds', id: string) => void;
}

/** Entradas del menú de un agente: arriba (Editar, Cambiar…) y su conocimiento agrupado [R32.34]. */
export interface AgentMenu {
  top: MenuItem[];
  knowledge: MenuItem[];
  /** Solo para el paso pulsado: conocimiento y MCP «solo aquí» y alta asistida [R30.10]. */
  here?: MenuItem[];
}

type MenuTarget = { x: number; y: number; kind: 'node' | 'edge' | 'pane'; id?: string; at?: { x: number; y: number } };

const nodeTypes = { orq: OrqNode, res: ResNode, branch: BranchNode };
const edgeTypes = { orq: OrqEdge, orqReturn: OrqReturnEdge };

/** Tipo de dato al arrastrar un nodo desde la paleta [R21.4]. */
export const DRAG_TYPE = 'application/x-orquestador-node';

/** Subtítulo de la tarjeta: agente asignado, o modo del router o del bucle [R21.5]. */
function subtitle(n: Diagram['nodes'][number], agentNames: Readonly<Record<string, string>>, level: Diagram): string | undefined {
  if (n.kind === 'agent') {
    if (!n.agentId) return undefined;
    const agent = agentNames[n.agentId] ?? n.agentId;
    // Un paso con modelo propio lo enseña junto al agente [R40.5].
    const sub = n.model ? t('node.sub.model', { agent, model: MODELS.find((m) => m.id === n.model)?.name ?? n.model }) : agent;
    // Confirma antes de terminar [R43.3].
    const confirmed = n.confirm ? t('node.sub.confirm', { sub }) : sub;
    return isCoordinator(n) ? t('node.sub.split', { sub: confirmed, n: splitBranchIds(level, n.id).length }) : confirmed;
  }
  if (n.kind === 'subdiagram') return n.subdiagram ? t('sub.sub', { name: agentNames[`diagram:${n.subdiagram.templateId}`] ?? n.subdiagram.templateId }) : undefined;
  if (n.kind === 'router') return t(n.router?.mode === 'rules' ? 'node.sub.router.rules' : 'node.sub.router.ai');
  if (n.kind === 'transform') return transformSubtitle(n.transform);
  if (n.kind === 'review') return t(n.review?.mode === 'ai' ? 'node.sub.review.ai' : n.review?.mode === 'human' ? 'node.sub.review.human' : 'node.sub.review.verdict');
  if (n.kind === 'loop' && n.loop) {
    if (n.loop.mode === 'ai-judge') return t('node.sub.loop.ai');
    const c = n.loop.count ?? 1;
    return c === 1 ? t('node.sub.loop.count.one') : t('node.sub.loop.count', { n: c });
  }
  return undefined;
}

/** Datos extra de las tarjetas (prototipo «Editor A»): conocimiento de cada agente y última entrada [R32.27]. */
export interface NodeExtras {
  agentChips?: Readonly<Record<string, string[]>>;
  entryText?: string | undefined;
  /** Nombres de skills, contextos y MCP para las fichas de lo añadido en un paso [R33.5]. */
  knowledgeNames?: Readonly<Record<string, string>>;
  /** Icono, tono y «pregunta antes de actuar» de cada agente [R39.5][R39.9]. */
  agentLooks?: Readonly<Record<string, AgentLook>>;
  /** Archivos que creó o cambió cada paso en la ejecución, por clave `ruta/id` [R54.1]. */
  stepFiles?: Readonly<Record<string, readonly NodeFile[]>>;
  /** «Ampliar» la vista previa de un archivo de un paso [R54.2]. */
  onOpenFile?: ((key: string, path: string) => void) | undefined;
  /** Vista previa pequeña de un archivo de un paso, para la tarjeta junto al nodo [R54.2]. */
  previewCard?: ((key: string, path: string) => ReactNode) | undefined;
}

/** Callbacks de los conectores de un agente [R33.10]. */
interface PortHandlers {
  onPort?: ((nodeId: string, port: 'know' | 'mcp') => void) | undefined;
  onRemove?: ((stepId: string, kind: ResNodeData['kind'], itemId: string) => void) | undefined;
  /** Marca o desmarca una ficha como obligatoria [R36.16]. */
  onToggleRequired?: ((stepId: string, kind: ResNodeData['kind'], itemId: string) => void) | undefined;
  /** Conocimiento del diagrama: lo que sea obligatorio allí lo es en todos los pasos [R36.19]. */
  diagramExtra?: KnowledgeExtra | undefined;
}

export type CanvasNode = OrqFlowNode | ResFlowNode;
const RES_W = 150;
const RES_GAP = 12;

/** Obligatoriedad y estado en vivo de una ficha [R36.16–R36.19]. */
function ficha(n: Diagram['nodes'][number], k: ResNodeData['kind'], id: string, more: { ports?: PortHandlers; live?: LiveView; key?: string }): Partial<ResNodeData> {
  const forced = isForcedOnStep(k);
  const own = forced || isRequired(n.extra, k, id);
  const byDiagram = !forced && isRequired(more.ports?.diagramExtra, k, id);
  const known = more.live?.knowledge?.[more.key ?? n.id]?.[knowledgeKey(k, id)];
  const status = more.live?.nodeStatus[more.key ?? n.id];
  const state = known ?? (status === 'succeeded' || status === 'failed' ? ('unused' as const) : undefined);
  return {
    ...(own || byDiagram ? { required: true } : {}),
    ...(byDiagram ? { byDiagram: true } : {}),
    ...(forced ? { plugged: true } : {}),
    ...(state ? { state } : {}),
    // Lo enchufado (skills y MCP) no se puede desmarcar [R36.22].
    ...(more.ports?.onToggleRequired && !forced ? { onToggleRequired: more.ports.onToggleRequired } : {}),
  };
}

/**
 * Lo añadido a un paso (SPEC-033) dibujado como fichas enchufadas: skills y contextos encima del agente y MCP debajo.
 * Son hijos del nodo en React Flow, así que se mueven con él; no se guardan como nodos del diagrama [R33.10].
 */
export function resourceNodes(n: Diagram['nodes'][number], names: Readonly<Record<string, string>> = {}, onRemove?: PortHandlers['onRemove'], more: { ports?: PortHandlers; live?: LiveView; key?: string } = {}): ResFlowNode[] {
  if (n.kind !== 'agent' || !n.extra) return [];
  const row = (kinds: ResNodeData['kind'][], y: number) => {
    const items = kinds.flatMap((k) => (n.extra?.[k] ?? []).map((id) => ({ k, id })));
    const width = items.length * RES_W + (items.length - 1) * RES_GAP;
    return items.map(({ k, id }, i): ResFlowNode => ({
      id: `res:${n.id}:${k}:${id}`,
      type: 'res',
      parentId: n.id,
      position: { x: 112 - width / 2 + i * (RES_W + RES_GAP), y },
      draggable: false,
      selectable: false,
      deletable: false,
      // React Flow desactiva el ratón en nodos que no se seleccionan ni arrastran: la × tiene que funcionar.
      style: { pointerEvents: 'all' },
      data: { kind: k, itemId: id, label: names[id] ?? id, stepId: n.id, ...(onRemove ? { onRemove } : {}), ...ficha(n, k, id, more) },
    }));
  };
  return [...row(['skillIds', 'contextIds'], -96), ...row(['mcpIds'], 168)];
}

/** Conexiones discontinuas de cada ficha a su conector [R33.10]. */
export function resourceEdges(nodes: readonly CanvasNode[]): FlowEdge[] {
  return nodes
    .filter((n): n is ResFlowNode => n.type === 'res')
    .map((n) => ({
      id: `res-edge:${n.id}`,
      source: n.id,
      target: n.data.stepId,
      targetHandle: n.data.kind === 'mcpIds' ? 'mcp' : 'know',
      className: `${n.data.kind === 'mcpIds' ? 'orq-res-edge is-mcp' : 'orq-res-edge'}${n.data.required ? ' is-required' : ''}`,
      selectable: false,
      deletable: false,
      focusable: false,
    }));
}

/** Fichas del agente y, marcadas con «+», lo añadido solo en este paso; como mucho tres [R32.27][R33.5]. */
function chipsOf(n: Diagram['nodes'][number], extra: NodeExtras): { chips?: string[] } {
  if (n.kind !== 'agent') return {};
  // Lo añadido al paso se dibuja enchufado a sus conectores; en la tarjeta queda lo que trae el agente [R33.10].
  const own = n.agentId ? (extra.agentChips?.[n.agentId] ?? []) : [];
  return own.length > 0 ? { chips: own.slice(0, 3) } : {};
}

/** Un paso con varias entradas espera a todas: «Espera a N» o, en vivo, «X de N listos» [R32.36]. */
function waitsOf(level: Diagram, path: readonly string[], id: string, live?: LiveView): { waits?: string } {
  // El retorno de una revisión no se espera, y sus salidas se excluyen entre sí: cuentan como una entrada [R34.21].
  const back = returnEdges(level);
  const incoming = level.edges.filter((e) => e.to === id && !back.has(e.id));
  const sources = [...new Set(incoming.map((e) => e.from))];
  if (sources.length < 2) return {};
  const running = live && live.status !== 'idle';
  if (!running) return { waits: t('node.waits', { n: sources.length }) };
  const done = sources.filter((src) => incoming.some((e) => e.from === src && live.edges.has([...path, e.id].join('/')))).length;
  return { waits: t('node.waits.live', { done, n: sources.length }) };
}

/** Nodos de React Flow para un nivel del diagrama, con su estado en vivo [R15.1][R15.5]. */
export function buildFlowNodes(
  level: Diagram,
  path: readonly string[],
  problems: Record<string, string[]>,
  live?: LiveView,
  agentNames: Readonly<Record<string, string>> = {},
  warningOnly: Readonly<Record<string, true>> = {},
  extra: NodeExtras = {},
  ports: PortHandlers = {},
): CanvasNode[] {
  // Pasos finales del entregable y subtítulo de la Salida [R46.13].
  const dlv = path.length === 0 ? level.deliverable : undefined;
  const finals = dlv && (dlv.notify ?? 'final') !== 'none' ? new Set(finalSteps(level)) : new Set<string>();
  const dlvLabel = deliverableLabel(dlv);
  const main = level.nodes.map((n, i): OrqFlowNode => {
    const key = [...path, n.id].join('/');
    const runStatus = live?.nodeStatus[key];
    const loop = live?.loops[key];
    const review = live?.reviews[key];
    const gitActions = live?.gitActions[key];
    const prUrl = live?.gitLinks[key];
    const own = subtitle(n, agentNames, level);
    const sub = own !== undefined && finals.has(n.id) ? t('node.sub.final', { sub: own }) : own;
    return {
      id: n.id,
      type: 'orq',
      position: n.position ?? { x: 40 + i * 40, y: 40 + i * 40 },
      data: {
        kind: n.kind,
        label: n.label ?? n.id,
        ...(sub ? { sub } : {}),
        problems: problems[n.id] ?? [],
        ...(warningOnly[n.id] ? { warnOnly: true } : {}),
        ...(n.kind === 'agent' ? { task: (n.task ?? '').trim().split('\n')[0]!.slice(0, 120) } : {}),
        ...chipsOf(n, extra),
        ...(n.kind === 'entry' && path.length === 0 ? { note: extra.entryText ? `«${extra.entryText.length > 60 ? `${extra.entryText.slice(0, 60)}…` : extra.entryText}»` : t('node.entry.note') } : {}),
        ...(n.kind === 'output' && path.length === 0 ? { note: dlvLabel ? t('node.output.deliverable', { what: dlvLabel }) : t('node.output.note') } : {}),
        ...waitsOf(level, path, n.id, live),
        ...(n.kind === 'loop' && n.loop ? { inner: n.loop.body.nodes.filter((b) => b.kind === 'agent' || b.kind === 'router' || b.kind === 'transform').map((b) => b.label ?? b.id).slice(0, 3), note: t('node.loop.max', { n: n.loop.maxIterations }) } : {}),
        ...(n.kind === 'review' && n.review ? { note: t('node.review.max', { n: n.review.maxRounds }), ...(n.review.mode === 'human' ? { human: true } : {}) } : {}),
        ...(runStatus ? { runStatus } : {}),
        ...(n.kind === 'agent' && n.agentId && extra.agentLooks?.[n.agentId] ? { look: extra.agentLooks[n.agentId] } : {}),
        // Mano levantada: este paso (o algo dentro de él) espera tu respuesta [R39.6].
        ...((live?.pending ?? []).some((q) => [...q.nodePath, q.nodeId].join('/') === key || `${q.nodePath.join('/')}/`.startsWith(`${key}/`)) ? { asking: true } : {}),
        ...(loop ? { loop } : {}),
        ...(review ? { review } : {}),
        ...(gitActions ? { gitActions } : {}),
        ...(prUrl ? { prUrl } : {}),
        // Fichas con lo que hizo el paso, colgadas debajo [R54.1].
        ...((extra.stepFiles?.[key]?.length ?? 0) > 0
          ? {
              files: extra.stepFiles![key]!,
              ...(extra.onOpenFile ? { onOpenFile: (path: string) => extra.onOpenFile!(key, path) } : {}),
              ...(extra.previewCard ? { renderPreview: (path: string) => extra.previewCard!(key, path) } : {}),
            }
          : {}),
        ...(n.kind === 'agent' && ports.onPort ? { onPort: (port: 'know' | 'mcp') => ports.onPort!(n.id, port) } : {}),
      },
    };
  });
  // Los hijos van detrás de sus padres, como pide React Flow.
  return [...main, ...level.nodes.flatMap((n) => resourceNodes(n, extra.knowledgeNames, ports.onRemove, { ports, ...(live ? { live } : {}), key: [...path, n.id].join('/') }))];
}

/** Aristas de React Flow; las recorridas en la ejecución se resaltan [R15.1] y solo la del paso en marcha se anima [R44.6]. Llevan el botón «+» [R32.8]. */
export function buildFlowEdges(level: Diagram, path: readonly string[], live?: LiveView, onInsert?: InsertHandler): FlowEdge[] {
  const name = (id: string) => level.nodes.find((n) => n.id === id)?.label ?? id;
  const back = returnEdges(level);
  return level.edges.map((e) => {
    const traversed = live?.edges.has([...path, e.id].join('/')) ?? false;
    // Solo se anima la conexión hacia el paso que trabaja ahora; las recorridas quedan como hechas y, al terminar,
    // las que no se recorrieron se atenúan [R44.6].
    const target = live?.nodeStatus[[...path, e.to].join('/')];
    const active = live?.status === 'running' && traversed && (target === 'running' || target === 'queued' || target === 'waiting_input');
    const skipped = live !== undefined && live.status !== 'running' && live.status !== 'idle' && !traversed;
    // Salidas de una revisión: clase por puerto; el retorno va discontinuo, por debajo y sin «+» [R34.21].
    const classes = [e.port ? `orq-edge--${e.port}` : '', back.has(e.id) ? 'orq-edge--return' : '', isSplitEdge(level, e) ? 'orq-edge--split' : '', traversed ? 'is-traversed' : '', active ? 'is-active' : '', skipped ? 'is-skipped' : ''].filter(Boolean).join(' ');
    const max = level.nodes.find((n) => n.id === e.from)?.review?.maxRounds ?? 1;
    const base: FlowEdge = {
      id: e.id,
      source: e.from,
      target: e.to,
      ...(e.port ? { sourceHandle: e.port } : {}),
      ...(classes ? { className: classes } : {}),
      ...(active ? { animated: true } : {}),
    };
    if (back.has(e.id)) return { ...base, type: 'orqReturn', label: t('edge.return', { n: max }), data: { title: t('edge.return.title', { to: name(e.to), n: max }) } };
    return {
      ...base,
      // Con puerto, el nombre dice la salida: ✓ y ⏱ pueden ir al mismo nodo [R34.21].
      ...(onInsert ? { type: 'orq', data: { onInsert, fromName: e.port ? `${name(e.from)} · ${t(`review.port.${e.port}`)}` : name(e.from), toName: name(e.to) } } : {}),
      ...(e.condition ? { label: e.condition } : {}),
    };
  });
}


/** Conexión hacia una rama de un paso que reparte [R59.13]. */
const isSplitEdge = (level: Diagram, e: Diagram['edges'][number]) => isCoordinator(level.nodes.find((n) => n.id === e.from) ?? {}) && splitBranchIds(level, e.from).includes(e.to);

/** Lienzo de React Flow. La sesión es la fuente de verdad; el arrastre se confirma al soltar [R14.4]. */
export function Canvas({ session, onSelection, onReject, live, events, onAddAt, onOpenNode, onEdit, selectRequest, agentNames, onInsert, extras, agentMenu, readOnly = false, onAddSubdiagram, onOpenDiagram, onAddKnowledge, onDropKnowledge, onInsertTransform }: Props) {
  const flow = useReactFlow();
  const [menu, setMenu] = useState<MenuTarget>();
  const closeMenu = useCallback(() => setMenu(undefined), []);
  const snap = useSession(session);
  // Al cargar otro diagrama o cambiar de nivel se encuadra todo el contenido.
  const levelKey = `${snap.diagram.id}|${snap.path.join('/')}`;
  const [inspect, setInspect] = useState<{ edgeId: string; x: number; y: number; level: string }>();
  const closeInspect = useCallback(() => setInspect(undefined), []);
  const hasRun = (events?.length ?? 0) > 0;
  useEffect(() => {
    const id = requestAnimationFrame(() => void flow.fitView({ duration: 0, padding: 0.2, maxZoom: 1 }));
    return () => cancelAnimationFrame(id);
  }, [levelKey]);
  const ports = useMemo<PortHandlers>(
    () =>
      readOnly
        ? {}
        : {
            onPort: onAddKnowledge,
            diagramExtra: snap.diagram.extra,
            onToggleRequired: (stepId, kind, itemId) => {
              const node = session.getSnapshot().level.nodes.find((x) => x.id === stepId);
              if (!node) return;
              try {
                session.updateNode(stepId, { extra: setRequired(node.extra, kind, itemId, !isRequired(node.extra, kind, itemId)) });
              } catch (e) {
                onReject(e instanceof Error ? e.message : String(e));
              }
            },
            onRemove: (stepId, kind, itemId) => {
              const node = session.getSnapshot().level.nodes.find((x) => x.id === stepId);
              if (!node) return;
              try {
                session.updateNode(stepId, { extra: { ...node.extra, [kind]: (node.extra?.[kind] ?? []).filter((x) => x !== itemId) } });
              } catch (e) {
                onReject(e instanceof Error ? e.message : String(e));
              }
            },
          },
    [readOnly, onAddKnowledge, session, onReject, snap.diagram.extra],
  );
  const derived = useMemo<CanvasNode[]>(() => buildFlowNodes(snap.level, snap.path, snap.problems.byNode, live, agentNames, snap.problems.warningOnly, extras, ports), [snap.level, snap.problems, snap.path, live, agentNames, extras, ports]);
  const [nodes, setNodes] = useState<CanvasNode[]>(derived);
  // Al cambiar los datos (p. ej. el estado en vivo) se conserva la selección y la posición que se está arrastrando.
  useEffect(
    () =>
      setNodes((prev) => {
        const old = new Map(prev.map((n) => [n.id, n]));
        return derived.map((n) => (old.get(n.id)?.selected ? { ...n, selected: true } : n));
      }),
    [derived],
  );

  // Los recuadros de las ramas van detrás de los pasos y los siguen al moverlos [R58.8].
  const shown = useMemo<CanvasNode[]>(() => {
    const boxes = live ? branchFlowNodes(snap.level, snap.path, nodes, live.branches) : [];
    return boxes.length > 0 ? ([...boxes, ...nodes] as unknown as CanvasNode[]) : nodes;
  }, [live, snap.level, snap.path, nodes]);

  useEffect(() => {
    if (!selectRequest) return;
    const id = selectRequest.id;
    setNodes((cur) => cur.map((n) => ({ ...n, selected: n.id === id })));
    onSelection({ nodes: [id], edges: [] });
  }, [selectRequest]);

  const inspectedId = inspect && inspect.level === levelKey && hasRun ? inspect.edgeId : undefined;
  const edges = useMemo<FlowEdge[]>(
    () => [
      ...buildFlowEdges(snap.level, snap.path, live, readOnly ? undefined : onInsert).map((e) => (e.id === inspectedId ? { ...e, className: `${e.className ?? ''} is-inspected`.trim() } : e)),
      ...resourceEdges(derived),
    ],
    [snap.level, snap.path, live, onInsert, readOnly, derived, inspectedId],
  );
  const inspected = inspectedId ? snap.level.edges.find((e) => e.id === inspectedId) : undefined;
  const traversals = useMemo(() => (inspected && events ? edgeTraversals(events, inspected, snap.path) : []), [inspected, events, snap.path]);
  const stepName = (id: string): string => {
    const n = snap.level.nodes.find((x) => x.id === id);
    return n?.label ?? (n?.agentId ? agentNames?.[n.agentId] : undefined) ?? id;
  };

  const onNodesChange = useCallback((changes: NodeChange<CanvasNode>[]) => {
    const own = withoutBranchBoxes(changes);
    if (own.length > 0) setNodes((cur) => applyNodeChanges(own, cur));
  }, []);

  const onSelectionChange = useCallback(
    ({ nodes: ns, edges: es }: { nodes: { id: string }[]; edges: { id: string }[] }) =>
      onSelection({ nodes: ns.map((n) => n.id), edges: es.map((e) => e.id) }),
    [onSelection],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      const port = c.sourceHandle && ['approved', 'rejected', 'exhausted'].includes(c.sourceHandle) ? (c.sourceHandle as ReviewPort) : undefined;
      const res = session.tryConnect(c.source, c.target, port);
      if (!res.ok) onReject(res.message);
    },
    [session, onReject],
  );

  const guard = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      onReject(e instanceof Error ? e.message : String(e));
    }
  };
  const select = (nodeIds: string[], edgeIds: string[]) => {
    setNodes((cur) => cur.map((n) => ({ ...n, selected: nodeIds.includes(n.id) })));
    onSelection({ nodes: nodeIds, edges: edgeIds });
  };

  const items = (): MenuItem[] => {
    if (!menu) return [];
    if (menu.kind === 'node') {
      const node = snap.level.nodes.find((n) => n.id === menu.id);
      if (!node) return [];
      const fixed = node.kind === 'entry' || node.kind === 'output';
      const id = node.id;
      const am = node.kind === 'agent' && node.agentId && !isCoordinator(node) ? agentMenu?.(node.agentId, id) : undefined;
      const sub = node.kind === 'subdiagram' && node.subdiagram && onOpenDiagram ? [{ id: 'sub-open', label: t('sub.open'), icon: <Workflow size={16} />, onSelect: () => onOpenDiagram(node.subdiagram!.templateId) }] : [];
      if (readOnly && sub.length > 0) return sub;
      // En ejecución solo se puede consultar: abrir el agente y su conocimiento [R32.37].
      if (readOnly) return [...(am?.top.filter((x) => x.id === 'agent-edit') ?? []), ...(am?.knowledge.filter((x) => x.id !== 'skill-assign') ?? [])];
      return [
        ...sub,
        ...(am?.top ?? []),
        { id: 'rename', label: t('menu.node.rename'), icon: <Pencil size={16} />, onSelect: () => { select([id], []); onEdit?.('label'); } },
        { id: 'duplicate', label: t('menu.node.duplicate'), icon: <Copy size={16} />, disabled: fixed, onSelect: () => guard(() => { const nid = session.duplicateNode(id); select([nid], []); }) },
        ...(node.kind === 'loop' ? [{ id: 'enter', label: t('menu.node.enter'), icon: <LogIn size={16} />, onSelect: () => session.enter(id) }] : []),
        ...(am?.knowledge ?? []),
        ...(am?.here ?? []),
        { id: 'delete', label: t('menu.node.delete'), icon: <Trash2 size={16} />, danger: true, disabled: fixed, group: am && (am.knowledge.length > 0 || (am.here?.length ?? 0) > 0) ? ' ' : undefined, onSelect: () => { guard(() => session.removeSelection({ nodes: [id] })); select([], []); } },
      ];
    }
    if (readOnly) return [];
    if (menu.kind === 'edge') {
      const edge = snap.level.edges.find((e) => e.id === menu.id);
      if (!edge) return [];
      const fromRouter = snap.level.nodes.find((n) => n.id === edge.from)?.kind === 'router';
      const id = edge.id;
      return [
        { id: 'condition', label: t('menu.edge.condition'), icon: <Pencil size={16} />, disabled: !fromRouter, onSelect: () => { select([], [id]); onEdit?.('condition'); } },
        ...(onInsertTransform ? [{ id: 'transform', label: t('menu.edge.transform'), icon: <Braces size={16} />, onSelect: () => onInsertTransform(id) }] : []),
        { id: 'delete', label: t('menu.edge.delete'), icon: <Trash2 size={16} />, danger: true, onSelect: () => { guard(() => session.removeSelection({ edges: [id] })); select([], []); } },
      ];
    }
    const at = menu.at ?? { x: 0, y: 0 };
    return [
      { id: 'agent', label: t('menu.pane.agent'), icon: <Bot size={16} />, onSelect: () => onAddAt?.('agent', at) },
      { id: 'router', label: t('menu.pane.router'), icon: <GitFork size={16} />, onSelect: () => onAddAt?.('router', at) },
      { id: 'loop', label: t('menu.pane.loop'), icon: <Repeat2 size={16} />, onSelect: () => onAddAt?.('loop', at) },
      { id: 'transform', label: t('menu.pane.transform'), icon: <Braces size={16} />, onSelect: () => onAddAt?.('transform', at) },
      { id: 'review', label: t('menu.pane.review'), icon: <ShieldCheck size={16} />, onSelect: () => onAddAt?.('review', at) },
    ];
  };

  return (
    <div
      className="orq-canvas"
      data-testid="canvas"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DRAG_TYPE)) e.preventDefault();
      }}
      onDrop={(e) => {
        const raw = e.dataTransfer.getData(DRAG_TYPE);
        if (!raw || readOnly) return;
        e.preventDefault();
        if (raw.startsWith('res:')) {
          // res:<tipo>:<id>: se suelta sobre un paso de agente [R33.11].
          const [, kind, ...rest] = raw.split(':');
          const el = (e.target as HTMLElement).closest('.react-flow__node');
          const nodeId = el?.getAttribute('data-id') ?? '';
          const node = session.getSnapshot().level.nodes.find((x) => x.id === nodeId);
          if (!node || node.kind !== 'agent') return onReject(t('res.drop.miss'));
          onDropKnowledge?.(nodeId, kind as 'skillIds' | 'contextIds' | 'mcpIds', rest.join(':'));
          return;
        }
        if (raw.startsWith('diagram:')) {
          onAddSubdiagram?.(raw.slice('diagram:'.length), flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
          return;
        }
        if (raw === 'coordinator') {
          onAddAt?.('coordinator', flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
          return;
        }
        if (raw === 'humanReview') {
          onAddAt?.('review', flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }), { human: true });
          return;
        }
        const kind = raw as 'agent' | 'router' | 'loop' | 'review' | 'transform';
        if (kind === 'agent' || kind === 'router' || kind === 'loop' || kind === 'review' || kind === 'transform') {
          onAddAt?.(kind, flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
        }
      }}
    >
      <ReactFlow
        nodes={shown}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        onNodeDragStop={(_e, _n, dragged) => {
          session.moveNodes(dragged.map((d) => ({ id: d.id, position: { x: d.position.x, y: d.position.y } })));
        }}
        onNodeDoubleClick={(_e, n) => {
          if (n.data.kind === 'loop') session.enter(n.id);
          else onOpenNode?.(n.id);
        }}
        onSelectionChange={onSelectionChange}
        deleteKeyCode={null}
        elevateEdgesOnSelect
        onNodeContextMenu={(e, n) => {
          e.preventDefault();
          select([n.id], []);
          setMenu({ x: e.clientX, y: e.clientY, kind: 'node', id: n.id });
        }}
        onEdgeContextMenu={(e, ed) => {
          e.preventDefault();
          select([], [ed.id]);
          setMenu({ x: e.clientX, y: e.clientY, kind: 'edge', id: ed.id });
        }}
        onPaneContextMenu={(e) => {
          e.preventDefault();
          const ev = e as unknown as MouseEvent;
          setMenu({ x: ev.clientX, y: ev.clientY, kind: 'pane', at: flow.screenToFlowPosition({ x: ev.clientX, y: ev.clientY }) });
        }}
        onPaneClick={() => {
          closeMenu();
          closeInspect();
        }}
        onEdgeClick={(e, ed) => {
          // Con una ejecución en pantalla, el hilo muestra lo que viajó por él [R42.6].
          if (!hasRun || ed.id.startsWith('res-edge:')) return;
          closeMenu();
          setInspect({ edgeId: ed.id, x: e.clientX, y: e.clientY, level: levelKey });
        }}
        defaultEdgeOptions={{ interactionWidth: 28 }}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1} color="var(--grid)" />
        <Controls showInteractive={false} />
      </ReactFlow>
      {snap.level.nodes.length <= 2 && <p className="orq-canvas__empty">{t('canvas.empty')}</p>}
      {menu && items().length > 0 && <ContextMenu x={menu.x} y={menu.y} items={items()} onClose={closeMenu} />}
      {inspected && inspect && (
        <EdgeInspector
          key={inspected.id}
          traversals={traversals}
          fromName={stepName(inspected.from)}
          toName={stepName(inspected.to)}
          toIsAgent={snap.level.nodes.find((x) => x.id === inspected.to)?.kind === 'agent'}
          at={{ x: inspect.x, y: inspect.y }}
          {...(extras?.knowledgeNames ? { names: extras.knowledgeNames } : {})}
          onClose={closeInspect}
          {...(onOpenNode ? { onOpenTarget: () => { onOpenNode(inspected.to); closeInspect(); } } : {})}
        />
      )}
    </div>
  );
}
