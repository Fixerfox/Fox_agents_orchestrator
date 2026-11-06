import { useState, useMemo, useEffect, useRef } from 'react';
import { BookOpen, FileText, Plug, Loader2 } from 'lucide-react';
import { type AgentDefinition, type ContextDefinition, type SkillDefinition, newAgent, slugify, type ProjectPermission, DEFAULT_PERMISSION, projectPermission, MODELS, LIMITS } from '@orquestador/core';
import { type McpView, type ProjectApi, t, type MessageKey } from '@orquestador/editor';
import { AskFirstMark, AgentAvatar, fieldErrors, Field, AssignedField, AssignPicker, DraftStore, useDraftState, MarkdownField, permissionName, PermissionPicker } from '../common/index';
import { IconPicker } from './IconPicker';
import { saveKeys, EditorHead, initial, DeleteConfirm } from './editorParts';

/** Pasos para crear un agente [R57.3]. «Revisar» es el último. */
const AGENT_STEPS = ['what', 'know', 'can', 'review'] as const;

/** Secciones de la ficha de un agente guardado [R57.5]. */
const AGENT_SECTIONS = ['what', 'know', 'can', 'model', 'where'] as const;

type AgentSection = (typeof AGENT_SECTIONS)[number];

/** Paso y sección donde vive cada campo, para llevar al usuario al que falla [R57.4]. */
const FIELD_PLACE: Record<string, { step: number; section: AgentSection }> = {
  name: { step: 1, section: 'what' },
  description: { step: 1, section: 'what' },
  instructions: { step: 1, section: 'what' },
  skillIds: { step: 2, section: 'know' },
  contextIds: { step: 2, section: 'know' },
  mcpIds: { step: 2, section: 'know' },
  permissions: { step: 3, section: 'can' },
  model: { step: 3, section: 'model' },
  maxTurns: { step: 3, section: 'model' },
};

