import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitCli, GitError, parseStatus } from '../src';

let dir: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).toString();
const write = (name: string, text: string) => fs.writeFile(path.join(dir, name), text);
const cli = () => new GitCli(() => dir);
const SLOW = { timeout: 30_000 };

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'orq-git-')));
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

async function repo() {
  git('init', '-q', '-b', 'main');
  git('config', 'commit.gpgsign', 'false');
  await write('a.txt', 'uno\n');
  git('add', '.');
  git('commit', '-q', '-m', 'inicial');
}

describe('SPEC-097 · git de la carpeta', () => {
  it('[R97.2] fuera de un repositorio no hay nada que guardar', SLOW, async () => {
    expect(await cli().state()).toEqual({ repo: false, dirty: 0, branches: [] });
    // Sin `git` instalado se comporta igual.
    const missing = new GitCli(() => dir, async () => {
      throw new GitError('spawn git ENOENT');
    });
    expect(await missing.state()).toEqual({ repo: false, dirty: 0, branches: [] });
  });

  it('[R97.2] da rama, commit, ramas locales y los archivos con cambios, también los nuevos', SLOW, async () => {
    await repo();
    git('branch', 'develop');
    const clean = await cli().state();
    expect(clean).toMatchObject({ repo: true, branch: 'main', dirty: 0 });
    expect(clean.commit).toMatch(/^[0-9a-f]{7}$/);
    expect(clean.branches.sort()).toEqual(['develop', 'main']);
    expect(clean.busy).toBeUndefined();
    await write('a.txt', 'cambiado\n');
    await write('nuevo.txt', 'x');
    expect((await cli().state()).dirty).toBe(2);
    expect(JSON.stringify(await cli().state())).not.toContain(dir);
  });

  it('[R97.2] un repositorio sin commits no tiene commit, y HEAD suelto no tiene rama', SLOW, async () => {
    git('init', '-q', '-b', 'main');
    const empty = await cli().state();
    expect(empty).toMatchObject({ repo: true, branch: 'main', dirty: 0, branches: [] });
    expect(empty.commit).toBeUndefined();
    git('config', 'commit.gpgsign', 'false');
    await write('a.txt', 'uno\n');
    git('add', '.');
    git('commit', '-q', '-m', 'inicial');
    git('checkout', '-q', '--detach');
    const detached = await cli().state();
    expect(detached.branch).toBeUndefined();
    expect(detached.commit).toMatch(/^[0-9a-f]{7}$/);
  });

  it('[R97.2] detecta una fusión a medias y el retraso con la remota', SLOW, async () => {
    await repo();
    git('checkout', '-q', '-b', 'otra');
    await write('a.txt', 'otra\n');
    git('commit', '-q', '-am', 'otra');
    git('checkout', '-q', 'main');
    await write('a.txt', 'main\n');
    git('commit', '-q', '-am', 'main');
    expect(() => git('merge', 'otra')).toThrow();
    expect((await cli().state()).busy).toBe('merge');
    expect(parseStatus('# branch.oid abcdef0123\n# branch.head feature/x\n# branch.upstream origin/feature/x\n# branch.ab +1 -4\n1 .M N... 100644 100644 100644 a b a.txt\n? nuevo.txt\n')).toEqual({ commit: 'abcdef0', head: 'abcdef0123', branch: 'feature/x', behind: 4, dirty: 2 });
    expect(parseStatus('# branch.oid (initial)\n# branch.head (detached)\n')).toEqual({ dirty: 0 });
  });

  it('[R97.1] crea la rama desde aquí o desde otra y se cambia a ella, llevándose los cambios sin commit', SLOW, async () => {
    await repo();
    git('branch', 'develop');
    await write('pendiente.txt', 'x');
    await cli().createBranch('orq/una');
    expect(await cli().state()).toMatchObject({ branch: 'orq/una', dirty: 1 });
    await cli().createBranch('orq/dos', 'develop');
    expect(await cli().state()).toMatchObject({ branch: 'orq/dos', dirty: 1 });
    // Un nombre que no vale no llega a git; uno repetido se explica.
    await expect(cli().createBranch('--force')).rejects.toThrow(/no válido/);
    await expect(cli().createBranch('x', '-b')).rejects.toThrow(/no válido/);
    await expect(cli().createBranch('develop')).rejects.toThrow(/No se pudo crear la rama develop/);
    expect((await cli().state()).branch).toBe('orq/dos');
  });

  it('[R97.1] aparta los cambios con su etiqueta, también los archivos nuevos; sin cambios no aparta nada', SLOW, async () => {
    await repo();
    expect(await cli().stash('orquestador: vacío')).toBe(false);
    await write('a.txt', 'cambiado\n');
    await write('nuevo.txt', 'x');
    expect(await cli().stash('orquestador: Mi flujo')).toBe(true);
    expect((await cli().state()).dirty).toBe(0);
    expect(git('stash', 'list')).toContain('orquestador: Mi flujo');
    git('stash', 'pop');
    expect((await cli().state()).dirty).toBe(2);
  });

  it('[R97.1] git se lanza con una lista de argumentos, nunca con una línea de comandos', async () => {
    const calls: (readonly string[])[] = [];
    const fake = new GitCli(() => dir, async (args) => {
      calls.push(args);
      return '';
    });
    await fake.createBranch('orq/a', 'develop');
    await fake.stash('etiqueta; rm -rf /\ncon salto');
    expect(calls[0]).toEqual(['switch', '-c', 'orq/a', 'develop']);
    expect(calls.find((c) => c[1] === 'push')).toEqual(['stash', 'push', '--include-untracked', '-m', 'etiqueta; rm -rf / con salto']);
  });
});
