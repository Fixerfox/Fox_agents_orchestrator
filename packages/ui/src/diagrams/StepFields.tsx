import { ChecksEditor } from './ChecksEditor';
import { BookOpen, Bot, FileText, ListChecks, ShieldCheck, UserCheck, type LucideIcon } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { DEFAULT_MODEL, MAX_TASK_LENGTH, MODELS, COORDINATOR_ID, VERIFY_MAX_COST_USD, coordinatorAgent, limitProblems, type AiReviewMode, type DiagramNode, type ProjectPermission } from '@orquestador/core';
import { extraCount, stepOverrides, t, type EditorSnapshot, type NodePatch, type ProjectApi } from '@orquestador/editor';
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
  /** La ventana «Configurar» tiene la tarea más alta [R64.3]. */
  wide?: boolean;
}

export type StepSectionId = 'task' | 'who' | 'knowledge' | 'files' | 'supervision';

/** Una sección de los ajustes de un paso: la misma en el lateral y en la ventana [R66.1][R66.6]. */
export interface StepSection {
  id: StepSectionId;
  title: string;
  icon: LucideIcon;
  summary: string;
  /** El paso sobrescribe aquí a su agente [R66.2]. */
  changed: boolean;
  content: ReactNode;
}

const modelName = (id: string | undefined) => MODELS.find((m) => m.id === id)?.name ?? id ?? '';

/** Primera línea de la tarea, corta, para el resumen [R66.1]. */
function taskLine(task: string | undefined): string {
  const line = (task ?? '').trim().split('\n')[0]!.trim();
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
}

/** Marca ámbar «cambiado en este paso» [R66.2]. */
export function ChangedMark() {
  return (
    <span className="orq-changed">
      <span className="orq-changed__dot" aria-hidden="true" />
      <span className="orq-sr">{t('stepcfg.changed')}</span>
    </span>
  );
}

