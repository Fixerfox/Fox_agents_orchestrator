import { useEffect, useRef } from 'react';
import { ShieldAlert } from 'lucide-react';
import { MODELS } from '@orquestador/core';
import { t, type MessageKey, type RunSummaryView, type SupervisorAlertItem } from '@orquestador/editor';
import { money } from './runFormat';
import { reviewedText } from './SupervisorOverlay';
import { MemoryCards } from './MemoryCards';

type Watch = NonNullable<RunSummaryView['supervisor']>;

const RULES: Readonly<Record<string, { title: MessageKey; why: MessageKey }>> = {
  'undeclared-file': { title: 'sup.rule.undeclared-file', why: 'sup.rule.undeclared-file.why' },
  'empty-output': { title: 'sup.rule.empty-output', why: 'sup.rule.empty-output.why' },
  'unexpected-branch': { title: 'sup.rule.unexpected-branch', why: 'sup.rule.unexpected-branch.why' },
  'retry-loop': { title: 'sup.rule.retry-loop', why: 'sup.rule.retry-loop.why' },
  'budget-burn': { title: 'sup.rule.budget-burn', why: 'sup.rule.budget-burn.why' },
  'out-of-scope': { title: 'sup.rule.out-of-scope', why: 'sup.rule.out-of-scope.why' },
  'ai-review': { title: 'sup.rule.ai-review', why: 'sup.rule.ai-review.why' },
  unchecked: { title: 'sup.rule.unchecked', why: 'sup.rule.unchecked.why' },
  'requirements-unmet': { title: 'sup.rule.requirements-unmet', why: 'sup.rule.requirements-unmet.why' },
  'needs-person': { title: 'sup.rule.needs-person', why: 'sup.rule.needs-person.why' },
};

/** Lo que pasó, en una frase que se entiende sin conocer la regla [R60.39]. */
export const ruleTitle = (rule: string | undefined): string => t(RULES[rule ?? '']?.title ?? 'sup.rule.other');

const clock = (at: string): string => new Date(at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

export function SupervisorBalance({ watch }: { watch: Watch }) {
  const { balance } = watch;
  if (!balance) return null;
  const model = balance.model ? ` · ${MODELS.find((m) => m.id === balance.model)?.name ?? balance.model}` : '';
  return <p className="orq-hint">{`${reviewedText(balance.reviewed)} · ${money(balance.costUsd)}${model}`}</p>;
}

/** Si el resultado cumple lo pedido [R62.13]. */
export function SupervisorFinal({ watch }: { watch: Watch }) {
  if (!watch.final) return null;
  return (
    <>
      <p className={`orq-supfinal${watch.final.met ? '' : ' is-bad'}`}>{t(watch.final.met ? 'sup.final.ok' : 'sup.final.bad')}</p>
      {/* Lo que queda para una persona [R65.4]. */}
      {watch.final.forPerson && <p className="orq-supfinal is-warn">{t('sup.final.person', { detail: watch.final.forPerson })}</p>}
    </>
  );
}

export function SupervisorMemoryList({ watch }: { watch: Watch }) {
  if (watch.notes.length === 0 && !watch.branch) return null;
  return (
    <>
      <h3>{t('rsum.sup.memory')}</h3>
      <MemoryCards notes={watch.notes} branch={watch.branch} warned={new Set(watch.alerts.map((a) => a.label))} />
    </>
  );
}

/** Pestaña «Supervisor»: sus avisos, que se abren al pulsarlos, y lo demás que hizo [R60.38][R60.39]. */
export function SupervisorPanel({ watch, alerts, focus, onPick }: { watch: Watch; alerts: readonly SupervisorAlertItem[]; focus?: string | undefined; onPick: (key: string) => void }) {
  const focused = useRef<HTMLDetailsElement>(null);
  // Al llegar desde un paso, directo a su aviso [R60.40].
  useEffect(() => focused.current?.scrollIntoView?.({ block: 'nearest' }), [focus]);
  const first = focus === undefined ? -1 : alerts.findIndex((a) => a.key === focus);
  return (
    <div className="orq-rsum__sec orq-suptab">
      <SupervisorBalance watch={watch} />
      <SupervisorFinal watch={watch} />
      <h3>{t('rsum.sup.alerts')}</h3>
      {alerts.length === 0 && <p className="orq-hint">{t('rsum.sup.ok')}</p>}
      {alerts.map((a, i) => (
        <details key={i} ref={i === first ? focused : undefined} className="orq-supalert" open={alerts.length === 1 || (focus !== undefined && a.key === focus)}>
          <summary>
            <ShieldAlert size={16} aria-hidden="true" />
            <strong>{ruleTitle(a.rule)}</strong>
            <span className="orq-hint">{[a.label, clock(a.at)].filter(Boolean).join(' · ')}</span>
          </summary>
          <p>{a.detail}</p>
          <p className="orq-hint">{t(RULES[a.rule]?.why ?? 'sup.rule.other.why')}</p>
          {a.key !== undefined && (
            <button type="button" className="orq-btn orq-btn--small" onClick={() => onPick(a.key!)}>
              {t('sup.alert.step')}
            </button>
          )}
        </details>
      ))}
      {watch.skipped && <p className="orq-hint">{watch.skipped.reason === 'timeout' ? t('rsum.sup.timeout', { count: watch.skipped.count }) : t('rsum.sup.failed')}</p>}
      <SupervisorMemoryList watch={watch} />
    </div>
  );
}
