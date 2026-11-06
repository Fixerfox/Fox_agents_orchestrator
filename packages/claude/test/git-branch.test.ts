import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BranchTracker, findGitDir, parseGitCommand, parseGitMcp, readBranch, reviewUrl, validBranch } from '../src/git-branch';

let dir: string;
const setHead = (branch: string) => fs.writeFile(join(dir, '.git', 'HEAD'), `ref: refs/heads/${branch}\n`);
const collect = async <T>(it: AsyncIterable<T>) => {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
};

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'orq-git-'));
  await fs.mkdir(join(dir, '.git'));
  await setHead('main');
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

describe('SPEC-058 · comandos de git', () => {
  it('[R58.3] crear una rama', () => {
    expect(parseGitCommand('git checkout -b feature/x').created).toEqual(['feature/x']);
    expect(parseGitCommand('git switch -c "feature/y"').created).toEqual(['feature/y']);
    expect(parseGitCommand('cd web && git branch nueva').created).toEqual(['nueva']);
  });

  it('[R58.3] actuar en la rama: con nombre o en la de HEAD', () => {
    expect(parseGitCommand('git push origin feature/x').named).toEqual(['feature/x']);
    expect(parseGitCommand('git push -u origin local:refs/heads/remota').named).toEqual(['remota']);
    expect(parseGitCommand('git add . && git commit -m "hecho"').acts).toBe(true);
    expect(parseGitCommand('git push').acts).toBe(true);
    expect(parseGitCommand('git push origin HEAD').acts).toBe(true);
  });

  it('[R58.3] lo que solo lee, borra o va a otro repositorio no cuenta', () => {
    for (const c of ['git status', 'git log --oneline', 'git branch', 'git branch -d vieja', 'git push origin --delete vieja', 'git push --tags', 'git -C ../otro commit -m x', 'git checkout -- a.txt', 'echo git']) {
      expect(parseGitCommand(c), c).toMatchObject({ created: [], named: [], acts: false });
    }
  });

  it('[R58.3] el texto de un mensaje no se toma por un comando', () => {
    expect(parseGitCommand('git commit -m "antes; git checkout -b trampa"')).toMatchObject({ created: [], named: [], acts: true });
  });
});

describe('SPEC-058 · lo que hace el agente en la rama', () => {
  it('[R58.11] commit, push y borrar, en comandos', () => {
    expect(parseGitCommand('git commit -m x && git push -u origin feature/x').actions).toEqual([{ action: 'commit' }, { action: 'push', branch: 'feature/x' }]);
    expect(parseGitCommand('git push').actions).toEqual([{ action: 'push' }]);
    expect(parseGitCommand('git branch -D vieja; git push origin --delete vieja').actions).toEqual([{ action: 'delete', branch: 'vieja' }, { action: 'delete', branch: 'vieja' }]);
    expect(parseGitCommand('git status; git pull').actions).toEqual([]);
  });

  it('[R58.11] en MCP, y fusionar una PR apunta a su rama', async () => {
    expect(parseGitMcp('mcp__github__push_files', { branch: 'x' })?.action).toBe('push');
    expect(parseGitMcp('mcp__github__create_or_update_file', { branch: 'x' })?.action).toBe('commit');
    expect(parseGitMcp('mcp__github__get_commit', { sha: 'x' })?.action).toBeUndefined();
    const t = new BranchTracker(dir);
    await t.start();
    t.called('mcp__github__create_pull_request', { head: 'x', base: 'main' });
    await collect(t.settled('mcp__github__create_pull_request', true));
    t.called('mcp__github__merge_pull_request', { pull_number: 2 });
    expect(await collect(t.settled('mcp__github__merge_pull_request', true))).toEqual([{ type: 'git_action', branch: 'x', action: 'merge' }]);
  });

  it('[R58.11] un commit va a la rama de HEAD y se avisa una vez; borrar no es actuar en ella', async () => {
    const t = new BranchTracker(dir);
    await t.start();
    t.called('Bash', { command: 'git commit -m x' });
    expect(await collect(t.settled('Bash', true))).toEqual([{ type: 'branch', branch: 'main', via: 'command' }, { type: 'git_action', branch: 'main', action: 'commit' }]);
    t.called('Bash', { command: 'git commit -m y' });
    expect(await collect(t.settled('Bash', true))).toEqual([]);
    t.called('mcp__github__delete_branch', { branch: 'vieja' });
    expect(await collect(t.settled('mcp__github__delete_branch', true))).toEqual([{ type: 'git_action', branch: 'vieja', action: 'delete' }]);
  });

  it('[R58.14] saca la dirección de la PR, no la de la API', () => {
    const github = '{ "url": "https://api.github.com/repos/o/r/pulls/2", "html_url": "https://github.com/o/r/pull/2", "diff_url": "https://github.com/o/r/pull/2.diff" }';
    expect(reviewUrl(github)).toBe('https://github.com/o/r/pull/2');
    expect(reviewUrl('{"web_url":"https://gitlab.com/g/p/-/merge_requests/7"}')).toBe('https://gitlab.com/g/p/-/merge_requests/7');
    expect(reviewUrl('Creating pull request\nhttps://github.com/o/r/pull/9\n')).toBe('https://github.com/o/r/pull/9');
    expect(reviewUrl('http://github.com/o/r/pull/2')).toBeUndefined();
    expect(reviewUrl('sin enlaces')).toBeUndefined();
    expect(reviewUrl(undefined)).toBeUndefined();
  });

  it('[R58.14] el enlace llega en la acción, por MCP y por comando', async () => {
    const t = new BranchTracker(dir);
    await t.start();
    t.called('mcp__gitlab__create_merge_request', { source_branch: 'x', target_branch: 'main' });
    expect(await collect(t.settled('mcp__gitlab__create_merge_request', true, '{"web_url":"https://gitlab.com/g/p/-/merge_requests/7"}'))).toContainEqual({ type: 'git_action', branch: 'x', action: 'pr', url: 'https://gitlab.com/g/p/-/merge_requests/7' });
    t.called('Bash', { command: 'gh pr create --fill' });
    expect(await collect(t.settled('Bash', true, 'https://github.com/o/r/pull/9'))).toContainEqual({ type: 'git_action', branch: 'main', action: 'pr', url: 'https://github.com/o/r/pull/9' });
  });

  it('[R58.11] lo que falla no cuenta', async () => {
    const t = new BranchTracker(dir);
    await t.start();
    t.called('Bash', { command: 'git commit -m x' });
    expect(await collect(t.settled('Bash', false))).toEqual([]);
  });
});

