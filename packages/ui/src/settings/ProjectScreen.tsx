import { useCallback, useEffect, useState } from 'react';
import { Check, FolderGit2, Loader2 } from 'lucide-react';
import { mcpFromImport, newContext, projectPermission, slugify, type AgentDefinition, type ProjectPermission, type ContextDefinition, type ImportReport } from '@orquestador/core';
import { t, type LiveView, type MessageKey, type ProjectApi, type WorkFolderInspection, type WorkFolderView } from '@orquestador/editor';
import { MarkdownField } from '../common';
import { permissionName } from '../common';

interface Props {
  api: ProjectApi;
  live: LiveView;
  /** Abre el asistente al entrar (p. ej. desde «Desde la carpeta de un proyecto»). */
  startWizard?: boolean;
  onWizardShown?: () => void;
  onChanged: () => void;
  onGoDiagrams: () => void;
  onOpenSettings: () => void;
}

/** Proyecto (prototipo «Carpeta 3»): la carpeta conectada, sus agentes, lo último que se tocó y el acceso [R32.17]. */
export function ProjectScreen({ api, live, startWizard, onWizardShown, onChanged, onGoDiagrams, onOpenSettings }: Props) {
  const [folder, setFolder] = useState<WorkFolderView | null>();
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [level, setLevel] = useState<ProjectPermission>('auto');
  const [wizard, setWizard] = useState(Boolean(startWizard));
  useEffect(() => {
    if (startWizard) {
      setWizard(true);
      onWizardShown?.();
    }
  }, [startWizard, onWizardShown]);
  const reload = useCallback(async () => {
    const [f, a, s] = await Promise.all([api.getWorkFolder(), api.listAgents(), api.getSettings()]);
    setFolder(f.ok ? f.value : null);
    setAgents(a.ok ? a.value : []);
    if (s.ok) setLevel(projectPermission(s.value));
  }, [api]);
  useEffect(() => void reload(), [reload]);

  if (wizard)
    return (
      <FolderWizard
        api={api}
        onCancel={() => {
          setWizard(false);
          void reload();
        }}
        onDone={(to) => {
          setWizard(false);
          onChanged();
          void reload();
          if (to === 'diagrams') onGoDiagrams();
        }}
      />
    );
  return (
    <section className="orq-page orq-proj" aria-label={t('proj.title')}>
      <header className="orq-page__head">
        <h1>{t('proj.title')}</h1>
      </header>
      {folder === undefined ? null : folder === null ? (
        <div className="orq-proj__empty">
          <FolderGit2 size={32} strokeWidth={1.4} aria-hidden="true" />
          <h2>{t('proj.folder.none')}</h2>
          <p className="orq-hint">{t('proj.folder.none.hint')}</p>
          <button type="button" className="orq-btn orq-btn--primary" onClick={() => setWizard(true)}>
            {t('proj.folder.connect')}
          </button>
        </div>
      ) : (
        <div className="orq-proj__grid">
          <section className="orq-panel orq-proj__folder" aria-label={folder.name}>
            <FolderGit2 size={22} strokeWidth={1.5} aria-hidden="true" />
            <div>
              <strong>{folder.name}</strong>
              <span className="orq-hint">{t('proj.folder.files', { count: folder.files })}</span>
            </div>
            <span className="orq-proj__gap" />
            <button type="button" className="orq-btn orq-btn--small orq-btn--accent" onClick={() => setWizard(true)}>
              {t('proj.folder.analyze')}
            </button>
            <button
              type="button"
              className="orq-btn orq-btn--small"
              onClick={() =>
                void api.pickWorkFolder().then((r) => {
                  if (r.ok && r.value) setWizard(true);
                })
              }
            >
              {t('proj.folder.change')}
            </button>
            <button type="button" className="orq-btn orq-btn--small orq-btn--ghost" onClick={() => void api.clearWorkFolder().then(() => reload())}>
              {t('proj.folder.clear')}
            </button>
          </section>
          <section className="orq-panel" aria-label={t('proj.agents')}>
            <h2>{t('proj.agents')}</h2>
            {agents.length === 0 ? (
              <p className="orq-hint">{t('agents.empty')}</p>
            ) : (
              <ul className="orq-proj__list">
                {agents.map((a) => (
                  <li key={a.id}>
                    <span className="orq-pal__dot is-used" aria-hidden="true" />
                    <span>{a.name}</span>
                    <span className="orq-hint">{a.description}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="orq-panel" aria-label={t('proj.produced')}>
            <h2>{t('proj.produced')}</h2>
            {live.produced.length === 0 ? (
              <p className="orq-hint">{t('proj.produced.none')}</p>
            ) : (
              <ul className="orq-proj__files">
                {live.produced.map((f) => (
                  <li key={`${f.nodeId}:${f.path}`}>
                    <code>{f.path}</code>
                    <span className="orq-timeline__new">{t('results.new')}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="orq-panel" aria-label={t('proj.access')}>
            <h2>{t('proj.access')}</h2>
            <p className="orq-hint">{t('proj.access.text', { level: permissionName(level), what: t(`perm.${level}.hint`) })}</p>
            <button type="button" className="orq-link" onClick={onOpenSettings}>
              {t('proj.access.change')}
            </button>
          </section>
        </div>
      )}
    </section>
  );
}

type Step = 'folder' | 'review' | 'done';
const STEPS: { id: Step; label: MessageKey }[] = [
  { id: 'folder', label: 'wiz.step.folder' },
  { id: 'review', label: 'wiz.step.review' },
  { id: 'done', label: 'wiz.step.done' },
];

/** Asistente «Conectar la carpeta del proyecto» en tres pasos (prototipos «Carpeta 1» y «Carpeta 2») [R32.16][R32.17]. */
export function FolderWizard({ api, onCancel, onDone }: { api: ProjectApi; onCancel: () => void; onDone: (to: 'diagrams' | 'project') => void }) {
  const [step, setStep] = useState<Step>('folder');
  const [folder, setFolder] = useState<WorkFolderView | null>();
  const [scan, setScan] = useState<WorkFolderInspection>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [keys, setKeys] = useState<Set<string>>(new Set());
  const [summary, setSummary] = useState('');
  const [useSummary, setUseSummary] = useState(true);
  const [docs, setDocs] = useState<Set<string>>(new Set());
  /** Servidores de `.mcp.json` que se añaden al proyecto, siempre apagados [R30.6]. */
  const [mcpPick, setMcpPick] = useState<Set<string>>(new Set());
  const [level, setLevel] = useState<ProjectPermission>('auto');
  const [result, setResult] = useState<{ agents: number; skills: number; contexts: number }>();

  const inspect = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    const r = await api.inspectWorkFolder();
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    setScan(r.value);
    setKeys(new Set(r.value.report.items.filter((i) => !i.blocked).map((i) => i.key)));
    setSummary(r.value.summary);
    setDocs(new Set(r.value.docs.map((d) => d.name)));
  }, [api]);
  useEffect(() => {
    void api.getWorkFolder().then((r) => {
      const f = r.ok ? r.value : null;
      setFolder(f);
      if (f) void inspect();
    });
    void api.getSettings().then((r) => r.ok && setLevel(projectPermission(r.value)));
  }, [api, inspect]);

  const pick = async () => {
    const r = await api.pickWorkFolder();
    if (!r.ok) return setError(r.error.message);
    if (!r.value) return;
    setFolder(r.value);
    await inspect();
  };
  const cancel = () => {
    if (scan) void api.cancelImport(scan.importId);
    onCancel();
  };

  const apply = async () => {
    if (!scan) return;
    setBusy(true);
    setError(undefined);
    let installed = { agents: [] as string[], skills: [] as string[] };
    const chosen = scan.report.items.filter((i) => keys.has(i.key)).map((i) => i.key);
    if (chosen.length > 0) {
      const r = await api.confirmImport({ importId: scan.importId, keys: chosen });
      if (!r.ok) {
        setBusy(false);
        return setError(r.error.message);
      }
      installed = r.value;
    } else void api.cancelImport(scan.importId);
    // Contexto común: resumen y documentos guía, asignados a todos los agentes [R32.17].
    const existing = await api.listContexts();
    const taken = new Set(existing.ok ? existing.value.map((c) => c.id) : []);
    const made: ContextDefinition[] = [];
    const add = (name: string, value: string) => {
      const prev = existing.ok ? existing.value.find((c) => c.name === name && c.kind === 'text') : undefined;
      const id = prev?.id ?? slugify(name, taken, 'contexto');
      taken.add(id);
      made.push({ ...newContext(id, name), value });
    };
    if (useSummary && summary.trim() !== '') add(t('wiz.summary.ctx'), summary.trim());
    for (const d of scan.docs) if (docs.has(d.name)) add(d.name, d.text);
    for (const c of made) {
      const r = await api.saveContext(c);
      if (!r.ok) {
        setBusy(false);
        return setError(r.error.message);
      }
    }
    // MCP de la carpeta: se añaden apagados y sin secretos; el usuario los revisa y activa en Conocimiento [R30.6].
    const known = await api.listMcp();
    const takenMcp = new Set(known.ok ? known.value.map((m) => m.id) : []);
    for (const m of scan.report.mcp.filter((x) => mcpPick.has(x.name))) {
      const def = mcpFromImport(m, takenMcp);
      takenMcp.add(def.id);
      const r = await api.saveMcp(def);
      if (!r.ok) {
        setBusy(false);
        return setError(r.error.message);
      }
    }
    const all = await api.listAgents();
    if (all.ok)
      for (const a of all.value) {
        const ids = [...new Set([...a.contextIds, ...made.map((c) => c.id)])];
        if (ids.length !== a.contextIds.length) await api.saveAgent({ ...a, contextIds: ids });
      }
    setBusy(false);
    setResult({ agents: installed.agents.length, skills: installed.skills.length, contexts: made.length });
    setStep('done');
  };

  const report: ImportReport | undefined = scan?.report;
  const agents = report?.items.filter((i) => i.kind === 'agent') ?? [];
  const skills = report?.items.filter((i) => i.kind === 'skill') ?? [];
  const toggle = (set: Set<string>, k: string, on: boolean) => {
    const n = new Set(set);
    if (on) n.add(k);
    else n.delete(k);
    return n;
  };
  const stepIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <section className="orq-page orq-wiz" aria-label={t('wiz.title')}>
      <header className="orq-wiz__head">
        <strong>{t('wiz.title')}</strong>
        <ol className="orq-wiz__steps">
          {STEPS.map((s, i) => (
            <li key={s.id} className={i < stepIndex ? 'is-done' : i === stepIndex ? 'is-on' : undefined} aria-current={i === stepIndex ? 'step' : undefined}>
              <b aria-hidden="true">{i < stepIndex ? <Check size={12} strokeWidth={2.5} /> : i + 1}</b>
              {t(s.label)}
            </li>
          ))}
        </ol>
        {step !== 'done' && (
          <button type="button" className="orq-btn orq-btn--ghost" onClick={cancel}>
            {t('wiz.cancel')}
          </button>
        )}
      </header>
      {error && (
        <p className="orq-field__error orq-wiz__error" role="alert">
          {error}
        </p>
      )}

      {step === 'folder' && (
        <div className="orq-wiz__body">
          <div className="orq-wiz__col">
            <h1>{t('wiz.q')}</h1>
            <p className="orq-hint orq-wiz__lead">{t('wiz.q.hint')}</p>
            <div className={`orq-panel orq-wiz__folder${folder ? ' is-on' : ''}`}>
              <FolderGit2 size={22} strokeWidth={1.5} aria-hidden="true" />
              <div>
                <strong>{folder ? folder.name : t('settings.work.none')}</strong>
                {folder && <span className="orq-hint">{t('proj.folder.files', { count: folder.files })}</span>}
              </div>
              <span className="orq-proj__gap" />
              <button type="button" className={`orq-btn${folder ? '' : ' orq-btn--primary'}`} onClick={() => void pick()}>
                {folder ? t('wiz.change') : t('wiz.pick')}
              </button>
            </div>
            {scan && (
              <div className="orq-panel orq-wiz__tree">
                <div className="orq-wiz__treehead">
                  <span className="orq-k">{t('wiz.reading')}</span>
                  <span className="orq-hint">{t('wiz.reading.hint')}</span>
                </div>
                <pre>{scan.summary}</pre>
              </div>
            )}
            <p className="orq-hint">{t('wiz.privacy')}</p>
          </div>
          <div className="orq-panel orq-wiz__found">
            <div className="orq-wiz__foundhead">
              {busy ? <Loader2 size={16} className="orq-spin" aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
              <strong>{t('wiz.found')}</strong>
            </div>
            {scan ? (
              <ul role="list">
                {agents.length > 0 && <li><span>✓ {t('wiz.found.agents', { count: agents.length })}</span><span className="orq-hint">{agents.map((a) => a.name).join(', ')}</span></li>}
                {skills.length > 0 && <li><span>✓ {t('wiz.found.skills', { count: skills.length })}</span><span className="orq-hint">{skills.map((a) => a.name).join(', ')}</span></li>}
                {scan.docs.length > 0 && <li><span>✓ {t('wiz.found.docs', { names: scan.docs.map((d) => d.name).join(', ') })}</span></li>}
                {scan.report.mcp.length > 0 && <li><span>✓ {t('wiz.found.mcp', { count: scan.report.mcp.length })}</span><span className="orq-hint">{scan.report.mcp.map((m) => m.name).join(', ')}</span></li>}
                {agents.length + skills.length === 0 && <li className="orq-hint">{t('wiz.found.nothing')}</li>}
              </ul>
            ) : (
              <p className="orq-hint">{t('wiz.q.hint')}</p>
            )}
            <span className="orq-proj__gap" />
            <div className="orq-wiz__actions">
              <button type="button" className="orq-btn orq-btn--primary" disabled={!scan || busy} onClick={() => setStep('review')}>
                {t('wiz.next')}
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 'review' && scan && (
        <div className="orq-wiz__body">
          <div className="orq-wiz__col">
            {agents.length > 0 && (
              <section className="orq-panel orq-wiz__table" aria-label={t('wiz.agents', { count: agents.length })}>
                <h2 className="orq-k">{t('wiz.agents', { count: agents.length })}</h2>
                {agents.map((a) => (
                  <label key={a.key} className="orq-wiz__row">
                    <input type="checkbox" checked={keys.has(a.key)} disabled={Boolean(a.blocked)} onChange={(e) => setKeys((s) => toggle(s, a.key, e.target.checked))} />
                    <span className="orq-wiz__name">
                      <strong>{a.name}</strong>
                      <span className="orq-hint">{a.blocked ?? a.description}</span>
                    </span>
                    <span className="orq-wiz__warns">
                      {(a.skills ?? []).map((k) => (
                        <span key={k} className={`orq-tag${keys.has(k) ? '' : ' is-off'}`}>
                          {skills.find((x) => x.key === k)?.name ?? k}
                        </span>
                      ))}
                      {a.warnings.map((w) => (
                        <span key={w.code + w.message} className="orq-tag is-warn" title={w.message}>
                          {w.message}
                        </span>
                      ))}
                    </span>
                  </label>
                ))}
                <p className="orq-hint">{t('wiz.copy.note')}</p>
              </section>
            )}
            {skills.length > 0 && (
              <section className="orq-panel orq-wiz__table" aria-label={t('wiz.skills', { count: skills.length })}>
                <h2 className="orq-k">{t('wiz.skills', { count: skills.length })}</h2>
                {skills.map((a) => (
                  <label key={a.key} className="orq-wiz__row">
                    <input type="checkbox" checked={keys.has(a.key)} disabled={Boolean(a.blocked)} onChange={(e) => setKeys((s) => toggle(s, a.key, e.target.checked))} />
                    <span className="orq-wiz__name">
                      <strong>{a.name}</strong>
                      <span className="orq-hint">{a.blocked ?? a.description}</span>
                    </span>
                  </label>
                ))}
              </section>
            )}
            <section className="orq-panel orq-wiz__table" aria-label={t('wiz.common')}>
              <h2 className="orq-k">{t('wiz.common')}</h2>
              <label className="orq-wiz__row">
                <input type="checkbox" checked={useSummary} onChange={(e) => setUseSummary(e.target.checked)} />
                <span className="orq-wiz__name">
                  <strong>{t('wiz.summary')}</strong>
                </span>
              </label>
              {useSummary && (
                <MarkdownField
                  id="wiz-summary"
                  label={t('wiz.summary')}
                  value={summary}
                  max={100_000}
                  onChange={setSummary}
                  assist={{ api, kind: 'context', field: 'value', current: { name: t('wiz.summary.ctx'), value: summary }, names: { contexts: {}, skills: {} }, onApply: (f) => typeof f['value'] === 'string' && setSummary(f['value']) }}
                />
              )}
              {scan.docs.map((d) => (
                <label key={d.name} className="orq-wiz__row">
                  <input type="checkbox" checked={docs.has(d.name)} onChange={(e) => setDocs((s) => toggle(s, d.name, e.target.checked))} />
                  <span className="orq-wiz__name">
                    <strong>{d.name}</strong>
                    <span className="orq-hint">{d.text.split('\n').find((l) => l.trim() !== '')?.replace(/^#+\s*/, '') ?? ''}</span>
                  </span>
                  <span className="orq-hint">{Math.max(1, Math.round(d.text.length / 1024))} KB</span>
                </label>
              ))}
            </section>
          </div>
          <div className="orq-wiz__col orq-wiz__col--side">
            <section className="orq-panel" aria-label={t('wiz.access', { name: scan.folder.name })}>
              <h2 className="orq-k">{t('wiz.access', { name: scan.folder.name })}</h2>
              <dl className="orq-wiz__perms">
                <div><dt>{t('wiz.access.read')}</dt><dd>{t('wiz.access.always')}</dd></div>
                <div><dt>{t('wiz.access.create')}</dt><dd className="is-accent">{t('wiz.access.auto')}</dd></div>
                <div><dt>{t('wiz.access.modify')}</dt><dd>{t(level === 'ask' ? 'wiz.access.ask' : 'wiz.access.auto')}</dd></div>
                <div><dt>{t('wiz.access.commands')}</dt><dd>{t(level === 'ask' ? 'wiz.access.askNotSimple' : level === 'auto' ? 'wiz.access.askDanger' : 'wiz.access.auto')}</dd></div>
                <div><dt>{t('wiz.access.delete')}</dt><dd>{t(level === 'full' ? 'wiz.access.auto' : 'wiz.access.ask')}</dd></div>
              </dl>
              <p className="orq-hint">{t('wiz.access.hint')}</p>
            </section>
            {scan.report.mcp.map((m) => (
              <section key={m.name} className="orq-panel orq-wiz__mcp" aria-label={m.name}>
                <div className="orq-wiz__mcphead">
                  <label className="orq-check">
                    <input type="checkbox" checked={mcpPick.has(m.name)} onChange={(e) => setMcpPick((p) => toggle(p, m.name, e.target.checked))} />
                    <strong>{m.name}</strong>
                  </label>
                  <span className="orq-tag">{t('wiz.mcp.off')}</span>
                </div>
                <p className="orq-hint">{t('wiz.mcp.hint', { command: m.command ?? m.url ?? '?' })}</p>
                {m.secretNames && m.secretNames.length > 0 && <p className="orq-hint">{t('wiz.mcp.secrets', { names: m.secretNames.join(', ') })}</p>}
              </section>
            ))}
            <section className="orq-panel">
              <h2 className="orq-k">{t('wiz.willCreate')}</h2>
              <p className="orq-hint">
                {t('wiz.willCreate.text', {
                  agents: agents.filter((a) => keys.has(a.key)).length,
                  skills: skills.filter((a) => keys.has(a.key)).length,
                  contexts: (useSummary && summary.trim() ? 1 : 0) + docs.size,
                })}
              </p>
            </section>
            <div className="orq-wiz__actions">
              <button type="button" className="orq-btn orq-btn--ghost" onClick={() => setStep('folder')}>
                {t('wiz.back')}
              </button>
              <span className="orq-proj__gap" />
              <button type="button" className="orq-btn orq-btn--primary" disabled={busy} onClick={() => void apply()}>
                {busy ? t('wiz.applying') : t('wiz.apply')}
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 'done' && result && scan && (
        <div className="orq-wiz__done">
          <Check size={28} strokeWidth={2} aria-hidden="true" />
          <h1>{t('wiz.done', { name: scan.folder.name })}</h1>
          <p className="orq-hint">{t('wiz.done.text', result)}</p>
          <div className="orq-wiz__actions">
            <button type="button" className="orq-btn" onClick={() => onDone('project')}>
              {t('wiz.done.project')}
            </button>
            <button type="button" className="orq-btn orq-btn--primary" onClick={() => onDone('diagrams')}>
              {t('wiz.done.diagrams')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

