import { useCallback, useEffect, useState } from 'react';
import { MEMORY_KINDS, MEMORY_WARN_ACTIVE, staleReason, type MemoryEntry, type MemoryKind } from '@orquestador/core';
import { t, type MessageKey, type ProjectApi } from '@orquestador/editor';

const scopeName = (s: string) => (s === 'project' ? t('pmem.scope.project') : s.startsWith('agent:') ? t('pmem.scope.agent', { id: s.slice(6) }) : t('pmem.scope.diagram', { id: s.slice(8) }));

function Editor({ entry, onSave, onCancel }: { entry: Partial<MemoryEntry>; onSave: (e: Pick<MemoryEntry, 'kind' | 'scope' | 'title' | 'text'> & { id?: string }) => Promise<string | undefined>; onCancel: () => void }) {
  const [kind, setKind] = useState<MemoryKind>(entry.kind ?? 'convention');
  const [scope, setScope] = useState(entry.scope ?? 'project');
  const [title, setTitle] = useState(entry.title ?? '');
  const [text, setText] = useState(entry.text ?? '');
  const [error, setError] = useState<string>();
  return (
    <form
      className="orq-pmem__edit"
      aria-label={t('pmem.editor')}
      onSubmit={(e) => {
        e.preventDefault();
        void onSave({ ...(entry.id ? { id: entry.id } : {}), kind, scope, title, text }).then(setError);
      }}
    >
      <label className="orq-field">
        <span>{t('pmem.kind')}</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as MemoryKind)}>
          {MEMORY_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`pmem.kind.${k}` as MessageKey)}
            </option>
          ))}
        </select>
      </label>
      <label className="orq-field">
        <span>{t('pmem.scope')}</span>
        <input value={scope} onChange={(e) => setScope(e.target.value)} />
      </label>
      <label className="orq-field">
        <span>{t('pmem.title')}</span>
        <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="orq-field">
        <span>{t('pmem.text')}</span>
        <textarea rows={3} value={text} maxLength={600} onChange={(e) => setText(e.target.value)} />
      </label>
      {error && (
        <p className="orq-hint is-warn" role="alert">
          {error}
        </p>
      )}
      <div className="orq-pmem__actions">
        <button type="submit" className="orq-btn orq-btn--small orq-btn--primary">
          {t('pmem.save')}
        </button>
        <button type="button" className="orq-btn orq-btn--small orq-btn--ghost" onClick={onCancel}>
          {t('form.cancel')}
        </button>
      </div>
    </form>
  );
}

/**
 * «Memoria del proyecto» [R76.21]: por ámbito y tipo, con búsqueda, «¿Sigue valiendo?», edición, archivar y restaurar,
 * su historial y de qué ejecución salió. Avisa al pasar de 200 activas [R76.4].
 */
