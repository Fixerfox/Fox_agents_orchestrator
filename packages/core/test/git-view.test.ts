import { describe, expect, it } from 'vitest';
import { branchOrigins, gitActionAlwaysAsks, gitActionProblem, readGitAction, type GitAction, type GitState } from '../src';

const repo = (more: Partial<GitState> = {}): GitState => ({ repo: true, branch: 'feature/x', commit: 'abc1234', dirty: 0, branches: [], ...more });
const ctx = { running: 0, branches: ['main', 'develop', 'feature/x', 'vieja'] };
const p = (a: GitAction, s: GitState = repo(), c = ctx) => gitActionProblem(a, s, c);

describe('SPEC-098 · acciones de git', () => {
  it('[R98.7] dice por qué una acción no se puede hacer, y nada si se puede', () => {
    expect(p({ kind: 'create', name: 'nueva' })).toBeUndefined();
    expect(p({ kind: 'create', name: 'develop' })).toMatch(/Ya existe una rama «develop»/);
    expect(p({ kind: 'create', name: 'nueva', from: 'fantasma' })).toMatch(/No existe la rama «fantasma»/);
    expect(p({ kind: 'switch', name: 'develop' })).toBeUndefined();
    expect(p({ kind: 'switch', name: 'feature/x' })).toMatch(/Ya estás en/);
    expect(p({ kind: 'switch', name: 'fantasma' })).toMatch(/No existe/);
    expect(p({ kind: 'merge', name: 'develop' })).toBeUndefined();
    expect(p({ kind: 'merge', name: 'feature/x' })).toMatch(/consigo misma/);
    expect(p({ kind: 'merge', name: 'develop' }, repo({ dirty: 2 }))).toMatch(/cambios sin commit/);
    expect(p({ kind: 'commit', message: 'x' })).toMatch(/No hay cambios que guardar/);
    expect(p({ kind: 'commit', message: 'x' }, repo({ dirty: 1 }))).toBeUndefined();
    expect(p({ kind: 'stash' })).toMatch(/No hay cambios que apartar/);
    expect(p({ kind: 'stash' }, repo({ dirty: 1 }))).toBeUndefined();
    expect(p({ kind: 'push' })).toBeUndefined();
    const { branch: _b, ...detached } = repo({ dirty: 1 });
    void _b;
    for (const a of [{ kind: 'push' }, { kind: 'pull' }, { kind: 'commit', message: 'x' }, { kind: 'merge', name: 'develop' }] as GitAction[]) expect(p(a, detached)).toMatch(/No estás en ninguna rama/);
    expect(p({ kind: 'fetch' }, { repo: false, dirty: 0, branches: [] })).toMatch(/no es un repositorio/);
    expect(p({ kind: 'commit', message: 'x' }, repo({ dirty: 1, busy: 'rebase' }))).toMatch(/operación de git a medias/);
    expect(p({ kind: 'fetch' }, repo({ busy: 'rebase' }))).toBeUndefined();
  });

  it('[R98.7] la rama actual y las protegidas no se borran', () => {
    expect(p({ kind: 'delete', name: 'vieja' })).toBeUndefined();
    expect(p({ kind: 'delete', name: 'feature/x' })).toMatch(/en la que estás/);
    expect(p({ kind: 'delete', name: 'main' })).toMatch(/rama protegida/);
    expect(p({ kind: 'delete', name: 'fantasma' })).toMatch(/No existe/);
  });

  it('[R98.8] con una ejecución en marcha no se mueve la carpeta, pero se puede traer, hacer commit y subir', () => {
    const busy = { ...ctx, running: 1 };
    const dirty = repo({ dirty: 1 });
    for (const a of [{ kind: 'create', name: 'nueva' }, { kind: 'switch', name: 'develop' }, { kind: 'pull' }, { kind: 'merge', name: 'develop' }, { kind: 'stash' }, { kind: 'stash-pop', index: 0 }] as GitAction[]) {
      expect(p(a, dirty, busy)).toMatch(/Hay una ejecución en marcha/);
    }
    for (const a of [{ kind: 'fetch' }, { kind: 'commit', message: 'x' }, { kind: 'push' }, { kind: 'delete', name: 'vieja' }] as GitAction[]) expect(p(a, dirty, busy)).toBeUndefined();
  });

  it('[R98.10] una acción bien formada pasa; tipos desconocidos, nombres que git no aceptaría y campos de más, no', () => {
    const good: unknown[] = [{ kind: 'create', name: 'a/b' }, { kind: 'create', name: 'a', from: 'main' }, { kind: 'switch', name: 'a' }, { kind: 'commit', message: 'hola' }, { kind: 'push' }, { kind: 'pull' }, { kind: 'fetch' }, { kind: 'merge', name: 'a' }, { kind: 'delete', name: 'a' }, { kind: 'stash' }, { kind: 'stash', label: 'x' }, { kind: 'stash-pop', index: 0 }];
    for (const a of good) expect(readGitAction(a)).toBe(true);
    const bad: unknown[] = [null, 'push', [], {}, { kind: 'rebase' }, { kind: 'create' }, { kind: 'create', name: '--force' }, { kind: 'create', name: 'a', from: '-b' }, { kind: 'switch', name: 'a b' }, { kind: 'commit', message: '   ' }, { kind: 'commit' }, { kind: 'push', force: true }, { kind: 'delete', name: 'a', force: true }, { kind: 'stash-pop', index: -1 }, { kind: 'stash-pop', index: 1.5 }, { kind: 'stash', label: 3 }, { kind: 'fetch', path: '/etc' }];
    for (const a of bad) expect(readGitAction(a)).toBe(false);
  });

  it('[R98.14] borrar una rama y subir a una protegida se confirman siempre', () => {
    expect(gitActionAlwaysAsks({ kind: 'delete', name: 'vieja' }, repo())).toBe(true);
    expect(gitActionAlwaysAsks({ kind: 'push' }, repo({ branch: 'main' }))).toBe(true);
    expect(gitActionAlwaysAsks({ kind: 'push' }, repo())).toBe(false);
    expect(gitActionAlwaysAsks({ kind: 'switch', name: 'main' }, repo())).toBe(false);
  });

  it('[R98.5] cada rama lleva el trabajo que la creó: la de la guarda y las de sus agentes; si varios la nombran, el más reciente', () => {
    const origins = branchOrigins([
      { runId: 'r3', name: 'Menú', branch: 'feature/x' },
      { runId: 'r2', name: 'Spec Kit', branch: 'orq/spec-kit', created: true, branches: ['001-naves'] },
      { runId: 'r1', name: 'Viejo', branch: 'orq/spec-kit', created: true },
    ]);
    expect(origins).toEqual({ 'orq/spec-kit': { runId: 'r2', name: 'Spec Kit' }, '001-naves': { runId: 'r2', name: 'Spec Kit' } });
    expect(branchOrigins([])).toEqual({});
  });
});
