import type { ReactNode } from 'react';
import { BookOpen, Plug } from 'lucide-react';
import { MODELS, type AgentDefinition, type ContextDefinition } from '@orquestador/core';
import { t, type McpView } from '@orquestador/editor';
import { AgentAvatar, AskFirstMark, type DraftStore, type LibRow, type LibraryTab } from '../common';
import { KIND_TAG, initial } from './editorParts';

interface RowContext {
  tab: LibraryTab;
  /** Diagramas que usan cada agente [R32.30]. */
  diagramUses: Record<string, number>;
  usedBy: (kind: 'contexts' | 'skills' | 'mcp', id: string) => AgentDefinition[];
  drafts: DraftStore;
}

/** Filas de la lista de una pestaña: etiqueta, descripción y uso [R32.30]. */
export function libraryRows(list: { id: string; name: string }[], { tab, diagramUses, usedBy, drafts }: RowContext): LibRow[] {
  return list.map((i) => {
    let meta: ReactNode;
    let tag: ReactNode;
    let description: string | undefined = (i as { description?: string }).description?.trim() || undefined;
    if (tab === 'agents') {
      const a = i as AgentDefinition;
      tag = a.icon ? <AgentAvatar name={a.name} icon={a.icon} tone={a.tone} /> : <span className="orq-lib__av">{initial(a.name)}</span>;
      const uses = diagramUses[a.id];
      const model = MODELS.find((m) => m.id === a.model)?.name ?? a.model;
      const usesText = uses === undefined ? '' : uses === 0 ? ` · ${t('lib.uses.none')}` : ` · ${uses === 1 ? t('lib.uses.diagrams.one') : t('lib.uses.diagrams.many', { count: uses })}`;
      meta = a.description.trim() === '' ? <span className="orq-lib__warn">{t('lib.noDesc')}</span> : `${model}${usesText}`;
      if (a.askFirst)
        meta = (
          <>
            <AskFirstMark size={12} /> {meta}
          </>
        );
    } else {
      const n = usedBy(tab, i.id).length;
      tag =
        tab === 'contexts' ? (
          <span className="orq-lib__tag">{KIND_TAG[(i as ContextDefinition).kind]}</span>
        ) : (
          <span className={`orq-lib2__ic is-${tab}`}>{tab === 'mcp' ? <Plug size={14} strokeWidth={1.5} aria-hidden="true" /> : <BookOpen size={14} strokeWidth={1.5} aria-hidden="true" />}</span>
        );
      meta = n === 0 ? t('lib.uses.none') : n === 1 ? t('lib.usedBy.one') : t('lib.usedBy.many', { count: n });
      if (tab === 'mcp' && !(i as McpView).enabled) meta = <span className="orq-lib__warn">{t('mcp.off')}</span>;
      else if (tab === 'mcp' && (i as McpView).scope === 'app') meta = `${t('mcp.scope.badge')} · ${meta as string}`;
      if (tab === 'contexts') description = undefined;
    }
    return { id: i.id, name: i.name, ...(description ? { description } : {}), tag, meta, unsaved: drafts.has(`${tab}:${i.id}`) };
  });
}
