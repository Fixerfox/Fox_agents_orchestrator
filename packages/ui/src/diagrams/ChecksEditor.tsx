import { useState } from 'react';
import { CHECK_KINDS, checkProblems, type CheckResult, type StepCheck } from '@orquestador/core';
import { t, type MessageKey } from '@orquestador/editor';

/** Una comprobación nueva del tipo elegido, con un id que no choca [R75.1]. */
export function newCheck(kind: StepCheck['kind'], taken: readonly string[]): StepCheck {
  let n = taken.length + 1;
  while (taken.includes(`c${n}`)) n++;
  const id = `c${n}`;
  const label = t(`checks.kind.${kind}` as MessageKey);
  switch (kind) {
    case 'command':
      return { id, label, kind, run: '' };
    case 'files':
      return { id, label, kind, mustExist: [] };
    case 'output':
      return { id, label, kind, contains: '' };
    case 'schema':
      return { id, label, kind, schema: '{"type":"object"}' };
  }
}

const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

/**
 * Comprobaciones de un paso o del diagrama [R75.24]: añadir, ordenar, quitar y «Ejecutar ahora». Un cambio que deja
 * alguna mal escrita no se guarda hasta que está bien; se dice qué falta.
 */
export function ChecksEditor({ checks, onChange, onTry, legend }: { checks: readonly StepCheck[]; onChange: (next: StepCheck[]) => void; onTry?: ((c: StepCheck) => Promise<CheckResult | undefined>) | undefined; legend: string }) {
  const [draft, setDraft] = useState<StepCheck[]>([...checks]);
  const [kind, setKind] = useState<StepCheck['kind']>('command');
  const [tried, setTried] = useState<Record<string, CheckResult>>({});
  const problems = checkProblems(draft);
  const save = (next: StepCheck[]) => {
    setDraft(next);
    if (checkProblems(next).length === 0) onChange(next);
  };
  const edit = (i: number, patch: Partial<StepCheck>) => save(draft.map((c, j) => (j === i ? ({ ...c, ...patch } as StepCheck) : c)));
  const move = (i: number, by: number) => {
    const next = [...draft];
    const [c] = next.splice(i, 1);
    next.splice(Math.max(0, Math.min(next.length, i + by)), 0, c!);
    save(next);
  };
  return (
    <fieldset className="orq-field orq-checks">
      <legend>{legend}</legend>
      {draft.length === 0 && <p className="orq-hint">{t('checks.none')}</p>}
      <ol className="orq-checks__list">
        {draft.map((c, i) => (
          <li key={c.id} className="orq-checks__item" aria-label={c.label}>
            <label className="orq-field">
              <span>{t('checks.label')}</span>
              <input value={c.label} onChange={(e) => edit(i, { label: e.target.value })} />
            </label>
            {c.kind === 'command' && (
              <label className="orq-field">
                <span>{t('checks.run')}</span>
                <input value={c.run} placeholder="npm test" onChange={(e) => edit(i, { run: e.target.value })} />
              </label>
            )}
            {c.kind === 'files' && (
              <>
                <label className="orq-field">
                  <span>{t('checks.mustExist')}</span>
                  <textarea rows={2} value={(c.mustExist ?? []).join('\n')} onChange={(e) => edit(i, { mustExist: lines(e.target.value) })} />
                </label>
                <label className="orq-field">
                  <span>{t('checks.mustChange')}</span>
                  <textarea rows={2} value={(c.mustChange ?? []).join('\n')} onChange={(e) => edit(i, { mustChange: lines(e.target.value) })} />
                </label>
              </>
            )}
            {c.kind === 'output' && (
              <label className="orq-field">
                <span>{t('checks.contains')}</span>
                <input value={c.contains ?? ''} onChange={(e) => edit(i, { contains: e.target.value })} />
              </label>
            )}
            {c.kind === 'schema' && (
              <label className="orq-field">
                <span>{t('checks.schema')}</span>
                <textarea rows={3} value={c.schema} onChange={(e) => edit(i, { schema: e.target.value })} />
              </label>
            )}
            <div className="orq-checks__actions">
              <button type="button" className="orq-btn orq-btn--small orq-btn--ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('checks.up', { name: c.label })}>
                ↑
              </button>
              <button type="button" className="orq-btn orq-btn--small orq-btn--ghost" disabled={i === draft.length - 1} onClick={() => move(i, 1)} aria-label={t('checks.down', { name: c.label })}>
                ↓
              </button>
              {onTry && (
                <button type="button" className="orq-btn orq-btn--small" disabled={checkProblems([c]).length > 0} onClick={() => void onTry(c).then((r) => r && setTried((x) => ({ ...x, [c.id]: r })))}>
                  {t('checks.try')}
                </button>
              )}
              <button type="button" className="orq-btn orq-btn--small orq-btn--ghost" onClick={() => save(draft.filter((_, j) => j !== i))}>
                {t('checks.remove')}
              </button>
            </div>
            {tried[c.id] && (
              <p className={`orq-hint${tried[c.id]!.ok ? '' : ' is-warn'}`} role="status">
                {`${tried[c.id]!.ok ? '✓' : '✗'} ${tried[c.id]!.detail.split('\n').slice(0, 3).join(' ')}`}
              </p>
            )}
          </li>
        ))}
      </ol>
      {problems.length > 0 && (
        <p className="orq-hint is-warn" role="alert">
          {problems[0]}
        </p>
      )}
      <div className="orq-checks__add">
        <select aria-label={t('checks.kind')} value={kind} onChange={(e) => setKind(e.target.value as StepCheck['kind'])}>
          {CHECK_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`checks.kind.${k}` as MessageKey)}
            </option>
          ))}
        </select>
        <button type="button" className="orq-btn orq-btn--small" onClick={() => setDraft([...draft, newCheck(kind, draft.map((c) => c.id))])}>
          {t('checks.add')}
        </button>
      </div>
    </fieldset>
  );
}
