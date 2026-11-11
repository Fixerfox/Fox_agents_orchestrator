import { type ReactNode, useMemo, useState } from 'react';
import { CheckCircle2, XCircle, Loader2, CircleDashed, RotateCcw, Square, Copy, GitBranch, ShieldAlert } from 'lucide-react';
import { ReactFlowProvider } from '@xyflow/react';
import { type Diagram, type RunEvent, pathKey, canResume } from '@orquestador/core';
import { type LiveView, EditorSession, filesByStep, type ProjectApi, t, formatDuration, type RunSummaryView, type MessageKey, type HistoryRow, supervisorView } from '@orquestador/editor';
import { Canvas } from '../diagrams';
import { SupervisorOverlay } from './SupervisorOverlay';
import { SupervisorBalance, SupervisorFinal, SupervisorMemoryList, ruleTitle } from './SupervisorTab';
import { ResultsPanel } from './ResultsPanel';
import { Markdown, PrLink } from '../common';
import { money } from './runFormat';

/** Lienzo de solo lectura con el diagrama de la ejecución y el estado de cada paso [R35.9]. */
export function RunCanvas({ diagram, live, events, agentNames, onSelect, onOpenFile, previewCard, label, onSupervisor, onMemory }: { label?: (id: string, path: readonly string[]) => string; onSupervisor?: (key?: string) => void; /** «Ver las N entradas» de la memoria [R69.4]. */ onMemory?: () => void; diagram: Diagram; live: LiveView; events: readonly RunEvent[]; agentNames: Readonly<Record<string, string>>; onSelect: (key: string) => void; onOpenFile?: (key: string, path: string) => void; previewCard?: (key: string, path: string) => ReactNode }) {
  const session = useMemo(() => {
    const s = new EditorSession(diagram);
    s.setReadOnly(true);
    return s;
  }, [diagram]);
  // Fichas con los archivos de cada paso, debajo de su nodo [R54.1].
  const extras = useMemo(() => ({ stepFiles: filesByStep(events), ...(onOpenFile ? { onOpenFile } : {}), ...(previewCard ? { previewCard } : {}), ...(onSupervisor ? { onAlerts: onSupervisor } : {}) }), [events, onOpenFile, previewCard, onSupervisor]);
  const pick = (id: string) => onSelect(pathKey(session.getSnapshot().path, id));
  // La tarjeta y la memoria salen de los eventos: sin Supervisor, no hay nada que pintar [R60.32].
  const watch = useMemo(() => supervisorView(events, live.status === 'running', label ?? ((id) => id)), [events, live.status, label]);
  return (
    <ReactFlowProvider>
      <Canvas
        session={session}
        live={live}
        events={events}
        readOnly
        {...(watch ? { overlay: (path: readonly string[]) => <SupervisorOverlay view={watch} path={path} onOpen={onSupervisor} onMemory={onMemory} /> } : {})}
        agentNames={agentNames}
        extras={extras}
        onReject={() => {}}
        onSelection={(sel) => sel.nodes.length === 1 && pick(sel.nodes[0]!)}
        onOpenNode={pick}
      />
    </ReactFlowProvider>
  );
}