export function AgentForm({ api, drafts, draftKey, original, agents, contexts, skills, mcp, justSaved, onSaved, onDeleted, onCreateOther, busy = false, seed, assistantReady = false }: {
  busy?: boolean;
  /** Descripción de la bienvenida: los pasos empiezan con ella y el asistente redacta el resto [R57.2]. */
  seed?: string;
  assistantReady?: boolean;
  mcp: McpView[];
  api: ProjectApi;
  drafts: DraftStore;
  draftKey: string;
  original: AgentDefinition | undefined;
  agents: AgentDefinition[];
  contexts: ContextDefinition[];
  skills: SkillDefinition[];
  justSaved: boolean;
  onSaved: (id: string) => void;
  onDeleted: () => void;
  /** Abre Conocimiento con un elemento nuevo o uno existente; el borrador del agente se conserva [R22.11][R32.34]. */
  onCreateOther: (tab: 'contexts' | 'skills' | 'mcp', id?: string) => void;
}) {
  const isNew = original === undefined;
  const [assign, setAssign] = useState<'contexts' | 'skills' | 'mcp'>();
  const base = original ?? newAgent('', '');
  const [draft, setDraft] = useDraftState<AgentDefinition>(drafts, draftKey, base);
  const baseTurns = original?.maxTurns !== undefined ? String(original.maxTurns) : '';
  const [turns, setTurns] = useDraftState<string>(drafts, `${draftKey}#turns`, baseTurns);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<string>();
  const [saved, setSaved] = useState(justSaved);
  const [where, setWhere] = useState<{ diagramId: string; name: string }[]>();
  const [step, setStep] = useState(1);
  const [section, setSection] = useState<AgentSection>('what');
  /** Skills y contextos que propuso el asistente [R57.2]. */
  const [suggested, setSuggested] = useState<{ skills: string[]; contexts: string[] }>();
  const [drafting, setDrafting] = useState<'busy' | 'error'>();
  const taken = useMemo(() => new Set(agents.map((a) => a.id)), [agents]);
  const id = isNew ? slugify(draft.name, taken, 'agente') : draft.id;
  const dirty = JSON.stringify(draft) !== JSON.stringify(base) || turns !== baseTurns;
  useEffect(() => {
    if (isNew) return;
    void api.agentUsage(base.id).then((r) => setWhere(r.ok ? r.value : []));
  }, [api, isNew, base.id]);
  /** Nivel del proyecto, para «El del proyecto (…)» [R47.12]. */
  const [projectLevel, setProjectLevel] = useState<ProjectPermission>(DEFAULT_PERMISSION);
  useEffect(() => {
    void api.getSettings().then((r) => r.ok && setProjectLevel(projectPermission(r.value)));
  }, [api]);
  const set = (patch: Partial<AgentDefinition>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setSaved(false);
  };
  /** Ir a un paso; para pasar del primero hace falta un nombre [R57.3]. */
  const goStep = (n: number) => {
    if (n > 1 && !draft.name.trim()) {
      setStep(1);
      return setErrors((e) => ({ ...e, name: t('agentw.need.name') }));
    }
    setErrors(({ name: _n, ...rest }) => (void _n, rest));
    setStep(n);
  };
  // La descripción de la bienvenida empieza los pasos y, con Claude, el asistente redacta el resto [R57.2].
  const seeded = useRef(false);
  useEffect(() => {
    if (!seed || seeded.current) return;
    seeded.current = true;
    set({ description: seed });
    if (!assistantReady) return;
    setDrafting('busy');
    void api.draftWithClaude({ kind: 'agent', instruction: seed }).then((res) => {
      if (!res.ok) return setDrafting('error');
      setDrafting(undefined);
      const f = res.value.fields;
      const str = (k: 'name' | 'description' | 'instructions') => (typeof f[k] === 'string' && f[k].trim() ? { [k]: f[k] } : {});
      const ids = (k: string, known: { id: string }[]) => (Array.isArray(f[k]) ? f[k].filter((x): x is string => typeof x === 'string' && known.some((y) => y.id === x)) : []);
      const sk = ids('skillIds', skills);
      const cx = ids('contextIds', contexts);
      const model = typeof f['model'] === 'string' && MODELS.some((m) => m.id === f['model']) ? { model: f['model'] } : {};
      // lo que el usuario ya cambió mientras el asistente trabajaba se respeta
      setDraft((d) => {
        const keep = (k: 'name' | 'instructions') => (d[k].trim() ? {} : str(k));
        const nothingYet = (d.skillIds ?? []).length + d.contextIds.length === 0;
        return { ...d, ...keep('name'), ...(d.description === seed ? str('description') : {}), ...keep('instructions'), ...model, ...(nothingYet && sk.length ? { skillIds: sk } : {}), ...(nothingYet && cx.length ? { contextIds: cx } : {}) };
      });
      setSaved(false);
      setSuggested({ skills: sk, contexts: cx });
    });
  }, [seed]); // solo al abrir los pasos con una descripción
  /** Marcar o desmarcar algo del agente como obligatorio [R39.13]. */
  const toggleRequired = (k: 'skillIds' | 'contextIds' | 'mcpIds', x: string): Partial<AgentDefinition> => {
    const cur = draft.required?.[k] ?? [];
    const next = cur.includes(x) ? cur.filter((y) => y !== x) : [...cur, x];
    const req = { ...draft.required, [k]: next };
    if (next.length === 0) delete req[k];
    return { required: Object.keys(req).length > 0 ? req : undefined };
  };
  const withoutRequired = (k: 'skillIds' | 'contextIds' | 'mcpIds', x: string): Partial<AgentDefinition> => (draft.required?.[k]?.includes(x) ? toggleRequired(k, x) : {});
  const discard = () => {
    setDraft(base);
    setTurns(baseTurns);
    setErrors({});
  };

  const save = async () => {
    if (busy) return;
    const { maxTurns: _drop, ...rest } = draft;
    void _drop;
    const body: AgentDefinition = { ...rest, id, ...(turns.trim() !== '' ? { maxTurns: Number(turns) } : {}) };
    // un servidor de «Todos mis proyectos» borrado desde otro proyecto desaparece al guardar [R30.9]
    if (body.mcpIds) body.mcpIds = body.mcpIds.filter((x) => mcp.some((m) => m.id === x));
    const res = await api.saveAgent(body);
    if (!res.ok) {
      const fe = fieldErrors(res.error);
      setErrors(fe);
      // llevar al paso (o la sección) del primer campo que falla [R57.4]
      const place = Object.keys(fe).map((k) => FIELD_PLACE[k]).find(Boolean);
      if (place) {
        setStep(place.step);
        setSection(place.section);
      }
      return;
    }
    setErrors({});
    drafts.discard(draftKey);
    setSaved(true);
    onSaved(id);
  };
  const askDelete = async () => {
    const res = await api.agentUsage(draft.id);
    const names = res.ok ? res.value.map((u) => u.name) : [];
    setConfirm(names.length > 0 ? t('delete.agent.used', { names: names.join(', ') }) : t('delete.agent.unused'));
  };

  // Piezas de la ficha: los mismos campos sirven para los pasos al crear y para las secciones al editar [R57.3][R57.5].
  const modelName = MODELS.find((m) => m.id === draft.model)?.name ?? draft.model;
  const permLabel = draft.permissions ? permissionName(draft.permissions) : t('agentw.review.projectPerm', { level: permissionName(projectLevel) });
  const knowFacts = t('agent.facts.know', { skills: (draft.skillIds ?? []).length, contexts: draft.contextIds.length, mcp: (draft.mcpIds ?? []).length });
  const nameOf = (list: { id: string; name: string }[], x: string) => list.find((y) => y.id === x)?.name ?? x;
  const whatPart = (
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
  const knowPart = (
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
  const canPart = (
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
  const modelPart = (
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
  const preview = (
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
      <EditorHead
        badge={draft.icon ? <AgentAvatar name={draft.name || '?'} icon={draft.icon} tone={draft.tone} size="lg" className="orq-lib__av--big" /> : <span className="orq-lib__av orq-lib__av--big">{initial(draft.name || '?')}</span>}
        name={draft.name}
        sub={MODELS.find((m) => m.id === draft.model)?.name}
        dirty={dirty}
        saved={saved && !dirty}
        isNew={isNew}
        onDiscard={discard}
        onDelete={() => void askDelete()}
        busy={busy}
      />
      {confirm !== undefined && (
        <DeleteConfirm
          title={t('delete.agent', { name: draft.name })}
          detail={confirm}
          onCancel={() => setConfirm(undefined)}
          onConfirm={() => void api.deleteAgent(draft.id).then(() => (drafts.discard(draftKey), onDeleted()))}
        />
      )}
      {isNew ? (
        // Crear: cuatro pasos con la vista previa a la derecha [R57.3][R57.4].
        <div className="orq-agentw">
          <ol className="orq-agentw__steps" aria-label={t('agentw.steps')}>
            {AGENT_STEPS.map((s, i) => (
              <li key={s}>
                <button type="button" className={`orq-agentw__step${step === i + 1 ? ' is-on' : i + 1 < step ? ' is-done' : ''}`} aria-current={step === i + 1 ? 'step' : undefined} onClick={() => goStep(i + 1)}>
                  <span className="orq-agentw__dot" aria-hidden="true">
                    {i + 1 < step ? '✓' : i + 1}
                  </span>
                  {t(`agentw.step.${s}` as MessageKey)}
                </button>
              </li>
            ))}
          </ol>
          <div className="orq-agentw__body">
            <div className="orq-agentw__main">
              <h2 className="orq-agentw__title">{t(`agentw.step.${AGENT_STEPS[step - 1] ?? 'what'}` as MessageKey)}</h2>
              <p className="orq-hint">{t(`agentw.step.${AGENT_STEPS[step - 1] ?? 'what'}.sub` as MessageKey)}</p>
              {drafting === 'busy' && (
                <p className="orq-agentw__drafting" role="status">
                  <Loader2 size={14} className="orq-spin" aria-hidden="true" />
                  {t('agentw.drafting')}
                </p>
              )}
              {drafting === 'error' && (
                <p className="orq-field__error" role="alert">
                  {t('agentw.draft.failed')}
                </p>
              )}
              {step === 1 && whatPart}
              {step === 2 && knowPart}
              {step === 3 && (
                <>
                  {canPart}
                  {modelPart}
                </>
              )}
              {step === 4 && (
                <ul className="orq-agentw__review" aria-label={t('agentw.step.review')}>
                  {[
                    { n: 1, title: t('agentw.step.what'), text: `${draft.name || t('lib.untitled')} · ${draft.description || t('lib.noDesc')} · ${t('agentw.review.lines', { n: draft.instructions.split('\n').filter((l) => l.trim()).length })}` },
                    { n: 2, title: t('agentw.step.know'), text: [...(draft.skillIds ?? []).map((x) => nameOf(skills, x)), ...draft.contextIds.map((x) => nameOf(contexts, x)), ...(draft.mcpIds ?? []).map((x) => nameOf(mcp, x))].join(' · ') || t('agentw.review.nothing') },
                    { n: 3, title: t('agentw.step.can'), text: `${permLabel}${draft.askFirst ? ` · ${t('askfirst.mark')}` : ''}` },
                    { n: 3, title: t('agent.model'), text: modelName },
                  ].map((r) => (
                    <li key={r.title}>
                      <strong>{r.title}</strong>
                      <span>{r.text}</span>
                      <button type="button" className="orq-btn orq-btn--small orq-btn--ghost" aria-label={t('agentw.change', { what: r.title })} onClick={() => goStep(r.n)}>
                        {t('agentw.change.short')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {errors['_'] && (
                <p className="orq-field__error" role="alert">
                  {errors['_']}
                </p>
              )}
            </div>
            <aside className="orq-agentw__side" aria-label={t('agentw.side')}>
              {preview}
              <p className="orq-hint">{t('agentw.side.hint')}</p>
            </aside>
          </div>
          <footer className="orq-agentw__foot">
            <span className="orq-hint">{t('agentw.count', { n: step })}</span>
            <span className="orq-grow" />
            {step > 1 && (
              <button type="button" className="orq-btn" onClick={() => goStep(step - 1)}>
                {t('agentw.back')}
              </button>
            )}
            {step < AGENT_STEPS.length ? (
              <button type="button" className="orq-btn orq-btn--primary" onClick={() => goStep(step + 1)}>
                {t('agentw.next')}
              </button>
            ) : (
              <button type="submit" className="orq-btn orq-btn--primary" disabled={busy}>
                {t('agentw.create')}
              </button>
            )}
          </footer>
        </div>
      ) : (
        // Editar: una sección cada vez, con índice [R57.5].
        <div className="orq-agentf2">
          <nav className="orq-agentf2__nav" aria-label={t('agentf.sections')}>
            {AGENT_SECTIONS.map((sec) => (
              <button key={sec} type="button" className={`orq-agentf2__item${section === sec ? ' is-on' : ''}`} aria-current={section === sec ? 'page' : undefined} onClick={() => setSection(sec)}>
                <strong>{t(`agentf.sec.${sec}` as MessageKey)}</strong>
                <small>{sec === 'what' ? draft.description || t('lib.noDesc') : sec === 'know' ? knowFacts : sec === 'can' ? permLabel : sec === 'model' ? modelName : where === undefined ? '…' : t('agentf.where.count', { n: where.length })}</small>
              </button>
            ))}
          </nav>
          <div className="orq-agentf2__main">
            <h2 className="orq-agentw__title">{t(`agentf.sec.${section}` as MessageKey)}</h2>
            {section === 'what' && whatPart}
            {section === 'know' && knowPart}
            {section === 'can' && canPart}
            {section === 'model' && (
              <>
                {preview}
                {modelPart}
              </>
            )}
            {section === 'where' && (
              <section className="orq-editor__side-sec" aria-label={t('lib.where')}>
                {where && where.length === 0 ? <p className="orq-hint">{t('lib.where.none')}</p> : where?.map((w) => <p key={w.diagramId} className="orq-hint">{w.name}</p>)}
              </section>
            )}
            {errors['_'] && (
              <p className="orq-field__error" role="alert">
                {errors['_']}
              </p>
            )}
          </div>
        </div>
      )}
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
    </form>
  );
}
