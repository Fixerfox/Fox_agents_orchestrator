import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, X, type LucideIcon } from 'lucide-react';
import { t } from '@orquestador/editor';

export interface AssignItem {
  id: string;
  name: string;
  description?: string;
}

interface PickerProps {
  title: string;
  icon: LucideIcon;
  items: AssignItem[];
  selected: string[];
  emptyText: string;
  createLabel: string;
  onCreate: () => void;
  onApply: (ids: string[]) => void;
  onClose: () => void;
}

/** Pantalla aparte para elegir skills o contextos de un agente, con buscador y descripciones [R22.16]. */
export function AssignPicker({ title, icon: Icon, items, selected, emptyText, createLabel, onCreate, onApply, onClose }: PickerProps) {
  const [chosen, setChosen] = useState<string[]>(selected);
  const [q, setQ] = useState('');
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => search.current?.focus(), []);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle === '' ? items : items.filter((i) => `${i.name} ${i.description ?? ''}`.toLowerCase().includes(needle));
  }, [items, q]);
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  return (
    <div
      className="orq-modal orq-modal--top"
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
      <div className="orq-picker orq-assign" role="dialog" aria-modal="true" aria-label={title}>
        <header className="orq-picker__head">
          <h2>{title}</h2>
          <button type="button" className="orq-icon-btn" aria-label={t('picker.close')} title={t('picker.close')} onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        {items.length === 0 ? (
          <p className="orq-hint">{emptyText}</p>
        ) : (
          <>
            <label className="orq-assign__search">
              <Search size={16} strokeWidth={1.5} aria-hidden="true" />
              <input ref={search} type="search" value={q} placeholder={t('assign.search')} aria-label={t('assign.search')} onChange={(e) => setQ(e.target.value)} />
            </label>
            {shown.length === 0 ? (
              <p className="orq-hint">{t('assign.noMatch', { q })}</p>
            ) : (
              <ul className="orq-assign__list">
                {shown.map((i) => {
                  const on = chosen.includes(i.id);
                  return (
                    <li key={i.id} className={`orq-assign__row${on ? ' is-on' : ''}`}>
                      <span className="orq-assign__icon" aria-hidden="true">
                        <Icon size={16} strokeWidth={1.5} />
                      </span>
                      <span className="orq-assign__text">
                        <span className="orq-assign__name">{i.name}</span>
                        {i.description && <span className="orq-assign__desc">{i.description}</span>}
                      </span>
                      <button
                        type="button"
                        className={`orq-btn orq-btn--small${on ? '' : ' orq-btn--primary'}`}
                        aria-pressed={on}
                        aria-label={t(on ? 'assign.removeNamed' : 'assign.addNamed', { name: i.name })}
                        onClick={() => toggle(i.id)}
                      >
                        {on ? t('assign.remove') : t('assign.add')}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
        <footer className="orq-assign__foot">
          <button type="button" className="orq-btn" onClick={onCreate}>
            <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
            {createLabel}
          </button>
          <span className="orq-hint" role="status">
            {t(chosen.length === 1 ? 'assign.count.one' : 'assign.count.many', { n: chosen.length })}
          </span>
          <button type="button" className="orq-btn" onClick={onClose}>
            {t('form.cancel')}
          </button>
          <button type="button" className="orq-btn orq-btn--primary" onClick={() => onApply(chosen)}>
            {t('assign.done')}
          </button>
        </footer>
      </div>
    </div>
  );
}

interface FieldProps {
  legend: string;
  icon: LucideIcon;
  items: AssignItem[];
  selected: string[];
  noneText: string;
  addLabel: string;
  error?: string | undefined;
  onOpen: () => void;
  onRemove: (id: string) => void;
  /** Abre el elemento (p. ej. la skill en Conocimiento) [R32.34]. */
  onShow?: (id: string) => void;
  /** Lo marcado como obligatorio y cómo cambiarlo [R39.13]. */
  requiredIds?: string[];
  onToggleRequired?: (id: string) => void;
}

/** Lo asignado a un agente, como fichas quitables y un botón para abrir la pantalla de selección [R22.16]. */
export function AssignedField({ legend, icon: Icon, items, selected, noneText, addLabel, error, onOpen, onRemove, onShow, requiredIds = [], onToggleRequired }: FieldProps) {
  const known = new Map(items.map((i) => [i.id, i]));
  return (
    <section className="orq-field orq-assigned" aria-label={legend}>
      <div className="orq-assigned__head">
        <h3>{legend}</h3>
        <button type="button" className="orq-btn orq-btn--small" onClick={onOpen}>
          <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
          {addLabel}
        </button>
      </div>
      {selected.length === 0 ? (
        <p className="orq-hint">{noneText}</p>
      ) : (
        <ul className="orq-assigned__chips">
          {selected.map((id) => {
            const name = known.get(id)?.name ?? id;
            return (
              <li key={id} className="orq-chip">
                <Icon size={14} strokeWidth={1.5} aria-hidden="true" />
                {onShow && known.has(id) ? (
                  <button type="button" className="orq-chip__open" aria-label={t('assign.open', { name })} title={t('assign.open', { name })} onClick={() => onShow(id)}>
                    {name}
                  </button>
                ) : (
                  <span>{name}</span>
                )}
                {onToggleRequired && (
                  <button
                    type="button"
                    className={`orq-chip__req${requiredIds.includes(id) ? ' is-on' : ''}`}
                    aria-pressed={requiredIds.includes(id)}
                    aria-label={t('assign.required', { name })}
                    title={t(requiredIds.includes(id) ? 'assign.required.on' : 'assign.required.off')}
                    onClick={() => onToggleRequired(id)}
                  >
                    {t('assign.required.short')}
                  </button>
                )}
                <button type="button" className="orq-chip__x" aria-label={t('assign.removeNamed', { name })} title={t('assign.remove')} onClick={() => onRemove(id)}>
                  <X size={14} strokeWidth={1.5} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {error && (
        <p className="orq-field__error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
