import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { RunEvent } from '@orquestador/core';
import { lineDiff, runFiles, t, type FileKind, type ProjectApi, type RunFile, type RunFileContent, type StepFile } from '@orquestador/editor';
import { Markdown } from '../common/index';

type Labeler = (nodeId: string, nodePath?: readonly string[]) => string;

/** Etiqueta «Nuevo», «Modificado» o «Tocado» (ejecuciones anteriores sin tipo) [R45.9]. */
export function FileTag({ change }: { change: FileKind | undefined }) {
  return <span className={`orq-ftag is-${change ?? 'unknown'}`}>{change === 'created' ? t('files.new') : change === 'modified' ? t('files.mod') : t('files.unknown')}</span>;
}

const clock = (iso: string) => (iso ? new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '');

/**
 * Bloque con los ficheros que tocó un paso. `state` dice si el paso terminó bien (`done`), sigue (`running`) o se
 * quedó sin terminar (`unfinished`) [R45.9].
 */
export function StepFilesBlock({ files, state, onOpen }: { files: readonly StepFile[]; state: 'done' | 'running' | 'unfinished'; onOpen?: ((path: string) => void) | undefined }) {
  if (files.length === 0) return null;
  const created = files.filter((f) => f.change === 'created').length;
  const modified = files.filter((f) => f.change === 'modified').length;
  const title = state === 'done' ? t('files.step') : t('files.sofar');
  return (
    <section className={`orq-sfiles is-${state}`} aria-label={title}>
      <header className="orq-sfiles__head">
        <strong>{title}</strong>
        <span className="orq-hint">{state === 'running' ? t('files.notYet') : state === 'unfinished' ? t('files.unfinished') : t('files.count', { created, modified })}</span>
      </header>
      <ul>
        {files.map((f) => (
          <li key={f.path}>
            <FileTag change={f.change} />
            <span className="orq-sfiles__path orq-mono" title={f.path}>
              {f.path}
            </span>
            <span className="orq-hint orq-mono">{f.passes.length > 1 ? t('files.passes', { passes: f.passes.join(', ') }) : clock(f.lastTs)}</span>
            {onOpen && (
              <button type="button" className="orq-btn orq-btn--small" aria-label={t('files.viewAria', { path: f.path })} onClick={() => onOpen(f.path)}>
                {t('files.view')}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Diferencia por líneas con números; sin copia, todo como añadido [R45.10]. */
function DiffView({ before, after }: { before: string | undefined; after: string }) {
  // Sin el salto final, que daría una línea vacía de más.
  const lines = useMemo(() => lineDiff((before ?? '').replace(/\r?\n$/, ''), after.replace(/\r?\n$/, '')), [before, after]);
  const add = lines.filter((l) => l.kind === 'add').length;
  const del = lines.filter((l) => l.kind === 'del').length;
  let oldN = 0;
  let newN = 0;
  return (
    <div className="orq-fview__diff">
      <p className="orq-hint orq-mono" role="status">
        {before === undefined ? t('fview.noCopy') : add + del === 0 ? t('fview.same') : t('fview.stats', { add, del })}
      </p>
      <ol className="orq-diff" aria-label={t('fview.changes')}>
        {lines.map((l, i) => {
          if (l.kind !== 'add') oldN++;
          if (l.kind !== 'del') newN++;
          return (
            <li key={i} className={`is-${l.kind}`}>
              <span className="orq-diff__n">{l.kind === 'del' ? oldN : newN}</span>
              <span className="orq-diff__sign" aria-hidden="true">
                {l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ''}
              </span>
              <span className="orq-diff__text">{l.text}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * Visor de los ficheros de una ejecución: lista a la izquierda y, del elegido, «Cambios» y «Contenido», con
 * «Restaurar la copia» si la hay. Se cierra con Escape, la ✕ o pulsando fuera [R45.10].
 */
export function FileViewer({ api, runId, events, path: initial, labelOf, onClose }: { api: ProjectApi; runId: string; events: readonly RunEvent[]; path: string; labelOf: Labeler; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [backups, setBackups] = useState<string[]>([]);
  const [path, setPath] = useState(initial);
  const [tab, setTab] = useState<'changes' | 'content'>('changes');
  const [file, setFile] = useState<RunFileContent | { error: string } | undefined>();
  const [restored, setRestored] = useState<Set<string>>(new Set());
  useEffect(() => ref.current?.focus(), []);
  useEffect(() => {
    let alive = true;
    void api.listBackups(runId).then((r) => alive && setBackups(r.ok ? r.value : []));
    return () => {
      alive = false;
    };
  }, [api, runId]);
  const files = useMemo(() => runFiles(events, backups), [events, backups]);
  useEffect(() => {
    let alive = true;
    setFile(undefined);
    void api.readRunFile({ runId, path }).then((r) => alive && setFile(r.ok ? r.value : { error: r.error.message }));
    return () => {
      alive = false;
    };
  }, [api, runId, path, restored]);
  const meta = files.find((f) => f.path === path);
  const who = (f: RunFile) => f.steps.map((s) => labelOf(s.nodeId, s.nodePath)).join(', ');
  const restore = async () => {
    const r = await api.restoreBackup({ runId, path });
    if (r.ok && r.value) setRestored((s) => new Set(s).add(path));
  };
  const loaded = file && !('error' in file) ? file : undefined;
  return (
    <div
      className="orq-modal orq-modal--center orq-fview-veil"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div ref={ref} tabIndex={-1} className="orq-fview" role="dialog" aria-modal="true" aria-label={path}>
        <header className="orq-fview__head">
          <FileTag change={meta?.change} />
          <strong className="orq-mono">{path}</strong>
          {meta && meta.steps.length > 0 && <span className="orq-hint">{t('fview.by', { steps: who(meta) })}</span>}
          <span className="orq-fview__grow" />
          {loaded?.before && (
            <button type="button" className="orq-btn orq-btn--small" disabled={restored.has(path)} onClick={() => void restore()}>
              {restored.has(path) ? t('fview.restored') : t('fview.restore')}
            </button>
          )}
          <button type="button" className="orq-icon-btn" aria-label={t('picker.close')} title={t('picker.close')} onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="orq-fview__body">
          <nav className="orq-fview__list" aria-label={t('fview.list', { count: files.length })}>
            <p className="orq-hint">{t('fview.list', { count: files.length })}</p>
            <ul>
              {files.map((f) => (
                <li key={f.path}>
                  <button type="button" aria-current={f.path === path ? 'true' : undefined} className={f.path === path ? 'is-on' : undefined} onClick={() => setPath(f.path)}>
                    <span className="orq-mono">{f.path}</span>
                    <span className="orq-hint">
                      {f.change === 'created' ? t('files.new') : t('files.mod')}
                      {f.steps.length > 0 ? ` · ${who(f)}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <div className="orq-fview__main">
            <div className="orq-run__tabs" role="tablist" aria-label={t('fview.tabs')}>
              <button type="button" role="tab" aria-selected={tab === 'changes'} onClick={() => setTab('changes')}>
                {t('fview.changes')}
              </button>
              <button type="button" role="tab" aria-selected={tab === 'content'} onClick={() => setTab('content')}>
                {t('fview.content')}
              </button>
            </div>
            <div className="orq-fview__pane" role="tabpanel" aria-label={tab === 'changes' ? t('fview.changes') : t('fview.content')}>
              {!file ? (
                <p className="orq-hint">{t('fview.loading')}</p>
              ) : 'error' in file ? (
                <p className="orq-field__error" role="alert">
                  {t('fview.error', { message: file.error })}
                </p>
              ) : file.binary ? (
                <p className="orq-hint">{t('fview.binary')}</p>
              ) : (
                <>
                  {file.missing && <p className="orq-run__note" role="note">{t('fview.missing')}</p>}
                  {(file.current?.truncated || file.before?.truncated) && <p className="orq-hint">{t('fview.truncated')}</p>}
                  {tab === 'changes' ? (
                    <DiffView before={file.before?.text} after={file.current?.text ?? ''} />
                  ) : file.current ? (
                    /\.(md|markdown)$/i.test(path) ? <Markdown text={file.current.text} className="orq-fview__md" /> : <pre className="orq-fview__pre">{file.current.text}</pre>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Pestaña «Archivos» de la ejecución: cada fichero con su tipo, quién lo tocó, «Ver» y «Restaurar» [R45.12][R32.32]. */
export function ProjectChanges({ api, runId, finished, events, labelOf, onOpen }: { api: ProjectApi; runId: string; finished: boolean; events: readonly RunEvent[]; labelOf?: Labeler; onOpen?: (path: string) => void }) {
  const [backups, setBackups] = useState<string[]>([]);
  const [restored, setRestored] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string>();
  useEffect(() => {
    let alive = true;
    void api.listBackups(runId).then((r) => alive && setBackups(r.ok ? r.value : []));
    return () => {
      alive = false;
    };
  }, [api, runId, finished]);
  const files = useMemo(() => runFiles(events, backups), [events, backups]);
  if (files.length === 0) return <p className="orq-hint">{t('runs.files.none')}</p>;
  const restore = async (path: string) => {
    setError(undefined);
    const r = await api.restoreBackup({ runId, path });
    if (!r.ok) return setError(r.error.message);
    if (r.value) setRestored((s) => new Set(s).add(path));
    else setError(t('runs.changes.gone', { path }));
  };
  return (
    <section className="orq-panel orq-changes" aria-label={t('runs.changes')}>
      <h2>{t('runs.changes')}</h2>
      <ul>
        {files.map((f) => (
          <li key={f.path}>
            <span className="orq-changes__path">{f.path}</span>
            <span className={`orq-tag ${f.change === 'created' ? 'is-new' : 'is-mod'}`}>{f.change === 'created' ? t('runs.changes.new') : t('runs.changes.modified')}</span>
            {f.byCommand && <span className="orq-hint">{f.change === 'modified' && !f.backup ? t('runs.changes.noCopy') : t('runs.changes.command')}</span>}
            {labelOf && f.steps.length > 0 && <span className="orq-hint">{t('fview.by', { steps: f.steps.map((s) => labelOf(s.nodeId, s.nodePath)).join(', ') })}</span>}
            {onOpen && (
              <button type="button" className="orq-btn orq-btn--small" aria-label={t('files.viewAria', { path: f.path })} onClick={() => onOpen(f.path)}>
                {t('files.view')}
              </button>
            )}
            {f.backup &&
              (restored.has(f.path) ? (
                <span className="orq-hint" role="status">
                  {t('runs.changes.restored')}
                </span>
              ) : (
                <button type="button" className="orq-btn orq-btn--small" aria-label={t('runs.changes.restore', { path: f.path })} onClick={() => void restore(f.path)}>
                  {t('runs.changes.restoreShort')}
                </button>
              ))}
          </li>
        ))}
      </ul>
      <p className="orq-hint">{t('runs.changes.hint')}</p>
      {files.some((f) => f.byCommand) && <p className="orq-hint">{t('runs.changes.commandHint')}</p>}
      {error && (
        <p className="orq-field__error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
