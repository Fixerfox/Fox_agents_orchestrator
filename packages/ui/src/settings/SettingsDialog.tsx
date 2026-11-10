import { useEffect, useRef, useState } from 'react';
import { Brain, Clock, Eye, Folder, Gauge, KeyRound, Palette, ShieldCheck, Sparkles } from 'lucide-react';
import { BURN_RATE_USD_PER_MIN, MEMORY_TOKENS, PROJECT_MEMORY_TOKENS, agentsTotal, isolatesBranches, DEFAULT_IDLE_MINUTES, DEFAULT_TOOL_MINUTES, DEFAULT_UNANSWERED, MODELS, UNANSWERED_ACTIONS, loadsClaudeConfig, projectPermission, type AppSettings, type AuthMode, type Engine, type StopAt, supervisorHumanChecks, supervisorModel, supervisorReviews, supervisorStopAt, supervisorUnverified, supervisorVerifyModel } from '@orquestador/core';
import { PermissionPicker, permissionName } from '../common';
import { t, type ConnectionResult, type MessageKey, type ProjectApi, type SettingsView, type WorkFolderView } from '@orquestador/editor';
import { fieldErrors } from '../common';
import { applyTheme, loadTheme, saveTheme, type Theme } from './theme';
import { Choice, PermMatrix, RULES, Row, Shell, type Section, type SectionId } from './SettingsParts';
import { TrustRow } from './TrustDialog';
import { AboutLine } from './AboutLine';

interface Props {
  api: ProjectApi;
  /** Sin proyecto abierto se muestra «Volver» a la pantalla de inicio. */
  onClose?: () => void;
  onSaved: (settings: SettingsView) => void;
}

