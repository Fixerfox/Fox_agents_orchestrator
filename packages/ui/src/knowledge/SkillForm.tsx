import { useState, useMemo } from 'react';
import { BookOpen } from 'lucide-react';
import { type SkillDefinition, type AgentDefinition, newSkill, slugify, SKILL_LIMITS } from '@orquestador/core';
import { type ProjectApi, t } from '@orquestador/editor';
import { fieldErrors, Field, DraftStore, useDraftState, MarkdownField } from '../common';
import { saveKeys, EditorHead, DeleteConfirm, UsedBy, SZ } from './editorParts';
import { SkillRefs } from './SkillRefs';

export function SkillForm({ api, drafts, draftKey, original, skills, agents, justSaved, onSaved, onDeleted, onAgentsChanged, busy = false }: {
  busy?: boolean;
  api: ProjectApi;
  drafts: DraftStore;
  draftKey: string;
  original: SkillDefinition | undefined;
  skills: SkillDefinition[];
  agents: AgentDefinition[];
  justSaved: boolean;
  onSaved: (id: string) => void;
  onDeleted: () => void;
  onAgentsChanged: () => void;
}) {
  const isNew = original === undefined;
  const base = original ?? newSkill('', '');
  const [draft, setDraft] = useDraftState<SkillDefinition>(drafts, draftKey, base);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<string>();
  const [saved, setSaved] = useState(justSaved);
  const taken = useMemo(() => new Set(skills.map((k) => k.id)), [skills]);
  const id = isNew ? slugify(draft.name, taken, 'skill') : draft.id;
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  const set = (patch: Partial<SkillDefinition>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setSaved(false);
  };

  const save = async () => {
    if (busy) return;
    const res = await api.saveSkill({ ...draft, id });
    if (!res.ok) return setErrors(fieldErrors(res.error));
    setErrors({});
    drafts.discard(draftKey);
    setSaved(true);
    onSaved(id);
  };
  const askDelete = async () => {
    const res = await api.skillUsage(draft.id);
    const names = res.ok ? res.value.map((u) => u.name) : [];
    setConfirm(names.length > 0 ? t('delete.skill.used', { names: names.join(', ') }) : t('delete.skill.unused'));
  };

  return (
    <form
      className="orq-editor"
      noValidate
      onKeyDown={saveKeys(() => void save())}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <EditorHead badge={<span className="orq-lib__av orq-lib__av--big"><BookOpen {...SZ} /></span>} name={draft.name} sub="SKILL.md" dirty={dirty} saved={saved && !dirty} isNew={isNew} onDiscard={() => (setDraft(base), setErrors({}))} onDelete={() => void askDelete()} busy={busy} />
      {confirm !== undefined && (
        <DeleteConfirm
          title={t('delete.skill', { name: draft.name })}
          detail={confirm}
          onCancel={() => setConfirm(undefined)}
          onConfirm={() => void api.deleteSkill(draft.id).then(() => (drafts.discard(draftKey), onDeleted()))}
        />
      )}
      <div className="orq-editor__body">
        <div className="orq-editor__main">
          <Field label={t('skill.name')} id="skill-name" error={errors['name']}>
            <input id="skill-name" value={draft.name} aria-invalid={Boolean(errors['name'])} onChange={(e) => set({ name: e.target.value })} autoFocus={isNew} />
          </Field>
          <Field label={t('skill.description')} id="skill-desc" error={errors['description']}>
            <input id="skill-desc" value={draft.description} aria-invalid={Boolean(errors['description'])} onChange={(e) => set({ description: e.target.value })} />
          </Field>
          <MarkdownField
            id="skill-body"
            label={t('skill.body')}
            value={draft.body}
            max={SKILL_LIMITS.body}
            error={errors['body']}
            onChange={(v) => set({ body: v })}
            assist={{ api, kind: 'skill', field: 'body', current: { name: draft.name, description: draft.description, body: draft.body }, names: { contexts: {}, skills: {} }, onApply: (f) => set(f as Partial<SkillDefinition>) }}
          />
          {errors['_'] && (
            <p className="orq-field__error" role="alert">
              {errors['_']}
            </p>
          )}
        </div>
        <div className="orq-editor__side">
          <SkillRefs api={api} id={draft.id} saved={!isNew} />
          <UsedBy api={api} kind="skills" id={draft.id} saved={!isNew} agents={agents} onChanged={onAgentsChanged} />
          <details className="orq-editor__adv">
            <summary>{t('lib.advanced')}</summary>
            <p className="orq-hint orq-form__id">
              {t('skill.id')}: <code>{id}</code>
            </p>
          </details>
        </div>
      </div>
    </form>
  );
}
