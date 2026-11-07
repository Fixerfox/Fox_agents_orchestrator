import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { MODELS } from '@orquestador/core';
import { Panel, useReactFlow, useStore } from '@xyflow/react';
import { t, type MessageKey, type SupervisorView } from '@orquestador/editor';
import { money } from './runFormat';

/** Dónde acaba la tarjeta, desde arriba del lienzo: de ahí sale el haz. */
const CARD_BOTTOM = 132;
const EDGE = 16;
const SCOPE = 12;
/** Distancia a la que el haz rodea lo que se interpone. */
const DETOUR = 36;

export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Nodo del nivel visible que contiene el paso, si está en este nivel o por debajo [R60.33]. */
export function targetNode(key: string, path: readonly string[]): string | undefined {
  const parts = key.split('/');
  if (parts.length <= path.length || path.some((p, i) => parts[i] !== p)) return undefined;
  return parts[path.length];
}

const clamp = (n: number, min: number, max: number): number => Math.min(Math.max(n, min), Math.max(min, max));

/** Haz desde la tarjeta hasta el paso; fuera de la vista, hasta el borde. Rodea lo que se interponga [R60.33][R60.34]. */
export function beamTo(rect: ScreenRect, view: { width: number; height: number }, others: readonly ScreenRect[] = []): { d: string; end: { x: number; y: number }; offscreen: boolean } {
  const offscreen = rect.x + rect.width < 0 || rect.x > view.width || rect.y + rect.height < 0 || rect.y > view.height;
  const start = { x: view.width / 2, y: CARD_BOTTOM };
  const left = Math.min(start.x, rect.x);
  const right = Math.max(start.x, rect.x + rect.width);
  const inTheWay = others.filter((o) => o.y + o.height > start.y && o.y + o.height <= rect.y && o.x < right && o.x + o.width > left);
  if (!offscreen && inTheWay.length > 0) {
    // Por el lado con menos que rodear; entra por ese lado del paso.
    const toRight = Math.max(...inTheWay.map((o) => o.x + o.width)) - start.x <= start.x - Math.min(...inTheWay.map((o) => o.x));
    const sign = toRight ? 1 : -1;
    const end = { x: toRight ? rect.x + rect.width + SCOPE : rect.x - SCOPE, y: rect.y + rect.height / 2 };
    const clear = toRight ? Math.max(...inTheWay.map((o) => o.x + o.width), end.x) : Math.min(...inTheWay.map((o) => o.x), end.x);
    const lane = clear + sign * DETOUR;
    return { d: `M${start.x} ${start.y} C${start.x} ${start.y + 50}, ${lane} ${start.y + 10}, ${lane} ${start.y + 70} L${lane} ${end.y - 24} Q${lane} ${end.y}, ${end.x} ${end.y}`, end, offscreen };
  }
  const end = { x: clamp(rect.x + rect.width / 2, EDGE, view.width - EDGE), y: clamp(rect.y - SCOPE, EDGE, view.height - EDGE) };
  const bend = Math.max(40, Math.abs(end.y - start.y) / 2);
  return { d: `M${start.x} ${start.y} C${start.x} ${start.y + bend}, ${end.x} ${end.y - bend}, ${end.x} ${end.y}`, end, offscreen };
}

/** «1 paso revisado», «2 pasos revisados». */
export const reviewedText = (n: number): string => t(n === 1 ? 'sup.reviewed.one' : 'sup.reviewed.many', { count: n });
const alertsText = (n: number): string => t(n === 1 ? 'sup.alerts.one' : 'sup.alerts.many', { count: n });

const modelName = (id: string): string => MODELS.find((m) => m.id === id)?.name ?? id;

function statusText(v: SupervisorView): string {
  if (v.status === 'alert') return alertsText(v.alerts);
  return t(`sup.status.${v.status}` as MessageKey);
}

function headline(v: SupervisorView): string {
  if (v.status === 'reviewing') {
    const [first = '', second = ''] = v.reviewing;
    if (v.reviewing.length === 1) return t('sup.head.reviewing', { step: first });
    return v.reviewing.length === 2 ? t('sup.head.reviewing.two', { first, second }) : t('sup.head.reviewing.many', { count: v.reviewing.length });
  }
  if (v.status === 'alert') return v.lastAlert ?? '';
  return t(`sup.head.${v.status}` as MessageKey);
}

/** Tarjeta fija del Supervisor: no es un nodo y no se mueve con el lienzo [R60.32]. */
export function SupervisorCard({ view: v, onOpen }: { view: SupervisorView; onOpen?: ((key?: string) => void) | undefined }) {
  const metrics = `${reviewedText(v.reviewed)} · ${alertsText(v.alerts)} · ${money(v.costUsd)}`;
  return (
    <button type="button" className={`orq-sup is-${v.status}`} aria-label={t('sup.open')} onClick={() => onOpen?.()}>
      <span className="orq-sup__ring">
        <span className="orq-sup__body">
          <svg className="orq-sup__emblem" width="52" height="60" viewBox="0 0 62 70" aria-hidden="true">
            <polygon points="31,3 58,18.5 58,51.5 31,67 4,51.5 4,18.5" />
            <circle className="orq-sup__orbit" cx="31" cy="35" r="15" />
            <path className="orq-sup__sweep" d="M31 20a15 15 0 0 1 15 15" />
            <circle className="orq-sup__core" cx="31" cy="35" r="5" />
          </svg>
          <span className="orq-sup__text">
            <span className="orq-sup__top">
              <span className="orq-sup__name">{t('sup.title')}</span>
              <span className="orq-sup__status">{statusText(v)}</span>
            </span>
            <span className="orq-sup__head">{headline(v)}</span>
            <span className="orq-sup__metrics">{v.model ? `${metrics} · ${modelName(v.model)}` : metrics}</span>
            {v.branch && <span className="orq-sup__branch">{v.branch}</span>}
          </span>
        </span>
      </span>
    </button>
  );
}

