import { AgentAvatar, AskFirstMark } from '../common';
import { useEffect, useRef } from 'react';
import { Bot, Plus, X } from 'lucide-react';
import { t } from '@orquestador/editor';
import type { AgentOption } from './Palette';

interface Props {
  agents: AgentOption[];
  onPick: (agentId: string) => void;
  /** Abre la pantalla de agentes para crear uno [R22.9]. */
  onCreate?: () => void;
  projectOpen?: boolean;
  onClose: () => void;
}

/** Galería de tarjetas para elegir un agente al añadirlo [R21.14]. */
export function AgentPicker({ agents, onPick, onClose, onCreate, projectOpen = true }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('.orq-card')?.focus();
  }, []);
  return (
    <div
      className="orq-modal"
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
      <div ref={ref} className="orq-picker" role="dialog" aria-modal="true" aria-label={t('picker.title')}>
        <header className="orq-picker__head">
          <h2>{t('picker.title')}</h2>
          <button type="button" className="orq-icon-btn" aria-label={t('picker.close')} title={t('picker.close')} onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        {agents.length === 0 && <p className="orq-hint">{t(projectOpen ? 'picker.empty' : 'agents.noProject')}</p>}
        {(agents.length > 0 || onCreate) && (
          <ul className="orq-cards">
            {agents.map((a) => (
              <li key={a.id}>
                <button type="button" className="orq-card" onClick={() => onPick(a.id)}>
                  {a.icon ? (
                    <AgentAvatar name={a.name} icon={a.icon} tone={a.tone} size="lg" className="orq-card__icon" />
                  ) : (
                    <span className="orq-card__icon" aria-hidden="true">
                      <Bot size={22} />
                    </span>
                  )}
                  {a.askFirst && <AskFirstMark />}
                  <span className="orq-card__name">{a.name}</span>
                  <span className="orq-card__desc">{a.description ?? t('picker.desc.none')}</span>
                </button>
              </li>
            ))}
            {onCreate && (
              <li>
                <button type="button" className="orq-card orq-card--new" onClick={onCreate} disabled={!projectOpen} title={projectOpen ? undefined : t('agents.noProject')}>
                  <Plus size={20} strokeWidth={1.5} aria-hidden="true" />
                  <span className="orq-card__name">{t('picker.create')}</span>
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
