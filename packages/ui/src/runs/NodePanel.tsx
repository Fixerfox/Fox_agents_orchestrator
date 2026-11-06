import { useState, type ReactNode } from 'react';
import { Maximize2 } from 'lucide-react';
import { MODELS, isApproval, type RunEvent } from '@orquestador/core';
import { pathKey } from '@orquestador/core';
import { filesSinceReview, questionGroup, stepFiles, t, transcriptItems, type LiveView, type MessageKey, type TranscriptItem } from '@orquestador/editor';
import { Markdown } from '../common';
import { StepFilesBlock } from './RunFiles';

interface Props {
  events: readonly RunEvent[];
  live: LiveView;
  nodeId: string;
  nodePath: string[];
  label: string;
  onAnswer: (questionId: string, text: string) => void;
  /** Abre la ventana grande del nodo [R15.12]. */
  onExpand?: () => void;
  /** La ejecución ya no está en marcha: las preguntas sin responder no se pueden contestar [R35.14]. */
  closed?: boolean;
  /** Nombre de otro nodo del mismo nivel (la revisión que devolvió una pasada) [R15.14]. */
  labelOf?: (nodeId: string) => string;
  /** Abre un fichero de la ejecución en el visor [R45.9]. */
  onOpenFile?: (path: string) => void;
  /** Abre en grande la vista previa de un archivo de un paso [R54.6]. */
  onPreview?: (key: string, path: string) => void;
  /** Miniatura de un archivo de un paso [R54.6]. */
  renderThumb?: (key: string, path: string) => ReactNode;
}

/** Miniaturas que se ven en la tarjeta de una revisión humana [R54.6]. */
const REVIEW_THUMBS = 4;

/** Encabezado de una pasada a partir de la segunda: quién la devolvió y por qué [R15.14]. */
export function PassHeader({ item, labelOf }: { item: Extract<TranscriptItem, { kind: 'pass' }>; labelOf?: ((nodeId: string) => string) | undefined }) {
  return (
    <li className="orq-t orq-t--pass" role="separator" aria-label={t('transcript.pass', { n: item.n })}>
      <strong>{item.by !== undefined ? t('transcript.passReturned', { n: item.n, by: labelOf?.(item.by) ?? item.by }) : t('transcript.pass', { n: item.n })}</strong>
      {item.reason && <p>{t('transcript.passReason', { reason: item.reason })}</p>}
    </li>
  );
}

/** «Recibió (intento M)» o, si hubo varias pasadas, «Recibió (pasada N, intento M)» [R15.14]. */
export const inputTitle = (it: Extract<TranscriptItem, { kind: 'input' }>): string => {
  const title = it.pass !== undefined ? t('transcript.inputPass', { pass: it.pass, attempt: it.attempt }) : t('transcript.input', { attempt: it.attempt });
  // Con modelo propio del paso, se dice cuál usó [R40.6].
  return it.model ? t('transcript.model', { title, model: MODELS.find((m) => m.id === it.model)?.name ?? it.model }) : title;
};

/** Confirmación del paso: resumen en Markdown, «Aprobar» o pedir cambios por el chat [R43.8]. */
export function ConfirmCard({ item, onAnswer, closed = false }: { item: Extract<TranscriptItem, { kind: 'question' }>; onAnswer: Props['onAnswer']; closed?: boolean }) {
  const [text, setText] = useState('');
  const round = item.confirm?.round ?? 1;
  return (
    <li className="orq-chat orq-chat--question orq-confirm" aria-label={t('confirm.title')}>
      <div className="orq-confirm__head">
        <strong>{t('confirm.title')}</strong>
        {round > 1 && <span className="orq-hint">{t('confirm.round', { n: round })}</span>}
      </div>
      <div className="orq-confirm__doc">
        <Markdown text={item.text} />
      </div>
      {item.answer !== undefined ? (
        <p className="orq-chat__answer">{isApproval(item.answer) ? t('confirm.approved') : t('confirm.asked', { text: item.answer })}</p>
      ) : closed ? (
        <p className="orq-hint">{t('chat.closed')}</p>
      ) : (
        <form
          className="orq-confirm__reply"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim() === '') return;
            onAnswer(item.questionId, text.trim());
            setText('');
          }}
        >
          <button type="button" className="orq-btn orq-btn--primary" onClick={() => onAnswer(item.questionId, t('confirm.approve'))}>
            {t('confirm.approve')}
          </button>
          <label>
            {t('confirm.changes')}
            <textarea rows={2} value={text} placeholder={t('confirm.changes.hint')} onChange={(e) => setText(e.target.value)} />
          </label>
          <button type="submit" className="orq-btn" disabled={text.trim() === ''}>
            {t('confirm.send')}
          </button>
        </form>
      )}
    </li>
  );
}

