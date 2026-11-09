import { CONFLICT_PREVIEW_KEY } from '@orquestador/core';
import { t, type TranscriptItem } from '@orquestador/editor';

type QuestionItem = Extract<TranscriptItem, { kind: 'question' }>;

/**
 * Conflicto al juntar ramas en paralelo [R73.14][R73.16]: los archivos, sus dos versiones para verlas y qué hacer
 * (quedarse con una, que lo junte un agente o parar).
 */
export function ConflictCard({ item, onAnswer, closed = false, onPreview }: { item: QuestionItem; onAnswer: (questionId: string, text: string) => void; closed?: boolean; onPreview?: ((key: string, path: string) => void) | undefined }) {
  const c = item.conflict!;
  return (
    <li className="orq-chat orq-chat--question orq-conflict" aria-label={t('conflict.title')}>
      <strong>{t('conflict.title')}</strong>
      <p>{t('conflict.intro', { a: c.branches[0], b: c.branches[1] })}</p>
      <ul className="orq-conflict__files">
        {c.files.map((f) => (
          <li key={f}>
            <code>{f}</code>
            {c.savedTo && onPreview && (
              <span className="orq-conflict__views">
                <button type="button" className="orq-link" onClick={() => onPreview(CONFLICT_PREVIEW_KEY, `${c.savedTo}/destino/${f}`)}>
                  {t('conflict.view', { branch: c.branches[0] })}
                </button>
                <button type="button" className="orq-link" onClick={() => onPreview(CONFLICT_PREVIEW_KEY, `${c.savedTo}/rama/${f}`)}>
                  {t('conflict.view', { branch: c.branches[1] })}
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {item.answer !== undefined ? (
        <p className="orq-chat__answer">{t('chat.answered', { text: item.answer })}</p>
      ) : closed ? (
        <p className="orq-hint">{t('chat.closed')}</p>
      ) : (
        <div className="orq-chat__reply">
          {item.options?.map((o) => (
            <button key={o} type="button" onClick={() => onAnswer(item.questionId, o)}>
              {o}
            </button>
          ))}
        </div>
      )}
      {!closed && item.answer === undefined && <p className="orq-hint">{t('conflict.hint')}</p>}
    </li>
  );
}
