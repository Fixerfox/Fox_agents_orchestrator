import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Copy, FileText, Maximize2, Minimize2, X } from 'lucide-react';
import { MODELS, type AgentSnapshot, type RunEvent } from '@orquestador/core';
import { approxTokensLabel, requestKnowledge, t, type EdgeTraversal, type KnowledgeOrigin, type KnowledgeRow } from '@orquestador/editor';
import { Markdown } from '../common';

type RequestEvent = Extract<RunEvent, { type: 'agent.request' }>;
type Tab = 'sent' | 'ctx' | 'log';

export interface EdgeInspectorProps {
  traversals: readonly EdgeTraversal[];
  fromName: string;
  toName: string;
  /** El destino es un nodo `agent` [R42.10]. */
  toIsAgent: boolean;
  /** Punto de pantalla donde se pulsó el hilo. */
  at: { x: number; y: number };
  /** Nombres de skills, contextos y MCP por id. */
  names?: Readonly<Record<string, string>>;
  onClose: () => void;
  /** «Ir a <destino>»: abre el detalle del paso [R42.9]. */
  onOpenTarget?: () => void;
}

const CARD_W = 400;
const time = (ts: string): string => {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};
const modelName = (id: string | undefined): string | undefined => (id ? (MODELS.find((m) => m.id === id)?.name ?? id) : undefined);
const firstLine = (text: string, max = 80): string => {
  const line = text.split('\n').find((l) => l.trim()) ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

/** Tarjeta sobre un hilo del lienzo: qué se envió y con qué contexto arrancó el destino; se amplía [R42.6–R42.10]. */
export function EdgeInspector({ traversals, fromName, toName, toIsAgent, at, names = {}, onClose, onOpenTarget }: EdgeInspectorProps) {
  const [big, setBig] = useState(false);
  const [tab, setTab] = useState<Tab>('sent');
  const [picked, setPicked] = useState<number>();
  const [copied, setCopied] = useState(false);
  // Por defecto la última vez; si llegan más mientras se mira, se sigue mostrando la elegida [R42.6][R42.7].
  const cur = traversals.find((x) => x.n === picked) ?? traversals[traversals.length - 1];
  const req: RequestEvent | undefined = cur?.requests[0];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const label = t('edgeInspect.aria', { from: fromName, to: toName });
  const style = big
    ? undefined
    : {
        left: Math.max(8, Math.min(at.x - CARD_W / 2, (typeof window !== 'undefined' ? window.innerWidth : 1280) - CARD_W - 8)),
        top: Math.max(8, Math.min(at.y + 14, (typeof window !== 'undefined' ? window.innerHeight : 800) - 120)),
      };

  const copyText = tab === 'log' && req ? JSON.stringify(req, null, 2) : (cur?.sent?.text ?? '');
  const copy = () => {
    void navigator.clipboard?.writeText(copyText).then(
      () => setCopied(true),
      () => {},
    );
  };

  return (
    <div role="dialog" aria-label={label} className={`orq-einsp${big ? ' is-big' : ''} nodrag nopan nowheel`} style={style} onClick={(e) => e.stopPropagation()}>
      <header className="orq-einsp__head">
        <div className="orq-einsp__title">
          <strong>
            {fromName} <ArrowRight size={14} aria-hidden="true" className="orq-einsp__arrow" /> {toName}
          </strong>
          {cur && (
            <span className="orq-einsp__sub">
              {[t('edgeInspect.at', { time: time(cur.ts) }), cur.pass && cur.pass > 1 ? t('edgeInspect.pass', { n: cur.pass }) : '', cur.requests.length > 1 ? t('edgeInspect.attempts', { n: cur.requests.length }) : ''].filter(Boolean).join(' · ')}
            </span>
          )}
        </div>
        {traversals.length > 1 && (
          <div className="orq-einsp__seg" role="group" aria-label={t('edgeInspect.which')}>
            {traversals.map((x) => (
              <button key={x.n} type="button" aria-pressed={x === cur} className={x === cur ? 'is-on' : ''} onClick={() => setPicked(x.n)}>
                {t('edgeInspect.nth', { n: x.n })}
              </button>
            ))}
          </div>
        )}
        {cur && (
          <button type="button" className="orq-einsp__icon" aria-label={big ? t('edgeInspect.shrink') : t('edgeInspect.expand')} title={big ? t('edgeInspect.shrink') : t('edgeInspect.expand')} onClick={() => setBig(!big)}>
            {big ? <Minimize2 size={15} aria-hidden="true" /> : <Maximize2 size={15} aria-hidden="true" />}
          </button>
        )}
        <button type="button" className="orq-einsp__icon" aria-label={t('edgeInspect.close')} title={t('edgeInspect.close')} onClick={onClose}>
          <X size={15} aria-hidden="true" />
        </button>
      </header>

      {!cur ? (
        <p className="orq-einsp__empty">{t('edgeInspect.none')}</p>
      ) : big ? (
        <>
          <div className="orq-einsp__tabs" role="tablist" aria-label={t('edgeInspect.tabs')}>
            {(['sent', 'ctx', 'log'] as const).map((id) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'is-on' : ''} onClick={() => setTab(id)}>
                {id === 'ctx' ? t('edgeInspect.tab.ctx', { to: toName }) : t(`edgeInspect.tab.${id}`)}
              </button>
            ))}
          </div>
          <div className="orq-einsp__body" role="tabpanel">
            {tab === 'sent' && <SentFull cur={cur} toName={toName} />}
            {tab === 'ctx' && (toIsAgent ? <Context cur={cur} req={req} toName={toName} names={names} full /> : <p className="orq-hint">{t('edgeInspect.notAgent', { to: toName })}</p>)}
            {tab === 'log' && (
              <>
                <p className="orq-hint">{t('edgeInspect.logHint')}</p>
                {cur.requests.length > 0 ? (
                  cur.requests.map((r) => (
                    <section key={r.seq} className="orq-einsp__log">
                      {cur.requests.length > 1 && <h4>{t('edgeInspect.attempt', { n: r.attempt })}</h4>}
                      <pre>{JSON.stringify(r, null, 2)}</pre>
                    </section>
                  ))
                ) : (
                  <pre className="orq-einsp__log">{JSON.stringify({ sent: cur.sent, received: cur.received }, null, 2)}</pre>
                )}
              </>
            )}
          </div>
          <footer className="orq-einsp__foot">
            <button type="button" className="orq-btn" onClick={copy}>
              <Copy size={14} aria-hidden="true" /> {copied ? t('edgeInspect.copied') : t('edgeInspect.copy')}
            </button>
            {onOpenTarget && (
              <button type="button" className="orq-btn" onClick={onOpenTarget}>
                {t('edgeInspect.go', { to: toName })}
              </button>
            )}
            <span className="orq-einsp__resize">{t('edgeInspect.resize')}</span>
          </footer>
        </>
      ) : (
        <>
          <div className="orq-einsp__body">
            <SentShort cur={cur} />
            {cur.state === 'waiting' ? (
              <p className="orq-hint">{t('edgeInspect.waiting', { to: toName })}</p>
            ) : toIsAgent ? (
              <Context cur={cur} req={req} toName={toName} names={names} />
            ) : (
              <p className="orq-hint">{t('edgeInspect.notAgent', { to: toName })}</p>
            )}
          </div>
          <footer className="orq-einsp__foot">
            <button type="button" className="orq-btn orq-btn--primary" onClick={() => setBig(true)}>
              {t('edgeInspect.expand')}
            </button>
            <button type="button" className="orq-btn" onClick={copy}>
              <Copy size={14} aria-hidden="true" /> {copied ? t('edgeInspect.copied') : t('edgeInspect.copy')}
            </button>
          </footer>
        </>
      )}
    </div>
  );
}

