import { pathKey, type Id, type RunEvent } from '@orquestador/core';

type GitAction = Extract<RunEvent, { type: 'git.action' }>['action'];

/** Una rama de la ejecución y quién actuó en ella [R58.6][R58.13]. */
export interface RunBranch {
  name: string;
  created: boolean;
  deleted: boolean;
  /** PR o merge request de la rama [R58.15]. */
  prUrl?: string;
  steps: { key: string; nodeId: Id; nodePath: Id[]; actions: GitAction[] }[];
}

export interface RunBranches {
  /** Ramas de cada paso por orden de uso: la última es la vigente. */
  byStep: Record<string, string[]>;
  /** Lo que hizo cada paso en las ramas [R58.12]. */
  actions: Record<string, GitAction[]>;
  /** PR o merge request que creó cada paso [R58.15]. */
  links: Record<string, string>;
  list: RunBranch[];
}

/** Número de una PR o merge request, para nombrar el enlace [R58.15]. */
export const reviewNumber = (url: string): string => /(\d+)$/.exec(url)?.[1] ?? '';

/** Ramas de una ejecución; si los pasos solo corrieron en ella, sin actividad de git, no hay ninguna (decisión 2) [R58.6]. */
export function branchesOf(events: readonly RunEvent[]): RunBranches {
  const seen = events.filter((e) => e.type === 'git.branch');
  if (seen.every((e) => e.via === 'ran')) return { byStep: {}, actions: {}, links: {}, list: [] };
  const byStep: Record<string, string[]> = {};
  const list = new Map<string, RunBranch>();
  for (const e of seen) {
    const nodePath = e.nodePath ?? [];
    const key = pathKey(nodePath, e.nodeId);
    byStep[key] = [...(byStep[key] ?? []).filter((b) => b !== e.branch), e.branch];
    const branch = list.get(e.branch) ?? { name: e.branch, created: false, deleted: false, steps: [] };
    if (e.created) branch.created = true;
    if (!branch.steps.some((s) => s.key === key)) branch.steps.push({ key, nodeId: e.nodeId, nodePath: [...nodePath], actions: [] });
    list.set(e.branch, branch);
  }
  const actions: Record<string, GitAction[]> = {};
  const links: Record<string, string> = {};
  for (const e of events) {
    if (e.type !== 'git.action') continue;
    const nodePath = e.nodePath ?? [];
    const key = pathKey(nodePath, e.nodeId);
    if (!actions[key]?.includes(e.action)) actions[key] = [...(actions[key] ?? []), e.action];
    if (e.url) links[key] = e.url;
    const branch = list.get(e.branch);
    if (!branch) continue;
    if (e.url) branch.prUrl = e.url;
    if (e.action === 'delete') branch.deleted = true;
    let step = branch.steps.find((s) => s.key === key);
    if (!step) branch.steps.push((step = { key, nodeId: e.nodeId, nodePath: [...nodePath], actions: [] }));
    if (!step.actions.includes(e.action)) step.actions.push(e.action);
  }
  return { byStep, actions, links, list: [...list.values()] };
}

const MAIN_BRANCH = /^(main|master|develop|trunk)$/;

/**
 * Ramas de un nodo del nivel que se ve: las suyas y las de lo que lleva dentro [R58.7]. La última es la vigente: volver
 * a la rama principal al terminar no desbanca a la rama en la que se trabajó [R58.6].
 */
export function nodeBranches(byStep: Readonly<Record<string, readonly string[]>>, key: string): string[] {
  const inner = Object.keys(byStep).filter((k) => k.startsWith(`${key}/`));
  const all = [...inner.flatMap((k) => byStep[k]!), ...(byStep[key] ?? [])];
  const used = all.filter((b, i) => all.lastIndexOf(b) === i);
  return [...used.filter((b) => MAIN_BRANCH.test(b)), ...used.filter((b) => !MAIN_BRANCH.test(b))];
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BranchBox extends Rect {
  id: string;
  branch: string;
}

const PAD = 24;
/** Sitio para el nombre de la rama, encima de los pasos. */
const LABEL = 22;

const bounds = (rects: readonly Rect[]): Rect => {
  const x = Math.min(...rects.map((r) => r.x)) - PAD;
  const y = Math.min(...rects.map((r) => r.y)) - PAD - LABEL;
  return { x, y, width: Math.max(...rects.map((r) => r.x + r.width)) + PAD - x, height: Math.max(...rects.map((r) => r.y + r.height)) + PAD - y };
};

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Grupos de pasos conectados entre sí por las flechas del nivel [R58.9]. */
function connected(ids: readonly Id[], edges: readonly { from: Id; to: Id }[]): Id[][] {
  const rest = new Set(ids);
  const groups: Id[][] = [];
  for (const id of ids) {
    if (!rest.delete(id)) continue;
    const group = [id];
    for (let i = 0; i < group.length; i++) {
      for (const e of edges) {
        const next = e.from === group[i] ? e.to : e.to === group[i] ? e.from : undefined;
        if (next !== undefined && rest.delete(next)) group.push(next);
      }
    }
    groups.push(group);
  }
  return groups;
}

/**
 * Recuadros de las ramas en un nivel: uno por rama con los pasos cuya rama vigente es esa, o uno por grupo conectado
 * si pisaría un paso de otra rama [R58.8][R58.9]. `rects` da el sitio de cada paso, con sus enchufes y fichas.
 */
export function branchBoxes(level: { nodes: readonly { id: Id }[]; edges: readonly { from: Id; to: Id }[] }, path: readonly Id[], byStep: Readonly<Record<string, readonly string[]>>, rects: ReadonlyMap<Id, Rect>): BranchBox[] {
  const owners = new Map<string, Id[]>();
  for (const n of level.nodes) {
    const branch = nodeBranches(byStep, pathKey([...path], n.id)).at(-1);
    if (branch !== undefined && rects.has(n.id)) owners.set(branch, [...(owners.get(branch) ?? []), n.id]);
  }
  return [...owners].flatMap(([branch, ids]) => {
    const whole = bounds(ids.map((id) => rects.get(id)!));
    const foreign = [...owners].filter(([other]) => other !== branch).flatMap(([, others]) => others);
    const groups = foreign.some((id) => overlaps(whole, rects.get(id)!)) ? connected(ids, level.edges) : [ids];
    return groups.map((group, i) => ({ id: `branch:${branch}:${i}`, branch, ...bounds(group.map((id) => rects.get(id)!)) }));
  });
}