/**
 * Revisión humana en el chat del nodo: «Revisa antes de seguir» (aprobar o pedir cambios) o «¿A qué paso lo mando?»
 * con la propuesta del asistente y un botón por paso [R53.15].
 */
export function ReviewGateCard({ item, onAnswer, closed = false, files = [], onPreview, renderThumb }: { item: Extract<TranscriptItem, { kind: 'question' }>; onAnswer: Props['onAnswer']; closed?: boolean; files?: readonly { key: string; path: string }[]; onPreview?: Props['onPreview']; renderThumb?: Props['renderThumb'] }) {
  const [text, setText] = useState('');
  const r = item.review!;
  const round = <span className="orq-hint">{t('hreview.round', { n: r.round, max: r.max })}</span>;
  if (r.phase === 'route') {
    const name = (id: string) => r.candidates?.find((c) => c.nodeId === id)?.label ?? id;
    return (
      <li className="orq-chat orq-chat--question orq-confirm orq-hreview" aria-label={t('hreview.route')}>
        <div className="orq-confirm__head">
          <strong>{t('hreview.route')}</strong>
          {round}
        </div>
        {r.proposal && (
          <p>
            {t('hreview.route.proposal', { node: name(r.proposal) })} {r.reason}
          </p>
        )}
        {item.answer !== undefined ? (
          <p className="orq-chat__answer">{t('hreview.route.chosen', { node: item.answer })}</p>
        ) : closed ? (
          <p className="orq-hint">{t('chat.closed')}</p>
        ) : (
          <div className="orq-hreview__choices">
            {(item.options ?? []).map((o, i) => (
              <button key={o} type="button" className={`orq-btn orq-btn--small${i === 0 ? ' orq-btn--primary' : ''}`} onClick={() => onAnswer(item.questionId, o)}>
                {o}
                {i === 0 && <span className="orq-hreview__rec">{t('hreview.route.recommended')}</span>}
              </button>
            ))}
          </div>
        )}
      </li>
    );
  }
  return (
    <li className="orq-chat orq-chat--question orq-confirm orq-hreview" aria-label={t('hreview.title')}>
      <div className="orq-confirm__head">
        <strong>{t('hreview.title')}</strong>
        {round}
      </div>
      {files.length > 0 && (
        // Lo que han hecho los pasos desde la última revisión, a la vista [R54.6].
        <div className="orq-hreview__files" role="list" aria-label={t('hreview.files')}>
          {files.slice(0, REVIEW_THUMBS).map((f) => (
            <button key={`${f.key}|${f.path}`} type="button" role="listitem" className="orq-hreview__thumb" title={f.path} aria-label={t('node.files.open', { path: f.path })} disabled={!onPreview} onClick={() => onPreview?.(f.key, f.path)}>
              {renderThumb && <span className="orq-hreview__thumbview">{renderThumb(f.key, f.path)}</span>}
              <span className="orq-hreview__thumbname">{f.path.split('/').pop()}</span>
            </button>
          ))}
          {files.length > REVIEW_THUMBS && <span className="orq-hint">{t('hreview.files.more', { count: files.length - REVIEW_THUMBS })}</span>}
        </div>
      )}
      <div className="orq-confirm__doc">
        <Markdown text={item.text} />
      </div>
      {item.answer !== undefined ? (
        <p className="orq-chat__answer">{isApproval(item.answer) ? t('hreview.approved') : t('hreview.asked', { text: item.answer })}</p>
      ) : closed ? (
        <p className="orq-hint">{t('chat.closed')}</p>
      ) : (
        <form
          className="orq-confirm__reply"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim() === '') return;
            onAnswer(item.questionId, text.trim());
            setText('');
          }}
        >
          <button type="button" className="orq-btn orq-btn--primary" onClick={() => onAnswer(item.questionId, t('confirm.approve'))}>
            {t('hreview.approve')}
          </button>
          <label>
            {t('hreview.changes')}
            <textarea rows={2} value={text} placeholder={t('hreview.changes.hint')} onChange={(e) => setText(e.target.value)} />
          </label>
          <button type="submit" className="orq-btn" disabled={text.trim() === ''}>
            {t('hreview.send')}
          </button>
        </form>
      )}
    </li>
  );
}

