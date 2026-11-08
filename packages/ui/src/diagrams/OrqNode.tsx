import { PrLink } from '../common';
import { AgentAvatar, AskFirstMark, HandMark, type AgentLook } from '../common';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { useState, type ReactNode } from 'react';
import { AlertTriangle, Bot, Boxes, Braces, Check, CircleDashed, CircleSlash, Eye, FileCode, FileText, GitBranch, GitCommitHorizontal, GitFork, GitMerge, GitPullRequest, Image as ImageIcon, Loader2, MessageCircleQuestion, Minus, Play, Repeat2, ShieldAlert, ShieldCheck, Square, Trash2, Upload, X } from 'lucide-react';
import { t, type LiveNodeStatus, type LoopInfo, type MessageKey, type ReviewInfo } from '@orquestador/editor';

const GIT_ICON: Readonly<Record<string, typeof Upload>> = { commit: GitCommitHorizontal, push: Upload, pr: GitPullRequest, merge: GitMerge, delete: Trash2, switch: GitBranch };

export interface OrqNodeData extends Record<string, unknown> {
  kind: 'entry' | 'output' | 'agent' | 'router' | 'loop' | 'review' | 'subdiagram' | 'transform';
  label: string;
  /** Subtítulo: agente asignado o modo del router o del bucle [R21.5]. */
  sub?: string;
  problems: string[];
  /** Icono del agente y si pregunta antes de actuar [R39.5][R39.9]. */
  look?: AgentLook;
  /** El agente de este paso te está preguntando [R39.6]. */
  asking?: boolean;
  /** Todos sus problemas son avisos de diagrama a medio montar [R32.10]. */
  warnOnly?: boolean;
  /** Tarea del nodo agente (cadena vacía: sin tarea) [R32.4]. */
  task?: string;
  /** Skills y contextos del agente, como fichas [R32.27]. */
  chips?: string[];
  /** Línea explicativa (entrada, salida, máximo del bucle) [R32.27]. */
  note?: string;
  /** Pasos dentro de un bucle [R32.27]. */
  inner?: string[];
  /** Varias entradas: espera a todas [R32.36]. */
  waits?: string;
  /** Estado en vivo (R15.1). */
  runStatus?: LiveNodeStatus;
  /** Vuelta actual y veredicto si es un bucle (R15.5). */
  loop?: LoopInfo;
  /** Última decisión si es una revisión [R34.24]. */
  review?: ReviewInfo;
  /** «+» de los conectores de conocimiento (arriba) y MCP (abajo) del agente [R33.10]. */
  onPort?: (port: 'know' | 'mcp') => void;
  /** Revisión en modo «Lo reviso yo»: lleva el ojo [R53.16]. */
  human?: boolean;
  /** Archivos que creó o cambió el paso en la ejecución [R54.1]. */
  files?: readonly NodeFile[];
  /** Lo que hizo en las ramas de git [R58.12]. */
  gitActions?: readonly string[];
  /** PR o merge request que creó [R58.15]. */
  prUrl?: string;
  /** Avisos del Supervisor [R60.9]. */
  alerts?: readonly string[];
  /** Abre los avisos de este paso [R60.40]. */
  onAlerts?: () => void;
  /** «Ampliar»: la vista previa en grande [R54.2]. */
  onOpenFile?: (path: string) => void;
  /** Vista previa pequeña de un archivo, en la tarjeta junto al nodo [R54.2]. */
  renderPreview?: (path: string) => ReactNode;
}
export type OrqFlowNode = Node<OrqNodeData, 'orq'>;

function AlertCount({ n }: { n: number }) {
  return (
    <>
      <ShieldAlert size={12} aria-hidden="true" />
      {n === 1 ? t('node.alerts.one') : t('node.alerts', { n })}
    </>
  );
}

export const KIND_ICON = { entry: Play, output: Square, agent: Bot, router: GitFork, loop: Repeat2, review: ShieldCheck, subdiagram: Boxes, transform: Braces } as const;

