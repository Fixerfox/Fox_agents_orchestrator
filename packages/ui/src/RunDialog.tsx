import { useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { FileText, FolderOpen, Image as ImageIcon, Paperclip, Play, X } from 'lucide-react';
import { deliverableProblems, type DeliverableSpec } from '@orquestador/core';
import { MAX_ATTACHMENT_BYTES, MAX_INPUT_FILES, deliverableLabel, t, type ProjectApi } from '@orquestador/editor';
import { DeliverablePanel } from './DeliverablePanel';

/** Archivo de la entrada: adjunto guardado en el proyecto o archivo de la carpeta de trabajo [R48.3]. */
export type InputItem = { kind: 'attachment'; id: string; name: string; size: number; image: boolean } | { kind: 'project'; path: string; name: string; size: number; image: boolean };

/** Archivos de la entrada al ejecutar [R48.5]. */
export interface RunInputs {
  attachments: string[];
  files: string[];
}

interface Props {
  diagramName: string;
  engine: 'simulated' | 'claude';
  runnable: boolean;
  /** Última entrada usada, para repetir rápido. */
  lastInput?: string;
  defaultLimit?: number | undefined;
  onEngine: (engine: 'simulated' | 'claude') => void;
  /**
   * `deliverable`: solo si se cambió para esta ejecución (`null` = sin entregable) [R46.14].
   * `inputs`: solo si hay archivos en la entrada [R48.3].
   */
  onStart: (input: string, maxTokens?: number, deliverable?: DeliverableSpec | null, inputs?: RunInputs) => void;
  onClose: () => void;
  /** Entregable del diagrama y sus pasos finales [R46.14]. */
  deliverable?: DeliverableSpec | undefined;
  finals?: string[];
  /** «Guardar en el diagrama». */
  onSaveDeliverable?: (spec: DeliverableSpec | undefined) => void;
  /** Para guardar y elegir los archivos de la entrada; sin ella no hay adjuntos [R48.3]. */
  api?: ProjectApi;
  /** Ejecuciones de este diagrama en marcha y en cola: con alguna, se elige a la vez o en cola [R52.7]. */
  busyRuns?: { running: number; queued: number };
  /**
   * Lanzar con todas las opciones [R52.7]; si está, sustituye a `onStart`. `whenBusy` solo cuando hay otras;
   * `stay`: «Quedarme donde estoy».
   */
  onLaunch?: (input: string, maxTokens: number | undefined, deliverable: DeliverableSpec | null | undefined, inputs: RunInputs | undefined, launch: { whenBusy?: 'parallel' | 'queue'; stay: boolean }) => void;
}

const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024)).toLocaleString('es-ES')} KB` : `${(n / 1024 / 1024).toLocaleString('es-ES', { maximumFractionDigits: 1 })} MB`);
const keyOf = (f: InputItem) => (f.kind === 'attachment' ? `a:${f.id}` : `p:${f.path}`);

/**
 * Diálogo Ejecutar: un modal centrado con las pestañas «Ejecución» y «Entregable», cabecera y pie fijos y el cuerpo
 * con scroll [R48.1][R48.2]. La Entrada admite adjuntos [R48.3].
 */
export function RunDialog({ diagramName, engine, runnable, lastInput = '', defaultLimit, onEngine, onStart, onClose, deliverable, finals = [], onSaveDeliverable, api, busyRuns, onLaunch }: Props) {
  const others = (busyRuns?.running ?? 0) + (busyRuns?.queued ?? 0);
  const [whenBusy, setWhenBusy] = useState<'parallel' | 'queue'>('parallel');
  const [stay, setStay] = useState(false);
  const [tab, setTab] = useState<'run' | 'deliverable'>('run');
  const [input, setInput] = useState(lastInput);
  const [limit, setLimit] = useState(defaultLimit !== undefined ? String(defaultLimit) : '');
  const [files, setFiles] = useState<InputItem[]>([]);
  const [fileError, setFileError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const counter = useRef(0);
  // El entregable de esta ejecución: empieza con el del diagrama [R46.14].
  const [dlv, setDlv] = useState<DeliverableSpec | undefined>(deliverable);
  const [saved, setSaved] = useState(false);
  const changed = JSON.stringify(dlv ?? null) !== JSON.stringify(deliverable ?? null);
  const dlvOk = dlv === undefined || deliverableProblems(dlv).length === 0;
  const ok = runnable && (input.trim() !== '' || files.length > 0) && dlvOk && !busy;
  const go = () => {
    if (!ok) return;
    if (onLaunch) {
      const inputs = files.length > 0 ? { attachments: files.flatMap((f) => (f.kind === 'attachment' ? [f.id] : [])), files: files.flatMap((f) => (f.kind === 'project' ? [f.path] : [])) } : undefined;
      onLaunch(input.trim(), limit !== '' && Number(limit) > 0 ? Number(limit) : undefined, changed ? (dlv ?? null) : undefined, inputs, { ...(others > 0 ? { whenBusy } : {}), stay });
      return;
    }
    const args: [string, number | undefined, ...unknown[]] = [input.trim(), limit !== '' && Number(limit) > 0 ? Number(limit) : undefined];
    if (changed || files.length > 0) args.push(changed ? (dlv ?? null) : undefined);
    if (files.length > 0) {
      args.push({
        attachments: files.flatMap((f) => (f.kind === 'attachment' ? [f.id] : [])),
        files: files.flatMap((f) => (f.kind === 'project' ? [f.path] : [])),
      });
    }
    (onStart as (...a: unknown[]) => void)(...args);
  };

  /** Añade sin repetir y sin pasar del máximo [R48.3]. */
  const add = (items: InputItem[]) =>
    setFiles((prev) => {
      const seen = new Set(prev.map(keyOf));
      const next = [...prev, ...items.filter((i) => !seen.has(keyOf(i)))];
      if (next.length > MAX_INPUT_FILES) setFileError(t('rundlg.files.max', { n: MAX_INPUT_FILES }));
      return next.slice(0, MAX_INPUT_FILES);
    });
  const guard = async (fn: () => Promise<void>) => {
    setFileError(undefined);
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  /** Archivos arrastrados o pegados: viajan como bytes, nunca como rutas [R48.6]. */
  const stage = (list: File[]) =>
    guard(async () => {
      if (!api) return;
      for (const file of list) {
        if (file.size > MAX_ATTACHMENT_BYTES) {
          setFileError(t('rundlg.files.big', { name: file.name }));
          continue;
        }
        const res = await api.stageAttachment({ name: file.name, data: new Uint8Array(await file.arrayBuffer()) });
        if (res.ok) add([{ kind: 'attachment', ...res.value }]);
        else setFileError(res.error.message);
      }
    });
  const attach = () =>
    guard(async () => {
      const res = await api!.pickAttachments();
      if (!res.ok) return setFileError(res.error.message);
      if (res.value) add(res.value.map((a) => ({ kind: 'attachment' as const, ...a })));
    });
  const fromProject = () =>
    guard(async () => {
      const res = await api!.pickProjectFiles();
      if (!res.ok) return setFileError(res.error.message);
      if (res.value) add(res.value.map((f) => ({ kind: 'project' as const, path: f.path, name: f.path, size: f.size, image: f.image })));
    });
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    counter.current = 0;
    setDragging(false);
    if (e.dataTransfer.files.length > 0) void stage([...e.dataTransfer.files]);
  };
  const onPaste = (e: ClipboardEvent) => {
    const list = [...e.clipboardData.files];
    if (list.length === 0) return;
    e.preventDefault();
    void stage(list);
  };

  const label = deliverableLabel(dlv) ?? t('rundlg.dlv.none');
  return (
    <div
      className="orq-modal orq-rundlg-veil"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="orq-rundlg orq-rundlg--modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('rundlg.title', { name: diagramName })}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) go();
        }}
      >
        <header className="orq-rundlg__head">
          <h2>{t('rundlg.title', { name: diagramName })}</h2>
          <button type="button" className="orq-icon-btn" aria-label={t('picker.close')} title={t('picker.close')} onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="orq-rundlg__tabs" role="tablist" aria-label={t('rundlg.tabs')}>
          <button type="button" role="tab" id="rundlg-tab-run" aria-controls="rundlg-panel" aria-selected={tab === 'run'} onClick={() => setTab('run')}>
            {t('rundlg.tab.run')}
          </button>
          <button type="button" role="tab" id="rundlg-tab-dlv" aria-controls="rundlg-panel" aria-selected={tab === 'deliverable'} onClick={() => setTab('deliverable')}>
            {t('rundlg.dlv')} <em>{label}</em>
          </button>
        </div>

        <div className="orq-rundlg__body" id="rundlg-panel" role="tabpanel" aria-labelledby={tab === 'run' ? 'rundlg-tab-run' : 'rundlg-tab-dlv'}>
          {tab === 'run' ? (
            <>
              <div
                className={`orq-rundlg__input${dragging ? ' is-drop' : ''}`}
                onDragEnter={(e) => {
                  if (!api || !e.dataTransfer.types.includes('Files')) return;
                  counter.current++;
                  setDragging(true);
                }}
                onDragOver={(e) => api && e.dataTransfer.types.includes('Files') && e.preventDefault()}
                onDragLeave={() => {
                  counter.current = Math.max(0, counter.current - 1);
                  if (counter.current === 0) setDragging(false);
                }}
                onDrop={onDrop}
              >
                <label className="orq-rundlg__field orq-rundlg__entry">
                  {t('rundlg.input')}
                  <textarea autoFocus value={input} placeholder={t('rundlg.input.placeholder')} onChange={(e) => setInput(e.target.value)} onPaste={onPaste} />
                </label>
                {files.length > 0 && (
                  <ul className="orq-rundlg__files" aria-label={t('rundlg.files')}>
                    {files.map((f) => (
                      <li key={keyOf(f)}>
                        <span className="orq-rundlg__ficon" aria-hidden="true">
                          {f.image ? <ImageIcon size={15} /> : <FileText size={15} />}
                        </span>
                        <span className="orq-rundlg__fname" title={f.name}>
                          {f.name}
                        </span>
                        <span className="orq-hint">{f.kind === 'project' ? t('rundlg.files.project', { size: kb(f.size) }) : kb(f.size)}</span>
                        <button type="button" className="orq-iconbtn" aria-label={t('rundlg.files.remove', { name: f.name })} onClick={() => setFiles((prev) => prev.filter((x) => keyOf(x) !== keyOf(f)))}>
                          <X size={13} aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {api && (
                  <div className="orq-rundlg__inbar">
                    <button type="button" className="orq-btn orq-btn--small" disabled={busy || files.length >= MAX_INPUT_FILES} onClick={() => void attach()}>
                      <Paperclip size={14} aria-hidden="true" /> {t('rundlg.files.attach')}
                    </button>
                    <button type="button" className="orq-btn orq-btn--small orq-btn--ghost" disabled={busy || files.length >= MAX_INPUT_FILES} onClick={() => void fromProject()}>
                      <FolderOpen size={14} aria-hidden="true" /> {t('rundlg.files.fromProject')}
                    </button>
                    <span className="orq-hint">{dragging ? t('rundlg.files.drop') : t('rundlg.files.hint')}</span>
                  </div>
                )}
              </div>
              {fileError && (
                <p className="orq-field__error" role="alert">
                  {fileError}
                </p>
              )}
              <p className="orq-hint">{t('rundlg.input.hint')}</p>
              {others > 0 && (
                <fieldset className="orq-rundlg__busy">
                  <legend>{busyRuns!.running > 0 ? (busyRuns!.running === 1 ? t('rundlg.busy.one') : t('rundlg.busy.many', { n: busyRuns!.running })) : t('rundlg.busy.queued', { n: busyRuns!.queued })}</legend>
                  {(['parallel', 'queue'] as const).map((m) => (
                    <label key={m} className={`orq-radiocard${whenBusy === m ? ' is-on' : ''}`}>
                      <input type="radio" name="run-busy" checked={whenBusy === m} onChange={() => setWhenBusy(m)} />
                      <span>
                        <strong>{t(m === 'parallel' ? 'rundlg.busy.parallel' : 'rundlg.busy.queue')}</strong>
                        <span className="orq-hint">{t(m === 'parallel' ? 'rundlg.busy.parallel.hint' : 'rundlg.busy.queue.hint')}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}
              <div className="orq-rundlg__grid">
                <fieldset className="orq-rundlg__engines">
                  <legend>{t('rundlg.engine')}</legend>
                  {(['simulated', 'claude'] as const).map((m) => (
                    <label key={m} className={`orq-radiocard${engine === m ? ' is-on' : ''}`}>
                      <input type="radio" name="run-engine" checked={engine === m} onChange={() => onEngine(m)} />
                      <span>
                        <strong>{t(m === 'claude' ? 'engine.claude' : 'engine.simulated')}</strong>
                        <span className="orq-hint">{t(m === 'claude' ? 'rundlg.engine.claude' : 'rundlg.engine.simulated')}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
                <div>
                  <label className="orq-rundlg__field">
                    {t('rundlg.budget')}
                    <input type="number" min={1} value={limit} onChange={(e) => setLimit(e.target.value)} />
                  </label>
                  <p className="orq-hint">{t('rundlg.budget.hint')}</p>
                </div>
              </div>
            </>
          ) : (
            <>
              <p className="orq-hint">{t('rundlg.dlv.hint')}</p>
              <DeliverablePanel idPrefix="rundlg-dlv" value={dlv} finals={finals} onChange={(s) => (setDlv(s), setSaved(false))} />
              {onSaveDeliverable && (
                <div>
                  <button
                    type="button"
                    className="orq-btn orq-btn--small"
                    disabled={!changed || !dlvOk}
                    onClick={() => {
                      onSaveDeliverable(dlv);
                      setSaved(true);
                    }}
                  >
                    {saved ? t('rundlg.dlv.saved') : t('rundlg.dlv.save')}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <footer className="orq-rundlg__foot">
          <div className="orq-rundlg__status">
            {!runnable ? (
              <p className="orq-field__error" role="alert">
                {t('rundlg.blocked')}
              </p>
            ) : !dlvOk ? (
              <p className="orq-field__error" role="alert">
                {t('rundlg.dlv.invalid')}
              </p>
            ) : (
              <span className="orq-hint">
                {files.length > 0 ? t('rundlg.foot.files', { n: files.length }) : ''}
              </span>
            )}
          </div>
          <div className="orq-rundlg__actions">
            {onLaunch && (
              <label className="orq-check orq-rundlg__stay">
                <input type="checkbox" checked={stay} onChange={(e) => setStay(e.target.checked)} />
                {t('rundlg.stay')}
              </label>
            )}
            <button type="button" className="orq-btn" onClick={onClose}>
              {t('form.cancel')}
            </button>
            <button type="button" className="orq-btn orq-btn--primary" disabled={!ok} onClick={go}>
              <Play size={14} strokeWidth={2} aria-hidden="true" />
              {onLaunch ? t(stay ? 'rundlg.goStay' : 'rundlg.goSee') : t('rundlg.go')}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
