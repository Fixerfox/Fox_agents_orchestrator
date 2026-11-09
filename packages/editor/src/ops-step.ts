import { AI_REVIEW_MODES, checkProblems, limitProblems, type AiReviewMode, type Diagram, type DiagramNode, type StepCheck, type StepLimits, type VerifySettings } from '@orquestador/core';

/** Campos de un paso de agente añadidos por SPEC-070–077; `null` o vacío los quita. */
export interface StepPatch {
  /** Límites propios del paso; `{}` los quita [R70.21]. */
  limits?: StepLimits;
  /** Qué hacer con lo que dejó un intento fallido [R71.16]. */
  onRetry?: 'keep' | 'restore';
  /** Comprobaciones del paso; `[]` las quita [R75.24]. */
  checks?: StepCheck[];
  /** Cuándo revisa la IA; `always` es lo de por defecto [R75.11]. */
  aiReview?: AiReviewMode;
  /** Verificar con un agente; `null` lo quita [R75.24]. */
  verify?: VerifySettings | null;
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
  if (patch.checks !== undefined) {
    if (n.kind !== 'agent' || checkProblems(patch.checks).length > 0) return false;
    if (patch.checks.length > 0) next.checks = structuredClone(patch.checks);
    else delete next.checks;
  }
  if (patch.aiReview !== undefined) {
    if (n.kind !== 'agent' || !AI_REVIEW_MODES.includes(patch.aiReview)) return false;
    if (patch.aiReview === 'always') delete next.aiReview;
    else next.aiReview = patch.aiReview;
  }
  if (patch.verify !== undefined) {
    if (n.kind !== 'agent') return false;
    if (patch.verify === null) delete next.verify;
    else next.verify = structuredClone(patch.verify);
  }
  return true;
}

/** Comprobaciones de la ejecución entera; `[]` las quita [R75.17][R75.24]. */
export function setDiagramChecks(root: Diagram, checks: StepCheck[]): Diagram {
  if (checkProblems(checks).length > 0) return root;
  const { checks: _old, ...rest } = root;
  void _old;
  return checks.length > 0 ? { ...rest, checks: structuredClone(checks) } : rest;
}
