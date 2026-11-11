import { execFile } from 'node:child_process';
import { reviewUrl, reviewWord, summarizeChecks, type RemoteRepo, type ReviewDraft, type ReviewHost, type ReviewInfo, type ReviewState } from '@orquestador/core';
import { GitError } from './git-cli';

/** Lanza un CLI (`gh`, `glab`) con una lista de argumentos, sin shell ni preguntas [R99.4]. */
export type CliRunner = (file: string, args: readonly string[], cwd: string) => Promise<string>;
export const runCli: CliRunner = (file, args, cwd) =>
  new Promise((resolve, reject) => {
    execFile(file, [...args], { cwd, windowsHide: true, timeout: 60_000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GH_PROMPT_DISABLED: '1', GLAB_NO_PROMPT: '1', NO_COLOR: '1', GH_NO_UPDATE_NOTIFIER: '1' } }, (err, stdout, stderr) => {
      if (err) reject(new GitError((stderr || err.message).trim().split('\n').slice(-3).join(' ')));
      else resolve(stdout);
    });
  });

type Check = 'pass' | 'fail' | 'pending';
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (typeof v === 'object' && v !== null ? (v as Obj) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const withUrl = (info: Omit<ReviewInfo, 'url'>, url: unknown): ReviewInfo => {
  const safe = reviewUrl(url);
  return safe ? { ...info, url: safe } : info;
};

/** Una comprobación de GitHub (check run o estado de commit) [R99.3]. */
export function githubCheck(item: unknown): Check {
  const c = obj(item);
  const conclusion = str(c['conclusion']).toUpperCase();
  const state = str(c['state']).toUpperCase();
  if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(conclusion) || state === 'SUCCESS') return 'pass';
  if (['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE'].includes(conclusion) || ['FAILURE', 'ERROR'].includes(state)) return 'fail';
  return 'pending';
}
/** El estado de un pipeline de GitLab [R99.3]. */
export function gitlabCheck(status: string): Check {
  if (['success', 'skipped', 'manual'].includes(status)) return 'pass';
  if (['failed', 'canceled'].includes(status)) return 'fail';
  return 'pending';
}

const githubState = (state: string, draft: boolean, merged: boolean): ReviewState => (merged || state.toUpperCase() === 'MERGED' ? 'merged' : state.toUpperCase() === 'CLOSED' ? 'closed' : draft ? 'draft' : 'open');
const gitlabState = (state: string, draft: boolean): ReviewState => (state === 'merged' ? 'merged' : state === 'closed' ? 'closed' : draft ? 'draft' : 'open');

function gitlabReview(item: unknown, pipeline?: unknown): ReviewInfo {
  const m = obj(item);
  const status = str(obj(pipeline ?? m['head_pipeline'])['status']);
  const checks = status ? summarizeChecks([gitlabCheck(status)]) : undefined;
  return withUrl({ number: Number(m['iid']), title: str(m['title']), state: gitlabState(str(m['state']), m['draft'] === true || m['work_in_progress'] === true), head: str(m['source_branch']), base: str(m['target_branch']), ...(checks ? { checks } : {}) }, m['web_url']);
}

const created = (draft: ReviewDraft, url: string, pattern: RegExp, what: string): ReviewInfo => {
  const m = pattern.exec(url);
  if (!m) throw new GitError(`No se pudo leer la ${what} creada`);
  return withUrl({ number: Number(m[2]), title: draft.title, state: draft.draft ? 'draft' : 'open', head: draft.head, base: draft.base }, m[1]);
};

/** ¿Está el CLI instalado y con sesión para ese servidor? [R99.4] */
export async function cliReady(repo: RemoteRepo, cwd: string, run: CliRunner = runCli): Promise<boolean> {
  return run(repo.provider === 'github' ? 'gh' : 'glab', ['auth', 'status', '--hostname', repo.host], cwd).then(() => true, () => false);
}

