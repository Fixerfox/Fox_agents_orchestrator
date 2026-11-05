import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { AlertTriangle, BookOpen, Bot, Copy, Eye, FilePlus2, FileText, FolderOpen, FolderPlus, Link2, PackagePlus, Plug, Plus, Search, Trash2, X } from 'lucide-react';
import { McpForm } from './McpForm';
import { AGENT_ICON_COMPONENT, AgentAvatar, AskFirstMark } from './agentLook';
import { ContextWelcome, McpWelcome, SkillWelcome } from './McpWelcome';
import { LibraryList, type LibRow } from './LibraryList';
import { LibraryOverview } from './LibraryOverview';
import {
  LIMITS,
  MODELS,
  SKILL_LIMITS,
  newAgent,
  newContext,
  isScriptPath,
  newSkill,
  slugify,
  type AgentDefinition,
  type ContextDefinition,
  type ContextKind,
  type SkillDefinition,
  AGENT_ICONS,
  AGENT_TONES,
  emptyLibraryFolders,
  type AgentIcon,
  type AgentTone,
  type LibraryFolders,
  type LibraryKind,
  DEFAULT_PERMISSION,
  projectPermission,
  type ProjectPermission,
} from '@orquestador/core';
import { hasSpecKit, installSpecKit, t, type McpView, type MessageKey, type ProjectApi } from '@orquestador/editor';
import { Field, fieldErrors } from './fields';
import { AssignPicker, AssignedField } from './AssignPicker';
import { DraftStore, MarkdownField, useDraftState, useDraftVersion } from './editors';
import { InstallDialog } from './InstallDialog';
import { PermissionPicker, permissionName } from './PermissionPicker';

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

const NEW = '__new__';
const SZ = { size: 16, strokeWidth: 1.5, 'aria-hidden': true } as const;
const KIND_TAG: Record<ContextKind, string> = { text: 'TXT', url: 'URL', file: 'DIR' };
const initial = (name: string) => (name.trim()[0] ?? '?').toUpperCase();

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
  useEffect(() => (setManual(false), setCtxPick(false)), [sel, tab]);
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
  const showWelcome = (tab === 'mcp' || tab === 'skills' || tab === 'contexts') && sel === NEW && !manual && !drafts.has(`${tab}:${NEW}`);
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
        {!loaded ? null : showWelcome && tab === 'mcp' ? (
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

/** Cabecera fija del editor: nombre, estado y acciones; Ctrl+S guarda [R32.14]. */
export function EditorHead({ badge, name, sub, dirty, saved, isNew, onDiscard, onDelete, busy = false }: { badge: ReactNode; name: string; sub?: ReactNode; dirty: boolean; saved: boolean; isNew: boolean; onDiscard: () => void; onDelete: () => void; busy?: boolean }) {
  return (
    <>
    <header className="orq-editor__head">
      {badge}
      <div className="orq-editor__title">
        <strong>{name.trim() || t('lib.untitled')}</strong>
        {sub && <span className="orq-hint">{sub}</span>}
      </div>
      {dirty ? (
        <span className="orq-editor__state is-dirty">{t('lib.dirty')}</span>
      ) : (
        saved && (
          <span className="orq-hint" role="status">
            {t('form.saved')}
          </span>
        )
      )}
      {dirty && (
        <button type="button" className="orq-btn orq-btn--ghost orq-btn--small" onClick={onDiscard}>
          {t('lib.discard')}
        </button>
      )}
      {!isNew && (
        <button type="button" className="orq-btn orq-btn--ghost orq-btn--small" disabled={busy} onClick={onDelete}>
          <Trash2 {...SZ} />
          {t('form.delete')}
        </button>
      )}
      <button type="submit" className="orq-btn orq-btn--primary" disabled={busy} aria-label={t('form.save')} aria-keyshortcuts="Control+S">
        {t('form.save')}
        <kbd aria-hidden="true">Ctrl S</kbd>
      </button>
    </header>
    {busy && (
      <p className="orq-locked orq-editor__locked" role="status">
        {t('run.locked.lib')}
      </p>
    )}
    </>
  );
}

export const saveKeys = (save: () => void) => (e: KeyboardEvent) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    e.stopPropagation();
    save();
  }
};

/** «Lo usan»: agentes que tienen asignado este contexto o skill; se asigna y se quita desde aquí [R32.15]. */
const listOf = (a: AgentDefinition, kind: 'contexts' | 'skills' | 'mcp') => (kind === 'contexts' ? a.contextIds : kind === 'skills' ? (a.skillIds ?? []) : (a.mcpIds ?? []));
const withList = (a: AgentDefinition, kind: 'contexts' | 'skills' | 'mcp', next: string[]): AgentDefinition =>
  kind === 'contexts' ? { ...a, contextIds: next } : kind === 'skills' ? { ...a, skillIds: next } : { ...a, mcpIds: next };

