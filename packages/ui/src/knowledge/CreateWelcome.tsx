import { useState, type ReactNode } from 'react';
import { ArrowRight, Sparkles, type LucideIcon } from 'lucide-react';
import { t } from '@orquestador/editor';

export interface WelcomeIdea {
  id: string;
  icon: LucideIcon;
  title: string;
  sub: string;
  /** Lo que se le pide al asistente al pulsarla. */
  prompt: string;
}
export interface WelcomeAction {
  id: string;
  icon?: LucideIcon;
  title: string;
  sub?: string;
  onClick: () => void;
  disabled?: boolean;
}

/**
 * Primera pantalla al crear algo de la biblioteca: el asistente por delante (describirlo o elegir una idea) y, debajo,
 * los caminos a mano. La usan MCP, skills y contextos [R38.6][R38.19][R38.20].
 */
export function CreateWelcome({
  title,
  sub,
  ready,
  inputLabel,
  placeholder,
  prompt,
  ideasLabel,
  ideas,
  actionsLabel,
  actions,
  extra,
  goLabel,
  onAsk,
}: {
  title: string;
  sub: string;
  /** El asistente puede trabajar (motor Claude). */
  ready: boolean;
  inputLabel: string;
  placeholder: string;
  /** Petición completa a partir de lo escrito. */
  prompt: (text: string) => string;
  ideasLabel: string;
  ideas: WelcomeIdea[];
  /** Título del grupo de caminos a mano; con un solo camino se pinta como tarjeta ancha. */
  actionsLabel: string;
  actions: WelcomeAction[];
  /** Algo más bajo el campo (p. ej. «Guardarlo en» de MCP). */
  extra?: ReactNode;
  /** Texto del botón del campo; por defecto «Pedírselo al asistente». */
  goLabel?: string;
  onAsk: (text: string) => void;
}) {
  const [text, setText] = useState('');
  return (
    <section className="orq-mcpw" aria-label={title}>
      <div className="orq-mcpw__inner">
        <span className="orq-mcpw__mark" aria-hidden="true">
          <Sparkles size={22} strokeWidth={1.5} />
        </span>
        <h2>{title}</h2>
        <p className="orq-mcpw__sub">{sub}</p>
        {!ready && (
          <p className="orq-locked" role="note">
            {t('welcome.sim')}
          </p>
        )}
        <form
          className="orq-mcpw__ask"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) onAsk(prompt(text.trim()));
          }}
        >
          <input aria-label={inputLabel} placeholder={placeholder} value={text} autoFocus onChange={(e) => setText(e.target.value)} />
          <button type="submit" className="orq-btn orq-btn--primary" disabled={text.trim() === ''}>
            <Sparkles size={14} strokeWidth={1.5} aria-hidden="true" />
            {goLabel ?? t('mcp.welcome.go')}
          </button>
        </form>
        {extra}
        <h3 className="orq-mcpw__label">{ideasLabel}</h3>
        <ul className="orq-mcpw__grid">
          {ideas.map(({ id, icon: Icon, title: name, sub: small, prompt: p }) => (
            <li key={id}>
              <button type="button" className="orq-mcpw__svc" onClick={() => onAsk(p)}>
                <Icon size={18} strokeWidth={1.5} aria-hidden="true" />
                <span>
                  <strong>{name}</strong>
                  <small>{small}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {actions.length === 1 ? (
          <button type="button" className="orq-mcpw__manual" disabled={actions[0]!.disabled} onClick={actions[0]!.onClick}>
            <span>
              <strong>{actions[0]!.title}</strong>
              {actions[0]!.sub && <small>{actions[0]!.sub}</small>}
            </span>
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        ) : (
          <div className="orq-mcpw__manualgrp" role="group" aria-label={actionsLabel}>
            <h3 className="orq-mcpw__label">{actionsLabel}</h3>
            <div className="orq-mcpw__actions">
              {actions.map(({ id, icon: Icon, title: name, sub: small, onClick, disabled }) => (
                <button key={id} type="button" className="orq-mcpw__manual orq-mcpw__act" aria-label={name} disabled={disabled} onClick={onClick}>
                  {Icon && <Icon size={18} strokeWidth={1.5} aria-hidden="true" />}
                  <span>
                    <strong>{name}</strong>
                    {small && <small>{small}</small>}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
