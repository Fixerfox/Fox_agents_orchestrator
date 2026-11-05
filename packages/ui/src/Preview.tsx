import { useEffect, useState } from 'react';
import { ExternalLink, FileDiff, GitCompare, Loader2, Monitor, Smartphone, Wrench, X } from 'lucide-react';
import { t, type FilePreview, type ProjectApi } from '@orquestador/editor';
import { Markdown } from './Markdown';
import { fileKind, type NodeFile } from './OrqNode';

/** Pide la vista previa de un archivo de un paso; `undefined` mientras carga [R54.4]. */
export function usePreview(api: ProjectApi, runId: string | undefined, key: string, path: string): FilePreview | { error: string } | undefined {
  const [state, setState] = useState<FilePreview | { error: string }>();
  useEffect(() => {
    let alive = true;
    setState(undefined);
    if (!runId) return;
    void api.previewFile({ runId, key, path }).then((r) => alive && setState(r.ok ? r.value : { error: r.error.message }));
    return () => {
      alive = false;
    };
  }, [api, runId, key, path]);
  return state;
}

const baseName = (path: string) => path.split('/').pop() ?? path;

/**
 * Lo que hizo un paso, ya mostrado: imagen, web en un marco aislado, Markdown o texto. `thumb` lo dibuja pequeño y sin
 * interacción, para tarjetas y miniaturas [R54.4][R54.5].
 */
export function PreviewBody({ preview, device = 'desktop', thumb = false }: { preview: FilePreview | { error: string } | undefined; device?: 'desktop' | 'mobile'; thumb?: boolean }) {
  if (!preview) {
    return (
      <div className="orq-prev__empty" role="status">
        <Loader2 size={16} className="orq-spin" aria-hidden="true" />
        {!thumb && t('prev.loading')}
      </div>
    );
  }
  if ('error' in preview) return <p className="orq-prev__empty orq-field__error">{preview.error}</p>;
  const label = baseName(preview.path);
  switch (preview.kind) {
    case 'image':
      return <img className="orq-prev__img" src={preview.dataUrl} alt={t('prev.alt', { name: label })} />;
    case 'html':
      return (
        <div className={`orq-prev__frame${thumb ? ' is-thumb' : ''} is-${device}`}>
          <iframe
            title={t('prev.alt', { name: label })}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            {...(preview.url ? { src: preview.url } : { srcDoc: preview.srcdoc ?? '' })}
            {...(thumb ? { tabIndex: -1, 'aria-hidden': true } : {})}
          />
        </div>
      );
    case 'markdown':
      return <Markdown text={preview.text ?? ''} className={`orq-prev__doc${thumb ? ' is-thumb' : ''}`} />;
    case 'text':
      return <pre className={`orq-prev__text${thumb ? ' is-thumb' : ''}`}>{preview.text}</pre>;
    case 'missing':
      return <p className="orq-prev__empty">{t('prev.missing')}</p>;
    default:
      return <p className="orq-prev__empty">{t('prev.other')}</p>;
  }
}

/** De dónde sale lo que se ve, si no es la copia de esta ejecución [R54.4]. */
function SourceNote({ preview }: { preview: FilePreview | { error: string } | undefined }) {
  if (!preview || 'error' in preview || !preview.source || preview.source === 'run') return null;
  return <p className="orq-hint orq-prev__note">{t(preview.source === 'previous' ? 'prev.source.previous' : 'prev.source.live')}</p>;
}

/** Vista previa pequeña de un archivo, para la tarjeta junto al nodo y las miniaturas de la revisión [R54.1][R54.6]. */
export function PreviewThumb({ api, runId, stepKey, path }: { api: ProjectApi; runId: string; stepKey: string; path: string }) {
  const preview = usePreview(api, runId, stepKey, path);
  return <PreviewBody preview={preview} thumb />;
}

/** Un panel de la ventana grande: lo que se ve de una ejecución (esta o la anterior). */
function PreviewPane({ api, runId, stepKey, path, device, caption }: { api: ProjectApi; runId: string; stepKey: string; path: string; device: 'desktop' | 'mobile'; caption?: string }) {
  const preview = usePreview(api, runId, stepKey, path);
  return (
    <figure className={`orq-prev__pane is-${device}`}>
      {caption && <figcaption>{caption}</figcaption>}
      <PreviewBody preview={preview} device={device} />
      <SourceNote preview={preview} />
    </figure>
  );
}

