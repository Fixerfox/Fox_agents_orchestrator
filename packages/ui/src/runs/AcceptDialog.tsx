import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { t, type ProjectApi } from '@orquestador/editor';

/** «Dar por bueno» una ejecución fallida: pide el motivo y la marca aceptada por ti [R65.8]. */
export function AcceptDialog({ api, runId, onClose, onAccepted }: { api: ProjectApi; runId: string; onClose: () => void; onAccepted: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const confirm = async () => {
    if (!reason.trim()) return setError(t('accept.need'));
    setBusy(true);
    const r = await api.acceptRun({ runId, by: 'user', reason: reason.trim() });
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    onAccepted();
  };
  return (
    <div
      className="orq-modal orq-modal--center"
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
      <div className="orq-picker orq-accept" role="dialog" aria-modal="true" aria-label={t('accept.title')}>
        <header className="orq-picker__head">
          <h2>{t('accept.title')}</h2>
          <button type="button" className="orq-icon-btn" aria-label={t('picker.close')} title={t('picker.close')} onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <label className="orq-field">
          {t('accept.why')}
          <textarea ref={ref} rows={4} maxLength={2000} placeholder={t('accept.why.ph')} value={reason} onChange={(e) => (setReason(e.target.value), setError(undefined))} />
        </label>
        {error && (
          <p className="orq-field__error" role="alert">
            {error}
          </p>
        )}
        <p className="orq-hint">{t('accept.hint')}</p>
        <div className="orq-accept__actions">
          <button type="button" className="orq-btn" onClick={onClose}>
            {t('accept.cancel')}
          </button>
          <button type="button" className="orq-btn orq-btn--primary" disabled={busy} onClick={() => void confirm()}>
            {t('accept.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