/** PR de GitHub con `gh` [R99.4]. */
export class GhCli implements ReviewHost {
  private readonly target: string;
  constructor(
    private readonly repo: RemoteRepo,
    private readonly cwd: string,
    private readonly run: CliRunner = runCli,
  ) {
    this.target = `${repo.host}/${repo.path}`;
  }
  async list(): Promise<ReviewInfo[]> {
    const text = await this.run('gh', ['pr', 'list', '--repo', this.target, '--state', 'all', '--limit', '50', '--json', 'number,title,state,isDraft,headRefName,baseRefName,url,statusCheckRollup'], this.cwd);
    return list(JSON.parse(text || '[]')).map((item) => {
      const p = obj(item);
      const checks = summarizeChecks(list(p['statusCheckRollup']).map(githubCheck));
      return withUrl({ number: Number(p['number']), title: str(p['title']), state: githubState(str(p['state']), p['isDraft'] === true, false), head: str(p['headRefName']), base: str(p['baseRefName']), ...(checks ? { checks } : {}) }, p['url']);
    });
  }
  async create(draft: ReviewDraft): Promise<ReviewInfo> {
    const out = await this.run('gh', ['pr', 'create', '--repo', this.target, '--title', draft.title, '--body', draft.body ?? '', '--base', draft.base, '--head', draft.head, ...(draft.draft ? ['--draft'] : [])], this.cwd);
    return created(draft, out, /(https:\/\/\S+\/pull\/(\d+))/, 'PR');
  }
}

/** MR de GitLab con `glab` [R99.4]. */
export class GlabCli implements ReviewHost {
  private readonly target: string;
  constructor(
    private readonly repo: RemoteRepo,
    private readonly cwd: string,
    private readonly run: CliRunner = runCli,
  ) {
    this.target = `${repo.host}/${repo.path}`;
  }
  async list(): Promise<ReviewInfo[]> {
    const text = await this.run('glab', ['mr', 'list', '--repo', this.target, '--all', '--per-page', '50', '--output', 'json'], this.cwd);
    return list(JSON.parse(text || '[]')).map((item) => gitlabReview(item));
  }
  async create(draft: ReviewDraft): Promise<ReviewInfo> {
    const out = await this.run('glab', ['mr', 'create', '--repo', this.target, '--title', draft.title, '--description', draft.body ?? '', '--source-branch', draft.head, '--target-branch', draft.base, '--yes', ...(draft.draft ? ['--draft'] : [])], this.cwd);
    return created(draft, out, /(https:\/\/\S+\/-\/merge_requests\/(\d+))/, 'MR');
  }
}

/** Lo mínimo de `fetch` que usan las API, para poder sustituirlo en los tests. */
export type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
/** Cuántas revisiones abiertas se miran para sus comprobaciones [R99.5]. */
export const CHECKED_REVIEWS = 10;

abstract class RestHost {
  constructor(
    protected readonly repo: RemoteRepo,
    private readonly token: string,
    private readonly fetchFn: FetchFn = (url, init) => fetch(url, init),
  ) {}
  protected abstract base(): string;
  protected abstract auth(token: string): Record<string, string>;

