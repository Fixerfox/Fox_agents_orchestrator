import type { Dispatch, SetStateAction } from 'react';
import { BookOpen, FileText, Plug } from 'lucide-react';
import { LIMITS, MODELS, type AgentDefinition, type ContextDefinition, type ProjectPermission, type SkillDefinition } from '@orquestador/core';
import { t, type MessageKey, type McpView, type ProjectApi } from '@orquestador/editor';
import { AgentAvatar, AskFirstMark, AssignPicker, AssignedField, Field, MarkdownField, PermissionPicker, permissionName } from '../common';
import { IconPicker } from './IconPicker';

export type AssignKind = 'contexts' | 'skills' | 'mcp';
export type RequiredKey = 'skillIds' | 'contextIds' | 'mcpIds';

/** Lo que comparten las piezas de la ficha: el borrador y cómo cambiarlo. */
export interface AgentDraftProps {
  draft: AgentDefinition;
  set: (patch: Partial<AgentDefinition>) => void;
  errors: Record<string, string>;
}

interface Library {
  contexts: ContextDefinition[];
  skills: SkillDefinition[];
}

/** Quién es y cómo trabaja: nombre, descripción e instrucciones [R57.3]. */
export function AgentWhatPart({ api, draft, set, errors, isNew, contexts, skills }: AgentDraftProps & Library & { api: ProjectApi; isNew: boolean }) {
  return (
    <>
      <section className="orq-mcpf__sec" aria-label={t('agent.sec.who')}>
        <div className="orq-mcpf__grid">
          <Field label={t('agent.name')} id="agent-name" error={errors['name']}>
            <input id="agent-name" value={draft.name} aria-invalid={Boolean(errors['name'])} aria-describedby={errors['name'] ? 'agent-name-error' : undefined} onChange={(e) => set({ name: e.target.value })} autoFocus={isNew} />
          </Field>
          <Field label={t('agent.description')} id="agent-desc" error={errors['description']}>
            <input id="agent-desc" value={draft.description} placeholder={t('lib.purpose.hint')} onChange={(e) => set({ description: e.target.value })} />
          </Field>
        </div>
      </section>
      <section className="orq-mcpf__sec orq-agentf__instr" aria-label={t('agent.sec.how')}>
          <MarkdownField
            id="agent-instr"
            label={t('agent.instructions')}
            value={draft.instructions}
            max={LIMITS.instructions}
            error={errors['instructions']}
            onChange={(v) => set({ instructions: v })}
            assist={{
              api,
              kind: 'agent',
              field: 'instructions',
              current: { name: draft.name, description: draft.description, instructions: draft.instructions, model: draft.model, contextIds: draft.contextIds, skillIds: draft.skillIds ?? [] },
              names: { contexts: Object.fromEntries(contexts.map((c) => [c.id, c.name])), skills: Object.fromEntries(skills.map((k) => [k.id, k.name])) },
              onApply: (f) => set(f as Partial<AgentDefinition>),
            }}
          />
      </section>
    </>
  );
}