describe('SPEC-058 · herramientas MCP', () => {
  it('[R58.4] toma la rama de un servidor de git y marca las nuevas', () => {
    expect(parseGitMcp('mcp__github__create_branch', { branch: 'feature/x' })).toEqual({ branch: 'feature/x', created: true });
    expect(parseGitMcp('mcp__github__push_files', { branch: 'feature/x' })).toEqual({ branch: 'feature/x', created: false, action: 'push' });
    expect(parseGitMcp('mcp__github__create_pull_request', { head: 'dueño:feature/x', base: 'main' })).toEqual({ branch: 'feature/x', created: false, action: 'pr' });
    expect(parseGitMcp('mcp__repos__make_branch', { branch_name: 'y' })).toEqual({ branch: 'y', created: false });
  });

  it('[R58.4] leer una rama cuenta, salvo la principal, un commit o una etiqueta', () => {
    expect(parseGitMcp('mcp__github__list_commits', { owner: 'o', repo: 'r', sha: '006-test' })).toEqual({ branch: '006-test', created: false });
    expect(parseGitMcp('mcp__github__get_file_contents', { ref: 'refs/heads/x' })).toEqual({ branch: 'x', created: false });
    expect(parseGitMcp('mcp__github__list_commits', { sha: 'main' })).toBeUndefined();
    expect(parseGitMcp('mcp__github__get_commit', { sha: 'e547480' })).toBeUndefined();
    expect(parseGitMcp('mcp__github__get_file_contents', { ref: 'refs/tags/v1' })).toBeUndefined();
    expect(parseGitMcp('mcp__github__list_branches', {})).toBeUndefined();
  });

  it('[R58.4] otros servidores y las herramientas normales no cuentan', () => {
    expect(parseGitMcp('mcp__figma__export', { branch: 'x' })).toBeUndefined();
    expect(parseGitMcp('Write', { branch: 'x' })).toBeUndefined();
  });

  it('[R58.5] un nombre que git no aceptaría se descarta', () => {
    expect(validBranch('feature/x-1')).toBe(true);
    for (const n of ['', 'HEAD', 'a..b', 'con espacio', '-x', 'a:b']) expect(validBranch(n), n).toBe(false);
    expect(parseGitMcp('mcp__github__create_branch', { branch: 'mal nombre' })).toBeUndefined();
  });
});

