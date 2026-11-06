import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { Plug, BookOpen, Bot, FileText, PackagePlus, FolderPlus, Plus, Search } from 'lucide-react';
import { type ContextKind, type AgentDefinition, type ContextDefinition, type SkillDefinition, type LibraryFolders, emptyLibraryFolders, type LibraryKind, MODELS, newContext } from '@orquestador/core';
import { type ProjectApi, type McpView, t, installSpecKit, hasSpecKit, type MessageKey } from '@orquestador/editor';
import { McpForm } from './McpForm';
import { AgentAvatar, AskFirstMark, type LibRow, LibraryList, DraftStore, useDraftVersion } from '../common/index';
import { AgentWelcome, McpWelcome, SkillWelcome, ContextWelcome } from './McpWelcome';
import { LibraryOverview } from './LibraryOverview';
import { InstallDialog } from './InstallDialog';
import { NEW, listOf, initial } from './editorParts';
import { AgentForm } from './AgentForm';
import { SkillForm } from './SkillForm';
import { ContextForm } from './ContextForm';

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
  onAskClaude?: (text: string) => void;
  /** Abre una terminal de Claude Code [R30.10]. */
  onOpenTerminal?: () => void;
  /** Sube cuando algo de fuera (el asistente) cambia la biblioteca: se recarga [R38.7]. */
  version?: number;
  /** El asistente puede trabajar (motor Claude) [R38.6]. */
  assistantReady?: boolean;
}

const SZ = { size: 16, strokeWidth: 1.5, 'aria-hidden': true } as const;

