import { useMemo, useState } from 'react';
import { Loader2, Wrench, X } from 'lucide-react';
import { CORRECTABLE_KINDS, correctionPlan, downstreamOf, flowOrder, forwardEdges, type Diagram, type RunEvent } from '@orquestador/core';
import { t, type CorrectionProposal, type ProjectApi } from '@orquestador/editor';

/** Pasos del nivel principal que aparecen en «Qué pasará»: los que trabajan. */
const SHOWN = new Set([...CORRECTABLE_KINDS, 'review', 'router']);

export type FixState = 'reused' | 'target' | 'redo';

/** Qué pasará con cada paso si se corrige `targetId`: se reutiliza, recibe la corrección o se repite [R53.13]. */
export function correctionPreview(diagram: Diagram, events: readonly RunEvent[], targetId: string): { nodeId: string; label: string; state: FixState }[] {
  const plan = correctionPlan(diagram, events, targetId);
  const after = downstreamOf(forwardEdges(diagram), targetId);
  const byId = new Map(diagram.nodes.map((n) => [n.id, n]));
  const out: { nodeId: string; label: string; state: FixState }[] = [];
  for (const id of flowOrder(diagram)) {
    const n = byId.get(id);
    if (!n || !SHOWN.has(n.kind)) continue;
    const state: FixState | undefined = id === targetId ? 'target' : after.has(id) ? 'redo' : plan.outputs[id] ? 'reused' : undefined;
    if (state) out.push({ nodeId: id, label: n.label ?? n.agentId ?? id, state });
  }
  return out;
}

interface Props {
  api: ProjectApi;
  runId: string;
  diagram: Diagram;
  events: readonly RunEvent[];
  /** Paso desde el que se abrió: es la propuesta sin preguntar a Claude [R53.10]. */
  prefer?: string | undefined;
  onClose: () => void;
  /** Abre la ejecución nueva. */
  onOpen: (runId: string) => void;
}

/**
 * Ventana «Pedir corrección»: qué está mal, a qué paso volver (propuesta del asistente u otro), qué se reutiliza y qué
 * se repite, y «Corregir», que crea una ejecución nueva enlazada [R53.13].
 */
export function CorrectionDialog({ api, runId, diagram, events, prefer, onClose, onOpen }: Props) {
  const [text, setText] = useState('');
  const [proposal, setProposal] = useState<CorrectionProposal>();
  const [chosen, setChosen] = useState<string>();
  const [busy, setBusy] = useState<'propose' | 'correct'>();
  const [error, setError] = useState<string>();
  const preview = useMemo(() => (chosen ? correctionPreview(diagram, events, chosen) : []), [diagram, events, chosen]);
  const reused = preview.filter((s) => s.state === 'reused').length;
  const redo = preview.length - reused;

  const propose = async () => {
    if (!text.trim()) return;
    setBusy('propose');
    setError(undefined);
    const r = await api.proposeCorrection({ runId, text: text.trim(), ...(prefer ? { prefer } : {}) });
    setBusy(undefined);
    if (!r.ok) return setError(r.error.message);
    setProposal(r.value);
    setChosen(r.value.proposal.nodeId);
  };
  const correct = async () => {
    if (!chosen || !text.trim()) return;
    setBusy('correct');
    setError(undefined);
    const r = await api.correctRun({ runId, text: text.trim(), nodeId: chosen });
    setBusy(undefined);
    if (!r.ok) return setError(r.error.message);
    onOpen(r.value.runId);
  };
  // El orden de las opciones: la propuesta primero y después el resto en orden del flujo.
  const options = proposal ? [...proposal.candidates.filter((c) => c.nodeId === proposal.proposal.nodeId), ...proposal.candidates.filter((c) => c.nodeId !== proposal.proposal.nodeId)] : [];
  const title = t('fix.title', { name: diagram.name });

  return (
    <div
      className="orq-modal orq-rundlg-veil"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="orq-rundlg orq-fixdlg"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <header className="orq-rundlg__head">
          <div className="orq-fixdlg__titles">
            <h2>{title}</h2>
            <p className="orq-hint">{t('fix.hint')}</p>
          </div>
          <button type="button" className="orq-icon-btn" aria-label={t('picker.close')} title={t('picker.close')} onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="orq-fixdlg__body">
          <label className="orq-fixdlg__what">
            {t('fix.what')}
            <textarea
              rows={3}
              value={text}
              autoFocus
              placeholder={t('fix.what.ph')}
              onChange={(e) => {
                setText(e.target.value);
                setProposal(undefined);
                setChosen(undefined);
              }}
            />
          </label>
          {!proposal && (
            <button type="button" className="orq-btn orq-btn--primary orq-fixdlg__propose" disabled={!text.trim() || busy !== undefined} onClick={() => void propose()}>
              {busy === 'propose' ? <Loader2 size={14} className="orq-spin" aria-hidden="true" /> : null}
              {busy === 'propose' ? t('fix.proposing') : t('fix.propose')}
            </button>
          )}
          {proposal && (
            <fieldset className="orq-fixdlg__choices">
              <legend>{t('fix.pick')}</legend>
              {options.map((c) => {
                const recommended = c.nodeId === proposal.proposal.nodeId;
                return (
                  <label key={c.nodeId} className={`orq-fixdlg__choice${chosen === c.nodeId ? ' is-on' : ''}`}>
                    <input type="radio" name="fix-target" checked={chosen === c.nodeId} onChange={() => setChosen(c.nodeId)} />
                    <span>
                      <strong>{c.label}</strong>
                      {recommended && <span className="orq-fixdlg__rec">{t('fix.recommended')}</span>}
                      {recommended && proposal.proposal.reason && <span className="orq-hint orq-fixdlg__why">{proposal.proposal.reason}</span>}
                    </span>
                  </label>
                );
              })}
            </fieldset>
          )}
          {preview.length > 0 && (
            <section className="orq-fixdlg__plan" aria-label={t('fix.plan')}>
              <h3>{t('fix.plan')}</h3>
              <ol className="orq-fixdlg__flow">
                {preview.map((s) => (
                  <li key={s.nodeId} className={`orq-fixdlg__step is-${s.state}`}>
                    <span>{s.label}</span>
                    <span className="orq-fixdlg__state">{t(`fix.state.${s.state}`)}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {error && (
            <p className="orq-field__error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="orq-rundlg__foot orq-fixdlg__foot">
          {preview.length > 0 && <span className="orq-mono orq-hint">{t('fix.count', { redo, reused })}</span>}
          <span className="orq-grow" />
          <button type="button" className="orq-btn" onClick={onClose}>
            {t('runs.cancel')}
          </button>
          <button type="button" className="orq-btn orq-btn--primary" disabled={!chosen || !text.trim() || busy !== undefined} onClick={() => void correct()}>
            {busy === 'correct' ? <Loader2 size={14} className="orq-spin" aria-hidden="true" /> : <Wrench size={14} aria-hidden="true" />}
            {t('fix.go')}
          </button>
        </footer>
      </div>
    </div>
  );
}