interface DialogProps {
  api: ProjectApi;
  runId: string;
  stepKey: string;
  /** Nombre del paso. */
  label: string;
  files: readonly NodeFile[];
  initial: string;
  /** Ejecución corregida o reanudada por esta: «Comparar con la anterior» [R54.5]. */
  compareRunId?: string | undefined;
  onClose: () => void;
  /** «Ver cambios»: el visor de archivos con el antes y el ahora (SPEC-045). */
  onChanges?: ((path: string) => void) | undefined;
  /** «Pedir corrección» con este paso sugerido (SPEC-053). */
  onCorrect?: (() => void) | undefined;
}

/**
 * Vista previa en grande de lo que hizo un paso: una pestaña por archivo, escritorio o móvil para una web,
 * comparar con la ejecución anterior, ver cambios, abrir fuera y pedir corrección [R54.5].
 */
export function PreviewDialog({ api, runId, stepKey, label, files, initial, compareRunId, onClose, onChanges, onCorrect }: DialogProps) {
  const [path, setPath] = useState(initial);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [compare, setCompare] = useState(false);
  const [note, setNote] = useState<string>();
  const shown = files.filter((f) => f.change !== 'deleted');
  const isWeb = /\.html?$/i.test(path);
  const title = t('prev.title', { name: label });
  const openOutside = async () => {
    const r = await api.openPreview({ runId, key: stepKey, path });
    setNote(r.ok ? (r.value ? undefined : t('prev.open.none')) : r.error.message);
  };
  return (
    <div
      className="orq-modal orq-rundlg-veil"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="orq-prevdlg"
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
        <header className="orq-prevdlg__head">
          <h2>{title}</h2>
          <div className="orq-prevdlg__tabs" role="tablist" aria-label={t('prev.files')}>
            {shown.map((f) => (
              <button key={f.path} type="button" role="tab" aria-selected={f.path === path} title={f.path} className={`orq-prevdlg__tab is-${fileKind(f.path)}`} onClick={() => setPath(f.path)}>
                {baseName(f.path)}
              </button>
            ))}
          </div>
          <span className="orq-grow" />
          {isWeb && (
            <div className="orq-prevdlg__seg" role="group" aria-label={t('prev.device')}>
              <button type="button" aria-pressed={device === 'desktop'} onClick={() => setDevice('desktop')}>
                <Monitor size={14} aria-hidden="true" />
                {t('prev.desktop')}
              </button>
              <button type="button" aria-pressed={device === 'mobile'} onClick={() => setDevice('mobile')}>
                <Smartphone size={14} aria-hidden="true" />
                {t('prev.mobile')}
              </button>
            </div>
          )}
          {compareRunId && (
            <button type="button" className="orq-btn orq-btn--small" aria-pressed={compare} onClick={() => setCompare((c) => !c)}>
              <GitCompare size={14} aria-hidden="true" />
              {t('prev.compare')}
            </button>
          )}
          {onChanges && (
            <button type="button" className="orq-btn orq-btn--small" onClick={() => onChanges(path)}>
              <FileDiff size={14} aria-hidden="true" />
              {t('prev.changes')}
            </button>
          )}
          <button type="button" className="orq-btn orq-btn--small" onClick={() => void openOutside()}>
            <ExternalLink size={14} aria-hidden="true" />
            {t('prev.open')}
          </button>
          {onCorrect && (
            <button type="button" className="orq-btn orq-btn--small orq-btn--primary" onClick={onCorrect}>
              <Wrench size={14} aria-hidden="true" />
              {t('fix.open')}
            </button>
          )}
          <button type="button" className="orq-icon-btn" aria-label={t('picker.close')} title={t('picker.close')} onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        {note && (
          <p className="orq-hint orq-prevdlg__msg" role="status">
            {note}
          </p>
        )}
        <div className={`orq-prevdlg__body${compare && compareRunId ? ' is-compare' : ''}`}>
          <PreviewPane key={`now:${path}`} api={api} runId={runId} stepKey={stepKey} path={path} device={device} {...(compare && compareRunId ? { caption: t('prev.this') } : {})} />
          {compare && compareRunId && <PreviewPane key={`old:${path}`} api={api} runId={compareRunId} stepKey={stepKey} path={path} device={device} caption={t('prev.before')} />}
        </div>
      </div>
    </div>
  );
}
