import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RemoteRepo } from '@orquestador/core';
import { GhCli, GitCli, GitError, GithubRest, GitlabRest, GlabCli, cliReady, connectReviewHost, githubCheck, gitlabCheck, type CliRunner, type FetchFn } from '../src';

const GH: RemoteRepo = { provider: 'github', host: 'github.com', path: 'Fixerfox/app', name: 'app' };
const GL: RemoteRepo = { provider: 'gitlab', host: 'gitlab.miempresa.es', path: 'grupo/sub/app', name: 'app' };

/** CLI de mentira: guarda lo que se le pide y contesta según el subcomando. */
function cli(answers: Record<string, string | Error>) {
  const calls: { file: string; args: readonly string[] }[] = [];
  const run: CliRunner = async (file, args) => {
    calls.push({ file, args });
    const key = `${file} ${args[0]} ${args[1]}`;
    const a = answers[key];
    if (a === undefined) throw new GitError(`${key}: no se esperaba`);
    if (a instanceof Error) throw a;
    return a;
  };
  return { run, calls };
}
/** Red de mentira: contesta por ruta y guarda adónde y con qué cabeceras se llamó. */
function net(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, ...(init.body ? { body: init.body } : {}) });
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    if (!hit) return { ok: false, status: 404, json: async () => ({ message: 'Not Found' }) };
    const status = hit[1].status ?? 200;
    return { ok: status < 300, status, json: async () => hit[1].body };
  };
  return { fetchFn, calls };
}

