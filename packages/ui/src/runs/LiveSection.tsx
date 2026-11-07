import { Clock3 } from 'lucide-react';
import { type Diagram } from '@orquestador/core';
import { type HistoryRow, type QueuedRunView, type RunSnapshot, type RunAction, t, defaultStep, runTimeline, transcriptItems, formatDuration } from '@orquestador/editor';
import { nodeLabel, diagramLabel, statusLabel, money } from './runFormat';

/** En directo: una tarjeta por ejecución en curso [R35.5]. */
export function LiveSection({ rows, queue = [], onUnqueue, main, diagrams, control, open }: { rows: HistoryRow[]; queue?: QueuedRunView[]; onUnqueue?: (id: string) => void; main: RunSnapshot; diagrams: Record<string, Diagram | null>; control: (runId: string, a: RunAction) => void; open: (runId: string) => void }) {
  return (
    <div className="orq-runs2__page">
      <header className="orq-runs2__head">
        <h1>{t('runs.sec.live')}</h1>
        <span className="orq-hint">{t('runs.sec.live.hint')}</span>
      </header>
      {rows.length === 0 && queue.length === 0 ? (
        <p className="orq-runs2__empty">{t('runs.live.empty')}</p>
      ) : rows.length === 0 ? null : (
        <div className="orq-runs2__cards">
          {rows.map((r) => {
            const followed = r.runId === main.runId;
            const paused = followed && main.live.paused;
            let step: string | undefined;
            let said: string | undefined;
            if (followed) {
              const s = defaultStep(runTimeline(main.events, Date.now()).steps);
              if (s) {
                step = nodeLabel(diagrams[r.diagramId] ?? undefined, s.nodeId, s.nodePath);
                const items = transcriptItems(main.events, s.nodeId, s.nodePath);
                const last = [...items].reverse().find((i) => i.kind === 'text' || i.kind === 'question' || (i.kind === 'output' && i.text));
                said = last && 'text' in last ? last.text : undefined;
              }
            }
            return (
              <article key={r.runId} className="orq-runs2__card" aria-label={diagramLabel(r)}>
                <div className="orq-runs2__cardhead">
                  <h2>{diagramLabel(r)}</h2>
                  <span className="orq-pill is-running">{statusLabel(r.status, paused)}</span>
                </div>
                <p className="orq-runs2__input">{r.input}</p>
                <div className="orq-runs2__now">
                  {step ? (
                    <>
                      <span className="orq-hint">{t('runs.live.now', { step })}</span>
                      {said && <span className="orq-runs2__said">{said.length > 240 ? `…${said.slice(-240)}` : said}</span>}
                    </>
                  ) : (
                    <span className="orq-hint">{t('runs.live.follow')}</span>
                  )}
                </div>
                <div className="orq-runs2__cardfoot">
                  <span className="orq-mono orq-hint">
                    {formatDuration(r.durationS)} · {money(r.costUsd)}
                  </span>
                  <button type="button" className="orq-btn orq-btn--small" onClick={() => control(r.runId, paused ? 'resume' : 'pause')}>
                    {paused ? t('runs.resume') : t('runs.pause')}
                  </button>
                  <button type="button" className="orq-btn orq-btn--small orq-btn--stop" onClick={() => control(r.runId, 'cancel')}>
                    {t('runs.cancel')}
                  </button>
                  <button type="button" className="orq-btn orq-btn--small orq-btn--primary" aria-label={t('runs.open.run', { name: diagramLabel(r) })} onClick={() => open(r.runId)}>
                    {t('runs.open')}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {queue.length > 0 && (
        <section className="orq-runs2__queue" aria-label={t('runs.queue')}>
          <h2>{t('runs.queue')}</h2>
          <ul>
            {queue.map((q) => (
              <li key={q.queuedId}>
                <Clock3 size={14} aria-hidden="true" />
                <span className="orq-runs2__childtext">
                  <strong>{q.diagramName}</strong>
                  <span>{q.order}</span>
                </span>
                <span className="orq-hint">{t('runs.queue.since', { time: new Date(q.at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) })}</span>
                {onUnqueue && (
                  <button type="button" className="orq-btn orq-btn--small" aria-label={t('runs.queue.remove', { name: q.diagramName })} onClick={() => onUnqueue(q.queuedId)}>
                    {t('runs.queue.removeShort')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
