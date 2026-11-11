import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ReviewInfo } from '@orquestador/core';
import { CHANNELS, type GitReviewsView } from '@orquestador/editor';
import { GitError, type CliRunner, type FetchFn } from '@orquestador/git';
import { createDemoOrchestrator } from '@orquestador/runtime';
import { McpSecretVault } from '@orquestador/store';
import { DesktopHandlers } from '../src/main/handlers';

let dir: string;
let work: string;
let h: DesktopHandlers;
/** ¿Tiene sesión el CLI de mentira? */
let cliLogged: boolean;
let cliCalls: string[];
let netCalls: { url: string; headers: Record<string, string>; method: string }[];

const SLOW = { timeout: 40_000 };
const TOKEN = 'ghp_TOKENSECRETO1234';
const cipher = { available: () => true, encrypt: (s: string) => Buffer.from(`c:${s}`), decrypt: (b: Buffer) => b.toString().slice(2) };
const git = (...args: string[]) => execFileSync('git', args, { cwd: work, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).toString().trim();
const val = <T,>(r: unknown) => {
  const x = r as { ok: boolean; value?: T; error?: unknown };
  if (!x.ok) throw new Error(JSON.stringify(x.error));
  return x.value as T;
};
const run: CliRunner = async (file, args) => {
  cliCalls.push(`${file} ${args.slice(0, 2).join(' ')}`);
  if (args[0] === 'auth') {
    if (!cliLogged) throw new GitError('not logged in');
    return '';
  }
  if (args[1] === 'list') return JSON.stringify([{ number: 31, title: 'Menú', state: 'OPEN', isDraft: false, headRefName: 'feature/menu', baseRefName: 'main', url: 'https://github.com/Fixerfox/app/pull/31', statusCheckRollup: [{ conclusion: 'SUCCESS' }] }]);
  return 'https://github.com/Fixerfox/app/pull/32\n';
};
const fetchFn: FetchFn = async (url, init) => {
  netCalls.push({ url, headers: init.headers, method: init.method });
  return { ok: true, status: 200, json: async () => (url.includes('/pulls?') ? [{ number: 7, title: 'Por API', state: 'open', draft: false, merged_at: null, head: { ref: 'feature/menu', sha: 'abc' }, base: { ref: 'main' }, html_url: 'https://github.com/Fixerfox/app/pull/7' }] : { check_runs: [] }) };
};

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'orq-reviews-')));
  work = join(dir, 'app');
  await fs.mkdir(work);
  cliLogged = true;
  cliCalls = [];
  netCalls = [];
  h = new DesktopHandlers({ pickFolder: async () => work, createOrchestrator: createDemoOrchestrator, mcpVault: new McpSecretVault(join(dir, 'config'), cipher), reviewTools: { run, fetch: fetchFn } });
});
afterEach(async () => {
  h.dispose();
  await fs.rm(dir, { recursive: true, force: true });
});

async function open(remote?: string) {
  git('init', '-q', '-b', 'main');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'user.name', 't');
  git('config', 'user.email', 't@t');
  await fs.writeFile(join(work, 'README.md'), '# App\n');
  git('add', '.');
  git('commit', '-q', '-m', 'inicial');
  // La dirección se escribe tal cual en la configuración, sin que git la reescriba.
  if (remote) git('config', 'remote.origin.url', remote);
  val(await h.invoke(CHANNELS.createProject, undefined));
}
const reviews = async () => val<GitReviewsView | null>(await h.invoke(CHANNELS.gitReviews, undefined));
const vaultText = () => fs.readFile(join(dir, 'config', 'mcp-secrets.bin')).then((b) => b.toString('latin1'), () => '');

