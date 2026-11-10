import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Clock, FileDiff, FilePlus2, MessageSquareText, Terminal, X } from 'lucide-react';
import { type ReviewQuestion } from '@orquestador/core';
import { formatDuration, t, type StepFacts } from '@orquestador/editor';
import { Markdown } from '../common';
import { money } from './runFormat';

export type QuestionItem = { text: string; options?: string[]; confirm?: { round: number }; review?: ReviewQuestion };

/** «Confirmar lo que ha hecho <paso>», «… tu revisión» o «Pregunta de <paso>» [R43.8][R53.15]. */
export const questionTitle = (item: QuestionItem, from: string) =>
  item.review ? t(item.review.phase === 'route' ? 'hreview.inbox.route' : 'hreview.inbox', { node: from }) : item.confirm ? t('confirm.inbox', { node: from }) : t('runs.inbox.from', { node: from });

const FILE_ICON = { created: FilePlus2, modified: FileDiff, command: Terminal } as const;

/** Lo que hizo el paso según sus eventos: archivos, gasto y avisos [R78.7]. */
function Facts({ facts, onOpenFile }: { facts: StepFacts; onOpenFile?: ((path: string) => void) | undefined }) {
  return (
    <aside className="orq-qmodal__facts" aria-label={t('qmodal.facts')}>
      <section>
        <h3>{t('qmodal.files', { n: facts.files.length })}</h3>
        {facts.files.length === 0 ? (
          <p className="orq-hint">{t('qmodal.files.none')}</p>
        ) : (
          <ul className="orq-qmodal__files">
            {facts.files.map((f) => {
              const Icon = FILE_ICON[f.change];
              return (
                <li key={f.path} className={`is-${f.change}`}>
                  <Icon size={14} aria-hidden="true" />
                  <button type="button" className="orq-qmodal__file" disabled={!onOpenFile} title={f.path} onClick={() => onOpenFile?.(f.path)}>
                    <span className="orq-qmodal__fname">{f.path.split('/').pop()}</span>
                    <span className="orq-qmodal__fdir">{f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''}</span>
                  </button>
                  <span className="orq-qmodal__badge">{t(`qmodal.change.${f.change}` as 'qmodal.change.created')}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section>
        <h3>{t('qmodal.spent')}</h3>
        <p className="orq-qmodal__spent">
          <Clock size={13} aria-hidden="true" /> {formatDuration(Math.round(facts.durationMs / 1000))} · {facts.tokens.toLocaleString('es-ES')} tokens · {money(facts.costUsd)}
        </p>
      </section>
      {facts.alerts.length > 0 && (
        <section className="is-warn">
          <h3>
            <AlertTriangle size={13} aria-hidden="true" /> {t('qmodal.alerts', { n: facts.alerts.length })}
          </h3>
          <ul className="orq-qmodal__alerts">
            {facts.alerts.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}

/**
 * Revisar y responder una pregunta larga [R78.3]: quién pregunta y qué se revisa arriba, el texto entero en el centro,
 * lo que hizo el paso al lado [R78.7] y, abajo, «Aprobar» destacado y «Pedir cambios» [R78.8].
 */
export function QuestionModal({ item, from, agent, context, facts, onOpenFile, onAnswer, onClose }: { item: QuestionItem; from: string; agent?: string | undefined; context?: string | undefined; facts?: StepFacts | undefined; onOpenFile?: ((path: string) => void) | undefined; onAnswer: (text: string) => void; onClose: () => void }) {
  const title = questionTitle(item, from);
  const decision = item.confirm !== undefined || item.review !== undefined;
  const [changing, setChanging] = useState(!decision);
  const [text, setText] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    box.current?.focus();
  }, []);
  useEffect(() => {
    if (changing && decision) area.current?.focus();
  }, [changing, decision]);
  const [primary, ...rest] = item.options ?? [];
  const send = () => {
    if (text.trim()) onAnswer(text.trim());
  };
  const kind = item.review ? t('qmodal.kind.review') : item.confirm ? t('qmodal.kind.confirm', { round: item.confirm.round }) : t('qmodal.kind.question');
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
      <div ref={box} tabIndex={-1} className={`orq-picker orq-qmodal${facts ? ' has-facts' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="orq-qmodal__head">
          <span className="orq-qmodal__icon" aria-hidden="true">
            <MessageSquareText size={20} />
          </span>
          <div className="orq-qmodal__who">
            <p className="orq-qmodal__eyebrow">
              <span>{kind}</span>
              <span className="orq-qmodal__wait">{t('qmodal.waiting')}</span>
            </p>
            <h2>{title}</h2>
            <p className="orq-hint">{[agent ? t('qmodal.agent', { agent }) : undefined, context].filter(Boolean).join(' · ')}</p>
          </div>
          <button type="button" className="orq-icon-btn" aria-label={t('picker.close')} title={t('picker.close')} onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="orq-qmodal__main">
          <div className="orq-qmodal__body" tabIndex={0} aria-label={t('runs.inbox.text')}>
            <Markdown text={item.text} className={decision ? 'orq-confirm__doc' : undefined} />
          </div>
          {facts && <Facts facts={facts} onOpenFile={onOpenFile} />}
        </div>
        <footer className="orq-qmodal__foot">
          {changing && (
            <form
              className="orq-qmodal__reply"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <textarea
                ref={area}
                value={text}
                rows={3}
                aria-label={decision ? t('qmodal.changes.label') : t('runs.inbox.other')}
                placeholder={decision ? t('qmodal.changes') : t('runs.inbox.other')}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              {decision && <p className="orq-hint">{t('qmodal.changes.hint')}</p>}
            </form>
          )}
          <div className="orq-qmodal__actions">
            {decision && !changing && (
              <button type="button" className="orq-btn" onClick={() => setChanging(true)}>
                {t('qmodal.ask')}
              </button>
            )}
            {changing && (
              <button type="button" className="orq-btn" disabled={text.trim() === ''} onClick={send}>
                {decision ? t('qmodal.send.changes') : t('chat.send')}
              </button>
            )}
            {rest.map((o) => (
              <button key={o} type="button" className="orq-btn" onClick={() => onAnswer(o)}>
                {o}
              </button>
            ))}
            <span className="orq-grow" />
            {decision && !changing && <span className="orq-hint">{t('qmodal.approve.hint')}</span>}
            {primary && (
              <button type="button" className="orq-btn orq-btn--primary orq-qmodal__approve" onClick={() => onAnswer(primary)}>
                {decision && <Check size={15} aria-hidden="true" />}
                {primary}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
