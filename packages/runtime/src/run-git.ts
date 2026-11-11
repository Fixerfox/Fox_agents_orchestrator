import { branchGuard, defaultChoice, suggestBranchName, type GitChoice, type GitState, type RunGit, type BranchGuardPort } from '@orquestador/core';
import { RunError } from './errors';

/** Lo que el diálogo «Ejecutar» necesita saber de git: estado sin rutas, nombre propuesto y si hay otras en marcha [R97.2]. */
export interface GitGuardInfo {
  state: GitState;
  suggested: string;
  otherRuns: number;
}

export interface RunGitContext {
  diagramName: string;
  otherRuns: number;
  now: Date;
}

export async function gitGuardInfo(git: BranchGuardPort, ctx: RunGitContext): Promise<GitGuardInfo> {
  const state = await git.state();
  return { state, suggested: suggestBranchName(ctx.diagramName, ctx.now, state.branches), otherRuns: ctx.otherRuns };
}

/**
 * Comprueba la rama antes de arrancar y la prepara: aparta cambios y crea la rama si hace falta [R97.6]–[R97.9].
 * Sin elección (cola, asistente, trabajos) se aplica la de por defecto. Devuelve lo que la ejecución apunta, o
 * `undefined` si la carpeta no es un repositorio.
 */
export async function prepareRunGit(git: BranchGuardPort, choice: GitChoice | undefined, ctx: RunGitContext): Promise<RunGit | undefined> {
  const state = await git.state();
  const verdict = branchGuard(state, choice ?? defaultChoice(state, ctx.diagramName, ctx.now), { otherRuns: ctx.otherRuns, explicit: choice !== undefined, label: ctx.diagramName });
  if (!verdict) return undefined;
  if (!verdict.ok) throw new RunError('git-guard', verdict.problem.message);
  const { plan } = verdict;
  if (!plan.create) return { branch: plan.branch, ...(state.commit ? { commit: state.commit } : {}), ...(state.head ? { sha: state.head } : {}), ...(state.dirty > 0 ? { dirty: state.dirty } : {}) };
  let stashed = false;
  try {
    if (plan.stash) stashed = await git.stash(plan.stash);
    await git.createBranch(plan.create.name, plan.create.from);
  } catch (err) {
    const kept = stashed ? ` Tus cambios siguen apartados como «${plan.stash}»: recupéralos con «git stash pop».` : '';
    throw new RunError('git-guard', `${(err as Error).message}.${kept}`);
  }
  const after = await git.state().catch(() => state);
  return {
    branch: plan.branch,
    ...(after.commit ? { commit: after.commit } : {}),
    ...(after.head ? { sha: after.head } : {}),
    created: true,
    from: plan.create.from ?? state.branch!,
    ...(stashed ? { stash: plan.stash! } : {}),
    ...(after.dirty > 0 ? { dirty: after.dirty } : {}),
  };
}

/** Rama en la que está la carpeta, para reanudar y corregir: no se cambia nada [R97.9]. */
export async function currentRunGit(git: BranchGuardPort): Promise<RunGit | undefined> {
  const state = await git.state().catch(() => undefined);
  if (!state?.repo || state.branch === undefined) return undefined;
  return { branch: state.branch, ...(state.commit ? { commit: state.commit } : {}), ...(state.head ? { sha: state.head } : {}), ...(state.dirty > 0 ? { dirty: state.dirty } : {}) };
}
