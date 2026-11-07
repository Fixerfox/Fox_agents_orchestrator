import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, KeyRound } from 'lucide-react';
import { MODELS, loadsClaudeConfig, projectPermission, type AppSettings, type AuthMode, type Engine, type ProjectPermission, supervisorModel, supervisorReviews } from '@orquestador/core';
import { PermissionPicker } from '../common';
import { t, type ConnectionResult, type MessageKey, type ProjectApi, type SettingsView, type WorkFolderView } from '@orquestador/editor';
import { Field, fieldErrors } from '../common';
import { applyTheme, loadTheme, saveTheme, type Theme } from './theme';

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
      <Shell onClose={onClose}>
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

  return (
    <Shell onClose={onClose} status={status} work={work !== undefined}>
      <form
        className="orq-settings"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <section id="sec-claude" aria-labelledby="set-claude">
          <h3 id="set-claude">{t('settings.section.claude')}</h3>
          <fieldset className="orq-field">
            <legend>{t('settings.engine')}</legend>
            <div className="orq-radios" role="radiogroup">
              {(['simulated', 'claude'] as Engine[]).map((m) => (
                <label key={m}>
                  <input type="radio" name="engine" checked={draft.engine === m} onChange={() => set({ engine: m })} />
                  {t(`settings.engine.${m}` as MessageKey)}
                </label>
              ))}
            </div>
            {errors['engine'] && (
              <p className="orq-field__error" role="alert">
                {errors['engine']}
              </p>
            )}
          </fieldset>
          <fieldset className="orq-field">
            <legend>{t('settings.auth')}</legend>
            <div className="orq-radios" role="radiogroup">
              {(['claude-code', 'api-key'] as AuthMode[]).map((m) => (
                <label key={m}>
                  <input type="radio" name="auth" checked={draft.authMode === m} onChange={() => set({ authMode: m })} />
                  {t(`settings.auth.${m}` as MessageKey)}
                </label>
              ))}
            </div>
            {errors['authMode'] && (
              <p className="orq-field__error" role="alert">
                {errors['authMode']}
              </p>
            )}
          </fieldset>
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
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    aria-label={t('settings.apikey')}
                    placeholder={t('settings.apikey.placeholder')}
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                  />
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
          <Field label={t('settings.model')} id="set-model" error={errors['defaultModel']}>
            <select id="set-model" value={draft.defaultModel} onChange={(e) => set({ defaultModel: e.target.value })}>
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="orq-field">
            <label className="orq-check">
              <input type="checkbox" checked={loadsClaudeConfig(draft)} onChange={(e) => set({ claudeConfig: e.target.checked })} />
              {t('settings.claudeConfig')}
            </label>
            <p className="orq-hint">{t('settings.claudeConfig.hint')}</p>
          </div>
          <div className="orq-field">
            <div className="orq-keyrow">
              <button type="button" className="orq-btn" disabled={probe.running} onClick={() => void test()}>
                {probe.running ? t('settings.test.running') : t('settings.test')}
              </button>
              <span className="orq-hint">{t('settings.test.hint')}</span>
            </div>
            {probe.result?.ok && (
              <p className="orq-hint" role="status">
                {t('settings.test.ok', { message: probe.result.message, model: probe.result.model, ms: probe.result.ms })}
              </p>
            )}
            {(probe.result && !probe.result.ok ? probe.result.message : probe.error) && (
              <p className="orq-field__error" role="alert">
                {t('settings.test.fail', { message: (probe.result && !probe.result.ok ? probe.result.message : probe.error) ?? '' })}
              </p>
            )}
          </div>
        </section>
        {work !== undefined && (
          <section id="sec-work" aria-labelledby="set-work">
            <h3 id="set-work">{t('settings.section.work')}</h3>
            <p className="orq-hint">{work ? t('settings.work.chosen', { name: work.name, files: work.files }) : t('settings.work.none')}</p>
            <p className="orq-hint">{t('settings.work.hint')}</p>
            <div className="orq-keyrow">
              <button type="button" className="orq-btn" onClick={() => void pickWork()}>
                {work ? t('settings.work.change') : t('settings.work.pick')}
              </button>
              {work && (
                <button type="button" className="orq-btn" onClick={() => void clearWork()}>
                  {t('settings.work.clear')}
                </button>
              )}
            </div>
            <PermissionPicker legend={t('perm.title')} value={projectPermission(draft)} onChange={(level) => level && level !== 'readonly' && set({ permissions: level })} />
            <p className="orq-hint">{t('perm.agentHint')}</p>
          </section>
        )}
        <section id="sec-rules" aria-labelledby="set-rules">
          <h3 id="set-rules">{t('settings.section.rules')}</h3>
          <p className="orq-hint">{t('settings.rules.intro')}</p>
          <ul className="orq-rules" aria-labelledby="set-rules">
            {RULES(projectPermission(draft)).map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
          <p className="orq-hint">{t('settings.rules.limit')}</p>
        </section>
        <section id="sec-budget" aria-labelledby="set-budget">
          <h3 id="set-budget">{t('settings.section.budget')}</h3>
          <div className="orq-form__row">
            <Field label={t('settings.parallel')} id="set-parallel" error={errors['maxParallel']}>
              <input id="set-parallel" type="number" min={1} max={16} value={draft.maxParallel} onChange={(e) => set({ maxParallel: Number(e.target.value) })} />
            </Field>
            <Field label={t('settings.tokens')} id="set-tokens" error={errors['defaultMaxTokens']}>
              <input id="set-tokens" type="number" min={1} value={tokens} onChange={(e) => ((touched.current = true), setTokens(e.target.value), setStatus(t('settings.saving')))} />
            </Field>
          </div>
        </section>
        <section id="sec-supervisor" aria-labelledby="set-supervisor">
          <h3 id="set-supervisor">{t('settings.sup')}</h3>
          <label className="orq-insp__check">
            <input type="checkbox" checked={supervisorReviews(draft)} onChange={(e) => set({ supervisorReview: e.target.checked })} />
            {t('settings.sup.review')}
          </label>
          <p className="orq-hint">{t('settings.sup.hint')}</p>
          <Field label={t('settings.sup.model')} id="set-sup-model" error={errors['supervisorModel']}>
            <select id="set-sup-model" value={supervisorModel(draft)} onChange={(e) => set({ supervisorModel: e.target.value })}>
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
        </section>
        <section id="sec-look" aria-labelledby="set-look">
          <h3 id="set-look">{t('settings.section.look')}</h3>
          <fieldset className="orq-field">
            <legend>{t('settings.theme')}</legend>
            <div className="orq-radios" role="radiogroup">
              {(['auto', 'light', 'dark'] as Theme[]).map((m) => (
                <label key={m}>
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
        </section>
        {errors['_'] && (
          <p className="orq-field__error" role="alert">
            {t('settings.error', { message: errors['_'] })}
          </p>
        )}
      </form>
    </Shell>
  );
}

/** Reglas que siguen todos los agentes, tal como las aplica el motor [R31.14]. */
const RULES = (level: ProjectPermission): MessageKey[] => [
  'settings.rules.read',
  'settings.rules.create',
  level === 'ask' ? 'settings.rules.modify.ask' : 'settings.rules.modify.auto',
  level === 'ask' ? 'settings.rules.commands' : level === 'auto' ? 'settings.rules.commands.auto' : 'settings.rules.commands.full',
  'settings.rules.agent',
  level === 'full' ? 'settings.rules.outside.full' : 'settings.rules.outside',
  'settings.rules.explain',
  'settings.rules.record',
];

const NAV: { id: string; label: MessageKey; work?: boolean }[] = [
  { id: 'sec-claude', label: 'settings.section.claude' },
  { id: 'sec-work', label: 'settings.section.work', work: true },
  { id: 'sec-rules', label: 'settings.section.rules' },
  { id: 'sec-budget', label: 'settings.section.budget' },
  { id: 'sec-look', label: 'settings.section.look' },
];

function Shell({ onClose, children, status, work }: { onClose?: (() => void) | undefined; children: React.ReactNode; status?: string | undefined; work?: boolean }) {
  return (
    <section className="orq-page orq-settings-page" aria-label={t('settings.title')}>
      <aside className="orq-settings-page__nav">
        {onClose && (
          <button type="button" className="orq-btn orq-btn--ghost orq-btn--small" onClick={onClose}>
            <ArrowLeft size={16} aria-hidden="true" />
            {t('settings.back')}
          </button>
        )}
        <h1>{t('settings.title')}</h1>
        <nav aria-label={t('settings.title')}>
          {NAV.filter((n) => !n.work || work).map((n) => (
            <a
              key={n.id}
              href={`#${n.id}`}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(n.id)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
              }}
            >
              {t(n.label)}
            </a>
          ))}
        </nav>
      </aside>
      <div className="orq-settings-page__main">
        <p className="orq-hint orq-settings-page__auto">
          {t('settings.autosaved')}{' '}
          {status && (
            <span role="status" className="orq-settings-page__status">
              {status}
            </span>
          )}
        </p>
        {children}
      </div>
    </section>
  );
}