describe('SPEC-099 · PR y MR con el CLI', () => {
  it('[R99.1] remoteUrl da la dirección de origin, o nada si no hay', { timeout: 30_000 }, async () => {
    const dir = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'orq-remote-')));
    try {
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, stdio: 'pipe' });
      expect(await new GitCli(() => dir).remoteUrl()).toBeUndefined();
      execFileSync('git', ['remote', 'add', 'origin', 'https://gitlab.miempresa.es/grupo/app.git'], { cwd: dir, stdio: 'pipe' });
      expect(await new GitCli(() => dir).remoteUrl()).toBe('https://gitlab.miempresa.es/grupo/app.git');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('[R99.3][R99.4] gh: lista las PR con su estado y sus comprobaciones, y abre una nueva', async () => {
    const list = JSON.stringify([
      { number: 31, title: 'Menú', state: 'OPEN', isDraft: false, headRefName: 'feature/menu', baseRefName: 'develop', url: 'https://github.com/Fixerfox/app/pull/31', statusCheckRollup: [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }, { __typename: 'StatusContext', state: 'SUCCESS' }, { __typename: 'CheckRun', status: 'IN_PROGRESS', conclusion: '' }] },
      { number: 30, title: 'Borrador', state: 'OPEN', isDraft: true, headRefName: 'wip', baseRefName: 'develop', url: 'https://github.com/Fixerfox/app/pull/30', statusCheckRollup: [] },
      { number: 29, title: 'Guarda', state: 'MERGED', isDraft: false, headRefName: 'feature/guarda', baseRefName: 'develop', url: 'javascript:alert(1)', statusCheckRollup: [{ conclusion: 'FAILURE' }] },
      { number: 12, title: 'Vieja', state: 'CLOSED', isDraft: false, headRefName: 'vieja', baseRefName: 'main', url: 'https://github.com/Fixerfox/app/pull/12', statusCheckRollup: null },
    ]);
    const c = cli({ 'gh pr list': list, 'gh pr create': 'Creating pull request…\nhttps://github.com/Fixerfox/app/pull/32\n' });
    const host = new GhCli(GH, '/repo', c.run);
    expect(await host.list()).toEqual([
      { number: 31, title: 'Menú', state: 'open', head: 'feature/menu', base: 'develop', url: 'https://github.com/Fixerfox/app/pull/31', checks: { state: 'pending', passed: 2, total: 3 } },
      { number: 30, title: 'Borrador', state: 'draft', head: 'wip', base: 'develop', url: 'https://github.com/Fixerfox/app/pull/30' },
      // [R99.6] un enlace que no es de PR no se enseña.
      { number: 29, title: 'Guarda', state: 'merged', head: 'feature/guarda', base: 'develop', checks: { state: 'failing', passed: 0, total: 1 } },
      { number: 12, title: 'Vieja', state: 'closed', head: 'vieja', base: 'main', url: 'https://github.com/Fixerfox/app/pull/12' },
    ]);
    expect(c.calls[0]!.args).toEqual(['pr', 'list', '--repo', 'github.com/Fixerfox/app', '--state', 'all', '--limit', '50', '--json', 'number,title,state,isDraft,headRefName,baseRefName,url,statusCheckRollup']);
    const made = await host.create({ title: 'Opciones; rm -rf /', head: 'feature/opciones', base: 'develop', draft: true });
    expect(made).toEqual({ number: 32, title: 'Opciones; rm -rf /', state: 'draft', head: 'feature/opciones', base: 'develop', url: 'https://github.com/Fixerfox/app/pull/32' });
    expect(c.calls[1]!.args).toEqual(['pr', 'create', '--repo', 'github.com/Fixerfox/app', '--title', 'Opciones; rm -rf /', '--body', '', '--base', 'develop', '--head', 'feature/opciones', '--draft']);
  });

  it('[R99.4] glab: lista las MR y abre una nueva en el proyecto con subgrupos', async () => {
    const list = JSON.stringify([
      { iid: 7, title: 'Menú', state: 'opened', draft: false, source_branch: 'feature/menu', target_branch: 'develop', web_url: 'https://gitlab.miempresa.es/grupo/sub/app/-/merge_requests/7', head_pipeline: { status: 'success' } },
      { iid: 6, title: 'A medias', state: 'opened', work_in_progress: true, source_branch: 'wip', target_branch: 'develop', web_url: 'https://gitlab.miempresa.es/grupo/sub/app/-/merge_requests/6' },
      { iid: 5, title: 'Hecha', state: 'merged', source_branch: 'x', target_branch: 'main', web_url: 'https://gitlab.miempresa.es/grupo/sub/app/-/merge_requests/5', head_pipeline: { status: 'failed' } },
    ]);
    const c = cli({ 'glab mr list': list, 'glab mr create': '!8 Opciones (feature/opciones)\n https://gitlab.miempresa.es/grupo/sub/app/-/merge_requests/8\n' });
    const host = new GlabCli(GL, '/repo', c.run);
    expect(await host.list()).toEqual([
      { number: 7, title: 'Menú', state: 'open', head: 'feature/menu', base: 'develop', url: 'https://gitlab.miempresa.es/grupo/sub/app/-/merge_requests/7', checks: { state: 'passing', passed: 1, total: 1 } },
      { number: 6, title: 'A medias', state: 'draft', head: 'wip', base: 'develop', url: 'https://gitlab.miempresa.es/grupo/sub/app/-/merge_requests/6' },
      { number: 5, title: 'Hecha', state: 'merged', head: 'x', base: 'main', url: 'https://gitlab.miempresa.es/grupo/sub/app/-/merge_requests/5', checks: { state: 'failing', passed: 0, total: 1 } },
    ]);
    expect(await host.create({ title: 'Opciones', body: 'Lo que hace', head: 'feature/opciones', base: 'develop' })).toMatchObject({ number: 8, state: 'open', url: 'https://gitlab.miempresa.es/grupo/sub/app/-/merge_requests/8' });
    expect(c.calls[1]!.args).toEqual(['mr', 'create', '--repo', 'gitlab.miempresa.es/grupo/sub/app', '--title', 'Opciones', '--description', 'Lo que hace', '--source-branch', 'feature/opciones', '--target-branch', 'develop', '--yes']);
    await expect(new GhCli(GH, '/repo', cli({ 'gh pr create': 'sin enlace' }).run).create({ title: 't', head: 'a', base: 'b' })).rejects.toThrow(/No se pudo leer la PR creada/);
  });

  it('[R99.3] cada comprobación de GitHub y cada pipeline de GitLab se lee como pasa, falla o sigue', () => {
    expect(['SUCCESS', 'NEUTRAL', 'SKIPPED'].map((conclusion) => githubCheck({ conclusion }))).toEqual(['pass', 'pass', 'pass']);
    expect(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED'].map((conclusion) => githubCheck({ conclusion }))).toEqual(['fail', 'fail', 'fail', 'fail']);
    expect([githubCheck({ state: 'ERROR' }), githubCheck({ state: 'PENDING' }), githubCheck({ status: 'queued', conclusion: null }), githubCheck(null)]).toEqual(['fail', 'pending', 'pending', 'pending']);
    expect(['success', 'failed', 'canceled', 'running', 'pending', 'created'].map(gitlabCheck)).toEqual(['pass', 'fail', 'fail', 'pending', 'pending', 'pending']);
  });
});

