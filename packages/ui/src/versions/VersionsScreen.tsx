import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, GitBranch, Lock, Play, Plus, RefreshCw } from 'lucide-react';
import { gitActionAlwaysAsks, gitActionProblem, isProtectedBranch, validBranchName, type GitAction, type GitBranchInfo, type GitCommit, type GitFileChange, type GitOrigin } from '@orquestador/core';
import { agoText, commitGraph, t, type GitHistoryView, type GitOverviewView, type GitReviewsView, type GraphRow, type ProjectApi } from '@orquestador/editor';
import { ReviewBlock } from './ReviewBlock';

interface Props {
  api: ProjectApi;
  /** Abre la ejecución (el trabajo) que creó una rama o un commit [R98.4]. */
  onOpenRun?: (runId: string) => void;
  /** Confirmación antes de borrar una rama. Por defecto `window.confirm`. */
  confirm?: (message: string) => boolean;
  /** Cambia cuando algo de fuera (el asistente, una ejecución) pudo tocar git. */
  version?: number;
}

/** Cada cuánto, como mucho, se vuelven a pedir las PR o MR al volver a la ventana [R99.11]. */
const REVIEWS_EVERY_MS = 60_000;
const ROW = 40;
const LANE = 18;
const TONES = ['var(--accent)', 'var(--tone-blue)', 'var(--tone-teal)', 'var(--tone-violet)', 'var(--tone-rose)', 'var(--tone-green)'];
const tone = (lane: number) => TONES[lane % TONES.length]!;
const STATUS_MARK: Record<GitFileChange['status'], string> = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R', untracked: 'A', conflict: '!' };
const ago = (iso: string | undefined) => (iso ? agoText(Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)) : '');

/** El trabajo que creó algo, como una ficha que lleva a su ejecución [R98.4]. */
function OriginChip({ origin, onOpenRun }: { origin: GitOrigin; onOpenRun?: (runId: string) => void }) {
  return (
    <button type="button" className="orq-ver__origin" title={t('ver.origin.title', { name: origin.name })} aria-label={t('ver.origin.title', { name: origin.name })} onClick={() => onOpenRun?.(origin.runId)}>
      <Play size={10} aria-hidden="true" /> {origin.name}
    </button>
  );
}

/** El dibujo de una fila del grafo: lo que llega, lo que sale, lo que pasa de largo y el commit [R98.5]. */
function GraphCell({ row, lanes }: { row: GraphRow; lanes: number }) {
  const x = (lane: number) => 12 + lane * LANE;
  const mid = ROW / 2;
  const curve = (from: number, y1: number, to: number, y2: number) => `M${x(from)} ${y1} C ${x(from)} ${(y1 + y2) / 2}, ${x(to)} ${(y1 + y2) / 2}, ${x(to)} ${y2}`;
  return (
    <svg className="orq-ver__graph" width={12 + lanes * LANE} height={ROW} aria-hidden="true">
      {row.pass.map((l) => (
        <line key={`p${l}`} x1={x(l)} y1={0} x2={x(l)} y2={ROW} stroke={tone(l)} strokeWidth={2} />
      ))}
      {row.from.map((l) => (
        <path key={`f${l}`} d={curve(l, 0, row.lane, mid)} fill="none" stroke={tone(l)} strokeWidth={2} />
      ))}
      {row.to.map((l) => (
        <path key={`t${l}`} d={curve(row.lane, mid, l, ROW)} fill="none" stroke={tone(l)} strokeWidth={2} />
      ))}
      <circle cx={x(row.lane)} cy={mid} r={4.5} fill="var(--bg)" stroke={tone(row.lane)} strokeWidth={2.5} />
    </svg>
  );
}

/** Diferencia en formato unificado, línea a línea [R98.3]. */
function UnifiedDiff({ text }: { text: string }) {
  const lines = text.split('\n').filter((l) => !/^(diff --git|index |--- |\+\+\+ |new file|deleted file|similarity|rename )/.test(l));
  return (
    <pre className="orq-ver__diff" aria-label={t('ver.diff')}>
      {lines.map((l, i) => (
        <span key={i} className={l.startsWith('+') ? 'is-add' : l.startsWith('-') ? 'is-del' : l.startsWith('@@') ? 'is-hunk' : undefined}>
          {l === '' ? ' ' : l}
          {'\n'}
        </span>
      ))}
    </pre>
  );
}