/** Salidas de la revisión con su símbolo, de arriba abajo; ✗ abajo para que el retorno no cruce las otras [R34.20]. */
const REVIEW_PORTS = [
  { id: 'approved', mark: '✓' },
  { id: 'exhausted', mark: '⏱' },
  { id: 'rejected', mark: '✗' },
] as const;
const STATUS_ICON: Record<LiveNodeStatus, typeof Check> = {
  queued: CircleDashed,
  running: Loader2,
  succeeded: Check,
  failed: X,
  skipped: Minus,
  cancelled: Minus,
  waiting_input: MessageCircleQuestion,
  idle: CircleDashed,
  interrupted: CircleSlash,
};

/** Nodo del lienzo: tarjeta enfocable con icono, nombre, subtítulo y estado [R14.11][R21.5]. */
export function OrqNode({ data, selected }: NodeProps<OrqFlowNode>) {
  const kind = t(`node.${data.kind}` as MessageKey);
  const count = data.problems.length;
  const base =
    count > 0
      ? t('node.aria.problems', { kind, name: data.label, count })
      : t('node.aria', { kind, name: data.label });
  const withStatus = data.runStatus ? t('node.aria.status', { base, status: t(`node.status.${data.runStatus}` as MessageKey) }) : base;
  const aria = [withStatus, data.look?.askFirst ? t('askfirst.mark') : '', data.asking ? t('hand.mark') : ''].filter(Boolean).join(', ');
  const Icon = data.human ? Eye : KIND_ICON[data.kind];
  const StatusIcon = data.runStatus ? STATUS_ICON[data.runStatus] : undefined;
  const fixed = data.kind === 'entry' || data.kind === 'output';
  return (
    <div
      className={`orq-node orq-node--${data.kind}${selected ? ' is-selected' : ''}${count > 0 ? (data.warnOnly ? ' has-warnings' : ' has-problems') : ''}${data.runStatus ? ` is-${data.runStatus}` : ''}`}
      data-run-status={data.runStatus}
      role="group"
      tabIndex={0}
      aria-label={aria}
      title={count > 0 ? data.problems.join('\n') : data.kind === 'loop' ? t('node.enter') : undefined}
    >
      {data.kind !== 'entry' && <Handle type="target" position={Position.Left} />}
      {data.look?.icon ? (
        <AgentAvatar name={data.label} icon={data.look.icon} tone={data.look.tone} className="orq-node__icon orq-node__av" />
      ) : (
        <span className="orq-node__icon" aria-hidden="true">
          <Icon size={16} strokeWidth={1.5} />
        </span>
      )}
      {(data.look?.askFirst || data.asking) && (
        <span className="orq-node__marks">
          {data.look?.askFirst && <AskFirstMark />}
          {data.asking && <HandMark size={15} />}
        </span>
      )}
      <span className="orq-node__text">
        <span className="orq-node__label">{data.label}</span>
        {!fixed && (
          <span className="orq-node__sub">
            {data.runStatus && StatusIcon ? (
              <span className="orq-state">
                <StatusIcon size={12} strokeWidth={1.5} aria-hidden="true" />
                {t(`node.status.${data.runStatus}` as MessageKey)}
              </span>
            ) : (
              data.sub
            )}
          </span>
        )}
        {data.task !== undefined && !data.runStatus && (
          <span className={`orq-node__task${data.task === '' ? ' is-empty' : ''}`}>{data.task === '' ? t('node.task.none') : data.task}</span>
        )}
        {data.inner && data.inner.length > 0 && !data.runStatus && (
          <span className="orq-node__inner">
            {data.inner.map((x) => (
              <span key={x} className="orq-node__chip">
                {x}
              </span>
            ))}
          </span>
        )}
        {data.chips && data.chips.length > 0 && (
          <span className="orq-node__chips">
            {data.chips.map((x) => (
              <span key={x} className="orq-node__chip">
                {x}
              </span>
            ))}
          </span>
        )}
        {data.note && <span className="orq-node__note">{data.note}</span>}
        {data.waits && <span className="orq-node__waits">{data.waits}</span>}
        {data.alerts &&
          (data.onAlerts ? (
            <button
              type="button"
              className="orq-node__alerts nodrag nopan"
              title={data.alerts.join('\n')}
              onClick={(e) => {
                e.stopPropagation();
                data.onAlerts!();
              }}
            >
              <AlertCount n={data.alerts.length} />
            </button>
          ) : (
            <span className="orq-node__alerts" title={data.alerts.join('\n')}>
              <AlertCount n={data.alerts.length} />
            </span>
          ))}
        {data.gitActions && (
          <span className="orq-node__git">
            {data.gitActions.map((a) => {
              const Mark = GIT_ICON[a] ?? GitCommitHorizontal;
              if (a === 'pr' && data.prUrl) return <PrLink key={a} url={data.prUrl} />;
              return (
                <span key={a}>
                  <Mark size={12} aria-hidden="true" />
                  {t(`git.action.${a}` as MessageKey)}
                </span>
              );
            })}
          </span>
        )}
        {data.review && (
          <span className={`orq-node__loop orq-node__review is-${data.review.verdict}`}>
            {t('node.review.round', { n: data.review.n, max: data.review.max })} · {t(`review.verdict.${data.review.verdict}` as MessageKey)}
          </span>
        )}
        {data.loop && (
          <span className="orq-node__loop">
            {t('node.loop.round', { n: data.loop.n, max: data.loop.max })} · {t(`node.loop.verdict.${data.loop.verdict}` as MessageKey)}
          </span>
        )}
      </span>
      {count > 0 && (
        <span className={`orq-node__problem${data.warnOnly ? ' is-warning' : ''}`} title={t(data.warnOnly ? 'node.problem.warning' : 'node.problem.icon')} aria-hidden="true">
          <AlertTriangle size={16} strokeWidth={1.5} />
        </span>
      )}
      {data.kind === 'review' ? (
        <span className="orq-node__ports">
          {REVIEW_PORTS.map((p) => {
            const label = t(`review.port.${p.id}` as MessageKey);
            return (
              <span key={p.id} className={`orq-port orq-port--${p.id}`}>
                <span className="orq-port__text" aria-hidden="true">
                  {p.mark} {label}
                </span>
                <Handle type="source" position={Position.Right} id={p.id} className={`orq-handle--${p.id}`} aria-label={t('review.port.aria', { port: label, name: data.label })} title={label} />
              </span>
            );
          })}
        </span>
      ) : (
        data.kind !== 'output' && <Handle type="source" position={Position.Right} />
      )}
      {data.kind === 'agent' && (
        <>
          <Handle id="know" type="target" position={Position.Top} isConnectable={false} className="orq-resport orq-resport--know" />
          <Handle id="mcp" type="target" position={Position.Bottom} isConnectable={false} className="orq-resport orq-resport--mcp" />
          {data.onPort && (
            <>
              <button type="button" className="orq-port__add orq-port__add--know nodrag nopan" onMouseDown={(e) => e.stopPropagation()} aria-label={t('res.add.know', { name: data.label })} title={t('res.add.know', { name: data.label })} onClick={(e) => (e.stopPropagation(), data.onPort!('know'))}>
                +
              </button>
              <button type="button" className="orq-port__add orq-port__add--mcp nodrag nopan" onMouseDown={(e) => e.stopPropagation()} aria-label={t('res.add.mcp', { name: data.label })} title={t('res.add.mcp', { name: data.label })} onClick={(e) => (e.stopPropagation(), data.onPort!('mcp'))}>
                +
              </button>
            </>
          )}
        </>
      )}
      {data.files && data.files.length > 0 && <NodeFiles files={data.files} name={data.label} {...(data.onOpenFile ? { onOpen: data.onOpenFile } : {})} {...(data.renderPreview ? { render: data.renderPreview } : {})} />}
    </div>
  );
}

