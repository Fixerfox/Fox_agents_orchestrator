import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorSession, createDiagram, t, type ProjectApi, type TestBridgeApi } from '@orquestador/editor';
import { isolatesBranches } from '@orquestador/core';
import { DraftStore, type LibraryTarget, type OpenLibrary } from '../common';
import type { AssistantHost, ChatState } from '../assistant';
import { useDesigner, useDesignerSelection, useDiagramDocument, useProjectCatalog, useSession, type AgentOption } from '../diagrams';
import { askingIdsOf, runningIdsOf, useLiveRun, useRunLauncher, useRunsIndex, type RunsNav } from '../runs';
import { useAppSettings } from '../settings';
import type { SectionId } from './NavRail';
import type { StartPath } from './StartScreen';
import { useShellLayout } from './useShellLayout';
import { useTerminals } from './useTerminals';

export interface AppProps {
  api: ProjectApi;
  /** Agentes de ejemplo integrados; los del proyecto se suman y tienen preferencia. */
  agents?: AgentOption[];
  /** Pregunta de confirmación (descartar cambios). Por defecto `window.confirm`. */
  confirm?: (message: string) => boolean;
  /** Abre el editor directamente, sin pantalla de inicio: para pruebas y para desarrollar la vista. */
  initialProject?: string;
  /** Puente del modo prueba; solo existe con la app arrancada en modo prueba [R82.7]. */
  test?: TestBridgeApi;
}

