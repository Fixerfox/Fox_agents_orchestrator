import { type ReactNode, useState } from 'react';
import { type ReviewQuestion } from '@orquestador/core';
import { t } from '@orquestador/editor';
import { Markdown } from '../common/index';

export function QuestionCard({ item, from, context, onAnswer, children }: { item: { text: string; options?: string[]; confirm?: { round: number }; review?: ReviewQuestion }; from: string; context?: string; onAnswer: (text: string) => void; children?: ReactNode }) {
  const [text, setText] = useState('');
  // Una confirmación dice qué se confirma y su resumen va en Markdown [R43.8]; una revisión humana, qué se revisa [R53.15].
  const title = item.review
    ? t(item.review.phase === 'route' ? 'hreview.inbox.route' : 'hreview.inbox', { node: from })
    : item.confirm
      ? t('confirm.inbox', { node: from })
      : t('runs.inbox.from', { node: from });
  const confirmLike = item.confirm !== undefined || item.review !== undefined;
  return (
    <article className={`orq-inbox__item${confirmLike ? ' is-confirm' : ''}`} aria-label={title}>
      <div className="orq-inbox__top">
        <strong>{title}</strong>
        {context && <span className="orq-hint">{context}</span>}
        <span className="orq-grow" />
        {children}
      </div>
      {/* El texto lleva su propio scroll: una pregunta larga (un comando entero) no empuja fuera los botones ni la respuesta. */}
      <div className="orq-inbox__text" tabIndex={0} aria-label={t('runs.inbox.text')}>
        <Markdown text={item.text} className={confirmLike ? 'orq-confirm__doc' : undefined} />
      </div>
      {item.options && item.options.length > 0 && (
        <div className="orq-inbox__opts">
          {item.options.map((o, i) => (
            <button key={o} type="button" className={`orq-btn orq-btn--small${i === 0 ? ' orq-btn--primary' : ''}`} onClick={() => onAnswer(o)}>
              {o}
            </button>
          ))}
        </div>
      )}
      <form
        className="orq-inbox__reply"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim() === '') return;
          onAnswer(text.trim());
          setText('');
        }}
      >
        <input value={text} aria-label={t('runs.inbox.other')} placeholder={t('runs.inbox.other')} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="orq-btn orq-btn--small" disabled={text.trim() === ''}>
          {t('chat.send')}
        </button>
      </form>
    </article>
  );
}