/** Un archivo que hizo un paso: su ruta y si lo creó, lo cambió o lo borró [R54.1]. */
export interface NodeFile {
  path: string;
  change?: 'created' | 'modified' | 'deleted';
}

/** Cuántas fichas se ven antes de «+N» [R54.1]. */
export const NODE_FILES_SHOWN = 2;
const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i;
const WEB_RE = /\.(html?|css|js|mjs|tsx?|jsx|json)$/i;
export const fileKind = (path: string): 'image' | 'web' | 'doc' => (IMAGE_RE.test(path) ? 'image' : WEB_RE.test(path) ? 'web' : 'doc');
const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** Nombre corto de cada archivo; si dos se llaman igual, se antepone su carpeta (`es/index.html`) [R54.1]. */
export function shortNames(paths: readonly string[]): Map<string, string> {
  const count = new Map<string, number>();
  for (const p of paths) count.set(baseName(p), (count.get(baseName(p)) ?? 0) + 1);
  return new Map(paths.map((p) => [p, (count.get(baseName(p)) ?? 0) > 1 ? p.split('/').slice(-2).join('/') : baseName(p)]));
}

/**
 * Fichas debajo del nodo con los archivos que creó o cambió el paso; las dos primeras a la vista y «+N» despliega el
 * resto. Pulsar una abre su vista previa junto al nodo (o, sin vista previa, la abre directamente) [R54.1][R54.2].
 */
