import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { BookOpen, Bot, Copy, FileText, Pencil, Plug, Plus, Replace, SlidersHorizontal, Sparkles, Trash2, Workflow, X } from 'lucide-react';
import { AssignPicker } from './AssignPicker';
import { finalSteps, validateDiagram, projectPermission, slugify, type AppSettings, type ProjectPermission, type DeliverableSpec, type Diagram, type RunEvent } from '@orquestador/core';

const AUTOSAVE_MS = 700;
const LAST_KEY = 'orq-last-diagram:';
function readLast(project: string | undefined): string | undefined {
  if (project === undefined) return undefined;
  try {
    return localStorage.getItem(`${LAST_KEY}${project}`) ?? undefined;
  } catch {
    return undefined;
  }
}
import {
  EditorSession,
  agentUsage,
  RunClient,
  createDiagram,
  eventsOfDiagram,
  instantiateTemplate,
  installSpecKit,
  SPECKIT_TEMPLATE_ID,
  t,
  type ExampleTemplate,
  type NewNodeSpec,
  type ProjectApi,
  type SettingsView,
  type TerminalProgram,
} from '@orquestador/editor';
import { TerminalHub, TerminalPanel, type TermTab } from './TerminalPanel';
import { AgentPicker } from './AgentPicker';
import { LibraryScreen, type LibrarySection } from './AgentsScreen';
import { SettingsDialog } from './SettingsDialog';
import { Breadcrumbs } from './Breadcrumbs';
import { Canvas, type AgentMenu, type Selection } from './Canvas';
import type { MenuItem } from './ContextMenu';
import { DraftStore } from './editors';
import { AssistantPanel, type ChatState } from './AssistantPanel';
import type { AssistantHost } from './assistantTools';
import type { KnowledgeCatalog } from './ExtraKnowledge';
import { Inspector } from './Inspector';
import { DiagramsScreen } from './DiagramsScreen';
import { InsertPicker, type InsertChoice } from './InsertPicker';
import { NavRail, type SectionId } from './NavRail';
import { downloadText } from './download';
import { Palette, type AgentOption } from './Palette';
import { ProjectScreen } from './ProjectScreen';
import { ResizeHandle } from './ResizeHandle';
import { ParallelDialog } from './ParallelDialog';
import { RunDialog, type RunInputs } from './RunDialog';
import { RunModal, RunsScreen, type RunsNav } from './RunsScreen';
import { JobsScreen } from './JobsScreen';
import { useRunsIndex } from './useRunsIndex';
import { StartScreen, type StartPath } from './StartScreen';
import { DiagramMenu, EditButtons, SaveStatus, Toolbar } from './Toolbar';
import { isTypingTarget, shortcutFor } from './shortcuts';
import { useSession } from './useSession';

export interface AppProps {
  api: ProjectApi;
  /** Agentes de ejemplo integrados; los del proyecto se suman y tienen preferencia. */
  agents?: AgentOption[];
  /** Pregunta de confirmación (descartar cambios). Por defecto `window.confirm`. */
  confirm?: (message: string) => boolean;
  /** Abre el editor directamente, sin pantalla de inicio: para pruebas y para desarrollar la vista. */
  initialProject?: string;
}

const NONE: Selection = { nodes: [], edges: [] };

/** Por debajo de este ancho (px) el panel derecho empieza cerrado [R21.16]. */
const NARROW_PX = 1100;
const SIDE_KEY = 'orq.sideWidth';
const SIDE_DEFAULT = 340;
const SIDE_MIN = 288;
const readSideWidth = () => {
  try {
    const n = Number(window.localStorage.getItem(SIDE_KEY));
    return Number.isFinite(n) && n >= SIDE_MIN ? n : SIDE_DEFAULT;
  } catch {
    return SIDE_DEFAULT;
  }
};
const saveSideWidth = (w: number) => {
  try {
    window.localStorage.setItem(SIDE_KEY, String(w));
  } catch {
    /* sin almacenamiento: el ancho vale solo para esta sesión */
  }
};
/** Solo los campos de ajustes: `apiKeyStored` es del estado de la vista y el contrato lo rechaza. */
const toSettings = (v: SettingsView): AppSettings => ({
  schemaVersion: v.schemaVersion,
  authMode: v.authMode,
  engine: v.engine,
  defaultModel: v.defaultModel,
  maxParallel: v.maxParallel,
  ...(v.defaultMaxTokens !== undefined ? { defaultMaxTokens: v.defaultMaxTokens } : {}),
  ...(v.permissions ? { permissions: v.permissions } : {}),
});

