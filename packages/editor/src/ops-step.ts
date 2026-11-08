import { limitProblems, type DiagramNode, type StepLimits } from '@orquestador/core';

/** Campos de un paso de agente añadidos por SPEC-070–077; `null` o vacío los quita. */
export interface StepPatch {
  /** Límites propios del paso; `{}` los quita [R70.21]. */
  limits?: StepLimits;
  /** Qué hacer con lo que dejó un intento fallido [R71.16]. */
  onRetry?: 'keep' | 'restore';
}

/** Aplica los campos de `StepPatch` a un paso de agente; `false` si el parche no vale. */
export function applyStepPatch(next: DiagramNode, n: DiagramNode, patch: StepPatch): boolean {
  if (patch.limits !== undefined) {
    if (n.kind !== 'agent' || limitProblems(patch.limits).length > 0) return false;
    const clean = Object.fromEntries(Object.entries(patch.limits).filter(([, v]) => v !== undefined)) as StepLimits;
    if (Object.keys(clean).length > 0) next.limits = clean;
    else delete next.limits;
  }
  if (patch.onRetry !== undefined) {
    if (n.kind !== 'agent' || (patch.onRetry !== 'keep' && patch.onRetry !== 'restore')) return false;
    // «Conservar» es lo de por defecto: no se guarda [R71.10].
    if (patch.onRetry === 'restore') next.onRetry = 'restore';
    else delete next.onRetry;
  }
  return true;
}