function NodeFiles({ files, name, onOpen, render }: { files: readonly NodeFile[]; name: string; onOpen?: (path: string) => void; render?: (path: string) => ReactNode }) {
  const [all, setAll] = useState(false);
  const [card, setCard] = useState<string>();
  const shown = all ? files : files.slice(0, NODE_FILES_SHOWN);
  const rest = files.length - shown.length;
  const names = shortNames(files.map((f) => f.path));
  const pick = (path: string) => (render ? setCard((c) => (c === path ? undefined : path)) : onOpen?.(path));
  return (
    <>
    {card !== undefined && render && (
      <section className="orq-node__card nodrag nopan nowheel" aria-label={t('node.files.card', { path: card })} onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <span title={card}>{baseName(card)}</span>
          <button type="button" className="orq-ib" aria-label={t('picker.close')} onClick={(e) => (e.stopPropagation(), setCard(undefined))}>
            <X size={12} aria-hidden="true" />
          </button>
        </header>
        <div className="orq-node__cardbody">{render(card)}</div>
        {onOpen && (
          <button type="button" className="orq-node__expand" onClick={(e) => (e.stopPropagation(), onOpen(card))}>
            {t('node.files.expand')}
          </button>
        )}
      </section>
    )}
    <div className="orq-node__files nodrag nopan" role="list" aria-label={t('node.files', { name })} onMouseDown={(e) => e.stopPropagation()}>
      {shown.map((f) => {
        const kind = fileKind(f.path);
        const Icon = kind === 'image' ? ImageIcon : kind === 'web' ? FileCode : FileText;
        return (
          <button
            key={f.path}
            type="button"
            role="listitem"
            className={`orq-node__file is-${kind}${f.change === 'deleted' ? ' is-deleted' : ''}${card === f.path ? ' is-on' : ''}`}
            title={f.path}
            aria-label={t('node.files.open', { path: f.path })}
            aria-pressed={render ? card === f.path : undefined}
            disabled={(!onOpen && !render) || f.change === 'deleted'}
            onClick={(e) => (e.stopPropagation(), pick(f.path))}
          >
            <Icon size={12} aria-hidden="true" />
            <span>{names.get(f.path)}</span>
          </button>
        );
      })}
      {rest > 0 && (
        <button type="button" className="orq-node__file is-more" aria-label={t('node.files.more', { count: rest })} onClick={(e) => (e.stopPropagation(), setAll(true))}>
          +{rest}
        </button>
      )}
      {all && files.length > NODE_FILES_SHOWN && (
        // Vuelve a plegar la lista [R54.1].
        <button type="button" className="orq-node__file is-more" aria-label={t('node.files.less')} onClick={(e) => (e.stopPropagation(), setAll(false))}>
          {t('node.files.lessShort')}
        </button>
      )}
    </div>
    </>
  );
}
