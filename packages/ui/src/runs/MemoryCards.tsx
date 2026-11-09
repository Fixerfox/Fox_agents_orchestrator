import { useState } from 'react';
import { t, type MemoryCard, type MessageKey } from '@orquestador/editor';

/** Una tarjeta: la de siempre (paso, texto y ficheros) y, si la da la memoria, su bloque y su procedencia [R72.22]. */
export type MemoryNote = Pick<MemoryCard, 'label' | 'text' | 'files'> & Partial<Pick<MemoryCard, 'block' | 'source' | 'key'>>;

/** Ficheros que se ven en una tarjeta antes de «+N» [R69.5]. */
const FILES_SHOWN = 2;
/** Orden de los bloques en la vista completa [R72.14][R72.22]. */
const BLOCK_ORDER: MemoryCard['block'][] = ['decisions', 'agreements', 'notes', 'alerts', 'route', 'steps'];

function Card({ n, warn }: { n: MemoryNote; warn: boolean }) {
  return (
    <li className={`orq-memcard${warn ? ' is-warn' : ''}`}>
      <p className="orq-memcard__head">
        <span className="orq-memcard__dot" aria-hidden="true" />
        <strong>{n.label}</strong>
        {n.source && <span className="orq-memcard__source">{t(`mem.source.${n.source}` as MessageKey, { step: n.label })}</span>}
        {warn && <span className="orq-memcard__warn">{t('mem.warn')}</span>}
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
  );
}

/**
 * La memoria de la ejecución como tarjetas, la última primero [R69.5]. En la vista completa van por bloques, en el
 * orden de lo que reciben los agentes, y cada una dice de dónde sale [R72.22]. Con `limit`, solo las últimas y «Ver
 * las N entradas» [R69.4].
 */
export function MemoryCards({ notes, branch, warned, limit, onAll }: { notes: readonly MemoryNote[]; branch?: string | undefined; warned?: ReadonlySet<string>; limit?: number; onAll?: (() => void) | undefined }) {
  const [only, setOnly] = useState(false);
  const all = [...notes].reverse();
  const hasWarn = (n: MemoryNote) => warned?.has(n.label) === true || (n.key !== undefined && warned?.has(n.key) === true);
  const withAlerts = all.filter(hasWarn);
  const list = only ? withAlerts : all;
  const shown = limit === undefined ? list : list.slice(0, limit);
  const grouped = limit === undefined && shown.some((n) => n.block !== undefined);
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
      ) : grouped ? (
        BLOCK_ORDER.map((b) => {
          const items = shown.filter((n) => (n.block ?? 'steps') === b);
          if (items.length === 0) return null;
          return (
            <section key={b} className="orq-memcards__block" aria-label={t(`mem.block.${b}` as MessageKey)}>
              <h4>{t(`mem.block.${b}` as MessageKey)}</h4>
              <ol className="orq-memcards__list">
                {items.map((n, i) => (
                  <Card key={`${n.label}-${i}`} n={n} warn={hasWarn(n)} />
                ))}
              </ol>
            </section>
          );
        })
      ) : (
        <ol className="orq-memcards__list">
          {shown.map((n, i) => (
            <Card key={`${n.label}-${i}`} n={n} warn={hasWarn(n)} />
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