function Files({ files }: { files: readonly string[] }) {
  if (files.length === 0) return null;
  return (
    <ul className="orq-einsp__files" aria-label={t('edgeInspect.files')}>
      {files.map((f) => (
        <li key={f}>
          <FileText size={12} aria-hidden="true" /> {f}
        </li>
      ))}
    </ul>
  );
}

function SentShort({ cur }: { cur: EdgeTraversal }) {
  const text = cur.sent?.text ?? '';
  return (
    <section aria-label={cur.kind === 'return' ? t('edgeInspect.sentReturn') : t('edgeInspect.sent')}>
      <div className="orq-einsp__lbl">
        <span>{cur.kind === 'return' ? t('edgeInspect.sentReturn') : t('edgeInspect.sent')}</span>
        <span>{approxTokensLabel(text)}</span>
      </div>
      <div className="orq-einsp__excerpt">{text.trim() ? <Markdown text={text} /> : <p className="orq-hint">{t('edgeInspect.empty')}</p>}</div>
      <Files files={cur.sent?.files ?? []} />
    </section>
  );
}

function SentFull({ cur, toName }: { cur: EdgeTraversal; toName: string }) {
  const text = cur.sent?.text ?? '';
  return (
    <>
      <div className="orq-einsp__chips">
        <span className="orq-einsp__chip">{approxTokensLabel(text)}</span>
        {(cur.sent?.files ?? []).map((f) => (
          <span key={f} className="orq-einsp__chip">
            {f}
          </span>
        ))}
      </div>
      <div className="orq-einsp__doc">{text.trim() ? <Markdown text={text} /> : <p className="orq-hint">{t('edgeInspect.empty')}</p>}</div>
      {cur.combined && cur.received && (
        <section className="orq-einsp__recv">
          <h4>{t('edgeInspect.received', { to: toName })}</h4>
          <div className="orq-einsp__doc">
            <Markdown text={cur.received.text} />
          </div>
          <Files files={cur.received.files} />
        </section>
      )}
    </>
  );
}

const originClass: Record<KnowledgeOrigin, string> = { agent: '', diagram: ' is-diagram', node: ' is-node' };
function Origin({ origin }: { origin: KnowledgeOrigin }) {
  return <span className={`orq-einsp__src${originClass[origin]}`}>{t(`edgeInspect.origin.${origin}`)}</span>;
}

