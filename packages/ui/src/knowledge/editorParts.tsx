import { type ReactNode, type KeyboardEvent, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { type AgentDefinition } from '@orquestador/core';
import { t, type ProjectApi } from '@orquestador/editor';

export const NEW = '__new__';

const SZ = { size: 16, strokeWidth: 1.5, 'aria-hidden': true } as const;

export const initial = (name: string) => (name.trim()[0] ?? '?').toUpperCase();

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
export const listOf = (a: AgentDefinition, kind: 'contexts' | 'skills' | 'mcp') => (kind === 'contexts' ? a.contextIds : kind === 'skills' ? (a.skillIds ?? []) : (a.mcpIds ?? []));

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