/** Las secciones de un paso agente: resúmenes, marcas y campos [R66.1][R66.2][R66.6]. */
export function stepSections({ node, snap, agents, patch, api, files, catalog, onCreateKnowledge, onEditAgent, onChangeAgent, wide = false }: Props): StepSection[] {
  const agent = agentOfNode(agents, node.agentId);
  const incoming = incomingNames(snap.level, node.id);
  const overrides = stepOverrides(node);
  const fromAgent = (agent?.skills?.length ?? 0) + (agent?.contexts?.length ?? 0);
  const line = taskLine(node.task);
  const taskSummary = [line || t('stepcfg.sum.task.empty'), ...(incoming.length > 0 ? [t('stepcfg.sum.receives', { n: incoming.length })] : [])].join(' · ');
  const task = (
    <section className="orq-insp__card" aria-label={t('insp.card.task')}>
      <TaskField key={`${node.id}|${node.task ?? ''}`} api={api} label={node.label ?? node.id} value={node.task ?? ''} rows={wide ? 10 : 5} onCommit={(v) => patch({ task: v })} />
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
    <div className="orq-insp__card">
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
          {agent?.model && <span className="orq-tag">{modelName(agent.model)}</span>}
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
          <option value="">{t('insp.model.agent', { model: modelName(agent?.model ?? DEFAULT_MODEL) })}</option>
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <p className="orq-hint">{t('insp.model.hint')}</p>
    </div>
  );
  const knowledge = (
    <div className="orq-insp__card">
      <div className="orq-insp__sec" role="group" aria-label={t('insp.knowledge')}>
        <span className="orq-insp__label">{t('insp.fromAgent')}</span>
        {fromAgent === 0 ? (
          <p className="orq-hint">{t('insp.knowledge.none')}</p>
        ) : (
          <div className="orq-insp__chips">
            {agent?.skills?.map((k) => (
              <span key={`s-${k}`} className="orq-tag">
                <BookOpen size={12} strokeWidth={1.5} aria-hidden="true" />
                {k}
              </span>
            ))}
            {agent?.contexts?.map((c) => (
              <span key={`c-${c}`} className="orq-tag">
                <FileText size={12} strokeWidth={1.5} aria-hidden="true" />
                {c}
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
    </div>
  );
  const supervision = (
    <div className="orq-insp__card">
      {/* Confirmar antes de terminar, solo en este paso [R43.3]; en fila como los demás interruptores [R63.28]. */}
      <label className="orq-switch">
        <span>{t('insp.confirm')}</span>
        <input type="checkbox" className="orq-toggle" checked={node.confirm === true} onChange={(e) => patch({ confirm: e.target.checked })} />
      </label>
      <p className="orq-hint">{t('insp.confirm.hint')}</p>
      {/* Este paso gestiona ramas: no recibe la regla de la rama ni avisa si cambia [R97.11]. */}
      <label className="orq-switch">
        <span>{t('insp.ownsBranch')}</span>
        <input type="checkbox" className="orq-toggle" checked={node.ownsBranch === true} onChange={(e) => patch({ ownsBranch: e.target.checked })} />
      </label>
      <p className="orq-hint">{t('insp.ownsBranch.hint')}</p>
      {/* Qué hacer con lo que dejó un intento fallido [R71.16]. */}
      <label className="orq-field">
        <span>{t('step.retry')}</span>
        <select aria-label={t('step.retry')} value={node.onRetry ?? 'keep'} onChange={(e) => patch({ onRetry: e.target.value as 'keep' | 'restore' })}>
          <option value="keep">{t('step.retry.keep')}</option>
          <option value="restore">{t('step.retry.restore')}</option>
        </select>
      </label>
      <p className="orq-hint">{t('step.retry.hint')}</p>
      {/* Límites de tiempo propios del paso [R70.21]. */}
      <fieldset className="orq-field orq-insp__limits">
        <legend>{t('step.limits')}</legend>
        {(['idleMinutes', 'toolMinutes', 'maxMinutes'] as const).map((k) => (
          <label key={k} className="orq-field orq-field--inline">
            <span>{t(k === 'idleMinutes' ? 'step.limits.idle' : k === 'toolMinutes' ? 'step.limits.tool' : 'step.limits.max')}</span>
            <input
              type="number"
              min={1}
              aria-label={t(k === 'idleMinutes' ? 'step.limits.idle' : k === 'toolMinutes' ? 'step.limits.tool' : 'step.limits.max')}
              value={node.limits?.[k] ?? ''}
              onChange={(e) => {
                const v = e.target.value === '' ? undefined : Number(e.target.value);
                const next = { ...node.limits, [k]: v };
                if (limitProblems(next).length === 0) patch({ limits: next });
              }}
            />
          </label>
        ))}
        {/* Presupuesto propio de cada intento [R77.9]. */}
        <label className="orq-field orq-field--inline">
          <span>{t('step.limits.cost')}</span>
          <input
            type="number"
            min={0.01}
            step={0.1}
            aria-label={t('step.limits.cost')}
            value={node.limits?.maxCostUsd ?? ''}
            onChange={(e) => {
              const next = { ...node.limits, maxCostUsd: e.target.value === '' ? undefined : Number(e.target.value) };
              if (limitProblems(next).length === 0) patch({ limits: next });
            }}
          />
        </label>
        <p className="orq-hint">{t('step.limits.hint')}</p>
      </fieldset>
      {/* Comprobaciones, revisión con IA y verificador del paso [R75.11][R75.24]. */}
      <ChecksEditor legend={t('checks.title')} checks={node.checks ?? []} onChange={(checks) => patch({ checks })} {...(api ? { onTry: async (c) => { const r = await api.tryCheck(c); return r.ok ? r.value : undefined; } } : {})} />
      <label className="orq-field">
        <span>{t('step.aiReview')}</span>
        <select aria-label={t('step.aiReview')} value={node.aiReview ?? 'always'} onChange={(e) => patch({ aiReview: e.target.value as AiReviewMode })}>
          <option value="always">{t('step.aiReview.always')}</option>
          <option value="final-or-checks">{t('step.aiReview.final')}</option>
          <option value="never">{t('step.aiReview.never')}</option>
        </select>
      </label>
      <label className="orq-switch">
        <span>{t('step.verify')}</span>
        <input type="checkbox" className="orq-toggle" checked={node.verify !== undefined} onChange={(e) => patch({ verify: e.target.checked ? {} : null })} />
      </label>
      {node.verify && (
        <label className="orq-field orq-field--inline">
          <span>{t('step.verify.budget')}</span>
          <input type="number" min={0.05} max={50} step={0.05} aria-label={t('step.verify.budget')} value={node.verify.maxCostUsd ?? VERIFY_MAX_COST_USD} onChange={(e) => patch({ verify: { ...node.verify, maxCostUsd: Number(e.target.value) } })} />
        </label>
      )}
      <p className="orq-hint">{t('step.verify.hint')}</p>
    </div>
  );
  const sections: StepSection[] = [
    { id: 'task', title: t('stepcfg.sec.task'), icon: ListChecks, summary: taskSummary, changed: false, content: task },
    { id: 'who', title: t('stepcfg.sec.who'), icon: Bot, summary: `${agent?.name ?? node.agentId ?? ''} · ${modelName(node.model ?? agent?.model ?? DEFAULT_MODEL)}`, changed: overrides.includes('model'), content: who },
    { id: 'knowledge', title: t('stepcfg.sec.knowledge'), icon: BookOpen, summary: t('stepcfg.sum.knowledge', { agent: fromAgent, step: extraCount(node.extra) }), changed: overrides.includes('extra'), content: knowledge },
  ];
  if (files)
    sections.push({
      id: 'files',
      title: t('stepcfg.sec.files'),
      icon: ShieldCheck,
      summary: t('stepcfg.sum.files', { level: permissionName(files.permissions) }),
      changed: false,
      content: (
        <div className="orq-insp__card">
          <div className="orq-insp__sec" role="group" aria-label={t('insp.files')}>
            <label className="orq-switch">
              <span>{files.folder ? t('insp.files.create', { name: files.folder }) : t('insp.files.createProject')}</span>
              <input type="checkbox" role="switch" checked disabled />
            </label>
            <PermissionPicker legend={t('perm.title')} value={files.permissions} onChange={(level) => level && level !== 'readonly' && files.onPermissions(level)} />
            {agent?.permissions && <p className="orq-hint">{t('insp.files.agentOwn', { level: permissionName(agent.permissions) })}</p>}
            <p className="orq-hint is-warn">{t('stepcfg.files.project')}</p>
          </div>
        </div>
      ),
    });
  sections.push({ id: 'supervision', title: t('stepcfg.sec.supervision'), icon: UserCheck, summary: t(node.confirm ? 'stepcfg.sum.confirm.on' : 'stepcfg.sum.confirm.off'), changed: overrides.includes('confirm'), content: supervision });
  return sections;
}

/** Pestañas del lateral (prototipo D): «Permisos» junta supervisión y archivos [R66.6]. */
export type StepTabId = 'task' | 'who' | 'knowledge' | 'perms';
const TAB_OF: Record<StepSectionId, StepTabId> = { task: 'task', who: 'who', knowledge: 'knowledge', files: 'perms', supervision: 'perms' };
const TAB_KEY: Record<StepTabId, 'stepcfg.tab.task' | 'stepcfg.tab.who' | 'stepcfg.tab.knowledge' | 'stepcfg.tab.perms'> = { task: 'stepcfg.tab.task', who: 'stepcfg.tab.who', knowledge: 'stepcfg.tab.knowledge', perms: 'stepcfg.tab.perms' };
const TAB_ORDER: StepTabId[] = ['task', 'who', 'knowledge', 'perms'];

/** Ajustes de un paso agente en el lateral: pestañas arriba y una sección cada vez [R32.29][R66.6].
 * `tab`/`onTab` los guarda el Diseñador para recordar la pestaña al cambiar de paso. */
export function AgentStepFields({ tab: shared, onTab, ...props }: Props & { tab?: StepTabId | undefined; onTab?: ((tab: StepTabId) => void) | undefined }) {
  const [own, setOwn] = useState<StepTabId>('task');
  const tab = shared ?? own;
  const id = useId();
  const pick = (k: StepTabId) => {
    setOwn(k);
    onTab?.(k);
  };
  const sections = stepSections(props);
  return (
    <div className="orq-steptabs">
      <div className="orq-steptabs__list" role="tablist" aria-label={t('stepcfg.nav')}>
        {TAB_ORDER.map((k) => {
          const mine = sections.filter((s) => TAB_OF[s.id] === k);
          return (
            <button
              key={k}
              type="button"
              role="tab"
              id={`${id}-${k}`}
              aria-selected={tab === k}
              aria-controls={`${id}-panel`}
              title={mine.map((s) => s.summary).join(' · ')}
              className="orq-steptabs__tab"
              onClick={() => pick(k)}
            >
              {t(TAB_KEY[k])}
              {mine.some((s) => s.changed) && <ChangedMark />}
            </button>
          );
        })}
      </div>
      <div className="orq-steptabs__panel" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`}>
        {sections
          .filter((s) => TAB_OF[s.id] === tab)
          .map((s) => (
            <div key={s.id} className="orq-steptabs__sec">
              {tab === 'perms' && <span className="orq-insp__label">{s.title}</span>}
              {s.content}
            </div>
          ))}
      </div>
    </div>
  );
}
