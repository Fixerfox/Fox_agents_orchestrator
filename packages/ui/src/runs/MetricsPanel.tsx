import { Download } from 'lucide-react';
import { runMetrics, type RunEvent } from '@orquestador/core';
import { formatDuration, metricsCsv, t } from '@orquestador/editor';
import { downloadText } from '../common';
import { money } from './runFormat';

const secs = (ms: number) => formatDuration(Math.round(ms / 1000));
const pct = (n: number, of: number) => `${of > 0 ? Math.max(0, Math.min(100, (n / of) * 100)) : 0}%`;

/**
 * «Rendimiento» [R77.18]: un cronograma de los pasos (trabajando, esperando a la persona y en cola), la tabla por
 * agente, que se exporta a CSV, el coste por modelo y lo del Supervisor aparte.
 */
export function MetricsPanel({ events, label, runId, agentName = (id) => id }: { events: readonly RunEvent[]; label: (nodeId: string, path?: readonly string[]) => string; runId: string; agentName?: (agentId: string) => string }) {
  const m = runMetrics(events);
  if (m.steps.length === 0) return <p className="orq-hint">{t('metrics.empty')}</p>;
  const span = Math.max(1, ...m.steps.map((s) => s.endMs));
  return (
    <div className="orq-metrics">
      <p className="orq-hint">
        {t('metrics.totals', { duration: secs(m.durationMs), work: secs(m.total.workMs), wait: secs(m.total.waitMs), queue: secs(m.total.queueMs), retries: m.total.retries })}
      </p>
      <section aria-label={t('metrics.timeline')}>
        <h3>{t('metrics.timeline')}</h3>
        <ul className="orq-metrics__gantt">
          {m.steps.map((s) => {
            const total = Math.max(1, s.endMs - s.startMs);
            return (
              <li key={s.key} aria-label={label(s.nodeId, s.path)}>
                <span className="orq-metrics__name">{label(s.nodeId, s.path)}</span>
                <span className="orq-metrics__track">
                  <span className="orq-metrics__bar" style={{ marginLeft: pct(s.startMs, span), width: pct(total, span) }} title={t('metrics.bar', { work: secs(s.workMs), wait: secs(s.waitMs), queue: secs(s.queueMs) })}>
                    <span className="is-work" style={{ width: pct(s.workMs, total) }} />
                    <span className="is-wait" style={{ width: pct(s.waitMs, total) }} />
                    <span className="is-queue" style={{ width: pct(s.queueMs, total) }} />
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
        <p className="orq-metrics__legend orq-hint">
          <span className="is-work">{t('metrics.work')}</span> <span className="is-wait">{t('metrics.wait')}</span> <span className="is-queue">{t('metrics.queue')}</span>
        </p>
      </section>
      <section aria-label={t('metrics.byAgent')}>
        <h3>{t('metrics.byAgent')}</h3>
        <table className="orq-runs2__table">
          <thead>
            <tr>
              <th>{t('metrics.col.agent')}</th>
              <th className="is-num">{t('metrics.col.steps')}</th>
              <th className="is-num">{t('metrics.col.retries')}</th>
              <th className="is-num">{t('metrics.work')}</th>
              <th className="is-num">{t('metrics.wait')}</th>
              <th className="is-num">{t('runs.col.tokens')}</th>
              <th className="is-num">{t('runs.col.cost')}</th>
            </tr>
          </thead>
          <tbody>
            {m.byAgent.map((a) => (
              <tr key={a.agentId}>
                <td>{agentName(a.agentId)}</td>
                <td className="orq-mono is-num">{a.steps}</td>
                <td className="orq-mono is-num">{a.retries}</td>
                <td className="orq-mono is-num">{secs(a.workMs)}</td>
                <td className="orq-mono is-num">{secs(a.waitMs)}</td>
                <td className="orq-mono is-num">{a.tokens.toLocaleString('es-ES')}</td>
                <td className="orq-mono is-num">{money(a.costUsd)}</td>
              </tr>
            ))}
            <tr>
              <td>{t('metrics.supervisor')}</td>
              <td colSpan={4} />
              <td className="orq-mono is-num">{m.supervisor.tokens.toLocaleString('es-ES')}</td>
              <td className="orq-mono is-num">{money(m.supervisor.costUsd)}</td>
            </tr>
          </tbody>
        </table>
        <button type="button" className="orq-btn orq-btn--small" onClick={() => downloadText(`${runId}-rendimiento.csv`, metricsCsv(m, agentName), 'text/csv')}>
          <Download size={13} aria-hidden="true" />
          {t('metrics.csv')}
        </button>
      </section>
      {m.byModel.length > 0 && (
        <section aria-label={t('metrics.byModel')}>
          <h3>{t('metrics.byModel')}</h3>
          <ul className="orq-metrics__models">
            {m.byModel.map((x) => (
              <li key={x.model}>
                <span className="orq-mono">{x.model}</span> · {x.tokens.toLocaleString('es-ES')} tokens · {money(x.costUsd)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
