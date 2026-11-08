import { useEffect, useRef, useState } from 'react';
import { Copy, X } from 'lucide-react';
import type { RunEvent } from '@orquestador/core';
import { t, transcriptItems, type LiveView, type MessageKey, type TranscriptItem } from '@orquestador/editor';
import { PassHeader, Question } from './NodePanel';
import { Markdown } from '../common';

interface Props {
  events: readonly RunEvent[];
  live: LiveView;
  nodeId: string;
  nodePath: string[];
  label: string;
  onAnswer: (questionId: string, text: string) => void;
  onClose: () => void;
  /** Nombre de otro nodo del mismo nivel (la revisión que devolvió una pasada) [R15.14]. */
  labelOf?: (nodeId: string) => string;
}

const lines = (s: string) => s.split('\n').length;

/** Ventana con todo lo que hizo un nodo, en grande y ordenada: entrada, resultado y paso a paso [R15.12][R15.13]. */
export function NodeDialog({ events, live, nodeId, nodePath, label, onAnswer, onClose, labelOf }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => ref.current?.focus(), []);
  const items = transcriptItems(events, nodeId, nodePath);
  const status = live.nodeStatus[[...nodePath, nodeId].join('/')];
  const input = [...items].reverse().find((i): i is Extract<TranscriptItem, { kind: 'input' }> => i.kind === 'input');
  const result = [...items].reverse().find((i): i is Extract<TranscriptItem, { kind: 'output' }> => i.kind === 'output');
  const usage = items.filter((i): i is Extract<TranscriptItem, { kind: 'usage' }> => i.kind === 'usage');
  const steps = items.filter((i) => i.kind !== 'input' && i.kind !== 'output' && i.kind !== 'usage');
  const tokens = usage.reduce((n, u) => n + u.inputTokens + u.outputTokens, 0);
  const cost = usage.reduce((n, u) => n + u.costUsd, 0);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result?.text ?? '');
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      className="orq-modal"
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
      <div ref={ref} tabIndex={-1} className="orq-picker orq-detail" role="dialog" aria-modal="true" aria-label={t('transcript.title', { name: label })}>
        <header className="orq-picker__head">
          <div>
            <h2>{t('transcript.title', { name: label })}</h2>
            <p className="orq-hint">
              {status ? t(`node.status.${status}` as MessageKey) : ''}
              {tokens > 0 ? ` · ${t('detail.tokens', { n: tokens.toLocaleString('es-ES'), cost: cost.toFixed(3).replace('.', ',') })}` : ''}
            </p>
          </div>
          <div className="orq-detail__actions">
            {result?.text && (
              <button type="button" className="orq-btn orq-btn--small" onClick={() => void copy()}>
                <Copy size={16} strokeWidth={1.5} aria-hidden="true" />
                {t(copied ? 'detail.copied' : 'detail.copy')}
              </button>
            )}
            <button type="button" className="orq-icon-btn" aria-label={t('picker.close')} title={t('picker.close')} onClick={onClose}>
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </header>
        <div className="orq-detail__body">
          {input && (
            <section>
              <h3>{t('detail.input')}</h3>
              <Markdown text={input.text} className="orq-detail__text" />
            </section>
          )}
          <section>
            <h3>{t('detail.result')}</h3>
            {result?.text ? <Markdown text={result.text} className="orq-detail__result" /> : <p className="orq-hint">{t('detail.noResult')}</p>}
          </section>
          {steps.length > 0 && (
            <section>
              <h3>{t('detail.steps')}</h3>
              <ol className="orq-detail__steps">
                {steps.map((it, i) => {
                  switch (it.kind) {
                    case 'text':
                      return (
                        <li key={i}>
                          <Markdown text={it.text} />
                        </li>
                      );
                    case 'tool':
                      return (
                        <li key={i}>
                          {it.output ? (
                            <details>
                              <summary>
                                {t('transcript.tool', { tool: it.tool })}
                                {it.ok !== undefined && ` — ${t(it.ok ? 'transcript.tool.ok' : 'transcript.tool.fail')}`}
                                <span className="orq-hint"> · {t('transcript.showOutput', { lines: lines(it.output) })}</span>
                              </summary>
                              <pre>{it.output}</pre>
                            </details>
                          ) : (
                            <strong>{t('transcript.tool', { tool: it.tool })}</strong>
                          )}
                        </li>
                      );
                    case 'question':
                      return <Question key={it.questionId} item={it} onAnswer={onAnswer} />;
                    case 'pass':
                      return <PassHeader key={i} item={it} labelOf={labelOf} />;
                    case 'retry':
                      return <li key={i}>{`${t(it.cause === 'timeout' ? 'transcript.retry.timeout' : it.cause === 'loop' ? 'transcript.retry.loop' : 'transcript.retry.error', { next: it.attempt + 1 })} — ${t('transcript.retry.detail', { attempt: it.attempt, message: it.message })}`}</li>;
                    case 'error':
                      return (
                        <li key={i} className="orq-t--error">
                          {t('transcript.error', { message: it.message })}
                        </li>
                      );
                    default:
                      return null;
                  }
                })}
              </ol>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