/** Ajustes como página (prototipo «Ajustes»): navegación lateral y guardado al momento [R23.5][R32.25]. */
export function SettingsDialog({ api, onClose, onSaved }: Props) {
  const [view, setView] = useState<SettingsView>();
  const [draft, setDraft] = useState<AppSettings>();
  const [tokens, setTokens] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<string>();
  const [key, setKey] = useState('');
  const [changingKey, setChangingKey] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => loadTheme());
  const [work, setWork] = useState<WorkFolderView | null | undefined>();
  const [probe, setProbe] = useState<{ running: boolean; result?: ConnectionResult; error?: string }>({ running: false });
  const [section, setSection] = useState<SectionId>('claude');
  /** Cambios del usuario pendientes de guardar (el primer valor cargado no cuenta). */
  const touched = useRef(false);
  const saveRef = useRef<() => Promise<void>>(async () => undefined);
  useEffect(() => {
    if (!touched.current) return;
    const id = setTimeout(() => void saveRef.current(), 300);
    return () => clearTimeout(id);
  }, [draft, tokens]);

  useEffect(() => {
    void api.getSettings().then((r) => {
      if (!r.ok) return setErrors({ _: t('settings.loadError', { message: r.error.message }) });
      setView(r.value);
      setDraft(r.value);
      setTokens(r.value.defaultMaxTokens !== undefined ? String(r.value.defaultMaxTokens) : '');
    });
    // Solo hay carpeta de trabajo con un proyecto abierto; desde la pantalla de inicio no se muestra [R31.1].
    void api.getWorkFolder().then((r) => setWork(r.ok ? r.value : undefined));
  }, [api]);

  if (!draft || !view) {
    return (
      <Shell onClose={onClose} items={[]} current="claude" onPick={() => undefined}>
        {errors['_'] && (
          <p className="orq-field__error" role="alert">
            {errors['_']}
          </p>
        )}
      </Shell>
    );
  }
  const set = (patch: Partial<AppSettings>) => {
    touched.current = true;
    setDraft({ ...draft, ...patch });
    setStatus(t('settings.saving'));
  };

  const save = async () => {
    // Solo los campos de ajustes: `apiKeyStored` es del estado de la vista y el contrato lo rechaza.
    const body: AppSettings = {
      schemaVersion: draft.schemaVersion,
      authMode: draft.authMode,
      engine: draft.engine,
      defaultModel: draft.defaultModel,
      maxParallel: draft.maxParallel,
      ...(tokens.trim() !== '' ? { defaultMaxTokens: Number(tokens) } : {}),
      ...(draft.permissions ? { permissions: draft.permissions } : {}),
      ...(draft.claudeConfig !== undefined ? { claudeConfig: draft.claudeConfig } : {}),
      ...(draft.supervisorReview !== undefined ? { supervisorReview: draft.supervisorReview } : {}),
      ...(draft.supervisorModel !== undefined ? { supervisorModel: draft.supervisorModel } : {}),
      ...(draft.supervisorHumanChecks !== undefined ? { supervisorHumanChecks: draft.supervisorHumanChecks } : {}),
      ...(draft.supervisorStopAt !== undefined ? { supervisorStopAt: draft.supervisorStopAt } : {}),
      ...(draft.supervisorVerifyModel !== undefined ? { supervisorVerifyModel: draft.supervisorVerifyModel } : {}),
      ...(draft.supervisorUnverified !== undefined ? { supervisorUnverified: draft.supervisorUnverified } : {}),
      ...(draft.limits ? { limits: draft.limits } : {}),
      ...(draft.unanswered ? { unanswered: draft.unanswered } : {}),
      ...(draft.memoryTokens !== undefined ? { memoryTokens: draft.memoryTokens } : {}),
      ...(draft.isolateBranches !== undefined ? { isolateBranches: draft.isolateBranches } : {}),
      ...(draft.claudeAutoMemory !== undefined ? { claudeAutoMemory: draft.claudeAutoMemory } : {}),
      ...(draft.projectMemoryTokens !== undefined ? { projectMemoryTokens: draft.projectMemoryTokens } : {}),
      ...(draft.maxAgentsTotal !== undefined ? { maxAgentsTotal: draft.maxAgentsTotal } : {}),
      ...(draft.onBudget !== undefined ? { onBudget: draft.onBudget } : {}),
      ...(draft.burnRateUsdPerMin !== undefined ? { burnRateUsdPerMin: draft.burnRateUsdPerMin } : {}),
    };
    const res = await api.saveSettings(body);
    if (!res.ok) {
      setStatus(undefined);
      return setErrors(fieldErrors(res.error));
    }
    setErrors({});
    setView(res.value);
    setStatus(t('settings.saved'));
    onSaved(res.value);
  };
  saveRef.current = save;
  const test = async () => {
    setProbe({ running: true });
    const res = await api.testConnection();
    setProbe(res.ok ? { running: false, result: res.value } : { running: false, error: res.error.message });
  };
  const pickWork = async () => {
    const r = await api.pickWorkFolder();
    if (r.ok && r.value) setWork(r.value);
  };
  const clearWork = async () => {
    const r = await api.clearWorkFolder();
    if (r.ok) setWork(null);
  };
  const saveKey = async () => {
    const res = await api.setApiKey(key);
    if (!res.ok) return setErrors({ apiKey: res.error.fields?.[0]?.message ?? res.error.message });
    setErrors({});
    setKey('');
    setChangingKey(false);
    setView(res.value);
    onSaved(res.value);
  };
  const removeKey = async () => {
    const res = await api.clearApiKey();
    if (res.ok) {
      setView(res.value);
      onSaved(res.value);
    }
  };

  const level = projectPermission(draft);
  const modelName = (id: string) => MODELS.find((m) => m.id === id)?.name ?? id;
  const failure = probe.result && !probe.result.ok ? probe.result.message : probe.error;
  const sections: Section[] = [
    {
      id: 'claude',
      group: 'general',
      icon: Sparkles,
      label: t('settings.section.claude'),
      summary:
        draft.engine === 'simulated'
          ? t('settings.sum.sim')
          : probe.result?.ok
            ? t('settings.sum.ok', { model: modelName(draft.defaultModel) })
            : t('settings.sum.claude', { auth: t(`settings.auth.${draft.authMode}` as MessageKey), model: modelName(draft.defaultModel) }),
      intro: t('settings.claude.intro'),
      content: (
        <>
          {/* Estado de la conexión, arriba y con «Probar conexión» al lado [R67.2]. */}
          <div className={`orq-setstatus${probe.result?.ok ? ' is-ok' : failure ? ' is-fail' : ''}`}>
            <span className="orq-setstatus__dot" aria-hidden="true" />
            <div className="orq-setstatus__text">
              <strong>
                {probe.running
                  ? t('settings.status.running')
                  : probe.result?.ok
                    ? t('settings.status.ok')
                    : failure
                      ? t('settings.status.fail')
                      : draft.engine === 'simulated'
                        ? t('settings.status.sim')
                        : t('settings.status.idle')}
              </strong>
              {probe.result?.ok ? (
                <p className="orq-hint" role="status">
                  {t('settings.test.ok', { message: probe.result.message, model: probe.result.model, ms: probe.result.ms })}
                </p>
              ) : failure ? (
                <p className="orq-field__error" role="alert">
                  {t('settings.test.fail', { message: failure })}
                </p>
              ) : (
                <p className="orq-hint">{t('settings.test.hint')}</p>
              )}
            </div>
            <button type="button" className="orq-btn" disabled={probe.running} onClick={() => void test()}>
              {probe.running ? t('settings.test.running') : t('settings.test')}
            </button>
          </div>
          <Choice
            legend={t('settings.engine')}
            name="engine"
            value={draft.engine}
            options={(['simulated', 'claude'] as Engine[]).map((m) => ({ value: m, label: t(`settings.engine.${m}` as MessageKey), hint: t(`settings.engine.${m}.hint` as MessageKey) }))}
            onChange={(engine) => set({ engine })}
            error={errors['engine']}
          />
          <Choice
            legend={t('settings.auth')}
            name="auth"
            value={draft.authMode}
            options={(['claude-code', 'api-key'] as AuthMode[]).map((m) => ({ value: m, label: t(`settings.auth.${m}` as MessageKey), hint: t(`settings.auth.${m}.hint` as MessageKey) }))}
            onChange={(authMode) => set({ authMode })}
            error={errors['authMode']}
            list
          />
          {draft.authMode === 'api-key' && (
            <div className="orq-field">
              <span className="orq-field__label">{t('settings.apikey')}</span>
              {view.apiKeyStored && !changingKey ? (
                <div className="orq-keyrow">
                  <KeyRound size={16} strokeWidth={1.5} aria-hidden="true" />
                  <span>{t('settings.apikey.stored')}</span>
                  <button type="button" className="orq-btn" onClick={() => setChangingKey(true)}>
                    {t('settings.apikey.change')}
                  </button>
                  <button type="button" className="orq-btn" onClick={() => void removeKey()}>
                    {t('settings.apikey.remove')}
                  </button>
                </div>
              ) : (
                <div className="orq-keyrow">
                  <input type="password" autoComplete="off" spellCheck={false} aria-label={t('settings.apikey')} placeholder={t('settings.apikey.placeholder')} value={key} onChange={(e) => setKey(e.target.value)} />
                  <button type="button" className="orq-btn" onClick={() => void saveKey()}>
                    {t('settings.apikey.save')}
                  </button>
                </div>
              )}
              {!view.apiKeyStored && !errors['apiKey'] && <p className="orq-hint">{t('settings.apikey.none')}</p>}
              {errors['apiKey'] && (
                <p className="orq-field__error" role="alert">
                  {errors['apiKey']}
                </p>
              )}
            </div>
          )}
          <div className="orq-setrows">
            <Row id="set-model" label={t('settings.model')} hint={t('settings.model.hint')} error={errors['defaultModel']}>
              <select id="set-model" value={draft.defaultModel} onChange={(e) => set({ defaultModel: e.target.value })}>
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Row>
            <Row id="set-cc" label={t('settings.claudeConfig')} hint={t('settings.claudeConfig.hint')}>
              <input id="set-cc" type="checkbox" className="orq-toggle" checked={loadsClaudeConfig(draft)} onChange={(e) => set({ claudeConfig: e.target.checked })} />
            </Row>
            {loadsClaudeConfig(draft) && <TrustRow api={api} />}
          </div>
        </>
      ),
    },
    {
      id: 'perms',
      group: 'general',
      icon: ShieldCheck,
      label: t('perm.title'),
      summary: permissionName(level),
      intro: t('settings.perms.intro'),
      content: (
        <>
          {/* Escala de tres niveles y lo que pasará con cada uno (prototipo C) [R67.6]. */}
          <div className="orq-setperm">
            <PermissionPicker legend={t('perm.title')} value={level} onChange={(l) => l && l !== 'readonly' && set({ permissions: l })} />
          </div>
          <PermMatrix level={level} />
          <p className="orq-hint">{t('perm.agentHint')}</p>
          {/* Las reglas se derivan del nivel y se ven junto a él [R67.4][R31.14]. */}
          <div className="orq-setrules">
            <h3>{t('settings.rules.title')}</h3>
            <ul className="orq-rules" aria-label={t('settings.section.rules')}>
              {RULES(level).map((k) => (
                <li key={k}>{t(k)}</li>
              ))}
            </ul>
            <p className="orq-hint">{t('settings.rules.limit')}</p>
          </div>
        </>
      ),
    },
    {
      id: 'supervisor',
      group: 'general',
      icon: Eye,
      label: t('settings.sup'),
      summary: supervisorReviews(draft) ? t('settings.sum.sup.on', { model: modelName(supervisorModel(draft)) }) : t('settings.sum.sup.off'),
      intro: t('settings.sup.intro'),
      content: (
        <div className="orq-setrows">
          <Row id="set-sup-review" label={t('settings.sup.review')} hint={t('settings.sup.hint')}>
            <input id="set-sup-review" type="checkbox" className="orq-toggle" checked={supervisorReviews(draft)} onChange={(e) => set({ supervisorReview: e.target.checked })} />
          </Row>
          <Row id="set-sup-model" label={t('settings.sup.model')} error={errors['supervisorModel']}>
            <select id="set-sup-model" value={supervisorModel(draft)} onChange={(e) => set({ supervisorModel: e.target.value })}>
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Row>
          {/* Lo que solo puede comprobar una persona: avisar o fallar [R65.4]. */}
          <Row id="set-sup-human" label={t('set.sup.human')} hint={t('set.sup.human.hint')} error={errors['supervisorHumanChecks']}>
            <select id="set-sup-human" value={supervisorHumanChecks(draft)} onChange={(e) => set({ supervisorHumanChecks: e.target.value as 'warn' | 'fail' })}>
              <option value="warn">{t('set.sup.human.warn')}</option>
              <option value="fail">{t('set.sup.human.fail')}</option>
            </select>
          </Row>
          {/* Cuándo para la revisión, con qué modelo se comprueba el final y qué hacer si no se puede [R75.10][R75.19][R75.20]. */}
          <Row id="set-sup-stop" label={t('set.sup.stop')} hint={t('set.sup.stop.hint')} error={errors['supervisorStopAt']}>
            <select id="set-sup-stop" value={supervisorStopAt(draft)} onChange={(e) => set({ supervisorStopAt: e.target.value as StopAt })}>
              <option value="high">{t('set.sup.stop.high')}</option>
              <option value="medium">{t('set.sup.stop.medium')}</option>
              <option value="never">{t('set.sup.stop.never')}</option>
            </select>
          </Row>
          <Row id="set-sup-vmodel" label={t('set.sup.vmodel')} hint={t('set.sup.vmodel.hint')} error={errors['supervisorVerifyModel']}>
            <select id="set-sup-vmodel" value={supervisorVerifyModel(draft)} onChange={(e) => set({ supervisorVerifyModel: e.target.value })}>
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Row>
          <Row id="set-sup-unverified" label={t('set.sup.unverified')} error={errors['supervisorUnverified']}>
            <select id="set-sup-unverified" value={supervisorUnverified(draft)} onChange={(e) => set({ supervisorUnverified: e.target.value as 'warn' | 'fail' })}>
              <option value="warn">{t('set.sup.human.warn')}</option>
              <option value="fail">{t('set.sup.human.fail')}</option>
            </select>
          </Row>
          {/* Gasto por minuto que avisa [R77.10]. */}
          <Row id="set-sup-burn" label={t('set.sup.burn')} hint={t('set.sup.burn.hint')} error={errors['burnRateUsdPerMin']}>
            <input id="set-sup-burn" type="number" min={0.1} max={100} step={0.1} value={draft.burnRateUsdPerMin ?? BURN_RATE_USD_PER_MIN} onChange={(e) => set({ burnRateUsdPerMin: Number(e.target.value) })} />
          </Row>
        </div>
      ),
    },
    {
      id: 'budget',
      group: 'general',
      icon: Gauge,
      label: t('settings.section.budget'),
      summary: t('settings.sum.budget', { n: draft.maxParallel, tokens: tokens.trim() === '' ? t('settings.sum.budget.free') : t('settings.sum.budget.tokens', { n: tokens }) }),
      intro: t('settings.budget.intro'),
      content: (
        <div className="orq-setrows">
          <Row id="set-parallel" label={t('settings.parallel')} error={errors['maxParallel']}>
            <input id="set-parallel" type="number" min={1} max={16} value={draft.maxParallel} onChange={(e) => set({ maxParallel: Number(e.target.value) })} />
          </Row>
          {/* Agentes a la vez en toda la app y qué hacer al llegar al presupuesto [R77.1][R77.8]. */}
          <Row id="set-agents-total" label={t('settings.agentsTotal')} hint={t('settings.agentsTotal.hint')} error={errors['maxAgentsTotal']}>
            <input id="set-agents-total" type="number" min={1} max={32} value={agentsTotal(draft)} onChange={(e) => set({ maxAgentsTotal: Number(e.target.value) })} />
          </Row>
          <Row id="set-onbudget" label={t('settings.onBudget')} hint={t('settings.onBudget.hint')} error={errors['onBudget']}>
            <select id="set-onbudget" value={draft.onBudget ?? 'stop-now'} onChange={(e) => set({ onBudget: e.target.value as 'stop-now' | 'finish-running' })}>
              <option value="stop-now">{t('settings.onBudget.stop')}</option>
              <option value="finish-running">{t('settings.onBudget.finish')}</option>
            </select>
          </Row>
          <Row id="set-tokens" label={t('settings.tokens')} hint={t('settings.tokens.hint')} error={errors['defaultMaxTokens']}>
            <input id="set-tokens" type="number" min={1} value={tokens} onChange={(e) => ((touched.current = true), setTokens(e.target.value), setStatus(t('settings.saving')))} />
          </Row>
          <Row id="set-isolate" label={t('settings.isolate')} hint={t('settings.isolate.hint')}>
            <input id="set-isolate" type="checkbox" className="orq-toggle" checked={isolatesBranches(draft)} onChange={(e) => set({ isolateBranches: e.target.checked })} />
          </Row>
        </div>
      ),
    },
    {
      id: 'limits',
      group: 'general',
      icon: Clock,
      label: t('settings.section.limits'),
      summary: t('settings.sum.limits', { idle: draft.limits?.idleMinutes ?? DEFAULT_IDLE_MINUTES, unanswered: t(`rundlg.unanswered.${(draft.unanswered ?? DEFAULT_UNANSWERED).action}`) }),
      intro: t('settings.limits.intro'),
      content: (
        <div className="orq-setrows">
          <Row id="set-idle" label={t('settings.limits.idle')} error={errors['limits.idleMinutes']}>
            <input id="set-idle" type="number" min={2} max={120} value={draft.limits?.idleMinutes ?? DEFAULT_IDLE_MINUTES} onChange={(e) => set({ limits: { ...draft.limits, idleMinutes: Number(e.target.value) } })} />
          </Row>
          <Row id="set-toolidle" label={t('settings.limits.tool')} error={errors['limits.toolMinutes']}>
            <input id="set-toolidle" type="number" min={5} max={480} value={draft.limits?.toolMinutes ?? DEFAULT_TOOL_MINUTES} onChange={(e) => set({ limits: { ...draft.limits, toolMinutes: Number(e.target.value) } })} />
          </Row>
          <Row id="set-unanswered" label={t('settings.limits.unanswered')} error={errors['unanswered']}>
            <select id="set-unanswered" value={(draft.unanswered ?? DEFAULT_UNANSWERED).action} onChange={(e) => set({ unanswered: { ...(draft.unanswered ?? DEFAULT_UNANSWERED), action: e.target.value as (typeof UNANSWERED_ACTIONS)[number] } })}>
              {UNANSWERED_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {t(`rundlg.unanswered.${a}`)}
                </option>
              ))}
            </select>
          </Row>
          {(draft.unanswered ?? DEFAULT_UNANSWERED).action !== 'wait' && (
            <Row id="set-unanswered-after" label={t('rundlg.unanswered.after')}>
              <input id="set-unanswered-after" type="number" min={1} max={1440} value={(draft.unanswered ?? DEFAULT_UNANSWERED).afterMinutes} onChange={(e) => set({ unanswered: { ...(draft.unanswered ?? DEFAULT_UNANSWERED), afterMinutes: Math.max(1, Number(e.target.value) || 1) } })} />
            </Row>
          )}
        </div>
      ),
    },
    {
      id: 'memory',
      group: 'general',
      icon: Brain,
      label: t('settings.section.memory'),
      summary: t('settings.sum.memory', { n: draft.memoryTokens ?? MEMORY_TOKENS }),
      intro: t('settings.memory.intro'),
      content: (
        <div className="orq-setrows">
          <Row id="set-memtokens" label={t('settings.memory.tokens')} error={errors['memoryTokens']}>
            <input id="set-memtokens" type="number" min={500} max={8000} step={100} value={draft.memoryTokens ?? MEMORY_TOKENS} onChange={(e) => set({ memoryTokens: Number(e.target.value) })} />
          </Row>
          <p className="orq-hint">{t('settings.memory.tokens.hint')}</p>
          {/* La memoria del proyecto y la propia de Claude Code [R76.14][R76.18]. */}
          <Row id="set-pmemtokens" label={t('settings.memory.project')} error={errors['projectMemoryTokens']}>
            <input id="set-pmemtokens" type="number" min={300} max={6000} step={100} value={draft.projectMemoryTokens ?? PROJECT_MEMORY_TOKENS} onChange={(e) => set({ projectMemoryTokens: Number(e.target.value) })} />
          </Row>
          <Row id="set-automem" label={t('settings.memory.auto')} hint={t('settings.memory.auto.hint')}>
            <input id="set-automem" type="checkbox" className="orq-toggle" checked={draft.claudeAutoMemory === true} onChange={(e) => set({ claudeAutoMemory: e.target.checked })} />
          </Row>
        </div>
      ),
    },
    {
      id: 'look',
      group: 'general',
      icon: Palette,
      label: t('settings.section.look'),
      summary: t(`theme.${theme}` as MessageKey),
      intro: t('settings.look.intro'),
      content: (
        <>
        <fieldset className="orq-field orq-setseg">
          <legend>{t('settings.theme')}</legend>
          <div className="orq-setseg__opts" role="radiogroup">
            {(['auto', 'light', 'dark'] as Theme[]).map((m) => (
              <label key={m} className={theme === m ? 'is-on' : undefined}>
                <input
                  type="radio"
                  name="theme"
                  checked={theme === m}
                  onChange={() => {
                    setTheme(m);
                    saveTheme(m);
                    applyTheme(m);
                  }}
                />
                {t(`theme.${m}` as MessageKey)}
              </label>
            ))}
          </div>
        </fieldset>
        <AboutLine app={view.app} />
        </>
      ),
    },
  ];
  if (work !== undefined)
    sections.push({
      id: 'work',
      group: 'project',
      icon: Folder,
      label: t('settings.section.work'),
      summary: work ? work.name : t('settings.sum.work.none'),
      intro: t('settings.work.intro'),
      content: (
        <div className="orq-setfolder">
          <Folder size={20} strokeWidth={1.6} aria-hidden="true" />
          <div className="orq-setfolder__text">
            <strong>{work ? t('settings.work.chosen', { name: work.name, files: work.files }) : t('settings.work.none')}</strong>
            <p className="orq-hint">{t('settings.work.hint')}</p>
          </div>
          <button type="button" className="orq-btn" onClick={() => void pickWork()}>
            {work ? t('settings.work.change') : t('settings.work.pick')}
          </button>
          {work && (
            <button type="button" className="orq-btn orq-btn--ghost" onClick={() => void clearWork()}>
              {t('settings.work.clear')}
            </button>
          )}
        </div>
      ),
    });
  const current = sections.find((x) => x.id === section) ?? sections[0]!;

  return (
    <Shell onClose={onClose} status={status} items={sections} current={current.id} onPick={setSection}>
      <form
        className="orq-settings"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <header className="orq-settings__head">
          <h2>{current.label}</h2>
          <p className="orq-hint">{current.intro}</p>
        </header>
        {current.content}
        {errors['_'] && (
          <p className="orq-field__error" role="alert">
            {t('settings.error', { message: errors['_'] })}
          </p>
        )}
      </form>
    </Shell>
  );
}
