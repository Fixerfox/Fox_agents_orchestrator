import { MODELS, isCoordinator, splitBranchIds, type Diagram } from '@orquestador/core';
import { t, transformSubtitle } from '@orquestador/editor';

/** «Encajar» nunca aleja tanto que no se lea: lo que no quepa se ve desplazando [R63.23]. */
export const FIT_VIEW = { padding: 0.2, maxZoom: 1, minZoom: 0.75 } as const;

/** ¿Queda el nodo (en coordenadas del lienzo) fuera, aunque sea en parte, de lo que se ve? [R63.29] */
export function offscreen(rect: { x: number; y: number; width: number; height: number }, vp: { x: number; y: number; zoom: number }, size: { width: number; height: number }, margin = 24): boolean {
  const left = rect.x * vp.zoom + vp.x;
  const top = rect.y * vp.zoom + vp.y;
  return left < margin || top < margin || left + rect.width * vp.zoom > size.width - margin || top + rect.height * vp.zoom > size.height - margin;
}

export /** Subtítulo de la tarjeta: agente asignado, o modo del router o del bucle [R21.5]. */
function subtitle(n: Diagram['nodes'][number], agentNames: Readonly<Record<string, string>>, level: Diagram): string | undefined {
  if (n.kind === 'agent') {
    if (!n.agentId) return undefined;
    const agent = agentNames[n.agentId] ?? n.agentId;
    // Si el paso se llama como su agente, no se repite el nombre [R63.25].
    const same = agent.trim().toLowerCase() === (n.label ?? '').trim().toLowerCase();
    const model = n.model ? (MODELS.find((m) => m.id === n.model)?.name ?? n.model) : undefined;
    // Un paso con modelo propio lo enseña junto al agente [R40.5].
    const sub = model ? (same ? model : t('node.sub.model', { agent, model })) : same ? '' : agent;
    // Confirma antes de terminar [R43.3].
    const confirmed = n.confirm ? (sub ? t('node.sub.confirm', { sub }) : t('node.sub.confirmOnly')) : sub;
    const out = isCoordinator(n) ? (confirmed ? t('node.sub.split', { sub: confirmed, n: splitBranchIds(level, n.id).length }) : t('node.sub.splitOnly', { n: splitBranchIds(level, n.id).length })) : confirmed;
    return out || undefined;
  }
  if (n.kind === 'subdiagram') return n.subdiagram ? t('sub.sub', { name: agentNames[`diagram:${n.subdiagram.templateId}`] ?? n.subdiagram.templateId }) : undefined;
  if (n.kind === 'router') return t(n.router?.mode === 'rules' ? 'node.sub.router.rules' : 'node.sub.router.ai');
  if (n.kind === 'transform') return transformSubtitle(n.transform);
  if (n.kind === 'review') return t(n.review?.mode === 'ai' ? 'node.sub.review.ai' : n.review?.mode === 'human' ? 'node.sub.review.human' : 'node.sub.review.verdict');
  if (n.kind === 'loop' && n.loop) {
    if (n.loop.mode === 'ai-judge') return t('node.sub.loop.ai');
    const c = n.loop.count ?? 1;
    return c === 1 ? t('node.sub.loop.count.one') : t('node.sub.loop.count', { n: c });
  }
  return undefined;
}
