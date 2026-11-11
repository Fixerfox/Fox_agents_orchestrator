/** Operación de git a medias que impide trabajar con normalidad. */
export type GitBusy = 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'bisect';

/** Estado del repositorio de la carpeta del proyecto, sin rutas [R97.2]. */
export interface GitState {
  /** ¿La carpeta está dentro de un repositorio de git? */
  repo: boolean;
  /** Rama de `HEAD`; sin ella y con `repo`, `HEAD` está suelto. */
  branch?: string;
  /** Commit de `HEAD`, abreviado; un repositorio sin commits no lo tiene. */
  commit?: string;
  /** El mismo commit, entero. */
  head?: string;
  /** Archivos con cambios sin commit (también los nuevos sin seguir). */
  dirty: number;
  busy?: GitBusy;
  /** Commits que la rama lleva de retraso respecto a su remota, si tiene. */
  behind?: number;
  /** Ramas locales. */
  branches: string[];
}

/** Ramas en las que no se trabaja directamente [R97.4]. */
export const PROTECTED_BRANCHES: readonly string[] = ['main', 'master', 'develop', 'trunk'];
export const isProtectedBranch = (branch: string): boolean => PROTECTED_BRANCHES.includes(branch);

/** En qué rama corre una ejecución: la actual, o una nueva desde aquí (`here`) o desde otra rama [R97.3]. */
export type GitChoice = { mode: 'stay' } | { mode: 'new'; name: string; from: string; /** Con cambios sin commit y otra base: llevarlos o apartarlos. */ changes?: 'carry' | 'stash' };
/** `from` de una rama nueva que sale de donde se está. */
export const FROM_HERE = 'here';

/** Lo que la ejecución apunta de git al empezar [R97.12]. */
export interface RunGit {
  branch: string;
  commit?: string;
  /** El commit de partida, entero, para saber luego qué commits hizo la ejecución [R98.4]. */
  sha?: string;
  /** La rama se creó para esta ejecución, y desde cuál. */
  created?: boolean;
  from?: string;
  /** Se apartaron cambios sin commit con esta etiqueta. */
  stash?: string;
  /** Archivos con cambios sin commit con los que empezó. */
  dirty?: number;
}

export type GuardCode = 'detached' | 'busy' | 'no-commits' | 'other-runs' | 'bad-name' | 'name-taken' | 'bad-base' | 'changes-undecided' | 'protected';
export interface GuardProblem {
  code: GuardCode;
  message: string;
}

/** Lo que hay que hacer antes de arrancar: nada, o apartar cambios y crear la rama. */
export interface GuardPlan {
  stash?: string;
  create?: { name: string; from?: string };
  /** Rama en la que quedará la ejecución. */
  branch: string;
}

export type GuardVerdict = { ok: true; plan: GuardPlan } | { ok: false; problem: GuardProblem };

const BUSY_TEXT: Record<GitBusy, string> = { merge: 'una fusión', rebase: 'un rebase', 'cherry-pick': 'un cherry-pick', revert: 'un revert', bisect: 'un bisect' };
const fail = (code: GuardCode, message: string): GuardVerdict => ({ ok: false, problem: { code, message } });

