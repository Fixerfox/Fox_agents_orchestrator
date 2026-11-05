import { useCallback, useEffect, useRef, useState } from 'react';
import { FolderGit2, FolderOpen, LayoutTemplate, Plus, Settings, Workflow, X } from 'lucide-react';
import type { RecentView } from '@orquestador/core';
import { t, type ProjectApi } from '@orquestador/editor';

const SZ = { size: 16, strokeWidth: 1.5, 'aria-hidden': true } as const;

function openedLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = (x: Date) => Math.floor(new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime() / 86_400_000);
  const diff = day(now) - day(d);
  if (diff === 0) return t('start.opened.today');
  if (diff === 1) return t('start.opened.yesterday');
  return t('start.opened.on', { date: d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' }) });
}

export type StartPath = 'empty' | 'template' | 'folder';

interface Props {
  api: ProjectApi;
  /** Se llama con el nombre cuando un proyecto queda abierto y el camino elegido [R32.24]. */
  onOpened: (name: string, path?: StartPath) => void;
  onSettings: () => void;
  /** Motor activo, para mostrarlo también aquí. */
  engine?: 'simulated' | 'claude' | undefined;
}

/** Pantalla previa sin proyecto: crear, abrir o retomar uno reciente [R28.1]. */
export function StartScreen({ api, onOpened, onSettings, engine }: Props) {
  const [recent, setRecent] = useState<RecentView[]>();
  const [error, setError] = useState<string>();
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const first = useRef<HTMLButtonElement>(null);

  const reload = useCallback(async () => {
    const r = await api.listRecent();
    setRecent(r.ok ? r.value : []);
  }, [api]);
  useEffect(() => void reload(), [reload]);
  useEffect(() => first.current?.focus(), []);

  const pick = async (kind: 'create' | 'open', path: StartPath = 'empty') => {
    setError(undefined);
    const res = await (kind === 'create' ? api.createProject() : api.openProject());
    if (!res.ok) return setError(t('start.error', { message: res.error.message }));
    if (res.value) onOpened(res.value.name, kind === 'create' ? path : undefined);
  };
  const openRecent = async (r: RecentView) => {
    setError(undefined);
    const res = await api.openRecent({ id: r.id });
    if (res.ok) return onOpened(res.value.name);
    setRowError((m) => ({ ...m, [r.id]: res.error.message }));
    void reload(); // la carpeta puede haber desaparecido: se actualiza el aviso
  };
  const forget = async (r: RecentView) => {
    const res = await api.forgetRecent(r.id);
    if (!res.ok) return setError(t('start.error', { message: res.error.message }));
    setRowError(({ [r.id]: _gone, ...rest }) => (void _gone, rest));
    await reload();
  };

  return (
    <main className="orq-start" aria-label={t('start.title')}>
      <header className="orq-start__top">
        <strong className="orq-brand">
          <Workflow size={20} strokeWidth={1.8} aria-hidden="true" />
          {t('app.title')}
        </strong>
        <span className="orq-topbar__gap" />
        {engine && <span className={`orq-engine is-${engine}`}>{t(engine === 'claude' ? 'engine.claude' : 'engine.simulated')}</span>}
        <button type="button" className="orq-ib" aria-label={t('settings.open')} title={t('settings.open')} onClick={onSettings}>
          <Settings {...SZ} />
        </button>
      </header>
      <div className="orq-start__body">
        <section className="orq-start__hero">
          <h1>{t('start.q')}</h1>
          <p className="orq-hint">{t('start.q.hint')}</p>
        </section>
        <div className="orq-start__cards">
          <button ref={first} type="button" className="orq-startcard is-primary" aria-label={t('project.create')} aria-describedby="start-c1" onClick={() => void pick('create', 'empty')}>
            <span className="orq-startcard__ico" aria-hidden="true">
              <Plus size={20} strokeWidth={1.6} />
            </span>
            <strong>{t('project.create')}</strong>
            <span className="orq-hint" id="start-c1">{t('start.card.empty')}</span>
          </button>
          <button type="button" className="orq-startcard" aria-label={t('start.card.template')} aria-describedby="start-c2" onClick={() => void pick('create', 'template')}>
            <span className="orq-startcard__ico" aria-hidden="true">
              <LayoutTemplate size={20} strokeWidth={1.6} />
            </span>
            <strong>{t('start.card.template')}</strong>
            <span className="orq-hint" id="start-c2">{t('start.card.template.hint')}</span>
          </button>
          <button type="button" className="orq-startcard" aria-label={t('start.card.folder')} aria-describedby="start-c3" onClick={() => void pick('create', 'folder')}>
            <span className="orq-startcard__ico" aria-hidden="true">
              <FolderGit2 size={20} strokeWidth={1.6} />
            </span>
            <strong>{t('start.card.folder')}</strong>
            <span className="orq-hint" id="start-c3">{t('start.card.folder.hint')}</span>
          </button>
        </div>
        {error && (
          <p className="orq-field__error" role="alert">
            {error}
          </p>
        )}
        <section className="orq-start__recent" aria-labelledby="start-recent">
          <div className="orq-start__recenthead">
            <h2 id="start-recent">{t('start.recent')}</h2>
            <button type="button" className="orq-btn orq-btn--ghost" onClick={() => void pick('open')}>
              <FolderOpen {...SZ} />
              {t('project.open')}
            </button>
          </div>
          {recent === undefined ? null : recent.length === 0 ? (
            <p className="orq-hint">{t('start.recent.empty')}</p>
          ) : (
            <div className="orq-start__table">
              <div className="orq-start__thead orq-hint" aria-hidden="true">
                <span>{t('start.recent.col.name')}</span>
                <span>{t('start.recent.col.folder')}</span>
                <span>{t('start.recent.col.when')}</span>
                <span />
              </div>
              <ul className="orq-start__list">
                {recent.map((r) => (
                  <li key={r.id} className={r.missing || rowError[r.id] ? 'is-missing' : undefined}>
                    <button type="button" className="orq-start__open" disabled={r.missing} aria-label={t('start.open.recent', { name: r.name })} onClick={() => void openRecent(r)}>
                      <span className="orq-start__name">{r.name}</span>
                      <span className="orq-hint">{r.missing ? t('start.missing') : r.folder}</span>
                      <span className="orq-hint orq-start__when">{openedLabel(r.openedAt)}</span>
                    </button>
                    <button type="button" className="orq-icon-btn" aria-label={t('start.forget', { name: r.name })} title={t('start.forget', { name: r.name })} onClick={() => void forget(r)}>
                      <X size={16} aria-hidden="true" />
                    </button>
                    {rowError[r.id] && (
                      <p className="orq-field__error orq-start__rowerr" role="alert">
                        {rowError[r.id]}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