/** La memoria de la ejecución a la vista, la última entrada primero [R60.35]. */
export function SupervisorMemory({ view: v }: { view: SupervisorView }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="orq-supmem" aria-label={t('rsum.sup.memory')}>
      <header className="orq-supmem__head">
        <h3>{t('rsum.sup.memory')}</h3>
        <button type="button" className="orq-supmem__fold" aria-expanded={open} aria-label={t(open ? 'sup.memory.fold' : 'sup.memory.unfold')} onClick={() => setOpen(!open)}>
          {open ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
        </button>
      </header>
      {open && (
        <div className="orq-supmem__body">
          {v.branch && <p className="orq-supmem__branch">{v.branch}</p>}
          {v.memory.length === 0 ? (
            <p className="orq-hint">{t('sup.memory.empty')}</p>
          ) : (
            <ol>
              {[...v.memory].reverse().map((m, i) => (
                <li key={v.memory.length - i}>
                  <strong>{m.label}</strong>
                  {m.text ? `: ${m.text}` : ''}
                  {m.files.length > 0 && <span className="orq-hint"> ({m.files.join(', ')})</span>}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}

/** Tarjeta, memoria y haz sobre el lienzo de una ejecución; va dentro de React Flow [R60.32]–[R60.35]. */
export function SupervisorOverlay({ view, path, onOpen }: { view: SupervisorView; path: readonly string[]; onOpen?: ((key?: string) => void) | undefined }) {
  const flow = useReactFlow();
  const [tx, ty, zoom] = useStore((s) => s.transform);
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const seen = new Set<string>();
  const screen = (id: string): ScreenRect | undefined => {
    const node = flow.getInternalNode(id);
    if (!node?.measured.width || !node.measured.height) return undefined;
    const at = node.internals.positionAbsolute;
    return { x: at.x * zoom + tx, y: at.y * zoom + ty, width: node.measured.width * zoom, height: node.measured.height * zoom };
  };
  const steps = flow.getNodes().filter((n) => n.type === 'orq');
  const beams = view.targets.flatMap((target) => {
    const id = targetNode(target.key, path);
    const rect = id !== undefined && !seen.has(id) ? screen(id) : undefined;
    if (!id || !rect) return [];
    seen.add(id);
    const others = steps.filter((n) => n.id !== id).flatMap((n) => screen(n.id) ?? []);
    return [{ id, key: target.key, warn: target.warn, rect, ...beamTo(rect, { width, height }, others) }];
  });
  return (
    <>
      <div className="orq-sup__layer" aria-hidden="true">
        <svg width={width} height={height}>
          {beams.map((b) => (
            <g key={b.id} className={b.warn ? 'is-warn' : undefined}>
              <path className="orq-sup__glow" d={b.d} />
              <path className="orq-sup__beam" d={b.d} />
            </g>
          ))}
        </svg>
        {beams.map((b) => (
          <span key={b.id} className={`orq-sup__pulse${b.warn ? ' is-warn' : ''}`} style={{ offsetPath: `path('${b.d}')` }} />
        ))}
        {beams
          .filter((b) => !b.offscreen)
          .map((b) => (
            <div key={b.id} className={`orq-sup__scope${b.warn ? ' is-warn' : ''}`} style={{ left: b.rect.x - SCOPE, top: b.rect.y - SCOPE, width: b.rect.width + SCOPE * 2, height: b.rect.height + SCOPE * 2 }}>
              <i />
              <i />
              <i />
              <i />
              {!b.warn && <span>{t('sup.tag.review')}</span>}
            </div>
          ))}
      </div>
      {beams
        .filter((b) => b.warn && !b.offscreen)
        .map((b) => (
          <button key={b.id} type="button" className="orq-sup__tag" style={{ left: b.rect.x + b.rect.width + SCOPE, top: b.rect.y - SCOPE - 26 }} onClick={() => onOpen?.(b.key)}>
            {t('sup.tag.alert')}
          </button>
        ))}
      {beams
        .filter((b) => b.offscreen)
        .map((b) => (
          <button key={b.id} type="button" className={`orq-sup__goto${b.warn ? ' is-warn' : ''}`} style={{ left: b.end.x, top: b.end.y }} aria-label={t('sup.goto')} title={t('sup.goto')} onClick={() => void flow.fitView({ nodes: [{ id: b.id }], duration: 300, maxZoom: 1 })} />
        ))}
      <Panel position="top-center" className="orq-sup__panel">
        <SupervisorCard view={view} onOpen={onOpen} />
      </Panel>
      <Panel position="top-right" className="orq-sup__panel">
        <SupervisorMemory view={view} />
      </Panel>
    </>
  );
}
