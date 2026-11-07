import type { DiagramNode, KnowledgeExtra } from '@orquestador/core';
import type { NodePatch } from './ops';

/** Lo que un paso agente puede sobrescribir de su agente [R66.2]. */
export type StepOverride = 'model' | 'confirm' | 'extra';

/** Cuántas skills, contextos y MCP se añaden solo en este paso [R66.1]. */
export function extraCount(extra: KnowledgeExtra | undefined): number {
  return (extra?.skillIds?.length ?? 0) + (extra?.contextIds?.length ?? 0) + (extra?.mcpIds?.length ?? 0);
}

/** Qué cambia un paso respecto a la ficha de su agente; nombre y tarea son siempre del paso [R66.2][R66.7]. */
export function stepOverrides(node: DiagramNode): StepOverride[] {
  if (node.kind !== 'agent') return [];
  const out: StepOverride[] = [];
  if (node.model) out.push('model');
  if (node.confirm === true) out.push('confirm');
  if (extraCount(node.extra) > 0) out.push('extra');
  return out;
}

/** El cambio que devuelve un paso a lo de su agente; `undefined` si no hay nada que quitar [R66.4][R66.7]. */
export function resetStepPatch(node: DiagramNode): NodePatch | undefined {
  const o = stepOverrides(node);
  if (o.length === 0) return undefined;
  const p: NodePatch = {};
  if (o.includes('model')) p.model = '';
  if (o.includes('confirm')) p.confirm = false;
  if (o.includes('extra')) p.extra = {};
  return p;
}
