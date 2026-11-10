import { useRef, useState, useEffect } from 'react';
import { CheckCircle2, Loader2, ShieldAlert, XCircle, Copy, X } from 'lucide-react';
import { type ProjectApi, type RunSnapshot, summarizeRun, t, formatDuration, type MessageKey } from '@orquestador/editor';
import { FileViewer } from './RunFiles';
import { useRunData, type RunData } from './useRunData';
import { type Btab, BTABS, RunTabBody } from './RunTabs';

/** Modal de una ejecución que carga sus datos: para abrirlo fuera de Ejecuciones (el Diseñador) [R44.1–R44.4]. */
export function RunModal({ api, runId, main, now = Date.now, onClose, onPick, onOpenRuns, onExport }: { api: ProjectApi; runId: string; main: RunSnapshot; now?: () => number; onClose: () => void; onPick: (key: string) => void; onOpenRuns?: () => void; onExport: (runId: string, jsonl: string) => void }) {
  const d = useRunData(api, runId, main, undefined, true, now);
  return <RunModalView data={d} api={api} runId={runId} onClose={onClose} onPick={onPick} onExport={onExport} {...(onOpenRuns ? { onOpenRuns } : {})} />;
}

/** El modal amplio con la cabecera de la ejecución y sus mismas pestañas [R44.1]. */
export function RunModalView({ data: d, api, runId, initialTab = 'summary', onClose, onPick, onOpenRuns, onExport, focusAlert }: { focusAlert?: string | undefined; data: RunData; api: ProjectApi; runId: string; initialTab?: Btab; onClose: () => void; onPick: (key: string) => void; onOpenRuns?: () => void; onExport: (runId: string, jsonl: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Btab>(initialTab);
  /** Paso cuyos avisos se abren en la pestaña «Supervisor» [R60.40]. */
  const [focus, setFocus] = useState(focusAlert);
  const [viewing, setViewing] = useState<string>();
  /** «Abrir entregable»: pasa a Resultados con ese archivo abierto [R46.15]. */
  const [openPath, setOpenPath] = useState<string>();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    ref.current?.focus();
  }, []);
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
          {BTABS.filter((b) => (b !== 'supervisor' || summary?.supervisor) && (b !== 'memory' || (summary?.supervisor && (summary.supervisor.notes.length > 0 || summary.supervisor.branch)))).map((b) => {
            const alerts = b === 'supervisor' ? (summary?.supervisor?.alerts.length ?? 0) : 0;
            return (
              <button key={b} type="button" role="tab" aria-selected={tab === b} className={b === 'supervisor' ? `orq-run__tab-sup${alerts > 0 ? ' has-alerts' : ''}` : undefined} onClick={() => setTab(b)}>
                {b === 'supervisor' && <ShieldAlert size={14} aria-hidden="true" />}
                {t(`runs.btab.${b}` as MessageKey)}
                {alerts > 0 && <span className="orq-run__tabcount">{alerts}</span>}
              </button>
            );
          })}
        </div>
        <div className="orq-detail__body" role="tabpanel" aria-label={t(`runs.btab.${tab}` as MessageKey)}>
          {d.ready ? <RunTabBody focusAlert={focus} onAlert={(key) => (setFocus(key), setTab('supervisor'))} tab={tab} data={d} api={api} runId={runId} onPick={onPick} onExport={onExport} wide onOpenFile={setViewing} onOpenDeliverable={(path) => (setOpenPath(path), setTab('result'))} openPath={openPath} /> : <p className="orq-hint">{d.snap?.error ?? t('runs.loading')}</p>}
        </div>
      </div>
      {viewing !== undefined && <FileViewer api={api} runId={runId} events={d.events} path={viewing} labelOf={d.label} onClose={() => setViewing(undefined)} />}
    </div>
  );
}
