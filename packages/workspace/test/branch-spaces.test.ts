import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BranchSpaceManager, cleanupBranchSpaces } from '../src';

let root: string;
let work: string;
let spaces: string;
let runDir: string;

const w = (p: string, text: string) => fs.mkdir(join(p, '..'), { recursive: true }).then(() => fs.writeFile(p, text));
const r = (p: string) => fs.readFile(p, 'utf8');
const exists = (p: string) => fs.access(p).then(() => true, () => false);
const git = (...args: string[]) => execFileSync('git', ['-C', work, ...args], { encoding: 'utf8' });
const mgr = () => new BranchSpaceManager({ workRoot: work, runDir, spacesRoot: spaces });
const lines = (n: number, tag = '') => Array.from({ length: n }, (_, i) => `línea ${i}${tag}`).join('\n') + '\n';

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'orq-bs-'));
  work = join(root, 'trabajo');
  spaces = join(root, 'datos', 'spaces');
  runDir = join(root, 'run');
  await w(join(work, 'api.ts'), lines(20));
  await w(join(work, 'a.txt'), 'A');
});
afterEach(() => fs.rm(root, { recursive: true, force: true }));

async function repo() {
  git('init', '-q');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'inicio');
}

describe('SPEC-073 · espacios de las ramas', () => {
  it('[R73.4][R73.6] parte de la carpeta de trabajo y vive fuera de ella', async () => {
    const m = mgr();
    const { space, strategy } = await m.open({ regionId: 'f', label: 'Web' });
    expect(strategy).toBe('copy');
    expect(space.dir.startsWith(spaces)).toBe(true);
    expect(space.dir.startsWith(work)).toBe(false);
    expect(await r(join(space.dir, 'a.txt'))).toBe('A');
    await m.closeAll();
    expect(await exists(space.dir)).toBe(false);
  });

  it('[R73.5] con git, la rama ve lo que la carpeta tiene sin guardar, y eso no da conflicto', async () => {
    await repo();
    await w(join(work, 'spec.md'), 'sin commit');
    await w(join(work, 'a.txt'), 'A cambiado');
    await fs.rm(join(work, 'api.ts'));
    const m = mgr();
    const a = await m.open({ regionId: 'f', label: 'Web' });
    const b = await m.open({ regionId: 'f', label: 'Api' });
    expect(a.strategy).toBe('git');
    expect(await r(join(a.space.dir, 'spec.md'))).toBe('sin commit');
    expect(await r(join(a.space.dir, 'a.txt'))).toBe('A cambiado');
    expect(await exists(join(a.space.dir, 'api.ts'))).toBe(false);
    await w(join(a.space.dir, 'web.ts'), 'web');
    await w(join(b.space.dir, 'srv.ts'), 'srv');
    expect(await m.merge(a.space)).toMatchObject({ merged: ['web.ts'], conflicts: [] });
    expect(await m.merge(b.space)).toMatchObject({ merged: ['srv.ts'], conflicts: [] });
    expect(git('status', '--porcelain')).not.toContain('spaces');
    await m.closeAll();
    expect(git('worktree', 'list')).not.toContain(spaces);
  });

  it('[R73.12] cambios en partes distintas del mismo archivo se juntan por líneas', async () => {
    const m = mgr();
    const a = await m.open({ regionId: 'f', label: 'Web' });
    const b = await m.open({ regionId: 'f', label: 'Api' });
    await w(join(a.space.dir, 'api.ts'), lines(20).replace('línea 2\n', 'línea 2 web\n'));
    await w(join(b.space.dir, 'api.ts'), lines(20).replace('línea 17\n', 'línea 17 api\n'));
    expect(await m.merge(a.space)).toMatchObject({ merged: ['api.ts'], mergedByLines: [] });
    expect(await m.merge(b.space)).toMatchObject({ merged: ['api.ts'], mergedByLines: ['api.ts'], conflicts: [] });
    const out = await r(join(work, 'api.ts'));
    expect(out).toContain('línea 2 web');
    expect(out).toContain('línea 17 api');
  });

  it('[R73.12][R73.16] si se solapan es conflicto: el destino no se toca y las dos versiones quedan guardadas', async () => {
    const m = mgr();
    const a = await m.open({ regionId: 'f', label: 'Web' });
    const b = await m.open({ regionId: 'f', label: 'Api' });
    await w(join(a.space.dir, 'a.txt'), 'de Web');
    await w(join(b.space.dir, 'a.txt'), 'de Api');
    await m.merge(a.space);
    const res = await m.merge(b.space);
    expect(res).toMatchObject({ conflicts: ['a.txt'], savedTo: 'conflicts/Api' });
    expect(await r(join(work, 'a.txt'))).toBe('de Web');
    expect(await r(join(runDir, 'conflicts/Api/rama/a.txt'))).toBe('de Api');
    expect(await r(join(runDir, 'conflicts/Api/destino/a.txt'))).toBe('de Web');
  });

  it('[R73.14] quedarse con una versión, o dejar las marcas para que lo junte un agente', async () => {
    const conflict = async () => {
      const m = mgr();
      await w(join(work, 'a.txt'), 'A\n');
      const a = await m.open({ regionId: 'f', label: 'Web' });
      const b = await m.open({ regionId: 'f', label: 'Api' });
      await w(join(a.space.dir, 'a.txt'), 'de Web\n');
      await w(join(b.space.dir, 'a.txt'), 'de Api\n');
      await m.merge(a.space);
      await m.merge(b.space);
      return { m, b };
    };
    let c = await conflict();
    await c.m.resolve(c.b.space, undefined, 'branch');
    expect(await r(join(work, 'a.txt'))).toBe('de Api\n');
    c = await conflict();
    await c.m.resolve(c.b.space, undefined, 'markers');
    const marked = await r(join(work, 'a.txt'));
    expect(marked).toMatch(/<<<<<<< destino[\s\S]*de Web[\s\S]*\|\|\|\|\|\|\| base[\s\S]*A[\s\S]*=======[\s\S]*de Api[\s\S]*>>>>>>> Api/);
    expect(await c.m.unresolved(c.b.space)).toEqual(['a.txt']);
    await w(join(work, 'a.txt'), 'de Web y de Api\n');
    expect(await c.m.unresolved(c.b.space)).toEqual([]);
  });

  it('[R73.3] una rama dentro de otra parte de su espacio y se fusiona en él', async () => {
    const m = mgr();
    const outer = await m.open({ regionId: 'f', label: 'Fuera' });
    await w(join(outer.space.dir, 'plan.md'), 'plan');
    const inner = await m.open({ regionId: 'g', label: 'Dentro', parent: outer.space });
    expect(await r(join(inner.space.dir, 'plan.md'))).toBe('plan');
    await w(join(inner.space.dir, 'x.ts'), 'x');
    await m.merge(inner.space, outer.space);
    expect(await r(join(outer.space.dir, 'x.ts'))).toBe('x');
    expect(await exists(join(work, 'x.ts'))).toBe(false);
  });

  it('[R73.17] una rama descartada guarda solo lo que cambió y se borra', async () => {
    const m = mgr();
    const a = await m.open({ regionId: 'f', label: 'Web' });
    await w(join(a.space.dir, 'nuevo.ts'), 'n');
    expect(await m.discard(a.space)).toEqual(['nuevo.ts']);
    expect(await r(join(runDir, 'discarded/Web/nuevo.ts'))).toBe('n');
    expect(await exists(join(runDir, 'discarded/Web/a.txt'))).toBe(false);
    expect(await exists(a.space.dir)).toBe(false);
    expect(await exists(join(work, 'nuevo.ts'))).toBe(false);
  });

  it('[R73.18] tras un cierre inesperado se borran los espacios y git deja de verlos', async () => {
    await repo();
    const m = mgr();
    await m.open({ regionId: 'f', label: 'Web' });
    await m.open({ regionId: 'f', label: 'Api' });
    expect(git('worktree', 'list').split('\n').filter(Boolean)).toHaveLength(3);
    expect(await cleanupBranchSpaces(spaces, [work])).toBe(2);
    expect(git('worktree', 'list').split('\n').filter(Boolean)).toHaveLength(1);
  });
});