/** Estado de la aplicación: compone los hooks de cada contexto y lo que los une (proyecto, sección y asistente) [R32.13]. */
export function useApp({ api, agents: builtIn = [], confirm = (m) => window.confirm(m), initialProject }: AppProps) {
  const session = useMemo(() => new EditorSession(createDiagram('nuevo', 'Diagrama nuevo')), []);
  const snap = useSession(session);
  const { client, run, runningDiagramId } = useLiveRun(api);

  const [section, setSection] = useState<SectionId>('diagrams');
  const sectionRef = useRef(section);
  sectionRef.current = section;
  /** Modal de la última ejecución, desde la barra fuera del Diseñador [R44.4][R52.8]. */
  const [runModal, setRunModal] = useState<string>();
  /** Apartado de Ejecuciones y ejecución abierta [R35.4][R35.8]. */
  const [runsNav, setRunsNav] = useState<RunsNav>({ section: 'history' });
  const goRuns = (nav: RunsNav) => {
    setSection('runs');
    setRunsNav(nav);
  };
  const goDiagrams = useCallback(() => setSection('diagrams'), []);
  // Pulsar un aviso del sistema lleva a su ejecución [R61.11].
  useEffect(() => api.onOpenRun(({ runId, live }) => {
    setSection('runs');
    setRunsNav({ section: live ? 'live' : 'history', runId });
  }), [api]);

  const [message, setMessage] = useState<string>();
  const fail = useCallback((m: string) => setMessage(m), []);
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
  const [project, setProject] = useState<string | undefined>(initialProject);
  const projectRef = useRef(project);
  projectRef.current = project;

  const terminals = useTerminals(api, project, fail);
  const sel = useDesignerSelection(snap);
  const layout = useShellLayout(sel.hasSelection);
  const [chat, setChat] = useState<ChatState>({ items: [] });
  /** Sube cuando el asistente cambia agentes, skills, contextos o MCP, para que Agentes y Conocimiento recarguen [R38.7]. */
  const [libVersion, setLibVersion] = useState(0);
  /**
   * Abre el asistente y le envía una petición ya escrita [R30.10]. Se queda en la sección actual salvo que la
   * petición hable de un paso del diagrama [R38.1].
   */
  const askAssistant = (text: string, toDiagrams = false) => {
    if (toDiagrams) setSection('diagrams');
    layout.setRightOpen(true);
    layout.setAssistOpen(true);
    setChat((c) => ({ ...c, pending: text }));
  };
  /** Historial y preguntas pendientes de todas las ejecuciones del proyecto [R35.6]. */
  const runsIndex = useRunsIndex(api, run, project);
  const askingIds = askingIdsOf(runsIndex.pending, runsIndex.runs, runningDiagramId, run.live.pending.length > 0);
  const runningIds = runningIdsOf(runsIndex.runs, runningDiagramId);
  const lib = useProjectCatalog(api, project, builtIn);
  const doc = useDiagramDocument({ api, session, snap, project, projectRef, confirm, fail, guard, clearSelection: sel.clearSelection, goDiagrams });
  const config = useAppSettings(api, project, section, fail);
  // Sin aislar las ramas en paralelo, los abanicos avisan [R73.21].
  useEffect(() => session.setSharedFans(config.settings !== undefined && !isolatesBranches(config.settings)), [session, config.settings]);
  const launcher = useRunLauncher({ api, session, project, client, save: doc.save, fail, setMessage, refreshRuns: runsIndex.refresh, goRuns, setRunsNav });

  const [libOpen, setLibOpen] = useState<LibraryTarget>();
  const [drafts] = useState(() => new DraftStore());
  const [startSettings, setStartSettings] = useState(false);
  const [wizard, setWizard] = useState(false);
  const openLibrary: OpenLibrary = (s, open) => {
    setSection(s);
    setLibOpen(open);
  };
  const designer = useDesigner({ api, session, snap, doc, sel, catalog: lib, projectRef, lastInput: launcher.lastInput, active: section === 'diagrams', fail, guard, openLibrary, askAssistant, showRight: () => layout.setRightOpen(true) });

  /** Lo que el asistente puede hacer en la interfaz: mismo contrato y misma sesión que el usuario [R29.2]. */
  const assistantHost: AssistantHost = {
    api,
    session,
    newDiagram: doc.createNamed,
    run: async (input) => {
      await doc.save();
      return launcher.onStart(input);
    },
    refresh: () => {
      void lib.reloadAgents();
      setLibVersion((v) => v + 1);
    },
    created: (kind, id) => {
      // Si se está viendo esa lista, se abre lo que acaba de crear [R38.7].
      if (sectionRef.current === 'knowledge' && kind !== 'agents') setLibOpen({ tab: kind, id });
      else if (sectionRef.current === 'agents' && kind === 'agents') setLibOpen({ tab: 'agents', id });
    },
    openTerminal: terminals.openTerminal,
  };

  const onProject = async (kind: 'create' | 'open') => {
    const res = await (kind === 'create' ? api.createProject() : api.openProject());
    if (!res.ok) return fail(t('project.error', { message: res.error.message }));
    if (res.value) {
      setProject(res.value.name);
      projectRef.current = res.value.name;
      setSection('diagrams');
      setMessage(undefined);
      sel.clearSelection();
      await doc.openFirstDiagram();
    }
  };
  const closeProject = async () => {
    if (session.getSnapshot().dirty) await doc.save(); // se guarda antes de cerrar [R32.38]
    const res = await api.closeProject();
    if (!res.ok) return fail(t('project.error', { message: res.error.message }));
    setProject(undefined);
    sel.clearSelection();
    setMessage(undefined);
    setSection('diagrams');
    session.load(createDiagram('principal', 'Principal'));
  };
  /** Proyecto abierto desde la pantalla de inicio. */
  const onOpened = (name: string, path?: StartPath) => {
    setProject(name);
    projectRef.current = name;
    sel.clearSelection();
    // Abrir desde el inicio carga el diagrama del disco, nunca uno en blanco que pise al guardado [R32.38].
    void doc.openFirstDiagram();
    setMessage(undefined);
    setSection(path === 'folder' ? 'project' : 'diagrams');
    setWizard(path === 'folder');
  };
  // Tras recargarse la interfaz se vuelve al proyecto abierto: abrirlo otra vez perdería las ejecuciones en marcha [R19.12].
  useEffect(() => {
    if (projectRef.current !== undefined) return;
    void api.currentProject().then((res) => {
      if (res.ok && res.value && projectRef.current === undefined) onOpened(res.value.name);
    });
  }, [api]);
  /** Pulsar en el rail: volver a pulsar la sección abierta pliega su panel lateral [R32.13]. */
  const goSection = (s: SectionId) => {
    if (s === 'diagrams' && section === 'diagrams') layout.setLeftOpen((v) => !v);
    else if (s === 'agents' || s === 'knowledge') openLibrary(s);
    else if (s === 'runs' && section === 'runs') layout.setRunsSub((v) => !v);
    else {
      if (s === 'runs') setRunsNav({ section: runsIndex.runs.some((r) => r.status === 'running') || runsIndex.queue.length > 0 ? 'live' : 'history' });
      setSection(s);
    }
  };

  return {
    api, session, snap, client, run, section, setSection, runModal, setRunModal, runsNav, setRunsNav, goRuns, goDiagrams, goSection,
    message, setMessage, fail, guard, project, onProject, closeProject, onOpened, terminals, sel, layout, chat, setChat, libVersion,
    askAssistant, runsIndex, askingIds, runningIds, lib, doc, config, launcher, libOpen, drafts, startSettings, setStartSettings, wizard,
    setWizard, openLibrary, designer, assistantHost,
  };
}

export type AppModel = ReturnType<typeof useApp>;