describe('SPEC-099 · PR y MR con token', () => {
  it('[R99.5] GitHub: lista con las comprobaciones de las abiertas y crea; el token solo va en la cabecera y a su API', async () => {
    const pull = (number: number, more: object) => ({ number, title: `PR ${number}`, state: 'open', draft: false, merged_at: null, head: { ref: `rama-${number}`, sha: `sha${number}` }, base: { ref: 'develop' }, html_url: `https://github.com/Fixerfox/app/pull/${number}`, ...more });
    const n = net({
      '/pulls?state=all': { body: [pull(31, {}), pull(30, { draft: true }), pull(29, { state: 'closed', merged_at: '2026-11-10T10:00:00Z' }), pull(12, { state: 'closed' })] },
      '/commits/sha31/check-runs': { body: { check_runs: [{ status: 'completed', conclusion: 'success' }, { status: 'completed', conclusion: 'failure' }] } },
      '/commits/sha30/check-runs': { body: { check_runs: [] } },
      '/repos/Fixerfox/app/pulls': { status: 201, body: pull(32, { title: 'Opciones' }) },
    });
    const host = new GithubRest(GH, 'ghp_TOKENSECRETO', n.fetchFn);
    const reviews = await host.list();
    expect(reviews.map((r) => [r.number, r.state])).toEqual([[31, 'open'], [30, 'draft'], [29, 'merged'], [12, 'closed']]);
    expect(reviews[0]).toEqual({ number: 31, title: 'PR 31', state: 'open', head: 'rama-31', base: 'develop', url: 'https://github.com/Fixerfox/app/pull/31', checks: { state: 'failing', passed: 1, total: 2 } });
    expect(reviews[1]!.checks).toBeUndefined();
    // Solo se miran las comprobaciones de las abiertas.
    expect(n.calls.filter((c) => c.url.includes('check-runs')).map((c) => c.url).sort()).toEqual(['https://api.github.com/repos/Fixerfox/app/commits/sha30/check-runs?per_page=100', 'https://api.github.com/repos/Fixerfox/app/commits/sha31/check-runs?per_page=100']);
    expect(await host.create({ title: 'Opciones', head: 'feature/opciones', base: 'develop' })).toMatchObject({ number: 32, title: 'Opciones', state: 'open' });
    const post = n.calls.at(-1)!;
    expect(post).toMatchObject({ method: 'POST', url: 'https://api.github.com/repos/Fixerfox/app/pulls' });
    expect(JSON.parse(post.body!)).toEqual({ title: 'Opciones', body: '', head: 'feature/opciones', base: 'develop', draft: false });
    for (const c of n.calls) {
      expect(c.url.startsWith('https://api.github.com/')).toBe(true);
      expect(c.url).not.toContain('ghp_TOKENSECRETO');
      expect(c.headers['Authorization']).toBe('Bearer ghp_TOKENSECRETO');
      expect(c.body ?? '').not.toContain('ghp_TOKENSECRETO');
    }
    // Un GitHub propio usa /api/v3 de su servidor.
    const own = net({ '/pulls': { body: [] } });
    await new GithubRest({ ...GH, host: 'github.miempresa.es' }, 'tok', own.fetchFn).list();
    expect(own.calls[0]!.url).toBe('https://github.miempresa.es/api/v3/repos/Fixerfox/app/pulls?state=all&per_page=50&sort=updated&direction=desc');
  });

  it('[R99.5] GitLab: lista con el pipeline de las abiertas y crea, en la API de su propio servidor', async () => {
    const mr = (iid: number, more: object) => ({ iid, title: `MR ${iid}`, state: 'opened', draft: false, source_branch: `rama-${iid}`, target_branch: 'develop', web_url: `https://gitlab.miempresa.es/grupo/sub/app/-/merge_requests/${iid}`, ...more });
    const n = net({
      '/merge_requests?state=all': { body: [mr(7, {}), mr(5, { state: 'merged' })] },
      '/merge_requests/7': { body: mr(7, { head_pipeline: { status: 'running' } }) },
      '/merge_requests': { status: 201, body: mr(8, { title: 'Draft: Opciones', draft: true }) },
    });
    const host = new GitlabRest(GL, 'glpat-SECRETO', n.fetchFn);
    expect(await host.list()).toEqual([
      { number: 7, title: 'MR 7', state: 'open', head: 'rama-7', base: 'develop', url: 'https://gitlab.miempresa.es/grupo/sub/app/-/merge_requests/7', checks: { state: 'pending', passed: 0, total: 1 } },
      { number: 5, title: 'MR 5', state: 'merged', head: 'rama-5', base: 'develop', url: 'https://gitlab.miempresa.es/grupo/sub/app/-/merge_requests/5' },
    ]);
    expect(await host.create({ title: 'Opciones', head: 'feature/opciones', base: 'develop', draft: true })).toMatchObject({ number: 8, state: 'draft' });
    expect(JSON.parse(n.calls.at(-1)!.body!)).toEqual({ source_branch: 'feature/opciones', target_branch: 'develop', title: 'Draft: Opciones', description: '' });
    for (const c of n.calls) {
      expect(c.url.startsWith('https://gitlab.miempresa.es/api/v4/projects/grupo%2Fsub%2Fapp/')).toBe(true);
      expect(c.headers['PRIVATE-TOKEN']).toBe('glpat-SECRETO');
      expect(c.url).not.toContain('glpat-SECRETO');
    }
  });

  it('[R99.5] un error de la API se explica sin enseñar el token', async () => {
    const tok = 'ghp_TOKENSECRETO';
    await expect(new GithubRest(GH, tok, net({ '/pulls': { status: 401, body: { message: `Bad credentials ${tok}` } } }).fetchFn).list()).rejects.toThrow('github.com rechazó la petición de las PR: el token no vale o no tiene permiso.');
    await expect(new GithubRest(GH, tok, net({}).fetchFn).list()).rejects.toThrow(/no se encuentra el proyecto/);
    await expect(new GitlabRest(GL, tok, net({ '/merge_requests': { status: 422, body: { message: 'Validation failed' } } }).fetchFn).create({ title: 't', head: 'a', base: 'b' })).rejects.toThrow('gitlab.miempresa.es rechazó la petición de las MR: Validation failed.');
    const down: FetchFn = async () => {
      throw new Error(`connect ECONNREFUSED con ${tok}`);
    };
    const err = await new GithubRest(GH, tok, down).list().catch((e: Error) => e);
    expect((err as Error).message).toBe('No se pudo conectar con github.com para las PR.');
  });
});

