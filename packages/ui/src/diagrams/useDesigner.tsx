import { useCallback, useEffect, useMemo, useState, type MutableRefObject } from 'react';
import { BookOpen, Bot, Copy, FileText, Pencil, Plug, Plus, Replace, Sparkles, Trash2, Workflow } from 'lucide-react';
import { SPECKIT_TEMPLATE_ID, agentUsage, installSpecKit, instantiateTemplate, t, type EditorSession, type EditorSnapshot, type ExampleTemplate, type NewNodeSpec, type ProjectApi } from '@orquestador/editor';
import { COORDINATOR_ID } from '@orquestador/core';
import type { MenuItem, OpenLibrary } from '../common';
import type { AgentMenu } from './Canvas';
import { isTypingTarget, shortcutFor } from './shortcuts';
import type { DesignerSelection } from './useDesignerSelection';
import type { DiagramDocument } from './useDiagramDocument';
import type { ProjectCatalog } from './useProjectCatalog';

interface Options {
  api: ProjectApi;
  session: EditorSession;
  snap: EditorSnapshot;
  doc: DiagramDocument;
  sel: DesignerSelection;
  catalog: ProjectCatalog;
  projectRef: MutableRefObject<string | undefined>;
  /** Última entrada lanzada, para el paso de Entrada. */
  lastInput: string;
  /** Los atajos solo actúan en el Diseñador. */
  active: boolean;
  fail: (message: string) => void;
  guard: (fn: () => void) => void;
  openLibrary: OpenLibrary;
  askAssistant: (text: string, toDiagrams?: boolean) => void;
  showRight: () => void;
}

export type AddSpec = { kind: 'coordinator' } | { kind: 'agent'; agentId: string } | { kind: 'router' } | { kind: 'loop' } | { kind: 'review'; human?: boolean } | { kind: 'transform' };

