import { Search } from 'lucide-react';
import { HISTORY_MEASURES, HISTORY_SORTS, type HistoryGroup, type HistoryMeasure, type HistoryRow, type HistorySort, historyCounts, filterHistory, sortHistory, t, type MessageKey, formatDuration } from '@orquestador/editor';
import { statusLabel, diagramLabel, when, money } from './runFormat';

const GROUPS: HistoryGroup[] = ['all', 'active', 'succeeded', 'failed', 'cancelled'];

/** Lo que filtra y ordena el historial [R35.7][R77.19]. */
export interface HistoryFilterState {
  group: HistoryGroup;
  diagramId: string;
  text: string;
  measure?: HistoryMeasure;
  sort?: HistorySort;
}

/** Historial: tabla de todas las ejecuciones con filtros por estado, diagrama y texto [R35.7]. */
export function HistorySection({
  rows,
  filter,
  setFilter,
  names,
  open,
}: {
  rows: HistoryRow[];
  filter: HistoryFilterState;
  setFilter: (f: HistoryFilterState) => void;
  names: Record<string, string>;
  open: (runId: string) => void;
}) {
  const counts = historyCounts(rows);
  const shown = sortHistory(filterHistory(rows, { group: filter.group, ...(filter.diagramId ? { diagramId: filter.diagramId } : {}), text: filter.text, ...(filter.measure ? { measure: filter.measure } : {}) }), filter.sort);
  return (
    <div className="orq-runs2__page">
      <header className="orq-runs2__head">
        <h1>{t('runs.history.title')}</h1>
        <label className="orq-runs2__search">
          <Search size={14} aria-hidden="true" />
          <input type="search" value={filter.text} aria-label={t('runs.history.search')} placeholder={t('runs.history.search')} onChange={(e) => setFilter({ ...filter, text: e.target.value })} />
        </label>
        <label className="orq-runs2__select">
          {t('runs.history.diagram')}
          <select value={filter.diagramId} onChange={(e) => setFilter({ ...filter, diagramId: e.target.value })}>
            <option value="">{t('runs.history.allDiagrams')}</option>
            {Object.entries(names).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {/* Por coste, duración y reintentos [R77.19]. */}
        <label className="orq-runs2__select">
          {t('runs.history.measure')}
          <select value={filter.measure ?? 'all'} onChange={(e) => setFilter({ ...filter, measure: e.target.value as HistoryMeasure })}>
            {HISTORY_MEASURES.map((m) => (
              <option key={m} value={m}>
                {t(`runs.measure.${m}` as MessageKey)}
              </option>
            ))}
          </select>
        </label>
        <label className="orq-runs2__select">
          {t('runs.history.sort')}
          <select value={filter.sort ?? 'recent'} onChange={(e) => setFilter({ ...filter, sort: e.target.value as HistorySort })}>
            {HISTORY_SORTS.map((s) => (
              <option key={s} value={s}>
                {t(`runs.sort.${s}` as MessageKey)}
              </option>
            ))}
          </select>
        </label>
      </header>
      <div className="orq-runs2__filters" role="tablist" aria-label={t('runs.history.filter')}>
        {GROUPS.map((g) => (
          <button key={g} type="button" role="tab" aria-selected={filter.group === g} className={`is-${g}`} onClick={() => setFilter({ ...filter, group: g })}>
            <span className="orq-runs2__fdot" aria-hidden="true" />
            {t(`runs.group.${g}` as MessageKey)}
            <em>{counts[g]}</em>
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="orq-runs2__empty">{t('runs.history.never')}</p>
      ) : shown.length === 0 ? (
        <p className="orq-runs2__empty">{t('runs.history.none')}</p>
      ) : (
        <div className="orq-runs2__tablebox">
          <table className="orq-runs2__table">
            <thead>
              <tr>
                <th>{t('runs.col.status')}</th>
                <th>{t('runs.col.diagram')}</th>
                <th>{t('runs.col.input')}</th>
                <th>{t('runs.col.start')}</th>
                <th>{t('runs.col.duration')}</th>
                <th className="is-num">{t('runs.col.tokens')}</th>
                <th className="is-num">{t('runs.col.cost')}</th>
                <th className="is-num">{t('runs.col.retries')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.runId} onClick={() => open(r.runId)}>
                  <td>
                    <span className={`orq-runs2__st is-${r.status}`}>
                      <span className={`orq-dot-status is-${r.status}`} aria-hidden="true" />
                      {statusLabel(r.status)}
                    </span>
                  </td>
                  <td>
                    <button type="button" className="orq-runs2__rowbtn" aria-label={t('runs.open.run', { name: `${diagramLabel(r)} · ${when(r.startedAt)}` })} onClick={(e) => (e.stopPropagation(), open(r.runId))}>
                      {diagramLabel(r)}
                    </button>
                  </td>
                  <td className="orq-runs2__ell">{r.input}</td>
                  <td className="orq-mono">{when(r.startedAt)}</td>
                  <td className="orq-mono">{formatDuration(r.durationS)}</td>
                  {r.status === 'interrupted' && r.tokens === 0 ? (
                    // Ejecuciones interrumpidas de antes de guardar el uso al momento: no se sabe cuánto gastaron [R35.15].
                    <td className="orq-hint is-num" colSpan={2}>
                      {t('runs.noUsage')}
                    </td>
                  ) : (
                    <>
                      <td className="orq-mono is-num">{r.tokens.toLocaleString('es-ES')}</td>
                      <td className="orq-mono is-num">{money(r.costUsd)}</td>
                    </>
                  )}
                  <td className="orq-mono is-num">{r.retries}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