/** Aplicación: rail global con secciones a pantalla completa (prototipos de la revisión UX) [R32.13]. */
export function App({ api, agents: builtIn = [], confirm = (m) => window.confirm(m), initialProject }: AppProps) {
  const session = useMemo(() => new EditorSession(createDiagram('nuevo', 'Diagrama nuevo')), []);
  const snap = useSession(session);
  const client = useMemo(() => new RunClient(api), [api]);
  useEffect(() => () => client.dispose(), [client]);
  const run = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  /** Diagrama de la ejecución en curso y de las que siguen en marcha, para marcarlos [R38.11]. */
  /** Diagramas con preguntas sin responder: las de la ejecución abierta y las de las demás en curso [R39.6]. */
  const askingIdsOf = (pending: { runId: string }[], runs: { runId: string; diagramId: string }[], main: string | undefined, mainAsking: boolean) => [
    ...new Set([...(mainAsking && main ? [main] : []), ...pending.map((q) => runs.find((r) => r.runId === q.runId)?.diagramId).filter((x): x is string => x !== undefined)]),
  ];
  const runningDiagramId = run.live.status === 'running' ? (run.events.find((e): e is Extract<RunEvent, { type: 'run.started' }> => e.type === 'run.started')?.diagramId) : undefined;
  const [section, setSection] = useState<SectionId>('diagrams');
  const sectionRef = useRef(section);
  sectionRef.current = section;
  /** Modal de la última ejecución, desde la barra fuera del Diseñador [R44.4][R52.8]. */
  const [runModal, setRunModal] = useState<string>();
  /** Lanzar un diagrama desde Trabajos o desde el Diseñador [R52.7]. */
  const [launch, setLaunch] = useState<Diagram>();
  /** Última entrada usada con cada diagrama [R52.7]. */
  const lastInputs = useRef(new Map<string, string>());
  const [leftOpen, setLeftOpen] = useState(true);
  /** Apartado de Ejecuciones y ejecución abierta [R35.4][R35.8]. */
  const [runsNav, setRunsNav] = useState<RunsNav>({ section: 'history' });
  const [runsSub, setRunsSub] = useState(true);
  /** Fichero de la última ejecución abierto en el visor [R45.10]. */
  const [sideWidth, setSideWidth] = useState(readSideWidth);
  const [rightOpen, setRightOpen] = useState(true);
  /** «Ajustes del diagrama»: el panel derecho sin nada seleccionado [R33.6]. */
  const [diagramPanel, setDiagramPanel] = useState(false);
  /** Lateral derecho: propiedades o asistente [R29.5]. */
  /** Asistente abierto: en Diagramas ocupa el lateral derecho; en el resto, un panel acoplado [R29.5][R38.1]. */
  const [assistOpen, setAssistOpen] = useState(false);
  const [chat, setChat] = useState<ChatState>({ items: [] });
  /** Sube cuando el asistente cambia agentes, skills, contextos o MCP, para que Agentes y Conocimiento recarguen [R38.7]. */
  const [libVersion, setLibVersion] = useState(0);
  /**
   * Abre el asistente y le envía una petición ya escrita [R30.10]. Se queda en la sección actual salvo que la
   * petición hable de un paso del diagrama [R38.1].
   */
  const askAssistant = (text: string, toDiagrams = false) => {
    if (toDiagrams) setSection('diagrams');
    setRightOpen(true);
    setAssistOpen(true);
    setChat((c) => ({ ...c, pending: text }));
  };
  /** Terminales integradas [R30.13]. */
  const [terms, setTerms] = useState<TermTab[]>([]);
  const [termActive, setTermActive] = useState<string>();
  const [termOpen, setTermOpen] = useState(true);
  const [hub, setHub] = useState<TerminalHub>();
  useEffect(() => {
    const h = new TerminalHub(api, (id, code) => setTerms((ts) => ts.map((x) => (x.id === id ? { ...x, exited: code } : x))));
    setHub(h);
    return () => h.dispose();
  }, [api]);
  const termSeq = useRef(0);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const q = window.matchMedia(`(max-width: ${NARROW_PX}px)`);
    const narrow = () => {
      setRightOpen(false);
      setRunsSub(false);
    };
    if (q.matches) narrow();
    const on = (e: MediaQueryListEvent) => {
      if (e.matches) narrow();
    };
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  const [projectAgents, setProjectAgents] = useState<AgentOption[]>([]);
  /** Skills y contextos del proyecto para añadirlos a un paso o al diagrama [R33.5]. */
  const [catalog, setCatalog] = useState<KnowledgeCatalog>({ skills: [], contexts: [] });
  const [libOpen, setLibOpen] = useState<{ tab: 'agents' | 'contexts' | 'skills' | 'mcp'; id: string }>();
  const [drafts] = useState(() => new DraftStore());
  const [startSettings, setStartSettings] = useState(false);
  const [wizard, setWizard] = useState(false);
  const [settings, setSettings] = useState<SettingsView>();
  const [lastInput, setLastInput] = useState('');
  const [inserting, setInserting] = useState<{ edgeId: string; at: { x: number; y: number } }>();
  const onInsert = useCallback((edgeId: string, at: { x: number; y: number }) => setInserting({ edgeId, at }), []);
  /** Conexión donde se insertan ramas en paralelo [R32.36]. */
  const [parallelAt, setParallelAt] = useState<string>();
  /** Desde la paleta: la conexión seleccionada o, si no, la única que llega a Salida [R32.36]. */
  const openParallel = () => {
    const level = session.getSnapshot().level;
    const chosen = selRef.current.edges.length === 1 ? selRef.current.edges[0] : undefined;
    const toOutput = level.edges.filter((e) => level.nodes.find((n) => n.id === e.to)?.kind === 'output');
    const edgeId = chosen ?? (toOutput.length === 1 ? toOutput[0]!.id : undefined);
    if (!edgeId) return fail(t('parallel.noEdge'));
    setParallelAt(edgeId);
  };
  const agents = useMemo(() => {
    const own = new Set(projectAgents.map((a) => a.id));
    return [...projectAgents, ...builtIn.filter((a) => !own.has(a.id))];
  }, [projectAgents, builtIn]);
  /** Diagramas del proyecto para el panel lateral y los subdiagramas [R33.8]. */
  const [diagramList, setDiagramList] = useState<{ id: string; name: string }[]>([]);
  const refreshDiagrams = useCallback(async () => {
    const r = await api.listDiagrams();
    setDiagramList(r.ok ? r.value : []);
  }, [api]);
  const agentNames = useMemo(
    () => ({ ...Object.fromEntries(agents.map((a) => [a.id, a.name])), ...Object.fromEntries(diagramList.map((d) => [`diagram:${d.id}`, d.name])) }),
    [agents, diagramList],
  );
  const [maxTokens, setMaxTokens] = useState<number>();
  const [selection, setSelection] = useState<Selection>(NONE);
  const [message, setMessage] = useState<string>();
  const [project, setProject] = useState<string | undefined>(initialProject);
  /** Historial y preguntas pendientes de todas las ejecuciones del proyecto [R35.6]. */
  const runsIndex = useRunsIndex(api, run, project);
  const askingIds = askingIdsOf(runsIndex.pending, runsIndex.runs, runningDiagramId, run.live.pending.length > 0);
  const projectRef = useRef(project);
  projectRef.current = project;
  const [examples, setExamples] = useState<ExampleTemplate[]>([]);
  const [picker, setPicker] = useState<{ at?: { x: number; y: number }; replace?: string }>();
  const [selectRequest, setSelectRequest] = useState<{ id: string; n: number }>();
  const usage = useMemo(() => agentUsage(snap.diagram), [snap.diagram]);
  const updateSelection = useCallback(
    (next: Selection) =>
      setSelection((prev) => (prev.nodes.join() === next.nodes.join() && prev.edges.join() === next.edges.join() ? prev : next)),
    [],
  );
  const selectedNode = selection.nodes.length === 1 ? snap.level.nodes.find((n) => n.id === selection.nodes[0]) : undefined;
  // Sin nada seleccionado, el panel derecho no se ve salvo que se pidan los ajustes del diagrama o el asistente [R33.6].
  const hasSelection = selection.nodes.length + selection.edges.length > 0;
  const sideVisible = rightOpen && (assistOpen || hasSelection || diagramPanel);
  useEffect(() => {
    if (hasSelection) setDiagramPanel(false);
  }, [hasSelection]);
  const selRef = useRef(selection);
  selRef.current = selection;
  const engine = settings?.engine ?? 'simulated';

  const reloadAgents = useCallback(async () => {
    const [r, c, k, m] = await Promise.all([api.listAgents(), api.listContexts(), api.listSkills(), api.listMcp()]);
    const cn = new Map(c.ok ? c.value.map((x) => [x.id, x.name]) : []);
    const kn = new Map(k.ok ? k.value.map((x) => [x.id, x.name]) : []);
    setCatalog({
      skills: k.ok ? k.value.map((x) => ({ id: x.id, name: x.name, description: x.description })) : [],
      contexts: c.ok ? c.value.map((x) => ({ id: x.id, name: x.name })) : [],
      mcp: m.ok ? m.value.filter((x) => x.enabled).map((x) => ({ id: x.id, name: x.name, description: x.description })) : [],
    });
    setProjectAgents(
      r.ok
        ? r.value.map((a) => ({
            id: a.id,
            name: a.name,
            ...(a.description ? { description: a.description } : {}),
            model: a.model,
            skills: (a.skillIds ?? []).map((id) => kn.get(id) ?? id),
            contexts: a.contextIds.map((id) => cn.get(id) ?? id),
            skillRefs: (a.skillIds ?? []).map((id) => ({ id, name: kn.get(id) ?? id })),
            contextRefs: a.contextIds.map((id) => ({ id, name: cn.get(id) ?? id })),
            editable: true,
            ...(a.icon ? { icon: a.icon } : {}),
            ...(a.tone ? { tone: a.tone } : {}),
            ...(a.askFirst ? { askFirst: true } : {}),
            ...(a.permissions ? { permissions: a.permissions } : {}),
          }))
        : [],
    );
  }, [api]);
  useEffect(() => {
    if (project !== undefined) void reloadAgents();
    else setProjectAgents([]);
  }, [project, reloadAgents]);
  useEffect(() => {
    if (project !== undefined) void refreshDiagrams();
    else setDiagramList([]);
  }, [project, refreshDiagrams]);
  useEffect(() => {
    void api.getSettings().then((r) => r.ok && setSettings(r.value));
  }, [api]);
  const [workFolder, setWorkFolder] = useState<string>();
  useEffect(() => {
    if (project === undefined) return setWorkFolder(undefined);
    void api.getWorkFolder().then((r) => setWorkFolder(r.ok && r.value ? r.value.name : undefined));
  }, [api, project, section]);
  /** Permisos de los agentes desde el bloque «Archivos» del paso: guarda el ajuste al momento [R32.29][R47.11]. */
  const setPermissions = async (level: ProjectPermission) => {
    if (!settings) return;
    const next = { ...settings, permissions: level };
    const res = await api.saveSettings(toSettings(next));
    if (res.ok) setSettings(next);
    else fail(res.error.message);
  };
  useEffect(() => {
    void api.listExamples().then((r) => r.ok && setExamples(r.value));
  }, [api]);

  const fail = useCallback((m: string) => setMessage(m), []);
  /** Abre una terminal con Claude Code o la consola en la carpeta del proyecto [R30.13][R30.14]. */
  const openTerminal = async (program: TerminalProgram, prompt?: string): Promise<{ external: boolean }> => {
    const r = await api.terminalStart({ program, ...(prompt?.trim() ? { prompt: prompt.trim() } : {}), cols: 100, rows: 28 });
    if (!r.ok) {
      fail(t('term.error', { message: r.error.message }));
      throw new Error(r.error.message);
    }
    if (r.value.external) {
      fail(t('term.external'));
      return { external: true };
    }
    const n = ++termSeq.current;
    const id = r.value.id;
    setTerms((ts) => [...ts, { id, program, title: `${program === 'claude' ? t('term.claude') : t('term.shell')} ${n}` }]);
    setTermActive(id);
    setTermOpen(true);
    return { external: false };
  };
  const closeTerminal = (id: string) => {
    void api.terminalKill(id);
    hub?.forget(id);
    setTerms((ts) => {
      const rest = ts.filter((x) => x.id !== id);
      setTermActive((a) => (a === id ? rest[rest.length - 1]?.id : a));
      return rest;
    });
  };
  // Cambiar de proyecto cierra las terminales (el proceso principal ya las ha matado) [R30.13]
  useEffect(() => {
    setTerms([]);
    setTermActive(undefined);
  }, [project]);
  const guard = useCallback(
    (fn: () => void) => {
      try {
        fn();
        setMessage(undefined);
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e));
      }
    },
    [fail],
  );

  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'error'>('idle');
  const save = useCallback(async () => {
    const diagram = session.diagram;
    setSaveState('saving');
    const res = await api.saveDiagram(diagram);
    if (res.ok) {
      // Solo se marca guardado si no ha cambiado mientras tanto [R32.38].
      if (session.diagram === diagram) session.markSaved();
      setSaveState('idle');
      void refreshDiagrams();
    } else {
      setSaveState('error');
      fail(t('project.error', { message: res.error.message }));
    }
  }, [api, session, fail, refreshDiagrams]);
  /** Con proyecto abierto lo pendiente se guarda antes de cambiar de diagrama; sin proyecto, se confirma [R32.38]. */
  const discardOk = useCallback(() => {
    if (!session.getSnapshot().dirty) return true;
    if (projectRef.current !== undefined) {
      void save();
      return true;
    }
    return confirm(t('project.confirm.discard'));
  }, [session, confirm, save]);

  /** Guardado automático poco después de cada cambio, con proyecto abierto y sin ejecución [R32.38]. */
  useEffect(() => {
    if (project === undefined || !snap.dirty) return;
    const h = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(h);
  }, [snap.version, snap.dirty, project, save]);

  /** Nombre e id libres para un diagrama nuevo («Diagrama nuevo 2»…) [R32.38]. */
  const freshDiagram = useCallback(
    async (base = t('diagram.new.name')) => {
      const r = project !== undefined ? await api.listDiagrams() : undefined;
      const list = r?.ok ? r.value : [];
      const names = new Set(list.map((d) => d.name));
      let name = base;
      for (let n = 2; names.has(name); n++) name = `${base} ${n}`;
      const id = slugify(name, new Set([...list.map((d) => d.id), session.diagram.id]), 'diagrama');
      return { id, name };
    },
    [api, project, session],
  );
  const [renameReq, setRenameReq] = useState(0);
  const newDiagram = async () => {
    if (!discardOk()) return;
    const { id, name } = await freshDiagram();
    const fresh = createDiagram(id, name);
    guard(() => session.load(fresh));
    setSelection(NONE);
    setRenameReq((n) => n + 1);
    if (projectRef.current !== undefined) void api.saveDiagram(fresh).then(() => refreshDiagrams());
  };
  const duplicateDiagram = async () => {
    if (!discardOk()) return;
    const { id, name } = await freshDiagram(t('diagram.copy.name', { name: session.diagram.name }));
    const copy = { ...structuredClone(session.diagram), id, name };
    const res = await api.saveDiagram(copy);
    if (!res.ok) return fail(t('project.error', { message: res.error.message }));
    guard(() => session.load(copy));
    await refreshDiagrams();
  };
  const deleteDiagram = async () => {
    const d = session.diagram;
    if (!confirm(t('diagram.delete.confirm', { name: d.name }))) return;
    const res = await api.deleteDiagram(d.id);
    if (!res.ok) return fail(t('project.error', { message: res.error.message }));
    session.markSaved();
    await openFirstDiagram();
    await refreshDiagrams();
  };
  /** Al abrir un proyecto se abre el último diagrama usado, si no el primero, o se crea «Principal» [R32.38]. */
  const openFirstDiagram = async () => {
    const last = readLast(projectRef.current); // antes de esperar: luego se guarda el que está abierto ahora
    const r = await api.listDiagrams();
    const first = r.ok ? (r.value.find((d) => d.id === last) ?? r.value[0]) : undefined;
    if (first) {
      const d = await api.loadDiagram(first.id);
      if (d.ok) return guard(() => session.load(d.value));
    }
    const { id, name } = r.ok && r.value.length > 0 ? await freshDiagram() : { id: 'principal', name: t('diagram.main.name') };
    const fresh = createDiagram(id, name);
    guard(() => session.load(fresh));
    await api.saveDiagram(fresh);
    await refreshDiagrams();
  };

  // Recuerda en este equipo el último diagrama abierto de cada proyecto [R32.38].
  useEffect(() => {
    if (project === undefined) return;
    try {
      localStorage.setItem(`${LAST_KEY}${project}`, snap.diagram.id);
    } catch {
      /* sin almacenamiento: se abrirá el primero */
    }
  }, [project, snap.diagram.id]);

  const undo = useCallback(() => void session.undo(), [session]);
  const redo = useCallback(() => void session.redo(), [session]);
  const del = useCallback(() => {
    try {
      session.removeSelection(selRef.current);
      setSelection(NONE);
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e)); // en ejecución: solo lectura [R32.37]
    }
  }, [session, fail]);

  // Los atajos del editor solo actúan en Diagramas; en otras secciones los formularios tienen los suyos.
  useEffect(() => {
    if (section !== 'diagrams') return;
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
  }, [del, undo, redo, save, section]);

  const onStart = async (order: string, limit?: number, deliverable?: DeliverableSpec | null, inputs?: RunInputs) => {
    if (project === undefined) return fail(t('run.noProject'));
    setLastInput(order);
    await save();
    setMaxTokens(limit);
    setSection('runs');
    setRunsNav({ section: 'live' });
    const id = await client.start({ diagramId: session.diagram.id, order, ...(limit !== undefined ? { maxTokens: limit } : {}), ...(deliverable !== undefined ? { deliverable } : {}), ...(inputs && inputs.files.length > 0 ? { files: inputs.files } : {}), ...(inputs && inputs.attachments.length > 0 ? { attachments: inputs.attachments } : {}) });
    if (id) {
      setMessage(undefined);
      // Se abre la vista de la nueva ejecución, con «Volver» a En directo [R35.11].
      setRunsNav({ section: 'live', runId: id });
      runsIndex.refresh();
    }
  };
  /** «Lanzar» de Trabajos o «Lanzar…» del Diseñador: abre el diálogo con ese diagrama [R52.7]. */
  const openLaunch = async (diagramId: string) => {
    if (project === undefined) return fail(t('run.noProject'));
    if (diagramId === session.diagram.id) {
      await save();
      return setLaunch(session.diagram);
    }
    const r = await api.loadDiagram(diagramId);
    if (r.ok) setLaunch(r.value);
    else fail(r.error.message);
  };
  /** Lanza el diagrama del diálogo: a la vez o en cola, y va a la ejecución salvo «Quedarme donde estoy» [R52.7]. */
  const onLaunch = async (d: Diagram, order: string, limit: number | undefined, deliverable: DeliverableSpec | null | undefined, inputs: RunInputs | undefined, opts: { whenBusy?: 'parallel' | 'queue'; stay: boolean }) => {
    setLaunch(undefined);
    lastInputs.current.set(d.id, order);
    if (d.id === session.diagram.id) {
      setLastInput(order);
      await save();
    }
    setMaxTokens(limit);
    const res = await api.startRun({
      diagramId: d.id,
      order,
      ...(limit !== undefined ? { maxTokens: limit } : {}),
      ...(deliverable !== undefined ? { deliverable } : {}),
      ...(inputs && inputs.files.length > 0 ? { files: inputs.files } : {}),
      ...(inputs && inputs.attachments.length > 0 ? { attachments: inputs.attachments } : {}),
      ...(opts.whenBusy ? { whenBusy: opts.whenBusy } : {}),
    });
    if (!res.ok) return fail(res.error.message);
    runsIndex.refresh();
    const runId = res.value.runId;
    // La última lanzada es la que se sigue en vivo.
    if (runId) void client.attach(runId);
    if (opts.stay) return setMessage(runId ? t('jobs.launched', { name: d.name }) : t('jobs.launchedQueued', { name: d.name }));
    setMessage(undefined);
    setSection('runs');
    setRunsNav(runId ? { section: 'live', runId } : { section: 'live' });
  };
  /** Guarda el entregable en el diagrama del diálogo, esté abierto o no [R52.7]. */
  const saveDeliverableTo = (d: Diagram, spec: DeliverableSpec | undefined) => {
    if (d.id === session.diagram.id) return session.setDeliverable(spec);
    const next: Diagram = { ...d };
    if (spec) next.deliverable = spec;
    else delete next.deliverable;
    void api.saveDiagram(next).then((r) => (r.ok ? setLaunch((cur) => (cur && cur.id === d.id ? next : cur)) : fail(r.error.message)));
  };
  const setEngine = async (next: 'simulated' | 'claude') => {
    if (!settings) return;
    const res = await api.saveSettings({ ...toSettings(settings), engine: next });
    if (res.ok) setSettings(res.value);
    else fail(res.error.message);
  };

  const onAdd = (spec: { kind: 'agent'; agentId: string } | { kind: 'router' } | { kind: 'loop' } | { kind: 'review'; human?: boolean } | { kind: 'transform' }, at?: { x: number; y: number }) => {
    const n = session.getSnapshot().level.nodes.length;
    const position = at ?? { x: 60 + (n % 6) * 40, y: 60 + (n % 6) * 40 };
    guard(() => {
      const id = session.addNode({ ...spec, position } as NewNodeSpec);
      setSelectRequest((r) => ({ id, n: (r?.n ?? 0) + 1 }));
    });
  };
  /** Lo que el asistente puede hacer en la interfaz: mismo contrato y misma sesión que el usuario [R29.2]. */
  const assistantHost: AssistantHost = {
    api,
    session,
    newDiagram: async (name) => {
      if (!discardOk()) throw new Error('Hay cambios sin guardar');
      const fresh = await freshDiagram(name.trim() || undefined);
      const d = createDiagram(fresh.id, fresh.name);
      session.load(d);
      setSelection(NONE);
      await api.saveDiagram(d);
      await refreshDiagrams();
    },
    run: async (input) => {
      await save();
      await onStart(input);
    },
    refresh: () => {
      void reloadAgents();
      setLibVersion((v) => v + 1);
    },
    created: (kind, id) => {
      // Si se está viendo esa lista, se abre lo que acaba de crear [R38.7].
      if (sectionRef.current === 'knowledge' && kind !== 'agents') setLibOpen({ tab: kind, id });
      else if (sectionRef.current === 'agents' && kind === 'agents') setLibOpen({ tab: 'agents', id });
    },
    openTerminal,
  };
  /** Menú del botón derecho de un diagrama del panel [R33.8]. */
  const diagramMenu = (id: string): MenuItem[] => {
    const current = id === session.diagram.id;
    return [
      { id: 'd-open', label: t('menu.diagram.open'), icon: <Workflow size={16} />, disabled: current, onSelect: () => void openDiagram(id) },
      ...(current ? [{ id: 'd-rename', label: t('diagram.rename'), icon: <Pencil size={16} />, onSelect: () => setRenameReq((n) => n + 1) }] : []),
      { id: 'd-dup', label: t('diagram.duplicate'), icon: <Copy size={16} />, onSelect: () => void (current ? duplicateDiagram() : openDiagram(id).then(() => duplicateDiagram())) },
      { id: 'd-del', label: t('diagram.delete'), icon: <Trash2 size={16} />, danger: true, onSelect: () => void (current ? deleteDiagram() : deleteOther(id)) },
    ];
  };
  const deleteOther = async (id: string) => {
    const name = diagramList.find((d) => d.id === id)?.name ?? id;
    if (!confirm(t('diagram.delete.confirm', { name }))) return;
    const res = await api.deleteDiagram(id);
    if (!res.ok) return fail(t('project.error', { message: res.error.message }));
    await refreshDiagrams();
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
      setSelectRequest((r) => ({ id, n: (r?.n ?? 0) + 1 }));
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
  const select = (id: string) => {
    setSelectRequest((r) => ({ id, n: (r?.n ?? 0) + 1 }));
  };

  const focusField = (what: 'label' | 'condition') => {
    setRightOpen(true);
    setTimeout(() => {
      const el = document.querySelector<HTMLInputElement>(`.orq-inspector [data-field="${what}"]`);
      el?.focus();
      el?.select();
    }, 0);
  };
  const openLibrary = (s: LibrarySection, open?: { tab: 'agents' | 'contexts' | 'skills' | 'mcp'; id: string }) => {
    setSection(s);
    setLibOpen(open);
  };

  const openDiagram = async (id: string) => {
    if (id === session.diagram.id || !discardOk()) return;
    const r = await api.loadDiagram(id);
    if (!r.ok) return fail(t('project.error', { message: r.error.message }));
    session.load(r.value);
    setSelection(NONE);
    setSection('diagrams');
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

  const onProject = async (kind: 'create' | 'open') => {
    const res = await (kind === 'create' ? api.createProject() : api.openProject());
    if (!res.ok) return fail(t('project.error', { message: res.error.message }));
    if (res.value) {
      setProject(res.value.name);
      projectRef.current = res.value.name;
      setSection('diagrams');
      setMessage(undefined);
      setSelection(NONE);
      await openFirstDiagram();
    }
  };

  const closeProject = async () => {
    if (session.getSnapshot().dirty) await save(); // se guarda antes de cerrar [R32.38]
    const res = await api.closeProject();
    if (!res.ok) return fail(t('project.error', { message: res.error.message }));
    setProject(undefined);
    setSelection(NONE);
    setMessage(undefined);
    setSection('diagrams');
    session.load(createDiagram('principal', 'Principal'));
  };

  if (project === undefined) {
    return (
      <div className="orq-app">
        {startSettings ? (
          <SettingsDialog api={api} onSaved={setSettings} onClose={() => setStartSettings(false)} />
        ) : (
          <StartScreen
            api={api}
            engine={settings?.engine}
            onOpened={(name, path?: StartPath) => {
              setProject(name);
              projectRef.current = name;
              setSelection(NONE);
              // Abrir desde el inicio carga el diagrama del disco, nunca uno en blanco que pise al guardado [R32.38].
              void openFirstDiagram();
              setMessage(undefined);
              setSection(path === 'folder' ? 'project' : 'diagrams');
              setWizard(path === 'folder');
            }}
            onSettings={() => setStartSettings(true)}
          />
        )}
      </div>
    );
  }

  const canvas = (
    <ReactFlowProvider>
      <Canvas
        session={session}
        onSelection={updateSelection}
        onReject={fail}
        selectRequest={selectRequest}
        agentNames={agentNames}
        extras={extras}
        agentMenu={agentMenuFor}
        onAddSubdiagram={addSubdiagram}
        onAddKnowledge={(nodeId, port) => setPortPick({ nodeId, port })}
        onDropKnowledge={addExtra}
        onOpenDiagram={(id) => void openDiagram(id)}
        onEdit={focusField}
        onAddAt={(kind, at, opts) => (kind === 'agent' ? setPicker({ at }) : onAdd(kind === 'review' && opts?.human ? { kind, human: true } : { kind }, at))}
        onDropParallel={(edgeId) => (edgeId ? setParallelAt(edgeId) : openParallel())}
        {...(section === 'diagrams' ? { onInsert, onInsertTransform: (edgeId: string) => guard(() => select(session.insertOnEdge(edgeId, { kind: 'transform' }))) } : {})}
      />
    </ReactFlowProvider>
  );
  return (
    <div className="orq-app orq-shell">
      <NavRail
        section={section}
        onGo={(s) => {
          if (s === 'diagrams' && section === 'diagrams') setLeftOpen((v) => !v);
          else if (s === 'agents' || s === 'knowledge') openLibrary(s);
          else if (s === 'runs' && section === 'runs') setRunsSub((v) => !v);
          else {
            if (s === 'runs') setRunsNav({ section: runsIndex.runs.some((r) => r.status === 'running') || runsIndex.queue.length > 0 ? 'live' : 'history' });
            setSection(s);
          }
        }}
        runsBadge={runsIndex.pending.length}
        designerAsking={askingIds.includes(snap.diagram.id)}
      />
      <div className="orq-shell__main">
        <Toolbar
          editInHeader
          canUndo={snap.canUndo}
          canRedo={snap.canRedo}
          dirty={snap.dirty}
          projectOpen={project !== undefined}
          onUndo={undo}
          onRedo={redo}
          onSave={() => void save()}
          onNew={() => void newDiagram()}
          onRenameDiagram={() => setRenameReq((n) => n + 1)}
          onDuplicateDiagram={project !== undefined ? () => void duplicateDiagram() : undefined}
          onDeleteDiagram={project !== undefined ? () => void deleteDiagram() : undefined}
          saveState={project === undefined ? 'no-project' : saveState === 'saving' ? 'saving' : saveState === 'error' ? 'error' : snap.dirty ? 'dirty' : 'saved'}
          onOpenProject={() => void onProject('open')}
          onCreateProject={() => void onProject('create')}
          onCloseProject={() => void closeProject()}
          onOpenSettings={() => setSection('settings')}
          projectName={project}
          diagramName={snap.diagram.name}
          currentDiagramId={snap.diagram.id}
          onListDiagrams={async () => {
            const r = await api.listDiagrams();
            return r.ok ? r.value : [];
          }}
          onOpenDiagram={(id) => void openDiagram(id)}
          engine={engine}
          problems={snap.problems}
          {...(section === 'diagrams'
            ? { onRun: () => void openLaunch(snap.diagram.id) }
            : {
                // Fuera del Diseñador, la barra sigue la ejecución que se lanzó la última [R52.8].
                live: run.live,
                maxTokens,
                onControl: (a: 'pause' | 'resume' | 'cancel') => void client.control(a),
                ...(run.runId && run.live.status !== 'running' && run.live.status !== 'idle' ? { onShowSummary: () => setRunModal(run.runId) } : {}),
              })}
          running={runsIndex.runs.filter((r) => r.status === 'running').length}
          pendingCount={runsIndex.pending.length}
          onOpenLive={() => (setSection('runs'), setRunsNav({ section: 'live' }))}
          onOpenRuns={() => (setSection('runs'), setRunsNav({ section: 'inbox' }))}
          runError={run.error}
          {...(section === 'diagrams'
            ? {
                rightOpen: sideVisible,
                onToggleRight: () => {
                  if (sideVisible) {
                    setRightOpen(false);
                    setDiagramPanel(false);
                  } else {
                    setRightOpen(true);
                    if (!hasSelection && !assistOpen) setDiagramPanel(true);
                  }
                },
              }
            : {})}
          {...(project !== undefined
            ? {
                assistantOpen: assistOpen && (section !== 'diagrams' || rightOpen),
                onAssistant: () => {
                  const open = assistOpen && (section !== 'diagrams' || rightOpen);
                  if (section === 'diagrams') setRightOpen(true);
                  setAssistOpen(!open);
                },
              }
            : {})}
        />
        {runModal && (
          <RunModal
            api={api}
            runId={runModal}
            main={run}
            onClose={() => setRunModal(undefined)}
            // Un paso del modal lleva a la ejecución en Ejecuciones con ese paso en el lateral [R44.2].
            onPick={(key) => (setRunModal(undefined), setSection('runs'), setRunsNav({ section: 'history', runId: runModal, step: key }))}
            {...(section !== 'runs' ? { onOpenRuns: () => (setRunModal(undefined), setSection('runs'), setRunsNav({ section: 'history', runId: runModal })) } : {})}
            onExport={(id, jsonl) => downloadText(`${id}.jsonl`, jsonl)}
          />
        )}
        {message && (
          <div className="orq-alert" role="alert">
            <span className="orq-alert__text">{message}</span>
            <button type="button" className="orq-alert__close" aria-label={t('alert.close')} title={t('alert.close')} onClick={() => setMessage(undefined)}>
              <X size={16} aria-hidden />
            </button>
          </div>
        )}
        <div className="orq-shell__work">
        <div className="orq-shell__content" data-testid="content">
          {section === 'diagrams' && (
            <div className="orq-body">
              <Palette
                open={leftOpen}
                agents={agents}
                examples={examples}
                usage={usage}
                onAdd={(spec) => onAdd(spec)}
                onPickAgent={() => setPicker({})}
                onAddAgent={(agentId) => onAdd({ kind: 'agent', agentId })}
                onParallel={openParallel}
                resources={[
                  ...catalog.skills.map((k) => ({ kind: 'skillIds' as const, id: k.id, name: k.name })),
                  ...catalog.contexts.map((c) => ({ kind: 'contextIds' as const, id: c.id, name: c.name })),
                  ...(catalog.mcp ?? []).map((m) => ({ kind: 'mcpIds' as const, id: m.id, name: m.name })),
                ]}
                {...(project !== undefined
                  ? {
                      diagrams: diagramList,
                      currentDiagramId: snap.diagram.id,
                      runningIds: [...new Set([...(runningDiagramId ? [runningDiagramId] : []), ...runsIndex.runs.filter((r) => r.status === 'running').map((r) => r.diagramId)])],
                      askingIds,
                      onOpenDiagram: (id: string) => void openDiagram(id),
                      diagramMenu,
                    }
                  : {})}
                agentMenu={(id) => {
                  const m = agentMenuFor(id);
                  return [...m.top, ...m.knowledge];
                }}
                onSelectUse={(use) => {
                  session.goTo(use.path);
                  select(use.nodeId);
                }}
                onLoadExample={(ex) => {
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
                }}
                onNewAgent={() => openLibrary('agents', { tab: 'agents', id: 'new' })}
              />
              <main className="orq-main">
                <Breadcrumbs
                  crumbs={snap.crumbs}
                  onGo={(p) => session.goTo(p)}
                  onUp={() => session.up()}
                  onRename={(name) => guard(() => session.rename(name))}
                  renameRequest={renameReq}
                  actions={
                    <>
                      <DiagramMenu
                        compact
                        diagramName={snap.diagram.name}
                        currentDiagramId={snap.diagram.id}
                        onListDiagrams={async () => {
                          const r = await api.listDiagrams();
                          return r.ok ? r.value : [];
                        }}
                        onOpenDiagram={(id) => void openDiagram(id)}
                        onRenameDiagram={() => setRenameReq((n) => n + 1)}
                        onDuplicateDiagram={project !== undefined ? () => void duplicateDiagram() : undefined}
                        onDeleteDiagram={project !== undefined ? () => void deleteDiagram() : undefined}
                        onNew={() => void newDiagram()}
                      />
                      <span className="orq-grow" />
                      <SaveStatus saveState={project === undefined ? 'no-project' : saveState === 'saving' ? 'saving' : saveState === 'error' ? 'error' : snap.dirty ? 'dirty' : 'saved'} dirty={snap.dirty} />
                      <EditButtons canUndo={snap.canUndo} canRedo={snap.canRedo} projectOpen={project !== undefined} onNew={() => void newDiagram()} onUndo={undo} onRedo={redo} onSave={() => void save()} />
                      <button
                        type="button"
                        className={`orq-btn orq-btn--small orq-btn--ghost orq-crumbs__settings${diagramPanel && sideVisible ? ' is-on' : ''}`}
                        aria-pressed={diagramPanel && sideVisible}
                        onClick={() => {
                          if (diagramPanel && sideVisible) return setDiagramPanel(false);
                          select('');
                          setAssistOpen(false);
                          setRightOpen(true);
                          setDiagramPanel(true);
                        }}
                      >
                        <SlidersHorizontal size={14} aria-hidden="true" />
                        {t('diagram.settings')}
                      </button>
                    </>
                  }
                />
                {canvas}
              </main>
              {sideVisible && (
                <div className="orq-side" style={{ width: sideWidth }}>
                  <ResizeHandle width={sideWidth} min={SIDE_MIN} max={Math.max(SIDE_MIN, Math.min(760, window.innerWidth - 520))} reset={SIDE_DEFAULT} onChange={setSideWidth} onCommit={saveSideWidth} />
                  {assistOpen ? (
                    <AssistantPanel api={api} host={assistantHost} state={chat} setState={setChat} confirmActions={projectPermission(settings ?? {}) !== 'full'} where="diagrams" onClose={() => setAssistOpen(false)} />
                  ) : (
                  <>
                  {selectedNode && (
                    <div className="orq-side__head">
                      <span className="orq-side__title">{t('insp.tab.step')}</span>
                      <button type="button" className="orq-ib" aria-label={t('insp.close')} title={t('insp.close')} onClick={() => select('')}>
                        <X size={16} aria-hidden="true" />
                      </button>
                    </div>
                  )}
                  {!hasSelection && (
                    <div className="orq-side__head">
                      <span className="orq-side__title">{t('insp.tab.diagram')}</span>
                      <button type="button" className="orq-ib" aria-label={t('diagram.settings.close')} title={t('diagram.settings.close')} onClick={() => setDiagramPanel(false)}>
                        <X size={16} aria-hidden="true" />
                      </button>
                    </div>
                  )}
                  {(
                    <Inspector session={session} snap={snap} selection={selection} agents={agents} onError={fail} onEditAgent={(id) => openLibrary('agents', { tab: 'agents', id })}
                      events={eventsOfDiagram(run.events, snap.diagram.id)}
                      onSelect={select}
                      onChangeAgent={(nodeId) => setPicker({ replace: nodeId })}
                      catalog={catalog}
                      diagramNames={Object.fromEntries(diagramList.map((d) => [d.id, d.name]))}
                      onOpenDiagram={(id) => void openDiagram(id)}
                      onCreateKnowledge={(k) => openLibrary('knowledge', { tab: k, id: 'new' })}
                      api={api}
                      {...(settings && project !== undefined ? { files: { folder: workFolder, permissions: projectPermission(settings), onPermissions: (level: ProjectPermission) => void setPermissions(level) } } : {})}
                    />
                  )}
                  </>
                  )}
                </div>
              )}
            </div>
          )}
          {section === 'runs' && (
            <RunsScreen
              api={api}
              main={run}
              index={runsIndex}
              nav={runsNav}
              onNav={setRunsNav}
              subOpen={runsSub}
              onToggleSub={() => setRunsSub((v) => !v)}
              onControlMain={(a) => void client.control(a)}
              onAnswerMain={(q, text) => void client.answer(q, text)}
              agentNames={agentNames}
              onExport={(id, jsonl) => downloadText(`${id}.jsonl`, jsonl)}
            />
          )}
          {(section === 'agents' || section === 'knowledge') && (
            <LibraryScreen
              api={api}
              section={section}
              open={libOpen}
              drafts={drafts}
              onGo={openLibrary}
              onChanged={() => void reloadAgents()}
              onAskClaude={(text) => askAssistant(text)}
              version={libVersion}
              assistantReady={engine === 'claude'}
              onOpenTerminal={() => void openTerminal('claude').catch(() => undefined)}
            />
          )}
          {section === 'project' && (
            <ProjectScreen
              api={api}
              live={run.live}
              startWizard={wizard}
              onWizardShown={() => setWizard(false)}
              onChanged={() => void reloadAgents()}
              onGoDiagrams={() => setSection('diagrams')}
              onOpenSettings={() => setSection('settings')}
            />
          )}
          {section === 'settings' && <SettingsDialog api={api} onSaved={setSettings} />}
          {section === 'jobs' && project !== undefined && (
            <JobsScreen
              api={api}
              index={runsIndex}
              version={diagramList}
              onLaunch={(id) => void openLaunch(id)}
              onHistory={(id) => (setSection('runs'), setRunsNav({ section: 'history', diagramId: id }))}
              onEdit={(id) => {
                setSection('diagrams');
                if (id !== snap.diagram.id) void openDiagram(id);
              }}
              onNew={() => setSection('diagrams')}
              onOpenRuns={(to) => (setSection('runs'), setRunsNav({ section: to }))}
            />
          )}
          {section === 'library' && project !== undefined && (
            <DiagramsScreen
              api={api}
              diagrams={diagramList}
              currentId={snap.diagram.id}
              runningIds={[...new Set([...(runningDiagramId ? [runningDiagramId] : []), ...runsIndex.runs.filter((r) => r.status === 'running').map((r) => r.diagramId)])]}
              askingIds={askingIds}
              onOpen={(id) => {
                setSection('diagrams');
                if (id !== snap.diagram.id) void openDiagram(id);
              }}
              onNew={() => void newDiagram().then(() => setSection('diagrams'))}
              menu={(id) => diagramMenu(id).map((m) => (m.id === 'd-open' ? { ...m, disabled: false, onSelect: () => (setSection('diagrams'), id !== snap.diagram.id && void openDiagram(id)) } : m))}
            />
          )}
        </div>
        {assistOpen && section !== 'diagrams' && project !== undefined && (
          <div className="orq-dock" style={{ width: sideWidth }}>
            <ResizeHandle width={sideWidth} min={SIDE_MIN} max={Math.max(SIDE_MIN, Math.min(760, window.innerWidth - 520))} reset={SIDE_DEFAULT} onChange={setSideWidth} onCommit={saveSideWidth} />
            <AssistantPanel api={api} host={assistantHost} state={chat} setState={setChat} confirmActions={projectPermission(settings ?? {}) !== 'full'} where={section} onClose={() => setAssistOpen(false)} />
          </div>
        )}
        </div>
        {hub && (
          <TerminalPanel
            api={api}
            hub={hub}
            tabs={terms}
            active={termActive}
            open={termOpen}
            onActive={setTermActive}
            onClose={closeTerminal}
            onNew={(p) => void openTerminal(p).catch(() => undefined)}
            onToggle={() => setTermOpen((v) => !v)}
          />
        )}
      </div>
      {launch && (
        <RunDialog
          diagramName={launch.name}
          engine={engine}
          runnable={validateDiagram(launch).length === 0}
          lastInput={lastInputs.current.get(launch.id) ?? (launch.id === snap.diagram.id ? lastInput : '')}
          defaultLimit={maxTokens ?? settings?.defaultMaxTokens}
          onEngine={(e) => void setEngine(e)}
          onStart={() => undefined}
          onLaunch={(o, l, d, f, opts) => void onLaunch(launch, o, l, d, f, opts)}
          busyRuns={{ running: runsIndex.runs.filter((r) => r.status === 'running' && r.diagramId === launch.id).length, queued: runsIndex.queue.filter((q) => q.diagramId === launch.id).length }}
          api={api}
          onClose={() => setLaunch(undefined)}
          deliverable={launch.deliverable}
          finals={finalSteps(launch).map((id) => launch.nodes.find((n) => n.id === id)?.label ?? id)}
          onSaveDeliverable={(spec) => saveDeliverableTo(launch, spec)}
        />
      )}
      {inserting && (
        <InsertPicker
          agents={agents}
          at={inserting.at}
          onClose={() => setInserting(undefined)}
          onCreate={() => {
            setInserting(undefined);
            openLibrary('agents', { tab: 'agents', id: 'new' });
          }}
          onPick={(choice: InsertChoice) => {
            const edgeId = inserting.edgeId;
            setInserting(undefined);
            guard(() => select(session.insertOnEdge(edgeId, choice)));
          }}
          onParallel={() => {
            const edgeId = inserting.edgeId;
            setInserting(undefined);
            setParallelAt(edgeId);
          }}
        />
      )}
      {portPick &&
        (() => {
          const node = snap.level.nodes.find((n) => n.id === portPick.nodeId);
          if (!node) return null;
          const name = node.label ?? node.id;
          const know = portPick.port === 'know';
          const items = know
            ? [...catalog.skills.map((k) => ({ id: `s:${k.id}`, name: k.name, description: t('res.kind.skill') })), ...catalog.contexts.map((c) => ({ id: `c:${c.id}`, name: c.name, description: t('res.kind.context') }))]
            : (catalog.mcp ?? []).map((m) => ({ id: m.id, name: m.name, ...(m.description ? { description: m.description } : {}) }));
          const selected = know ? [...(node.extra?.skillIds ?? []).map((x) => `s:${x}`), ...(node.extra?.contextIds ?? []).map((x) => `c:${x}`)] : (node.extra?.mcpIds ?? []);
          return (
            <AssignPicker
              title={t(know ? 'res.pick.know' : 'res.pick.mcp', { name })}
              icon={know ? BookOpen : Plug}
              items={items}
              selected={selected}
              emptyText={t('res.pick.empty')}
              createLabel={t('res.pick.create')}
              onCreate={() => (setPortPick(undefined), openLibrary('knowledge', { tab: know ? 'skills' : 'mcp', id: 'new' }))}
              onClose={() => setPortPick(undefined)}
              onApply={(ids) => {
                setPortPick(undefined);
                const extra = know
                  ? { ...node.extra, skillIds: ids.filter((x) => x.startsWith('s:')).map((x) => x.slice(2)), contextIds: ids.filter((x) => x.startsWith('c:')).map((x) => x.slice(2)) }
                  : { ...node.extra, mcpIds: ids };
                guard(() => session.updateNode(node.id, { extra }));
              }}
            />
          );
        })()}
      {parallelAt && (
        <ParallelDialog
          agents={agents}
          between={(() => {
            const e = snap.level.edges.find((x) => x.id === parallelAt);
            const name = (id?: string) => snap.level.nodes.find((n) => n.id === id)?.label ?? id ?? '';
            return e ? { from: name(e.from), to: name(e.to) } : undefined;
          })()}
          onClose={() => setParallelAt(undefined)}
          onInsert={(spec) => {
            const edgeId = parallelAt;
            setParallelAt(undefined);
            guard(() => {
              const r = session.insertParallel(edgeId, spec);
              select(r.joinId ?? r.ids[0]!);
            });
          }}
        />
      )}
      {picker && (
        <AgentPicker
          agents={agents}
          onClose={() => setPicker(undefined)}
          projectOpen={project !== undefined}
          onCreate={() => {
            setPicker(undefined);
            openLibrary('agents', { tab: 'agents', id: 'new' });
          }}
          onPick={(agentId) => {
            const { at, replace } = picker;
            setPicker(undefined);
            if (replace) guard(() => session.updateNode(replace, { agentId }));
            else onAdd({ kind: 'agent', agentId }, at);
          }}
        />
      )}
    </div>
  );
}