/** Qué sabe: skills, contextos y MCP [R57.3]. */
export function AgentKnowPart({ draft, set, errors, contexts, skills, mcp, suggested, nameOf, setAssign, onCreateOther, toggleRequired, withoutRequired }: AgentDraftProps & Library & {
  mcp: McpView[];
  suggested: { skills: string[]; contexts: string[] } | undefined;
  nameOf: (list: { id: string; name: string }[], x: string) => string;
  setAssign: (kind: AssignKind) => void;
  onCreateOther: (tab: AssignKind, id?: string) => void;
  toggleRequired: (k: RequiredKey, x: string) => Partial<AgentDefinition>;
  withoutRequired: (k: RequiredKey, x: string) => Partial<AgentDefinition>;
}) {
  return (
    <>
      {suggested && suggested.skills.length + suggested.contexts.length > 0 && (
        <p className="orq-hint orq-agentw__suggested">{t('agentw.suggested', { list: [...suggested.skills.map((x) => nameOf(skills, x)), ...suggested.contexts.map((x) => nameOf(contexts, x))].join(', ') })}</p>
      )}
      <section className="orq-mcpf__sec" aria-label={t('agent.sec.know')}>
        <p className="orq-hint">{t('agent.sec.know.hint')}</p>
        <div className="orq-agentf__know">
          <AssignedField
            legend={t('agent.skills')}
            icon={BookOpen}
            items={skills}
            selected={draft.skillIds ?? []}
            noneText={t('assign.none.skills')}
            addLabel={t('assign.add.skills')}
            error={errors['skillIds']}
            onOpen={() => setAssign('skills')}
            onRemove={(x) => set({ skillIds: (draft.skillIds ?? []).filter((y) => y !== x), ...withoutRequired('skillIds', x) })}
            requiredIds={draft.required?.skillIds ?? []}
            onToggleRequired={(x) => set(toggleRequired('skillIds', x))}
            onShow={(x) => onCreateOther('skills', x)}
          />
          <AssignedField
            legend={t('agent.contexts')}
            icon={FileText}
            items={contexts}
            selected={draft.contextIds}
            noneText={t('assign.none.contexts')}
            addLabel={t('assign.add.contexts')}
            error={errors['contextIds']}
            onOpen={() => setAssign('contexts')}
            onRemove={(x) => set({ contextIds: (draft.contextIds ?? []).filter((y) => y !== x), ...withoutRequired('contextIds', x) })}
            requiredIds={draft.required?.contextIds ?? []}
            onToggleRequired={(x) => set(toggleRequired('contextIds', x))}
            onShow={(x) => onCreateOther('contexts', x)}
          />
          <AssignedField
            legend={t('agent.mcp')}
            icon={Plug}
            items={mcp.map((m) => ({ id: m.id, name: m.enabled ? m.name : `${m.name} (${t('mcp.off').toLowerCase()})` }))}
            selected={draft.mcpIds ?? []}
            noneText={t('assign.none.mcp')}
            addLabel={t('assign.add.mcp')}
            error={errors['mcpIds']}
            onOpen={() => setAssign('mcp')}
            onRemove={(x) => set({ mcpIds: (draft.mcpIds ?? []).filter((y) => y !== x), ...withoutRequired('mcpIds', x) })}
            requiredIds={draft.required?.mcpIds ?? []}
            onToggleRequired={(x) => set(toggleRequired('mcpIds', x))}
            onShow={(x) => onCreateOther('mcp', x)}
          />
        </div>
      </section>
    </>
  );
}

/** Qué puede hacer: preguntar antes y permisos [R57.3]. */
export function AgentCanPart({ draft, set, projectLevel }: Pick<AgentDraftProps, 'draft' | 'set'> & { projectLevel: ProjectPermission }) {
  return (
    <>
      <section className="orq-editor__side-sec" aria-label={t('agent.behaviour')}>
        <h3>{t('agent.behaviour')}</h3>
        <label className="orq-switch">
          <span className="orq-switch__label">
            <AskFirstMark />
            {t('agent.askFirst')}
          </span>
          <input type="checkbox" role="switch" checked={draft.askFirst === true} onChange={(e) => set(e.target.checked ? { askFirst: true } : { askFirst: undefined })} />
        </label>
        <p className="orq-hint">{t(draft.askFirst ? 'agent.askFirst.on' : 'agent.askFirst.off')}</p>
      </section>
      <section className="orq-editor__side-sec" aria-label={t('agent.permissions')}>
        <h3>{t('agent.permissions')}</h3>
        <PermissionPicker legend={t('agent.permissions.legend')} agent project={projectLevel} value={draft.permissions} onChange={(permissions) => set({ permissions })} />
      </section>
    </>
  );
}

/** Modelo y opciones avanzadas [R57.3]. */
export function AgentModelPart({ draft, set, errors, id, turns, setTurns, setSaved }: AgentDraftProps & { id: string; turns: string; setTurns: (value: string) => void; setSaved: Dispatch<SetStateAction<boolean>> }) {
  return (
    <>
      <section className="orq-editor__side-sec">
        <Field label={t('agent.model')} id="agent-model" error={errors['model']}>
          <select id="agent-model" value={draft.model} onChange={(e) => set({ model: e.target.value })}>
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
      </section>
      <details className="orq-editor__adv">
        <summary>{t('lib.advanced')}</summary>
        <p className="orq-hint orq-form__id">
          {t('agent.id')}: <code>{id}</code>
        </p>
        <Field label={t('agent.maxTurns')} id="agent-turns" error={errors['maxTurns']}>
          <input id="agent-turns" type="number" min={1} max={200} value={turns} onChange={(e) => (setTurns(e.target.value), setSaved(false))} />
        </Field>
      </details>
    </>
  );
}

