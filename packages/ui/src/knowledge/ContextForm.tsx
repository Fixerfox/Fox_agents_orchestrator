import { useState, useMemo, useEffect } from 'react';
import { FilePlus2, FolderOpen, Link2 } from 'lucide-react';
import { type ContextDefinition, type AgentDefinition, newContext, slugify, type ContextKind, LIMITS } from '@orquestador/core';
import { type ProjectApi, t, type MessageKey } from '@orquestador/editor';
import { fieldErrors, Field, DraftStore, useDraftState, MarkdownField } from '../common';
import { saveKeys, EditorHead, DeleteConfirm, UsedBy, KIND_TAG, SZ } from './editorParts';

export function ContextForm({ api, drafts, draftKey, original, contexts, agents, justSaved, onSaved, onDeleted, onAgentsChanged, busy = false, autoPick = false }: {
  busy?: boolean;
  /** Abre el diálogo de archivos al mostrarse (desde «Elegir archivos» de la bienvenida) [R38.20]. */
  autoPick?: boolean;
  api: ProjectApi;
  drafts: DraftStore;
  draftKey: string;
  original: ContextDefinition | undefined;
  contexts: ContextDefinition[];
  agents: AgentDefinition[];
  justSaved: boolean;
  onSaved: (id: string) => void;
  onDeleted: () => void;
  onAgentsChanged: () => void;
}) {
  const isNew = original === undefined;
  const base = original ?? newContext('', '');
  const [draft, setDraft] = useDraftState<ContextDefinition>(drafts, draftKey, base);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<string>();
  const [saved, setSaved] = useState(justSaved);
  const taken = useMemo(() => new Set(contexts.map((c) => c.id)), [contexts]);
  const id = isNew ? slugify(draft.name, taken, 'contexto') : draft.id;
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  const set = (patch: Partial<ContextDefinition>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setSaved(false);
  };
  const save = async () => {
    if (busy) return;
    const res = await api.saveContext({ ...draft, id });
    if (!res.ok) return setErrors(fieldErrors(res.error));
    setErrors({});
    drafts.discard(draftKey);
    setSaved(true);
    onSaved(id);
  };
  const askDelete = async () => {
    const res = await api.contextUsage(draft.id);
    const names = res.ok ? res.value.map((u) => u.name) : [];
    setConfirm(names.length > 0 ? t('delete.context.used', { names: names.join(', ') }) : t('delete.context.unused'));
  };
  const valueLabel = t(`context.value.${draft.kind}` as MessageKey);
  const [pickMsg, setPickMsg] = useState<string>();
  /** Los caminos para empezar están ahora en la bienvenida de «Nuevo contexto» [R38.20]. */
  const start = 'write' as 'write' | 'claude';
  /** Copia lo elegido en el diálogo del sistema dentro del proyecto; la interfaz no ve rutas del disco [R22.14]. */
  const pick = async (kind: 'files' | 'folder') => {
    setPickMsg(undefined);
    const res = await api.addContextFiles({ id, kind });
    if (!res.ok) return setErrors((e) => ({ ...e, value: res.error.message }));
    if (res.value === null) return;
    const v = res.value;
    setErrors((e) => {
      const { value: _v, ...rest } = e;
      void _v;
      return rest;
    });
    set({ value: v.value });
    const extra = [v.renamed > 0 ? t('context.pick.renamed', { n: v.renamed }) : '', v.scripts.length > 0 ? t('context.pick.scripts', { n: v.scripts.length }) : ''].filter(Boolean).join(' ');
    setPickMsg(`${t('context.pick.done', { files: v.files, kb: Math.max(1, Math.round(v.bytes / 1024)) })} ${extra}`.trim());
  };  useEffect(() => {
    if (autoPick) void pick('files');
  }, []);

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
      <EditorHead badge={<span className="orq-lib__tag orq-lib__tag--big">{KIND_TAG[draft.kind]}</span>} name={draft.name} sub={t(`context.kind.${draft.kind}` as MessageKey)} dirty={dirty} saved={saved && !dirty} isNew={isNew} onDiscard={() => (setDraft(base), setErrors({}))} onDelete={() => void askDelete()} busy={busy} />
      {confirm !== undefined && (
        <DeleteConfirm
          title={t('delete.context', { name: draft.name })}
          detail={confirm}
          onCancel={() => setConfirm(undefined)}
          onConfirm={() => void api.deleteContext(draft.id).then(() => (drafts.discard(draftKey), onDeleted()))}
        />
      )}
      <div className="orq-editor__body">
        <div className="orq-editor__main">
          <Field label={t('context.name')} id="ctx-name" error={errors['name']}>
            <input id="ctx-name" value={draft.name} aria-invalid={Boolean(errors['name'])} onChange={(e) => set({ name: e.target.value })} autoFocus={isNew} />
          </Field>
          <Field label={t('context.kind')} id="ctx-kind" error={errors['kind']}>
            <select id="ctx-kind" value={draft.kind} onChange={(e) => set({ kind: e.target.value as ContextKind, value: '' })}>
              {(['text', 'url', 'file'] as const).map((k) => (
                <option key={k} value={k}>
                  {t(`context.kind.${k}` as MessageKey)}
                </option>
              ))}
            </select>
          </Field>
          {draft.kind === 'text' ? (
            <MarkdownField
              id="ctx-value"
              label={valueLabel}
              value={draft.value}
              max={LIMITS.contextText}
              error={errors['value']}
              onChange={(v) => set({ value: v })}
              openAssist={start === 'claude'}
              assist={{ api, kind: 'context', field: 'value', current: { name: draft.name, value: draft.value }, names: { contexts: {}, skills: {} }, onApply: (f) => set(f as Partial<ContextDefinition>) }}
            />
          ) : (
            <Field label={valueLabel} id="ctx-value" error={errors['value']}>
              {draft.kind === 'file' && (
                <div className="orq-md__bar">
                  <button type="button" className="orq-btn orq-btn--small" onClick={() => void pick('files')}>
                    <FilePlus2 {...SZ} />
                    {t('context.pick.files')}
                  </button>
                  <button type="button" className="orq-btn orq-btn--small" onClick={() => void pick('folder')}>
                    <FolderOpen {...SZ} />
                    {t('context.pick.folder')}
                  </button>
                </div>
              )}
              <input id="ctx-value" value={draft.value} aria-invalid={Boolean(errors['value'])} onChange={(e) => set({ value: e.target.value })} />
              {draft.kind === 'file' && (
                <p className="orq-hint" role={pickMsg ? 'status' : undefined}>
                  {pickMsg ?? t('context.pick.hint')}
                </p>
              )}
            </Field>
          )}
          {errors['_'] && (
            <p className="orq-field__error" role="alert">
              {errors['_']}
            </p>
          )}
          {draft.kind === 'url' && (
            <p className="orq-hint">
              <Link2 size={12} aria-hidden="true" /> {t('context.kind.url')}
            </p>
          )}
        </div>
        <div className="orq-editor__side">
          <UsedBy api={api} kind="contexts" id={draft.id} saved={!isNew} agents={agents} onChanged={onAgentsChanged} />
          <section className="orq-insp__sec orq-deliver" aria-label={t('ctx.deliver')}>
            <span className="orq-insp__label">{t('ctx.deliver')}</span>
            <p className="orq-hint">{t(`ctx.deliver.${draft.kind}` as MessageKey)}</p>
          </section>
        </div>
      </div>
    </form>
  );
}
