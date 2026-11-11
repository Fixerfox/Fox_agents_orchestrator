import { useState } from 'react';
import { Check, CircleDashed, ExternalLink, GitPullRequest, X } from 'lucide-react';
import { isProtectedBranch, type GitBranchInfo, type ReviewInfo } from '@orquestador/core';
import { t, type GitReviewsView, type ProjectApi } from '@orquestador/editor';

interface Props {
  api: ProjectApi;
  view: GitReviewsView;
  /** Rama actual y las locales, para el destino y para saber si está subida. */
  current: GitBranchInfo | undefined;
  branches: readonly string[];
  /** Título que se propone: el del último commit de la rama. */
  suggestedTitle: string;
  onChanged: () => void;
}

const CHECK_ICON = { passing: Check, failing: X, pending: CircleDashed } as const;

/** La tarjeta de una PR o MR: título, estado, destino, comprobaciones y enlace [R99.11]. */
export function ReviewCard({ review, word }: { review: ReviewInfo; word: string }) {
  const Icon = review.checks ? CHECK_ICON[review.checks.state] : undefined;
  return (
    <div className={`orq-ver__review is-${review.state}`} role="group" aria-label={`${word} #${review.number}`}>
      <div className="orq-ver__reviewhead">
        <GitPullRequest size={15} aria-hidden="true" />
        <strong>
          #{review.number} · {review.title}
        </strong>
        <span className="orq-ver__reviewstate">{t(`ver.rev.state.${review.state}`)}</span>
      </div>
      <p className="orq-hint orq-mono">{t('ver.rev.to', { head: review.head, base: review.base })}</p>
      <div className="orq-ver__reviewfoot">
        {review.checks && Icon && (
          <span className={`orq-ver__checks is-${review.checks.state}`}>
            <Icon size={13} aria-hidden="true" /> {t(`ver.rev.checks.${review.checks.state}`, { passed: review.checks.passed, total: review.checks.total })}
          </span>
        )}
        {review.url && (
          <a href={review.url} target="_blank" rel="noreferrer">
            <ExternalLink size={12} aria-hidden="true" /> {t('ver.rev.link')}
          </a>
        )}
      </div>
    </div>
  );
}

/** Las PR o MR de la rama actual: verlas, abrir una o conectar con el servidor [R99.11]–[R99.13]. */
export function ReviewBlock({ api, view, current, branches, suggestedTitle, onChanged }: Props) {
  const { word } = view;
  const cli = view.provider === 'github' ? 'gh' : 'glab';
  const [token, setToken] = useState('');
  const [form, setForm] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [base, setBase] = useState('');
  const [draft, setDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const run = async (job: () => Promise<{ ok: true } | { ok: false; error: { message: string } }>) => {
    setBusy(true);
    setError(undefined);
    const r = await job();
    setBusy(false);
    if (!r.ok) {
      setError(r.error.message);
      return false;
    }
    onChanged();
    return true;
  };

  if (!view.via)
    return (
      <section className="orq-ver__reviews" aria-label={t('ver.rev.connect', { host: view.host, word })}>
        <h3>{t('ver.rev.connect', { host: view.host, word })}</h3>
        <p className="orq-hint">{t('ver.rev.connect.hint', { cli, host: view.host })}</p>
        <form
          className="orq-ver__token"
          onSubmit={(e) => {
            e.preventDefault();
            if (token.trim() === '') return;
            void run(() => api.setReviewToken({ token: token.trim() })).then((done) => {
              if (done) setToken('');
            });
          }}
        >
          <label className="orq-field">
            <span>{t('ver.rev.token')}</span>
            <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
          </label>
          <button type="submit" className="orq-btn orq-btn--small" disabled={busy || token.trim().length < 8}>
            {t('ver.rev.token.save')}
          </button>
        </form>
        {error && (
          <p className="orq-field__error" role="alert">
            {error}
          </p>
        )}
      </section>
    );

  const mine = view.reviews.filter((r) => r.head === current?.name);
  const open = mine.filter((r) => r.state === 'open' || r.state === 'draft');
  const shown = open.length > 0 ? open : mine.slice(0, 1);
  const bases = branches.filter((b) => b !== current?.name);
  const target = base || (view.base && bases.includes(view.base) ? view.base : (bases[0] ?? ''));
  const cannot = !current ? t('ver.detached') : isProtectedBranch(current.name) ? t('ver.rev.open.protected', { word }) : !current.upstream || current.gone ? t('ver.rev.open.unpushed', { word }) : undefined;
  return (
    <section className="orq-ver__reviews" aria-label={t('ver.rev.title', { word })}>
      <h3>{t('ver.rev.title', { word })}</h3>
      {view.error && (
        <p className="orq-field__error" role="alert">
          {view.error}
        </p>
      )}
      {shown.map((r) => (
        <ReviewCard key={r.number} review={r} word={word} />
      ))}
      {open.length === 0 && !form && (
        <>
          {shown.length === 0 && <p className="orq-hint">{t('ver.rev.none', { word })}</p>}
          <button
            type="button"
            className="orq-btn orq-btn--small"
            disabled={cannot !== undefined || target === ''}
            title={cannot}
            onClick={() => {
              setTitle(suggestedTitle);
              setForm(true);
            }}
          >
            <GitPullRequest size={14} aria-hidden="true" /> {t('ver.rev.open', { word })}
          </button>
        </>
      )}
      {form && current && (
        <form
          className="orq-ver__reviewform"
          aria-label={t('ver.rev.form', { word })}
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim() === '' || target === '') return;
            void run(() => api.gitCreateReview({ title: title.trim(), head: current.name, base: target, ...(body.trim() ? { body: body.trim() } : {}), ...(draft ? { draft: true } : {}) })).then((done) => {
              if (!done) return;
              setForm(false);
              setBody('');
            });
          }}
        >
          <label className="orq-field">
            <span>{t('ver.rev.f.title')}</span>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="orq-field">
            <span>{t('ver.rev.f.body')}</span>
            <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
          </label>
          <label className="orq-field">
            <span>{t('ver.rev.f.base')}</span>
            <select value={target} onChange={(e) => setBase(e.target.value)}>
              {bases.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
          <label className="orq-ver__draft">
            <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} /> {t('ver.rev.f.draft')}
          </label>
          <div className="orq-ver__commitbtns">
            <button type="submit" className="orq-btn orq-btn--small orq-btn--primary" disabled={busy || title.trim() === ''}>
              {t('ver.rev.create', { word })}
            </button>
            <button type="button" className="orq-btn orq-btn--small orq-btn--ghost" onClick={() => setForm(false)}>
              {t('ver.rev.cancel')}
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="orq-field__error" role="alert">
          {error}
        </p>
      )}
      <p className="orq-hint orq-ver__via">
        {t(`ver.rev.via.${view.via}`, { cli })}
        {view.via === 'token' && (
          <button type="button" className="orq-ver__linkbtn" onClick={() => void run(() => api.clearReviewToken())}>
            {t('ver.rev.token.clear')}
          </button>
        )}
      </p>
    </section>
  );
}
