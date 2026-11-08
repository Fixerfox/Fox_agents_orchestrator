import { type ReactNode, useState } from 'react';
import { questionNeedsModal, questionPreview, t, type StepFacts } from '@orquestador/editor';
import { Markdown } from '../common';
import { QuestionModal, questionTitle, type QuestionItem } from './QuestionModal';

export { QuestionModal } from './QuestionModal';

type Item = QuestionItem;
const titleOf = questionTitle;

/** Las opciones y otra respuesta escrita; en el modal, en varias líneas [R78.3]. */
function Answer({ item, onAnswer, multiline = false }: { item: Item; onAnswer: (text: string) => void; multiline?: boolean }) {
  const [text, setText] = useState('');
  const send = () => {
    if (text.trim() === '') return;
    onAnswer(text.trim());
    setText('');
  };
  return (
    <>
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
        className={`orq-inbox__reply${multiline ? ' is-multi' : ''}`}
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        {multiline ? (
          <textarea
            value={text}
            rows={3}
            aria-label={t('runs.inbox.other')}
            placeholder={t(item.confirm || item.review ? 'qmodal.changes' : 'runs.inbox.other')}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                send();
              }
            }}
          />
        ) : (
          <input value={text} aria-label={t('runs.inbox.other')} placeholder={t('runs.inbox.other')} onChange={(e) => setText(e.target.value)} />
        )}
        <button type="submit" className="orq-btn orq-btn--small" disabled={text.trim() === ''}>
          {t('chat.send')}
        </button>
      </form>
    </>
  );
}

/**
 * Una pregunta de un paso. Las largas (confirmaciones, revisiones, textos largos) se ven en una línea y se responden
 * en un modal, que con `autoOpen` se abre solo la primera vez [R78.2]–[R78.4].
 */
export function QuestionCard({ item, from, agent, context, facts, onOpenFile, onAnswer, children, autoOpen = false }: { item: Item; from: string; agent?: string | undefined; context?: string; facts?: StepFacts | undefined; onOpenFile?: ((path: string) => void) | undefined; onAnswer: (text: string) => void; children?: ReactNode; autoOpen?: boolean }) {
  const long = questionNeedsModal(item);
  const [open, setOpen] = useState(long && autoOpen);
  const title = titleOf(item, from);
  const confirmLike = item.confirm !== undefined || item.review !== undefined;
  if (long) {
    return (
      <article className={`orq-inbox__item is-compact${confirmLike ? ' is-confirm' : ''}`} aria-label={title}>
        <div className="orq-inbox__top">
          <strong>{title}</strong>
          {agent && <span className="orq-hint">{t('qmodal.agent', { agent })}</span>}
          {context && <span className="orq-hint">{context}</span>}
          <span className="orq-grow" />
          {children}
          <button type="button" className="orq-btn orq-btn--small orq-btn--primary" onClick={() => setOpen(true)}>
            {t('qmodal.open')}
          </button>
        </div>
        <p className="orq-inbox__preview">{questionPreview(item.text)}</p>
        {open && (
          <QuestionModal
            item={item}
            from={from}
            agent={agent}
            context={context}
            facts={facts}
            onOpenFile={onOpenFile}
            onClose={() => setOpen(false)}
            onAnswer={(text) => {
              setOpen(false);
              onAnswer(text);
            }}
          />
        )}
      </article>
    );
  }
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
        <Markdown text={item.text} />
      </div>
      <Answer item={item} onAnswer={onAnswer} />
    </article>
  );
}
