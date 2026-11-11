import { isProtectedBranch, validBranchName, type GitState } from './git-guard';

/** Una rama, local o remota, tal como la enseña el visor [R98.2]. */
export interface GitBranchInfo {
  name: string;
  remote?: boolean;
  current?: boolean;
  /** Rama remota que sigue, y cuánto va por delante y por detrás de ella. */
  upstream?: string;
  ahead?: number;
  behind?: number;
  /** La remota que seguía ya no existe. */
  gone?: boolean;
  sha: string;
  subject?: string;
  date?: string;
}

export interface GitCommit {
  sha: string;
  parents: string[];
  subject: string;
  author: string;
  date: string;
  /** Ramas y etiquetas que apuntan a este commit (`tag: v1` para las etiquetas). */
  refs: string[];
}

export type GitFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflict';
export interface GitFileChange {
  path: string;
  status: GitFileStatus;
  added?: number;
  removed?: number;
}

export interface GitStash {
  index: number;
  label: string;
  date?: string;
}

/** Lo que se puede hacer desde el visor y desde el asistente [R98.6]. */
export type GitAction =
  | { kind: 'create'; name: string; from?: string }
  | { kind: 'switch'; name: string }
  | { kind: 'commit'; message: string }
  | { kind: 'push' }
  | { kind: 'pull' }
  | { kind: 'fetch' }
  | { kind: 'merge'; name: string }
  | { kind: 'delete'; name: string }
  | { kind: 'stash'; label?: string }
  | { kind: 'stash-pop'; index: number };

/** Acciones que mueven la carpeta de rama o de commit: no se hacen con una ejecución en marcha [R98.8]. */
const MOVES_TREE = new Set<GitAction['kind']>(['create', 'switch', 'pull', 'merge', 'stash', 'stash-pop']);

/** ¿Está bien formada la acción? Los nombres de rama, como los de git [R98.11]. */
export function readGitAction(v: unknown): v is GitAction {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const a = v as Record<string, unknown>;
  const only = (...keys: string[]) => Object.keys(a).every((k) => k === 'kind' || keys.includes(k));
  const branch = (x: unknown) => typeof x === 'string' && validBranchName(x);
  switch (a.kind) {
    case 'create':
      return only('name', 'from') && branch(a.name) && (a.from === undefined || branch(a.from));
    case 'switch':
    case 'merge':
    case 'delete':
      return only('name') && branch(a.name);
    case 'commit':
      return only('message') && typeof a.message === 'string' && a.message.trim() !== '' && a.message.length <= 5000;
    case 'push':
    case 'pull':
    case 'fetch':
      return only();
    case 'stash':
      return only('label') && (a.label === undefined || (typeof a.label === 'string' && a.label.length <= 200));
    case 'stash-pop':
      return only('index') && Number.isInteger(a.index) && (a.index as number) >= 0 && (a.index as number) < 1000;
    default:
      return false;
  }
}

/**
 * Motivo por el que una acción no se puede hacer ahora; `undefined` si se puede [R98.7][R98.8]. Pura: no toca git.
 * `running` son las ejecuciones en marcha en la carpeta.
 */
export function gitActionProblem(action: GitAction, state: GitState, ctx: { running: number; branches: readonly string[] }): string | undefined {
  if (!state.repo) return 'Esta carpeta no es un repositorio de git.';
  if (ctx.running > 0 && MOVES_TREE.has(action.kind)) return 'Hay una ejecución en marcha en esta carpeta: espera a que termine para cambiar de rama, fusionar, traer o apartar cambios.';
  if (state.busy && action.kind !== 'fetch') return 'Hay una operación de git a medias en el repositorio: termínala o cancélala en la terminal.';
  const current = state.branch;
  switch (action.kind) {
    case 'create':
      if (ctx.branches.includes(action.name)) return `Ya existe una rama «${action.name}».`;
      if (action.from !== undefined && !ctx.branches.includes(action.from)) return `No existe la rama «${action.from}».`;
      return undefined;
    case 'switch':
      if (!ctx.branches.includes(action.name)) return `No existe la rama «${action.name}».`;
      if (action.name === current) return `Ya estás en «${action.name}».`;
      return undefined;
    case 'merge':
      if (current === undefined) return 'No estás en ninguna rama.';
      if (!ctx.branches.includes(action.name)) return `No existe la rama «${action.name}».`;
      if (action.name === current) return 'No se puede fusionar una rama consigo misma.';
      if (state.dirty > 0) return 'Hay cambios sin commit: guárdalos o apártalos antes de fusionar.';
      return undefined;
    case 'delete':
      if (!ctx.branches.includes(action.name)) return `No existe la rama «${action.name}».`;
      if (action.name === current) return 'No se puede borrar la rama en la que estás.';
      if (isProtectedBranch(action.name)) return `«${action.name}» es una rama protegida: no se borra desde aquí.`;
      return undefined;
    case 'commit':
      if (current === undefined) return 'No estás en ninguna rama.';
      if (state.dirty === 0) return 'No hay cambios que guardar.';
      return undefined;
    case 'push':
    case 'pull':
      return current === undefined ? 'No estás en ninguna rama.' : undefined;
    case 'stash':
      return state.dirty === 0 ? 'No hay cambios que apartar.' : undefined;
    default:
      return undefined;
  }
}

/** ¿Hay que pedir permiso siempre, con cualquier nivel? Borrar una rama y subir a una protegida [R98.14]. */
export function gitActionAlwaysAsks(action: GitAction, state: GitState): boolean {
  return action.kind === 'delete' || (action.kind === 'push' && state.branch !== undefined && isProtectedBranch(state.branch));
}

/** Lo que una ejecución dejó apuntado de git, para saber qué creó [R98.4]. */
export interface RunGitTrace {
  runId: string;
  name: string;
  /** Rama en la que empezó, y si se creó para ella. */
  branch?: string;
  created?: boolean;
  /** Ramas que crearon sus agentes. */
  branches?: string[];
  fromSha?: string;
  toSha?: string;
}

/** Trabajo (ejecución) que creó una rama o un commit [R98.4]. */
export interface GitOrigin {
  runId: string;
  name: string;
}

/** Rama → la ejecución que la creó; si varias la nombran, la más reciente (van de más nueva a más vieja) [R98.4]. */
export function branchOrigins(traces: readonly RunGitTrace[]): Record<string, GitOrigin> {
  const out: Record<string, GitOrigin> = {};
  for (const t of traces) {
    const made = [...(t.created && t.branch ? [t.branch] : []), ...(t.branches ?? [])];
    for (const b of made) if (!(b in out)) out[b] = { runId: t.runId, name: t.name };
  }
  return out;
}
