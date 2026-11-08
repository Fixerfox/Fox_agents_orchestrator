import { ArrowLeft, type LucideIcon } from 'lucide-react';
import { permissionName } from '../common';
import type { ProjectPermission } from '@orquestador/core';
import { PROJECT_LEVELS, permissionMatrix, t, type MessageKey, type PermAnswer } from '@orquestador/editor';

export type SectionId = 'claude' | 'perms' | 'supervisor' | 'budget' | 'limits' | 'memory' | 'look' | 'work';

/** Una sección de Ajustes: entrada del índice y su contenido [R67.1]. */
export interface Section {
  id: SectionId;
  group: 'general' | 'project';
  icon: LucideIcon;
  label: string;
  summary: string;
  intro: string;
  content: React.ReactNode;
}

const ANSWER_MARK: Record<PermAnswer, string> = { yes: '✓', ask: '?', no: '✕' };

/** «Lo que pasará con cada nivel»: acciones × niveles, con el nivel elegido resaltado [R67.6]. */
export function PermMatrix({ level }: { level: ProjectPermission }) {
  return (
    <div className="orq-permtable">
      <table>
        <caption>{t('perm.matrix')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('perm.matrix.action')}</th>
            {PROJECT_LEVELS.map((l) => (
              <th key={l} scope="col" className={l === level ? 'is-on' : undefined} aria-current={l === level ? 'true' : undefined}>
                {permissionName(l)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {permissionMatrix().map((r) => (
            <tr key={r.action}>
              <th scope="row">{t(`perm.row.${r.action}` as MessageKey)}</th>
              {PROJECT_LEVELS.map((l) => (
                <td key={l} className={`is-${r.answers[l]}${l === level ? ' is-on' : ''}`}>
                  <span aria-hidden="true">{ANSWER_MARK[r.answers[l]]}</span> {t(`perm.ans.${r.answers[l]}` as MessageKey)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Opciones con consecuencias: tarjetas con su explicación debajo [R67.3]. */
export function Choice<V extends string>({ legend, name, value, options, onChange, error, list = false }: { legend: string; name: string; value: V; options: { value: V; label: string; hint: string }[]; onChange: (v: V) => void; error?: string | undefined; list?: boolean }) {
  return (
    <fieldset className="orq-field orq-choice">
      <legend>{legend}</legend>
      <div className={`orq-choice__opts${list ? ' is-list' : ''}`} role="radiogroup">
        {options.map((o) => (
          <div key={o.value} className={`orq-choice__opt${value === o.value ? ' is-on' : ''}`}>
            <label>
              <input type="radio" name={name} checked={value === o.value} aria-describedby={`${name}-${o.value}-hint`} onChange={() => onChange(o.value)} />
              <span>{o.label}</span>
            </label>
            <p className="orq-hint" id={`${name}-${o.value}-hint`}>
              {o.hint}
            </p>
          </div>
        ))}
      </div>
      {error && (
        <p className="orq-field__error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/** Fila de ajuste: texto a la izquierda y el control a la derecha [R67.3]. */
export function Row({ id, label, hint, error, children }: { id: string; label: string; hint?: string | undefined; error?: string | undefined; children: React.ReactNode }) {
  return (
    <div className={`orq-field orq-setrow${error ? ' has-error' : ''}`}>
      <div className="orq-setrow__text">
        <label htmlFor={id}>{label}</label>
        {hint && <p className="orq-hint">{hint}</p>}
        {error && (
          <p className="orq-field__error" id={`${id}-error`} role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="orq-setrow__ctrl">{children}</div>
    </div>
  );
}

/** Reglas que siguen todos los agentes, tal como las aplica el motor [R31.14]. */
export const RULES = (level: ProjectPermission): MessageKey[] => [
  'settings.rules.read',
  'settings.rules.create',
  level === 'ask' ? 'settings.rules.modify.ask' : 'settings.rules.modify.auto',
  level === 'ask' ? 'settings.rules.commands' : level === 'auto' ? 'settings.rules.commands.auto' : 'settings.rules.commands.full',
  'settings.rules.agent',
  level === 'full' ? 'settings.rules.outside.full' : 'settings.rules.outside',
  'settings.rules.explain',
  'settings.rules.record',
];

/** Página de Ajustes: índice por grupos a la izquierda, una sección cada vez y el estado del guardado al pie [R67.1][R67.5]. */
export function Shell({ onClose, children, status, items, current, onPick }: { onClose?: (() => void) | undefined; children: React.ReactNode; status?: string | undefined; items: readonly Section[]; current: SectionId; onPick: (id: SectionId) => void }) {
  const groups = (['general', 'project'] as const).map((g) => ({ g, rows: items.filter((x) => x.group === g) })).filter((x) => x.rows.length > 0);
  return (
    <section className="orq-page orq-settings-page" aria-label={t('settings.title')}>
      <aside className="orq-settings-page__nav">
        {onClose && (
          <button type="button" className="orq-btn orq-btn--ghost orq-btn--small" onClick={onClose}>
            <ArrowLeft size={16} aria-hidden="true" />
            {t('settings.back')}
          </button>
        )}
        <h1>{t('settings.title')}</h1>
        <nav aria-label={t('settings.title')}>
          {groups.map(({ g, rows }) => (
            <div key={g} className="orq-setnav__group">
              <span className="orq-setnav__label">{t(g === 'general' ? 'settings.group.general' : 'settings.group.project')}</span>
              {rows.map((x) => {
                const Icon = x.icon;
                return (
                  <button key={x.id} type="button" className="orq-setnav__item" aria-current={x.id === current ? 'page' : undefined} onClick={() => onPick(x.id)}>
                    <Icon size={16} strokeWidth={1.7} aria-hidden="true" className="orq-setnav__icon" />
                    <span className="orq-setnav__text">
                      <span className="orq-setnav__title">{x.label}</span>
                      <span className="orq-setnav__sum">{x.summary}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <p className="orq-hint orq-settings-page__auto">
          {t('settings.autosaved')}{' '}
          {status && (
            <span role="status" className="orq-settings-page__status">
              {status}
            </span>
          )}
        </p>
      </aside>
      <div className="orq-settings-page__main">{children}</div>
    </section>
  );
}
