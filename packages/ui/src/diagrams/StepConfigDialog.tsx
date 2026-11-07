import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { t, type EditorSession, type EditorSnapshot, type NodePatch, type ProjectApi } from '@orquestador/editor';
import type { OpenLibrary } from '../common';
import type { KnowledgeCatalog } from './ExtraKnowledge';
import type { AgentOption } from './Palette';
import { AgentStepFields, agentOfNode, type StepFiles } from './StepFields';

export type StepConfigTab = 'step' | 'agent';

/** La ficha del agente la pone el shell (viene de Agentes, otro contexto) [R56.19][R64.4]. */
export type AgentEditorSlot = (p: { agentId: string; busy: boolean; onSaved: () => void; onCreateOther: (tab: 'contexts' | 'skills' | 'mcp', id?: string) => void }) => ReactNode;

interface Props {
  api: ProjectApi;
  session: EditorSession;
  snap: EditorSnapshot;
  nodeId: string;
  initialTab?: StepConfigTab;
  agents: readonly AgentOption[];
  /** Sin él no hay pestaña «El agente». */
  agentEditor?: AgentEditorSlot | undefined;
  catalog?: KnowledgeCatalog | undefined;
  files?: StepFiles | undefined;
  onClose: () => void;
  onError: (message: string) => void;
  onChangeAgent: (nodeId: string) => void;
  /** Tras guardar el agente: la paleta y los nodos se actualizan [R64.4]. */
  onAgentSaved: () => void;
  openLibrary: OpenLibrary;
}

/** Ventana «Configurar» de un paso agente: «Este paso» y «El agente» [R64.1–R64.6]. */
export function StepConfigDialog({ api, session, snap, nodeId, initialTab = 'step', agents, agentEditor, catalog, files, onClose, onError, onChangeAgent, onAgentSaved, openLibrary }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const node = snap.level.nodes.find((n) => n.id === nodeId && n.kind === 'agent');
  const agent = node ? agentOfNode(agents, node.agentId) : undefined;
  const editable = agent?.editable === true && agentEditor !== undefined;
  const [tab, setTab] = useState<StepConfigTab>(initialTab === 'agent' && editable ? 'agent' : 'step');
  useEffect(() => ref.current?.focus(), []);
  useEffect(() => {
    if (!editable && tab === 'agent') setTab('step');
  }, [editable, tab]);

  /** Lo escrito en un campo del paso se aplica antes de cerrar [R64.5]. */
  const close = () => {
    const el = document.activeElement;
    if (el instanceof HTMLElement && ref.current?.contains(el)) el.blur();
    onClose();
  };
  if (!node) return null;
  const name = node.label ?? agent?.name ?? node.id;
  const patch = (p: NodePatch) => {
    try {
      session.updateNode(node.id, p);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };
  const title = t('stepcfg.title', { name });

  return (
    <div
      className="orq-modal"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.stopPropagation();
          close();
        }
      }}
    >
      <div ref={ref} tabIndex={-1} className="orq-picker orq-detail orq-stepcfg" role="dialog" aria-modal="true" aria-label={title}>
        <header className="orq-picker__head orq-stepcfg__head">
          <h2>{title}</h2>
          <button type="button" className="orq-icon-btn" aria-label={t('picker.close')} title={t('picker.close')} onClick={close}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        {editable && (
          <div className="orq-run__tabs orq-stepcfg__tabs" role="tablist" aria-label={t('stepcfg.tabs')}>
            {(['step', 'agent'] as const).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
                {t(k === 'step' ? 'stepcfg.tab.step' : 'stepcfg.tab.agent')}
              </button>
            ))}
          </div>
        )}
        <div className="orq-detail__body orq-stepcfg__body" role={editable ? 'tabpanel' : undefined} aria-label={editable ? t(tab === 'step' ? 'stepcfg.tab.step' : 'stepcfg.tab.agent') : undefined}>
          {tab === 'step' ? (
            <fieldset className="orq-insp orq-insp__lock orq-stepcfg__step" disabled={snap.readOnly}>
              {snap.readOnly && (
                <p className="orq-locked" role="status">
                  {t('run.locked')}
                </p>
              )}
              <input
                key={`${node.id}|${node.label ?? ''}`}
                className="orq-insp__title"
                data-field="label"
                aria-label={t('inspector.label')}
                defaultValue={node.label ?? node.id}
                onBlur={(e) => e.target.value !== (node.label ?? node.id) && patch({ label: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
              />
              <p className="orq-hint">{t('stepcfg.step.hint')}</p>
              <AgentStepFields
                node={node}
                snap={snap}
                agents={agents}
                patch={patch}
                api={api}
                files={files}
                catalog={catalog}
                onCreateKnowledge={(k) => (close(), openLibrary('knowledge', { tab: k, id: 'new' }))}
                onEditAgent={editable ? () => setTab('agent') : undefined}
                onChangeAgent={onChangeAgent}
                layout="wide"
              />
            </fieldset>
          ) : (
            <div className="orq-stepcfg__agent">
              <div className="orq-stepcfg__shared">
                <p className="orq-hint is-warn">{t('stepcfg.agent.shared', { name: agent?.name ?? node.agentId ?? '' })}</p>
                <button type="button" className="orq-btn orq-btn--small orq-btn--ghost" onClick={() => (close(), openLibrary('agents', { tab: 'agents', id: node.agentId! }))}>
                  <ExternalLink size={14} aria-hidden="true" />
                  {t('stepcfg.agent.openLib')}
                </button>
              </div>
              {agentEditor?.({
                agentId: node.agentId!,
                busy: snap.readOnly,
                onSaved: onAgentSaved,
                onCreateOther: (k, id) => (close(), openLibrary('knowledge', { tab: k, id: id ?? 'new' })),
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
