import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, BookOpen, Bot, FolderOpen, FileArchive, X } from 'lucide-react';
import type { ImportReport, ImportResult } from '@orquestador/core';
import { t, type ImportKind, type ProjectApi } from '@orquestador/editor';

interface Props {
  api: ProjectApi;
  onClose: () => void;
}

const SZ = { size: 16, strokeWidth: 1.5, 'aria-hidden': true } as const;
/** Avisos que piden más cuidado: código que se podría ejecutar o credenciales. */
const SERIOUS = new Set(['script', 'secrets']);

/** Revisión previa a instalar agentes y skills de un paquete: no se instala nada sin marcar y confirmar [R25.9]. */
export function InstallDialog({ api, onClose }: Props) {
  const [pkg, setPkg] = useState<{ importId: string; report: ImportReport }>();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<ImportResult>();
  const [error, setError] = useState<string>();
  const [empty, setEmpty] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  const choose = async (kind: ImportKind) => {
    setBusy(true);
    setError(undefined);
    setEmpty(false);
    const res = await api.inspectImport(kind);
    setBusy(false);
    if (!res.ok) return setError(t('install.error', { message: res.error.message }));
    if (!res.value) return;
    const { report } = res.value;
    if (report.items.length === 0) {
      void api.cancelImport(res.value.importId);
      return setEmpty(true);
    }
    setPkg(res.value);
    setChecked(new Set(report.items.filter((i) => !i.blocked).map((i) => i.key)));
  };
  const close = () => {
    if (pkg && !result) void api.cancelImport(pkg.importId);
    onClose();
  };
  const confirm = async () => {
    if (!pkg) return;
    setBusy(true);
    const res = await api.confirmImport({ importId: pkg.importId, keys: [...checked] });
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    setResult(res.value);
  };
  const nameOf = (key: string) => pkg?.report.items.find((i) => i.key === key)?.name ?? key;

  return (
    <div
      className="orq-modal orq-modal--top"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close();
        }
      }}
    >
      <div ref={ref} tabIndex={-1} className="orq-screen orq-screen--install" role="dialog" aria-modal="true" aria-label={t('install.title')}>
        <header className="orq-picker__head">
          <h2>{t('install.title')}</h2>
          <button type="button" className="orq-icon-btn" aria-label={t('install.close')} title={t('install.close')} onClick={close}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        {error && (
          <p className="orq-field__error" role="alert">
            {error}
          </p>
        )}
        {result ? (
          <div className="orq-install__body">
            <h3>{t('install.done')}</h3>
            <p>{t('install.done.agents', { count: result.agents.length })}</p>
            <p>{t('install.done.skills', { count: result.skills.length })}</p>
            {result.notes.map((n) => (
              <p key={n} className="orq-hint">
                {n}
              </p>
            ))}
            {result.failed.map((f) => (
              <p key={f.key} className="orq-field__error" role="alert">
                {t('install.failed', { name: nameOf(f.key), message: f.message })}
              </p>
            ))}
            <div className="orq-form__actions">
              <button type="button" className="orq-btn orq-btn--primary" onClick={onClose}>
                {t('install.finish')}
              </button>
            </div>
          </div>
        ) : !pkg ? (
          <div className="orq-install__body">
            <p>{t('install.intro')}</p>
            {empty && <p className="orq-hint" role="status">{t('install.empty')}</p>}
            <div className="orq-form__actions">
              <button type="button" className="orq-btn" disabled={busy} onClick={() => void choose('folder')}>
                <FolderOpen {...SZ} />
                {t('install.folder')}
              </button>
              <button type="button" className="orq-btn" disabled={busy} onClick={() => void choose('zip')}>
                <FileArchive {...SZ} />
                {t('install.zip')}
              </button>
            </div>
          </div>
        ) : (
          <div className="orq-install__body">
            <h3>{t('install.review')}</h3>
            <ul className="orq-install__items">
              {pkg.report.items.map((i) => {
                const Icon = i.kind === 'agent' ? Bot : BookOpen;
                return (
                  <li key={i.key} className="orq-install__item">
                    <label>
                      <input
                        type="checkbox"
                        checked={checked.has(i.key)}
                        disabled={Boolean(i.blocked)}
                        onChange={(e) => {
                          const next = new Set(checked);
                          if (e.target.checked) next.add(i.key);
                          else next.delete(i.key);
                          setChecked(next);
                        }}
                      />
                      <Icon {...SZ} />
                      <span className="orq-install__name">{i.name}</span>
                      <span className="orq-hint">{t(`install.kind.${i.kind}`)}</span>
                    </label>
                    {i.description && <p className="orq-hint orq-install__desc">{i.description}</p>}
                    {i.files.length > 0 && <p className="orq-hint orq-install__desc">{i.files.length === 1 ? t('install.files.one') : t('install.files', { count: i.files.length })}</p>}
                    {i.blocked && (
                      <p className="orq-field__error" role="alert">
                        {t('install.blocked', { reason: i.blocked })}
                      </p>
                    )}
                    {i.warnings.map((w) => (
                      <p key={w.code + w.message} className={`orq-install__warn${SERIOUS.has(w.code) ? ' is-serious' : ''}`}>
                        <AlertTriangle size={14} strokeWidth={1.5} aria-hidden="true" />
                        {w.message}
                      </p>
                    ))}
                  </li>
                );
              })}
            </ul>
            {pkg.report.mcp.length > 0 && (
              <div className="orq-install__mcp">
                <h3>{t('install.mcp.title')}</h3>
                <ul>
                  {pkg.report.mcp.map((m) => (
                    <li key={m.name}>
                      <code>{m.name}</code>
                      {m.command && <span className="orq-hint"> {m.command}</span>}
                    </li>
                  ))}
                </ul>
                <p className="orq-hint">{t('install.mcp.note')}</p>
              </div>
            )}
            {pkg.report.ignored > 0 && <p className="orq-hint">{t('install.ignored', { count: pkg.report.ignored })}</p>}
            <div className="orq-form__actions">
              <button type="button" className="orq-btn orq-btn--primary" disabled={busy || checked.size === 0} title={checked.size === 0 ? t('install.none') : undefined} onClick={() => void confirm()}>
                {t('install.confirm')}
              </button>
              <button type="button" className="orq-btn" onClick={close}>
                {t('install.cancel')}
              </button>
              <button
                type="button"
                className="orq-btn"
                onClick={() => {
                  void api.cancelImport(pkg.importId);
                  setPkg(undefined);
                }}
              >
                {t('install.again')}
              </button>
              {checked.size === 0 && <span className="orq-hint">{t('install.none')}</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
