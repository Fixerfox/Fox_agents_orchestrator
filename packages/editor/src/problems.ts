import { parallelRegions, validateDiagram, type Diagram, type Id, type ValidationIssue } from '@orquestador/core';
import { getLevel } from './ops';
import { t, type MessageKey } from './i18n';

export interface LocalizedProblem {
  code: string;
  message: string;
  /** Nodo del nivel actual al que se atribuye (el propio nodo o el bucle que contiene el problema). */
  nodeId?: Id;
  /** Cadena de bucles donde ocurre, en texto legible. */
  where: string;
  path: Id[];
  /** `warning`: diagrama a medio montar; `error`: el resto [R32.10]. */
  severity: 'warning' | 'error';
}

/** Problemas normales mientras se monta un diagrama: avisos, no errores [R32.10]. */
export const WARNING_CODES: ReadonlySet<string> = new Set(['unreachable', 'router-no-outgoing', 'review-no-approved', 'extra-without-task', 'shared-fan']);

/**
 * Pasos con skills, contextos o MCP añadidos pero sin tarea [R36.15]. Es un aviso del editor y no de la validación
 * del motor: no impide ejecutar.
 */
export function extraWithoutTask(level: Diagram, path: Id[] = []): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  for (const n of level.nodes) {
    const e = n.extra;
    if (n.kind === 'agent' && e && (e.skillIds?.length || e.contextIds?.length || e.mcpIds?.length) && !(n.task ?? '').trim()) {
      out.push({ code: 'extra-without-task', message: `${n.label ?? n.id} tiene conocimiento añadido y no tiene tarea`, nodeId: n.id, path });
    }
    if (n.kind === 'loop' && n.loop) out.push(...extraWithoutTask(n.loop.body, [...path, n.id]));
  }
  return out;
}

/** Abanicos cuyas ramas comparten carpeta porque el aislamiento está apagado [R73.21]. */
export function sharedFans(level: Diagram, path: Id[] = []): ValidationIssue[] {
  const out: ValidationIssue[] = parallelRegions(level).map((r) => ({ code: 'shared-fan', message: 'Estas ramas comparten carpeta', nodeId: r.id, path }));
  for (const n of level.nodes) if (n.kind === 'loop' && n.loop) out.push(...sharedFans(n.loop.body, [...path, n.id]));
  return out;
}

export interface ProblemsView {
  all: LocalizedProblem[];
  /** Mensajes por nodo del nivel actual. */
  byNode: Record<Id, string[]>;
  /** Nodos del nivel actual cuyos problemas son todos avisos. */
  warningOnly: Record<Id, true>;
  count: number;
  warnings: number;
  errors: number;
  runnable: boolean;
}

const nameOf = (level: Diagram, id: Id | undefined): string => {
  if (id === undefined) return '';
  const n = level.nodes.find((x) => x.id === id);
  return n?.label ?? id;
};

function describe(root: Diagram, issue: ValidationIssue): { message: string; where: string } {
  let level = root;
  const names: string[] = [];
  for (const id of issue.path) {
    names.push(nameOf(level, id));
    try {
      level = getLevel(level, [id]);
    } catch {
      break;
    }
  }
  const key = `problem.${issue.code}` as MessageKey;
  const message = t(key, { node: nameOf(level, issue.nodeId), message: issue.message });
  return { message, where: names.join(' › ') };
}

/** Valida todo el diagrama y reparte los problemas entre los nodos del nivel que se está viendo. */
export function computeProblems(root: Diagram, path: readonly Id[], opts: { sharedFans?: boolean } = {}): ProblemsView {
  const core = validateDiagram(root);
  const issues = [...core, ...extraWithoutTask(root), ...(opts.sharedFans ? sharedFans(root) : [])];
  const all: LocalizedProblem[] = [];
  const byNode: Record<Id, string[]> = {};
  const nodeErrors = new Set<Id>();
  for (const issue of issues) {
    const severity = WARNING_CODES.has(issue.code) ? 'warning' : 'error';
    const { message, where } = describe(root, issue);
    let nodeId: Id | undefined;
    const sameLevel = issue.path.length === path.length && issue.path.every((id, i) => id === path[i]);
    const insideChild = issue.path.length > path.length && path.every((id, i) => id === issue.path[i]);
    if (sameLevel) nodeId = issue.nodeId;
    else if (insideChild) nodeId = issue.path[path.length];
    const shown = insideChild ? t('problems.inside', { where, message }) : message;
    all.push({ code: issue.code, message: shown, ...(nodeId !== undefined ? { nodeId } : {}), where, path: issue.path, severity });
    if (nodeId !== undefined) {
      (byNode[nodeId] ??= []).push(shown);
      if (severity === 'error') nodeErrors.add(nodeId);
    }
  }
  const warningOnly: Record<Id, true> = {};
  for (const id of Object.keys(byNode)) if (!nodeErrors.has(id)) warningOnly[id] = true;
  const warnings = all.filter((p) => p.severity === 'warning').length;
  return { all, byNode, warningOnly, count: all.length, warnings, errors: all.length - warnings, runnable: core.length === 0 };
}