describe('SPEC-058 · HEAD del repositorio', () => {
  it('[R58.2] encuentra el repositorio subiendo desde la carpeta de trabajo', async () => {
    const inner = join(dir, 'a', 'b');
    await fs.mkdir(inner, { recursive: true });
    expect(await findGitDir(inner)).toBe(join(dir, '.git'));
    expect(await readBranch(join(dir, '.git'))).toBe('main');
  });

  it('[R58.2] en un worktree .git es un archivo que apunta al repositorio', async () => {
    const wt = join(dir, 'wt');
    await fs.mkdir(wt);
    await fs.mkdir(join(dir, '.git', 'worktrees', 'w'), { recursive: true });
    await fs.writeFile(join(dir, '.git', 'worktrees', 'w', 'HEAD'), 'ref: refs/heads/en-worktree\n');
    await fs.writeFile(join(wt, '.git'), `gitdir: ${join(dir, '.git', 'worktrees', 'w')}\n`);
    expect(await readBranch((await findGitDir(wt))!)).toBe('en-worktree');
  });

  it('[R58.2] una rama que cambia sin ningún comando git, como la de un script, se detecta', async () => {
    const t = new BranchTracker(dir);
    await t.start();
    t.called('Bash', { command: 'bash crear-feature.sh' });
    await setHead('001-feature');
    expect(await collect(t.settled('Bash', true))).toEqual([{ type: 'branch', branch: '001-feature', via: 'head' }, { type: 'git_action', branch: '001-feature', action: 'switch' }]);
  });

  it('[R58.2] al salir de una rama para borrarla, cuenta la rama en la que estaba', async () => {
    await setHead('spec/testeo-01');
    const t = new BranchTracker(dir);
    await t.start();
    t.called('Bash', { command: 'git switch main && git branch -d spec/testeo-01' });
    await setHead('main');
    expect(await collect(t.settled('Bash', true))).toEqual([
      { type: 'branch', branch: 'spec/testeo-01', via: 'ran' },
      { type: 'branch', branch: 'main', via: 'head' },
      { type: 'git_action', branch: 'spec/testeo-01', action: 'delete' },
      { type: 'git_action', branch: 'main', action: 'switch' },
    ]);
  });

  it('[R58.2] salir de la rama principal no la cuenta', async () => {
    const t = new BranchTracker(dir);
    await t.start();
    t.called('Bash', { command: 'bash crear.sh' });
    await setHead('feature');
    expect((await collect(t.settled('Bash', true))).filter((e) => e.type === 'branch').map((e) => e.branch)).toEqual(['feature']);
  });

  it('[R58.2] con HEAD suelto no avisa de nada', async () => {
    const t = new BranchTracker(dir);
    await t.start();
    await fs.writeFile(join(dir, '.git', 'HEAD'), 'abc123\n');
    t.called('Bash', { command: 'git commit -m x' });
    expect(await collect(t.settled('Bash', true))).toEqual([]);
    expect(await collect(t.finished())).toEqual([]);
  });

  it('[R58.3] un commit actúa en la rama actual, aunque no haya cambiado', async () => {
    const t = new BranchTracker(dir);
    await t.start();
    t.called('Bash', { command: 'git commit -m x' });
    expect((await collect(t.settled('Bash', true)))[0]).toEqual({ type: 'branch', branch: 'main', via: 'command' });
  });

  it('[R58.5] al terminar cuenta la rama de HEAD, aunque el paso solo leyera', async () => {
    const a = new BranchTracker(dir);
    await a.start();
    expect(await collect(a.finished())).toEqual([{ type: 'branch', branch: 'main', via: 'ran' }]);
  });

  it('[R58.5] cada rama se avisa una vez, salvo para decir que es nueva', async () => {
    const t = new BranchTracker(dir);
    await t.start();
    t.called('Bash', { command: 'git commit -m x' });
    expect((await collect(t.settled('Bash', true))).filter((e) => e.type === 'branch')).toHaveLength(1);
    t.called('Bash', { command: 'git commit -m y' });
    expect(await collect(t.settled('Bash', true))).toEqual([]);
    t.called('Bash', { command: 'git branch main' });
    expect(await collect(t.settled('Bash', true))).toEqual([{ type: 'branch', branch: 'main', via: 'command', created: true }]);
    expect(await collect(t.finished())).toEqual([]);
  });

  it('[R58.5] una herramienta que falla no cuenta por lo que pedía, pero sí si HEAD cambió', async () => {
    const t = new BranchTracker(dir);
    await t.start();
    t.called('Bash', { command: 'git checkout -b no-salio' });
    expect(await collect(t.settled('Bash', false))).toEqual([]);
    t.called('Bash', { command: 'git checkout -b otra && false' });
    await setHead('otra');
    expect(await collect(t.settled('Bash', false))).toEqual([{ type: 'branch', branch: 'otra', via: 'head' }, { type: 'git_action', branch: 'otra', action: 'switch' }]);
  });

  it('[R58.5] sin repositorio, un MCP de git sigue contando', async () => {
    await fs.rm(join(dir, '.git'), { recursive: true });
    const t = new BranchTracker(dir);
    await t.start();
    t.called('mcp__github__create_branch', { branch: 'remota' });
    expect(await collect(t.settled('mcp__github__create_branch', true))).toEqual([{ type: 'branch', branch: 'remota', via: 'mcp', created: true }]);
  });
});
