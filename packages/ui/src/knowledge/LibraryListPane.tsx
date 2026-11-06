import type { Dispatch, SetStateAction } from 'react';
import { BookOpen, FileText, FolderPlus, PackagePlus, Plug, Plus, Search, Bot } from 'lucide-react';
import type { KindFolders, LibraryFolders, LibraryKind } from '@orquestador/core';
import { t, type MessageKey } from '@orquestador/editor';
import { LibraryList, type DraftStore, type LibRow, type LibraryTab } from '../common';
import { NEW, SZ } from './editorParts';

interface Props {
  title: string;
  section: 'agents' | 'knowledge';
  tab: LibraryTab;
  kind: LibraryKind;
  drafts: DraftStore;
  rows: LibRow[];
  itemCount: number;
  counts: { contexts: number; skills: number; mcp: number };
  folders: KindFolders;
  loadError: string | undefined;
  sel: string | undefined;
  setSel: (id: string | undefined) => void;
  setSavedId: (id: string | undefined) => void;
  setManual: (manual: boolean) => void;
  setInstalling: (open: boolean) => void;
  switchTab: (tab: LibraryTab) => void;
  onFolders: (fn: (f: LibraryFolders) => LibraryFolders) => Promise<string | undefined>;
  q: string;
  setQ: Dispatch<SetStateAction<string>>;
  newFolder: boolean;
  setNewFolder: (creating: boolean) => void;
}

const TAB_ICON = { agents: Bot, contexts: FileText, skills: BookOpen, mcp: Plug } as const;

/** Columna izquierda de Agentes y Conocimiento: pestañas, buscador y lista con carpetas [R32.13][R38.14]. */
export function LibraryListPane({ title, section, tab, kind, drafts, rows, itemCount, counts, folders, loadError, sel, setSel, setSavedId, setManual, setInstalling, switchTab, onFolders, q, setQ, newFolder, setNewFolder }: Props) {
  return (
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
                <em>{counts[k]}</em>
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
      {itemCount === 0 && !newFolder && folders.folders.length === 0 && <p className="orq-hint">{t(tab === 'agents' ? 'agents.empty' : tab === 'contexts' ? 'contexts.empty' : tab === 'skills' ? 'skills.empty' : 'mcp.empty')}</p>}
      <LibraryList
        key={tab}
        kind={kind}
        rows={rows}
        folders={folders}
        query={q}
        selected={sel}
        onSelect={(id) => (setSavedId(undefined), setSel(id))}
        onFolders={onFolders}
        creating={newFolder}
        onCreatingDone={() => setNewFolder(false)}
        label={t(`agents.tab.${tab}` as MessageKey)}
      />
    </aside>
  );
}