describe('SPEC-099 · conectar', () => {
  it('[R99.4][R99.7] primero el CLI con sesión para ese servidor; si no, el token; y si no hay ninguno, nada', async () => {
    const ready = cli({ 'gh auth status': 'ok', 'gh pr list': '[]' });
    expect(await cliReady(GH, '/repo', ready.run)).toBe(true);
    expect(ready.calls[0]).toEqual({ file: 'gh', args: ['auth', 'status', '--hostname', 'github.com'] });
    const withCli = await connectReviewHost(GH, { cwd: '/repo', token: 'tok-guardado', run: ready.run });
    expect(withCli.via).toBe('cli');
    expect(withCli.host).toBeInstanceOf(GhCli);
    const noCli = cli({ 'glab auth status': new GitError('glab: command not found') });
    expect(await cliReady(GL, '/repo', noCli.run)).toBe(false);
    expect(noCli.calls[0]).toEqual({ file: 'glab', args: ['auth', 'status', '--hostname', 'gitlab.miempresa.es'] });
    const withToken = await connectReviewHost(GL, { cwd: '/repo', token: 'tok-guardado', run: noCli.run });
    expect(withToken.via).toBe('token');
    expect(withToken.host).toBeInstanceOf(GitlabRest);
    expect(await connectReviewHost(GL, { cwd: '/repo', run: noCli.run })).toEqual({});
    expect((await connectReviewHost(GL, { cwd: '/repo', run: cli({ 'glab auth status': 'ok' }).run })).host).toBeInstanceOf(GlabCli);
    expect((await connectReviewHost(GH, { cwd: '/repo', token: 't', run: cli({ 'gh auth status': new GitError('no') }).run })).host).toBeInstanceOf(GithubRest);
  });
});
