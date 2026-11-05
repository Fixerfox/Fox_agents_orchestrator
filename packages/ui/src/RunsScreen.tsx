import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Clock3, History, CheckCircle2, CircleDashed, Copy, RotateCcw, Loader2, MessageCircleQuestion, Pause, Play, Radio, Search, Square, X, XCircle } from 'lucide-react';
import { ReactFlowProvider } from '@xyflow/react';
import { canResume, correctionTargets, pathKey, type Diagram, type ReviewQuestion, type RunEvent } from '@orquestador/core';
import { CorrectionDialog } from './CorrectionDialog';
import { PreviewDialog, PreviewThumb } from './Preview';
import {
  defaultStep,
  EditorSession,
  filesByStep,
  filterHistory,
  formatDuration,
  historyCounts,
  historyRows,
  RunClient,
  runTimeline,
  settleLive,
  t,
  transcriptItems,
  type HistoryGroup,
  type HistoryRow,
  type LiveView,
  type MessageKey,
  type ProjectApi,
  type RunAction,
  type RunSnapshot,
  summarizeRun,
  type RunSummaryView,
  type QueuedRunView,
} from '@orquestador/editor';
import { Canvas } from './Canvas';
import { LogViewer } from './LogViewer';
import { NodePanel } from './NodePanel';
import { ResultsPanel } from './ResultsPanel';
import type { InboxItem, RunsIndex } from './useRunsIndex';
import { Markdown } from './Markdown';
import { FileViewer, ProjectChanges } from './RunFiles';
import { AuditPanel } from './AuditPanel';
import { Gantt, RunStory } from './Timeline';

export { ProjectChanges } from './RunFiles';
import { RunDoneBanner } from './RunDoneBanner';

export type RunsSection = 'live' | 'inbox' | 'history';
/** Dónde está el usuario dentro de Ejecuciones: un apartado o una ejecución abierta desde él [R35.4][R35.8]. */
export interface RunsNav {
  section: RunsSection;
  runId?: string;
  /** Historial filtrado por un diagrama, desde Trabajos [R52.6]. */
  diagramId?: string;
  /** Paso que se abre en el lateral, desde el modal [R44.2]. */
  step?: string;
}

interface Props {
  api: ProjectApi;
  /** Ejecución que se sigue en vivo (la que se lanzó con «Ejecutar»). */
  main: RunSnapshot;
  index: RunsIndex;
  nav: RunsNav;
  onNav: (nav: RunsNav) => void;
  subOpen: boolean;
  onToggleSub: () => void;
  onControlMain: (action: RunAction) => void;
  onAnswerMain: (questionId: string, text: string) => void;
  agentNames: Readonly<Record<string, string>>;
  onExport: (runId: string, jsonl: string) => void;
  /** Reloj inyectable para los tests. */
  now?: () => number;
}

const SECTIONS: { id: RunsSection; label: MessageKey; icon: typeof Radio }[] = [
  { id: 'live', label: 'runs.sec.live', icon: Radio },
  { id: 'inbox', label: 'runs.sec.inbox', icon: MessageCircleQuestion },
  { id: 'history', label: 'runs.sec.history', icon: History },
];
const GROUPS: HistoryGroup[] = ['all', 'active', 'succeeded', 'failed', 'cancelled'];

const statusLabel = (status: string, paused = false) =>
  paused && status === 'running' ? t('run.status.paused') : t(`run.status.${status}` as MessageKey);
const money = (usd: number) => `${usd.toFixed(3).replace('.', ',')} $`;
const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};
const diagramLabel = (row: Pick<HistoryRow, 'diagramName'> | undefined) => row?.diagramName ?? t('runs.deleted');

/** Nombre visible de un nodo del diagrama de una ejecución (entra en los bucles por su ruta). */
export function nodeLabel(diagram: Diagram | undefined, nodeId: string, nodePath: readonly string[] = []): string {
  if (!diagram) return nodeId;
  let level: Pick<Diagram, 'nodes'> = diagram;
  for (const id of nodePath) {
    const n = level.nodes.find((x) => x.id === id);
    if (!n?.loop) break;
    level = n.loop.body;
  }
  return level.nodes.find((n) => n.id === nodeId)?.label ?? nodeId;
}

/** Reloj que avanza cada segundo mientras algo sigue en marcha (barras abiertas del cronograma). */
function useNow(active: boolean, now: () => number): number {
  const [value, setValue] = useState(now);
  useEffect(() => {
    setValue(now());
    if (!active) return;
    const id = setInterval(() => setValue(now()), 1000);
    return () => clearInterval(id);
  }, [active, now]);
  return value;
}

/** Diagramas de las ejecuciones, cargados bajo demanda; `null` si ya no existe. */
function useDiagrams(api: ProjectApi, ids: readonly string[]): Record<string, Diagram | null> {
  const [cache, setCache] = useState<Record<string, Diagram | null>>({});
  const key = [...new Set(ids)].sort().join('|');
  useEffect(() => {
    let alive = true;
    for (const id of key ? key.split('|') : []) {
      if (id in cache) continue;
      void api.loadDiagram(id).then((r) => alive && setCache((c) => ({ ...c, [id]: r.ok ? r.value : null })));
    }
    return () => {
      alive = false;
    };
  }, [api, key]);
  return cache;
}

