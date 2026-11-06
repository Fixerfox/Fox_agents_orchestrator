import { useState } from 'react';
import { type AgentIcon, type AgentTone, AGENT_ICONS, AGENT_TONES } from '@orquestador/core';
import { t, type MessageKey } from '@orquestador/editor';
import { AgentAvatar, AGENT_ICON_COMPONENT } from '../common/index';

/** Elegir el icono y el tono del agente; sin icono se usa la inicial [R39.8]. */
export function IconPicker({ name, icon, tone, onChange }: { name: string; icon: AgentIcon | undefined; tone: AgentTone | undefined; onChange: (icon: AgentIcon | undefined, tone: AgentTone | undefined) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="orq-iconpick" role="group" aria-label={t('agent.look')}>
      <button type="button" className="orq-btn orq-btn--small orq-btn--ghost orq-iconpick__toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? t('agent.look.done') : t('agent.look.change')}
      </button>
      {open && (
        <>
          <div className="orq-iconpick__grid" role="radiogroup" aria-label={t('agent.look')}>
            <button type="button" role="radio" aria-checked={icon === undefined} className="orq-iconpick__opt" aria-label={t('agent.look.none')} title={t('agent.look.none')} onClick={() => onChange(undefined, tone)}>
              <AgentAvatar name={name || '?'} tone={tone} size="sm" />
            </button>
            {AGENT_ICONS.map((id) => {
              const Icon = AGENT_ICON_COMPONENT[id];
              const label = t(`icon.${id}` as MessageKey);
              return (
                <button key={id} type="button" role="radio" aria-checked={icon === id} className="orq-iconpick__opt" aria-label={t('agent.look.icon', { name: label })} title={label} onClick={() => onChange(id, tone)}>
                  <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
                </button>
              );
            })}
          </div>
          <div className="orq-iconpick__tones" role="radiogroup" aria-label={t('agent.look.tone', { name: '' }).trim()}>
            {AGENT_TONES.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={(tone ?? 'neutral') === k} className={`orq-iconpick__tone is-${k}`} aria-label={t('agent.look.tone', { name: t(`tone.${k}` as MessageKey) })} title={t(`tone.${k}` as MessageKey)} onClick={() => onChange(icon, k === 'neutral' ? undefined : k)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