/** ¿Aceptaría git este nombre de rama? */
export function validBranchName(name: string): boolean {
  return name.length > 0 && name.length <= 200 && name !== 'HEAD' && !/^[-/.]/.test(name) && !/[/.]$/.test(name) && !name.endsWith('.lock') && !name.includes('..') && !name.includes('//') && !name.includes('@{') && !/[\s~^:?*[\\]/.test(name) && ![...name].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
}

/** Nombre propuesto para la rama de una ejecución: `orq/<diagrama>-<aaaammdd-hhmm>`, sin repetir [R97.5]. */
export function suggestBranchName(diagramName: string, now: Date, taken: readonly string[] = []): string {
  const slug =
    diagramName
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'ejecucion';
  const p = (n: number) => String(n).padStart(2, '0');
  const base = `orq/${slug}-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) if (!taken.includes(`${base}-${n}`)) return `${base}-${n}`;
}

/** Lo que impide lanzar en cualquier caso: `HEAD` suelto, una operación a medias o un repositorio sin commits [R97.6]. */
export function hardBlock(state: GitState): GuardProblem | undefined {
  if (!state.repo) return undefined;
  if (state.busy) return { code: 'busy', message: `Hay ${BUSY_TEXT[state.busy]} a medias en el repositorio: termínala o cancélala antes de ejecutar.` };
  if (state.commit === undefined) return { code: 'no-commits', message: 'El repositorio todavía no tiene ningún commit: haz el primero antes de ejecutar.' };
  if (state.branch === undefined) return { code: 'detached', message: 'El repositorio no está en ninguna rama (HEAD suelto): cámbiate a una rama antes de ejecutar.' };
  return undefined;
}

/** Bases desde las que se ofrece crear la rama: las protegidas que existen y no son la actual [R97.3]. */
export function guardBases(state: GitState): string[] {
  return PROTECTED_BRANCHES.filter((b) => state.branches.includes(b) && b !== state.branch);
}

/** Lo que se hace cuando nadie elige: seguir en la rama, o una nueva desde aquí si es protegida [R97.4][R97.9]. */
export function defaultChoice(state: GitState, diagramName: string, now: Date): GitChoice {
  if (state.branch !== undefined && isProtectedBranch(state.branch)) return { mode: 'new', name: suggestBranchName(diagramName, now, state.branches), from: FROM_HERE };
  return { mode: 'stay' };
}

/**
 * Decide si se puede lanzar con esa elección y qué hay que preparar [R97.6][R97.7][R97.8]. Pura: no toca git.
 * `explicit` es una elección hecha por la persona en el diálogo: solo ella puede quedarse en una rama protegida.
 */
export function branchGuard(state: GitState, choice: GitChoice, ctx: { otherRuns: number; explicit: boolean; label: string }): GuardVerdict | undefined {
  if (!state.repo) return undefined;
  const hard = hardBlock(state);
  if (hard) return { ok: false, problem: hard };
  const current = state.branch!;
  if (choice.mode === 'stay') {
    if (isProtectedBranch(current) && !ctx.explicit) return fail('protected', `Estás en ${current}, que es una rama protegida: elige una rama para esta ejecución.`);
    return { ok: true, plan: { branch: current } };
  }
  if (ctx.otherRuns > 0) return fail('other-runs', 'Hay otra ejecución en marcha en esta carpeta: no se puede cambiar de rama hasta que termine. Puedes seguir en la rama actual.');
  if (!validBranchName(choice.name)) return fail('bad-name', `«${choice.name}» no vale como nombre de rama.`);
  if (state.branches.includes(choice.name)) return fail('name-taken', `Ya existe una rama «${choice.name}»: elige otro nombre.`);
  const here = choice.from === FROM_HERE || choice.from === current;
  if (!here && !state.branches.includes(choice.from)) return fail('bad-base', `No existe la rama «${choice.from}» para partir de ella.`);
  if (here) return { ok: true, plan: { create: { name: choice.name }, branch: choice.name } };
  // Con otra base, los cambios sin commit hay que llevarlos o apartarlos: no se decide solo [R97.7].
  if (state.dirty > 0 && choice.changes === undefined) return fail('changes-undecided', `Hay ${state.dirty} archivo(s) con cambios sin commit: elige si los llevas a la rama nueva o los apartas.`);
  return { ok: true, plan: { ...(state.dirty > 0 && choice.changes === 'stash' ? { stash: `orquestador: ${ctx.label}` } : {}), create: { name: choice.name, from: choice.from }, branch: choice.name } };
}

/** Avisos que no impiden lanzar [R97.8]. */
export function guardNotices(state: GitState, choice: GitChoice): string[] {
  if (!state.repo || hardBlock(state)) return [];
  const out: string[] = [];
  if (state.dirty > 0 && !(choice.mode === 'new' && choice.changes === 'stash')) out.push(`Hay ${state.dirty} archivo(s) con cambios sin commit: la ejecución trabajará sobre ellos.`);
  if (state.behind !== undefined && state.behind > 0 && choice.mode === 'stay') out.push(`Tu rama va ${state.behind} commit(s) por detrás de la remota.`);
  return out;
}

/** Regla que recibe cada paso de agente: en qué rama se trabaja [R97.10]. Igual para cualquier motor. */
export function branchRule(branch: string): string {
  return [
    '## Rama de git',
    `Esta ejecución trabaja en la rama \`${branch}\`, que ya está preparada.`,
    'No crees otra rama ni cambies de rama, y no hagas commit, push ni fusiones en ninguna otra. Si tu tarea necesita algo distinto, dilo en tu respuesta en vez de hacerlo.',
  ].join('\n');
}
