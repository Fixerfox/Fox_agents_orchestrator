import { useCallback, useEffect, useState } from 'react';
import { t, type GitIgnoreMode, type GitIgnoreView, type ProjectApi, type WorkFolderView } from '@orquestador/editor';

/** Aviso de un proyecto antiguo con dos carpetas y el botón para unirlas [R96.8]. */
export function SeparateFolderNotice({ api, folder, onJoined }: { api: ProjectApi; folder: WorkFolderView; onJoined: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (!folder.separate) return null;
  const join = async () => {
    setBusy(true);
    setError(undefined);
    const r = await api.joinWorkFolder();
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    onJoined();
  };
  return (
    <div className="orq-notice orq-notice--warn orq-separate" role="note" aria-label={t('work.separate.title')}>
      <div>
        <strong>{t('work.separate.title')}</strong>
        <p className="orq-hint">{t('work.separate.text', { name: folder.name })}</p>
        {error && (
          <p className="orq-field__error" role="alert">
            {error}
          </p>
        )}
      </div>
      <button type="button" className="orq-btn orq-btn--accent" disabled={busy} onClick={() => void join()}>
        {busy ? t('work.separate.joining') : t('work.separate.join', { name: folder.name })}
      </button>
    </div>
  );
}

const MODES: GitIgnoreMode[] = ['shared', 'all'];

/** «Orquestador y git»: compartir la configuración o no subir nada; solo si la carpeta usa git [R96.13]. */
export function GitIgnoreOption({ api }: { api: ProjectApi }) {
  const [view, setView] = useState<GitIgnoreView>();
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    const r = await api.getGitIgnore();
    setView(r.ok ? r.value : undefined);
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!view?.available) return null;
  const pick = async (mode: GitIgnoreMode) => {
    setError(undefined);
    const r = await api.setGitIgnore(mode);
    if (r.ok) setView(r.value);
    else setError(r.error.message);
  };
  return (
    <fieldset className="orq-gitopt">
      <legend>{t('work.git.title')}</legend>
      {MODES.map((mode) => (
        <label key={mode} className={`orq-gitopt__item${view.mode === mode ? ' is-on' : ''}`}>
          <input type="radio" name="orq-gitignore" checked={view.mode === mode} onChange={() => void pick(mode)} />
          <span>
            <strong>{t(`work.git.${mode}`)}</strong>
            <span className="orq-hint">{t(`work.git.${mode}.hint`)}</span>
          </span>
        </label>
      ))}
      {view.mode === 'shared' && !view.exists && <p className="orq-hint">{t('work.git.create')}</p>}
      {view.mode === 'all' && <p className="orq-hint">{t('work.git.tracked')}</p>}
      {error && (
        <p className="orq-field__error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
