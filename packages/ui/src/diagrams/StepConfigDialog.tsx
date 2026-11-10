import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowUpRight, ExternalLink, RotateCcw, X } from 'lucide-react';
import { resetStepPatch, stepOverrides, t, type EditorSession, type EditorSnapshot, type NodePatch, type ProjectApi } from '@orquestador/editor';
import { AgentAvatar, type OpenLibrary } from '../common';
import type { KnowledgeCatalog } from './ExtraKnowledge';
import type { AgentOption } from './Palette';
import { ChangedMark, agentOfNode, stepSections, type StepFiles, type StepSectionId } from './StepFields';

/** Qué enseña la ventana: los ajustes del paso o la ficha del agente [R66.3]. */
export type StepConfigTab = 'step' | 'agent';

/** La ficha del agente la pone el shell (viene de Agentes, otro contexto) [R56.19][R64.4]. */
export type AgentEditorSlot = (p: { agentId: string; busy: boolean; onSaved: () => void; onCreateOther: (tab: 'contexts' | 'skills' | 'mcp', id?: string) => void }) => ReactNode;

interface Props {
  api: ProjectApi;
  session: EditorSession;
  snap: EditorSnapshot;
  nodeId: string;
  initialTab?: StepConfigTab;
  initialSection?: StepSectionId;
  agents: readonly AgentOption[];
  /** Sin él no hay «Editar el agente». */
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

/** Ventana «Configurar» de un paso agente: índice con una sección cada vez y la ficha del agente dentro [R64.1–R64.6][R66.1–R66.4]. */
export function StepConfigDialog({ api, session, snap, nodeId, initialTab = 'step', initialSection = 'task', agents, agentEditor, catalog, files, onClose, onError, onChangeAgent, onAgentSaved, openLibrary }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const node = snap.level.nodes.find((n) => n.id === nodeId && n.kind === 'agent');
  const agent = node ? agentOfNode(agents, node.agentId) : undefined;
  const editable = agent?.editable === true && agentEditor !== undefined;
  const [view, setView] = useState<StepConfigTab>(initialTab === 'agent' && editable ? 'agent' : 'step');
  const [section, setSection] = useState<StepSectionId>(initialSection);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  useEffect(() => {
    if (!editable && view === 'agent') setView('step');
  }, [editable, view]);

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
  const sections = stepSections({
    node,
    snap,
    agents,
    patch,
    api,
    files,
    catalog,
    onCreateKnowledge: (k) => (close(), openLibrary('knowledge', { tab: k, id: 'new' })),
    // «Editar el agente» solo vive al pie del índice: un único sitio [R66.3].
    onChangeAgent,
    wide: true,
  });
  const current = sections.find((s) => s.id === section) ?? sections[0]!;
  const changes = stepOverrides(node).length;
  const reset = resetStepPatch(node);

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
      <div ref={ref} tabIndex={-1} className="orq-picker orq-stepcfg" role="dialog" aria-modal="true" aria-label={title}>
        <header className="orq-stepcfg__head">
          {agent?.icon ? (
            <AgentAvatar name={agent.name} icon={agent.icon} tone={agent.tone} size="lg" />
          ) : (
            <span className="orq-agentcard__av" aria-hidden="true">
              {(agent?.name ?? node.agentId ?? '?').slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className="orq-stepcfg__ident">
            <input
              key={`${node.id}|${node.label ?? ''}`}
              className="orq-stepcfg__name"
              data-field="label"
              aria-label={t('inspector.label')}
              defaultValue={node.label ?? node.id}
              disabled={snap.readOnly}
              onBlur={(e) => e.target.value !== (node.label ?? node.id) && patch({ label: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
            />
            <span className="orq-hint">{agent?.name ?? node.agentId}</span>
          </div>
          {changes > 0 && <span className="orq-stepcfg__badge">{changes === 1 ? t('stepcfg.changes.one') : t('stepcfg.changes.many', { n: changes })}</span>}
          <button type="button" className="orq-icon-btn" aria-label={t('picker.close')} title={t('picker.close')} onClick={close}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        {view === 'step' ? (
          <div className="orq-stepcfg__main">
            <nav className="orq-stepcfg__nav" aria-label={t('stepcfg.nav')}>
              {sections.map((s) => {
                const Icon = s.icon;
                return (
                  <button key={s.id} type="button" className="orq-stepcfg__item" aria-current={s.id === current.id ? 'page' : undefined} onClick={() => setSection(s.id)}>
                    <Icon size={16} strokeWidth={1.7} aria-hidden="true" className="orq-stepcfg__icon" />
                    <span className="orq-stepcfg__itext">
                      <span className="orq-stepcfg__ititle">
                        {s.title}
                        {s.changed && <ChangedMark />}
                      </span>
                      <span className="orq-stepcfg__isum">{s.summary}</span>
                    </span>
                  </button>
                );
              })}
              {editable && (
                <div className="orq-stepcfg__agentlink">
                  <button type="button" className="orq-link" onClick={() => setView('agent')}>
                    {t('stepcfg.editAgent')}
                    <ArrowUpRight size={14} aria-hidden="true" />
                  </button>
                  <span className="orq-hint">{t('stepcfg.editAgent.hint')}</span>
                </div>
              )}
            </nav>
            <fieldset className="orq-insp__lock orq-stepcfg__body" disabled={snap.readOnly}>
              {snap.readOnly && (
                <p className="orq-locked" role="status">
                  {t('run.locked')}
                </p>
              )}
              <h3 className="orq-stepcfg__sectitle">{current.title}</h3>
              {current.content}
            </fieldset>
          </div>
        ) : (
          <div className="orq-stepcfg__agent">
            <div className="orq-stepcfg__shared">
              <button type="button" className="orq-btn orq-btn--small orq-btn--ghost" onClick={() => setView('step')}>
                <ArrowLeft size={14} aria-hidden="true" />
                {t('stepcfg.back')}
              </button>
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

        {view === 'step' && (
          <footer className="orq-stepcfg__foot">
            <span className="orq-hint">{t('stepcfg.foot')}</span>
            <button type="button" className="orq-btn" title={t('stepcfg.reset.hint')} disabled={!reset || snap.readOnly} onClick={() => reset && patch(reset)}>
              <RotateCcw size={14} aria-hidden="true" />
              {t('stepcfg.reset')}
            </button>
            <button type="button" className="orq-btn orq-btn--primary" onClick={close}>
              {t('stepcfg.done')}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
