import { useState, useMemo, useEffect, useRef } from 'react';
import { type AgentDefinition, type ContextDefinition, type SkillDefinition, newAgent, slugify, type ProjectPermission, DEFAULT_PERMISSION, projectPermission, MODELS } from '@orquestador/core';
import { type McpView, type ProjectApi, t } from '@orquestador/editor';
import { AgentAvatar, fieldErrors, DraftStore, useDraftState, permissionName } from '../common';
import { AgentAssign, AgentCanPart, AgentKnowPart, AgentModelPart, AgentPreview, AgentWhatPart } from './AgentParts';
import { AgentSections, AgentWizard, type AgentSection } from './AgentFormViews';
import { saveKeys, EditorHead, initial, DeleteConfirm } from './editorParts';

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
  'limits.maxCostUsd': { step: 3, section: 'model' },
};

export function AgentForm({ api, drafts, draftKey, original, agents, contexts, skills, mcp, justSaved, onSaved, onDeleted, onCreateOther, busy = false, seed, assistantReady = false, deletable = true }: {
  busy?: boolean;
  /** Sin «Eliminar»: la ficha dentro de «Configurar» del diagrama [R64.4]. */
  deletable?: boolean;
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
  const shared = { draft, set, errors };
  const library = { contexts, skills };
  const whatPart = <AgentWhatPart {...shared} {...library} api={api} isNew={isNew} />;
  const knowPart = <AgentKnowPart {...shared} {...library} mcp={mcp} suggested={suggested} nameOf={nameOf} setAssign={setAssign} onCreateOther={onCreateOther} toggleRequired={toggleRequired} withoutRequired={withoutRequired} />;
  const canPart = <AgentCanPart draft={draft} set={set} projectLevel={projectLevel} />;
  const modelPart = <AgentModelPart {...shared} id={id} turns={turns} setTurns={setTurns} setSaved={setSaved} />;
  const preview = <AgentPreview draft={draft} set={set} />;
  const parts = { whatPart, knowPart, canPart, modelPart, preview };

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
        deletable={deletable}
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
        <AgentWizard {...parts} step={step} goStep={goStep} drafting={drafting} busy={busy} draft={draft} errors={errors} permLabel={permLabel} modelName={modelName} knowNames={[...(draft.skillIds ?? []).map((x) => nameOf(skills, x)), ...draft.contextIds.map((x) => nameOf(contexts, x)), ...(draft.mcpIds ?? []).map((x) => nameOf(mcp, x))]} />
      ) : (
        <AgentSections {...parts} section={section} setSection={setSection} draft={draft} errors={errors} permLabel={permLabel} modelName={modelName} knowFacts={knowFacts} where={where} />
      )}
      <AgentAssign assign={assign} setAssign={setAssign} draft={draft} set={set} contexts={contexts} skills={skills} mcp={mcp} onCreateOther={onCreateOther} />
    </form>
  );
}
