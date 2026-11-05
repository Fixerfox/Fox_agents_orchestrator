import {
  Bot,
  Brain,
  Bug,
  ClipboardList,
  Code2,
  Database,
  Eye,
  FlaskConical,
  Gamepad2,
  Globe,
  Hammer,
  Hand,
  Image,
  Layers,
  Lightbulb,
  Map as MapIcon,
  Music,
  Palette,
  PenLine,
  Rocket,
  ScrollText,
  Search,
  ShieldCheck,
  Swords,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { AgentIcon, AgentTone } from '@orquestador/core';
import { t } from '@orquestador/editor';

/** Icono de cada id del catálogo [R39.7]. */
export const AGENT_ICON_COMPONENT: Record<AgentIcon, LucideIcon> = {
  bot: Bot,
  brain: Brain,
  code: Code2,
  bug: Bug,
  test: FlaskConical,
  search: Search,
  shield: ShieldCheck,
  scroll: ScrollText,
  pen: PenLine,
  palette: Palette,
  image: Image,
  music: Music,
  gamepad: Gamepad2,
  map: MapIcon,
  swords: Swords,
  database: Database,
  globe: Globe,
  wrench: Wrench,
  hammer: Hammer,
  rocket: Rocket,
  lightbulb: Lightbulb,
  clipboard: ClipboardList,
  eye: Eye,
  layers: Layers,
};

export interface AgentLook {
  icon?: AgentIcon | undefined;
  tone?: AgentTone | undefined;
  askFirst?: boolean | undefined;
}

/** Icono del agente con su tono; sin icono, su inicial [R39.8][R39.9]. */
export function AgentAvatar({ name, icon, tone, size = 'md', className = '' }: { name: string; icon?: AgentIcon | undefined; tone?: AgentTone | undefined; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const Icon = icon ? AGENT_ICON_COMPONENT[icon] : undefined;
  const px = size === 'sm' ? 12 : size === 'lg' ? 20 : 15;
  return (
    <span className={`orq-av orq-av--${size} is-${tone ?? 'neutral'}${Icon ? ' has-icon' : ''} ${className}`.trim()} aria-hidden="true" data-icon={icon}>
      {Icon ? <Icon size={px} strokeWidth={1.75} /> : (name.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}

/** Semáforo amarillo: el agente pregunta antes de actuar [R39.5]. */
export function AskFirstMark({ size = 14 }: { size?: number }) {
  const label = t('askfirst.mark');
  return (
    <span className="orq-semaforo" role="img" aria-label={label} title={label}>
      <svg width={size * 0.62} height={size} viewBox="0 0 10 16" aria-hidden="true">
        <rect x="0.75" y="0.75" width="8.5" height="14.5" rx="2.5" className="orq-semaforo__box" />
        <circle cx="5" cy="4" r="1.7" className="orq-semaforo__off" />
        <circle cx="5" cy="8" r="1.9" className="orq-semaforo__on" />
        <circle cx="5" cy="12" r="1.7" className="orq-semaforo__off" />
      </svg>
    </span>
  );
}

/** Mano levantada: el agente te está preguntando [R39.6]. */
export function HandMark({ size = 14, label = t('hand.mark') }: { size?: number; label?: string }) {
  return (
    <span className="orq-hand" role="img" aria-label={label} title={label}>
      <Hand size={size} strokeWidth={1.9} aria-hidden="true" />
    </span>
  );
}
