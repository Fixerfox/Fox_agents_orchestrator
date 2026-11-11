import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { validBranchName, type GitBusy, type GitState, type VersionControl } from '@orquestador/core';

/** Error de git con un mensaje que se puede enseñar a la persona. */
export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitError';
  }
}

export type GitRunner = (args: readonly string[], cwd: string) => Promise<string>;

/** Lanza `git` con una lista de argumentos, sin shell y sin pedir nada por la terminal [R97.1]. */
export const runGit: GitRunner = (args, cwd) =>
  new Promise((resolve, reject) => {
    execFile('git', [...args], { cwd, windowsHide: true, timeout: 30_000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' } }, (err, stdout, stderr) => {
      if (err) reject(new GitError((stderr || err.message).trim().split('\n').slice(-3).join(' ')));
      else resolve(stdout);
    });
  });

const BUSY_MARKS: [string, GitBusy][] = [
  ['MERGE_HEAD', 'merge'],
  ['rebase-merge', 'rebase'],
  ['rebase-apply', 'rebase'],
  ['CHERRY_PICK_HEAD', 'cherry-pick'],
  ['REVERT_HEAD', 'revert'],
  ['BISECT_LOG', 'bisect'],
];

/** Lee `git status --porcelain=v2 --branch`: rama, commit, retraso y número de archivos con cambios. */
export function parseStatus(text: string): Pick<GitState, 'branch' | 'commit' | 'behind' | 'dirty'> {
  const out: Pick<GitState, 'branch' | 'commit' | 'behind' | 'dirty'> = { dirty: 0 };
  for (const line of text.split('\n')) {
    if (line.startsWith('# branch.oid ')) {
      const oid = line.slice(13).trim();
      if (oid !== '(initial)') out.commit = oid.slice(0, 7);
    } else if (line.startsWith('# branch.head ')) {
      const head = line.slice(14).trim();
      if (head !== '(detached)') out.branch = head;
    } else if (line.startsWith('# branch.ab ')) {
      const m = /-(\d+)/.exec(line);
      if (m) out.behind = Number(m[1]);
    } else if (line !== '' && !line.startsWith('#')) out.dirty++;
  }
  return out;
}

/** Git de una carpeta con el programa `git` del equipo [R97.1]. */
export class GitCli implements VersionControl {
  constructor(
    private readonly dir: () => string | Promise<string>,
    private readonly run: GitRunner = runGit,
  ) {}

  async state(): Promise<GitState> {
    const cwd = await this.dir();
    let gitDir: string;
    try {
      if ((await this.run(['rev-parse', '--is-inside-work-tree'], cwd)).trim() !== 'true') return { repo: false, dirty: 0, branches: [] };
      gitDir = path.resolve(cwd, (await this.run(['rev-parse', '--git-dir'], cwd)).trim());
    } catch {
      // Sin git instalado o fuera de un repositorio: no hay nada que guardar.
      return { repo: false, dirty: 0, branches: [] };
    }
    const status = parseStatus(await this.run(['status', '--porcelain=v2', '--branch', '--untracked-files=normal'], cwd));
    const branches = (await this.run(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], cwd)).split('\n').map((b) => b.trim()).filter(Boolean);
    let busy: GitBusy | undefined;
    for (const [mark, kind] of BUSY_MARKS) {
      if (await fs.stat(path.join(gitDir, mark)).then(() => true, () => false)) {
        busy = kind;
        break;
      }
    }
    return { repo: true, ...status, branches, ...(busy ? { busy } : {}) };
  }

  async createBranch(name: string, from?: string): Promise<void> {
    if (!validBranchName(name) || (from !== undefined && !validBranchName(from))) throw new GitError('Nombre de rama no válido');
    try {
      await this.run(['switch', '-c', name, ...(from !== undefined ? [from] : [])], await this.dir());
    } catch (err) {
      throw new GitError(`No se pudo crear la rama ${name}${from ? ` desde ${from}` : ''}: ${(err as Error).message}`);
    }
  }

  async stash(label: string): Promise<boolean> {
    const cwd = await this.dir();
    const before = (await this.run(['stash', 'list'], cwd)).split('\n').filter(Boolean).length;
    await this.run(['stash', 'push', '--include-untracked', '-m', label.replace(/[\r\n]+/g, ' ').slice(0, 200)], cwd);
    return (await this.run(['stash', 'list'], cwd)).split('\n').filter(Boolean).length > before;
  }
}
