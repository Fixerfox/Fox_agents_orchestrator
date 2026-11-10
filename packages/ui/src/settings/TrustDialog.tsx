import { useEffect, useRef, useState } from 'react';
import { ShieldAlert, X } from 'lucide-react';
import { t, type ProjectApi, type ProjectTrustInfo } from '@orquestador/editor';

/**
 * «¿Confías en la configuración de Claude Code de este proyecto?»: lo que trae (hooks, env…) y confiar o ignorarla
 * [R88.7]. Cerrar sin elegir no guarda nada.
 */
export function TrustDialog({ info, onDecide, onClose }: { info: ProjectTrustInfo; onDecide: (d: 'trusted' | 'ignored') => void; onClose: () => void }) {
  const ignore = useRef<HTMLButtonElement>(null);
  useEffect(() => ignore.current?.focus(), []);
  return (
    <div
      className="orq-modal orq-modal--center"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="orq-picker orq-trust" role="dialog" aria-modal="true" aria-label={t('trust.title')}>
        <header className="orq-picker__head">
          <h2>
            <ShieldAlert size={18} aria-hidden="true" /> {t('trust.title')}
          </h2>
          <button type="button" className="orq-icon-btn" aria-label={t('picker.close')} title={t('picker.close')} onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <p>{t('trust.intro')}</p>
        <ul className="orq-trust__list" aria-label={t('trust.list')}>
          {info.items.map((it, i) => (
            <li key={`${it.file}-${it.key}-${i}`}>
              <code>{it.key}</code>: {it.detail} <span className="orq-hint">({it.file})</span>
            </li>
          ))}
        </ul>
        <p className="orq-hint">{t('trust.hint')}</p>
        <div className="orq-accept__actions">
          <button type="button" className="orq-btn" ref={ignore} onClick={() => onDecide('ignored')}>
            {t('trust.ignore')}
          </button>
          <button type="button" className="orq-btn orq-btn--primary" onClick={() => onDecide('trusted')}>
            {t('trust.trust')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** En Ajustes › Claude: si el proyecto trae configuración que revisar, su estado y «Revisar» [R88.8]. */
export function TrustRow({ api }: { api: ProjectApi }) {
  const [info, setInfo] = useState<ProjectTrustInfo>();
  const [open, setOpen] = useState(false);
  const load = async () => {
    const r = await api.projectTrust();
    if (r.ok) setInfo(r.value);
  };
  useEffect(() => void load(), [api]);
  if (!info || info.items.length === 0) return null;
  const state = info.decision === 'trusted' ? t('settings.trust.trusted') : info.decision === 'ignored' ? t('settings.trust.ignored') : t('settings.trust.pending');
  return (
    <div className="orq-field orq-setrow">
      <div className="orq-setrow__text">
        <span>{t('settings.trust.label')}</span>
        <p className="orq-hint">{state}</p>
      </div>
      <div className="orq-setrow__ctrl">
        <button type="button" className="orq-btn orq-btn--small" onClick={() => setOpen(true)}>
          {t('settings.trust.review')}
        </button>
      </div>
      {open && (
        <TrustDialog
          info={info}
          onClose={() => setOpen(false)}
          onDecide={(d) =>
            void api.setProjectTrust(d).then(() => {
              setOpen(false);
              void load();
            })
          }
        />
      )}
    </div>
  );
}