describe('SPEC-099 · PR y MR por IPC', () => {
  it('[R99.7] sin origin, o con uno que no es GitHub ni GitLab, no hay revisiones y no se llama a nada', SLOW, async () => {
    await open();
    expect(await reviews()).toBeNull();
    git('config', 'remote.origin.url', 'https://bitbucket.org/a/b.git');
    expect(await reviews()).toBeNull();
    expect(cliCalls).toEqual([]);
    expect(netCalls).toEqual([]);
    expect(await h.invoke(CHANNELS.setReviewToken, { token: TOKEN })).toMatchObject({ ok: false, error: { message: expect.stringMatching(/no tiene un origin de GitHub ni de GitLab/) } });
  });

  it('[R99.4][R99.7] con el CLI con sesión se ven las PR sin token y sin tocar la red', SLOW, async () => {
    await open('https://github.com/Fixerfox/app.git');
    const view = (await reviews())!;
    expect(view).toMatchObject({ provider: 'github', word: 'PR', host: 'github.com', project: 'Fixerfox/app', via: 'cli' });
    expect(view.base).toBeUndefined();
    expect(view.reviews).toEqual([{ number: 31, title: 'Menú', state: 'open', head: 'feature/menu', base: 'main', url: 'https://github.com/Fixerfox/app/pull/31', checks: { state: 'passing', passed: 1, total: 1 } }]);
    expect(cliCalls).toEqual(['gh auth status', 'gh pr list']);
    expect(netCalls).toEqual([]);
    expect(JSON.stringify(view)).not.toContain(dir);
  });

  it('[R99.5][R99.8] sin CLI no está conectado; con un token se ven por la API, y el token se guarda cifrado y solo viaja a ese servidor', SLOW, async () => {
    cliLogged = false;
    await open('https://github.com/Fixerfox/app.git');
    const off = (await reviews())!;
    expect(off.via).toBeUndefined();
    expect(off.reviews).toEqual([]);
    expect(netCalls).toEqual([]);
    expect(val(await h.invoke(CHANNELS.setReviewToken, { token: TOKEN }))).toBeNull();
    const on = (await reviews())!;
    expect(on.via).toBe('token');
    expect(on.reviews.map((r) => r.title)).toEqual(['Por API']);
    expect(netCalls.length).toBeGreaterThan(0);
    for (const c of netCalls) {
      expect(c.url.startsWith('https://api.github.com/repos/Fixerfox/app/')).toBe(true);
      expect(c.headers['Authorization']).toBe(`Bearer ${TOKEN}`);
    }
    // No vuelve a la interfaz ni queda en claro en disco.
    expect(JSON.stringify(on)).not.toContain(TOKEN);
    expect(await vaultText()).not.toContain(TOKEN);
    expect((await vaultText()).length).toBeGreaterThan(0);
    // Si origin pasa a otro servidor, ese token no se usa con él.
    netCalls = [];
    git('config', 'remote.origin.url', 'https://github.otraempresa.com/Fixerfox/app.git');
    expect((await reviews())!.via).toBeUndefined();
    expect(netCalls).toEqual([]);
    git('config', 'remote.origin.url', 'https://github.com/Fixerfox/app.git');
    expect(val(await h.invoke(CHANNELS.clearReviewToken, undefined))).toBeNull();
    expect((await reviews())!.via).toBeUndefined();
  });

  it('[R99.9] abrir una PR comprueba que la rama esté subida y devuelve la creada', SLOW, async () => {
    await open('https://github.com/Fixerfox/app.git');
    git('checkout', '-q', '-b', 'feature/opciones');
    const draft = { title: 'Opciones', head: 'feature/opciones', base: 'main' };
    expect(await h.invoke(CHANNELS.gitCreateReview, draft)).toMatchObject({ ok: false, error: { code: 'git-guard', message: expect.stringMatching(/todavía no está subida/) } });
    expect(cliCalls.filter((c) => c === 'gh pr create')).toEqual([]);
    // La rama pasa a seguir a una remota (como tras subirla).
    git('update-ref', 'refs/remotes/origin/feature/opciones', 'HEAD');
    git('config', 'branch.feature/opciones.remote', 'origin');
    git('config', 'branch.feature/opciones.merge', 'refs/heads/feature/opciones');
    git('config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*');
    expect(val<ReviewInfo>(await h.invoke(CHANNELS.gitCreateReview, draft))).toEqual({ number: 32, title: 'Opciones', state: 'open', head: 'feature/opciones', base: 'main', url: 'https://github.com/Fixerfox/app/pull/32' });
    expect(await h.invoke(CHANNELS.gitCreateReview, { ...draft, head: '--force' })).toMatchObject({ ok: false, error: { code: 'bad-request' } });
  });
});