/** Fichero por el que pide permiso para modificar, si la pregunta es de ese tipo [R45.9]. */
export function permissionTarget(item: { text: string; ask?: 'question' | 'permission' | 'gate' }): string | undefined {
  if (questionGroup({ text: item.text, ...(item.ask ? { kind: item.ask } : {}) }) !== 'permission') return undefined;
  return /^¿Puedo modificar (.+)\?$/.exec(item.text.trim())?.[1];
}

export function Question({ item, onAnswer, closed = false, onOpenFile, reviewFiles, onPreview, renderThumb }: { item: Extract<TranscriptItem, { kind: 'question' }>; onAnswer: Props['onAnswer']; closed?: boolean; onOpenFile?: ((path: string) => void) | undefined; reviewFiles?: readonly { key: string; path: string }[]; onPreview?: Props['onPreview']; renderThumb?: Props['renderThumb'] }) {
  const [text, setText] = useState('');
  if (item.review) return <ReviewGateCard item={item} onAnswer={onAnswer} closed={closed} {...(reviewFiles ? { files: reviewFiles } : {})} {...(onPreview ? { onPreview } : {})} {...(renderThumb ? { renderThumb } : {})} />;
  if (item.confirm) return <ConfirmCard item={item} onAnswer={onAnswer} closed={closed} />;
  const target = item.answer === undefined && !closed ? permissionTarget(item) : undefined;
  return (
    <li className="orq-chat orq-chat--question">
      <strong>{t('chat.question')}</strong>
      <Markdown text={item.text} />
      {target && onOpenFile && (
        <button type="button" className="orq-btn orq-btn--small orq-btn--ghost" onClick={() => onOpenFile(target)}>
          {t('files.peek', { path: target })}
        </button>
      )}
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
          <label>
            {t('chat.reply')}
            <input value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <button
            type="button"
            disabled={text.trim() === ''}
            onClick={() => {
              onAnswer(item.questionId, text.trim());
              setText('');
            }}
          >
            {t('chat.send')}
          </button>
        </div>
      )}
    </li>
  );
}

/** Panel lateral de un nodo: transcripción en directo y chat con el agente (R15.2, R18.12). */
/** Si el paso terminó bien, sigue o se quedó sin terminar, para titular sus ficheros [R45.9]. */
export function filesState(status: string | undefined, closed: boolean): 'done' | 'running' | 'unfinished' {
  if (status === 'succeeded') return 'done';
  if (!closed && (status === 'running' || status === 'waiting_input' || status === 'queued')) return 'running';
  return 'unfinished';
}

