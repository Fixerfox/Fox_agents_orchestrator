import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, History, Layers, Loader2, MessageCircleQuestion, Pencil, Play, Search, Workflow, Wrench } from 'lucide-react';
import { agoText, filterJobs, jobRows, jobsBanner, t, type JobInfo, type JobRow, type MessageKey, type ProjectApi } from '@orquestador/editor';
import type { RunsIndex } from './useRunsIndex';

/** A qué apartado de Ejecuciones lleva cada pieza de la banda [R52.6]. */
export type BannerTarget = 'live' | 'inbox' | 'history';

interface Props {
  api: ProjectApi;
  index: RunsIndex;
  /** Cambia cuando cambian los diagramas (guardar, crear, borrar), para volver a leerlos. */
  version: unknown;
  onLaunch: (diagramId: string) => void;
  onHistory: (diagramId: string) => void;
  onEdit: (diagramId: string) => void;
  onNew: () => void;
  onOpenRuns: (to: BannerTarget) => void;
  now?: () => number;
}

const STATUS: Record<NonNullable<JobRow['last']>['status'], MessageKey> = {
  running: 'jobs.status.running',
  succeeded: 'jobs.status.succeeded',
  failed: 'jobs.status.failed',
  cancelled: 'jobs.status.cancelled',
  interrupted: 'jobs.status.interrupted',
};

/** Trabajos: banda de estado y una tarjeta por diagrama para lanzarlo (prototipo A) [R52.6]. */
export function JobsScreen({ api, index, version, onLaunch, onHistory, onEdit, onNew, onOpenRuns, now = Date.now }: Props) {
  const [jobs, setJobs] = useState<JobInfo[]>();
  const [text, setText] = useState('');
  useEffect(() => {
    let alive = true;
    void api.listJobs().then((r) => alive && setJobs(r.ok ? r.value : []));
    return () => {
      alive = false;
    };
  }, [api, version, index.runs.length]);
  const waiting = useMemo(() => new Set(index.pending.map((p) => p.runId)), [index.pending]);
  const all = useMemo(() => jobRows(jobs ?? [], index.runs, index.queue, waiting, now()), [jobs, index.runs, index.queue, waiting, now]);
  const rows = useMemo(() => filterJobs(all, text), [all, text]);
  const banner = useMemo(() => jobsBanner(index.runs, waiting, index.queue, now()), [index.runs, waiting, index.queue, now]);
  const runnable = rows.filter((r) => r.runnable);
  const broken = rows.filter((r) => !r.runnable);

  return (
    <section className="orq-page orq-jobs" aria-label={t('jobs.title')}>
      <header className="orq-jobs__head">
        <div>
          <h1>{t('jobs.title')}</h1>
          <p className="orq-hint">{t('jobs.intro')}</p>
        </div>
        <label className="orq-jobs__search">
          <Search size={15} aria-hidden="true" />
          <input type="search" aria-label={t('jobs.search')} placeholder={t('jobs.search')} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
      </header>

      <nav className="orq-jobs__banner" aria-label={t('jobs.banner')}>
        <Tile tone="running" icon={<Loader2 size={18} className={banner.running > 0 ? 'orq-spin' : undefined} aria-hidden="true" />} n={banner.running} label={t('jobs.banner.running')} onClick={() => onOpenRuns('live')} />
        <Tile tone="needs" icon={<MessageCircleQuestion size={18} aria-hidden="true" />} n={banner.needs} label={t('jobs.banner.needs')} onClick={() => onOpenRuns('inbox')} />
        <Tile tone="queued" icon={<Clock3 size={18} aria-hidden="true" />} n={banner.queued} label={t('jobs.banner.queued')} onClick={() => onOpenRuns('live')} />
        <Tile
          tone="finished"
          icon={<CheckCircle2 size={18} aria-hidden="true" />}
          n={banner.finished}
          label={t('jobs.banner.finished')}
          {...(banner.failed > 0 ? { note: banner.failed === 1 ? t('jobs.banner.failed.one') : t('jobs.banner.failed.many', { n: banner.failed }) } : {})}
          onClick={() => onOpenRuns('history')}
        />
      </nav>

      {jobs !== undefined && jobs.length === 0 ? (
        <div className="orq-jobs__empty">
          <p>{t('jobs.empty')}</p>
          <button type="button" className="orq-btn orq-btn--primary" onClick={onNew}>
            {t('jobs.empty.go')}
          </button>
        </div>
      ) : jobs !== undefined && rows.length === 0 ? (
        <p className="orq-hint">{t('jobs.none', { text: text.trim() })}</p>
      ) : (
        <ul className="orq-jobs__grid" aria-label={t('jobs.list')}>
          {runnable.map((r) => (
            <JobCard key={r.id} row={r} onLaunch={() => onLaunch(r.id)} onHistory={() => onHistory(r.id)} onEdit={() => onEdit(r.id)} />
          ))}
          {broken.map((r) => (
            <JobCard key={r.id} row={r} onLaunch={() => onLaunch(r.id)} onHistory={() => onHistory(r.id)} onEdit={() => onEdit(r.id)} />
          ))}
        </ul>
      )}
      <p className="orq-hint orq-jobs__foot">{t('jobs.foot')}</p>
    </section>
  );
}

