import { BookOpen, Copy, FileText, Trash2, Workflow } from 'lucide-react';
import { DEFAULT_MODEL, MAX_TASK_LENGTH, MODELS, correctionCandidates, finalSteps, type Diagram, type DiagramNode, type ProjectPermission } from '@orquestador/core';
import { PermissionPicker, permissionName } from './PermissionPicker';
import { AgentAvatar, AskFirstMark } from './agentLook';
import { useState, type ReactNode } from 'react';
import { t, type ProjectApi, type EditorSession, type EditorSnapshot, type NodePatch } from '@orquestador/editor';
import type { AgentOption } from './Palette';
import { ExtraKnowledge, type KnowledgeCatalog } from './ExtraKnowledge';
import { ClaudeButton, ClaudeDiff, ClaudeMenu, ClaudeStatus, useClaudeAssist, type AssistConfig } from './editors';
import type { Selection } from './Canvas';
import { TransformPanel } from './TransformPanel';
import { DeliverablePanel } from './DeliverablePanel';
import type { RunEvent } from '@orquestador/core';

interface Props {
  session: EditorSession;
  snap: EditorSnapshot;
  selection: Selection;
  agents: AgentOption[];
  onError: (message: string) => void;
  /** «Editar el agente»: abre Agentes con ese agente [R32.22]. */
  onEditAgent?: (agentId: string) => void;
  /** Tras duplicar, selecciona la copia. */
  onSelect?: (nodeId: string) => void;
  /** «Cambiar»: abre la galería de agentes para este nodo [R32.29]. */
  onChangeAgent?: (nodeId: string) => void;
  /** Para el ✦ de la tarea [R32.29]. */
  api?: ProjectApi;
  /** Bloque «Archivos» (prototipo «Nodo A»): ajustes de escritura de la carpeta de trabajo [R32.29]. */
  files?: { folder?: string | undefined; permissions: ProjectPermission; onPermissions: (level: ProjectPermission) => void };
  /** Skills, contextos y MCP del proyecto para añadirlos a un paso o al diagrama [R33.5][R33.6]. */
  catalog?: KnowledgeCatalog;
  onCreateKnowledge?: (kind: 'skills' | 'contexts' | 'mcp') => void;
  /** Subdiagramas: nombre del diagrama al que apuntan y «Abrir el diagrama» [R33.9]. */
  diagramNames?: Readonly<Record<string, string>>;
  onOpenDiagram?: (id: string) => void;
  /** Eventos de la última ejecución, para la vista previa de «Transformar» [R37.13]. */
  events?: readonly RunEvent[];
  /** «En marcha»: sustituye al aviso de solo lectura cuando no hay nada seleccionado [R38.12]. */
  liveCard?: ReactNode;
}

/** Campo de tarea con ✦ dentro: borrador local, se confirma al salir o al aceptar la propuesta [R32.3][R32.29]. */
function TaskField({ api, label, value, onCommit }: { api?: ProjectApi | undefined; label: string; value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  const commit = (v: string) => v !== value && onCommit(v);
  const config: AssistConfig | undefined = api
    ? { api, kind: 'context', field: 'value', current: { name: t('insp.task.ai.name', { name: label }), value: text }, names: { contexts: {}, skills: {} }, onApply: (f) => typeof f['value'] === 'string' && (setText(f['value']), commit(f['value'])) }
    : undefined;
  const ai = useClaudeAssist(config);
  return (
    <div className="orq-task">
      <div className="orq-task__head">
        <label htmlFor="node-task">{t('inspector.task')}</label>
        {config && <ClaudeButton ai={ai} fieldEmpty={text.trim() === ''} />}
      </div>
      {config && (
        <ClaudeMenu
          ai={ai}
          id="node-task"
          fieldEmpty={text.trim() === ''}
          kind="context"
          labels={text.trim() === '' ? { label: t('insp.task.ai.write'), placeholder: t('insp.task.ai.write.ph') } : { label: t('assist.label.improve'), placeholder: t('assist.placeholder.improve') }}
        />
      )}
      {config && <ClaudeStatus ai={ai} />}
      {config && ai.result ? (
        <ClaudeDiff ai={ai} config={config} />
      ) : (
        <textarea
          id="node-task"
          data-field="task"
          rows={5}
          maxLength={MAX_TASK_LENGTH}
          placeholder={t('inspector.task.placeholder')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => commit(text)}
        />
      )}
    </div>
  );
}

/** Los campos de texto confirman al salir (un paso de historial por edición, no por pulsación). */
function TextField({ label, value, onCommit, multiline, field, placeholder }: { label: string; value: string; onCommit: (v: string) => void; multiline?: boolean; field?: string; placeholder?: string }) {
  const commit = (v: string) => {
    if (v !== value) onCommit(v);
  };
  return (
    <label>
      {label}
      {multiline ? (
        <textarea key={value} rows={4} placeholder={placeholder} defaultValue={value} onBlur={(e) => commit(e.target.value)} />
      ) : (
        <input
          key={value}
          data-field={field}
          defaultValue={value}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
          }}
        />
      )}
    </label>
  );
}