export function Result({ api, runId, live, running, label, duration, usage, openPath }: { api: ProjectApi; runId: string; live: LiveView; running: boolean; label: (id: string) => string; duration: number; usage: { tokens: number; costUsd: number } | undefined; openPath?: string | undefined }) {
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
export function SummaryBody({ summary: s, onPick, wide = false, onOpenDeliverable, onAlert }: { summary: RunSummaryView; onPick: (key: string) => void; wide?: boolean; onOpenDeliverable?: (path: string) => void; onAlert?: ((key?: string) => void) | undefined }) {
  const icon = stepIcon;
  return (
    <div className={`orq-rsum${wide ? ' is-wide' : ''}`}>
      <div className="orq-rsum__col">
      <p className={`orq-rsum__head is-${s.status}`} role={wide ? undefined : 'status'}>
        {icon(s.status)}
        <strong>{s.headline}</strong>
      </p>
      {/* Lo reutilizado al reanudar y lo que ahorró [R74.13]. */}
      {s.reused && (
        <p className="orq-rsum__reused" role="note">
          {t('rsum.reusedFrom', { steps: s.reused.steps, decisions: s.reused.decisions, answers: s.reused.answers })}
          {s.reused.savedUsd > 0 && ` ${t('rsum.reusedFrom.saved', { usd: s.reused.savedUsd.toFixed(2) })}`}
        </p>
      )}
      {s.git && (
        <p className="orq-rsum__git" role="note">
          {t('rsum.git.start')}
          <strong className="orq-rsum__branch">{s.git.branch}</strong>
          {s.git.commit && <code> {s.git.commit}</code>}
          {s.git.created && ` · ${t('rsum.git.created', { from: s.git.from ?? '' })}`}
          {s.git.dirty !== undefined && ` · ${t('rsum.git.dirty', { n: s.git.dirty })}`}
          {s.git.stash && <span className="orq-hint"> {t('rsum.git.stash', { label: s.git.stash })}</span>}
        </p>
      )}
      {s.branches.length > 0 && (
        <section className="orq-rsum__branches" aria-label={t('rsum.branches')}>
          <h3>{t('rsum.branches')}</h3>
          <ul>
            {s.branches.map((b) => (
              <li key={b.name}>
                <strong className="orq-rsum__branch">
                  <GitBranch size={14} aria-hidden="true" />
                  <span>{b.name}</span>
                </strong>
                {b.created && <span className="orq-tag">{t('rsum.branch.new')}</span>}
                {b.deleted && <span className="orq-tag">{t('rsum.branch.deleted')}</span>}
                {b.prUrl && <PrLink url={b.prUrl} />}
                <span className="orq-hint">{b.steps.map((s) => (s.actions.length > 0 ? `${s.label} (${s.actions.map((a) => t(`git.action.${a}` as MessageKey)).join(', ')})` : s.label)).join(' · ')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {s.supervisor && (
        <section className="orq-rsum__sec orq-rsum__sup" aria-label={t('rsum.sup')}>
          <h3>{t('rsum.sup')}</h3>
          <SupervisorBalance watch={s.supervisor} />
          <SupervisorFinal watch={s.supervisor} />
          {s.supervisor.alerts.length > 0 ? (
            <ul className="orq-supalerts">
              {s.supervisor.alerts.map((a, i) => (
                <li key={i}>
                  <button type="button" className="orq-supalert orq-supalert--row" onClick={() => onAlert?.(a.key)}>
                    <ShieldAlert size={16} aria-hidden="true" />
                    <span>
                      <strong>{ruleTitle(a.rule)}</strong>
                      {a.label && <span className="orq-hint"> · {a.label}</span>}
                      <span className="orq-supalert__detail">{a.detail}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="orq-hint">{t('rsum.sup.ok')}</p>
          )}
          {s.supervisor.skipped && <p className="orq-hint">{s.supervisor.skipped.reason === 'timeout' ? t('rsum.sup.timeout', { count: s.supervisor.skipped.count }) : t('rsum.sup.failed')}</p>}
          <SupervisorMemoryList watch={s.supervisor} />
        </section>
      )}
      {s.splitRejections.length > 0 && (
        <section className="orq-rsum__sec" aria-label={t('rsum.split')}>
          <h3>{t('rsum.split')}</h3>
          <ul className="orq-rsum__list">
            {s.splitRejections.map((r, i) => (
              <li key={i}>
                <strong>{r.label}</strong> · {t('split.rejected', { problems: r.problems.join(' ') })}
              </li>
            ))}
          </ul>
        </section>
      )}
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
export function StoppedActions({ api, runId, status, row, onOpen, onChanged }: { api: ProjectApi; runId: string; status: string; row: HistoryRow | undefined; onOpen: (id: string) => void; onChanged: () => void }) {
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
