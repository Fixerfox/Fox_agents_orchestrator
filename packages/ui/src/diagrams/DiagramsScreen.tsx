import { useCallback, useEffect, useState } from 'react';
import { FolderPlus, MoreHorizontal, Plus, Search, Workflow } from 'lucide-react';
import { emptyLibraryFolders, type LibraryFolders } from '@orquestador/core';
import { t, type ProjectApi } from '@orquestador/editor';
import { ContextMenu, type MenuItem } from '../common/index';
import { LibraryList, type LibRow } from '../common/index';
import { HandMark } from '../common/index';

/**
 * Sección «Diagramas»: todos los diagramas del proyecto en carpetas, aparte del Diseñador. Pulsar uno lo abre en el
 * Diseñador; las carpetas se gestionan como en la biblioteca [R38.22].
 */
export function DiagramsScreen({
  api,
  diagrams,
  currentId,
  runningIds = [],
  askingIds = [],
  onOpen,
  onNew,
  menu,
  locked = false,
}: {
  api: ProjectApi;
  diagrams: { id: string; name: string }[];
  currentId: string | undefined;
  runningIds?: string[];
  /** Diagramas con un agente esperando tu respuesta [R39.6]. */
  askingIds?: string[];
  onOpen: (id: string) => void;
  onNew: () => void;
  /** Acciones del diagrama (abrir, renombrar, duplicar, eliminar), las mismas que en el Diseñador [R33.8]. */
  menu: (id: string) => MenuItem[];
  locked?: boolean;
}) {
  const [folders, setFolders] = useState<LibraryFolders>(emptyLibraryFolders);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<{ x: number; y: number; id: string }>();
  const load = useCallback(async () => {
    const r = await api.getLibraryFolders();
    if (r.ok) setFolders(r.value);
  }, [api]);
  useEffect(() => void load(), [load]);
  const change = async (fn: (f: LibraryFolders) => LibraryFolders): Promise<string | undefined> => {
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
  const state = (id: string) => [id === currentId ? t('dlib.current') : '', runningIds.includes(id) ? t('pal.diagram.running') : ''].filter(Boolean).join(' · ');
  const rows: LibRow[] = diagrams.map((d) => ({
    id: d.id,
    name: d.name,
    tag: (
      <span className={`orq-lib2__ic${runningIds.includes(d.id) ? ' is-mcp' : ''}`}>
        <Workflow size={14} strokeWidth={1.5} aria-hidden="true" />
      </span>
    ),
    meta: askingIds.includes(d.id) ? (
      <>
        <HandMark size={12} label={t('hand.diagram')} /> {state(d.id)}
      </>
    ) : (
      state(d.id)
    ),
  }));
  const groups = new Map<string, LibRow[]>();
  for (const r of rows) {
    const top = (folders.kinds.diagrams.items[r.id] ?? '').split('/')[0] ?? '';
    groups.set(top, [...(groups.get(top) ?? []), r]);
  }
  const order = [...groups.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'es')));

  return (
    <section className="orq-page orq-lib orq-lib2" aria-label={t('dlib.title')}>
      <aside className="orq-lib__list">
        <div className="orq-lib__head">
          <h1>{t('dlib.title')}</h1>
          <button type="button" className="orq-ib" aria-label={t('lib.folder.new')} title={t('lib.folder.new')} onClick={() => setCreating(true)}>
            <FolderPlus size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
          <button type="button" className="orq-btn orq-btn--small orq-btn--primary" aria-label={t('dlib.new')} disabled={locked} onClick={onNew}>
            <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
            {t('lib.new').replace(/^\+ /, '')}
          </button>
        </div>
        <p className="orq-lib2__tabsub">{t('dlib.sub')}</p>
        <label className="orq-pal__search">
          <Search size={16} strokeWidth={1.5} aria-hidden="true" />
          <input type="search" value={q} placeholder={t('lib.search')} aria-label={t('lib.search')} onChange={(e) => setQ(e.target.value)} />
        </label>
        {diagrams.length === 0 && <p className="orq-hint">{t('dlib.empty')}</p>}
        <LibraryList kind="diagrams" rows={rows} folders={folders.kinds.diagrams} query={q} selected={currentId} onSelect={onOpen} onFolders={change} creating={creating} onCreatingDone={() => setCreating(false)} label={t('dlib.title')} />
      </aside>
      <div className="orq-lib__editor">
        <section className="orq-libov" aria-label={t('dlib.overview', { count: diagrams.length })}>
          <header className="orq-libov__head">
            <div>
              <h2>{t('dlib.title')}</h2>
              <p>{t('dlib.sub')}</p>
            </div>
          </header>
          {order.map((g) => (
            <section key={g || '__root'} className="orq-libov__group" aria-label={g || t('lib.folder.root')}>
              <h3>
                {g || t('lib.folder.root')}
                <em>{groups.get(g)!.length}</em>
              </h3>
              <ul className="orq-libov__grid">
                {groups.get(g)!.map((r) => (
                  <li key={r.id} className="orq-dlib__cell">
                    <button type="button" className={`orq-libov__card${r.id === currentId ? ' is-current' : ''}`} aria-label={t('dlib.open', { name: r.name })} onClick={() => onOpen(r.id)}>
                      <span className="orq-libov__cardhead">
                        {r.tag}
                        <strong>{r.name}</strong>
                        {askingIds.includes(r.id) && <HandMark size={14} label={t('hand.diagram')} />}
                      </span>
                      <span className="orq-hint">{r.meta || ' '}</span>
                      {(folders.kinds.diagrams.items[r.id] ?? '').includes('/') && <span className="orq-libov__path">{folders.kinds.diagrams.items[r.id]!.split('/').join(' › ')}</span>}
                    </button>
                    <button
                      type="button"
                      className="orq-ib orq-dlib__more"
                      aria-label={t('dlib.more', { name: r.name })}
                      onClick={(e) => {
                        const b = e.currentTarget.getBoundingClientRect();
                        setOpen({ x: b.left, y: b.bottom, id: r.id });
                      }}
                    >
                      <MoreHorizontal size={16} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </section>
      </div>
      {open && <ContextMenu x={open.x} y={open.y} items={menu(open.id)} onClose={() => setOpen(undefined)} />}
    </section>
  );
}
