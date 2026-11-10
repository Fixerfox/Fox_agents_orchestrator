import { useState, useRef, useEffect, useCallback } from 'react';
import { type ContextKind, type AgentDefinition, type ContextDefinition, type SkillDefinition, type LibraryFolders, emptyLibraryFolders, type LibraryKind, newContext } from '@orquestador/core';
import { type ProjectApi, type McpView, t, installSpecKit, hasSpecKit } from '@orquestador/editor';
import { DraftStore, useDraftVersion } from '../common';
import { InstallDialog } from './InstallDialog';
import { NEW, listOf } from './editorParts';
import { LibraryDetail } from './LibraryDetail';
import { LibraryListPane } from './LibraryListPane';
import { libraryRows } from './libraryRows';

export type LibrarySection = 'agents' | 'knowledge';

type Tab = 'agents' | 'contexts' | 'skills' | 'mcp';

interface Props {
  api: ProjectApi;
  section: LibrarySection;
  /** Se avisa tras guardar o borrar para que la galería y los nodos se actualicen. */
  onChanged: () => void;
  /** Elemento a abrir al entrar: `new` crea uno vacío. */
  open?: { tab: Tab; id: string } | undefined;
  /** Pide cambiar de sección (p. ej. crear un contexto desde un agente). */
  onGo?: (section: LibrarySection, open: { tab: Tab; id: string }) => void;
  /** Borradores compartidos entre secciones: lo escrito sobrevive al cambiar de pantalla [R22.11]. */
  drafts?: DraftStore;
  /** Lo que usa la ejecución en curso: no se guarda ni se elimina [R32.37]. */
  busy?: { agents: Set<string>; skills: Set<string>; contexts: Set<string>; mcp?: Set<string> } | undefined;
  /** Abre el asistente con una petición (alta asistida de MCP) [R30.10]. */
  onAskClaude?: (text: string, title?: string) => void;
  /** Abre una terminal de Claude Code [R30.10]. */
  onOpenTerminal?: () => void;
  /** Sube cuando algo de fuera (el asistente) cambia la biblioteca: se recarga [R38.7]. */
  version?: number;
  /** El asistente puede trabajar (motor Claude) [R38.6]. */
  assistantReady?: boolean;
}

/**
 * Agentes y Conocimiento como pantallas completas (prototipos «Agentes A» y «Conocimiento A/B»): lista con buscador
 * y editor con cabecera fija, «Sin guardar» y Guardar [R22.6][R22.7][R22.8][R32.13][R32.14][R32.15].
 */