export function UsedBy({ api, kind, id, saved, agents, onChanged }: { api: ProjectApi; kind: 'contexts' | 'skills' | 'mcp'; id: string; saved: boolean; agents: AgentDefinition[]; onChanged: () => void }) {
  const [error, setError] = useState<string>();
  const has = (a: AgentDefinition) => listOf(a, kind).includes(id);
  const users = agents.filter(has);
  const others = agents.filter((a) => !has(a));
  const update = async (a: AgentDefinition, on: boolean) => {
    const list = listOf(a, kind);
    const next = on ? [...list, id] : list.filter((x) => x !== id);
    const res = await api.saveAgent(withList(a, kind, next));
    if (!res.ok) return setError(res.error.message);
    setError(undefined);
    onChanged();
  };
  return (
    <section className="orq-editor__side-sec" aria-label={t('lib.usedby')}>
      <h3>{t('lib.usedby')}</h3>
      {!saved ? (
        <p className="orq-hint">{t('lib.usedby.saveFirst')}</p>
      ) : (
        <>
          {users.length === 0 ? (
            <p className="orq-hint">{t('lib.usedby.none')}</p>
          ) : (
            <ul className="orq-assigned__chips">
              {users.map((a) => (
                <li key={a.id} className="orq-chip">
                  <span>{a.name}</span>
                  <button type="button" className="orq-chip__x" aria-label={t('lib.usedby.remove', { name: a.name })} title={t('lib.usedby.remove', { name: a.name })} onClick={() => void update(a, false)}>
                    <X size={14} strokeWidth={1.5} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {others.length > 0 && (
            <select
              aria-label={t('lib.usedby.add')}
              value=""
              onChange={(e) => {
                const a = others.find((x) => x.id === e.target.value);
                if (a) void update(a, true);
              }}
            >
              <option value="">{t('lib.usedby.add')}</option>
              {others.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
          <p className="orq-hint">{t('lib.usedby.hint')}</p>
        </>
      )}
      {error && (
        <p className="orq-field__error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export function DeleteConfirm({ title, detail, onConfirm, onCancel }: { title: string; detail: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="orq-confirm" role="alertdialog" aria-label={title}>
      <p>{title}</p>
      <p className="orq-hint">{detail}</p>
      <div className="orq-form__actions">
        <button type="button" className="orq-btn orq-btn--danger" onClick={onConfirm}>
          <Trash2 {...SZ} />
          {t('form.delete')}
        </button>
        <button type="button" className="orq-btn" onClick={onCancel}>
          {t('form.cancel')}
        </button>
      </div>
    </div>
  );
}

function AgentForm({ api, drafts, draftKey, original, agents, contexts, skills, mcp, justSaved, onSaved, onDeleted, onCreateOther, busy = false }: {
  busy?: boolean;
  mcp: McpView[];
  api: ProjectApi;
  drafts: DraftStore;
  draftKey: string;
  original: AgentDefinition | undefined;
  agents: AgentDefinition[];
  contexts: ContextDefinition[];
  skills: SkillDefinition[];
  justSaved: boolean;
  onSaved: (id: string) => void;
  onDeleted: () => void;
  /** Abre Conocimiento con un elemento nuevo o uno existente; el borrador del agente se conserva [R22.11][R32.34]. */
  onCreateOther: (tab: 'contexts' | 'skills' | 'mcp', id?: string) => void;
}) {
  const isNew = original === undefined;
  const [assign, setAssign] = useState<'contexts' | 'skills' | 'mcp'>();
  const base = original ?? newAgent('', '');
  const [draft, setDraft] = useDraftState<AgentDefinition>(drafts, draftKey, base);
  const baseTurns = original?.maxTurns !== undefined ? String(original.maxTurns) : '';
  const [turns, setTurns] = useDraftState<string>(drafts, `${draftKey}#turns`, baseTurns);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<string>();
  const [saved, setSaved] = useState(justSaved);
  const [where, setWhere] = useState<{ diagramId: string; name: string }[]>();
  const taken = useMemo(() => new Set(agents.map((a) => a.id)), [agents]);
  const id = isNew ? slugify(draft.name, taken, 'agente') : draft.id;
  const dirty = JSON.stringify(draft) !== JSON.stringify(base) || turns !== baseTurns;
  useEffect(() => {
    if (isNew) return;
    void api.agentUsage(base.id).then((r) => setWhere(r.ok ? r.value : []));
  }, [api, isNew, base.id]);
  /** Nivel del proyecto, para «El del proyecto (…)» [R47.12]. */
  const [projectLevel, setProjectLevel] = useState<ProjectPermission>(DEFAULT_PERMISSION);
  useEffect(() => {
    void api.getSettings().then((r) => r.ok && setProjectLevel(projectPermission(r.value)));
  }, [api]);
  const set = (patch: Partial<AgentDefinition>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setSaved(false);
  };
  /** Marcar o desmarcar algo del agente como obligatorio [R39.13]. */
  const toggleRequired = (k: 'skillIds' | 'contextIds' | 'mcpIds', x: string): Partial<AgentDefinition> => {
    const cur = draft.required?.[k] ?? [];
    const next = cur.includes(x) ? cur.filter((y) => y !== x) : [...cur, x];
    const req = { ...draft.required, [k]: next };
    if (next.length === 0) delete req[k];
    return { required: Object.keys(req).length > 0 ? req : undefined };
  };
  const withoutRequired = (k: 'skillIds' | 'contextIds' | 'mcpIds', x: string): Partial<AgentDefinition> => (draft.required?.[k]?.includes(x) ? toggleRequired(k, x) : {});
  const discard = () => {
    setDraft(base);
    setTurns(baseTurns);
    setErrors({});
  };

  const save = async () => {
    if (busy) return;
    const { maxTurns: _drop, ...rest } = draft;
    void _drop;
    const body: AgentDefinition = { ...rest, id, ...(turns.trim() !== '' ? { maxTurns: Number(turns) } : {}) };
    // un servidor de «Todos mis proyectos» borrado desde otro proyecto desaparece al guardar [R30.9]
    if (body.mcpIds) body.mcpIds = body.mcpIds.filter((x) => mcp.some((m) => m.id === x));
    const res = await api.saveAgent(body);
    if (!res.ok) return setErrors(fieldErrors(res.error));
    setErrors({});
    drafts.discard(draftKey);
    setSaved(true);
    onSaved(id);
  };
  const askDelete = async () => {
    const res = await api.agentUsage(draft.id);
    const names = res.ok ? res.value.map((u) => u.name) : [];
    setConfirm(names.length > 0 ? t('delete.agent.used', { names: names.join(', ') }) : t('delete.agent.unused'));
  };

  return (
    <form
      className="orq-editor"
      noValidate
      onKeyDown={saveKeys(() => void save())}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <EditorHead
        badge={draft.icon ? <AgentAvatar name={draft.name || '?'} icon={draft.icon} tone={draft.tone} size="lg" className="orq-lib__av--big" /> : <span className="orq-lib__av orq-lib__av--big">{initial(draft.name || '?')}</span>}
        name={draft.name}
        sub={MODELS.find((m) => m.id === draft.model)?.name}
        dirty={dirty}
        saved={saved && !dirty}
        isNew={isNew}
        onDiscard={discard}
        onDelete={() => void askDelete()}
        busy={busy}
      />
      {confirm !== undefined && (
        <DeleteConfirm
          title={t('delete.agent', { name: draft.name })}
          detail={confirm}
          onCancel={() => setConfirm(undefined)}
          onConfirm={() => void api.deleteAgent(draft.id).then(() => (drafts.discard(draftKey), onDeleted()))}
        />
      )}
      <div className="orq-editor__body orq-agentf">
        <div className="orq-editor__main">
          <section className="orq-mcpf__sec" aria-labelledby="agent-sec-who">
            <h3 id="agent-sec-who" className="orq-mcpf__h">
              <span className="orq-mcpf__n">1</span>
              {t('agent.sec.who')}
            </h3>
            <div className="orq-mcpf__grid">
              <Field label={t('agent.name')} id="agent-name" error={errors['name']}>
                <input id="agent-name" value={draft.name} aria-invalid={Boolean(errors['name'])} aria-describedby={errors['name'] ? 'agent-name-error' : undefined} onChange={(e) => set({ name: e.target.value })} autoFocus={isNew} />
              </Field>
              <Field label={t('agent.description')} id="agent-desc" error={errors['description']}>
                <input id="agent-desc" value={draft.description} placeholder={t('lib.purpose.hint')} onChange={(e) => set({ description: e.target.value })} />
              </Field>
            </div>
          </section>
          <section className="orq-mcpf__sec orq-agentf__instr" aria-labelledby="agent-sec-how">
            <h3 id="agent-sec-how" className="orq-mcpf__h">
              <span className="orq-mcpf__n">2</span>
              {t('agent.sec.how')}
            </h3>
              <MarkdownField
                id="agent-instr"
                label={t('agent.instructions')}
                value={draft.instructions}
                max={LIMITS.instructions}
                error={errors['instructions']}
                onChange={(v) => set({ instructions: v })}
                assist={{
                  api,
                  kind: 'agent',
                  field: 'instructions',
                  current: { name: draft.name, description: draft.description, instructions: draft.instructions, model: draft.model, contextIds: draft.contextIds, skillIds: draft.skillIds ?? [] },
                  names: { contexts: Object.fromEntries(contexts.map((c) => [c.id, c.name])), skills: Object.fromEntries(skills.map((k) => [k.id, k.name])) },
                  onApply: (f) => set(f as Partial<AgentDefinition>),
                }}
              />
          </section>
          <section className="orq-mcpf__sec" aria-labelledby="agent-sec-know">
            <h3 id="agent-sec-know" className="orq-mcpf__h">
              <span className="orq-mcpf__n">3</span>
              {t('agent.sec.know')}
            </h3>
            <p className="orq-hint">{t('agent.sec.know.hint')}</p>
            <div className="orq-agentf__know">
              <AssignedField
                legend={t('agent.skills')}
                icon={BookOpen}
                items={skills}
                selected={draft.skillIds ?? []}
                noneText={t('assign.none.skills')}
                addLabel={t('assign.add.skills')}
                error={errors['skillIds']}
                onOpen={() => setAssign('skills')}
                onRemove={(x) => set({ skillIds: (draft.skillIds ?? []).filter((y) => y !== x), ...withoutRequired('skillIds', x) })}
                requiredIds={draft.required?.skillIds ?? []}
                onToggleRequired={(x) => set(toggleRequired('skillIds', x))}
                onShow={(x) => onCreateOther('skills', x)}
              />
              <AssignedField
                legend={t('agent.contexts')}
                icon={FileText}
                items={contexts}
                selected={draft.contextIds}
                noneText={t('assign.none.contexts')}
                addLabel={t('assign.add.contexts')}
                error={errors['contextIds']}
                onOpen={() => setAssign('contexts')}
                onRemove={(x) => set({ contextIds: (draft.contextIds ?? []).filter((y) => y !== x), ...withoutRequired('contextIds', x) })}
                requiredIds={draft.required?.contextIds ?? []}
                onToggleRequired={(x) => set(toggleRequired('contextIds', x))}
                onShow={(x) => onCreateOther('contexts', x)}
              />
              <AssignedField
                legend={t('agent.mcp')}
                icon={Plug}
                items={mcp.map((m) => ({ id: m.id, name: m.enabled ? m.name : `${m.name} (${t('mcp.off').toLowerCase()})` }))}
                selected={draft.mcpIds ?? []}
                noneText={t('assign.none.mcp')}
                addLabel={t('assign.add.mcp')}
                error={errors['mcpIds']}
                onOpen={() => setAssign('mcp')}
                onRemove={(x) => set({ mcpIds: (draft.mcpIds ?? []).filter((y) => y !== x), ...withoutRequired('mcpIds', x) })}
                requiredIds={draft.required?.mcpIds ?? []}
                onToggleRequired={(x) => set(toggleRequired('mcpIds', x))}
                onShow={(x) => onCreateOther('mcp', x)}
              />
            </div>
          </section>
          {errors['_'] && (
            <p className="orq-field__error" role="alert">
              {errors['_']}
            </p>
          )}
        </div>
        <div className="orq-editor__side">
          <section className="orq-editor__side-sec orq-agentf__card" aria-label={t('agent.preview')}>
            <div className="orq-agentf__id">
              <AgentAvatar name={draft.name || '?'} icon={draft.icon} tone={draft.tone} size="lg" />
              <div>
                <strong>{draft.name || t('lib.untitled')}</strong>
                <span className="orq-hint">{draft.description || t('lib.noDesc')}</span>
              </div>
            </div>
            <div className="orq-agentf__facts">
              <span className="orq-tag">{MODELS.find((m) => m.id === draft.model)?.name ?? draft.model}</span>
              <span className="orq-tag">{t('agent.facts.know', { skills: (draft.skillIds ?? []).length, contexts: draft.contextIds.length, mcp: (draft.mcpIds ?? []).length })}</span>
              {draft.permissions && <span className="orq-tag">{t('agent.facts.permissions', { level: permissionName(draft.permissions) })}</span>}
              {draft.askFirst && (
                <span className="orq-tag orq-agentf__ask">
                  <AskFirstMark size={12} /> {t('askfirst.mark')}
                </span>
              )}
            </div>
            <IconPicker name={draft.name} icon={draft.icon} tone={draft.tone} onChange={(icon, tone) => set({ icon, tone })} />
          </section>
          <section className="orq-editor__side-sec" aria-label={t('agent.behaviour')}>
            <h3>{t('agent.behaviour')}</h3>
            <label className="orq-switch">
              <span className="orq-switch__label">
                <AskFirstMark />
                {t('agent.askFirst')}
              </span>
              <input type="checkbox" role="switch" checked={draft.askFirst === true} onChange={(e) => set(e.target.checked ? { askFirst: true } : { askFirst: undefined })} />
            </label>
            <p className="orq-hint">{t(draft.askFirst ? 'agent.askFirst.on' : 'agent.askFirst.off')}</p>
          </section>
          <section className="orq-editor__side-sec" aria-label={t('agent.permissions')}>
            <h3>{t('agent.permissions')}</h3>
            <PermissionPicker legend={t('agent.permissions.legend')} agent project={projectLevel} value={draft.permissions} onChange={(permissions) => set({ permissions })} />
          </section>
          <section className="orq-editor__side-sec">
            <Field label={t('agent.model')} id="agent-model" error={errors['model']}>
              <select id="agent-model" value={draft.model} onChange={(e) => set({ model: e.target.value })}>
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Field>
          </section>
          {!isNew && (
            <section className="orq-editor__side-sec" aria-label={t('lib.where')}>
              <h3>{t('lib.where')}</h3>
              {where && where.length === 0 ? <p className="orq-hint">{t('lib.where.none')}</p> : where?.map((w) => <p key={w.diagramId} className="orq-hint">{w.name}</p>)}
            </section>
          )}
          <details className="orq-editor__adv">
            <summary>{t('lib.advanced')}</summary>
            <p className="orq-hint orq-form__id">
              {t('agent.id')}: <code>{id}</code>
            </p>
            <Field label={t('agent.maxTurns')} id="agent-turns" error={errors['maxTurns']}>
              <input id="agent-turns" type="number" min={1} max={200} value={turns} onChange={(e) => (setTurns(e.target.value), setSaved(false))} />
            </Field>
          </details>
        </div>
      </div>
      {assign === 'contexts' && (
        <AssignPicker
          title={t('assign.title.contexts')}
          icon={FileText}
          items={contexts.map((c) => ({ id: c.id, name: c.name, description: t(`context.kind.${c.kind}` as MessageKey) }))}
          selected={draft.contextIds}
          emptyText={t('assign.empty.contexts')}
          createLabel={t('assign.create.contexts')}
          onCreate={() => (setAssign(undefined), onCreateOther('contexts'))}
          onApply={(ids) => (set({ contextIds: ids }), setAssign(undefined))}
          onClose={() => setAssign(undefined)}
        />
      )}
      {assign === 'mcp' && (
        <AssignPicker
          title={t('assign.title.mcp')}
          icon={Plug}
          items={mcp.map((m) => ({ id: m.id, name: m.name, description: m.enabled ? m.description : t('mcp.off') }))}
          selected={draft.mcpIds ?? []}
          emptyText={t('assign.empty.mcp')}
          createLabel={t('assign.create.mcp')}
          onCreate={() => (setAssign(undefined), onCreateOther('mcp'))}
          onApply={(ids) => (set({ mcpIds: ids }), setAssign(undefined))}
          onClose={() => setAssign(undefined)}
        />
      )}
      {assign === 'skills' && (
        <AssignPicker
          title={t('assign.title.skills')}
          icon={BookOpen}
          items={skills.map((k) => ({ id: k.id, name: k.name, description: k.description }))}
          selected={draft.skillIds ?? []}
          emptyText={t('assign.empty.skills')}
          createLabel={t('assign.create.skills')}
          onCreate={() => (setAssign(undefined), onCreateOther('skills'))}
          onApply={(ids) => (set({ skillIds: ids }), setAssign(undefined))}
          onClose={() => setAssign(undefined)}
        />
      )}
    </form>
  );
}

function ContextForm({ api, drafts, draftKey, original, contexts, agents, justSaved, onSaved, onDeleted, onAgentsChanged, busy = false, autoPick = false }: {
  busy?: boolean;
  /** Abre el diálogo de archivos al mostrarse (desde «Elegir archivos» de la bienvenida) [R38.20]. */
  autoPick?: boolean;
  api: ProjectApi;
  drafts: DraftStore;
  draftKey: string;
  original: ContextDefinition | undefined;
  contexts: ContextDefinition[];
  agents: AgentDefinition[];
  justSaved: boolean;
  onSaved: (id: string) => void;
  onDeleted: () => void;
  onAgentsChanged: () => void;
}) {
  const isNew = original === undefined;
  const base = original ?? newContext('', '');
  const [draft, setDraft] = useDraftState<ContextDefinition>(drafts, draftKey, base);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<string>();
  const [saved, setSaved] = useState(justSaved);
  const taken = useMemo(() => new Set(contexts.map((c) => c.id)), [contexts]);
  const id = isNew ? slugify(draft.name, taken, 'contexto') : draft.id;
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  const set = (patch: Partial<ContextDefinition>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setSaved(false);
  };
  const save = async () => {
    if (busy) return;
    const res = await api.saveContext({ ...draft, id });
    if (!res.ok) return setErrors(fieldErrors(res.error));
    setErrors({});
    drafts.discard(draftKey);
    setSaved(true);
    onSaved(id);
  };
  const askDelete = async () => {
    const res = await api.contextUsage(draft.id);
    const names = res.ok ? res.value.map((u) => u.name) : [];
    setConfirm(names.length > 0 ? t('delete.context.used', { names: names.join(', ') }) : t('delete.context.unused'));
  };
  const valueLabel = t(`context.value.${draft.kind}` as MessageKey);
  const [pickMsg, setPickMsg] = useState<string>();
  /** Los caminos para empezar están ahora en la bienvenida de «Nuevo contexto» [R38.20]. */
  const start = 'write' as 'write' | 'claude';
  /** Copia lo elegido en el diálogo del sistema dentro del proyecto; la interfaz no ve rutas del disco [R22.14]. */
  const pick = async (kind: 'files' | 'folder') => {
    setPickMsg(undefined);
    const res = await api.addContextFiles({ id, kind });
    if (!res.ok) return setErrors((e) => ({ ...e, value: res.error.message }));
    if (res.value === null) return;
    const v = res.value;
    setErrors((e) => {
      const { value: _v, ...rest } = e;
      void _v;
      return rest;
    });
    set({ value: v.value });
    const extra = [v.renamed > 0 ? t('context.pick.renamed', { n: v.renamed }) : '', v.scripts.length > 0 ? t('context.pick.scripts', { n: v.scripts.length }) : ''].filter(Boolean).join(' ');
    setPickMsg(`${t('context.pick.done', { files: v.files, kb: Math.max(1, Math.round(v.bytes / 1024)) })} ${extra}`.trim());
  };  useEffect(() => {
    if (autoPick) void pick('files');
  }, []);


  return (
    <form
      className="orq-editor"
      noValidate
      onKeyDown={saveKeys(() => void save())}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <EditorHead badge={<span className="orq-lib__tag orq-lib__tag--big">{KIND_TAG[draft.kind]}</span>} name={draft.name} sub={t(`context.kind.${draft.kind}` as MessageKey)} dirty={dirty} saved={saved && !dirty} isNew={isNew} onDiscard={() => (setDraft(base), setErrors({}))} onDelete={() => void askDelete()} busy={busy} />
      {confirm !== undefined && (
        <DeleteConfirm
          title={t('delete.context', { name: draft.name })}
          detail={confirm}
          onCancel={() => setConfirm(undefined)}
          onConfirm={() => void api.deleteContext(draft.id).then(() => (drafts.discard(draftKey), onDeleted()))}
        />
      )}
      <div className="orq-editor__body">
        <div className="orq-editor__main">
          <Field label={t('context.name')} id="ctx-name" error={errors['name']}>
            <input id="ctx-name" value={draft.name} aria-invalid={Boolean(errors['name'])} onChange={(e) => set({ name: e.target.value })} autoFocus={isNew} />
          </Field>
          <Field label={t('context.kind')} id="ctx-kind" error={errors['kind']}>
            <select id="ctx-kind" value={draft.kind} onChange={(e) => set({ kind: e.target.value as ContextKind, value: '' })}>
              {(['text', 'url', 'file'] as const).map((k) => (
                <option key={k} value={k}>
                  {t(`context.kind.${k}` as MessageKey)}
                </option>
              ))}
            </select>
          </Field>
          {draft.kind === 'text' ? (
            <MarkdownField
              id="ctx-value"
              label={valueLabel}
              value={draft.value}
              max={LIMITS.contextText}
              error={errors['value']}
              onChange={(v) => set({ value: v })}
              openAssist={start === 'claude'}
              assist={{ api, kind: 'context', field: 'value', current: { name: draft.name, value: draft.value }, names: { contexts: {}, skills: {} }, onApply: (f) => set(f as Partial<ContextDefinition>) }}
            />
          ) : (
            <Field label={valueLabel} id="ctx-value" error={errors['value']}>
              {draft.kind === 'file' && (
                <div className="orq-md__bar">
                  <button type="button" className="orq-btn orq-btn--small" onClick={() => void pick('files')}>
                    <FilePlus2 {...SZ} />
                    {t('context.pick.files')}
                  </button>
                  <button type="button" className="orq-btn orq-btn--small" onClick={() => void pick('folder')}>
                    <FolderOpen {...SZ} />
                    {t('context.pick.folder')}
                  </button>
                </div>
              )}
              <input id="ctx-value" value={draft.value} aria-invalid={Boolean(errors['value'])} onChange={(e) => set({ value: e.target.value })} />
              {draft.kind === 'file' && (
                <p className="orq-hint" role={pickMsg ? 'status' : undefined}>
                  {pickMsg ?? t('context.pick.hint')}
                </p>
              )}
            </Field>
          )}
          {errors['_'] && (
            <p className="orq-field__error" role="alert">
              {errors['_']}
            </p>
          )}
          {draft.kind === 'url' && (
            <p className="orq-hint">
              <Link2 size={12} aria-hidden="true" /> {t('context.kind.url')}
            </p>
          )}
        </div>
        <div className="orq-editor__side">
          <UsedBy api={api} kind="contexts" id={draft.id} saved={!isNew} agents={agents} onChanged={onAgentsChanged} />
          <section className="orq-insp__sec orq-deliver" aria-label={t('ctx.deliver')}>
            <span className="orq-insp__label">{t('ctx.deliver')}</span>
            <p className="orq-hint">{t(`ctx.deliver.${draft.kind}` as MessageKey)}</p>
          </section>
        </div>
      </div>
    </form>
  );
}

function SkillForm({ api, drafts, draftKey, original, skills, agents, justSaved, onSaved, onDeleted, onAgentsChanged, busy = false }: {
  busy?: boolean;
  api: ProjectApi;
  drafts: DraftStore;
  draftKey: string;
  original: SkillDefinition | undefined;
  skills: SkillDefinition[];
  agents: AgentDefinition[];
  justSaved: boolean;
  onSaved: (id: string) => void;
  onDeleted: () => void;
  onAgentsChanged: () => void;
}) {
  const isNew = original === undefined;
  const base = original ?? newSkill('', '');
  const [draft, setDraft] = useDraftState<SkillDefinition>(drafts, draftKey, base);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<string>();
  const [saved, setSaved] = useState(justSaved);
  const taken = useMemo(() => new Set(skills.map((k) => k.id)), [skills]);
  const id = isNew ? slugify(draft.name, taken, 'skill') : draft.id;
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  const set = (patch: Partial<SkillDefinition>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setSaved(false);
  };

  const save = async () => {
    if (busy) return;
    const res = await api.saveSkill({ ...draft, id });
    if (!res.ok) return setErrors(fieldErrors(res.error));
    setErrors({});
    drafts.discard(draftKey);
    setSaved(true);
    onSaved(id);
  };
  const askDelete = async () => {
    const res = await api.skillUsage(draft.id);
    const names = res.ok ? res.value.map((u) => u.name) : [];
    setConfirm(names.length > 0 ? t('delete.skill.used', { names: names.join(', ') }) : t('delete.skill.unused'));
  };

  return (
    <form
      className="orq-editor"
      noValidate
      onKeyDown={saveKeys(() => void save())}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <EditorHead badge={<span className="orq-lib__av orq-lib__av--big"><BookOpen {...SZ} /></span>} name={draft.name} sub="SKILL.md" dirty={dirty} saved={saved && !dirty} isNew={isNew} onDiscard={() => (setDraft(base), setErrors({}))} onDelete={() => void askDelete()} busy={busy} />
      {confirm !== undefined && (
        <DeleteConfirm
          title={t('delete.skill', { name: draft.name })}
          detail={confirm}
          onCancel={() => setConfirm(undefined)}
          onConfirm={() => void api.deleteSkill(draft.id).then(() => (drafts.discard(draftKey), onDeleted()))}
        />
      )}
      <div className="orq-editor__body">
        <div className="orq-editor__main">
          <Field label={t('skill.name')} id="skill-name" error={errors['name']}>
            <input id="skill-name" value={draft.name} aria-invalid={Boolean(errors['name'])} onChange={(e) => set({ name: e.target.value })} autoFocus={isNew} />
          </Field>
          <Field label={t('skill.description')} id="skill-desc" error={errors['description']}>
            <input id="skill-desc" value={draft.description} aria-invalid={Boolean(errors['description'])} onChange={(e) => set({ description: e.target.value })} />
          </Field>
          <MarkdownField
            id="skill-body"
            label={t('skill.body')}
            value={draft.body}
            max={SKILL_LIMITS.body}
            error={errors['body']}
            onChange={(v) => set({ body: v })}
            assist={{ api, kind: 'skill', field: 'body', current: { name: draft.name, description: draft.description, body: draft.body }, names: { contexts: {}, skills: {} }, onApply: (f) => set(f as Partial<SkillDefinition>) }}
          />
          {errors['_'] && (
            <p className="orq-field__error" role="alert">
              {errors['_']}
            </p>
          )}
        </div>
        <div className="orq-editor__side">
          <SkillRefs api={api} id={draft.id} saved={!isNew} />
          <UsedBy api={api} kind="skills" id={draft.id} saved={!isNew} agents={agents} onChanged={onAgentsChanged} />
          <details className="orq-editor__adv">
            <summary>{t('lib.advanced')}</summary>
            <p className="orq-hint orq-form__id">
              {t('skill.id')}: <code>{id}</code>
            </p>
          </details>
        </div>
      </div>
    </form>
  );
}

type RefFile = { path: string; size: number };

/** Archivos de referencia de una skill: añadir, ver, copiar la ruta y quitar [R24.9–R24.12]. */
function SkillRefs({ api, id, saved }: { api: ProjectApi; id: string; saved: boolean }) {
  const [files, setFiles] = useState<RefFile[]>([]);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [asking, setAsking] = useState<string>();
  const [view, setView] = useState<{ path: string; text: string; truncated: boolean }>();
  /** Edición de un archivo de texto: el que se ve o uno nuevo [R32.35]. */
  const [edit, setEdit] = useState<{ path: string; text: string; isNew: boolean }>();
  const [newName, setNewName] = useState<string>();
  const reload = useCallback(async () => {
    const r = await api.skillFiles(id);
    if (r.ok) setFiles(r.value);
  }, [api, id]);
  useEffect(() => {
    if (saved) void reload();
  }, [saved, reload]);

  const add = async (kind: 'files' | 'folder') => {
    setError(undefined);
    setNotice(undefined);
    const res = await api.addSkillFiles({ id, kind });
    if (!res.ok) return setError(res.error.message);
    if (!res.value) return;
    setNotice(
      [t('skill.refs.added', { count: res.value.added.length }), res.value.renamed > 0 ? t('skill.refs.renamed', { count: res.value.renamed }) : '']
        .filter(Boolean)
        .join('. '),
    );
    await reload();
  };
  const show = async (path: string) => {
    setError(undefined);
    const res = await api.readSkillFile({ id, path });
    if (!res.ok) return setError(res.error.message);
    setView({ path, ...res.value });
  };
  const saveText = async () => {
    if (!edit) return;
    setError(undefined);
    const path = edit.path.trim();
    const res = await api.saveSkillFile({ id, path, text: edit.text });
    if (!res.ok) return setError(res.error.message);
    setEdit(undefined);
    setView({ path, text: edit.text, truncated: false });
    setNotice(t('skill.refs.saved', { path }));
    await reload();
  };
  const startNew = () => {
    const name = (newName ?? '').trim().replace(/\\/g, '/');
    if (name === '') return;
    const path = name.includes('/') ? name : `referencias/${name.includes('.') ? name : `${name}.md`}`;
    if (files.some((f) => f.path === path)) return setError(t('skill.refs.exists', { path }));
    setNewName(undefined);
    setView(undefined);
    setEdit({ path, text: '', isNew: true });
  };
  const copy = async (path: string) => {
    try {
      await navigator.clipboard?.writeText(path);
    } catch {
      /* sin portapapeles: el aviso sigue mostrando la ruta */
    }
    setNotice(t('skill.refs.copied', { path }));
  };
  const remove = async (path: string) => {
    setAsking(undefined);
    const res = await api.removeSkillFile({ id, path });
    if (!res.ok) return setError(res.error.message);
    if (view?.path === path) setView(undefined);
    await reload();
  };

  return (
    <fieldset className="orq-field orq-refs">
      <legend>{t('skill.refs')}</legend>
      {!saved ? (
        <p className="orq-hint">{t('skill.refs.save.first')}</p>
      ) : (
        <>
          <div className="orq-form__actions">
            <button type="button" className="orq-btn" onClick={() => void add('files')}>
              <FilePlus2 {...SZ} />
              {t('skill.refs.add.files')}
            </button>
            <button type="button" className="orq-btn" onClick={() => void add('folder')}>
              <FolderPlus {...SZ} />
              {t('skill.refs.add.folder')}
            </button>
            <button type="button" className="orq-btn" onClick={() => setNewName('')}>
              <FileText {...SZ} />
              {t('skill.refs.new')}
            </button>
          </div>
          {newName !== undefined && (
            <div className="orq-refs__new">
              <label htmlFor={`skill-new-file-${id}`}>{t('skill.refs.new.name')}</label>
              <input
                id={`skill-new-file-${id}`}
                value={newName}
                placeholder="guia-de-estilo.md"
                autoFocus
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    startNew();
                  } else if (e.key === 'Escape') setNewName(undefined);
                }}
              />
              <button type="button" className="orq-btn orq-btn--small orq-btn--primary" onClick={startNew}>
                {t('skill.refs.new.create')}
              </button>
              <button type="button" className="orq-btn orq-btn--small" onClick={() => setNewName(undefined)}>
                {t('form.cancel')}
              </button>
            </div>
          )}
          {files.length === 0 ? (
            <p className="orq-hint">{t('skill.refs.none')}</p>
          ) : (
            <ul className="orq-files">
              {files.map((f) => (
                <li key={f.path}>
                  <code>{f.path}</code>
                  {isScriptPath(f.path) && (
                    <span className="orq-files__script" title={t('skill.refs.script')}>
                      <AlertTriangle size={14} strokeWidth={1.5} aria-hidden="true" />
                      {t('skill.refs.script')}
                    </span>
                  )}
                  <span>{f.size} B</span>
                  {asking === f.path ? (
                    <span className="orq-files__ask" role="alertdialog" aria-label={t('skill.refs.remove.ask', { path: f.path })}>
                      {t('skill.refs.remove.ask', { path: f.path })}
                      <button type="button" className="orq-btn orq-btn--danger" onClick={() => void remove(f.path)}>
                        {t('skill.refs.remove.yes')}
                      </button>
                      <button type="button" className="orq-btn" onClick={() => setAsking(undefined)}>
                        {t('form.cancel')}
                      </button>
                    </span>
                  ) : (
                    <span className="orq-files__acts">
                      <button type="button" className="orq-icon-btn" aria-label={t('skill.refs.view', { path: f.path })} title={t('skill.refs.view', { path: f.path })} onClick={() => void show(f.path)}>
                        <Eye {...SZ} />
                      </button>
                      <button type="button" className="orq-icon-btn" aria-label={t('skill.refs.copy', { path: f.path })} title={t('skill.refs.copy', { path: f.path })} onClick={() => void copy(f.path)}>
                        <Copy {...SZ} />
                      </button>
                      <button type="button" className="orq-icon-btn" aria-label={t('skill.refs.remove', { path: f.path })} title={t('skill.refs.remove', { path: f.path })} onClick={() => setAsking(f.path)}>
                        <Trash2 {...SZ} />
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="orq-hint">{t('skill.refs.hint')}</p>
          {notice && (
            <p className="orq-hint" role="status">
              {notice}
            </p>
          )}
          {error && (
            <p className="orq-field__error" role="alert">
              {error}
            </p>
          )}
          {view && (
            <div className="orq-viewer">
              <div className="orq-viewer__head">
                <code>{view.path}</code>
                <button type="button" className="orq-icon-btn" aria-label={t('skill.refs.viewer.close')} title={t('skill.refs.viewer.close')} onClick={() => setView(undefined)}>
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
              <pre>{view.text}</pre>
              {view.truncated ? (
                <p className="orq-hint">{t('skill.refs.truncated')}</p>
              ) : (
                <button type="button" className="orq-btn orq-btn--small" onClick={() => setEdit({ path: view.path, text: view.text, isNew: false })}>
                  {t('skill.refs.edit')}
                </button>
              )}
            </div>
          )}
          {edit && (
            <div className="orq-viewer orq-viewer--edit">
              <div className="orq-viewer__head">
                <code>{edit.path}</code>
                {edit.isNew && <span className="orq-tag is-new">{t('runs.changes.new')}</span>}
              </div>
              <textarea
                aria-label={t('skill.refs.editing', { path: edit.path })}
                rows={14}
                value={edit.text}
                maxLength={200_000}
                autoFocus
                onChange={(e) => setEdit({ ...edit, text: e.target.value })}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                    e.preventDefault();
                    e.stopPropagation();
                    void saveText();
                  }
                }}
              />
              <div className="orq-form__actions">
                <button type="button" className="orq-btn orq-btn--primary" onClick={() => void saveText()}>
                  {t('skill.refs.save')}
                </button>
                <button type="button" className="orq-btn" onClick={() => setEdit(undefined)}>
                  {t('form.cancel')}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </fieldset>
  );
}

/** Elegir el icono y el tono del agente; sin icono se usa la inicial [R39.8]. */
function IconPicker({ name, icon, tone, onChange }: { name: string; icon: AgentIcon | undefined; tone: AgentTone | undefined; onChange: (icon: AgentIcon | undefined, tone: AgentTone | undefined) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="orq-iconpick" role="group" aria-label={t('agent.look')}>
      <button type="button" className="orq-btn orq-btn--small orq-btn--ghost orq-iconpick__toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? t('agent.look.done') : t('agent.look.change')}
      </button>
      {open && (
        <>
          <div className="orq-iconpick__grid" role="radiogroup" aria-label={t('agent.look')}>
            <button type="button" role="radio" aria-checked={icon === undefined} className="orq-iconpick__opt" aria-label={t('agent.look.none')} title={t('agent.look.none')} onClick={() => onChange(undefined, tone)}>
              <AgentAvatar name={name || '?'} tone={tone} size="sm" />
            </button>
            {AGENT_ICONS.map((id) => {
              const Icon = AGENT_ICON_COMPONENT[id];
              const label = t(`icon.${id}` as MessageKey);
              return (
                <button key={id} type="button" role="radio" aria-checked={icon === id} className="orq-iconpick__opt" aria-label={t('agent.look.icon', { name: label })} title={label} onClick={() => onChange(id, tone)}>
                  <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
                </button>
              );
            })}
          </div>
          <div className="orq-iconpick__tones" role="radiogroup" aria-label={t('agent.look.tone', { name: '' }).trim()}>
            {AGENT_TONES.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={(tone ?? 'neutral') === k} className={`orq-iconpick__tone is-${k}`} aria-label={t('agent.look.tone', { name: t(`tone.${k}` as MessageKey) })} title={t(`tone.${k}` as MessageKey)} onClick={() => onChange(icon, k === 'neutral' ? undefined : k)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
