import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { MODELS } from '@orquestador/core';
import { ViewportPortal, useReactFlow, useStore } from '@xyflow/react';
import { t, type MessageKey, type SupervisorView } from '@orquestador/editor';
import { money } from './runFormat';
import { MemoryCards } from './MemoryCards';

/** Distancia entre la tarjeta y el paso más alto, en coordenadas del lienzo [R69.3]. */
const GAP = 120;

export interface FlowRect {
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

/** Dónde va el pie de la tarjeta: centrada sobre los pasos y por encima del más alto [R69.3]. */
export function supervisorAnchor(rects: readonly FlowRect[]): { x: number; y: number } {
  if (rects.length === 0) return { x: 0, y: 0 };
  const left = Math.min(...rects.map((r) => r.x));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const top = Math.min(...rects.map((r) => r.y));
  return { x: (left + right) / 2, y: top - GAP };
}

/** Línea de la tarjeta a lo alto de un paso, en coordenadas del lienzo [R69.3]. */
export function lineTo(from: { x: number; y: number }, rect: FlowRect): string {
  const end = { x: rect.x + rect.width / 2, y: rect.y - 6 };
  const bend = Math.max(30, (end.y - from.y) / 2);
  return `M${from.x} ${from.y} C${from.x} ${from.y + bend}, ${end.x} ${end.y - bend}, ${end.x} ${end.y}`;
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

/** Tarjeta del Supervisor: estado, pasos revisados, avisos, gasto, modelo y rama [R69.3]. */
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

/** Orden y nombre corto de cada bloque en la línea plegada [R69.4]. */
const SHORT_BLOCKS = ['decisions', 'agreements', 'notes', 'alerts', 'route', 'steps'] as const;

/** «2 decisiones · 1 nota · 3 pasos»: cuántas entradas tiene cada bloque [R69.4]. */
export function memoryCounts(memory: SupervisorView['memory']): string {
  const count = (b: string) => memory.filter((m) => (m.block ?? 'steps') === b).length;
  return SHORT_BLOCKS.map((b) => ({ b, n: count(b) }))
    .filter((x) => x.n > 0)
    .map((x) => t(`sup.memory.count.${x.b}.${x.n === 1 ? 'one' : 'many'}` as MessageKey, { n: x.n }))
    .join(' · ');
}

/**
 * La memoria bajo la tarjeta, con su ancho y su forma: plegada, una línea con lo que hay por bloque; desplegada, la
 * rama y las dos últimas entradas. Sin nada anotado no se muestra [R69.4].
 */
export function SupervisorMemory({ view: v, onAll }: { view: SupervisorView; onAll?: (() => void) | undefined }) {
  const [open, setOpen] = useState(false);
  if (v.memory.length === 0 && !v.branch) return null;
  const counts = memoryCounts(v.memory);
  return (
    <section className={`orq-supmem${open ? ' is-open' : ''}`} aria-label={t('rsum.sup.memory')}>
      <button type="button" className="orq-supmem__head" aria-expanded={open} aria-label={t(open ? 'sup.memory.fold' : 'sup.memory.unfold')} onClick={() => setOpen(!open)}>
        <span className="orq-supmem__title">{t('sup.memory.short')}</span>
        <span className="orq-supmem__counts">{counts || v.branch}</span>
        {open ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
      </button>
      {open && (
        <div className="orq-supmem__body">
          <MemoryCards notes={v.memory} branch={v.branch} limit={2} onAll={onAll} />
        </div>
      )}
    </section>
  );
}

/** El Supervisor dentro del diagrama: en sus coordenadas, se mueve y hace zoom con él, con líneas a los pasos en revisión [R69.3]. */
export function SupervisorOverlay({ view, path, onOpen, onMemory }: { view: SupervisorView; path: readonly string[]; onOpen?: ((key?: string) => void) | undefined; onMemory?: (() => void) | undefined }) {
  const flow = useReactFlow();
  // Vuelve a dibujarse cuando los pasos se miden o se mueven.
  useStore((s) => {
    let sig = '';
    s.nodeLookup?.forEach((n) => {
      sig += `${n.id}:${n.measured?.width ?? 0}x${n.measured?.height ?? 0}@${n.internals.positionAbsolute.x},${n.internals.positionAbsolute.y};`;
    });
    return sig;
  });
  const rects = new Map<string, FlowRect>();
  for (const n of flow.getNodes()) {
    if (n.type !== 'orq') continue;
    const node = flow.getInternalNode(n.id);
    if (!node?.measured.width || !node.measured.height) continue;
    const at = node.internals.positionAbsolute;
    rects.set(n.id, { x: at.x, y: at.y, width: node.measured.width, height: node.measured.height });
  }
  const anchor = supervisorAnchor([...rects.values()]);
  const seen = new Set<string>();
  const lines = view.targets.flatMap((target) => {
    const id = targetNode(target.key, path);
    const rect = id !== undefined && !seen.has(id) ? rects.get(id) : undefined;
    if (!id || !rect) return [];
    seen.add(id);
    return [{ id, key: target.key, warn: target.warn, rect, d: lineTo(anchor, rect) }];
  });
  return (
    <ViewportPortal>
      <svg className="orq-sup__lines" aria-hidden="true">
        {lines.map((l) => (
          <path key={l.id} className={l.warn ? 'is-warn' : undefined} d={l.d} />
        ))}
      </svg>
      {lines
        .filter((l) => l.warn)
        .map((l) => (
          <button key={l.id} type="button" className="orq-sup__tag nodrag nopan" style={{ transform: `translate(${l.rect.x + l.rect.width}px, ${l.rect.y - 8}px) translate(-100%, -100%)` }} onClick={() => onOpen?.(l.key)}>
            {t('sup.tag.alert')}
          </button>
        ))}
      <div className="orq-sup__anchor nodrag nopan nowheel" style={{ transform: `translate(${anchor.x}px, ${anchor.y}px) translate(-50%, -100%)` }}>
        <SupervisorCard view={view} onOpen={onOpen} />
        <SupervisorMemory view={view} onAll={onMemory} />
      </div>
    </ViewportPortal>
  );
}
