import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { validBranchName, type GitBranchInfo, type GitBusy, type GitCommit, type GitFileChange, type GitFileStatus, type GitStash, type GitState, type VersionControl } from '@orquestador/core';

/** Error de git con un mensaje que se puede enseñar a la persona. */
export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitError';
  }
}

export type GitRunner = (args: readonly string[], cwd: string, opts?: { timeoutMs?: number }) => Promise<string>;

/** Lanza `git` con una lista de argumentos, sin shell y sin pedir nada por la terminal [R97.1]. */
export const runGit: GitRunner = (args, cwd, opts) =>
  new Promise((resolve, reject) => {
    execFile('git', ['-c', 'core.quotepath=off', ...args], { cwd, windowsHide: true, timeout: opts?.timeoutMs ?? 30_000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' } }, (err, stdout, stderr) => {
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
export function parseStatus(text: string): Pick<GitState, 'branch' | 'commit' | 'head' | 'behind' | 'dirty'> {
  const out: Pick<GitState, 'branch' | 'commit' | 'head' | 'behind' | 'dirty'> = { dirty: 0 };
  for (const line of text.split('\n')) {
    if (line.startsWith('# branch.oid ')) {
      const oid = line.slice(13).trim();
      if (oid !== '(initial)') {
        out.commit = oid.slice(0, 7);
        out.head = oid;
      }
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

/** Tope de lo que se enseña de una diferencia [R98.3]. */
export const MAX_DIFF_CHARS = 200_000;
const SEP = '\x1f';
const REMOTE_TIMEOUT = { timeoutMs: 120_000 };

/** Lee `for-each-ref` con campos separados por `\x1f`: ramas locales y remotas [R98.2]. */
export function parseBranches(text: string, current: string | undefined): GitBranchInfo[] {
  const out: GitBranchInfo[] = [];
  for (const line of text.split('\n')) {
    const [ref, sha, upstream, track, date, subject] = line.split(SEP);
    if (!ref || !sha) continue;
    const remote = ref.startsWith('refs/remotes/');
    const name = ref.replace(/^refs\/(heads|remotes)\//, '');
    if (remote && name.endsWith('/HEAD')) continue;
    const ahead = /ahead (\d+)/.exec(track ?? '');
    const behind = /behind (\d+)/.exec(track ?? '');
    out.push({
      name,
      sha,
      ...(remote ? { remote: true } : {}),
      ...(!remote && name === current ? { current: true } : {}),
      ...(upstream ? { upstream, ahead: ahead ? Number(ahead[1]) : 0, behind: behind ? Number(behind[1]) : 0 } : {}),
      ...((track ?? '').includes('gone') ? { gone: true } : {}),
      ...(subject ? { subject } : {}),
      ...(date ? { date } : {}),
    });
  }
  return out;
}

/** Lee `git log` con campos separados por `\x1f` [R98.2]. */
export function parseLog(text: string): GitCommit[] {
  const out: GitCommit[] = [];
  for (const line of text.split('\n')) {
    const [sha, parents, author, date, refs, ...subject] = line.split(SEP);
    if (!sha || date === undefined) continue;
    out.push({
      sha,
      parents: parents ? parents.split(' ').filter(Boolean) : [],
      author: author ?? '',
      date,
      refs: (refs ?? '').split(', ').map((r) => r.replace(/^HEAD -> /, '').trim()).filter((r) => r !== '' && r !== 'HEAD' && !r.endsWith('/HEAD')),
      subject: subject.join(SEP),
    });
  }
  return out;
}

const STATUS_OF = (xy: string): GitFileStatus => {
  if (xy === '??') return 'untracked';
  if (xy.includes('U') || xy === 'AA' || xy === 'DD') return 'conflict';
  if (xy.includes('R')) return 'renamed';
  if (xy.includes('A')) return 'added';
  if (xy.includes('D')) return 'deleted';
  return 'modified';
};

/** Lee `git status --porcelain=v1 -z` y le suma las líneas de `git diff --numstat -z HEAD` [R98.3]. */
export function parseChanges(status: string, numstat = ''): GitFileChange[] {
  const stats = new Map<string, { added: number; removed: number }>();
  const nums = numstat.split('\0');
  for (let i = 0; i < nums.length; i++) {
    const m = /^(\d+|-)\t(\d+|-)\t(.*)$/.exec(nums[i]!);
    if (!m) continue;
    // En un renombrado la ruta viene en los dos campos siguientes: origen y destino.
    const file = m[3] !== '' ? m[3]! : (nums[(i += 2)] ?? '');
    if (m[1] !== '-') stats.set(file, { added: Number(m[1]), removed: Number(m[2]) });
  }
  const out: GitFileChange[] = [];
  const parts = status.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]!;
    if (entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    const file = entry.slice(3);
    if (xy.includes('R') || xy.includes('C')) i++; // el nombre anterior va detrás
    out.push({ path: file, status: STATUS_OF(xy), ...(stats.get(file) ?? {}) });
  }
  return out;
}

/** ¿Ruta relativa dentro del repositorio, que git no pueda tomar por una opción? */
const safeFile = (file: string) => file !== '' && !file.startsWith('-') && !path.isAbsolute(file) && !file.split(/[\\/]/).includes('..') && !file.includes('\0');

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

  // --- visor [R98.1] ---

  async branches(): Promise<GitBranchInfo[]> {
    const cwd = await this.dir();
    const current = (await this.run(['branch', '--show-current'], cwd)).trim() || undefined;
    const format = ['%(refname)', '%(objectname)', '%(upstream:short)', '%(upstream:track)', '%(committerdate:iso-strict)', '%(subject)'].join('%1f');
    return parseBranches(await this.run(['for-each-ref', `--format=${format}`, '--sort=-committerdate', 'refs/heads', 'refs/remotes'], cwd), current);
  }

  async history(limit: number): Promise<GitCommit[]> {
    const n = Math.max(1, Math.min(1000, Math.floor(limit)));
    try {
      return parseLog(await this.run(['log', '--all', '--date-order', `-n${n}`, '--format=%H%x1f%P%x1f%an%x1f%aI%x1f%D%x1f%s'], await this.dir()));
    } catch {
      return []; // un repositorio sin commits
    }
  }

  async changes(): Promise<GitFileChange[]> {
    const cwd = await this.dir();
    const status = await this.run(['status', '--porcelain=v1', '-z', '--untracked-files=all'], cwd);
    const numstat = await this.run(['diff', '--numstat', '-z', 'HEAD'], cwd).catch(() => '');
    return parseChanges(status, numstat);
  }

  async diff(file: string): Promise<string> {
    if (!safeFile(file)) throw new GitError('Ruta no válida');
    // Las rutas de los cambios son relativas a la raíz del repositorio, que puede estar por encima de la carpeta.
    const top = (await this.run(['rev-parse', '--show-toplevel'], await this.dir())).trim();
    let text = await this.run(['diff', 'HEAD', '--', file], top).catch(() => '');
    if (text === '') {
      // Un archivo nuevo sin seguir no sale en `git diff`: se enseña entero como añadido.
      const body = await fs.readFile(path.resolve(top, file)).catch(() => undefined);
      if (body === undefined) return '';
      if (body.subarray(0, 8000).includes(0)) return 'Archivo binario';
      text = body.toString('utf8').split('\n').map((l) => `+${l}`).join('\n');
    }
    return text.length > MAX_DIFF_CHARS ? `${text.slice(0, MAX_DIFF_CHARS)}\n… (recortado)` : text;
  }

  async stashes(): Promise<GitStash[]> {
    const text = await this.run(['stash', 'list', '--format=%gd%x1f%gs%x1f%cI'], await this.dir());
    return text.split('\n').flatMap((line) => {
      const [ref, label, date] = line.split(SEP);
      const m = /\{(\d+)\}/.exec(ref ?? '');
      return m ? [{ index: Number(m[1]), label: (label ?? '').replace(/^(On|WIP on) [^:]+: /, ''), ...(date ? { date } : {}) }] : [];
    });
  }

  async range(from: string, to: string): Promise<string[]> {
    if (!/^[0-9a-f]{7,64}$/.test(from) || !/^[0-9a-f]{7,64}$/.test(to)) return [];
    const text = await this.run(['rev-list', '--max-count=500', `${from}..${to}`], await this.dir()).catch(() => '');
    return text.split('\n').filter(Boolean);
  }

  private async act(what: string, args: string[], opts?: { timeoutMs?: number }): Promise<string> {
    try {
      return await this.run(args, await this.dir(), opts);
    } catch (err) {
      throw new GitError(`${what}: ${(err as Error).message}`);
    }
  }
  private branchArg(name: string): string {
    if (!validBranchName(name)) throw new GitError('Nombre de rama no válido');
    return name;
  }

  async switchBranch(name: string): Promise<void> {
    await this.act(`No se pudo cambiar a ${name}`, ['switch', this.branchArg(name)]);
  }

  async commit(message: string): Promise<string> {
    if (message.trim() === '') throw new GitError('El commit necesita un mensaje');
    await this.act('No se pudieron preparar los cambios', ['add', '-A']);
    await this.act('No se pudo hacer el commit', ['commit', '-m', message.trim()]);
    return (await this.run(['rev-parse', '--short', 'HEAD'], await this.dir())).trim();
  }

  async push(): Promise<void> {
    const cwd = await this.dir();
    const current = (await this.run(['branch', '--show-current'], cwd)).trim();
    if (!current) throw new GitError('No estás en ninguna rama');
    await this.act(`No se pudo subir ${current}`, ['push', '--set-upstream', 'origin', this.branchArg(current)], REMOTE_TIMEOUT);
  }

  async pull(): Promise<void> {
    await this.act('No se pudo traer la rama', ['pull', '--ff-only'], REMOTE_TIMEOUT);
  }

  async fetch(): Promise<void> {
    await this.act('No se pudo traer del remoto', ['fetch', '--all', '--prune'], REMOTE_TIMEOUT);
  }

  async merge(name: string): Promise<void> {
    const cwd = await this.dir();
    try {
      await this.run(['merge', '--no-edit', this.branchArg(name)], cwd);
    } catch (err) {
      // Con conflictos se deja todo como estaba: resolverlos es cosa de la terminal [R98.6].
      const aborted = await this.run(['merge', '--abort'], cwd).then(() => true, () => false);
      throw new GitError(aborted ? `No se pudo fusionar ${name}: hay conflictos. Se ha dejado todo como estaba; resuélvelos en la terminal.` : `No se pudo fusionar ${name}: ${(err as Error).message}`);
    }
  }

  async deleteBranch(name: string): Promise<void> {
    await this.act(`No se pudo borrar ${name}`, ['branch', '-d', this.branchArg(name)]);
  }

  async stashPop(index: number): Promise<void> {
    if (!Number.isInteger(index) || index < 0) throw new GitError('Ese apartado no existe');
    await this.act('No se pudieron recuperar los cambios', ['stash', 'pop', `stash@{${index}}`]);
  }

  async remoteUrl(): Promise<string | undefined> {
    const url = await this.run(['remote', 'get-url', 'origin'], await this.dir()).then((t) => t.trim(), () => '');
    return url === '' ? undefined : url;
  }
}
