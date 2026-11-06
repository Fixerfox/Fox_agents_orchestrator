import { Bot, BookOpen, Clock3, FolderGit2, FolderTree, Rocket, Settings, Workflow, Waypoints } from 'lucide-react';
import { t, type MessageKey } from '@orquestador/editor';
import { HandMark } from '../common';

export type SectionId = 'project' | 'diagrams' | 'library' | 'agents' | 'knowledge' | 'jobs' | 'runs' | 'settings';

const ITEMS: { id: SectionId; icon: typeof Bot; label: MessageKey; full?: MessageKey }[] = [
  // Orden pedido por el usuario (05/11): lo que se usa al trabajar arriba, el proyecto al final.
  { id: 'runs', icon: Clock3, label: 'nav.runs', full: 'nav.runs.full' },
  { id: 'jobs', icon: Rocket, label: 'nav.jobs' },
  { id: 'diagrams', icon: Waypoints, label: 'nav.diagrams' },
  { id: 'library', icon: FolderTree, label: 'nav.library' },
  { id: 'agents', icon: Bot, label: 'nav.agents' },
  { id: 'knowledge', icon: BookOpen, label: 'nav.knowledge', full: 'nav.knowledge.full' },
  { id: 'project', icon: FolderGit2, label: 'nav.project' },
];

interface Props {
  section: SectionId;
  onGo: (s: SectionId) => void;
  /** Marca de atención (preguntas pendientes) en Ejecuciones [R32.18]. */
  runsBadge?: number;
  /** El diagrama abierto tiene un agente esperando respuesta [R39.6]. */
  designerAsking?: boolean;
}

/** Rail global con icono y texto: secciones de la aplicación a pantalla completa [R32.13]. */
export function NavRail({ section, onGo, runsBadge = 0, designerAsking = false }: Props) {
  const item = (id: SectionId, Icon: typeof Bot, label: MessageKey, full?: MessageKey) => {
    const name = t(full ?? label);
    return (
      <button
        key={id}
        type="button"
        className={`orq-nav__item${section === id ? ' is-on' : ''}`}
        aria-label={id === 'runs' && runsBadge > 0 ? `${name} (${runsBadge})` : name}
        aria-current={section === id ? 'page' : undefined}
        title={name}
        onClick={() => onGo(id)}
      >
        <Icon size={20} strokeWidth={1.6} aria-hidden="true" />
        <span aria-hidden="true">{t(label)}</span>
        {id === 'diagrams' && designerAsking && <HandMark size={12} />}
        {id === 'runs' && runsBadge > 0 && (
          <em className="orq-nav__badge" aria-hidden="true">
            {runsBadge}
          </em>
        )}
      </button>
    );
  };
  return (
    <nav className="orq-nav" aria-label={t('nav.title')}>
      <span className="orq-nav__logo" aria-hidden="true">
        <Workflow size={22} strokeWidth={1.8} />
      </span>
      {ITEMS.map((i) => item(i.id, i.icon, i.label, i.full))}
      <span className="orq-nav__gap" />
      {item('settings', Settings, 'nav.settings')}
    </nav>
  );
}