/** Sección «Versiones»: ramas, historial y cambios de la carpeta del proyecto (prototipo A) [R98.9]. */
export function VersionsScreen({ api, onOpenRun, confirm = (m) => window.confirm(m), version = 0 }: Props) {
  const [view, setView] = useState<GitOverviewView | null>();
  const [history, setHistory] = useState<GitHistoryView>({ commits: [], origins: {} });
  const [reviews, setReviews] = useState<GitReviewsView | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string>();
  const [commitSha, setCommitSha] = useState<string>();
  const [file, setFile] = useState<string>();
  const [diff, setDiff] = useState('');
  const [message, setMessage] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newFrom, setNewFrom] = useState('');

  const loadHistory = useCallback(async () => {
    const h = await api.gitHistory({ limit: 200 });
    if (h.ok) setHistory(h.value);
  }, [api]);
  // Las PR o MR van aparte: hablan con el servidor y no deben frenar lo local [R99.11].
  const reviewsAt = useRef(0);
  const loadReviews = useCallback(
    async (force = true) => {
      // Al volver a la ventana no se llama al servidor más de una vez por minuto.
      if (!force && Date.now() - reviewsAt.current < REVIEWS_EVERY_MS) return;
      reviewsAt.current = Date.now();
      const r = await api.gitReviews();
      setReviews(r.ok ? r.value : null);
    },
    [api],
  );
  const reload = useCallback(async (forceReviews = true) => {
    const r = await api.gitOverview();
    if (!r.ok) {
      setError(r.error.message);
      setView(null);
      return;
    }
    setView(r.value);
    if (!r.value) return;
    await loadHistory();
    void loadReviews(forceReviews);
  }, [api, loadHistory, loadReviews]);
  useEffect(() => {
    void reload();
  }, [reload, version]);
  // Git cambia también desde fuera (la terminal): al volver a la ventana se mira otra vez.
  useEffect(() => {
    const onFocus = () => void reload(false);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reload]);
  useEffect(() => {
    if (!file) return;
    let alive = true;
    void api.gitDiff({ path: file }).then((r) => {
      if (alive) setDiff(r.ok ? r.value : r.error.message);
    });
    return () => {
      alive = false;
    };
  }, [api, file, view]);

  const graph = useMemo(() => commitGraph(history.commits), [history.commits]);
  if (view === undefined) return <section className="orq-ver" aria-label={t('ver.title')} />;
  if (view === null)
    return (
      <section className="orq-ver orq-ver--empty" aria-label={t('ver.title')}>
        <GitBranch size={32} strokeWidth={1.4} aria-hidden="true" />
        <h2>{t('ver.none')}</h2>
        <p className="orq-hint">{error ?? t('ver.none.hint')}</p>
      </section>
    );

  const { state } = view;
  const local = view.branches.filter((b) => !b.remote);
  const remote = view.branches.filter((b) => b.remote);
  const names = local.map((b) => b.name);
  const current = local.find((b) => b.current);
  const problemOf = (a: GitAction) => gitActionProblem(a, state, { running: view.running, branches: names });
  const act = async (a: GitAction) => {
    setBusy(true);
    setError(undefined);
    const r = await api.gitAct(a);
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    setView(r.value);
    await loadHistory();
    if (a.kind === 'push' || a.kind === 'fetch' || a.kind === 'switch' || a.kind === 'create') void loadReviews();
    return true;
  };
  const action = (label: string, a: GitAction, opts: { icon?: typeof Plus; primary?: boolean } = {}) => {
    const problem = problemOf(a);
    const Icon = opts.icon;
    return (
      <button
        type="button"
        className={`orq-btn orq-btn--small${opts.primary ? ' orq-btn--primary' : ''}`}
        disabled={busy || problem !== undefined}
        title={problem}
        onClick={() => {
          // Borrar una rama y subir a una protegida se confirman siempre [R98.14].
          if (gitActionAlwaysAsks(a, state) && !confirm(a.kind === 'delete' ? t('ver.delete.ask', { branch: a.name }) : t('ver.push.ask', { branch: state.branch ?? '' }))) return;
          void act(a);
        }}
      >
        {Icon && <Icon size={14} aria-hidden="true" />} {label}
      </button>
    );
  };
  const branchRow = (b: GitBranchInfo) => {
    const origin = view.origins[b.name];
    // La PR o MR abierta de la rama, si la hay [R99.11].
    const review = b.remote ? undefined : reviews?.reviews.find((r) => r.head === b.name && (r.state === 'open' || r.state === 'draft'));
    const on = picked === b.name;
    return (
      <li key={`${b.remote ? 'r' : 'l'}:${b.name}`} className={`orq-ver__branch${b.current ? ' is-current' : ''}${on ? ' is-on' : ''}`}>
        <button type="button" className="orq-ver__branchname" aria-pressed={b.remote ? undefined : on} aria-current={b.current ? 'true' : undefined} disabled={b.remote} onClick={() => setPicked(on ? undefined : b.name)}>
          <span className="orq-mono">{b.name}</span>
        </button>
        {!b.remote && isProtectedBranch(b.name) && <Lock size={11} aria-label={t('ver.protected')} />}
        {origin && <OriginChip origin={origin} {...(onOpenRun ? { onOpenRun } : {})} />}
        {review && (
          <span className="orq-ver__revbadge" title={t('ver.rev.badge', { word: reviews!.word, n: review.number })} aria-label={t('ver.rev.badge', { word: reviews!.word, n: review.number })}>
            #{review.number}
          </span>
        )}
        {(b.ahead ?? 0) > 0 && <span className="orq-ver__ab">↑{b.ahead}</span>}
        {(b.behind ?? 0) > 0 && <span className="orq-ver__ab">↓{b.behind}</span>}
      </li>
    );
  };
  const selected = history.commits.find((c) => c.sha === commitSha);
  const createName = newName.trim();
  const createAction: GitAction = { kind: 'create', name: createName, ...(newFrom && newFrom !== current?.name ? { from: newFrom } : {}) };
  const createProblem = createName === '' ? '' : !validBranchName(createName) ? t('ver.new.bad') : problemOf(createAction);
  const commitRow = (c: GitCommit, row: GraphRow) => (
    <li key={c.sha} className={`orq-ver__commit${commitSha === c.sha ? ' is-on' : ''}`}>
      <GraphCell row={row} lanes={graph.lanes} />
      <button type="button" className="orq-ver__subject" aria-pressed={commitSha === c.sha} onClick={() => setCommitSha(commitSha === c.sha ? undefined : c.sha)}>
        {c.subject}
      </button>
      {c.refs.map((r) => (
        <span key={r} className={`orq-ver__ref${r === state.branch ? ' is-current' : ''}`}>
          {r.replace(/^tag: /, '')}
        </span>
      ))}
      {history.origins[c.sha] && <OriginChip origin={history.origins[c.sha]!} {...(onOpenRun ? { onOpenRun } : {})} />}
      <span className="orq-ver__gap" />
      <span className="orq-ver__who">{c.author}</span>
      <span className="orq-ver__when">{ago(c.date)}</span>
    </li>
  );

  return (
    <section className="orq-ver" aria-label={t('ver.title')}>
      <aside className="orq-ver__left" aria-label={t('ver.branches')}>
        <h3>{t('ver.local', { n: local.length })}</h3>
        <ul>{local.map(branchRow)}</ul>
        {picked && picked !== current?.name && (
          <div className="orq-ver__picked" role="group" aria-label={t('ver.picked', { branch: picked })}>
            {action(t('ver.switch'), { kind: 'switch', name: picked })}
            {action(t('ver.merge', { into: current?.name ?? '' }), { kind: 'merge', name: picked })}
            {action(t('ver.delete'), { kind: 'delete', name: picked })}
          </div>
        )}
        {remote.length > 0 && (
          <>
            <h3>{t('ver.remote', { n: remote.length })}</h3>
            <ul>{remote.map(branchRow)}</ul>
          </>
        )}
        {view.stashes.length > 0 && (
          <>
            <h3>{t('ver.stashes', { n: view.stashes.length })}</h3>
            <ul>
              {view.stashes.map((s) => (
                <li key={s.index} className="orq-ver__stash">
                  <span className="orq-mono">{s.label}</span>
                  {action(t('ver.stash.pop'), { kind: 'stash-pop', index: s.index })}
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>

      <main className="orq-ver__center">
        <div className="orq-ver__bar">
          <span className="orq-ver__here">
            <GitBranch size={14} aria-hidden="true" /> <strong className="orq-mono">{state.branch ?? t('ver.detached')}</strong>
          </span>
          <button type="button" className="orq-btn orq-btn--small" aria-expanded={creating} onClick={() => setCreating((v) => !v)}>
            <Plus size={14} aria-hidden="true" /> {t('ver.new')}
          </button>
          {action(t('ver.fetch'), { kind: 'fetch' }, { icon: RefreshCw })}
          {(current?.behind ?? 0) > 0 && action(t('ver.pull', { n: current!.behind! }), { kind: 'pull' }, { icon: ArrowDown })}
          {action(current?.upstream ? t('ver.push', { n: current.ahead ?? 0 }) : t('ver.publish'), { kind: 'push' }, { icon: ArrowUp, primary: (current?.ahead ?? 0) > 0 || !current?.upstream })}
        </div>
        {creating && (
          <form
            className="orq-ver__new"
            aria-label={t('ver.new')}
            onSubmit={(e) => {
              e.preventDefault();
              if (createName === '' || createProblem) return;
              void act(createAction).then((done) => {
                if (!done) return;
                setCreating(false);
                setNewName('');
              });
            }}
          >
            <label className="orq-field">
              <span>{t('ver.new.name')}</span>
              <input type="text" value={newName} spellCheck={false} onChange={(e) => setNewName(e.target.value)} />
            </label>
            <label className="orq-field">
              <span>{t('ver.new.from')}</span>
              <select value={newFrom || current?.name || ''} onChange={(e) => setNewFrom(e.target.value)}>
                {names.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="orq-btn orq-btn--small orq-btn--primary" disabled={busy || createName === '' || Boolean(createProblem)}>
              {t('ver.new.create')}
            </button>
            {createProblem && (
              <p className="orq-field__error" role="alert">
                {createProblem}
              </p>
            )}
          </form>
        )}
        {view.running > 0 && (
          <p className="orq-ver__lock" role="note">
            <Lock size={13} aria-hidden="true" /> {t('ver.locked', { n: view.running })}
          </p>
        )}
        {error && (
          <p className="orq-field__error orq-ver__error" role="alert">
            {error}
          </p>
        )}
        <ol className="orq-ver__history" aria-label={t('ver.history')}>
          {history.commits.map((c, i) => commitRow(c, graph.rows[i]!))}
        </ol>
        {history.commits.length === 0 && <p className="orq-hint orq-ver__nohistory">{t('ver.history.none')}</p>}
      </main>

      <aside className="orq-ver__right" aria-label={t('ver.detail')}>
        {selected ? (
          <div className="orq-ver__commitinfo" role="group" aria-label={t('ver.commit')}>
            <h3>{t('ver.commit')}</h3>
            <strong>{selected.subject}</strong>
            <p className="orq-hint">
              <span className="orq-mono">{selected.sha.slice(0, 7)}</span> · {selected.author} · {ago(selected.date)}
            </p>
            {history.origins[selected.sha] ? (
              <p className="orq-ver__madeby">
                {t('ver.madeby')} <OriginChip origin={history.origins[selected.sha]!} {...(onOpenRun ? { onOpenRun } : {})} />
              </p>
            ) : (
              <p className="orq-hint">{t('ver.madeby.none')}</p>
            )}
          </div>
        ) : null}
        <h3>{t('ver.changes', { n: view.changes.length })}</h3>
        {view.changes.length === 0 ? (
          <p className="orq-hint">{t('ver.changes.none')}</p>
        ) : (
          <ul className="orq-ver__files">
            {view.changes.map((c) => (
              <li key={c.path}>
                <button type="button" className={`orq-ver__file${file === c.path ? ' is-on' : ''}`} aria-pressed={file === c.path} onClick={() => setFile(file === c.path ? undefined : c.path)}>
                  <span className={`orq-ver__mark is-${c.status}`} title={t(`ver.status.${c.status}`)}>
                    {STATUS_MARK[c.status]}
                  </span>
                  <span className="orq-mono orq-ver__path">{c.path}</span>
                  {c.added !== undefined && <span className="orq-ver__plus">+{c.added}</span>}
                  {c.removed !== undefined && <span className="orq-ver__minus">−{c.removed}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {file && view.changes.some((c) => c.path === file) && <UnifiedDiff text={diff} />}
        {view.changes.length > 0 && (
          <form
            className="orq-ver__commitform"
            onSubmit={(e) => {
              e.preventDefault();
              if (message.trim() === '') return;
              void act({ kind: 'commit', message: message.trim() }).then((done) => {
                if (done) setMessage('');
              });
            }}
          >
            <label className="orq-field">
              <span>{t('ver.message')}</span>
              <textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} />
            </label>
            <div className="orq-ver__commitbtns">
              <button type="submit" className="orq-btn orq-btn--small orq-btn--primary" disabled={busy || message.trim() === '' || state.branch === undefined}>
                <Check size={14} aria-hidden="true" /> {t('ver.commit.do', { branch: state.branch ?? '' })}
              </button>
              {action(t('ver.stash'), { kind: 'stash' })}
            </div>
          </form>
        )}
        {reviews && <ReviewBlock api={api} view={reviews} current={current} branches={names} suggestedTitle={history.commits.find((c) => c.sha === current?.sha)?.subject ?? current?.subject ?? ''} onChanged={() => void loadReviews()} />}
      </aside>
    </section>
  );
}
