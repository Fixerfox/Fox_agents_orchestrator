import { BookOpen, FileText } from 'lucide-react';
import { useId, useState } from 'react';
import { DEFAULT_MODEL, MAX_TASK_LENGTH, MODELS, COORDINATOR_ID, coordinatorAgent, type DiagramNode, type ProjectPermission } from '@orquestador/core';
import { t, type EditorSnapshot, type NodePatch, type ProjectApi } from '@orquestador/editor';
import { AgentAvatar, AskFirstMark, ClaudeButton, ClaudeDiff, ClaudeMenu, ClaudeStatus, PermissionPicker, permissionName, useClaudeAssist, type AssistConfig } from '../common';
import { ExtraKnowledge, type KnowledgeCatalog } from './ExtraKnowledge';
import type { AgentOption } from './Palette';

/** Ajustes de escritura de la carpeta de trabajo (bloque «Archivos») [R32.29]. */
export interface StepFiles {
  folder?: string | undefined;
  permissions: ProjectPermission;
  onPermissions: (level: ProjectPermission) => void;
}

const COORDINATOR = coordinatorAgent();

/** El agente de un paso: el Coordinador o uno de la galería. */
export function agentOfNode(agents: readonly AgentOption[], id: string | undefined): AgentOption | undefined {
  return id === COORDINATOR_ID ? COORDINATOR : agents.find((a) => a.id === id);
}

/** Nombres de los pasos que llegan a un nodo, para «Recibe:» [R32.29]. */
export function incomingNames(level: EditorSnapshot['level'], nodeId: string): string[] {
  return level.edges
    .filter((e) => e.to === nodeId)
    .map((e) => level.nodes.find((n) => n.id === e.from))
    .filter((n) => n !== undefined)
    .map((n) => (n.kind === 'entry' ? 'entrada' : (n.label ?? n.id)));
}

