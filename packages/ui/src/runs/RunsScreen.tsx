import { useMemo, useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { historyRows, type HistoryGroup, type RunAction, t, type HistoryRow } from '@orquestador/editor';
import type { InboxItem } from './useRunsIndex';
import { type RunsSection, type RunsScreenProps, type RunsNav } from './runsTypes';
import { useNow, useDiagrams } from './useRunData';
import { SECTIONS, crumbSection, diagramLabel } from './runFormat';
import { RunDetail } from './RunDetail';
import { LiveSection } from './LiveSection';
import { InboxSection } from './InboxSection';
import { HistorySection } from './HistorySection';

/** Ejecuciones: submenú con En directo, Necesitan tu respuesta e Historial, y la vista de una ejecución [R35.4–R35.12]. */
export function RunsScreen(p: RunsScreenProps) {
  const now = p.now ?? Date.now;
  const tickNow = useNow(p.index.runs.some((r) => r.status === 'running'), now);
  const rows = useMemo(() => historyRows(p.index.runs, p.index.diagramNames, tickNow), [p.index.runs, p.index.diagramNames, tickNow]);
  const active = rows.filter((r) => r.status === 'running');
  const [filter, setFilter] = useState<{ group: HistoryGroup; diagramId: string; text: string }>({ group: 'all', diagramId: '', text: '' });
  // «Ver ejecuciones» desde Trabajos abre el historial de ese diagrama [R52.6].
  useEffect(() => {
    if (p.nav.section === 'history' && p.nav.diagramId) setFilter({ group: 'all', diagramId: p.nav.diagramId, text: '' });
  }, [p.nav.section, p.nav.diagramId]);
  const queue = p.index.queue ?? [];
  const counts: Record<RunsSection, number> = { live: active.length + queue.length, inbox: p.index.pending.length, history: rows.length };
  const unqueue = (id: string) => void p.api.unqueue(id).then(() => p.index.refresh());
  const open = (runId: string) => p.onNav({ section: p.nav.section, runId });
  const answer = (item: InboxItem, text: string) => {
    if (item.runId === p.main.runId) p.onAnswerMain(item.questionId, text);
    else void p.api.answerRun({ runId: item.runId, questionId: item.questionId, text }).then(() => p.index.refresh());
  };
  const control = (runId: string, action: RunAction) => {
    if (runId === p.main.runId) p.onControlMain(action);
    else void p.api.controlRun({ runId, action }).then(() => p.index.refresh());
  };
  const diagrams = useDiagrams(p.api, active.map((r) => r.diagramId));
  const openRow = p.nav.runId ? rows.find((r) => r.runId === p.nav.runId) : undefined;

  return (
    <section className="orq-page orq-runs2" aria-label={t('runs.title')}>
      {p.subOpen ? (
        <nav className="orq-runs2__sub" aria-label={t('runs.sub')}>
          <div className="orq-runs2__subhead">
            <span>{t('runs.title')}</span>
            <button type="button" className="orq-iconbtn" aria-label={t('runs.sub.hide')} title={t('runs.sub.hide')} onClick={p.onToggleSub}>
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
          </div>
          {SECTIONS.map((s) => {
            const on = p.nav.section === s.id && !(p.nav.runId && s.id === 'live' && active.some((r) => r.runId === p.nav.runId));
            return (
              <div key={s.id}>
                <button
                  type="button"
                  className={`orq-runs2__item${on ? ' is-on' : ''}`}
                  aria-current={on ? 'page' : undefined}
                  onClick={() => p.onNav({ section: s.id })}
                >
                  <s.icon size={15} aria-hidden="true" />
                  <span>{t(s.label)}</span>
                  <em className={s.id === 'inbox' && counts.inbox > 0 ? 'is-hot' : undefined}>{counts[s.id]}</em>
                </button>
                {s.id === 'live' &&
                  active.map((r) => (
                    <button
                      key={r.runId}
                      type="button"
                      className={`orq-runs2__child${p.nav.runId === r.runId ? ' is-on' : ''}`}
                      aria-current={p.nav.runId === r.runId ? 'page' : undefined}
                      aria-label={t('runs.open.run', { name: diagramLabel(r) })}
                      onClick={() => p.onNav({ section: 'live', runId: r.runId })}
                    >
                      <span className="orq-dot-status is-running" aria-hidden="true" />
                      <span className="orq-runs2__childtext">
                        <strong>{diagramLabel(r)}</strong>
                        <span>{r.input}</span>
                      </span>
                    </button>
                  ))}
              </div>
            );
          })}
        </nav>
      ) : (
        <div className="orq-runs2__subclosed">
          <button type="button" className="orq-iconbtn" aria-label={t('runs.sub.show')} title={t('runs.sub.show')} onClick={p.onToggleSub}>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      )}
      <div className="orq-runs2__main">
        <Crumbs nav={p.nav} row={openRow} onNav={p.onNav} />
        {p.nav.runId ? (
          <RunDetail key={p.nav.runId} {...p} runId={p.nav.runId} row={openRow} now={now} control={control} answer={answer} />
        ) : p.nav.section === 'live' ? (
          <LiveSection rows={active} queue={queue} onUnqueue={unqueue} main={p.main} diagrams={diagrams} control={control} open={open} />
        ) : p.nav.section === 'inbox' ? (
          <InboxSection items={p.index.pending} rows={rows} answer={answer} open={open} diagrams={diagrams} />
        ) : (
          <HistorySection rows={rows} filter={filter} setFilter={setFilter} names={p.index.diagramNames} open={open} />
        )}
      </div>
    </section>
  );
}

function Crumbs({ nav, row, onNav }: { nav: RunsNav; row: HistoryRow | undefined; onNav: RunsScreenProps['onNav'] }) {
  const section = crumbSection(nav, row);
  const sec = SECTIONS.find((s) => s.id === section)!;
  return (
    <nav className="orq-runs2__crumbs" aria-label={t('runs.crumbs')}>
      <button type="button" onClick={() => onNav({ section: 'history' })}>
        {t('runs.title')}
      </button>
      <span aria-hidden="true">/</span>
      <button type="button" aria-current={nav.runId ? undefined : 'page'} onClick={() => onNav({ section })}>
        {t(sec.label)}
      </button>
      {nav.runId && (
        <>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{diagramLabel(row)}</span>
        </>
      )}
    </nav>
  );
}
