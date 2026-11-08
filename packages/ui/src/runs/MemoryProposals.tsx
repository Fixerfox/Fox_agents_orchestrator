import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { MemoryEntry, RunEvent } from '@orquestador/core';
import { memoryProposalsOf, t, type MessageKey, type ProjectApi, type ProposalView } from '@orquestador/editor';

function Proposal({ p, current, onDecide }: { p: ProposalView; current?: MemoryEntry | undefined; onDecide: (decision: 'save' | 'discard', edited?: { title: string; text: string }) => Promise<string | undefined> }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(p.title);
  const [text, setText] = useState(p.text);
  const [error, setError] = useState<string>();
  const decide = async (d: 'save' | 'discard', edited?: { title: string; text: string }) => setError(await onDecide(d, edited));
  return (
    <li className={`orq-memprop${p.decision ? ` is-${p.decision}` : ''}`} aria-label={p.title}>
      <p className="orq-memprop__head">
        <span className="orq-tag">{t(`pmem.kind.${p.kind}` as MessageKey)}</span>
        <span className="orq-tag">{p.scope === 'project' ? t('pmem.scope.project') : p.scope}</span>
        <span className="orq-hint">{t(`pmem.action.${p.action}` as MessageKey)} · {t(`pmem.origin.${p.origin}` as MessageKey)}</span>
      </p>
      {editing ? (
        <>
          <label className="orq-field">
            <span>{t('pmem.title')}</span>
            <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="orq-field">
            <span>{t('pmem.text')}</span>
            <textarea rows={3} value={text} maxLength={600} onChange={(e) => setText(e.target.value)} />
          </label>
        </>
      ) : (
        <>
          <strong>{p.title}</strong>
          {/* En una actualización, lo de antes y lo de ahora [R76.10]. */}
          {p.action === 'update' && current ? (
            <p className="orq-memprop__diff">
              <del>{current.text}</del> <ins>{p.text}</ins>
            </p>
          ) : (
            <p>{p.text}</p>
          )}
          {p.reason && <p className="orq-hint">{p.reason}</p>}
        </>
      )}
      {p.decision ? (
        <p className="orq-hint">{t(p.decision === 'save' ? (p.edited ? 'pmem.saved.edited' : 'pmem.saved') : 'pmem.discarded')}</p>
      ) : (
        <div className="orq-memprop__actions">
          {editing ? (
            <button type="button" className="orq-btn orq-btn--small" onClick={() => void decide('save', { title, text })}>
              {t('pmem.save')}
            </button>
          ) : (
            <>
              <button type="button" className="orq-btn orq-btn--small" onClick={() => void decide('save')}>
                {t('pmem.save')}
              </button>
              <button type="button" className="orq-btn orq-btn--small orq-btn--ghost" onClick={() => setEditing(true)}>
                {t('pmem.edit')}
              </button>
            </>
          )}
          <button type="button" className="orq-btn orq-btn--small orq-btn--ghost" onClick={() => void decide('discard')}>
            {t('pmem.discard')}
          </button>
        </div>
      )}
      {error && <p className="orq-hint is-warn" role="alert">{error}</p>}
    </li>
  );
}

/** «Para recordar»: lo que la ejecución propone guardar en la memoria del proyecto; nada se guarda solo [R76.10]. */
export function MemoryProposals({ events, api, runId, entries = [] }: { events: readonly RunEvent[]; api: Pick<ProjectApi, 'decideMemory'>; runId: string; entries?: readonly MemoryEntry[] }) {
  const proposals = memoryProposalsOf(events);
  if (proposals.length === 0) return null;
  return (
    <section className="orq-rsum__sec orq-memprops" aria-label={t('pmem.remember')}>
      <h3>{t('pmem.remember')}</h3>
      <p className="orq-hint">{t('pmem.remember.hint')}</p>
      <ul>
        {proposals.map((p) => (
          <Proposal
            key={p.id}
            p={p}
            current={p.entryId ? entries.find((e) => e.id === p.entryId) : undefined}
            onDecide={async (decision, edited) => {
              const r = await api.decideMemory({ runId, proposalId: p.id, decision, ...(edited ? { edited } : {}) });
              return r.ok ? undefined : r.error.message;
            }}
          />
        ))}
      </ul>
    </section>
  );
}

/** Las entradas de la memoria del proyecto, para los títulos y las fichas [R76.10][R76.22]. */
export function useMemoryEntries(api: Pick<ProjectApi, 'projectMemory'>, version: unknown = 0): MemoryEntry[] {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  useEffect(() => {
    let live = true;
    // Una API sin memoria (pruebas antiguas, otra versión de la app) no tiene nada que mostrar.
    if (typeof api.projectMemory !== 'function') return;
    void api.projectMemory().then((r) => live && r.ok && setEntries(r.value));
    return () => void (live = false);
  }, [api, version]);
  return entries;
}

/** La ficha de una entrada que recibió un paso [R76.22]. */
export function MemoryEntryCard({ entry, id, onClose }: { entry: MemoryEntry | undefined; id: string; onClose: () => void }) {
  return (
    <div
      className="orq-modal orq-modal--center"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="orq-picker orq-memprop" role="dialog" aria-modal="true" aria-label={entry?.title ?? id}>
        <header className="orq-picker__head">
          <h2>{entry?.title ?? id}</h2>
          <button type="button" className="orq-icon-btn" aria-label={t('picker.close')} title={t('picker.close')} onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        {entry ? (
          <>
            <p className="orq-memprop__head">
              <span className="orq-tag">{t(`pmem.kind.${entry.kind}` as MessageKey)}</span>
              <span className="orq-tag">{entry.scope === 'project' ? t('pmem.scope.project') : entry.scope}</span>
              {entry.status === 'archived' && <span className="orq-tag">{t('pmem.hist.archived')}</span>}
            </p>
            <p>{entry.text}</p>
            <p className="orq-hint">
              {t(`pmem.origin.${entry.source.origin}` as MessageKey)} · {t('pmem.uses', { n: entry.uses })}
            </p>
          </>
        ) : (
          <p className="orq-hint">{t('pmem.gone')}</p>
        )}
      </div>
    </div>
  );
}
