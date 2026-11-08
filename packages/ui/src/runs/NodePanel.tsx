import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, Check, ChevronsRight, Loader2, Maximize2, MessageCircleQuestion, X as XIcon } from 'lucide-react';
import { MODELS, isApproval, type QuestionKind, type RunEvent } from '@orquestador/core';
import { pathKey } from '@orquestador/core';
import { conversationBlocks, filesSinceReview, questionGroup, stepFiles, stepOverview, t, toolTarget, transcriptItems, type LiveView, type MessageKey, type TranscriptItem } from '@orquestador/editor';
import { Markdown } from '../common';
import { ConflictCard } from './ConflictCard';
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
  /** Pliega el panel a una franja [R68.3]. */
  onFold?: () => void;
  /** «Ver la memoria completa»: abre la pestaña «Memoria» de la ejecución [R72.23]. */
  onMemory?: () => void;
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
export function permissionTarget(item: { text: string; ask?: QuestionKind | undefined }): string | undefined {
  if (questionGroup({ text: item.text, ...(item.ask ? { kind: item.ask } : {}) }) !== 'permission') return undefined;
  return /^¿Puedo modificar (.+)\?$/.exec(item.text.trim())?.[1];
}

export function Question({ item, onAnswer, closed = false, onOpenFile, reviewFiles, onPreview, renderThumb }: { item: Extract<TranscriptItem, { kind: 'question' }>; onAnswer: Props['onAnswer']; closed?: boolean; onOpenFile?: ((path: string) => void) | undefined; reviewFiles?: readonly { key: string; path: string }[]; onPreview?: Props['onPreview']; renderThumb?: Props['renderThumb'] }) {
  const [text, setText] = useState('');
  if (item.review) return <ReviewGateCard item={item} onAnswer={onAnswer} closed={closed} {...(reviewFiles ? { files: reviewFiles } : {})} {...(onPreview ? { onPreview } : {})} {...(renderThumb ? { renderThumb } : {})} />;
  if (item.confirm) return <ConfirmCard item={item} onAnswer={onAnswer} closed={closed} />;
  if (item.conflict) return <ConflictCard item={item} onAnswer={onAnswer} closed={closed} onPreview={onPreview} />;
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

export function NodePanel({ events, live, nodeId, nodePath, label, onAnswer, onExpand, closed = false, labelOf, onOpenFile, onPreview, renderThumb, onFold, onMemory }: Props) {
  const items = transcriptItems(events, nodeId, nodePath);
  const key = [...nodePath, nodeId].join('/');
  const status = live.nodeStatus[key];
  const files = stepFiles(events, pathKey(nodePath, nodeId));
  const state = filesState(status, closed);
  const view = stepOverview(events, nodeId, nodePath);
  const pending = !closed && items.some((it) => it.kind === 'question' && it.answer === undefined);
  // Con salida y sin preguntas pendientes, primero el resumen; si no, la conversación [R68.2].
  const [tab, setTab] = useState<'summary' | 'messages' | 'files'>(() => (view.output !== undefined && !pending ? 'summary' : 'messages'));
  // Si el paso te pregunta algo, la conversación pasa delante para no perder la pregunta [R68.2].
  useEffect(() => {
    if (pending) setTab('messages');
  }, [pending]);
  const shown = tab === 'files' && files.length === 0 ? 'messages' : tab;
  // Terminado bien: el bloque va tras la salida; si no, al final con su aviso [R45.9].
  const blocks = conversationBlocks(items);
  const lastOutput = state === 'done' ? blocks.map((it) => it.kind).lastIndexOf('output') : -1;
  const block = <StepFilesBlock files={files} state={state} onOpen={onOpenFile} />;
  const tone = stepTone(status);
  const metrics = stepMetrics(view);
  const health = closed ? undefined : live.health?.[key];
  return (
    <section className="orq-nodepanel" aria-label={t('transcript.title', { name: label })}>
      <div className="orq-nodepanel__head">
        <h3>{label}</h3>
        {onExpand && items.length > 0 && (
          <button type="button" className="orq-icon-btn" aria-label={t('detail.expand')} title={t('detail.expand')} onClick={onExpand}>
            <Maximize2 size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
        )}
        {onFold && (
          <button type="button" className="orq-icon-btn" aria-label={t('step.fold')} title={t('step.fold')} onClick={onFold}>
            <ChevronsRight size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
        )}
      </div>
      {/* Tarjeta de estado: color según cómo va y, si los hay, duración, tokens y coste [R68.1]. */}
      {status && (
        <div className={`orq-stepstate is-${tone}`}>
          <p className="orq-stepstate__title">
            <StepIcon tone={tone} />
            {t(`node.status.${status}` as MessageKey)}
          </p>
          {/* Sin señales de vida, o cortado y a punto de reintentarse [R70.20]. */}
          {health && (
            <p className="orq-stepstate__health" role="status">
              {health.cut ? t(`step.health.cut.${health.cut}` as MessageKey) : t('step.health.stalled', { n: health.stalledMinutes ?? 0 })}
            </p>
          )}
          {metrics.length > 0 && (
            <p className="orq-stepstate__metrics">
              {metrics.map((m) => (
                <span key={m}>{m}</span>
              ))}
            </p>
          )}
        </div>
      )}
      <div className="orq-run__tabs orq-nodepanel__tabs" role="tablist" aria-label={t('files.tabs')}>
        <button type="button" role="tab" aria-selected={shown === 'summary'} onClick={() => setTab('summary')}>
          {t('step.tab.summary')}
        </button>
        <button type="button" role="tab" aria-selected={shown === 'messages'} onClick={() => setTab('messages')}>
          {t('step.tab.conversation', { count: items.length })}
        </button>
        {files.length > 0 && (
          <button type="button" role="tab" aria-selected={shown === 'files'} onClick={() => setTab('files')}>
            {t('files.tab.files', { count: files.length })}
          </button>
        )}
      </div>
      {shown === 'summary' ? (
        <div className="orq-nodepanel__summary">
          {view.output !== undefined ? <Markdown text={view.output} /> : <p className="orq-hint">{t('step.summary.none')}</p>}
          {items.length > 0 && (
            <button type="button" className="orq-link orq-nodepanel__more" onClick={() => setTab('messages')}>
              {t('step.summary.all')} →
            </button>
          )}
        </div>
      ) : shown === 'files' ? (
        <div className="orq-nodepanel__files">
          {block}
          <p className="orq-hint">{t('files.only')}</p>
        </div>
      ) : items.length === 0 ? (
        <p className="orq-hint">{t('transcript.empty')}</p>
      ) : (
        <ol className="orq-transcript">
          {blocks.map((it, i) => {
            switch (it.kind) {
              case 'input':
                return (
                  <li key={i} className="orq-t orq-t--input">
                    <details open className="orq-t__fold">
                      <summary>
                        <strong>{inputTitle(it)}</strong>
                      </summary>
                      <Markdown text={it.text} />
                      {it.memory && (
                        <details className="orq-t__memory">
                          <summary>{t('transcript.memory')}</summary>
                          <pre>{it.memory}</pre>
                          {/* Qué bloques se recortaron y la memoria entera [R72.23]. */}
                          {it.memoryTrimmed && <p className="orq-hint">{t('transcript.memory.trimmed', { blocks: it.memoryTrimmed.map((b) => t(`mem.block.${b}` as MessageKey)).join(', ') })}</p>}
                          {onMemory && (
                            <button type="button" className="orq-link" onClick={onMemory}>
                              {t('transcript.memory.all')}
                            </button>
                          )}
                        </details>
                      )}
                      {it.previous && (
                        <details className="orq-t__memory">
                          <summary>{t('transcript.previous')}</summary>
                          <pre>{it.previous}</pre>
                        </details>
                      )}
                    </details>
                  </li>
                );
              case 'text':
                // Lo que dice el agente, con su inicial y su nombre [R69.1].
                return (
                  <li key={i} className="orq-t orq-t--text">
                    <span className="orq-t__av" aria-hidden="true">
                      {label.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="orq-t__msg">
                      <span className="orq-t__who">{label}</span>
                      <Markdown text={it.text} />
                    </div>
                  </li>
                );
              case 'tools':
                return <ToolGroup key={i} tools={it.tools} />;
              case 'question':
                return <Question key={it.questionId} item={it} onAnswer={onAnswer} closed={closed} onOpenFile={onOpenFile} {...(it.review?.phase === 'feedback' ? { reviewFiles: filesSinceReview(events, nodeId, nodePath, it.questionId) } : {})} {...(onPreview ? { onPreview } : {})} {...(renderThumb ? { renderThumb } : {})} />;
              case 'note':
                // La nota que dejó para los siguientes pasos [R72.24].
                return (
                  <li key={i} className="orq-t orq-t--note">
                    <div className="orq-t__card">
                      <strong>{t('transcript.note')}</strong>
                      <Markdown text={it.text} />
                      <p className="orq-hint">{t('transcript.note.hint')}</p>
                    </div>
                  </li>
                );
              case 'retry':
                // Separador del reintento: por qué se repite y, desplegado, el error [R71.15].
                return (
                  <li key={i} className="orq-t orq-t--retry">
                    <details className="orq-t__fold">
                      <summary>
                        <strong>{t(it.cause === 'timeout' ? 'transcript.retry.timeout' : it.cause === 'loop' ? 'transcript.retry.loop' : 'transcript.retry.error', { next: it.attempt + 1 })}</strong>
                      </summary>
                      <p>{t('transcript.retry.detail', { attempt: it.attempt, message: it.message })}</p>
                    </details>
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
                  <li key={i} className={`orq-t orq-t--output is-${stepTone(it.status)}`}>
                    <strong>{t('transcript.output', { status: t(`node.status.${it.status}` as MessageKey) })}</strong>
                    {it.text && <Markdown text={it.text} />}
                    {i === lastOutput && files.length > 0 && block}
                  </li>
                );
              default:
                return null;
            }
          })}
          {lastOutput === -1 && files.length > 0 && <li className="orq-t orq-t--files">{block}</li>}
        </ol>
      )}
    </section>
  );
}

type StepTone = 'ok' | 'fail' | 'busy' | 'ask' | 'idle';

/** Color de la tarjeta de estado de un paso [R68.1]. */
export function stepTone(status: string | undefined): StepTone {
  if (status === 'succeeded') return 'ok';
  if (status === 'failed' || status === 'interrupted') return 'fail';
  if (status === 'waiting_input') return 'ask';
  if (status === 'running' || status === 'queued') return 'busy';
  return 'idle';
}

function StepIcon({ tone, size = 15 }: { tone: StepTone; size?: number }) {
  const p = { size, strokeWidth: 2.2, 'aria-hidden': true } as const;
  if (tone === 'ok') return <Check {...p} />;
  if (tone === 'fail') return <XIcon {...p} />;
  if (tone === 'ask') return <MessageCircleQuestion {...p} />;
  if (tone === 'busy') return <Loader2 {...p} className="orq-spin" />;
  return <AlertTriangle {...p} />;
}

/** Duración, tokens y coste en el formato del panel [R68.1]. */
function stepMetrics(v: ReturnType<typeof stepOverview>): string[] {
  const out: string[] = [];
  if (v.durationMs !== undefined) {
    const total = Math.round(v.durationMs / 1000);
    out.push(total < 60 ? t('step.duration.s', { s: total }) : t('step.duration.m', { m: Math.floor(total / 60), s: total % 60 }));
  }
  if (v.hasUsage) {
    out.push(t('step.tokens', { n: v.tokens.toLocaleString('es-ES') }));
    out.push(t('step.cost', { cost: v.costUsd.toFixed(3).replace('.', ',') }));
  }
  return out;
}

/** El panel plegado: una franja con el estado, el nombre y el coste; al pulsarla se despliega [R68.3]. */
export function FoldedStep({ events, live, nodeId, nodePath, label, onUnfold }: { events: readonly RunEvent[]; live: LiveView; nodeId: string; nodePath: string[]; label: string; onUnfold: () => void }) {
  const status = live.nodeStatus[[...nodePath, nodeId].join('/')];
  const tone = stepTone(status);
  const v = stepOverview(events, nodeId, nodePath);
  return (
    <button type="button" className={`orq-stepfold is-${tone}`} aria-label={t('step.unfold')} title={t('step.unfold')} onClick={onUnfold}>
      <span className="orq-stepfold__icon">
        <StepIcon tone={tone} size={14} />
      </span>
      <span className="orq-stepfold__label">{label}</span>
      {v.hasUsage && <span className="orq-stepfold__cost">{t('step.cost', { cost: v.costUsd.toFixed(3).replace('.', ',') })}</span>}
    </button>
  );
}

/** Herramientas seguidas en una fila plegable: cuántas, de qué tipo y si alguna falló [R69.1]. */
function ToolGroup({ tools }: { tools: readonly Extract<TranscriptItem, { kind: 'tool' }>[] }) {
  const counts = new Map<string, number>();
  for (const x of tools) counts.set(x.tool, (counts.get(x.tool) ?? 0) + 1);
  const kinds = [...counts].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(' · ');
  const failed = tools.filter((x) => x.ok === false).length;
  return (
    <li className="orq-t orq-t--tools">
      <details className="orq-t__tools">
        <summary>
          <span className="orq-t__toolsn">{t(tools.length === 1 ? 'transcript.tools.one' : 'transcript.tools.many', { count: tools.length })}</span>
          <span className="orq-t__toolskinds">{kinds}</span>
          {failed > 0 && <span className="orq-t__toolsfail">{t('transcript.tools.failed', { count: failed })}</span>}
        </summary>
        <ol>
          {tools.map((x, j) => {
            const target = toolTarget(x.input);
            return (
              <li key={j} className={`orq-t__tool${x.ok === false ? ' is-fail' : ''}`}>
                <span className="orq-t__toolmark" aria-hidden="true">
                  {x.ok === false ? '✕' : x.ok ? '✓' : '·'}
                </span>
                <span className="orq-t__toolbody">
                  <strong>{t('transcript.tool', { tool: x.tool })}</strong>
                  {x.ok !== undefined && <span className="orq-sr"> — {x.ok ? t('transcript.tool.ok') : t('transcript.tool.fail')}</span>}
                  {target && <code className="orq-t__target">{target}</code>}
                  {x.output && (
                    <details>
                      <summary>{t('transcript.showOutput', { lines: x.output.split('\n').length })}</summary>
                      <pre>{x.output}</pre>
                    </details>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      </details>
    </li>
  );
}