  /** Llama a la API del servidor de `origin`, siempre por HTTPS; el error nunca lleva el token [R99.5]. */
  protected async call(path: string, body?: unknown): Promise<unknown> {
    const url = `${this.base()}${path}`;
    if (!url.startsWith(`https://`)) throw new GitError('Solo se llama a la API por HTTPS');
    const word = reviewWord(this.repo.provider);
    let res: Awaited<ReturnType<FetchFn>>;
    try {
      res = await this.fetchFn(url, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { ...this.auth(this.token), Accept: 'application/json', 'User-Agent': 'orquestador', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new GitError(`No se pudo conectar con ${this.repo.host} para las ${word}.`);
    }
    const data: unknown = await res.json().catch(() => undefined);
    if (res.ok) return data;
    const why = res.status === 401 || res.status === 403 ? 'el token no vale o no tiene permiso' : res.status === 404 ? 'no se encuentra el proyecto (o el token no lo ve)' : str(obj(data)['message']).slice(0, 200) || `error ${res.status}`;
    throw new GitError(`${this.repo.host} rechazó la petición de las ${word}: ${why}.`);
  }
}

/** PR de GitHub por su API, con token [R99.5]. */
export class GithubRest extends RestHost implements ReviewHost {
  protected base(): string {
    return this.repo.host === 'github.com' ? 'https://api.github.com' : `https://${this.repo.host}/api/v3`;
  }
  protected auth(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' };
  }
  private toReview(item: unknown): ReviewInfo & { sha: string } {
    const p = obj(item);
    return { ...withUrl({ number: Number(p['number']), title: str(p['title']), state: githubState(str(p['state']), p['draft'] === true, typeof p['merged_at'] === 'string'), head: str(obj(p['head'])['ref']), base: str(obj(p['base'])['ref']) }, p['html_url']), sha: str(obj(p['head'])['sha']) };
  }
  async list(): Promise<ReviewInfo[]> {
    const items = list(await this.call(`/repos/${this.repo.path}/pulls?state=all&per_page=50&sort=updated&direction=desc`)).map((i) => this.toReview(i));
    const open = items.filter((r) => (r.state === 'open' || r.state === 'draft') && r.sha !== '').slice(0, CHECKED_REVIEWS);
    const checks = new Map<number, ReviewInfo['checks']>();
    await Promise.all(
      open.map(async (r) => {
        const runs = await this.call(`/repos/${this.repo.path}/commits/${r.sha}/check-runs?per_page=100`).catch(() => undefined);
        checks.set(r.number, summarizeChecks(list(obj(runs)['check_runs']).map(githubCheck)));
      }),
    );
    return items.map(({ sha: _sha, ...r }) => {
      void _sha;
      const c = checks.get(r.number);
      return c ? { ...r, checks: c } : r;
    });
  }
  async create(draft: ReviewDraft): Promise<ReviewInfo> {
    const { sha: _sha, ...r } = this.toReview(await this.call(`/repos/${this.repo.path}/pulls`, { title: draft.title, body: draft.body ?? '', head: draft.head, base: draft.base, draft: draft.draft === true }));
    void _sha;
    return r;
  }
}

/** MR de GitLab por su API, con token [R99.5]. */
export class GitlabRest extends RestHost implements ReviewHost {
  protected base(): string {
    return `https://${this.repo.host}/api/v4/projects/${encodeURIComponent(this.repo.path)}`;
  }
  protected auth(token: string): Record<string, string> {
    return { 'PRIVATE-TOKEN': token };
  }
  async list(): Promise<ReviewInfo[]> {
    const items = list(await this.call('/merge_requests?state=all&per_page=50&order_by=updated_at'));
    const open = items.filter((i) => str(obj(i)['state']) === 'opened').slice(0, CHECKED_REVIEWS);
    const pipelines = new Map<unknown, unknown>();
    await Promise.all(
      open.map(async (i) => {
        const one = await this.call(`/merge_requests/${Number(obj(i)['iid'])}`).catch(() => undefined);
        pipelines.set(obj(i)['iid'], obj(one)['head_pipeline']);
      }),
    );
    return items.map((i) => gitlabReview(i, pipelines.get(obj(i)['iid'])));
  }
  async create(draft: ReviewDraft): Promise<ReviewInfo> {
    return gitlabReview(await this.call('/merge_requests', { source_branch: draft.head, target_branch: draft.base, title: draft.draft ? `Draft: ${draft.title}` : draft.title, description: draft.body ?? '' }));
  }
}

export interface ReviewConnection {
  host?: ReviewHost;
  via?: 'cli' | 'token';
}

/** Elige cómo hablar con el servidor: el CLI si tiene sesión y, si no, el token guardado para ese servidor [R99.7]. */
export async function connectReviewHost(repo: RemoteRepo, deps: { cwd: string; token?: string | undefined; run?: CliRunner; fetch?: FetchFn }): Promise<ReviewConnection> {
  if (await cliReady(repo, deps.cwd, deps.run)) return { host: repo.provider === 'github' ? new GhCli(repo, deps.cwd, deps.run) : new GlabCli(repo, deps.cwd, deps.run), via: 'cli' };
  if (deps.token) return { host: repo.provider === 'github' ? new GithubRest(repo, deps.token, deps.fetch) : new GitlabRest(repo, deps.token, deps.fetch), via: 'token' };
  return {};
}