export function ProjectMemoryPanel({ api, onOpenRun, now = Date.now() }: { api: Pick<ProjectApi, 'projectMemory' | 'saveMemoryEntry'>; onOpenRun?: (runId: string) => void; now?: number }) {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [query, setQuery] = useState('');
  const [only, setOnly] = useState<'all' | 'stale' | 'archived'>('all');
  const [editing, setEditing] = useState<Partial<MemoryEntry>>();
  const reload = useCallback(async () => {
    const r = await api.projectMemory();
    if (r.ok) setEntries(r.value);
  }, [api]);
  useEffect(() => void reload(), [reload]);
  const save = async (e: Parameters<ProjectApi['saveMemoryEntry']>[0]) => {
    const r = await api.saveMemoryEntry(e);
    if (!r.ok) return r.error.message;
    setEntries(r.value);
    setEditing(undefined);
    return undefined;
  };
  const active = entries.filter((e) => e.status === 'active');
  const q = query.trim().toLowerCase();
  const shown = entries.filter((e) => (only === 'archived' ? e.status === 'archived' : e.status === 'active') && (only !== 'stale' || staleReason(e, now) !== undefined) && (!q || `${e.title} ${e.text}`.toLowerCase().includes(q)));
  const scopes = [...new Set(shown.map((e) => e.scope))].sort((a, b) => (a === 'project' ? -1 : b === 'project' ? 1 : a.localeCompare(b)));
  return (
    <section className="orq-panel orq-pmem" aria-label={t('pmem.screen')}>
      <h2>{t('pmem.screen')}</h2>
      <p className="orq-hint">{t('pmem.screen.hint')}</p>
      {active.length > MEMORY_WARN_ACTIVE && (
        <p className="orq-hint is-warn" role="status">
          {t('pmem.many', { n: active.length })}
        </p>
      )}
      <div className="orq-pmem__bar">
        <input type="search" aria-label={t('pmem.search')} placeholder={t('pmem.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
        <div role="group" aria-label={t('pmem.filter')}>
          {(['all', 'stale', 'archived'] as const).map((k) => (
            <button key={k} type="button" className="orq-btn orq-btn--small orq-btn--ghost" aria-pressed={only === k} onClick={() => setOnly(k)}>
              {t(`pmem.filter.${k}` as MessageKey)}
            </button>
          ))}
        </div>
        <button type="button" className="orq-btn orq-btn--small" onClick={() => setEditing({})}>
          {t('pmem.add')}
        </button>
      </div>
      {editing && !editing.id && <Editor entry={editing} onSave={save} onCancel={() => setEditing(undefined)} />}
      {shown.length === 0 && <p className="orq-hint">{t('pmem.empty')}</p>}
      {scopes.map((s) => (
        <section key={s} aria-label={scopeName(s)}>
          <h3>{scopeName(s)}</h3>
          <ul className="orq-pmem__list">
            {shown
              .filter((e) => e.scope === s)
              .map((e) => {
                const stale = staleReason(e, now);
                return (
                  <li key={e.id} className="orq-pmem__item" aria-label={e.title}>
                    {editing?.id === e.id ? (
                      <Editor entry={e} onSave={save} onCancel={() => setEditing(undefined)} />
                    ) : (
                      <>
                        <p>
                          <span className="orq-tag">{t(`pmem.kind.${e.kind}` as MessageKey)}</span> <strong>{e.title}</strong>
                          {stale && <span className="orq-tag is-warn">{t('pmem.stale')}</span>}
                        </p>
                        <p>{e.text}</p>
                        <p className="orq-hint">
                          {t(`pmem.origin.${e.source.origin}` as MessageKey)} · {t('pmem.uses', { n: e.uses })}
                          {e.source.runId && onOpenRun && (
                            <>
                              {' · '}
                              <button type="button" className="orq-link" onClick={() => onOpenRun(e.source.runId!)}>
                                {t('pmem.fromRun')}
                              </button>
                            </>
                          )}
                        </p>
                        <details>
                          <summary>{t('pmem.history')}</summary>
                          <ul>
                            {e.history.map((h, i) => (
                              <li key={i}>{`${new Date(h.at).toLocaleDateString('es-ES')} · ${t(`pmem.hist.${h.action}` as MessageKey)}${h.by === 'assistant' ? ` · ${t('pmem.origin.assistant')}` : ''}`}</li>
                            ))}
                          </ul>
                        </details>
                        <div className="orq-pmem__actions">
                          <button type="button" className="orq-btn orq-btn--small orq-btn--ghost" onClick={() => setEditing(e)}>
                            {t('pmem.editEntry')}
                          </button>
                          <button type="button" className="orq-btn orq-btn--small orq-btn--ghost" onClick={() => void save({ id: e.id, kind: e.kind, scope: e.scope, title: e.title, text: e.text, status: e.status === 'active' ? 'archived' : 'active' })}>
                            {t(e.status === 'active' ? 'pmem.archive' : 'pmem.restore')}
                          </button>
                        </div>
                      </>
                    )}
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </section>
  );
}