/** Vista previa del agente, con su icono [R57.3]. */
export function AgentPreview({ draft, set }: Pick<AgentDraftProps, 'draft' | 'set'>) {
  return (
    <section className="orq-editor__side-sec orq-agentf__card" aria-label={t('agent.preview')}>
      <div className="orq-agentf__id">
        <AgentAvatar name={draft.name || '?'} icon={draft.icon} tone={draft.tone} size="lg" />
        <div>
          <strong>{draft.name || t('lib.untitled')}</strong>
          <span className="orq-hint">{draft.description || t('lib.noDesc')}</span>
        </div>
      </div>
      <div className="orq-agentf__facts">
        <span className="orq-tag">{MODELS.find((m) => m.id === draft.model)?.name ?? draft.model}</span>
        <span className="orq-tag">{t('agent.facts.know', { skills: (draft.skillIds ?? []).length, contexts: draft.contextIds.length, mcp: (draft.mcpIds ?? []).length })}</span>
        {draft.permissions && <span className="orq-tag">{t('agent.facts.permissions', { level: permissionName(draft.permissions) })}</span>}
        {draft.askFirst && (
          <span className="orq-tag orq-agentf__ask">
            <AskFirstMark size={12} /> {t('askfirst.mark')}
          </span>
        )}
      </div>
      <IconPicker name={draft.name} icon={draft.icon} tone={draft.tone} onChange={(icon, tone) => set({ icon, tone })} />
    </section>
  );
}

/** Diálogos de asignar contextos, MCP y skills al agente. */
export function AgentAssign({ assign, setAssign, draft, set, contexts, skills, mcp, onCreateOther }: Pick<AgentDraftProps, 'draft' | 'set'> & Library & {
  assign: AssignKind | undefined;
  setAssign: (kind: AssignKind | undefined) => void;
  mcp: McpView[];
  onCreateOther: (tab: AssignKind, id?: string) => void;
}) {
  return (
    <>
    {assign === 'contexts' && (
      <AssignPicker
        title={t('assign.title.contexts')}
        icon={FileText}
        items={contexts.map((c) => ({ id: c.id, name: c.name, description: t(`context.kind.${c.kind}` as MessageKey) }))}
        selected={draft.contextIds}
        emptyText={t('assign.empty.contexts')}
        createLabel={t('assign.create.contexts')}
        onCreate={() => (setAssign(undefined), onCreateOther('contexts'))}
        onApply={(ids) => (set({ contextIds: ids }), setAssign(undefined))}
        onClose={() => setAssign(undefined)}
      />
    )}
    {assign === 'mcp' && (
      <AssignPicker
        title={t('assign.title.mcp')}
        icon={Plug}
        items={mcp.map((m) => ({ id: m.id, name: m.name, description: m.enabled ? m.description : t('mcp.off') }))}
        selected={draft.mcpIds ?? []}
        emptyText={t('assign.empty.mcp')}
        createLabel={t('assign.create.mcp')}
        onCreate={() => (setAssign(undefined), onCreateOther('mcp'))}
        onApply={(ids) => (set({ mcpIds: ids }), setAssign(undefined))}
        onClose={() => setAssign(undefined)}
      />
    )}
    {assign === 'skills' && (
      <AssignPicker
        title={t('assign.title.skills')}
        icon={BookOpen}
        items={skills.map((k) => ({ id: k.id, name: k.name, description: k.description }))}
        selected={draft.skillIds ?? []}
        emptyText={t('assign.empty.skills')}
        createLabel={t('assign.create.skills')}
        onCreate={() => (setAssign(undefined), onCreateOther('skills'))}
        onApply={(ids) => (set({ skillIds: ids }), setAssign(undefined))}
        onClose={() => setAssign(undefined)}
      />
    )}
    </>
  );
}