function Context({ cur, req, toName, names, full = false }: { cur: EdgeTraversal; req: RequestEvent | undefined; toName: string; names: Readonly<Record<string, string>>; full?: boolean }) {
  const rows = useMemo(() => (req ? requestKnowledge(req) : []), [req]);
  if (!req) return <p className="orq-hint">{cur.state === 'waiting' ? t('edgeInspect.waiting', { to: toName }) : t('edgeInspect.running', { to: toName })}</p>;
  const snap: AgentSnapshot = req.snapshot ?? {};
  const answers = req.previousAnswers ?? [];
  const of = (kind: KnowledgeRow['kind']) => rows.filter((r) => r.kind === kind);
  const isReturn = cur.kind === 'return';
  const model = modelName(req.model ?? snap.model);
  const modelOrigin: KnowledgeOrigin = req.model ? 'node' : 'agent';

  if (!full) {
    return (
      <section aria-label={t('edgeInspect.had', { to: toName })}>
        <div className="orq-einsp__lbl">
          <span>{t('edgeInspect.had', { to: toName })}</span>
          {model && <span>{model}</span>}
        </div>
        <ul className="orq-einsp__kv">
          <li>
            <span>{t('edgeInspect.instructions')}</span>
            <span>{snap.instructions ? `${snap.version ? `v${snap.version} · ` : ''}${approxTokensLabel(snap.instructions)}` : t('edgeInspect.none.list')}</span>
          </li>
          <li>
            <span>{t('edgeInspect.knowledge', { skills: of('skill').length, contexts: of('context').length, mcp: of('mcp').length })}</span>
            <span>{rows.map((r) => names[r.id] ?? r.id).join(', ')}</span>
          </li>
          <li className="is-step">
            <span>{t('edgeInspect.task')}</span>
            <span>{req.task ? `«${firstLine(req.task, 48)}»` : t('edgeInspect.noTask')}</span>
          </li>
          <li className={isReturn ? 'is-step' : ''}>
            <span>{isReturn ? t('edgeInspect.returned') : t('edgeInspect.answers')}</span>
            <span>{isReturn ? firstLine(cur.sent?.text ?? '', 48) : answers.length > 0 ? String(answers.length) : t('edgeInspect.noAnswers')}</span>
          </li>
        </ul>
      </section>
    );
  }

  const list = (kind: KnowledgeRow['kind']) =>
    of(kind).length === 0 ? (
      <span className="orq-hint">{t('edgeInspect.none.list')}</span>
    ) : (
      <ul className="orq-einsp__items">
        {of(kind).map((r) => (
          <li key={r.id}>
            {names[r.id] ?? r.id} <Origin origin={r.origin} />
          </li>
        ))}
      </ul>
    );
  return (
    <dl className="orq-einsp__ctx">
      <dt>{t('edgeInspect.model')}</dt>
      <dd>
        {model ?? '—'} {model && <Origin origin={modelOrigin} />}
      </dd>
      <dt>{t('edgeInspect.instructions')}</dt>
      <dd>{snap.instructions ? <div className="orq-einsp__doc"><Markdown text={snap.instructions} /></div> : <span className="orq-hint">{t('edgeInspect.none.list')}</span>}</dd>
      <dt>{t('edgeInspect.task')}</dt>
      <dd>
        {req.task ? (
          <>
            <Markdown text={req.task} /> <Origin origin="node" />
          </>
        ) : (
          <span className="orq-hint">{t('edgeInspect.noTask')}</span>
        )}
      </dd>
      {req.split && (
        <>
          <dt>{t('edgeInspect.split')}</dt>
          <dd>
            <div className="orq-einsp__doc">
              <Markdown text={req.split} />
            </div>
          </dd>
        </>
      )}
      <dt>{t('edgeInspect.skills')}</dt>
      <dd>{list('skill')}</dd>
      <dt>{t('edgeInspect.contexts')}</dt>
      <dd>{list('context')}</dd>
      <dt>{t('edgeInspect.mcp')}</dt>
      <dd>{list('mcp')}</dd>
      <dt>{t('edgeInspect.tools')}</dt>
      <dd>{snap.allowedTools && snap.allowedTools.length > 0 ? snap.allowedTools.join(', ') : <span className="orq-hint">{t('edgeInspect.none.list')}</span>}</dd>
      <dt>{isReturn ? t('edgeInspect.returned') : t('edgeInspect.answers')}</dt>
      <dd>
        {isReturn && cur.sent?.text ? <div className="orq-einsp__doc"><Markdown text={cur.sent.text} /></div> : null}
        {answers.length > 0 ? (
          <ul className="orq-einsp__items">
            {answers.map((a, i) => (
              <li key={i}>
                <strong>{a.question}</strong> — {a.answer}
              </li>
            ))}
          </ul>
        ) : (
          !isReturn && <span className="orq-hint">{t('edgeInspect.noAnswers')}</span>
        )}
      </dd>
    </dl>
  );
}