/** Ejecuciones: submenú con En directo, Necesitan tu respuesta e Historial, y la vista de una ejecución [R35.4–R35.12]. */
export function RunsScreen(p: Props) {
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

function Crumbs({ nav, row, onNav }: { nav: RunsNav; row: HistoryRow | undefined; onNav: Props['onNav'] }) {
  const sec = SECTIONS.find((s) => s.id === nav.section)!;
  return (
    <nav className="orq-runs2__crumbs" aria-label={t('runs.crumbs')}>
      <button type="button" onClick={() => onNav({ section: 'history' })}>
        {t('runs.title')}
      </button>
      <span aria-hidden="true">/</span>
      <button type="button" aria-current={nav.runId ? undefined : 'page'} onClick={() => onNav({ section: nav.section })}>
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

/** En directo: una tarjeta por ejecución en curso [R35.5]. */
function LiveSection({ rows, queue = [], onUnqueue, main, diagrams, control, open }: { rows: HistoryRow[]; queue?: QueuedRunView[]; onUnqueue?: (id: string) => void; main: RunSnapshot; diagrams: Record<string, Diagram | null>; control: (runId: string, a: RunAction) => void; open: (runId: string) => void }) {
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

/** Necesitan tu respuesta: preguntas pendientes de todas las ejecuciones en curso [R35.6]. */
function InboxSection({ items, rows, answer, open, diagrams }: { items: InboxItem[]; rows: HistoryRow[]; answer: (i: InboxItem, text: string) => void; open: (runId: string) => void; diagrams: Record<string, Diagram | null> }) {
  return (
    <div className="orq-runs2__page orq-runs2__page--narrow">
      <header className="orq-runs2__head">
        <h1>{t('runs.sec.inbox')}</h1>
        <span className="orq-hint">{t('runs.sec.inbox.hint')}</span>
      </header>
      {items.length === 0 ? (
        <p className="orq-runs2__empty">{t('runs.inbox.empty')}</p>
      ) : (
        items.map((q) => {
          const row = rows.find((r) => r.runId === q.runId);
          const from = nodeLabel(row ? (diagrams[row.diagramId] ?? undefined) : undefined, q.nodeId, q.nodePath);
          return (
            <QuestionCard key={`${q.runId}:${q.questionId}`} item={q} from={from} context={t('runs.inbox.in', { diagram: diagramLabel(row) })} onAnswer={(text) => answer(q, text)}>
              <button type="button" className="orq-btn orq-btn--small" onClick={() => open(q.runId)}>
                {t('runs.inbox.openRun')}
              </button>
            </QuestionCard>
          );
        })
      )}
    </div>
  );
}

export function QuestionCard({ item, from, context, onAnswer, children }: { item: { text: string; options?: string[]; confirm?: { round: number }; review?: ReviewQuestion }; from: string; context?: string; onAnswer: (text: string) => void; children?: ReactNode }) {
  const [text, setText] = useState('');
  // Una confirmación dice qué se confirma y su resumen va en Markdown [R43.8]; una revisión humana, qué se revisa [R53.15].
  const title = item.review
    ? t(item.review.phase === 'route' ? 'hreview.inbox.route' : 'hreview.inbox', { node: from })
    : item.confirm
      ? t('confirm.inbox', { node: from })
      : t('runs.inbox.from', { node: from });
  const confirmLike = item.confirm !== undefined || item.review !== undefined;
  return (
    <article className={`orq-inbox__item${confirmLike ? ' is-confirm' : ''}`} aria-label={title}>
      <div className="orq-inbox__top">
        <strong>{title}</strong>
        {context && <span className="orq-hint">{context}</span>}
        <span className="orq-grow" />
        {children}
      </div>
      {/* El texto lleva su propio scroll: una pregunta larga (un comando entero) no empuja fuera los botones ni la respuesta. */}
      <div className="orq-inbox__text" tabIndex={0} aria-label={t('runs.inbox.text')}>
        <Markdown text={item.text} className={confirmLike ? 'orq-confirm__doc' : undefined} />
      </div>
      {item.options && item.options.length > 0 && (
        <div className="orq-inbox__opts">
          {item.options.map((o, i) => (
            <button key={o} type="button" className={`orq-btn orq-btn--small${i === 0 ? ' orq-btn--primary' : ''}`} onClick={() => onAnswer(o)}>
              {o}
            </button>
          ))}
        </div>
      )}
      <form
        className="orq-inbox__reply"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim() === '') return;
          onAnswer(text.trim());
          setText('');
        }}
      >
        <input value={text} aria-label={t('runs.inbox.other')} placeholder={t('runs.inbox.other')} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="orq-btn orq-btn--small" disabled={text.trim() === ''}>
          {t('chat.send')}
        </button>
      </form>
    </article>
  );
}

/** Historial: tabla de todas las ejecuciones con filtros por estado, diagrama y texto [R35.7]. */
function HistorySection({
  rows,
  filter,
  setFilter,
  names,
  open,
}: {
  rows: HistoryRow[];
  filter: { group: HistoryGroup; diagramId: string; text: string };
  setFilter: (f: { group: HistoryGroup; diagramId: string; text: string }) => void;
  names: Record<string, string>;
  open: (runId: string) => void;
}) {
  const counts = historyCounts(rows);
  const shown = filterHistory(rows, { group: filter.group, ...(filter.diagramId ? { diagramId: filter.diagramId } : {}), text: filter.text });
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type Btab = 'summary' | 'gantt' | 'log' | 'result' | 'files' | 'audit';
const BTABS: Btab[] = ['summary', 'gantt', 'log', 'result', 'files', 'audit'];

/**
 * Todo lo que se ve de una ejecución, a partir de sus eventos: lo comparten la vista de la ejecución y su modal
 * [R35.8][R44.1]. `ready` es falso mientras se carga.
 */
export function useRunData(api: ProjectApi, runId: string, main: RunSnapshot, row: HistoryRow | undefined, listLoaded: boolean, now: () => number) {
  const isMain = runId === main.runId;
  // Un cliente propio para ejecuciones que no son la que se sigue en vivo: así no se deja de seguir aquella [R35.12].
  const [viewSnap, setViewSnap] = useState<RunSnapshot | undefined>(undefined);
  useEffect(() => {
    if (isMain) return;
    const viewer = new RunClient(api);
    const off = viewer.subscribe(() => setViewSnap(viewer.getSnapshot()));
    void viewer.attach(runId);
    return () => {
      off();
      void viewer.detach();
      viewer.dispose();
    };
  }, [api, runId, isMain]);
  const snap = isMain ? main : viewSnap;
  const events = snap?.events ?? [];
  const rawLive = snap?.live;
  // Si sigue en marcha lo decide quien la ejecuta (la que se sigue en vivo o la lista), nunca solo sus eventos [R35.13].
  const running = isMain ? rawLive?.status === 'running' : row?.status === 'running';
  const finishedEv = events.find((e): e is Extract<RunEvent, { type: 'run.finished' }> => e.type === 'run.finished');
  // Con eventos pero sin `run.finished` y sin nadie que la ejecute: se interrumpió [R35.13].
  const interrupted = !running && events.length > 0 && !finishedEv;
  const live = useMemo(() => (rawLive && !running ? settleLive(rawLive) : rawLive), [rawLive, running]);
  const nowValue = useNow(running, now);
  const started = events.find((e): e is Extract<RunEvent, { type: 'run.started' }> => e.type === 'run.started');
  const diagramId = row?.diagramId ?? started?.diagramId;
  const { diagram, old } = useRunDiagram(api, runId, diagramId);
  // Las marcas de retorno nombran la revisión como se ve en el diagrama [R35.17].
  const timeline = useMemo(
    () => runTimeline(events, nowValue, { settled: !running, label: (id, path) => nodeLabel(diagram ?? undefined, id, path) }),
    [events, nowValue, running, diagram],
  );
  const label = (nodeId: string, nodePath: readonly string[] = []) => nodeLabel(diagram ?? undefined, nodeId, nodePath);
  // Sin la lista no se sabe si una ejecución ajena sigue en marcha: se espera antes de afirmar nada [R35.13].
  const ready = !!snap && !!live && events.length > 0 && (isMain || listLoaded);
  const measured = events.some((e) => e.type === 'agent.usage');
  const tokens = live ? live.usage.inputTokens + live.usage.outputTokens : 0;
  const usageText = !measured && !running ? t('runs.noUsage') : `${tokens.toLocaleString('es-ES')} tokens · ${money(live?.usage.costUsd ?? 0)}`;
  const input = row?.input || (events.find((e) => e.type === 'node.started' && e.nodeId === 'entry' && !e.nodePath) as { input?: { text?: string } } | undefined)?.input?.text || '';
  const startTs = events[0]?.ts;
  const endTs = finishedEv?.ts ?? (running ? undefined : events[events.length - 1]?.ts);
  const duration = startTs ? Math.max(0, ((endTs ? Date.parse(endTs) : nowValue) - Date.parse(startTs)) / 1000) : 0;
  const status = interrupted ? 'interrupted' : running ? 'running' : (finishedEv?.status ?? live?.status ?? 'running');
  const reason = finishedEv?.reason ?? row?.reason;
  const title = diagram?.name ?? diagramLabel(row);
  return { snap, events, live, running, diagram, old, timeline, label, ready, measured, tokens, usageText, input, duration, status, reason, title };
}
export type RunData = ReturnType<typeof useRunData>;

/** Contenido de cada pestaña de una ejecución: el mismo abajo en la vista y en el modal [R35.10][R44.1]. */
function RunTabBody({ tab, data: d, api, runId, selected, onPick, onExport, wide = false, onOpenFile, onOpenDeliverable, openPath }: { tab: Btab; data: RunData; api: ProjectApi; runId: string; selected?: string | undefined; onPick: (key: string) => void; onExport: (runId: string, jsonl: string) => void; wide?: boolean; onOpenFile: (path: string) => void; onOpenDeliverable?: (path: string) => void; openPath?: string | undefined }) {
  if (!d.live) return null;
  if (tab === 'summary') {
    const summary = summarizeRun(d.events, d.label, 600, Date.now(), d.status === 'interrupted');
    return <SummaryBody summary={summary} onPick={onPick} wide={wide} {...(onOpenDeliverable ? { onOpenDeliverable } : {})} />;
  }
  if (tab === 'gantt')
    return (
      <>
        <Gantt timeline={d.timeline} selected={selected} label={d.label} onPick={onPick} />
        <RunStory events={d.events} label={d.label} onPick={onPick} />
      </>
    );
  if (tab === 'audit') {
    const fin = d.events.find((e): e is Extract<RunEvent, { type: 'node.finished' }> => e.type === 'node.finished' && e.nodeId === 'output' && !e.nodePath?.length);
    return (
      <AuditPanel
        runId={runId}
        events={d.events}
        labelOf={d.label}
        info={{ diagramName: d.title, status: d.status, durationS: d.duration, ...(d.events[0] ? { startedAt: d.events[0].ts } : {}), ...(d.measured ? { usage: { tokens: d.tokens, costUsd: d.live.usage.costUsd } } : {}), ...(d.reason ? { reason: d.reason } : {}), ...(fin?.output?.text ? { finalOutput: fin.output.text } : {}) }}
      />
    );
  }
  if (tab === 'log') return <LogViewer events={[...d.events]} onExport={(jsonl) => onExport(runId, jsonl)} />;
  if (tab === 'result') return <Result api={api} runId={runId} live={d.live} running={d.running} label={d.label} duration={d.duration} usage={d.measured || d.running ? { tokens: d.tokens, costUsd: d.live.usage.costUsd } : undefined} openPath={openPath} />;
  return <ProjectChanges api={api} runId={runId} finished={!d.running} events={d.events} labelOf={d.label} onOpen={onOpenFile} />;
}

/** Vista de una ejecución: cabecera, avisos, lienzo, mensajes del paso y pestañas inferiores [R35.8–R35.10]. */
function RunDetail(
  p: Props & {
    runId: string;
    row: HistoryRow | undefined;
    now: () => number;
    control: (runId: string, a: RunAction) => void;
    answer: (i: InboxItem, text: string) => void;
  },
) {
  const d = useRunData(p.api, p.runId, p.main, p.row, p.index.loaded, p.now);
  const [picked, setPicked] = useState<string | undefined>(p.nav.step);
  /** Modal de la ejecución y la pestaña con la que se abre: «Resumen» si ya terminó y «Cronograma» mientras corre [R44.5]. */
  const [modal, setModal] = useState<Btab>();
  /** Fichero abierto en el visor [R45.10]. */
  const [viewing, setViewing] = useState<string>();
  /** Ventana «Pedir corrección», con el paso desde el que se abrió [R53.13]. */
  const [fix, setFix] = useState<{ prefer?: string }>();
  /** Vista previa en grande de un archivo de un paso [R54.5]. */
  const [previewing, setPreviewing] = useState<{ key: string; path: string }>();
  const openPreview = useCallback((key: string, path: string) => setPreviewing({ key, path }), []);
  const previewCard = useCallback((key: string, path: string) => <PreviewThumb api={p.api} runId={p.runId} stepKey={key} path={path} />, [p.api, p.runId]);
  const step = d.timeline.steps.find((s) => s.key === picked) ?? defaultStep(d.timeline.steps);
  const back = SECTIONS.find((s) => s.id === p.nav.section)!;

  if (!d.ready || !d.live) return <p className="orq-runs2__empty">{d.snap?.error ?? t('runs.loading')}</p>;
  const { live, running, status, reason, label, diagram } = d;
  // Pasos que se pueden corregir de una ejecución que ya no está en marcha [R53.13].
  const fixable = !running && diagram ? correctionTargets(diagram, d.events) : [];
  const answerHere = (questionId: string, text: string) => p.answer({ runId: p.runId, questionId, nodeId: '', nodePath: [], text: '' }, text);

  return (
    <div className="orq-run">
      <header className="orq-run__head">
        <button type="button" className="orq-btn orq-btn--small" onClick={() => p.onNav({ section: p.nav.section })}>
          <ArrowLeft size={14} aria-hidden="true" />
          {t('runs.back', { section: t(back.label) })}
        </button>
        <h1>{d.title}</h1>
        <span className={`orq-pill is-${status}`}>{statusLabel(status, running && live.paused)}</span>
        <span className="orq-run__input" title={d.input}>
          {d.input}
        </span>
        <span className="orq-mono orq-hint orq-run__figures">
          {formatDuration(d.duration)} · {d.usageText}
        </span>
        {!running && <StoppedActions api={p.api} runId={p.runId} status={status} row={p.row} onOpen={(id) => (p.index.refresh(), p.onNav({ section: p.nav.section, runId: id }))} onChanged={() => p.index.refresh()} />}
        {running && (
          <>
            <button type="button" className="orq-btn orq-btn--small" onClick={() => p.control(p.runId, live.paused ? 'resume' : 'pause')}>
              {live.paused ? <Play size={13} aria-hidden="true" /> : <Pause size={13} aria-hidden="true" />}
              {live.paused ? t('runs.resume') : t('runs.pause')}
            </button>
            <button type="button" className="orq-btn orq-btn--small orq-btn--stop" onClick={() => p.control(p.runId, 'cancel')}>
              <Square size={11} fill="currentColor" aria-hidden="true" />
              {t('runs.cancel')}
            </button>
          </>
        )}
      </header>
      {running && live.pending.length > 0 && (
        // Alto máximo y scroll propio: las preguntas nunca tapan la ejecución ni quedan cortadas por abajo.
        <div className="orq-run__asks">
          {live.pending.map((q) => (
            <div key={q.questionId} className="orq-run__banner">
              <QuestionCard item={q} from={label(q.nodeId, q.nodePath)} onAnswer={(text) => answerHere(q.questionId, text)} />
            </div>
          ))}
        </div>
      )}
      {status === 'failed' && (
        <div className="orq-run__banner orq-run__banner--error" role="alert">
          <strong>{t('runs.failedAt')}</strong>
          <span>{reason ? t('runs.reason', { reason }) : t('runs.noReason')}</span>
        </div>
      )}
      {status === 'interrupted' && (
        <div className="orq-run__banner orq-run__banner--error" role="alert">
          <strong>{t('runs.interrupted')}</strong>
          <span>{t('runs.interrupted.why')}</span>
        </div>
      )}
      {(p.row?.resumedFrom || p.row?.resumedBy) && (
        <p className="orq-run__note orq-run__link" role="note">
          {p.row.resumedBy ? t('resume.by') : t('resume.from')}
          <button type="button" className="orq-btn orq-btn--small orq-btn--ghost" onClick={() => p.onNav({ section: p.nav.section, runId: (p.row!.resumedBy ?? p.row!.resumedFrom)! })}>
            {p.row.resumedBy ? t('resume.openNew') : t('resume.openOld')}
          </button>
        </p>
      )}
      {(p.row?.correctedFrom || (p.row?.correctedBy?.length ?? 0) > 0) && (
        // Enlaces con la ejecución corregida o con la última corrección [R53.14].
        <p className="orq-run__note orq-run__link" role="note">
          {p.row!.correctedBy?.length ? t('fix.by') : t('fix.from')}
          <button type="button" className="orq-btn orq-btn--small orq-btn--ghost" onClick={() => p.onNav({ section: p.nav.section, runId: (p.row!.correctedBy?.at(-1) ?? p.row!.correctedFrom)! })}>
            {p.row!.correctedBy?.length ? t('fix.openNew') : t('fix.openOld')}
          </button>
        </p>
      )}
      {diagram && d.old && <p className="orq-run__note" role="note">{t('runs.oldDiagram')}</p>}
      <div className="orq-run__body">
        <div className="orq-run__left">
          <div className="orq-run__canvas">
            {diagram ? (
              <RunCanvas diagram={diagram} live={live} events={d.events} agentNames={p.agentNames} onSelect={setPicked} onOpenFile={openPreview} previewCard={previewCard} />
            ) : (
              <p className="orq-runs2__empty">{diagram === null ? t('runs.noDiagram') : t('runs.loading')}</p>
            )}
            {/* En lugar del panel de pestañas, un aviso con la frase y el botón al modal [R44.5]. */}
            <RunDoneBanner events={d.events} labelOf={label} running={running} interrupted={status === 'interrupted'} onSummary={() => setModal(running ? 'gantt' : 'summary')} onCorrect={fixable.length > 0 ? () => setFix({}) : undefined} />
          </div>
        </div>
        <aside className="orq-run__side" aria-label={step ? label(step.nodeId, step.nodePath) : t('runs.step.none')}>
          {step && step.nodePath.length === 0 && fixable.includes(step.nodeId) && (
            <button type="button" className="orq-btn orq-btn--small orq-run__fixstep" onClick={() => setFix({ prefer: step.nodeId })}>
              {t('fix.open.step')}
            </button>
          )}
          {step ? (
            <NodePanel events={d.events} live={live} nodeId={step.nodeId} nodePath={step.nodePath} label={label(step.nodeId, step.nodePath)} labelOf={(id) => label(id, step.nodePath)} onAnswer={answerHere} closed={!running} onOpenFile={setViewing} onPreview={openPreview} renderThumb={previewCard} />
          ) : (
            <p className="orq-hint">{t('runs.step.none')}</p>
          )}
        </aside>
      </div>
      {modal && <RunModalView data={d} api={p.api} runId={p.runId} initialTab={modal} onClose={() => setModal(undefined)} onPick={(k) => (setModal(undefined), setPicked(k))} onExport={p.onExport} />}
      {previewing && (
        // Vista previa en grande: archivos del paso, comparar con la anterior, ver cambios y pedir corrección [R54.5].
        <PreviewDialog
          api={p.api}
          runId={p.runId}
          stepKey={previewing.key}
          label={label(previewing.key.split('/').pop()!, previewing.key.split('/').slice(0, -1))}
          files={filesByStep(d.events)[previewing.key] ?? [{ path: previewing.path }]}
          initial={previewing.path}
          compareRunId={p.row?.correctedFrom ?? p.row?.resumedFrom}
          onClose={() => setPreviewing(undefined)}
          onChanges={(path) => (setPreviewing(undefined), setViewing(path))}
          onCorrect={fixable.includes(previewing.key) ? () => (setPreviewing(undefined), setFix({ prefer: previewing.key })) : undefined}
        />
      )}
      {fix && diagram && (
        <CorrectionDialog
          api={p.api}
          runId={p.runId}
          diagram={diagram}
          events={d.events}
          prefer={fix.prefer}
          onClose={() => setFix(undefined)}
          onOpen={(id) => (setFix(undefined), p.index.refresh(), p.onNav({ section: p.nav.section, runId: id }))}
        />
      )}
      {viewing !== undefined && <FileViewer api={p.api} runId={p.runId} events={d.events} path={viewing} labelOf={label} onClose={() => setViewing(undefined)} />}
    </div>
  );
}

/** Modal de una ejecución que carga sus datos: para abrirlo fuera de Ejecuciones (el Diseñador) [R44.1–R44.4]. */
export function RunModal({ api, runId, main, now = Date.now, onClose, onPick, onOpenRuns, onExport }: { api: ProjectApi; runId: string; main: RunSnapshot; now?: () => number; onClose: () => void; onPick: (key: string) => void; onOpenRuns?: () => void; onExport: (runId: string, jsonl: string) => void }) {
  const d = useRunData(api, runId, main, undefined, true, now);
  return <RunModalView data={d} api={api} runId={runId} onClose={onClose} onPick={onPick} onExport={onExport} {...(onOpenRuns ? { onOpenRuns } : {})} />;
}

/** El modal amplio con la cabecera de la ejecución y sus mismas pestañas [R44.1]. */
function RunModalView({ data: d, api, runId, initialTab = 'summary', onClose, onPick, onOpenRuns, onExport }: { data: RunData; api: ProjectApi; runId: string; initialTab?: Btab; onClose: () => void; onPick: (key: string) => void; onOpenRuns?: () => void; onExport: (runId: string, jsonl: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Btab>(initialTab);
  const [viewing, setViewing] = useState<string>();
  /** «Abrir entregable»: pasa a Resultados con ese archivo abierto [R46.15]. */
  const [openPath, setOpenPath] = useState<string>();
  const [copied, setCopied] = useState(false);
  useEffect(() => ref.current?.focus(), []);
  const summary = d.ready ? summarizeRun(d.events, d.label, 600, Date.now(), d.status === 'interrupted') : undefined;
  const name = t('rsum.modal', { name: d.title });
  return (
    <div
      className="orq-modal"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div ref={ref} tabIndex={-1} className="orq-picker orq-detail orq-rsum-modal" role="dialog" aria-modal="true" aria-label={name}>
        <header className="orq-picker__head orq-rmodal__head">
          {summary && <span className={`orq-rmodal__icon is-${summary.status}`}>{summary.status === 'succeeded' ? <CheckCircle2 size={20} aria-hidden="true" /> : summary.status === 'running' ? <Loader2 size={20} className="orq-spin" aria-hidden="true" /> : <XCircle size={20} aria-hidden="true" />}</span>}
          <div className="orq-rmodal__title">
            <h2>{name}</h2>
            <p className="orq-hint">{summary?.headline ?? d.snap?.error ?? t('runs.loading')}</p>
            {d.ready && (
              <p className="orq-mono orq-hint orq-rmodal__figures">
                {formatDuration(d.duration)} · {d.usageText}
              </p>
            )}
          </div>
          <div className="orq-detail__actions">
            {summary?.finalOutput && (
              <button
                type="button"
                className="orq-btn orq-btn--small"
                onClick={() => {
                  void navigator.clipboard?.writeText(summary.finalOutput ?? '').catch(() => undefined);
                  setCopied(true);
                }}
              >
                <Copy size={14} aria-hidden="true" />
                {copied ? t('runs.copied') : t('runs.copy')}
              </button>
            )}
            {onOpenRuns && (
              <button type="button" className="orq-btn orq-btn--small" onClick={onOpenRuns}>
                {t('rmodal.toRuns')}
              </button>
            )}
            <button type="button" className="orq-icon-btn" aria-label={t('picker.close')} title={t('picker.close')} onClick={onClose}>
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </header>
        <div className="orq-run__tabs orq-rmodal__tabs" role="tablist" aria-label={t('runs.btab')}>
          {BTABS.map((b) => (
            <button key={b} type="button" role="tab" aria-selected={tab === b} onClick={() => setTab(b)}>
              {t(`runs.btab.${b}` as MessageKey)}
            </button>
          ))}
        </div>
        <div className="orq-detail__body" role="tabpanel" aria-label={t(`runs.btab.${tab}` as MessageKey)}>
          {d.ready ? <RunTabBody tab={tab} data={d} api={api} runId={runId} onPick={onPick} onExport={onExport} wide onOpenFile={setViewing} onOpenDeliverable={(path) => (setOpenPath(path), setTab('result'))} openPath={openPath} /> : <p className="orq-hint">{d.snap?.error ?? t('runs.loading')}</p>}
        </div>
      </div>
      {viewing !== undefined && <FileViewer api={api} runId={runId} events={d.events} path={viewing} labelOf={d.label} onClose={() => setViewing(undefined)} />}
    </div>
  );
}

/**
 * Diagrama de una ejecución tal como estaba al arrancar (R35.16). Si no se guardó (ejecuciones
 * anteriores) se usa el actual y `old` lo indica; `null` si tampoco existe ya.
 */
function useRunDiagram(api: ProjectApi, runId: string, diagramId: string | undefined): { diagram: Diagram | null | undefined; old: boolean } {
  const [state, setState] = useState<{ diagram: Diagram | null | undefined; old: boolean }>({ diagram: undefined, old: false });
  useEffect(() => {
    let alive = true;
    setState({ diagram: undefined, old: false });
    void (async () => {
      const own = await api.runDiagram(runId);
      if (!alive) return;
      if (own.ok && own.value) return setState({ diagram: own.value, old: false });
      if (!diagramId) return;
      const now = await api.loadDiagram(diagramId);
      if (alive) setState({ diagram: now.ok ? now.value : null, old: now.ok });
    })();
    return () => {
      alive = false;
    };
  }, [api, runId, diagramId]);
  return state;
}

/** Lienzo de solo lectura con el diagrama de la ejecución y el estado de cada paso [R35.9]. */
function RunCanvas({ diagram, live, events, agentNames, onSelect, onOpenFile, previewCard }: { diagram: Diagram; live: LiveView; events: readonly RunEvent[]; agentNames: Readonly<Record<string, string>>; onSelect: (key: string) => void; onOpenFile?: (key: string, path: string) => void; previewCard?: (key: string, path: string) => ReactNode }) {
  const session = useMemo(() => {
    const s = new EditorSession(diagram);
    s.setReadOnly(true);
    return s;
  }, [diagram]);
  // Fichas con los archivos de cada paso, debajo de su nodo [R54.1].
  const extras = useMemo(() => ({ stepFiles: filesByStep(events), ...(onOpenFile ? { onOpenFile } : {}), ...(previewCard ? { previewCard } : {}) }), [events, onOpenFile, previewCard]);
  const pick = (id: string) => onSelect(pathKey(session.getSnapshot().path, id));
  return (
    <ReactFlowProvider>
      <Canvas
        session={session}
        live={live}
        events={events}
        readOnly
        agentNames={agentNames}
        extras={extras}
        onReject={() => {}}
        onSelection={(sel) => sel.nodes.length === 1 && pick(sel.nodes[0]!)}
        onOpenNode={pick}
      />
    </ReactFlowProvider>
  );
}

function Result({ api, runId, live, running, label, duration, usage, openPath }: { api: ProjectApi; runId: string; live: LiveView; running: boolean; label: (id: string) => string; duration: number; usage: { tokens: number; costUsd: number } | undefined; openPath?: string | undefined }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="orq-run__result">
      {live.finalOutput !== undefined ? (
        <section className="orq-panel orq-runs__final" aria-label={t('runs.final')}>
          <h2>{t('runs.final')}</h2>
          <p>{live.finalOutput}</p>
          <button
            type="button"
            className="orq-btn orq-btn--small"
            onClick={() => {
              void navigator.clipboard?.writeText(live.finalOutput ?? '').catch(() => undefined);
              setCopied(true);
            }}
          >
            {copied ? t('runs.copied') : t('runs.copy')}
          </button>
        </section>
      ) : (
        <p className="orq-hint">{running ? t('runs.result.none') : t('runs.result.failed')}</p>
      )}
      <div className="orq-runs__stats">
        <div className="orq-panel">
          <span className="orq-hint">{t('runs.stat.duration')}</span>
          <strong>{formatDuration(duration)}</strong>
        </div>
        <div className="orq-panel">
          <span className="orq-hint">{t('runs.stat.tokens')}</span>
          <strong>{usage ? usage.tokens.toLocaleString('es-ES') : t('runs.noUsage')}</strong>
        </div>
        <div className="orq-panel">
          <span className="orq-hint">{t('runs.stat.cost')}</span>
          <strong>{usage ? money(usage.costUsd) : t('runs.noUsage')}</strong>
        </div>
      </div>
      <ResultsPanel api={api} runId={runId} live={live} labelOf={(id) => label(id)} hideFinal initialPath={openPath} />
    </div>
  );
}

const stepIcon = (st: string) => (st === 'succeeded' ? <CheckCircle2 size={15} aria-hidden="true" /> : st === 'failed' ? <XCircle size={15} aria-hidden="true" /> : st === 'running' || st === 'waiting_input' ? <Loader2 size={15} className="orq-spin" aria-hidden="true" /> : <CircleDashed size={15} aria-hidden="true" />);
/**
 * Pestaña «Resumen»: cómo terminó en una frase, lo que se pidió, el resultado final y qué hizo cada paso, con
 * revisiones, preguntas, archivos y errores [R38.23].
 */
function SummaryBody({ summary: s, onPick, wide = false, onOpenDeliverable }: { summary: RunSummaryView; onPick: (key: string) => void; wide?: boolean; onOpenDeliverable?: (path: string) => void }) {
  const icon = stepIcon;
  return (
    <div className={`orq-rsum${wide ? ' is-wide' : ''}`}>
      <div className="orq-rsum__col">
      <p className={`orq-rsum__head is-${s.status}`} role={wide ? undefined : 'status'}>
        {icon(s.status)}
        <strong>{s.headline}</strong>
      </p>
      {s.deliverable && <DeliverableBlock deliverable={s.deliverable} running={s.status === 'running'} {...(onOpenDeliverable ? { onOpenFile: onOpenDeliverable } : {})} />}
      {s.input && (
        <section className="orq-rsum__sec" aria-label={t('rsum.input')}>
          <h3>{t('rsum.input')}</h3>
          <p className="orq-rsum__quote">{s.input}</p>
        </section>
      )}
      {/* Con entregable, el resultado final es el propio entregable: no se repite [R46.15]. */}
      {!s.deliverable?.done && (
        <section className="orq-rsum__sec" aria-label={t('rsum.output')}>
          <h3>{t('rsum.output')}</h3>
          {s.finalOutput ? <Markdown text={s.finalOutput} className="orq-rsum__out" /> : <p className="orq-hint">{t('rsum.noOutput')}</p>}
        </section>
      )}
      </div>
      <div className="orq-rsum__col">
      <section className="orq-rsum__sec" aria-label={t('rsum.steps')}>
        <h3>{t('rsum.steps')}</h3>
        <ol className="orq-rsum__steps">
          {s.steps.map((st) => (
            <li key={st.key} className={`is-${st.status}`}>
              <button type="button" className="orq-rsum__step" aria-label={t('rsum.step.open', { name: st.label })} onClick={() => onPick(st.key)}>
                {icon(st.status)}
                <strong>{st.label}</strong>
                {st.runs > 1 && <span className="orq-tag">{t('rsum.step.runs', { count: st.runs })}</span>}
                {st.reused && <span className="orq-tag is-reused">{t('rsum.reused')}</span>}
              </button>
              {st.error ? <p className="orq-rsum__err">{st.error}</p> : <p className="orq-rsum__snip">{st.output ?? t('rsum.step.nothing')}</p>}
              {st.files.length > 0 && <p className="orq-hint orq-mono">{t('rsum.step.files', { files: st.files.join(', ') })}</p>}
            </li>
          ))}
        </ol>
      </section>
      {s.reviews.length > 0 && (
        <section className="orq-rsum__sec" aria-label={t('rsum.reviews')}>
          <h3>{t('rsum.reviews')}</h3>
          <ul className="orq-rsum__list">
            {s.reviews.map((r) => (
              <li key={r.label}>
                {t('rsum.review.line', { name: r.label, round: r.round, max: r.max, verdict: t(`rsum.verdict.${r.verdict}` as MessageKey) })}
                {r.reason && <span className="orq-hint"> — {r.reason}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {s.questions.length > 0 && (
        <section className="orq-rsum__sec" aria-label={t('rsum.questions')}>
          <h3>{t('rsum.questions')}</h3>
          <ul className="orq-rsum__list">
            {s.questions.map((q, i) => (
              <li key={i}>
                <strong>{q.label}:</strong> {q.text} → <em>{q.answer ?? t('rsum.noAnswer')}</em>
              </li>
            ))}
          </ul>
        </section>
      )}
      {s.files.length > 0 && (
        <section className="orq-rsum__sec" aria-label={t('rsum.files')}>
          <h3>{t('rsum.files')}</h3>
          <ul className="orq-rsum__list orq-mono">
            {s.files.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </section>
      )}
      {s.errors.length > 0 && (
        <section className="orq-rsum__sec" aria-label={t('rsum.errors')}>
          <h3>{t('rsum.errors')}</h3>
          <ul className="orq-rsum__list">
            {s.errors.map((e, i) => (
              <li key={i} className="orq-rsum__err">
                {e.label ? <strong>{e.label}: </strong> : null}
                {e.message}
              </li>
            ))}
          </ul>
        </section>
      )}
      </div>
    </div>
  );
}

/**
 * «Reanudar» una ejecución interrumpida, fallida o cancelada (en otra nueva que reutiliza lo hecho) y «Cancelar» una
 * interrumpida [R41.4].
 */
function StoppedActions({ api, runId, status, row, onOpen, onChanged }: { api: ProjectApi; runId: string; status: string; row: HistoryRow | undefined; onOpen: (id: string) => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (!canResume(status, row?.resumedBy)) return null;
  const resume = async () => {
    setBusy(true);
    const r = await api.resumeRun(runId);
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    onOpen(r.value.runId);
  };
  const dismiss = async () => {
    setBusy(true);
    const r = await api.dismissRun(runId);
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    onChanged();
  };
  return (
    <>
      <button type="button" className="orq-btn orq-btn--small orq-btn--primary" disabled={busy} title={t('resume.hint')} onClick={() => void resume()}>
        <RotateCcw size={13} aria-hidden="true" />
        {t('resume.do')}
      </button>
      {status === 'interrupted' && (
        <button type="button" className="orq-btn orq-btn--small orq-btn--stop" disabled={busy} title={t('resume.dismiss.hint')} onClick={() => void dismiss()}>
          <Square size={11} fill="currentColor" aria-hidden="true" />
          {t('runs.cancel')}
        </button>
      )}
      {error && (
        <span className="orq-field__error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}

/** Bloque «Entregable» al principio del resumen: Markdown, estado por elemento, «Copiar» y «Abrir entregable» [R46.15]. */
function DeliverableBlock({ deliverable, running, onOpenFile }: { deliverable: NonNullable<RunSummaryView['deliverable']>; running: boolean; onOpenFile?: (path: string) => void }) {
  const [copied, setCopied] = useState(false);
  const done = deliverable.done;
  if (!done) {
    if (running) return null;
    return (
      <section className="orq-rsum__dlv" aria-label={t('rsum.dlv')}>
        <h3>{t('rsum.dlv')}</h3>
        <p className="orq-hint">{t('rsum.dlv.pending')}</p>
      </section>
    );
  }
  return (
    <section className="orq-rsum__dlv" aria-label={t('rsum.dlv')}>
      <div className="orq-rsum__dlv-head">
        <h3>{t('rsum.dlv')}</h3>
        <div className="orq-detail__actions">
          <button
            type="button"
            className="orq-btn orq-btn--small"
            onClick={() => {
              void navigator.clipboard?.writeText(done.markdown).catch(() => undefined);
              setCopied(true);
            }}
          >
            <Copy size={14} aria-hidden="true" />
            {copied ? t('runs.copied') : t('rsum.dlv.copy')}
          </button>
          {onOpenFile && (
            <button type="button" className="orq-btn orq-btn--small" onClick={() => onOpenFile(`${done.fileName}.md`)}>
              {t('rsum.dlv.open')}
            </button>
          )}
        </div>
      </div>
      <ul className="orq-rsum__dlv-items">
        {done.items.map((it, i) => (
          <li key={i}>
            <span className={it.ok ? 'is-ok' : 'is-warn'} aria-hidden="true">
              {it.ok ? '✓' : '⚠'}
            </span>
            <span>{it.ok ? it.title : `${it.title} · ${t('rsum.dlv.failed', { error: it.error ?? '' })}`}</span>
            <em>{it.kind === 'links' ? t('rsum.dlv.noai') : it.tokens ? t('rsum.dlv.tokens', { n: it.tokens.toLocaleString('es-ES') }) : ''}</em>
          </li>
        ))}
      </ul>
      <Markdown text={done.markdown} className="orq-rsum__out" />
    </section>
  );
}
