import { useEffect, useState } from 'react';
import { t, type LiveView, type OutputFileInfo, type ProjectApi } from '@orquestador/editor';
import { Markdown } from './Markdown';

interface Props {
  api: ProjectApi;
  runId: string | undefined;
  live: LiveView;
  labelOf: (nodeId: string) => string;
  /** La respuesta final ya se muestra aparte (Ejecuciones › Resultados). */
  hideFinal?: boolean;
  /** Archivo que se abre en la vista previa al cargar (p. ej. el entregable) [R46.15]. */
  initialPath?: string | undefined;
}

/** Resultados de la ejecución: texto final, archivos de salida y vista previa (R17.1, R17.2, R17.5). */
export function ResultsPanel({ api, runId, live, labelOf, hideFinal, initialPath }: Props) {
  const [files, setFiles] = useState<OutputFileInfo[]>([]);
  const [open, setOpen] = useState<{ path: string; text: string; truncated: boolean } | undefined>();
  const finished = live.status !== 'idle' && live.status !== 'running';

  useEffect(() => {
    setOpen(undefined);
    if (!runId || !finished) return setFiles([]);
    let cancelled = false;
    void api.listOutput(runId).then(async (r) => {
      if (cancelled) return;
      setFiles(r.ok ? r.value : []);
      if (initialPath && r.ok && r.value.some((f) => f.path === initialPath)) {
        const o = await api.readOutput({ runId, path: initialPath });
        if (!cancelled && o.ok) setOpen({ path: initialPath, ...o.value });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [api, runId, finished, initialPath]);

  const byNode = new Map<string, string[]>();
  for (const f of live.produced) byNode.set(f.nodeId, [...(byNode.get(f.nodeId) ?? []), f.path]);

  const preview = async (path: string) => {
    if (!runId) return;
    const r = await api.readOutput({ runId, path });
    if (r.ok) setOpen({ path, ...r.value });
  };

  return (
    <section className="orq-results" aria-label={t('results.title')}>
      <h2>{t('results.title')}</h2>
      {!runId || live.status === 'idle' ? (
        <p className="orq-hint">{t('results.empty')}</p>
      ) : (
        <>
          {live.exhausted.map((x) => (
            <p key={`${x.nodePath.join('/')}/${x.nodeId}`} className="orq-results__warn" role="status">
              {t('results.exhausted', { node: labelOf(x.nodeId) })}
            </p>
          ))}
          {live.finalOutput !== undefined && !hideFinal && (
            <div>
              <h3>{t('results.final')}</h3>
              <Markdown text={live.finalOutput} className="orq-final" />
            </div>
          )}
          {byNode.size > 0 &&
            [...byNode].map(([nodeId, paths]) => (
              <div key={nodeId}>
                <h3>{t('results.produced', { node: labelOf(nodeId) })}</h3>
                <ul>
                  {paths.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            ))}
          <h3>{t('results.files')}</h3>
          {files.length === 0 ? (
            <p className="orq-hint">{t('results.none')}</p>
          ) : (
            <ul>
              {files.map((f) => (
                <li key={f.path}>
                  <button type="button" onClick={() => void preview(f.path)}>
                    {f.path}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {open && (
            <div aria-label={t('results.preview', { path: open.path })} role="region">
              <h3>{t('results.preview', { path: open.path })}</h3>
              {/\.(md|markdown)$/i.test(open.path) ? <Markdown text={open.text} /> : <pre>{open.text}</pre>}
              {open.truncated && <p className="orq-hint">{t('results.truncated')}</p>}
            </div>
          )}
        </>
      )}
    </section>
  );
}
