import { History, MessageCircleQuestion, Radio } from 'lucide-react';
import type { RunsNav, RunsSection } from './runsTypes';
import { type Diagram } from '@orquestador/core';
import { t, type MessageKey, type HistoryRow } from '@orquestador/editor';

export const statusLabel = (status: string, paused = false) =>
  paused && status === 'running' ? t('run.status.paused') : t(`run.status.${status}` as MessageKey);

export const money = (usd: number) => `${usd.toFixed(3).replace('.', ',')} $`;

export const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export const diagramLabel = (row: Pick<HistoryRow, 'diagramName'> | undefined) => row?.diagramName ?? t('runs.deleted');

/** Nombre visible de un nodo del diagrama de una ejecución (entra en los bucles por su ruta). */
export function nodeLabel(diagram: Diagram | undefined, nodeId: string, nodePath: readonly string[] = []): string {
  if (!diagram) return nodeId;
  let level: Pick<Diagram, 'nodes'> = diagram;
  for (const id of nodePath) {
    const n = level.nodes.find((x) => x.id === id);
    if (!n?.loop) break;
    level = n.loop.body;
  }
  return level.nodes.find((n) => n.id === nodeId)?.label ?? nodeId;
}

export const SECTIONS: { id: RunsSection; label: MessageKey; icon: typeof Radio }[] = [
  { id: 'live', label: 'runs.sec.live', icon: Radio },
  { id: 'inbox', label: 'runs.sec.inbox', icon: MessageCircleQuestion },
  { id: 'history', label: 'runs.sec.history', icon: History },
];

/** Sección a la que pertenece lo que se ve: una ejecución terminada ya no está «En directo» [R63.26]. */
export function crumbSection(nav: RunsNav, row: { status: string } | undefined): RunsNav['section'] {
  return nav.runId && nav.section === 'live' && row && row.status !== 'running' ? 'history' : nav.section;
}