function Tile({ tone, icon, n, label, note, onClick }: { tone: string; icon: ReactNode; n: number; label: string; note?: string; onClick: () => void }) {
  return (
    <button type="button" className={`orq-jobs__tile is-${tone}${n > 0 ? ' is-on' : ''}`} aria-label={`${label}: ${n}${note ? ` (${note})` : ''}`} onClick={onClick}>
      <span className="orq-jobs__tileicon">{icon}</span>
      <span className="orq-jobs__tiletext">
        <strong>{n}</strong>
        <span>{label}</span>
      </span>
      {note && <em className="orq-jobs__tilenote">{note}</em>}
    </button>
  );
}

function JobCard({ row, onLaunch, onHistory, onEdit }: { row: JobRow; onLaunch: () => void; onHistory: () => void; onEdit: () => void }) {
  const steps = row.steps === 1 ? t('jobs.steps.one') : t('jobs.steps.many', { n: row.steps });
  const last = row.last ? t('jobs.last', { status: t(STATUS[row.last.status]), ago: agoText(row.last.agoS) }) : t('jobs.never');
  const total = row.total === 1 ? t('jobs.total.one') : t('jobs.total.many', { n: row.total });
  const busy = row.running + row.queued > 0;
  return (
    <li className={`orq-job${busy ? ' is-busy' : ''}${row.runnable ? '' : ' is-broken'}`} aria-label={row.name}>
      <div className="orq-job__top">
        <span className="orq-job__icon" aria-hidden="true">
          <Workflow size={16} strokeWidth={1.8} />
        </span>
        <h2>{row.name}</h2>
        <div className="orq-job__marks">
          {row.running > 0 && (
            <span className="orq-job__mark is-running">
              <span className="orq-dot is-running" aria-hidden="true" />
              {t('jobs.running', { n: row.running })}
            </span>
          )}
          {row.waiting > 0 && (
            <span className="orq-job__mark is-waiting">
              <MessageCircleQuestion size={13} aria-hidden="true" />
              {row.waiting === 1 ? t('jobs.waiting.one') : t('jobs.waiting.many', { n: row.waiting })}
            </span>
          )}
          {row.queued > 0 && (
            <span className="orq-job__mark">
              <Clock3 size={13} aria-hidden="true" />
              {t('jobs.queued', { n: row.queued })}
            </span>
          )}
        </div>
      </div>
      <p className="orq-job__meta">
        <span>
          <Layers size={13} aria-hidden="true" />
          {steps}
        </span>
        <span>
          <History size={13} aria-hidden="true" />
          {last}
        </span>
        {row.total > 0 && <span>{total}</span>}
      </p>
      {!row.runnable && (
        <p className="orq-job__problems">
          <AlertTriangle size={14} aria-hidden="true" />
          {row.problems === 1 ? t('jobs.problems.one') : t('jobs.problems.many', { n: row.problems })}
        </p>
      )}
      <div className="orq-job__actions">
        {row.runnable ? (
          <button type="button" className="orq-btn orq-btn--primary orq-btn--small" aria-label={t('jobs.launchName', { name: row.name })} onClick={onLaunch}>
            <Play size={13} strokeWidth={2} aria-hidden="true" />
            {t('jobs.launch')}
          </button>
        ) : (
          <button type="button" className="orq-btn orq-btn--small" onClick={onEdit}>
            <Wrench size={13} aria-hidden="true" />
            {t('jobs.fix')}
          </button>
        )}
        {row.total > 0 && (
          <button type="button" className="orq-btn orq-btn--small" onClick={onHistory}>
            <History size={13} aria-hidden="true" />
            {t('jobs.history')}
          </button>
        )}
        {row.runnable && (
          <button type="button" className="orq-btn orq-btn--small orq-btn--ghost" onClick={onEdit}>
            <Pencil size={13} aria-hidden="true" />
            {t('jobs.edit')}
          </button>
        )}
      </div>
    </li>
  );
}