export function NodePanel({ events, live, nodeId, nodePath, label, onAnswer, onExpand, closed = false, labelOf, onOpenFile, onPreview, renderThumb }: Props) {
  const [tab, setTab] = useState<'messages' | 'files'>('messages');
  const items = transcriptItems(events, nodeId, nodePath);
  const key = [...nodePath, nodeId].join('/');
  const status = live.nodeStatus[key];
  const files = stepFiles(events, pathKey(nodePath, nodeId));
  const state = filesState(status, closed);
  // Terminado bien: el bloque va tras la salida; si no, al final con su aviso [R45.9].
  const lastOutput = state === 'done' ? items.map((it) => it.kind).lastIndexOf('output') : -1;
  const block = <StepFilesBlock files={files} state={state} onOpen={onOpenFile} />;
  return (
    <section className="orq-nodepanel" aria-label={t('transcript.title', { name: label })}>
      <div className="orq-nodepanel__head">
        <h3>{t('transcript.title', { name: label })}</h3>
        {onExpand && items.length > 0 && (
          <button type="button" className="orq-icon-btn" aria-label={t('detail.expand')} title={t('detail.expand')} onClick={onExpand}>
            <Maximize2 size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
        )}
      </div>
      {status && <p className="orq-hint">{t(`node.status.${status}` as MessageKey)}</p>}
      {files.length > 0 && (
        <div className="orq-run__tabs orq-nodepanel__tabs" role="tablist" aria-label={t('files.tabs')}>
          <button type="button" role="tab" aria-selected={tab === 'messages'} onClick={() => setTab('messages')}>
            {t('files.tab.messages')}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'files'} onClick={() => setTab('files')}>
            {t('files.tab.files', { count: files.length })}
          </button>
        </div>
      )}
      {tab === 'files' && files.length > 0 ? (
        <div className="orq-nodepanel__files">
          {block}
          <p className="orq-hint">{t('files.only')}</p>
        </div>
      ) : items.length === 0 ? (
        <p className="orq-hint">{t('transcript.empty')}</p>
      ) : (
        <ol className="orq-transcript">
          {items.map((it, i) => {
            switch (it.kind) {
              case 'input':
                return (
                  <li key={i} className="orq-t orq-t--input">
                    <strong>{inputTitle(it)}</strong>
                    <Markdown text={it.text} />
                    {it.memory && (
                      <details className="orq-t__memory">
                        <summary>{t('transcript.memory')}</summary>
                        <pre>{it.memory}</pre>
                      </details>
                    )}
                  </li>
                );
              case 'text':
                return (
                  <li key={i} className="orq-t orq-t--text">
                    <Markdown text={it.text} />
                  </li>
                );
              case 'tool':
                return (
                  <li key={i} className="orq-t orq-t--tool">
                    <strong>{t('transcript.tool', { tool: it.tool })}</strong>
                    {it.ok !== undefined && <span> — {it.ok ? t('transcript.tool.ok') : t('transcript.tool.fail')}</span>}
                    {it.output && (
                      <details>
                        <summary>{t('transcript.showOutput', { lines: it.output.split('\n').length })}</summary>
                        <pre>{it.output}</pre>
                      </details>
                    )}
                  </li>
                );
              case 'question':
                return <Question key={it.questionId} item={it} onAnswer={onAnswer} closed={closed} onOpenFile={onOpenFile} {...(it.review?.phase === 'feedback' ? { reviewFiles: filesSinceReview(events, nodeId, nodePath, it.questionId) } : {})} {...(onPreview ? { onPreview } : {})} {...(renderThumb ? { renderThumb } : {})} />;
              case 'retry':
                return (
                  <li key={i} className="orq-t orq-t--retry">
                    {t('transcript.retry', { attempt: it.attempt, max: it.max, message: it.message })}
                  </li>
                );
              case 'pass':
                return <PassHeader key={i} item={it} labelOf={labelOf} />;
              case 'error':
                return (
                  <li key={i} className="orq-t orq-t--error">
                    {t('transcript.error', { message: it.message })}
                  </li>
                );
              case 'usage':
                return (
                  <li key={i} className="orq-t orq-t--usage">
                    {t('transcript.usage', { input: it.inputTokens, output: it.outputTokens, cost: it.costUsd.toFixed(3).replace('.', ',') })}
                  </li>
                );
              case 'output':
                return (
                  <li key={i} className="orq-t orq-t--output">
                    <strong>{t('transcript.output', { status: t(`node.status.${it.status}` as MessageKey) })}</strong>
                    {it.text && <Markdown text={it.text} />}
                    {i === lastOutput && files.length > 0 && block}
                  </li>
                );
            }
          })}
          {lastOutput === -1 && files.length > 0 && <li className="orq-t orq-t--files">{block}</li>}
        </ol>
      )}
    </section>
  );
}