/** Campo de tarea con ✦ dentro: borrador local, se confirma al salir o al aceptar la propuesta [R32.3][R32.29]. */
function TaskField({ api, label, value, onCommit, rows = 5 }: { api?: ProjectApi | undefined; label: string; value: string; onCommit: (v: string) => void; rows?: number }) {
  const [text, setText] = useState(value);
  const id = useId();
  const commit = (v: string) => v !== value && onCommit(v);
  const config: AssistConfig | undefined = api
    ? { api, kind: 'context', field: 'value', current: { name: t('insp.task.ai.name', { name: label }), value: text }, names: { contexts: {}, skills: {} }, onApply: (f) => typeof f['value'] === 'string' && (setText(f['value']), commit(f['value'])) }
    : undefined;
  const ai = useClaudeAssist(config);
  return (
    <div className="orq-task">
      <div className="orq-task__head">
        <label htmlFor={id}>{t('inspector.task')}</label>
        {config && <ClaudeButton ai={ai} fieldEmpty={text.trim() === ''} />}
      </div>
      {config && (
        <ClaudeMenu
          ai={ai}
          id={id}
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
          id={id}
          data-field="task"
          rows={rows}
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

interface Props {
  node: DiagramNode;
  snap: EditorSnapshot;
  agents: readonly AgentOption[];
  patch: (p: NodePatch) => void;
  api?: ProjectApi | undefined;
  files?: StepFiles | undefined;
  catalog?: KnowledgeCatalog | undefined;
  onCreateKnowledge?: ((kind: 'skills' | 'contexts' | 'mcp') => void) | undefined;
  /** «Editar» del agente [R32.22][R64.4]. */
  onEditAgent?: ((agentId: string) => void) | undefined;
  /** «Cambiar»: abre la galería de agentes para este paso [R32.29]. */
  onChangeAgent?: ((nodeId: string) => void) | undefined;
  /** `wide`: la ventana «Configurar» en dos columnas, con la tarea más alta [R64.3]. */
  layout?: 'side' | 'wide';
}

/** Ajustes de un paso agente: los mismos en el lateral y en la ventana «Configurar» [R32.29][R64.3]. */
export function AgentStepFields({ node, snap, agents, patch, api, files, catalog, onCreateKnowledge, onEditAgent, onChangeAgent, layout = 'side' }: Props) {
  const agent = agentOfNode(agents, node.agentId);
  const incoming = incomingNames(snap.level, node.id);
  const wide = layout === 'wide';
  const task = (
    <section className="orq-insp__card" aria-label={t('insp.card.task')}>
      <TaskField key={`${node.id}|${node.task ?? ''}`} api={api} label={node.label ?? node.id} value={node.task ?? ''} rows={wide ? 16 : 5} onCommit={(v) => patch({ task: v })} />
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
  );
  const who = (
    <section className="orq-insp__card">
      <span className="orq-insp__label">{t('inspector.agent.who')}</span>
      <div className="orq-agentcard" role="group" aria-label={t('inspector.agent.who')}>
        {agent?.icon ? (
          <AgentAvatar name={agent.name} icon={agent.icon} tone={agent.tone} size="lg" />
        ) : (
          <span className="orq-agentcard__av" aria-hidden="true">
            {(agent?.name ?? node.agentId ?? '?').slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="orq-agentcard__text">
          <strong>{agent?.name ?? node.agentId}</strong>
          <span className="orq-hint">{agent?.description ?? t('inspector.agent.noDesc')}</span>
        </span>
        <div className="orq-agentcard__facts">
          {agent?.model && <span className="orq-tag">{MODELS.find((m) => m.id === agent.model)?.name ?? agent.model}</span>}
          {agent?.askFirst && (
            <span className="orq-tag orq-agentf__ask">
              <AskFirstMark size={12} /> {t('askfirst.mark')}
            </span>
          )}
        </div>
        <div className="orq-agentcard__acts">
          {node.agentId !== COORDINATOR_ID && (
            <button type="button" className="orq-btn orq-btn--small" aria-label={t('insp.agent.change')} onClick={() => onChangeAgent?.(node.id)}>
              {t('inspector.agent.change')}
            </button>
          )}
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
        <select value={node.model ?? ''} onChange={(e) => patch({ model: e.target.value })}>
          <option value="">{t('insp.model.agent', { model: MODELS.find((m) => m.id === (agent?.model ?? DEFAULT_MODEL))?.name ?? agent?.model ?? '' })}</option>
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <p className="orq-hint">{t('insp.model.hint')}</p>
      {/* Confirmar antes de terminar, solo en este paso [R43.3]. */}
      {/* En fila, como los demás interruptores: `.orq-inspector label` lo apilaba [R63.28]. */}
      <label className="orq-switch">
        <span>{t('insp.confirm')}</span>
        <input type="checkbox" checked={node.confirm === true} onChange={(e) => patch({ confirm: e.target.checked })} />
      </label>
      <p className="orq-hint">{t('insp.confirm.hint')}</p>
    </section>
  );
  const knowledge = (
    <section className="orq-insp__card">
      <div className="orq-insp__sec" role="group" aria-label={t('insp.knowledge')}>
        <span className="orq-insp__label">{t('insp.knowledge')}</span>
        {(agent?.skills?.length ?? 0) + (agent?.contexts?.length ?? 0) === 0 ? (
          <p className="orq-hint">{t('insp.knowledge.none')}</p>
        ) : (
          <div className="orq-insp__chips">
            {agent?.skills?.map((k) => (
              <span key={`s-${k}`} className="orq-tag">
                <BookOpen size={12} strokeWidth={1.5} aria-hidden="true" />
                {k} <span className="orq-hint">· {t('insp.fromAgent')}</span>
              </span>
            ))}
            {agent?.contexts?.map((c) => (
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
          onChange={(extra) => patch({ extra })}
          {...(onCreateKnowledge ? { onCreate: onCreateKnowledge } : {})}
        />
      )}
    </section>
  );
  const filesCard = files && (
    <section className="orq-insp__card">
      <div className="orq-insp__sec" role="group" aria-label={t('insp.files')}>
        <span className="orq-insp__label">{t('insp.files')}</span>
        <label className="orq-switch">
          <span>{files.folder ? t('insp.files.create', { name: files.folder }) : t('insp.files.createProject')}</span>
          <input type="checkbox" role="switch" checked disabled />
        </label>
        <PermissionPicker legend={t('perm.title')} value={files.permissions} onChange={(level) => level && level !== 'readonly' && files.onPermissions(level)} />
        {agent?.permissions && <p className="orq-hint">{t('insp.files.agentOwn', { level: permissionName(agent.permissions) })}</p>}
        <p className="orq-hint">{t('insp.files.hint')}</p>
      </div>
    </section>
  );
  if (!wide)
    return (
      <>
        {task}
        {who}
        {knowledge}
        {filesCard}
      </>
    );
  return (
    <div className="orq-stepcfg__cols">
      <div className="orq-stepcfg__col">{task}</div>
      <div className="orq-stepcfg__col">
        {who}
        {knowledge}
        {filesCard}
      </div>
    </div>
  );
}
