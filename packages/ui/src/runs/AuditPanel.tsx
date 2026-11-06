import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import type { RunEvent } from '@orquestador/core';
import { AUDIT_EFFECT_LABEL, auditCounts, auditEntries, auditReport, t, type AuditEffect, type AuditGroup, type AuditReportInfo, type MessageKey } from '@orquestador/editor';
import { downloadText } from '../common';

type Labeler = (nodeId: string, nodePath?: readonly string[]) => string;
const GROUPS: ('all' | AuditGroup)[] = ['all', 'answer', 'permission', 'confirm', 'control'];
const TONE: Partial<Record<AuditEffect, string>> = { allowed: 'pos', 'allowed-run': 'pos', approved: 'pos', resumed: 'pos', denied: 'neg', cancelled: 'neg', changes: 'warn', paused: 'warn', budget: 'warn', unanswered: 'warn' };
const clock = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/**
 * Pestaña «Auditoría»: las decisiones del usuario en la ejecución, filtrables por grupo, con el informe Markdown y
 * el JSON para exportar [R45.13].
 */
export function AuditPanel({ runId, events, labelOf, info, onDownload = downloadText }: { runId: string; events: readonly RunEvent[]; labelOf: Labeler; info: Omit<AuditReportInfo, 'labelOf'>; onDownload?: (name: string, text: string, type?: string) => void }) {
  const entries = useMemo(() => auditEntries(events), [events]);
  const counts = auditCounts(entries);
  const [group, setGroup] = useState<'all' | AuditGroup>('all');
  const shown = group === 'all' ? entries : entries.filter((e) => e.group === group);
  return (
    <section className="orq-audit" aria-label={t('audit.title')}>
      <div className="orq-audit__bar">
        <div className="orq-audit__chips" role="group" aria-label={t('audit.groups')}>
          {GROUPS.map((g) => (
            <button key={g} type="button" aria-pressed={group === g} className={`orq-achip${group === g ? ' is-on' : ''}`} onClick={() => setGroup(g)}>
              {t(`audit.group.${g}` as MessageKey, { n: counts[g] })}
            </button>
          ))}
        </div>
        <span className="orq-audit__grow" />
        <button type="button" className="orq-btn orq-btn--small" onClick={() => onDownload(`auditoria-${runId}.md`, auditReport(events, { ...info, labelOf: (id, p) => labelOf(id, p) }), 'text/markdown')}>
          <Download size={13} aria-hidden="true" />
          {t('audit.export.md')}
        </button>
        <button type="button" className="orq-btn orq-btn--small" onClick={() => onDownload(`auditoria-${runId}.json`, `${JSON.stringify({ runId, entries }, null, 2)}\n`, 'application/json')}>
          <Download size={13} aria-hidden="true" />
          {t('audit.export.json')}
        </button>
      </div>
      {shown.length === 0 ? (
        <p className="orq-hint">{entries.length === 0 ? t('audit.none') : t('audit.noneFiltered')}</p>
      ) : (
        <div className="orq-audit__scroll">
          <table className="orq-audit__table">
            <thead>
              <tr>
                <th scope="col">{t('audit.col.time')}</th>
                <th scope="col">{t('audit.col.who')}</th>
                <th scope="col">{t('audit.col.step')}</th>
                <th scope="col">{t('audit.col.what')}</th>
                <th scope="col">{t('audit.col.answer')}</th>
                <th scope="col">{t('audit.col.effect')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.seq}>
                  <td className="orq-mono">{clock(e.ts)}</td>
                  <td className="orq-audit__who">{e.effect === 'budget' ? '—' : t('audit.you')}</td>
                  <td>{e.nodeId ? labelOf(e.nodeId, e.nodePath) : '—'}</td>
                  <td className="orq-audit__what">{e.asked}</td>
                  <td>{e.answer || '—'}</td>
                  <td>
                    <span className={`orq-effect is-${TONE[e.effect] ?? 'plain'}`}>{AUDIT_EFFECT_LABEL[e.effect]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="orq-hint">{t('audit.hint')}</p>
    </section>
  );
}
