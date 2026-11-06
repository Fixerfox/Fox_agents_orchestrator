import { useState, useCallback, useEffect } from 'react';
import { FilePlus2, FolderPlus, FileText, AlertTriangle, Eye, Copy, Trash2, X } from 'lucide-react';
import { isScriptPath } from '@orquestador/core';
import { type ProjectApi, t } from '@orquestador/editor';

const SZ = { size: 16, strokeWidth: 1.5, 'aria-hidden': true } as const;

type RefFile = { path: string; size: number };

/** Archivos de referencia de una skill: añadir, ver, copiar la ruta y quitar [R24.9–R24.12]. */
export function SkillRefs({ api, id, saved }: { api: ProjectApi; id: string; saved: boolean }) {
  const [files, setFiles] = useState<RefFile[]>([]);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [asking, setAsking] = useState<string>();
  const [view, setView] = useState<{ path: string; text: string; truncated: boolean }>();
  /** Edición de un archivo de texto: el que se ve o uno nuevo [R32.35]. */
  const [edit, setEdit] = useState<{ path: string; text: string; isNew: boolean }>();
  const [newName, setNewName] = useState<string>();
  const reload = useCallback(async () => {
    const r = await api.skillFiles(id);
    if (r.ok) setFiles(r.value);
  }, [api, id]);
  useEffect(() => {
    if (saved) void reload();
  }, [saved, reload]);

  const add = async (kind: 'files' | 'folder') => {
    setError(undefined);
    setNotice(undefined);
    const res = await api.addSkillFiles({ id, kind });
    if (!res.ok) return setError(res.error.message);
    if (!res.value) return;
    setNotice(
      [t('skill.refs.added', { count: res.value.added.length }), res.value.renamed > 0 ? t('skill.refs.renamed', { count: res.value.renamed }) : '']
        .filter(Boolean)
        .join('. '),
    );
    await reload();
  };
  const show = async (path: string) => {
    setError(undefined);
    const res = await api.readSkillFile({ id, path });
    if (!res.ok) return setError(res.error.message);
    setView({ path, ...res.value });
  };
  const saveText = async () => {
    if (!edit) return;
    setError(undefined);
    const path = edit.path.trim();
    const res = await api.saveSkillFile({ id, path, text: edit.text });
    if (!res.ok) return setError(res.error.message);
    setEdit(undefined);
    setView({ path, text: edit.text, truncated: false });
    setNotice(t('skill.refs.saved', { path }));
    await reload();
  };
  const startNew = () => {
    const name = (newName ?? '').trim().replace(/\\/g, '/');
    if (name === '') return;
    const path = name.includes('/') ? name : `referencias/${name.includes('.') ? name : `${name}.md`}`;
    if (files.some((f) => f.path === path)) return setError(t('skill.refs.exists', { path }));
    setNewName(undefined);
    setView(undefined);
    setEdit({ path, text: '', isNew: true });
  };
  const copy = async (path: string) => {
    try {
      await navigator.clipboard?.writeText(path);
    } catch {
      /* sin portapapeles: el aviso sigue mostrando la ruta */
    }
    setNotice(t('skill.refs.copied', { path }));
  };
  const remove = async (path: string) => {
    setAsking(undefined);
    const res = await api.removeSkillFile({ id, path });
    if (!res.ok) return setError(res.error.message);
    if (view?.path === path) setView(undefined);
    await reload();
  };

  return (
    <fieldset className="orq-field orq-refs">
      <legend>{t('skill.refs')}</legend>
      {!saved ? (
        <p className="orq-hint">{t('skill.refs.save.first')}</p>
      ) : (
        <>
          <div className="orq-form__actions">
            <button type="button" className="orq-btn" onClick={() => void add('files')}>
              <FilePlus2 {...SZ} />
              {t('skill.refs.add.files')}
            </button>
            <button type="button" className="orq-btn" onClick={() => void add('folder')}>
              <FolderPlus {...SZ} />
              {t('skill.refs.add.folder')}
            </button>
            <button type="button" className="orq-btn" onClick={() => setNewName('')}>
              <FileText {...SZ} />
              {t('skill.refs.new')}
            </button>
          </div>
          {newName !== undefined && (
            <div className="orq-refs__new">
              <label htmlFor={`skill-new-file-${id}`}>{t('skill.refs.new.name')}</label>
              <input
                id={`skill-new-file-${id}`}
                value={newName}
                placeholder="guia-de-estilo.md"
                autoFocus
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    startNew();
                  } else if (e.key === 'Escape') setNewName(undefined);
                }}
              />
              <button type="button" className="orq-btn orq-btn--small orq-btn--primary" onClick={startNew}>
                {t('skill.refs.new.create')}
              </button>
              <button type="button" className="orq-btn orq-btn--small" onClick={() => setNewName(undefined)}>
                {t('form.cancel')}
              </button>
            </div>
          )}
          {files.length === 0 ? (
            <p className="orq-hint">{t('skill.refs.none')}</p>
          ) : (
            <ul className="orq-files">
              {files.map((f) => (
                <li key={f.path}>
                  <code>{f.path}</code>
                  {isScriptPath(f.path) && (
                    <span className="orq-files__script" title={t('skill.refs.script')}>
                      <AlertTriangle size={14} strokeWidth={1.5} aria-hidden="true" />
                      {t('skill.refs.script')}
                    </span>
                  )}
                  <span>{f.size} B</span>
                  {asking === f.path ? (
                    <span className="orq-files__ask" role="alertdialog" aria-label={t('skill.refs.remove.ask', { path: f.path })}>
                      {t('skill.refs.remove.ask', { path: f.path })}
                      <button type="button" className="orq-btn orq-btn--danger" onClick={() => void remove(f.path)}>
                        {t('skill.refs.remove.yes')}
                      </button>
                      <button type="button" className="orq-btn" onClick={() => setAsking(undefined)}>
                        {t('form.cancel')}
                      </button>
                    </span>
                  ) : (
                    <span className="orq-files__acts">
                      <button type="button" className="orq-icon-btn" aria-label={t('skill.refs.view', { path: f.path })} title={t('skill.refs.view', { path: f.path })} onClick={() => void show(f.path)}>
                        <Eye {...SZ} />
                      </button>
                      <button type="button" className="orq-icon-btn" aria-label={t('skill.refs.copy', { path: f.path })} title={t('skill.refs.copy', { path: f.path })} onClick={() => void copy(f.path)}>
                        <Copy {...SZ} />
                      </button>
                      <button type="button" className="orq-icon-btn" aria-label={t('skill.refs.remove', { path: f.path })} title={t('skill.refs.remove', { path: f.path })} onClick={() => setAsking(f.path)}>
                        <Trash2 {...SZ} />
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="orq-hint">{t('skill.refs.hint')}</p>
          {notice && (
            <p className="orq-hint" role="status">
              {notice}
            </p>
          )}
          {error && (
            <p className="orq-field__error" role="alert">
              {error}
            </p>
          )}
          {view && (
            <div className="orq-viewer">
              <div className="orq-viewer__head">
                <code>{view.path}</code>
                <button type="button" className="orq-icon-btn" aria-label={t('skill.refs.viewer.close')} title={t('skill.refs.viewer.close')} onClick={() => setView(undefined)}>
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
              <pre>{view.text}</pre>
              {view.truncated ? (
                <p className="orq-hint">{t('skill.refs.truncated')}</p>
              ) : (
                <button type="button" className="orq-btn orq-btn--small" onClick={() => setEdit({ path: view.path, text: view.text, isNew: false })}>
                  {t('skill.refs.edit')}
                </button>
              )}
            </div>
          )}
          {edit && (
            <div className="orq-viewer orq-viewer--edit">
              <div className="orq-viewer__head">
                <code>{edit.path}</code>
                {edit.isNew && <span className="orq-tag is-new">{t('runs.changes.new')}</span>}
              </div>
              <textarea
                aria-label={t('skill.refs.editing', { path: edit.path })}
                rows={14}
                value={edit.text}
                maxLength={200_000}
                autoFocus
                onChange={(e) => setEdit({ ...edit, text: e.target.value })}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                    e.preventDefault();
                    e.stopPropagation();
                    void saveText();
                  }
                }}
              />
              <div className="orq-form__actions">
                <button type="button" className="orq-btn orq-btn--primary" onClick={() => void saveText()}>
                  {t('skill.refs.save')}
                </button>
                <button type="button" className="orq-btn" onClick={() => setEdit(undefined)}>
                  {t('form.cancel')}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </fieldset>
  );
}
