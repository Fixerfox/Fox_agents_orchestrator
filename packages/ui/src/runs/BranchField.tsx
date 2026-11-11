import { GitBranch } from 'lucide-react';
import { FROM_HERE, branchGuard, guardBases, guardNotices, hardBlock, isProtectedBranch, type GitChoice } from '@orquestador/core';
import { t, type GitGuardView } from '@orquestador/editor';

/** Lo que se va eligiendo en el campo «Rama» [R97.3]. */
export interface BranchPick {
  mode: 'stay' | 'new';
  name: string;
  from: string;
  changes?: 'carry' | 'stash';
}

/** Con qué empieza el campo: en una rama protegida, «Rama nueva» desde aquí; en las demás, seguir [R97.4]. */
export function initialPick(view: GitGuardView): BranchPick {
  const branch = view.state.branch;
  const fresh = branch !== undefined && isProtectedBranch(branch) && view.otherRuns === 0;
  return { mode: fresh ? 'new' : 'stay', name: view.suggested, from: FROM_HERE };
}

export const choiceOf = (pick: BranchPick): GitChoice => (pick.mode === 'stay' ? { mode: 'stay' } : { mode: 'new', name: pick.name.trim(), from: pick.from, ...(pick.changes ? { changes: pick.changes } : {}) });

/** Motivo por el que no se puede lanzar con esa elección; `undefined` si se puede o no hay repositorio [R97.6]. */
export function pickProblem(view: GitGuardView, pick: BranchPick, label: string): string | undefined {
  const verdict = branchGuard(view.state, choiceOf(pick), { otherRuns: view.otherRuns, explicit: true, label });
  return verdict && !verdict.ok ? verdict.problem.message : undefined;
}

/** Campo «Rama» del diálogo «Ejecutar»: seguir en la actual o crear una para esta ejecución [R97.3]. */
export function BranchField({ view, pick, label, onChange }: { view: GitGuardView; pick: BranchPick; label: string; onChange: (pick: BranchPick) => void }) {
  const { state } = view;
  if (!state.repo) return null;
  const hard = hardBlock(state);
  if (hard)
    return (
      <fieldset className="orq-rundlg__busy orq-rundlg__git">
        <legend>
          <GitBranch size={14} aria-hidden="true" /> {t('rundlg.git')}
        </legend>
        <p className="orq-field__error" role="alert">
          {hard.message}
        </p>
      </fieldset>
    );
  const current = state.branch!;
  const isProtected = isProtectedBranch(current);
  const bases = guardBases(state);
  const fromBase = pick.mode === 'new' && pick.from !== FROM_HERE;
  const problem = pickProblem(view, pick, label);
  const notices = guardNotices(state, choiceOf(pick));
  return (
    <fieldset className="orq-rundlg__busy orq-rundlg__git">
      <legend>
        <GitBranch size={14} aria-hidden="true" /> {t('rundlg.git')}
      </legend>
      {isProtected && <p className="orq-hint">{t('rundlg.git.protected', { branch: current })}</p>}
      <label className={`orq-radiocard${pick.mode === 'stay' ? ' is-on' : ''}`}>
        <input type="radio" name="run-git" checked={pick.mode === 'stay'} onChange={() => onChange({ ...pick, mode: 'stay' })} />
        <span>
          <strong>{t('rundlg.git.stay', { branch: current })}</strong>
          <span className="orq-hint">{t(isProtected ? 'rundlg.git.stay.protected' : 'rundlg.git.stay.hint')}</span>
        </span>
      </label>
      <label className={`orq-radiocard${pick.mode === 'new' ? ' is-on' : ''}`}>
        <input type="radio" name="run-git" checked={pick.mode === 'new'} disabled={view.otherRuns > 0} onChange={() => onChange({ ...pick, mode: 'new' })} />
        <span>
          <strong>{t('rundlg.git.new')}</strong>
          <span className="orq-hint">{t(view.otherRuns > 0 ? 'rundlg.git.new.busy' : 'rundlg.git.new.hint')}</span>
        </span>
      </label>
      {pick.mode === 'new' && (
        <div className="orq-rundlg__gitnew">
          <label className="orq-field">
            <span>{t('rundlg.git.name')}</span>
            <input type="text" value={pick.name} spellCheck={false} onChange={(e) => onChange({ ...pick, name: e.target.value })} />
          </label>
          <label className="orq-field">
            <span>{t('rundlg.git.from')}</span>
            <select
              aria-label={t('rundlg.git.from')}
              value={pick.from}
              onChange={(e) => {
                const from = e.target.value;
                const { changes: _c, ...rest } = pick;
                void _c;
                onChange({ ...rest, from, ...(from !== FROM_HERE && state.dirty > 0 ? { changes: pick.changes ?? 'carry' } : {}) });
              }}
            >
              <option value={FROM_HERE}>{t('rundlg.git.from.here', { branch: current })}</option>
              {bases.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
          {fromBase && state.dirty > 0 && (
            <fieldset className="orq-rundlg__gitchanges">
              <legend>{t('rundlg.git.changes', { n: state.dirty })}</legend>
              {(['carry', 'stash'] as const).map((m) => (
                <label key={m}>
                  <input type="radio" name="run-git-changes" checked={(pick.changes ?? 'carry') === m} onChange={() => onChange({ ...pick, changes: m })} />
                  {t(`rundlg.git.changes.${m}`)}
                </label>
              ))}
            </fieldset>
          )}
        </div>
      )}
      {notices.map((n) => (
        <p key={n} className="orq-hint" role="note">
          {n}
        </p>
      ))}
      {problem && (
        <p className="orq-field__error" role="alert">
          {problem}
        </p>
      )}
    </fieldset>
  );
}
