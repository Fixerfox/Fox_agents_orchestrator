import { branchOrigins, gitActionProblem, type GitAction, type GitBranchInfo, type GitCommit, type GitFileChange, type GitOrigin, type GitStash, type GitState, type RunGitTrace, type RunRepository, type VersionControl } from '@orquestador/core';
import { RunError } from './errors';

/** Lo que enseña la sección «Versiones» de un vistazo [R98.2]. */
export interface GitOverview {
  state: GitState;
  branches: GitBranchInfo[];
  changes: GitFileChange[];
  stashes: GitStash[];
  /** Ejecuciones en marcha en la carpeta: bloquean lo que mueve la rama [R98.8]. */
  running: number;
  /** Rama → el trabajo que la creó [R98.4]. */
  origins: Record<string, GitOrigin>;
}

export interface GitHistoryView {
  commits: GitCommit[];
  /** Commit → el trabajo que lo hizo [R98.4]. */
  origins: Record<string, GitOrigin>;
}

/** Cuántas ejecuciones se miran para saber qué creó cada una [R98.4]. */
export const ORIGIN_RUNS = 60;

/** Git de la carpeta para el visor y para el asistente: lee, comprueba y actúa [R98.1]. */
export class GitService {
  /** Commits de cada tramo `desde..hasta` ya calculado: no cambia nunca. */
  private readonly ranges = new Map<string, string[]>();

  constructor(
    private readonly repo: VersionControl,
    private readonly runs: Pick<RunRepository, 'list' | 'appendEvent'>,
    private readonly running: () => number,
    private readonly live: () => ReadonlySet<string>,
  ) {}

  private async traces(): Promise<RunGitTrace[]> {
    const metas = await this.runs.list({ live: this.live() }).catch(() => []);
    return metas
      .filter((m) => m.git !== undefined)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, ORIGIN_RUNS)
      .map((m) => ({ runId: m.runId, name: m.diagramName ?? m.diagramId, ...m.git }));
  }

  /** `null` si la carpeta no es un repositorio. */
  async overview(): Promise<GitOverview | null> {
    const state = await this.repo.state();
    if (!state.repo) return null;
    const [branches, changes, stashes, traces] = await Promise.all([this.repo.branches(), this.repo.changes(), this.repo.stashes(), this.traces()]);
    return { state, branches, changes, stashes, running: this.running(), origins: branchOrigins(traces) };
  }

  async history(limit: number): Promise<GitHistoryView> {
    const commits = await this.repo.history(limit);
    const shown = new Set(commits.map((c) => c.sha));
    const origins: Record<string, GitOrigin> = {};
    // De la más vieja a la más nueva: si dos tramos comparten un commit, es de la que lo hizo primero.
    for (const t of (await this.traces()).reverse()) {
      if (!t.fromSha || !t.toSha || t.fromSha === t.toSha) continue;
      const key = `${t.fromSha}..${t.toSha}`;
      let shas = this.ranges.get(key);
      if (!shas) {
        shas = await this.repo.range(t.fromSha, t.toSha);
        this.ranges.set(key, shas);
      }
      for (const sha of shas) if (shown.has(sha) && !(sha in origins)) origins[sha] = { runId: t.runId, name: t.name };
    }
    return { commits, origins };
  }

  diff(file: string): Promise<string> {
    return this.repo.diff(file);
  }

  /** Comprueba la acción con el estado de ahora y la hace; devuelve cómo queda todo [R98.6][R98.7]. */
  async act(action: GitAction): Promise<GitOverview> {
    const state = await this.repo.state();
    const branches = state.repo ? (await this.repo.branches()).filter((b) => !b.remote).map((b) => b.name) : [];
    const problem = gitActionProblem(action, state, { running: this.running(), branches });
    if (problem) throw new RunError('git-guard', problem);
    try {
      switch (action.kind) {
        case 'create':
          await this.repo.createBranch(action.name, action.from);
          break;
        case 'switch':
          await this.repo.switchBranch(action.name);
          break;
        case 'commit':
          await this.repo.commit(action.message);
          break;
        case 'push':
          await this.repo.push();
          break;
        case 'pull':
          await this.repo.pull();
          break;
        case 'fetch':
          await this.repo.fetch();
          break;
        case 'merge':
          await this.repo.merge(action.name);
          break;
        case 'delete':
          await this.repo.deleteBranch(action.name);
          break;
        case 'stash':
          await this.repo.stash(action.label ?? 'orquestador: apartado a mano');
          break;
        case 'stash-pop':
          await this.repo.stashPop(action.index);
          break;
      }
    } catch (err) {
      throw new RunError('git-guard', (err as Error).message);
    }
    return (await this.overview())!;
  }

  /** Al terminar una ejecución que apuntó git, guarda en qué commit quedó la carpeta [R98.4]. */
  async noteRunEnd(runId: string): Promise<void> {
    const state = await this.repo.state().catch(() => undefined);
    if (!state?.repo || !state.head) return;
    await this.runs.appendEvent?.(runId, { type: 'run.git.ended', ...(state.branch ? { branch: state.branch } : {}), sha: state.head });
  }
}