export const KIND_TAG: Record<ContextKind, string> = { text: 'TXT', url: 'URL', file: 'DIR' };

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
  const rowsOf = (list: { id: string; name: string }[]): LibRow[] =>
    list.map((i) => {
      let meta: ReactNode;
      let tag: ReactNode;
      let description: string | undefined = (i as { description?: string }).description?.trim() || undefined;
      if (tab === 'agents') {
        const a = i as AgentDefinition;
        tag = a.icon ? <AgentAvatar name={a.name} icon={a.icon} tone={a.tone} /> : <span className="orq-lib__av">{initial(a.name)}</span>;
        const uses = diagramUses[a.id];
        const model = MODELS.find((m) => m.id === a.model)?.name ?? a.model;
        const usesText = uses === undefined ? '' : uses === 0 ? ` · ${t('lib.uses.none')}` : ` · ${uses === 1 ? t('lib.uses.diagrams.one') : t('lib.uses.diagrams.many', { count: uses })}`;
        meta = a.description.trim() === '' ? <span className="orq-lib__warn">{t('lib.noDesc')}</span> : `${model}${usesText}`;
        if (a.askFirst)
          meta = (
            <>
              <AskFirstMark size={12} /> {meta}
            </>
          );
      } else {
        const n = usedBy(tab, i.id).length;
        tag =
          tab === 'contexts' ? (
            <span className="orq-lib__tag">{KIND_TAG[(i as ContextDefinition).kind]}</span>
          ) : (
            <span className={`orq-lib2__ic is-${tab}`}>{tab === 'mcp' ? <Plug size={14} strokeWidth={1.5} aria-hidden="true" /> : <BookOpen size={14} strokeWidth={1.5} aria-hidden="true" />}</span>
          );
        meta = n === 0 ? t('lib.uses.none') : n === 1 ? t('lib.usedBy.one') : t('lib.usedBy.many', { count: n });
        if (tab === 'mcp' && !(i as McpView).enabled) meta = <span className="orq-lib__warn">{t('mcp.off')}</span>;
        else if (tab === 'mcp' && (i as McpView).scope === 'app') meta = `${t('mcp.scope.badge')} · ${meta as string}`;
        if (tab === 'contexts') description = undefined;
      }
      return { id: i.id, name: i.name, ...(description ? { description } : {}), tag, meta, unsaved: drafts.has(`${tab}:${i.id}`) };
    });
  const rows = rowsOf(items);
  const TAB_ICON = { agents: Bot, contexts: FileText, skills: BookOpen, mcp: Plug } as const;
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
      <aside className="orq-lib__list">
        <div className="orq-lib__head">
          <h1>{title}</h1>
          <button type="button" className="orq-ib" aria-label={t('install.open')} title={t('install.open')} onClick={() => setInstalling(true)}>
            <PackagePlus {...SZ} />
          </button>
          <button type="button" className="orq-ib" aria-label={t('lib.folder.new')} title={t('lib.folder.new')} onClick={() => setNewFolder(true)}>
            <FolderPlus {...SZ} />
          </button>
          <button
            type="button"
            className="orq-btn orq-btn--small orq-btn--primary"
            aria-label={t(tab === 'agents' ? 'agents.new' : tab === 'contexts' ? 'contexts.new' : tab === 'skills' ? 'skills.new' : 'mcp.new')}
            onClick={() => (setSavedId(undefined), setManual(false), setSel(NEW))}
          >
            <Plus {...SZ} />
            {t('lib.new').replace(/^\+ /, '')}
            {drafts.has(`${tab}:${NEW}`) && <span className="orq-dot" role="img" aria-label={t('draft.unsaved')} title={t('draft.unsaved')} />}
          </button>
        </div>
        {section === 'knowledge' && (
          <div className="orq-lib2__tabs" role="tablist" aria-label={title}>
            {(['contexts', 'skills', 'mcp'] as const).map((k) => {
              const Icon = TAB_ICON[k];
              return (
                <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => switchTab(k)}>
                  <Icon size={15} strokeWidth={1.5} aria-hidden="true" />
                  <span>{t(`agents.tab.${k}` as MessageKey)}</span>
                  {drafts.any(`${k}:`) && <span className="orq-dot" role="img" aria-label={t('draft.unsaved')} title={t('draft.unsaved')} />}
                  <em>{k === 'contexts' ? contexts.length : k === 'skills' ? skills.length : mcp.length}</em>
                </button>
              );
            })}
          </div>
        )}
        <p className="orq-lib2__tabsub">{t(`lib.k.${tab}.sub` as MessageKey)}</p>
        <label className="orq-pal__search">
          <Search {...SZ} />
          <input type="search" value={q} placeholder={t('lib.search')} aria-label={t('lib.search')} onChange={(e) => setQ(e.target.value)} />
        </label>
        {loadError && (
          <p className="orq-field__error" role="alert">
            {loadError}
          </p>
        )}
        {items.length === 0 && !newFolder && folders.kinds[kind].folders.length === 0 && <p className="orq-hint">{t(tab === 'agents' ? 'agents.empty' : tab === 'contexts' ? 'contexts.empty' : tab === 'skills' ? 'skills.empty' : 'mcp.empty')}</p>}
        <LibraryList
          key={tab}
          kind={kind}
          rows={rows}
          folders={folders.kinds[kind]}
          query={q}
          selected={sel}
          onSelect={(id) => (setSavedId(undefined), setSel(id))}
          onFolders={changeFolders}
          creating={newFolder}
          onCreatingDone={() => setNewFolder(false)}
          label={t(`agents.tab.${tab}` as MessageKey)}
        />
      </aside>
      <div className="orq-lib__editor">
        {!loaded ? null : showWelcome && tab === 'agents' ? (
          <AgentWelcome
            ready={assistantReady}
            onStart={(text) => (setSeed(text), setManual(true))}
            onWrite={() => setManual(true)}
            onInstall={() => setInstalling(true)}
            onSpecKit={specKitComplete ? undefined : () => void addSpecKit().then(() => setSel(undefined))}
          />
        ) : showWelcome && tab === 'mcp' ? (
          <McpWelcome ready={assistantReady} onAsk={(text) => onAskClaude?.(text)} onManual={() => setManual(true)} />
        ) : showWelcome && tab === 'skills' ? (
          <SkillWelcome
            ready={assistantReady}
            onAsk={(text) => onAskClaude?.(text)}
            onWrite={() => setManual(true)}
            onInstall={() => setInstalling(true)}
            onSpecKit={specKitComplete ? undefined : () => void addSpecKit().then(() => setSel(undefined))}
          />
        ) : showWelcome && tab === 'contexts' ? (
          <ContextWelcome ready={assistantReady} onAsk={(text) => onAskClaude?.(text)} onWrite={() => manualContext('text')} onFiles={() => manualContext('file', true)} onUrl={() => manualContext('url')} />
        ) : sel === undefined || (sel !== NEW && current === undefined) ? (
          <LibraryOverview
            tab={tab}
            rows={rows}
            folders={folders.kinds[kind]}
            onOpen={(id) => (setSavedId(undefined), setSel(id))}
            onNew={() => (setSavedId(undefined), setManual(false), setSel(NEW))}
            {...(onAskClaude && tab !== 'mcp' ? { onAsk: onAskClaude } : {})}
            {...(onAskClaude && tab === 'mcp' ? { onAsk: () => (setSavedId(undefined), setSel(NEW)) } : {})}
            isUnused={(id) => (tab === 'agents' ? diagramUses[id] === 0 : usedBy(tab as 'contexts' | 'skills' | 'mcp', id).length === 0)}
            isOff={(id) => tab === 'mcp' && mcp.find((m) => m.id === id)?.enabled === false}
            {...(specKitHere ? { specKit: { state: speckit, onAdd: () => void addSpecKit() } } : {})}
          />
        ) : tab === 'agents' ? (
          <AgentForm
            key={`${tab}:${sel}`}
            api={api}
            drafts={drafts}
            draftKey={`${tab}:${sel}`}
            original={current as AgentDefinition | undefined}
            agents={agents}
            contexts={contexts}
            skills={skills}
            mcp={mcp}
            justSaved={savedId === sel}
            onSaved={(id) => void changed(id)}
            onDeleted={() => void changed(undefined)}
            onCreateOther={createOther}
            busy={sel !== undefined && busy?.agents.has(sel) === true}
            {...(sel === NEW && seed ? { seed } : {})}
            assistantReady={assistantReady}
          />
        ) : tab === 'mcp' ? (
          <McpForm
            key={`${tab}:${sel}`}
            api={api}
            drafts={drafts}
            draftKey={`${tab}:${sel}`}
            original={current as McpView | undefined}
            servers={mcp}
            agents={agents}
            justSaved={savedId === sel}
            onSaved={(id) => void changed(id)}
            onDeleted={() => void changed(undefined)}
            onAgentsChanged={() => void changed(sel === NEW ? undefined : sel)}
            busy={sel !== undefined && busy?.mcp?.has(sel) === true}
            {...(onAskClaude ? { onAskClaude } : {})}
            {...(onOpenTerminal ? { onOpenTerminal } : {})}
          />
        ) : tab === 'skills' ? (
          <SkillForm
            key={`${tab}:${sel}`}
            api={api}
            drafts={drafts}
            draftKey={`${tab}:${sel}`}
            original={current as SkillDefinition | undefined}
            skills={skills}
            agents={agents}
            justSaved={savedId === sel}
            onSaved={(id) => void changed(id)}
            onDeleted={() => void changed(undefined)}
            onAgentsChanged={() => void changed(sel === NEW ? undefined : sel)}
            busy={sel !== undefined && busy?.skills.has(sel) === true}
          />
        ) : (
          <ContextForm
            key={`${tab}:${sel}`}
            api={api}
            drafts={drafts}
            draftKey={`${tab}:${sel}`}
            original={current as ContextDefinition | undefined}
            contexts={contexts}
            agents={agents}
            justSaved={savedId === sel}
            onSaved={(id) => void changed(id)}
            onDeleted={() => void changed(undefined)}
            onAgentsChanged={() => void changed(sel === NEW ? undefined : sel)}
            busy={sel !== undefined && busy?.contexts.has(sel) === true}
            autoPick={sel === NEW && ctxPick}
          />
        )}
      </div>
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
