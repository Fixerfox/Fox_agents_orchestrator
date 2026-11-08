import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Eye, Folder, Gauge, KeyRound, Palette, ShieldCheck, Sparkles, type LucideIcon } from 'lucide-react';
import { MODELS, loadsClaudeConfig, projectPermission, type AppSettings, type AuthMode, type Engine, type ProjectPermission, supervisorHumanChecks, supervisorModel, supervisorReviews } from '@orquestador/core';
import { PermissionPicker, permissionName } from '../common';
import { PROJECT_LEVELS, permissionMatrix, t, type ConnectionResult, type MessageKey, type PermAnswer, type ProjectApi, type SettingsView, type WorkFolderView } from '@orquestador/editor';
import { fieldErrors } from '../common';
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
          <Row id="set-tokens" label={t('settings.tokens')} error={errors['defaultMaxTokens']}>
            <input id="set-tokens" type="number" min={1} value={tokens} onChange={(e) => ((touched.current = true), setTokens(e.target.value), setStatus(t('settings.saving')))} />
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

type SectionId = 'claude' | 'perms' | 'supervisor' | 'budget' | 'look' | 'work';

/** Una sección de Ajustes: entrada del índice y su contenido [R67.1]. */
interface Section {
  id: SectionId;
  group: 'general' | 'project';
  icon: LucideIcon;
  label: string;
  summary: string;
  intro: string;
  content: React.ReactNode;
}

const ANSWER_MARK: Record<PermAnswer, string> = { yes: '✓', ask: '?', no: '✕' };

/** «Lo que pasará con cada nivel»: acciones × niveles, con el nivel elegido resaltado [R67.6]. */
function PermMatrix({ level }: { level: ProjectPermission }) {
  return (
    <div className="orq-permtable">
      <table>
        <caption>{t('perm.matrix')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('perm.matrix.action')}</th>
            {PROJECT_LEVELS.map((l) => (
              <th key={l} scope="col" className={l === level ? 'is-on' : undefined} aria-current={l === level ? 'true' : undefined}>
                {permissionName(l)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {permissionMatrix().map((r) => (
            <tr key={r.action}>
              <th scope="row">{t(`perm.row.${r.action}` as MessageKey)}</th>
              {PROJECT_LEVELS.map((l) => (
                <td key={l} className={`is-${r.answers[l]}${l === level ? ' is-on' : ''}`}>
                  <span aria-hidden="true">{ANSWER_MARK[r.answers[l]]}</span> {t(`perm.ans.${r.answers[l]}` as MessageKey)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Opciones con consecuencias: tarjetas con su explicación debajo [R67.3]. */
function Choice<V extends string>({ legend, name, value, options, onChange, error, list = false }: { legend: string; name: string; value: V; options: { value: V; label: string; hint: string }[]; onChange: (v: V) => void; error?: string | undefined; list?: boolean }) {
  return (
    <fieldset className="orq-field orq-choice">
      <legend>{legend}</legend>
      <div className={`orq-choice__opts${list ? ' is-list' : ''}`} role="radiogroup">
        {options.map((o) => (
          <div key={o.value} className={`orq-choice__opt${value === o.value ? ' is-on' : ''}`}>
            <label>
              <input type="radio" name={name} checked={value === o.value} aria-describedby={`${name}-${o.value}-hint`} onChange={() => onChange(o.value)} />
              <span>{o.label}</span>
            </label>
            <p className="orq-hint" id={`${name}-${o.value}-hint`}>
              {o.hint}
            </p>
          </div>
        ))}
      </div>
      {error && (
        <p className="orq-field__error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/** Fila de ajuste: texto a la izquierda y el control a la derecha [R67.3]. */
function Row({ id, label, hint, error, children }: { id: string; label: string; hint?: string | undefined; error?: string | undefined; children: React.ReactNode }) {
  return (
    <div className={`orq-field orq-setrow${error ? ' has-error' : ''}`}>
      <div className="orq-setrow__text">
        <label htmlFor={id}>{label}</label>
        {hint && <p className="orq-hint">{hint}</p>}
        {error && (
          <p className="orq-field__error" id={`${id}-error`} role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="orq-setrow__ctrl">{children}</div>
    </div>
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

/** Página de Ajustes: índice por grupos a la izquierda, una sección cada vez y el estado del guardado al pie [R67.1][R67.5]. */
function Shell({ onClose, children, status, items, current, onPick }: { onClose?: (() => void) | undefined; children: React.ReactNode; status?: string | undefined; items: readonly Section[]; current: SectionId; onPick: (id: SectionId) => void }) {
  const groups = (['general', 'project'] as const).map((g) => ({ g, rows: items.filter((x) => x.group === g) })).filter((x) => x.rows.length > 0);
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
          {groups.map(({ g, rows }) => (
            <div key={g} className="orq-setnav__group">
              <span className="orq-setnav__label">{t(g === 'general' ? 'settings.group.general' : 'settings.group.project')}</span>
              {rows.map((x) => {
                const Icon = x.icon;
                return (
                  <button key={x.id} type="button" className="orq-setnav__item" aria-current={x.id === current ? 'page' : undefined} onClick={() => onPick(x.id)}>
                    <Icon size={16} strokeWidth={1.7} aria-hidden="true" className="orq-setnav__icon" />
                    <span className="orq-setnav__text">
                      <span className="orq-setnav__title">{x.label}</span>
                      <span className="orq-setnav__sum">{x.summary}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <p className="orq-hint orq-settings-page__auto">
          {t('settings.autosaved')}{' '}
          {status && (
            <span role="status" className="orq-settings-page__status">
              {status}
            </span>
          )}
        </p>
      </aside>
      <div className="orq-settings-page__main">{children}</div>
    </section>
  );
}