/** Acciones del Diseñador sobre el diagrama abierto: añadir pasos, menús, atajos y los diálogos que abren. */
export function useDesigner({ api, session, snap, doc, sel, catalog: lib, projectRef, lastInput, active, fail, guard, openLibrary, askAssistant, showRight }: Options) {
  const { agents, catalog, reloadAgents } = lib;
  const { selRef, select, clearSelection } = sel;
  const { diagramList, save, openDiagram, discardOk, freshDiagram, duplicateDiagram, deleteDiagram, deleteOther, requestRename } = doc;
  const [inserting, setInserting] = useState<{ edgeId: string; at: { x: number; y: number } }>();
  const onInsert = useCallback((edgeId: string, at: { x: number; y: number }) => setInserting({ edgeId, at }), []);
  const agentNames = useMemo(
    () => ({ [COORDINATOR_ID]: t('pal.step.coordinator'), ...Object.fromEntries(agents.map((a) => [a.id, a.name])), ...Object.fromEntries(diagramList.map((d) => [`diagram:${d.id}`, d.name])) }),
    [agents, diagramList],
  );
  const [examples, setExamples] = useState<ExampleTemplate[]>([]);
  const [picker, setPicker] = useState<{ at?: { x: number; y: number }; replace?: string }>();
  const usage = useMemo(() => agentUsage(snap.diagram), [snap.diagram]);
  useEffect(() => {
    void api.listExamples().then((r) => r.ok && setExamples(r.value));
  }, [api]);

  const undo = useCallback(() => void session.undo(), [session]);
  const redo = useCallback(() => void session.redo(), [session]);
  const del = useCallback(() => {
    try {
      session.removeSelection(selRef.current);
      clearSelection();
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e)); // en ejecución: solo lectura [R32.37]
    }
  }, [session, fail, selRef, clearSelection]);

  // Los atajos del editor solo actúan en Diagramas; en otras secciones los formularios tienen los suyos.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const action = shortcutFor(e);
      if (!action) return;
      e.preventDefault();
      if (action === 'delete') del();
      else if (action === 'undo') undo();
      else if (action === 'redo') redo();
      else void save();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [del, undo, redo, save, active]);

  const onAdd = (spec: AddSpec, at?: { x: number; y: number }) => {
    const n = session.getSnapshot().level.nodes.length;
    const position = at ?? { x: 60 + (n % 6) * 40, y: 60 + (n % 6) * 40 };
    guard(() => {
      const real = spec.kind === 'coordinator' ? { kind: 'agent' as const, agentId: COORDINATOR_ID, label: t('pal.step.coordinator') } : spec;
      const id = session.addNode({ ...real, position } as NewNodeSpec);
      select(id);
    });
  };
  /** Menú del botón derecho de un diagrama del panel [R33.8]. */
  const diagramMenu = (id: string): MenuItem[] => {
    const current = id === session.diagram.id;
    return [
      { id: 'd-open', label: t('menu.diagram.open'), icon: <Workflow size={16} />, disabled: current, onSelect: () => void openDiagram(id) },
      ...(current ? [{ id: 'd-rename', label: t('diagram.rename'), icon: <Pencil size={16} />, onSelect: requestRename }] : []),
      { id: 'd-dup', label: t('diagram.duplicate'), icon: <Copy size={16} />, onSelect: () => void (current ? duplicateDiagram() : openDiagram(id).then(() => duplicateDiagram())) },
      { id: 'd-del', label: t('diagram.delete'), icon: <Trash2 size={16} />, danger: true, onSelect: () => void (current ? deleteDiagram() : deleteOther(id)) },
    ];
  };
  /** «+» de un conector: elegir skills/contextos o MCP solo para ese paso [R33.10]. */
  const [portPick, setPortPick] = useState<{ nodeId: string; port: 'know' | 'mcp' }>();
  /** Añade algo al conocimiento de un paso (arrastrar o elegir) [R33.11]. */
  const addExtra = (nodeId: string, kind: 'skillIds' | 'contextIds' | 'mcpIds', id: string) => {
    const node = session.getSnapshot().level.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const list = node.extra?.[kind] ?? [];
    if (list.includes(id)) return;
    guard(() => session.updateNode(nodeId, { extra: { ...node.extra, [kind]: [...list, id] } }));
  };
  /** Soltar un diagrama en el lienzo: un paso que lo ejecuta entero [R33.8]. */
  const addSubdiagram = (diagramId: string, at?: { x: number; y: number }) => {
    const name = diagramList.find((d) => d.id === diagramId)?.name ?? diagramId;
    const n = session.getSnapshot().level.nodes.length;
    guard(() => {
      const id = session.addNode({ kind: 'subdiagram', diagramId, label: name, position: at ?? { x: 60 + (n % 6) * 40, y: 60 + (n % 6) * 40 } });
      select(id);
    });
  };
  /** Menú del botón derecho de un agente (lienzo y paleta) [R32.34]. */
  const agentMenuFor = (agentId: string, nodeId?: string): AgentMenu => {
    const a = agents.find((x) => x.id === agentId);
    const name = a?.name ?? agentId;
    const editable = a?.editable === true;
    const top: MenuItem[] = [
      { id: 'agent-edit', label: t('menu.agent.edit'), icon: <Bot size={16} />, disabled: !editable, onSelect: () => openLibrary('agents', { tab: 'agents', id: agentId }) },
      nodeId
        ? { id: 'agent-change', label: t('menu.agent.change'), icon: <Replace size={16} />, onSelect: () => setPicker({ replace: nodeId }) }
        : { id: 'agent-add', label: t('menu.agent.add'), icon: <Plus size={16} />, onSelect: () => onAdd({ kind: 'agent', agentId }) },
    ];
    const skills = t('menu.agent.skills', { name });
    const contexts = t('menu.agent.contexts', { name });
    const knowledge: MenuItem[] = [
      ...(a?.skillRefs ?? []).map((k) => ({ id: `skill-${k.id}`, group: skills, label: k.name, icon: <BookOpen size={16} />, onSelect: () => openLibrary('knowledge', { tab: 'skills', id: k.id }) })),
      ...(editable ? [{ id: 'skill-assign', group: skills, label: t('menu.agent.skills.add'), icon: <Plus size={16} />, onSelect: () => openLibrary('agents', { tab: 'agents', id: agentId }) }] : []),
      ...(a?.contextRefs ?? []).map((c) => ({ id: `ctx-${c.id}`, group: contexts, label: c.name, icon: <FileText size={16} />, onSelect: () => openLibrary('knowledge', { tab: 'contexts', id: c.id }) })),
    ];
    if (!nodeId) return { top, knowledge };
    const here = t('menu.agent.here');
    const stepName = session.getSnapshot().level.nodes.find((n) => n.id === nodeId)?.label ?? name;
    return {
      top,
      knowledge,
      here: [
        { id: 'here-know', group: here, label: t('menu.agent.here.know'), icon: <BookOpen size={16} />, onSelect: () => setPortPick({ nodeId, port: 'know' }) },
        { id: 'here-mcp', group: here, label: t('menu.agent.here.mcp'), icon: <Plug size={16} />, onSelect: () => setPortPick({ nodeId, port: 'mcp' }) },
        { id: 'here-claude', group: here, label: t('menu.agent.here.claude'), icon: <Sparkles size={16} />, onSelect: () => askAssistant(t('as.prompt.mcpFor', { name, id: agentId, step: stepName, node: nodeId }), true) },
      ],
    };
  };
  const focusField = (what: 'label' | 'condition') => {
    showRight();
    setTimeout(() => {
      const el = document.querySelector<HTMLInputElement>(`.orq-inspector [data-field="${what}"]`);
      el?.focus();
      el?.select();
    }, 0);
  };
  const extras = useMemo(
    () => ({
      agentChips: Object.fromEntries(agents.map((a) => [a.id, [...(a.skills ?? []), ...(a.contexts ?? [])]])),
      entryText: lastInput || undefined,
      knowledgeNames: Object.fromEntries([...catalog.skills, ...catalog.contexts, ...(catalog.mcp ?? [])].map((i) => [i.id, i.name])),
      agentLooks: Object.fromEntries(agents.map((a) => [a.id, { icon: a.icon, tone: a.tone, askFirst: a.askFirst }])),
    }),
    [agents, lastInput, catalog],
  );
  const loadExample = (ex: ExampleTemplate) => {
    if (!discardOk()) return;
    // La plantilla de Spec Kit trae antes lo que falte, para no llegar a un agente inexistente [R38.26].
    const ready =
      ex.id === SPECKIT_TEMPLATE_ID && projectRef.current !== undefined
        ? installSpecKit(api)
            .then((r) => (r.skills.length + r.agents.length > 0 ? reloadAgents() : undefined))
            .catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)))
        : Promise.resolve();
    void ready.then(() => freshDiagram(ex.name)).then(({ id, name }) => {
      guard(() => session.load(instantiateTemplate(ex, id, name)));
      if (projectRef.current !== undefined) void save();
    });
  };
  return { inserting, setInserting, onInsert, agentNames, examples, picker, setPicker, usage, undo, redo, onAdd, diagramMenu, portPick, setPortPick, addExtra, addSubdiagram, agentMenuFor, focusField, extras, loadExample };
}

export type Designer = ReturnType<typeof useDesigner>;