function NumberField({ label, value, min, onCommit }: { label: string; value: number | undefined; min: number; onCommit: (n: number) => void }) {
  return (
    <label>
      {label}
      <input
        key={value}
        type="number"
        min={min}
        defaultValue={value ?? ''}
        onBlur={(e) => {
          const n = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(n) && n !== value) onCommit(n);
        }}
      />
    </label>
  );
}

export function Inspector({ session, snap, selection, agents, onError, onEditAgent, onSelect, onChangeAgent, api, files, catalog, onCreateKnowledge, diagramNames, onOpenDiagram, events, liveCard }: Props) {
  const guard = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };
  const level = snap.level;
  const nodeId = selection.nodes.length === 1 && selection.edges.length === 0 ? selection.nodes[0] : undefined;
  const edgeId = selection.edges.length === 1 && selection.nodes.length === 0 ? selection.edges[0] : undefined;
  const node = nodeId !== undefined ? level.nodes.find((n) => n.id === nodeId) : undefined;
  const edge = edgeId !== undefined ? level.edges.find((e) => e.id === edgeId) : undefined;
  const patch = (id: string, p: NodePatch) => guard(() => session.updateNode(id, p));
  const agentOf = (id: string | undefined) => agents.find((a) => a.id === id);
  const incoming = node ? level.edges.filter((e) => e.to === node.id).map((e) => level.nodes.find((n) => n.id === e.from)).filter((n) => n !== undefined).map((n) => (n.kind === 'entry' ? 'entrada' : (n.label ?? n.id))) : [];

  return (
    <aside className="orq-inspector" aria-label={t('inspector.title')}>
      {liveCard && !node && !edge
        ? liveCard
        : snap.readOnly && (
            <p className="orq-locked" role="status">
              {t('run.locked')}
            </p>
          )}
      <fieldset className="orq-insp__lock" disabled={snap.readOnly}>
      {!node && !edge && (
        <div className="orq-insp">
          <h2 className="orq-insp__dtitle">{snap.diagram.name}</h2>
          <p className="orq-hint">{t('inspector.empty')}</p>
          {catalog && snap.path.length === 0 && (
            <ExtraKnowledge
              label={t('extra.diagram')}
              hint={t('extra.diagram.hint')}
              value={snap.diagram.extra}
              catalog={catalog}
              disabled={snap.readOnly}
              onChange={(extra) => guard(() => session.setDiagramExtra(extra))}
              {...(onCreateKnowledge ? { onCreate: onCreateKnowledge } : {})}
            />
          )}
        </div>
      )}

      {node && (
        <div className="orq-insp">
          <input
            key={`${node.id}|${node.label ?? ''}`}
            className="orq-insp__title"
            data-field="label"
            aria-label={t('inspector.label')}
            defaultValue={node.label ?? node.id}
            onBlur={(e) => e.target.value !== (node.label ?? node.id) && patch(node.id, { label: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
          />

          {node.kind === 'agent' && (
            <>
              <section className="orq-insp__card" aria-label={t('insp.card.task')}>
                <TaskField
                  key={`${node.id}|${node.task ?? ''}`}
                  api={api}
                  label={node.label ?? node.id}
                  value={node.task ?? ''}
                  onCommit={(v) => patch(node.id, { task: v })}
                />
                {incoming.length > 0 && (
                  <div className="orq-insp__recv" aria-label={t('insp.receives')}>
                    <span className="orq-hint">{t('insp.receives')}</span>
                    {incoming.map((x) => (
                      <span key={x} className="orq-tag">
                        @{x}
                      </span>
                    ))}
                  </div>
                )}
                <p className="orq-hint">{t('inspector.task.hint')}</p>
              </section>
              <section className="orq-insp__card">
                <span className="orq-insp__label">{t('inspector.agent.who')}</span>
                <div className="orq-agentcard" role="group" aria-label={t('inspector.agent.who')}>
                  {agentOf(node.agentId)?.icon ? (
                    <AgentAvatar name={agentOf(node.agentId)!.name} icon={agentOf(node.agentId)!.icon} tone={agentOf(node.agentId)!.tone} size="lg" />
                  ) : (
                    <span className="orq-agentcard__av" aria-hidden="true">
                      {(agentOf(node.agentId)?.name ?? node.agentId ?? '?').slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span className="orq-agentcard__text">
                    <strong>{agentOf(node.agentId)?.name ?? node.agentId}</strong>
                    <span className="orq-hint">{agentOf(node.agentId)?.description ?? t('inspector.agent.noDesc')}</span>
                  </span>
                  <div className="orq-agentcard__facts">
                    {agentOf(node.agentId)?.model && <span className="orq-tag">{MODELS.find((m) => m.id === agentOf(node.agentId)?.model)?.name ?? agentOf(node.agentId)?.model}</span>}
                    {agentOf(node.agentId)?.askFirst && (
                      <span className="orq-tag orq-agentf__ask">
                        <AskFirstMark size={12} /> {t('askfirst.mark')}
                      </span>
                    )}
                  </div>
                  <div className="orq-agentcard__acts">
                    <button type="button" className="orq-btn orq-btn--small" aria-label={t('insp.agent.change')} onClick={() => onChangeAgent?.(node.id)}>
                      {t('inspector.agent.change')}
                    </button>
                    {onEditAgent && node.agentId && agents.some((a) => a.id === node.agentId) && (
                      <button type="button" className="orq-btn orq-btn--small orq-btn--ghost" aria-label={t('insp.agent.edit')} onClick={() => onEditAgent(node.agentId!)}>
                        {t('insp.agent.editShort')}
                      </button>
                    )}
                  </div>
                </div>
                {/* Modelo solo para este paso; vacío = el de la ficha del agente [R40.5]. */}
                <label className="orq-insp__model">
                  {t('insp.model')}
                  <select value={node.model ?? ''} onChange={(e) => patch(node.id, { model: e.target.value })}>
                    <option value="">
                      {t('insp.model.agent', { model: MODELS.find((m) => m.id === (agentOf(node.agentId)?.model ?? DEFAULT_MODEL))?.name ?? agentOf(node.agentId)?.model ?? '' })}
                    </option>
                    {MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="orq-hint">{t('insp.model.hint')}</p>
                {/* Confirmar antes de terminar, solo en este paso [R43.3]. */}
                <label className="orq-insp__check">
                  <input type="checkbox" checked={node.confirm === true} onChange={(e) => patch(node.id, { confirm: e.target.checked })} />
                  {t('insp.confirm')}
                </label>
                <p className="orq-hint">{t('insp.confirm.hint')}</p>
              </section>
              <section className="orq-insp__card">
                <div className="orq-insp__sec" role="group" aria-label={t('insp.knowledge')}>
                  <span className="orq-insp__label">{t('insp.knowledge')}</span>
                  {(agentOf(node.agentId)?.skills?.length ?? 0) + (agentOf(node.agentId)?.contexts?.length ?? 0) === 0 ? (
                    <p className="orq-hint">{t('insp.knowledge.none')}</p>
                  ) : (
                    <div className="orq-insp__chips">
                      {agentOf(node.agentId)?.skills?.map((k) => (
                        <span key={`s-${k}`} className="orq-tag">
                          <BookOpen size={12} strokeWidth={1.5} aria-hidden="true" />
                          {k} <span className="orq-hint">· {t('insp.fromAgent')}</span>
                        </span>
                      ))}
                      {agentOf(node.agentId)?.contexts?.map((c) => (
                        <span key={`c-${c}`} className="orq-tag">
                          <FileText size={12} strokeWidth={1.5} aria-hidden="true" />
                          {c} <span className="orq-hint">· {t('insp.fromAgent')}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="orq-hint">{t('insp.knowledge.hint')}</p>
                </div>
                {catalog && (
                  <ExtraKnowledge
                    label={t('extra.node')}
                    hint={t('extra.node.hint')}
                    value={node.extra}
                    inherited={snap.diagram.extra}
                    catalog={catalog}
                    step
                    disabled={snap.readOnly}
                    onChange={(extra) => patch(node.id, { extra })}
                    {...(onCreateKnowledge ? { onCreate: onCreateKnowledge } : {})}
                  />
                )}
              </section>
              {files && (
                <section className="orq-insp__card">
                  <div className="orq-insp__sec" role="group" aria-label={t('insp.files')}>
                    <span className="orq-insp__label">{t('insp.files')}</span>
                    <label className="orq-switch">
                      <span>{files.folder ? t('insp.files.create', { name: files.folder }) : t('insp.files.createProject')}</span>
                      <input type="checkbox" role="switch" checked disabled />
                    </label>
                    <PermissionPicker legend={t('perm.title')} value={files.permissions} onChange={(level) => level && level !== 'readonly' && files.onPermissions(level)} />
                    {agentOf(node.agentId)?.permissions && <p className="orq-hint">{t('insp.files.agentOwn', { level: permissionName(agentOf(node.agentId)!.permissions!) })}</p>}
                    <p className="orq-hint">{t('insp.files.hint')}</p>
                  </div>
                </section>
              )}
            </>
          )}

          {node.kind === 'router' && (
            <label>
              {t('inspector.router.mode')}
              <select value={node.router?.mode ?? 'ai'} onChange={(e) => patch(node.id, { router: { mode: e.target.value as 'ai' | 'rules' } })}>
                <option value="ai">{t('inspector.router.ai')}</option>
                <option value="rules">{t('inspector.router.rules')}</option>
              </select>
            </label>
          )}
          {node.kind === 'router' && <p className="orq-hint orq-sees">{t((node.router?.mode ?? 'ai') === 'ai' ? 'insp.sees.router.ai' : 'insp.sees.router.rules')}</p>}

          {node.kind === 'transform' && node.transform && (
            <TransformPanel key={node.id} node={{ ...node, transform: node.transform }} level={level} path={snap.path} events={events ?? []} incoming={incoming} patch={(p) => patch(node.id, p)} />
          )}

          {node.kind === 'subdiagram' && node.subdiagram && (
            <div className="orq-insp__sec" role="group" aria-label={t('sub.uses')}>
              <span className="orq-insp__label">{t('sub.uses')}</span>
              <div className="orq-agentcard">
                <span className="orq-agentcard__av" aria-hidden="true">
                  <Workflow size={16} strokeWidth={1.5} />
                </span>
                <span className="orq-agentcard__text">
                  <strong>{diagramNames?.[node.subdiagram.templateId] ?? node.subdiagram.templateId}</strong>
                  {diagramNames && !diagramNames[node.subdiagram.templateId] && <span className="orq-field__error">{t('sub.missing')}</span>}
                </span>
                {onOpenDiagram && diagramNames?.[node.subdiagram.templateId] && (
                  <span className="orq-agentcard__acts">
                    <button type="button" className="orq-btn orq-btn--small" onClick={() => onOpenDiagram(node.subdiagram!.templateId)}>
                      {t('sub.open')}
                    </button>
                  </span>
                )}
              </div>
              {incoming.length > 0 && (
                <div className="orq-insp__recv" aria-label={t('insp.receives')}>
                  <span className="orq-hint">{t('insp.receives')}</span>
                  {incoming.map((x) => (
                    <span key={x} className="orq-tag">
                      @{x}
                    </span>
                  ))}
                </div>
              )}
              <p className="orq-hint">{t('sub.latest')}</p>
            </div>
          )}

          {node.kind === 'loop' && node.loop && (
            <>
              <label>
                {t('inspector.loop.mode')}
                <select
                  value={node.loop.mode}
                  onChange={(e) => patch(node.id, { loop: { mode: e.target.value as 'count' | 'ai-judge' } })}
                >
                  <option value="count">{t('inspector.loop.count')}</option>
                  <option value="ai-judge">{t('inspector.loop.aiJudge')}</option>
                </select>
              </label>
              {node.loop.mode === 'count' ? (
                <NumberField label={t('inspector.loop.times')} min={1} value={node.loop.count} onCommit={(n) => patch(node.id, { loop: { count: n } })} />
              ) : (
                <TextField
                  label={t('inspector.loop.prompt')}
                  multiline
                  value={node.loop.prompt ?? ''}
                  placeholder={t('insp.loop.prompt.ph')}
                  onCommit={(v) => patch(node.id, { loop: { prompt: v } })}
                />
              )}
              {node.loop.mode === 'ai-judge' && (
                <p className="orq-hint orq-sees">{t('insp.sees.loop')}</p>
              )}
              <NumberField label={t('inspector.loop.max')} min={1} value={node.loop.maxIterations} onCommit={(n) => patch(node.id, { loop: { maxIterations: n } })} />
            </>
          )}

          {node.kind === 'review' && node.review && (
            <>
              <NumberField label={t('insp.review.max')} min={1} value={node.review.maxRounds} onCommit={(n) => patch(node.id, { review: { maxRounds: n } })} />
              <label>
                {t('insp.review.mode')}
                <select value={node.review.mode} onChange={(e) => patch(node.id, { review: { mode: e.target.value as 'verdict' | 'ai' | 'human' } })}>
                  <option value="verdict">{t('insp.review.mode.verdict')}</option>
                  <option value="ai">{t('insp.review.mode.ai')}</option>
                  <option value="human">{t('insp.review.mode.human')}</option>
                </select>
              </label>
              {node.review.mode === 'human' ? (
                <HumanReviewFields node={node} level={level} onRoute={(route) => patch(node.id, { review: { route } })} />
              ) : (
                <TextField label={t('insp.review.criteria')} multiline value={node.review.criteria ?? ''} placeholder={t('insp.review.criteria.ph')} onCommit={(v) => patch(node.id, { review: { criteria: v } })} />
              )}
              {node.review.mode === 'verdict' && <p className="orq-hint">{t('insp.review.howto')}</p>}
              <p className="orq-hint">{t(node.review.mode === 'human' ? 'insp.review.ports.human' : 'insp.review.ports')}</p>
              <p className="orq-hint orq-sees">{node.review.mode === 'human' ? t('insp.sees.review.human') : `${t('insp.sees.review')} ${t('insp.sees.review.back')}`}</p>
            </>
          )}

          {/* Entregable de la ejecución: solo en la Salida del diagrama principal [R46.13]. */}
          {node.kind === 'output' && snap.path.length === 0 && (
            <DeliverablePanel
              value={snap.diagram.deliverable}
              finals={finalSteps(snap.diagram).map((id) => snap.diagram.nodes.find((n) => n.id === id)?.label ?? id)}
              disabled={snap.readOnly}
              onChange={(spec) => guard(() => session.setDeliverable(spec))}
            />
          )}

          {node.kind !== 'entry' && node.kind !== 'output' && (
            <div className="orq-insp__foot">
              <button
                type="button"
                className="orq-btn orq-btn--small"
                onClick={() =>
                  guard(() => {
                    const id = session.duplicateNode(node.id);
                    onSelect?.(id);
                  })
                }
              >
                <Copy size={14} aria-hidden="true" /> {t('insp.duplicate')}
              </button>
              <button type="button" className="orq-btn orq-btn--small orq-btn--remove" onClick={() => guard(() => session.removeSelection({ nodes: [node.id] }))}>
                <Trash2 size={14} aria-hidden="true" /> {t('inspector.node.delete')}
              </button>
            </div>
          )}

        </div>
      )}

      {edge && (
        <div>
          <h3>{t('inspector.edge.title')}</h3>
          <button type="button" className="orq-btn orq-btn--danger" onClick={() => guard(() => session.removeSelection({ edges: [edge.id] }))}>
            <Trash2 size={16} aria-hidden="true" /> {t('inspector.edge.delete')}
          </button>
          {level.nodes.find((n) => n.id === edge.from)?.kind === 'router' ? (
            <>
              <TextField
                field="condition"
                label={t('inspector.edge.condition')}
                value={edge.condition ?? ''}
                onCommit={(v) => guard(() => session.setCondition(edge.id, v))}
              />
              <p className="orq-hint">{t('inspector.edge.condition.hint')}</p>
            </>
          ) : edge.port ? (
            <p className="orq-hint">{t(`review.port.${edge.port}`)}</p>
          ) : (
            <p className="orq-hint">{t('inspector.edge.notRouter')}</p>
          )}
        </div>
      )}
      </fieldset>
    </aside>
  );
}

/** Revisión humana: a dónde van los cambios y a qué pasos puede volver [R53.16]. */
function HumanReviewFields({ node, level, onRoute }: { node: DiagramNode; level: Diagram; onRoute: (route: 'propose' | 'auto') => void }) {
  const drawn = level.edges.some((e) => e.from === node.id && e.port === 'rejected');
  if (drawn) return <p className="orq-hint">{t('insp.review.route.drawn')}</p>;
  const names = correctionCandidates(level, node.id).map((id) => {
    const n = level.nodes.find((x) => x.id === id);
    return n?.label ?? n?.agentId ?? id;
  });
  const route = node.review?.route ?? 'propose';
  return (
    <>
      <p className="orq-hint">{t('insp.review.human.help')}</p>
      <div className="orq-insp__routes">
        <span className="orq-insp__routes-label" id={`route-${node.id}`}>
          {t('insp.review.route')}
        </span>
        <div className="orq-insp__pills" role="radiogroup" aria-labelledby={`route-${node.id}`}>
          {(['propose', 'auto'] as const).map((r) => (
            <label key={r} className={`orq-pick${route === r ? ' is-on' : ''}`}>
              <input type="radio" name={`route-${node.id}`} checked={route === r} onChange={() => onRoute(r)} />
              {t(r === 'propose' ? 'insp.review.route.propose' : 'insp.review.route.auto')}
            </label>
          ))}
        </div>
        <p className="orq-hint">{t(route === 'propose' ? 'insp.review.route.propose.hint' : 'insp.review.route.auto.hint')}</p>
      </div>
      {names.length > 0 ? (
        <div className="orq-insp__routes">
          <span className="orq-insp__routes-label">{t('insp.review.targets.title')}</span>
          <ul className="orq-insp__targets">
            {names.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="orq-hint is-warn">{t('insp.review.targets.none')}</p>
      )}
    </>
  );
}
