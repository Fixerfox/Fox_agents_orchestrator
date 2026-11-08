import { useState } from 'react';
import { t } from '@orquestador/editor';

export interface MemoryNote {
  label: string;
  text: string;
  files: string[];
}

/** Ficheros que se ven en una tarjeta antes de «+N» [R69.5]. */
const FILES_SHOWN = 2;

/**
 * La memoria de la ejecución como tarjetas, la última primero [R69.5]: cada una con su paso, su texto y sus ficheros,
 * y una marca ámbar si su paso tiene avisos. Con `limit`, solo las últimas y «Ver las N entradas» [R69.4].
 */
export function MemoryCards({ notes, branch, warned, limit, onAll }: { notes: readonly MemoryNote[]; branch?: string | undefined; warned?: ReadonlySet<string>; limit?: number; onAll?: (() => void) | undefined }) {
  const [only, setOnly] = useState(false);
  const all = [...notes].reverse();
  const hasWarn = (n: MemoryNote) => warned?.has(n.label) === true;
  const withAlerts = all.filter(hasWarn);
  const list = only ? withAlerts : all;
  const shown = limit === undefined ? list : list.slice(0, limit);
  return (
    <div className="orq-memcards">
      {branch && <p className="orq-memcards__branch">{branch}</p>}
      {limit === undefined && withAlerts.length > 0 && (
        <div className="orq-memcards__filter" role="group" aria-label={t('mem.filter')}>
          <button type="button" aria-pressed={!only} onClick={() => setOnly(false)}>
            {t('mem.filter.all', { count: all.length })}
          </button>
          <button type="button" aria-pressed={only} onClick={() => setOnly(true)}>
            {t('mem.filter.alerts', { count: withAlerts.length })}
          </button>
        </div>
      )}
      {all.length === 0 ? (
        <p className="orq-hint">{t('sup.memory.empty')}</p>
      ) : (
        <ol className="orq-memcards__list">
          {shown.map((n, i) => (
            <li key={`${n.label}-${i}`} className={`orq-memcard${hasWarn(n) ? ' is-warn' : ''}`}>
              <p className="orq-memcard__head">
                <span className="orq-memcard__dot" aria-hidden="true" />
                <strong>{n.label}</strong>
                {hasWarn(n) && <span className="orq-memcard__warn">{t('mem.warn')}</span>}
              </p>
              {n.text && <p className="orq-memcard__text">{n.text}</p>}
              {n.files.length > 0 && (
                <p className="orq-memcard__files">
                  {n.files.slice(0, FILES_SHOWN).map((f) => (
                    <code key={f}>{f}</code>
                  ))}
                  {n.files.length > FILES_SHOWN && <span className="orq-hint">+{n.files.length - FILES_SHOWN}</span>}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
      {limit !== undefined && all.length > limit && onAll && (
        <button type="button" className="orq-link orq-memcards__all" onClick={onAll}>
          {t('mem.all', { count: all.length })}
        </button>
      )}
    </div>
  );
}
