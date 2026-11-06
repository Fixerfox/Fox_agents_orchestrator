import { useState } from 'react';
import { BookOpen, FileText, Lock, Plug, Plus, X } from 'lucide-react';
import { isForcedOnStep, isRequired, setRequired, t, type MessageKey } from '@orquestador/editor';
import type { KnowledgeExtra } from '@orquestador/core';
import { AssignPicker, type AssignItem } from '../common';

/** Lo que hay en el proyecto para añadir: skills, contextos y servidores MCP [R33.5]. */
export interface KnowledgeCatalog {
  skills: AssignItem[];
  contexts: AssignItem[];
  mcp?: AssignItem[];
}

type Kind = 'skillIds' | 'contextIds' | 'mcpIds';
const ICON = { skillIds: BookOpen, contextIds: FileText, mcpIds: Plug } as const;
const LIST = { skillIds: 'skills', contextIds: 'contexts', mcpIds: 'mcp' } as const;

interface Props {
  /** Título del bloque («Solo en este paso» o «Para todos sus agentes»). */
  label: string;
  hint: string;
  value: KnowledgeExtra | undefined;
  /** Lo que el diagrama ya manda como obligatorio para todos sus agentes [R36.19]. */
  inherited?: KnowledgeExtra | undefined;
  catalog: KnowledgeCatalog;
  /** Es el conocimiento de un paso: sus skills y MCP son obligatorios siempre [R36.22]. */
  step?: boolean;
  disabled?: boolean;
  onChange: (next: KnowledgeExtra) => void;
  /** «Crear…» en el selector: abre Conocimiento con uno nuevo. */
  onCreate?: (kind: 'skills' | 'contexts' | 'mcp') => void;
}

/**
 * Skills, contextos y MCP añadidos a un paso o a un diagrama sin tocar a los agentes: fichas que se quitan y
 * botones que abren el selector [R33.5][R33.6].
 */
export function ExtraKnowledge({ label, hint, value, inherited, catalog, step = false, disabled = false, onChange, onCreate }: Props) {
  const [picking, setPicking] = useState<Kind>();
  const kinds: Kind[] = catalog.mcp && catalog.mcp.length > 0 ? ['skillIds', 'contextIds', 'mcpIds'] : ['skillIds', 'contextIds'];
  const nameOf = (k: Kind, id: string) => (catalog[LIST[k]] ?? []).find((i) => i.id === id)?.name ?? id;
  const set = (k: Kind, ids: string[]) => onChange({ ...value, [k]: ids });
  const chips = kinds.flatMap((k) => (value?.[k] ?? []).map((id) => ({ k, id })));
  return (
    <div className="orq-insp__sec orq-extra" role="group" aria-label={label}>
      <span className="orq-insp__label">{label}</span>
      {chips.length > 0 && (
        <div className="orq-insp__chips">
          {chips.map(({ k, id }) => {
            const Icon = ICON[k];
            const name = nameOf(k, id);
            const plugged = step && isForcedOnStep(k);
            const byDiagram = !plugged && isRequired(inherited, k, id);
            const required = plugged || isRequired(value, k, id) || byDiagram;
            const why = plugged ? t('know.required.plugged') : byDiagram ? t('know.byDiagram') : t(required ? 'know.required.off' : 'know.required.on', { name });
            return (
              <span key={`${k}-${id}`} className={`orq-tag is-extra${required ? ' is-required' : ''}`}>
                <Icon size={12} strokeWidth={1.5} aria-hidden="true" />
                {name}
                <button
                  type="button"
                  className={`orq-chip__req${required ? ' is-on' : ''}`}
                  disabled={disabled || byDiagram || plugged}
                  aria-pressed={required}
                  aria-label={why}
                  title={why}
                  onClick={() => onChange(setRequired(value, k, id, !required))}
                >
                  <Lock size={12} strokeWidth={1.5} aria-hidden="true" />
                  {required && <span>{byDiagram ? t('know.byDiagram') : t('know.required')}</span>}
                </button>
                <button
                  type="button"
                  className="orq-chip__x"
                  disabled={disabled}
                  aria-label={t('extra.remove', { name })}
                  title={t('extra.remove', { name })}
                  onClick={() => set(k, (value?.[k] ?? []).filter((x) => x !== id))}
                >
                  <X size={12} strokeWidth={1.5} aria-hidden="true" />
                </button>
              </span>
            );
          })}
        </div>
      )}
      <div className="orq-extra__add">
        {kinds.map((k) => {
          const Icon = ICON[k];
          return (
            <button key={k} type="button" className="orq-btn orq-btn--small orq-btn--ghost" disabled={disabled} onClick={() => setPicking(k)}>
              <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
              <Icon size={14} strokeWidth={1.5} aria-hidden="true" />
              {t(`extra.add.${LIST[k]}` as MessageKey)}
            </button>
          );
        })}
      </div>
      <p className="orq-hint">{hint}</p>
      {picking && (
        <AssignPicker
          title={t(`extra.title.${LIST[picking]}` as MessageKey, { where: label })}
          icon={ICON[picking]}
          items={catalog[LIST[picking]] ?? []}
          selected={value?.[picking] ?? []}
          emptyText={t(`extra.empty.${LIST[picking]}` as MessageKey)}
          createLabel={t('extra.create')}
          onCreate={() => {
            const k = LIST[picking];
            setPicking(undefined);
            onCreate?.(k);
          }}
          onApply={(ids) => {
            set(picking, ids);
            setPicking(undefined);
          }}
          onClose={() => setPicking(undefined)}
        />
      )}
    </div>
  );
}