export function LibraryScreen({ api, section, onChanged, open, onGo, drafts: shared, busy, onAskClaude, onOpenTerminal, version = 0, assistantReady = false }: Props) {
  const [tab, setTab] = useState<Tab>(open?.tab ?? (section === 'agents' ? 'agents' : 'contexts'));
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [contexts, setContexts] = useState<ContextDefinition[]>([]);
  const [skills, setSkills] = useState<SkillDefinition[]>([]);
  const [mcp, setMcp] = useState<McpView[]>([]);
  const [folders, setFolders] = useState<LibraryFolders>(emptyLibraryFolders);
  const [newFolder, setNewFolder] = useState(false);
  /** «Nuevo» en MCP, skills y contextos empieza por el asistente salvo que se elija hacerlo a mano [R38.6][R38.19][R38.20]. */
  const [manual, setManual] = useState(false);
  /** Descripción con la que empiezan los pasos de un agente nuevo [R57.2]. */
  const [seed, setSeed] = useState<string>();
  /** Contexto nuevo que debe abrir el diálogo de archivos nada más mostrarse [R38.20]. */
  const [ctxPick, setCtxPick] = useState(false);
  const [speckit, setSpeckit] = useState<'idle' | 'busy' | string>('idle');
  const [installing, setInstalling] = useState(false);
  const [sel, setSel] = useState<string | undefined>(open ? (open.id === 'new' ? NEW : open.id) : undefined);
  const [q, setQ] = useState('');
  const [loadError, setLoadError] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  const [savedId, setSavedId] = useState<string>();
  const [own] = useState(() => new DraftStore());
  const drafts = shared ?? own;
  useDraftVersion(drafts);
  const lastSel = useRef<Partial<Record<Tab, string | undefined>>>({});

  useEffect(() => {
    if (!open) return;
    setTab(open.tab);
    setSavedId(undefined);
    setSel(open.id === 'new' ? NEW : open.id);
  }, [open]);
  // Al cambiar de sección se recuerda lo abierto en cada pestaña [R22.11].
  const prevSection = useRef(section);
  useEffect(() => {
    if (prevSection.current === section) return;
    prevSection.current = section;
    if (open) return;
    lastSel.current[tab] = sel;
    const next: Tab = section === 'agents' ? 'agents' : tab === 'agents' ? 'contexts' : tab;
    setTab(next);
    setSavedId(undefined);
    setSel(lastSel.current[next]);
  }, [section]);

  const reload = useCallback(async () => {
    const [a, c, k, m] = await Promise.all([api.listAgents(), api.listContexts(), api.listSkills(), api.listMcp()]);
    if (!a.ok) return setLoadError(t('agents.loadError', { message: a.error.message }));
    if (!c.ok) return setLoadError(t('agents.loadError', { message: c.error.message }));
    if (!k.ok) return setLoadError(t('agents.loadError', { message: k.error.message }));
    setLoadError(undefined);
    setAgents(a.value);
    setContexts(c.value);
    setSkills(k.value);
    setMcp(m.ok ? m.value : []);
    const f = await api.getLibraryFolders();
    if (f.ok) setFolders(f.value);
    setLoaded(true);
  }, [api]);
  useEffect(() => void reload(), [reload, version]);
  useEffect(() => (setManual(false), setCtxPick(false), setSeed(undefined)), [sel, tab]);
  /** Cambia las carpetas y las guarda; devuelve el error, si lo hay [R38.14]. */
  const changeFolders = async (fn: (f: LibraryFolders) => LibraryFolders): Promise<string | undefined> => {
    let next: LibraryFolders;
    try {
      next = fn(folders);
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    setFolders(next);
    const r = await api.saveLibraryFolders(next);
    if (!r.ok) {
      setFolders(folders);
      return r.error.message;
    }
    setFolders(r.value);
    return undefined;
  };
  const addSpecKit = async () => {
    setSpeckit('busy');
    try {
      const r = await installSpecKit(api);
      setSpeckit(r.skills.length + r.agents.length === 0 ? t('speckit.already') : t('speckit.done', { skills: r.skills.length, agents: r.agents.length }));
      await reload();
      onChanged();
    } catch (e) {
      setSpeckit(e instanceof Error ? e.message : String(e));
    }
  };

  const changed = async (nextSel?: string) => {
    await reload();
    onChanged();
    setSavedId(nextSel);
    setSel(nextSel);
  };
  /** Diagramas que usan cada agente, para la fila de la lista («Sonnet 5.5 · 2 diagramas») [R32.30]. */
  const [diagramUses, setDiagramUses] = useState<Record<string, number>>({});
  useEffect(() => {
    let alive = true;
    void Promise.all(agents.map(async (a) => [a.id, await api.agentUsage(a.id)] as const)).then((rows) => {
      if (alive) setDiagramUses(Object.fromEntries(rows.map(([id, r]) => [id, r.ok ? r.value.length : 0])));
    });
    return () => {
      alive = false;
    };
  }, [api, agents]);
  const usedBy = (kind: 'contexts' | 'skills' | 'mcp', id: string) => agents.filter((a) => listOf(a, kind).includes(id));
  const items: { id: string; name: string }[] = tab === 'agents' ? agents : tab === 'contexts' ? contexts : tab === 'skills' ? skills : mcp;
  const current = sel === NEW ? undefined : items.find((i) => i.id === sel);
  const title = t(section === 'agents' ? 'lib.agents' : 'lib.knowledge');
  const switchTab = (k: Tab) => {
    lastSel.current[tab] = sel;
    setTab(k);
    setSavedId(undefined);
    setSel(lastSel.current[k]);
  };
  const createOther = (to: 'contexts' | 'skills' | 'mcp', id = 'new') => {
    lastSel.current[tab] = sel;
    onGo?.('knowledge', { tab: to, id });
  };

  const kind: LibraryKind = tab;
  const rows = libraryRows(items, { tab, diagramUses, usedBy, drafts });
  const showWelcome = (tab === 'mcp' || tab === 'skills' || tab === 'contexts' || tab === 'agents') && sel === NEW && !manual && !drafts.has(`${tab}:${NEW}`);
  /** Abre la ficha nueva de un contexto con un tipo ya elegido [R38.20]. */
  const manualContext = (kind: ContextKind, pickNow = false) => {
    if (kind !== 'text') drafts.set(`contexts:${NEW}`, { ...newContext('', ''), kind });
    setManual(true);
    setCtxPick(pickNow);
  };
  const specKitComplete = hasSpecKit(skills.map((k) => k.id), agents.map((a) => a.id));
  const specKitHere = (tab === 'skills' || tab === 'agents') && !specKitComplete;

  return (
    <section className="orq-page orq-lib orq-lib2" aria-label={title}>
      <LibraryListPane
        title={title}
        section={section}
        tab={tab}
        kind={kind}
        drafts={drafts}
        rows={rows}
        itemCount={items.length}
        counts={{ contexts: contexts.length, skills: skills.length, mcp: mcp.length }}
        folders={folders.kinds[kind]}
        loadError={loadError}
        sel={sel}
        setSel={setSel}
        setSavedId={setSavedId}
        setManual={setManual}
        setInstalling={setInstalling}
        switchTab={switchTab}
        onFolders={changeFolders}
        q={q}
        setQ={setQ}
        newFolder={newFolder}
        setNewFolder={setNewFolder}
      />
      <LibraryDetail
        api={api}
        tab={tab}
        drafts={drafts}
        agents={agents}
        contexts={contexts}
        skills={skills}
        mcp={mcp}
        rows={rows}
        folders={folders.kinds[kind]}
        loaded={loaded}
        showWelcome={showWelcome}
        assistantReady={assistantReady}
        sel={sel}
        setSel={setSel}
        current={current}
        savedId={savedId}
        setSavedId={setSavedId}
        setManual={setManual}
        seed={seed}
        setSeed={setSeed}
        ctxPick={ctxPick}
        setInstalling={setInstalling}
        specKitComplete={specKitComplete}
        specKitHere={specKitHere}
        speckit={speckit}
        addSpecKit={addSpecKit}
        manualContext={manualContext}
        diagramUses={diagramUses}
        usedBy={usedBy}
        changed={changed}
        createOther={createOther}
        busy={busy}
        onAskClaude={onAskClaude}
        onOpenTerminal={onOpenTerminal}
      />
      {installing && (
        <InstallDialog
          api={api}
          onClose={() => {
            setInstalling(false);
            void changed(undefined);
          }}
        />
      )}
    </section>
  );
}
