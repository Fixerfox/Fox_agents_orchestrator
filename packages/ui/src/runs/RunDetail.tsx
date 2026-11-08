import { useState, useCallback } from 'react';
import { ArrowLeft, Play, Pause, Square } from 'lucide-react';
import { correctionTargets } from '@orquestador/core';
import { type HistoryRow, type RunAction, defaultStep, t, formatDuration, filesByStep } from '@orquestador/editor';
import { CorrectionDialog } from './CorrectionDialog';
import { PreviewThumb, PreviewDialog } from './Preview';
import { FoldedStep, NodePanel } from './NodePanel';
import type { InboxItem } from './useRunsIndex';
import { FileViewer } from './RunFiles';
import { RunDoneBanner } from './RunDoneBanner';
import { useRunData } from './useRunData';
import { StoppedActions, RunCanvas } from './RunSummary';
import { type RunsScreenProps } from './runsTypes';
import { SECTIONS, crumbSection, statusLabel } from './runFormat';
import { type Btab } from './RunTabs';
import { QuestionCard } from './QuestionCard';
import { RunModalView } from './RunModal';
import { AcceptDialog } from './AcceptDialog';

/** Vista de una ejecución: cabecera, avisos, lienzo, mensajes del paso y pestañas inferiores [R35.8–R35.10]. */
export function RunDetail(
  p: RunsScreenProps & {
    runId: string;
    row: HistoryRow | undefined;
    now: () => number;
    control: (runId: string, a: RunAction) => void;
    answer: (i: InboxItem, text: string) => void;
  },
) {
  /** Sube tras «Dar por bueno» para volver a leer la ejecución [R65.8]. */
  const [version, setVersion] = useState(0);
  const [accepting, setAccepting] = useState(false);
  const d = useRunData(p.api, p.runId, p.main, p.row, p.index.loaded, p.now, version);
  const [picked, setPickedRaw] = useState<string | undefined>(p.nav.step);
  /** Panel del paso plegado a una franja; elegir otro paso lo despliega [R68.3]. */
  const [folded, setFolded] = useState(false);
  const setPicked = useCallback((k: string | undefined) => {
    setPickedRaw(k);
    setFolded(false);
  }, []);
  /** Modal de la ejecución y la pestaña con la que se abre: «Resumen» si ya terminó y «Cronograma» mientras corre [R44.5]. */
  const [modal, setModal] = useState<Btab>();
  /** Paso desde el que se abrió la pestaña «Supervisor» [R60.36][R60.40]. */
  const [alertStep, setAlertStep] = useState<string>();
  const openSupervisor = useCallback((key?: string) => {
    setAlertStep(key);
    setModal('supervisor');
  }, []);
  /** Fichero abierto en el visor [R45.10]. */
  const [viewing, setViewing] = useState<string>();
  /** Ventana «Pedir corrección», con el paso desde el que se abrió [R53.13]. */
  const [fix, setFix] = useState<{ prefer?: string }>();
  /** Vista previa en grande de un archivo de un paso [R54.5]. */
  const [previewing, setPreviewing] = useState<{ key: string; path: string }>();
  const openPreview = useCallback((key: string, path: string) => setPreviewing({ key, path }), []);
  const previewCard = useCallback((key: string, path: string) => <PreviewThumb api={p.api} runId={p.runId} stepKey={key} path={path} />, [p.api, p.runId]);
  const step = d.timeline.steps.find((s) => s.key === picked) ?? defaultStep(d.timeline.steps);
  const backId = crumbSection(p.nav, p.row);
  const back = SECTIONS.find((s) => s.id === backId)!;

  if (!d.ready || !d.live) return <p className="orq-runs2__empty">{d.snap?.error ?? t('runs.loading')}</p>;
  const { live, running, status, reason, label, diagram } = d;
  // Pasos que se pueden corregir de una ejecución que ya no está en marcha [R53.13].
  const fixable = !running && diagram ? correctionTargets(diagram, d.events) : [];
  const answerHere = (questionId: string, text: string) => p.answer({ runId: p.runId, questionId, nodeId: '', nodePath: [], text: '' }, text);

  return (
    <div className="orq-run">
      <header className="orq-run__head">
        <button type="button" className="orq-btn orq-btn--small" onClick={() => p.onNav({ section: backId })}>
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
      {d.accepted && (
        // Aceptada: quién, por qué y por qué había fallado [R65.8].
        <p className="orq-run__note" role="note">
          <strong>{t(d.accepted.by === 'assistant' ? 'accept.by.assistant' : 'accept.by.user')}</strong>
          {`: ${d.accepted.reason}`}
          {d.accepted.previousReason && <span className="orq-hint"> · {t('accept.failedWith', { reason: d.accepted.previousReason })}</span>}
        </p>
      )}
      {accepting && (
        <AcceptDialog
          api={p.api}
          runId={p.runId}
          onClose={() => setAccepting(false)}
          onAccepted={() => {
            setAccepting(false);
            setVersion((v) => v + 1);
            p.index.refresh();
          }}
        />
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
              <RunCanvas diagram={diagram} live={live} events={d.events} agentNames={p.agentNames} label={label} onSupervisor={openSupervisor} onSelect={setPicked} onOpenFile={openPreview} previewCard={previewCard} />
            ) : (
              <p className="orq-runs2__empty">{diagram === null ? t('runs.noDiagram') : t('runs.loading')}</p>
            )}
            {/* En lugar del panel de pestañas, un aviso con la frase y el botón al modal [R44.5]. */}
            <RunDoneBanner events={d.events} labelOf={label} running={running} interrupted={status === 'interrupted'} onSummary={() => setModal(running ? 'gantt' : 'summary')} onCorrect={fixable.length > 0 ? () => setFix({}) : undefined}
              onAccept={status === 'failed' ? () => setAccepting(true) : undefined}
              onTalk={p.onAskAssistant && status !== 'running' ? () => p.onAskAssistant!(t('talk.prompt', { runId: p.runId, diagram: d.title, status: statusLabel(status, false) })) : undefined}
            />
          </div>
        </div>
        <aside className={`orq-run__side${step && folded ? ' is-folded' : ''}`} aria-label={step ? label(step.nodeId, step.nodePath) : t('runs.step.none')}>
          {step && step.nodePath.length === 0 && fixable.includes(step.nodeId) && (
            <button type="button" className="orq-btn orq-btn--small orq-run__fixstep" onClick={() => setFix({ prefer: step.nodeId })}>
              {t('fix.open.step')}
            </button>
          )}
          {step && folded ? (
            <FoldedStep events={d.events} live={live} nodeId={step.nodeId} nodePath={step.nodePath} label={label(step.nodeId, step.nodePath)} onUnfold={() => setFolded(false)} />
          ) : step ? (
            <NodePanel key={[...step.nodePath, step.nodeId].join('/')} events={d.events} live={live} nodeId={step.nodeId} nodePath={step.nodePath} label={label(step.nodeId, step.nodePath)} labelOf={(id) => label(id, step.nodePath)} onAnswer={answerHere} closed={!running} onOpenFile={setViewing} onPreview={openPreview} renderThumb={previewCard} onFold={() => setFolded(true)} />
          ) : (
            <p className="orq-hint">{t('runs.step.none')}</p>
          )}
        </aside>
      </div>
      {modal && <RunModalView data={d} api={p.api} runId={p.runId} initialTab={modal} focusAlert={alertStep} onClose={() => setModal(undefined)} onPick={(k) => (setModal(undefined), setPicked(k))} onExport={p.onExport} />}
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
