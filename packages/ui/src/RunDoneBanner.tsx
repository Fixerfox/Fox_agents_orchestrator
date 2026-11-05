import { CheckCircle2, Loader2, X, XCircle } from 'lucide-react';
import type { RunEvent } from '@orquestador/core';
import { formatDuration, summarizeRun, t } from '@orquestador/editor';

const money = (usd: number) => `${usd.toFixed(3).replace('.', ',')} $`;

/**
 * Aviso flotante sobre el lienzo con cómo va o cómo acabó una ejecución y el botón que abre su modal. En el
 * Diseñador sale al terminar y se puede cerrar [R44.3]; en Ejecuciones sustituye al panel de pestañas [R44.5].
 */
export function RunDoneBanner({ events, labelOf, onSummary, onOpenRuns, onClose, onCorrect, interrupted = false, running = false }: { events: readonly RunEvent[]; labelOf: (nodeId: string, nodePath: readonly string[]) => string; onSummary: () => void; onOpenRuns?: () => void; onClose?: () => void; /** «Pedir corrección» [R53.13]. */ onCorrect?: (() => void) | undefined; interrupted?: boolean; running?: boolean }) {
  const s = summarizeRun(events, labelOf, 600, Date.now(), interrupted);
  const status = running ? 'running' : s.status;
  const tokens = s.usage.inputTokens + s.usage.outputTokens;
  return (
    <section className={`orq-done is-${status}`} aria-label={running ? t('rmodal.live') : t('rmodal.done')}>
      <span className="orq-done__icon" aria-hidden="true">
        {status === 'succeeded' ? <CheckCircle2 size={20} /> : status === 'running' ? <Loader2 size={20} className="orq-spin" /> : <XCircle size={20} />}
      </span>
      <div className="orq-done__text">
        <strong>{s.headline}</strong>
        <span className="orq-mono">
          {formatDuration(s.durationSec)} · {tokens.toLocaleString('es-ES')} tokens · {money(s.usage.costUsd)}
          {s.files.length > 0 ? ` · ${s.files.length === 1 ? t('rsum.files.one') : t('rsum.files.many', { count: s.files.length })}` : ''}
        </span>
      </div>
      {onOpenRuns && (
        <button type="button" className="orq-btn orq-btn--small" onClick={onOpenRuns}>
          {t('rmodal.toRuns')}
        </button>
      )}
      {onCorrect && !running && (
        <button type="button" className="orq-btn orq-btn--small" onClick={onCorrect}>
          {t('fix.open')}
        </button>
      )}
      <button type="button" className="orq-btn orq-btn--small orq-btn--primary" onClick={onSummary}>
        {t('rmodal.open')}
      </button>
      {onClose && (
        <button type="button" className="orq-ib" aria-label={t('rmodal.dismiss')} title={t('rmodal.dismiss')} onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </section>
  );
}
