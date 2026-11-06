import { useState } from 'react';
import { Folder, Plus, Sparkles } from 'lucide-react';
import type { KindFolders } from '@orquestador/core';
import { t, type MessageKey } from '@orquestador/editor';
import type { LibRow } from '../common/index';

type Filter = 'all' | 'unused' | 'noDesc' | 'off';

/**
 * Portada de una pestaña de la biblioteca cuando no hay nada abierto: cuántos hay, filtros rápidos, tarjetas por
 * carpeta y acciones (nuevo, instalar, pedírselo al asistente, Spec Kit) [R38.17].
 */
export function LibraryOverview({
  tab,
  rows,
  folders,
  onOpen,
  onNew,
  onAsk,
  isUnused,
  isOff,
  specKit,
}: {
  tab: 'agents' | 'contexts' | 'skills' | 'mcp';
  rows: LibRow[];
  folders: KindFolders;
  onOpen: (id: string) => void;
  onNew: () => void;
  onAsk?: (text: string) => void;
  isUnused: (id: string) => boolean;
  isOff: (id: string) => boolean;
  specKit?: { state: string; onAdd: () => void };
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [ask, setAsk] = useState('');
  const tabName = t(`agents.tab.${tab}` as MessageKey);
  const filters: Filter[] = ['all', 'unused', ...(tab === 'contexts' ? [] : (['noDesc'] as const)), ...(tab === 'mcp' ? (['off'] as const) : [])];
  const pass = (r: LibRow) => (filter === 'all' ? true : filter === 'unused' ? isUnused(r.id) : filter === 'off' ? isOff(r.id) : !r.description);
  const shown = rows.filter(pass);
  // Agrupadas por carpeta de primer nivel, como en la lista.
  const groups = new Map<string, LibRow[]>();
  for (const r of shown) {
    const top = (folders.items[r.id] ?? '').split('/')[0] ?? '';
    groups.set(top, [...(groups.get(top) ?? []), r]);
  }
  const order = [...groups.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'es')));
  const askPrefix = tab === 'mcp' ? '' : t(`lib.overview.ask.${tab}` as MessageKey);

  return (
    <section className="orq-libov" aria-label={t('lib.overview.title', { count: rows.length, tab: tabName })}>
      <header className="orq-libov__head">
        <div>
          <h2>{tabName}</h2>
          <p>{t(`lib.k.${tab}.sub` as MessageKey)}</p>
        </div>
        <div className="orq-libov__actions">
          <button type="button" className="orq-btn orq-btn--small orq-btn--primary" onClick={onNew}>
            <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
            {t('lib.new').replace(/^\+ /, '')}
          </button>
        </div>
      </header>
      {onAsk && (
        <form
          className="orq-libov__ask"
          onSubmit={(e) => {
            e.preventDefault();
            if (tab === 'mcp') return onAsk('');
            if (ask.trim()) onAsk(`${askPrefix}${ask.trim()}`);
          }}
        >
          <Sparkles size={15} strokeWidth={1.5} aria-hidden="true" />
          {tab === 'mcp' ? (
            <span className="orq-libov__askmcp">{t('mcp.welcome.title')}</span>
          ) : (
            <>
              <span className="orq-libov__prefix">{askPrefix}</span>
              <input aria-label={t('lib.overview.ask')} value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="…" />
            </>
          )}
          <button type="submit" className="orq-btn orq-btn--small orq-btn--accent" disabled={tab !== 'mcp' && ask.trim() === ''}>
            {t('lib.overview.ask')}
          </button>
        </form>
      )}
      {specKit && (
        <div className="orq-libov__speckit" role="group" aria-label={t('speckit.title')}>
          <div>
            <strong>{t('speckit.title')}</strong>
            <p>{t('speckit.sub')}</p>
            <small>{t('speckit.license')}</small>
          </div>
          <button type="button" className="orq-btn orq-btn--small" disabled={specKit.state === 'busy'} onClick={specKit.onAdd}>
            {specKit.state === 'busy' ? t('speckit.installing') : t('speckit.install')}
          </button>
          {specKit.state !== 'idle' && specKit.state !== 'busy' && (
            <p className="orq-hint" role="status">
              {specKit.state}
            </p>
          )}
        </div>
      )}
      {rows.length > 0 && (
        <div className="orq-libov__filters" role="radiogroup" aria-label={t('lib.search')}>
          {filters.map((f) => (
            <label key={f} className={`orq-pick${filter === f ? ' is-on' : ''}`}>
              <input type="radio" name={`libov-${tab}`} checked={filter === f} onChange={() => setFilter(f)} />
              {t(f === 'all' ? 'lib.overview.recent' : f === 'unused' ? 'lib.overview.unused' : f === 'off' ? 'lib.overview.off' : 'lib.overview.noDesc')}
              <em>{rows.filter((r) => (f === 'all' ? true : f === 'unused' ? isUnused(r.id) : f === 'off' ? isOff(r.id) : !r.description)).length}</em>
            </label>
          ))}
        </div>
      )}
      {rows.length === 0 ? (
        <div className="orq-libov__empty">
          <strong>{t('lib.overview.empty.title')}</strong>
          <p>{t('lib.overview.pick')}</p>
        </div>
      ) : (
        order.map((g) => (
          <section key={g || '__root'} className="orq-libov__group" aria-label={g || t('lib.folder.root')}>
            <h3>
              {g ? <Folder size={14} strokeWidth={1.5} aria-hidden="true" /> : null}
              {g || t('lib.folder.root')}
              <em>{groups.get(g)!.length}</em>
            </h3>
            <ul className="orq-libov__grid">
              {groups.get(g)!.map((r) => (
                <li key={r.id}>
                  <button type="button" className="orq-libov__card" onClick={() => onOpen(r.id)}>
                    <span className="orq-libov__cardhead">
                      {r.tag}
                      <strong>{r.name}</strong>
                    </span>
                    <span className={`orq-libov__desc${r.description ? '' : ' is-missing'}`}>{r.description ?? (tab === 'contexts' ? '' : t('lib.overview.noDesc'))}</span>
                    {(folders.items[r.id] ?? '').includes('/') && <span className="orq-libov__path">{folders.items[r.id]!.split('/').join(' › ')}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </section>
  );
}
