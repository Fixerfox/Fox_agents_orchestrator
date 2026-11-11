import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitCli, MAX_DIFF_CHARS, parseBranches, parseChanges, parseLog } from '../src';

let dir: string;
let remote: string;
const ENV = { ...process.env, GIT_AUTHOR_NAME: 'Ana', GIT_AUTHOR_EMAIL: 'a@t', GIT_COMMITTER_NAME: 'Ana', GIT_COMMITTER_EMAIL: 'a@t' };
const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe', env: ENV }).toString().trim();
const write = (name: string, text: string) => fs.writeFile(path.join(dir, name), text);
const cli = () => new GitCli(() => dir);
const SLOW = { timeout: 40_000 };

beforeEach(async () => {
  const base = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'orq-gitview-')));
  dir = path.join(base, 'repo');
  remote = path.join(base, 'remoto.git');
  await fs.mkdir(dir);
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote], { stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'user.name', 'Ana');
  git('config', 'user.email', 'a@t');
  await write('a.txt', 'uno\ndos\n');
  git('add', '.');
  git('commit', '-q', '-m', 'inicial');
  git('remote', 'add', 'origin', remote);
});
afterEach(() => fs.rm(path.dirname(dir), { recursive: true, force: true }));

describe('SPEC-098 · git para el visor', () => {
  it('[R98.2] ramas locales y remotas con la actual y lo que llevan de adelanto y retraso', SLOW, async () => {
    git('push', '-q', '-u', 'origin', 'main');
    git('checkout', '-q', '-b', 'feature/x');
    await write('b.txt', 'x');
    git('add', '.');
    git('commit', '-q', '-m', 'trabajo');
    git('push', '-q', '-u', 'origin', 'feature/x');
    await write('c.txt', 'x');
    git('add', '.');
    git('commit', '-q', '-m', 'más');
    const branches = await cli().branches();
    const local = branches.filter((b) => !b.remote);
    expect(local.map((b) => b.name).sort()).toEqual(['feature/x', 'main']);
    expect(local.find((b) => b.name === 'feature/x')).toMatchObject({ current: true, upstream: 'origin/feature/x', ahead: 1, behind: 0, subject: 'más' });
    expect(local.find((b) => b.name === 'main')).toMatchObject({ upstream: 'origin/main', ahead: 0, behind: 0 });
    expect(local.find((b) => b.name === 'main')!.current).toBeUndefined();
    expect(branches.filter((b) => b.remote).map((b) => b.name).sort()).toEqual(['origin/feature/x', 'origin/main']);
    // La remota que seguía ya no existe.
    expect(parseBranches('refs/heads/x\x1fabc\x1forigin/x\x1f[gone]\x1f\x1fhola\nrefs/remotes/origin/HEAD\x1fabc\x1f\x1f\x1f\x1f', 'x')).toEqual([{ name: 'x', sha: 'abc', current: true, upstream: 'origin/x', ahead: 0, behind: 0, gone: true, subject: 'hola' }]);
  });

  it('[R98.2] el historial lleva padres, autor, fecha y las ramas y etiquetas de cada commit', SLOW, async () => {
    git('checkout', '-q', '-b', 'otra');
    await write('b.txt', 'x');
    git('add', '.');
    git('commit', '-q', '-m', 'en otra');
    git('checkout', '-q', 'main');
    git('merge', '-q', '--no-ff', '-m', 'fusión', 'otra');
    git('tag', 'v1');
    const commits = await cli().history(50);
    expect(commits.map((c) => c.subject)).toEqual(['fusión', 'en otra', 'inicial']);
    expect(commits[0]!.parents).toHaveLength(2);
    expect(commits[0]!.refs.sort()).toEqual(['main', 'tag: v1']);
    expect(commits[1]!.refs).toEqual(['otra']);
    expect(commits[2]).toMatchObject({ parents: [], author: 'Ana' });
    expect(commits[0]!.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(new Date(commits[0]!.date).getFullYear()).toBeGreaterThan(2020);
    expect(await cli().history(1)).toHaveLength(1);
    expect(parseLog('a\x1fb c\x1fAna\x1f2026-01-01T00:00:00Z\x1fHEAD -> main, origin/HEAD, origin/main\x1fcon \x1f dentro')).toEqual([{ sha: 'a', parents: ['b', 'c'], author: 'Ana', date: '2026-01-01T00:00:00Z', refs: ['main', 'origin/main'], subject: 'con \x1f dentro' }]);
  });

  it('[R98.3] los cambios sin commit llevan su estado y sus líneas; la diferencia sale en formato unificado', SLOW, async () => {
    await write('a.txt', 'uno\nDOS\ntres\n');
    await write('nuevo con espacio.txt', 'hola\nmundo\n');
    await write('añadido.txt', 'x\n');
    git('add', 'añadido.txt');
    const changes = await cli().changes();
    expect(changes.find((c) => c.path === 'a.txt')).toEqual({ path: 'a.txt', status: 'modified', added: 2, removed: 1 });
    expect(changes.find((c) => c.path === 'nuevo con espacio.txt')).toEqual({ path: 'nuevo con espacio.txt', status: 'untracked' });
    expect(changes.find((c) => c.path === 'añadido.txt')).toMatchObject({ status: 'added', added: 1 });
    const diff = await cli().diff('a.txt');
    expect(diff).toContain('-dos');
    expect(diff).toContain('+DOS');
    expect(await cli().diff('nuevo con espacio.txt')).toBe('+hola\n+mundo\n+');
    await fs.writeFile(path.join(dir, 'bin.dat'), Buffer.from([1, 0, 2, 0]));
    expect(await cli().diff('bin.dat')).toBe('Archivo binario');
    await write('grande.txt', 'x'.repeat(MAX_DIFF_CHARS + 50));
    expect((await cli().diff('grande.txt')).endsWith('… (recortado)')).toBe(true);
    // Desde una carpeta de dentro del repositorio, las rutas siguen siendo las de la raíz.
    await fs.mkdir(path.join(dir, 'sub'));
    const inner = new GitCli(() => path.join(dir, 'sub'));
    expect(await inner.diff('a.txt')).toContain('+DOS');
    expect(await inner.diff('nuevo con espacio.txt')).toBe('+hola\n+mundo\n+');
    for (const bad of ['', '../fuera.txt', '/etc/passwd', '--output=x', 'a/../../b']) await expect(cli().diff(bad)).rejects.toThrow(/Ruta no válida/);
    expect(parseChanges('R  nuevo.txt\0viejo.txt\0 D borrado.txt\0UU lio.txt\0', '3\t1\t\0viejo.txt\0nuevo.txt\0')).toEqual([{ path: 'nuevo.txt', status: 'renamed', added: 3, removed: 1 }, { path: 'borrado.txt', status: 'deleted' }, { path: 'lio.txt', status: 'conflict' }]);
  });

  it('[R98.6] cambiar de rama, commit de todo, subir, traer y bajar', SLOW, async () => {
    git('push', '-q', '-u', 'origin', 'main');
    await cli().createBranch('feature/x');
    await write('b.txt', 'x');
    await write('a.txt', 'cambiado\n');
    const sha = await cli().commit('  Trabajo de hoy  ');
    expect(sha).toMatch(/^[0-9a-f]{7,}$/);
    expect(git('log', '-1', '--format=%s')).toBe('Trabajo de hoy');
    expect((await cli().state()).dirty).toBe(0);
    await cli().push();
    expect(git('rev-parse', '--abbrev-ref', 'feature/x@{upstream}')).toBe('origin/feature/x');
    await cli().switchBranch('main');
    expect((await cli().state()).branch).toBe('main');
    // Otro clon sube un commit a main: traer lo ve y bajar lo aplica.
    const other = path.join(path.dirname(dir), 'otro');
    execFileSync('git', ['clone', '-q', remote, other], { stdio: 'pipe' });
    await fs.writeFile(path.join(other, 'z.txt'), 'z');
    for (const args of [['add', '.'], ['-c', 'user.name=B', '-c', 'user.email=b@t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'de otro'], ['push', '-q']]) execFileSync('git', args, { cwd: other, stdio: 'pipe' });
    await cli().fetch();
    expect((await cli().branches()).find((b) => b.name === 'main')).toMatchObject({ behind: 1 });
    await cli().pull();
    expect(git('log', '-1', '--format=%s')).toBe('de otro');
    await expect(cli().commit('   ')).rejects.toThrow(/necesita un mensaje/);
    await expect(cli().switchBranch('no-existe')).rejects.toThrow(/No se pudo cambiar a no-existe/);
    await expect(cli().switchBranch('--detach')).rejects.toThrow(/no válido/);
  });

  it('[R98.6] fusionar; con conflictos se deshace y lo explica; borrar solo lo ya fusionado', SLOW, async () => {
    await cli().createBranch('limpia');
    await write('b.txt', 'x');
    await cli().commit('limpia');
    await cli().switchBranch('main');
    await cli().merge('limpia');
    expect(await fs.readFile(path.join(dir, 'b.txt'), 'utf8')).toBe('x');
    await cli().deleteBranch('limpia');
    expect((await cli().state()).branches).toEqual(['main']);
    await cli().createBranch('choca');
    await write('a.txt', 'de choca\n');
    await cli().commit('choca');
    await cli().switchBranch('main');
    await write('a.txt', 'de main\n');
    await cli().commit('main');
    await expect(cli().merge('choca')).rejects.toThrow(/hay conflictos\. Se ha dejado todo como estaba/);
    expect(await cli().state()).toMatchObject({ branch: 'main', dirty: 0 });
    expect((await cli().state()).busy).toBeUndefined();
    await expect(cli().deleteBranch('choca')).rejects.toThrow(/No se pudo borrar choca/);
    expect((await cli().state()).branches.sort()).toEqual(['choca', 'main']);
  });

  it('[R98.2][R98.6] los cambios apartados se listan con su etiqueta y se recuperan', SLOW, async () => {
    expect(await cli().stashes()).toEqual([]);
    await write('a.txt', 'a medias\n');
    await cli().stash('orquestador: Menú');
    const stashes = await cli().stashes();
    expect(stashes).toHaveLength(1);
    expect(stashes[0]).toMatchObject({ index: 0, label: 'orquestador: Menú' });
    await cli().stashPop(0);
    expect((await cli().state()).dirty).toBe(1);
    expect(await cli().stashes()).toEqual([]);
    await expect(cli().stashPop(3)).rejects.toThrow(/No se pudieron recuperar/);
  });

  it('[R98.5] range da los commits que hay entre dos, y nada con algo que no es un hash', SLOW, async () => {
    const from = git('rev-parse', 'HEAD');
    await write('b.txt', '1');
    await cli().commit('uno');
    await write('b.txt', '2');
    await cli().commit('dos');
    const to = git('rev-parse', 'HEAD');
    expect((await cli().state()).head).toBe(to);
    const shas = await cli().range(from, to);
    expect(shas).toHaveLength(2);
    expect(shas[0]).toBe(to);
    expect(await cli().range(to, to)).toEqual([]);
    expect(await cli().range('--all', to)).toEqual([]);
    expect(await cli().range(from, 'main; rm -rf /')).toEqual([]);
  });

  it('[R98.1] las acciones remotas llevan su tope y nada pasa por una shell', async () => {
    const calls: { args: readonly string[]; timeoutMs?: number }[] = [];
    const fake = new GitCli(() => dir, async (args, _cwd, opts) => {
      calls.push({ args, ...(opts?.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}) });
      return args[0] === 'branch' ? 'feature/x\n' : '';
    });
    await fake.push();
    await fake.pull();
    await fake.fetch();
    await fake.deleteBranch('vieja');
    expect(calls.filter((c) => c.timeoutMs === 120_000).map((c) => c.args)).toEqual([['push', '--set-upstream', 'origin', 'feature/x'], ['pull', '--ff-only'], ['fetch', '--all', '--prune']]);
    expect(calls.at(-1)!.args).toEqual(['branch', '-d', 'vieja']);
  });
});
