import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EventBody } from '@orquestador/core';
import { WorkspaceManager, resolveInside } from '../src';

let root: string;
let project: string;
let events: EventBody[];

const w = (p: string, text: string) => fs.mkdir(join(p, '..'), { recursive: true }).then(() => fs.writeFile(p, text));
const r = (p: string) => fs.readFile(p, 'utf8');
const exists = (p: string) => fs.access(p).then(() => true, () => false);

function mgr(extra: Partial<ConstructorParameters<typeof WorkspaceManager>[0]> = {}) {
  return new WorkspaceManager({
    projectRoot: project,
    runDir: join(root, 'run'),
    tmpRoot: join(project, '.orquestador', 'tmp', 'ws'),
    emit: (e) => events.push(e),
    strategy: 'copy',
    ...extra,
  });
}

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'orq-ws-'));
  project = join(root, 'proj');
  events = [];
  await w(join(project, 'a.txt'), 'A');
  await w(join(project, 'src', 'b.txt'), 'B');
  await w(join(project, 'node_modules', 'x.js'), 'ignorado');
});
afterEach(() => fs.rm(root, { recursive: true, force: true }));

describe('aislamiento [R13.1][R13.4]', () => {
  it('[R13.1] con copia temporal el agente edita sin tocar el proyecto', async () => {
    const m = mgr();
    const ws = await m.acquire('n1');
    expect(ws).toMatchObject({ isolated: true, strategy: 'copy' });
    expect(ws.dir).not.toBe(project);
    expect(await r(join(ws.dir, 'src', 'b.txt'))).toBe('B');
    expect(await exists(join(ws.dir, 'node_modules'))).toBe(false);
    await w(join(ws.dir, 'a.txt'), 'cambiado');
    expect(await r(join(project, 'a.txt'))).toBe('A');
  });

  it('[R13.1] en un repositorio git usa git worktree', async () => {
    const g = (...a: string[]) => execFileSync('git', ['-C', project, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]);
    g('init', '-q');
    await fs.writeFile(join(project, '.gitignore'), 'node_modules\n.orquestador\n');
    g('add', '.');
    g('commit', '-qm', 'init');
    const m = new WorkspaceManager({ projectRoot: project, runDir: join(root, 'run'), tmpRoot: join(root, 'wt'), emit: (e) => events.push(e) });
    const ws = await m.acquire('n1');
    expect(ws.strategy).toBe('git');
    expect(await r(join(ws.dir, 'a.txt'))).toBe('A');
    await w(join(ws.dir, 'nuevo.txt'), 'hola');
    const res = await m.merge(ws);
    expect(res.merged).toEqual(['nuevo.txt']);
    expect(await r(join(project, 'nuevo.txt'))).toBe('hola');
    await m.release(ws);
    expect(await exists(ws.dir)).toBe(false);
    expect(execFileSync('git', ['-C', project, 'worktree', 'list']).toString().trim().split('\n')).toHaveLength(1);
  });

  it('[R13.4] los agentes de solo lectura trabajan directamente en el proyecto', async () => {
    const m = mgr();
    const ws = await m.acquire('lector', { readOnly: true });
    expect(ws).toMatchObject({ dir: project, isolated: false, strategy: 'none' });
    expect(await m.merge(ws)).toEqual({ merged: [], conflicts: [] });
    await m.release(ws);
    expect(await exists(project)).toBe(true);
  });

  it('[R13.8] avisa si copiar es caro y permite limitar lo que se copia', async () => {
    await w(join(project, 'assets', 'big.bin'), 'x'.repeat(5000));
    const warned = await mgr({ warnBytes: 1000 }).acquire('n');
    expect(warned.warning).toMatch(/se copiará para cada agente/);
    const limited = await mgr({ warnBytes: 1000, ignore: ['assets'] }).acquire('n');
    expect(limited.warning).toBeUndefined();
    expect(await exists(join(limited.dir, 'assets'))).toBe(false);
    expect((await mgr().acquire('n')).warning).toBeUndefined();
  });
});

describe('fusión [R13.2][R13.3]', () => {
  it('[R13.2] fusiona altas, cambios y borrados y emite workspace.merged', async () => {
    const m = mgr();
    const ws = await m.acquire('n1');
    await w(join(ws.dir, 'a.txt'), 'A2');
    await w(join(ws.dir, 'nuevo', 'c.txt'), 'C');
    await fs.rm(join(ws.dir, 'src', 'b.txt'));
    const res = await m.merge(ws);
    expect(res.merged.sort()).toEqual(['a.txt', 'nuevo/c.txt', 'src/b.txt']);
    expect(res.conflicts).toEqual([]);
    expect(await r(join(project, 'a.txt'))).toBe('A2');
    expect(await r(join(project, 'nuevo', 'c.txt'))).toBe('C');
    expect(await exists(join(project, 'src', 'b.txt'))).toBe(false);
    expect(events).toContainEqual({ type: 'workspace.merged', nodeId: 'n1', files: ['a.txt', 'nuevo/c.txt', 'src/b.txt'] });
  });

  it('[R13.2] agentes en paralelo con archivos distintos se fusionan sin conflicto, en orden de finalización', async () => {
    const m = mgr();
    const [x, y] = [await m.acquire('x'), await m.acquire('y')];
    await w(join(x.dir, 'x.txt'), 'X');
    await w(join(y.dir, 'y.txt'), 'Y');
    await m.merge(y);
    await m.merge(x);
    expect(events.filter((e) => e.type === 'workspace.merged').map((e) => (e as { nodeId: string }).nodeId)).toEqual(['y', 'x']);
    expect(await r(join(project, 'x.txt'))).toBe('X');
    expect(await r(join(project, 'y.txt'))).toBe('Y');
    expect(m.needsAttention).toBe(false);
  });

  it('[R13.2] sin cambios no emite eventos y fusionar dos veces no repite nada', async () => {
    const m = mgr();
    const ws = await m.acquire('n');
    expect(await m.merge(ws)).toEqual({ merged: [], conflicts: [] });
    expect(await m.merge(ws)).toEqual({ merged: [], conflicts: [] });
    expect(events).toEqual([]);
  });

  it('[R13.2] si ambos hicieron el mismo cambio no hay conflicto', async () => {
    const m = mgr();
    const [x, y] = [await m.acquire('x'), await m.acquire('y')];
    await w(join(x.dir, 'a.txt'), 'IGUAL');
    await w(join(y.dir, 'a.txt'), 'IGUAL');
    await m.merge(x);
    expect((await m.merge(y)).conflicts).toEqual([]);
  });

  it('[R13.3] cambios incompatibles: se conservan ambas versiones, se emite el conflicto y requiere atención', async () => {
    const m = mgr();
    const [x, y] = [await m.acquire('x'), await m.acquire('y')];
    await w(join(x.dir, 'a.txt'), 'de X');
    await w(join(y.dir, 'a.txt'), 'de Y');
    await m.merge(x);
    const res = await m.merge(y);
    expect(res.conflicts).toEqual(['a.txt']);
    expect(await r(join(project, 'a.txt'))).toBe('de X');
    expect(await r(join(root, 'run', 'conflicts', y.id, 'a.txt'))).toBe('de Y');
    expect(events).toContainEqual({ type: 'workspace.conflict', nodeIds: ['y'], files: ['a.txt'] });
    expect(m.needsAttention).toBe(true);
    expect(m.conflicts).toEqual([{ nodeId: 'y', files: ['a.txt'] }]);
  });

  it('[R13.3] borrar un archivo que otro modificó también es conflicto', async () => {
    const m = mgr();
    const [x, y] = [await m.acquire('x'), await m.acquire('y')];
    await w(join(x.dir, 'a.txt'), 'de X');
    await fs.rm(join(y.dir, 'a.txt'));
    await m.merge(x);
    expect((await m.merge(y)).conflicts).toEqual(['a.txt']);
    expect(await r(join(project, 'a.txt'))).toBe('de X');
  });

  it('[R13.2] dos fusiones simultáneas se serializan', async () => {
    const m = mgr();
    const [x, y] = [await m.acquire('x'), await m.acquire('y')];
    await w(join(x.dir, 'x.txt'), 'X');
    await w(join(y.dir, 'y.txt'), 'Y');
    const [a, b] = await Promise.all([m.merge(x), m.merge(y)]);
    expect(a.merged).toEqual(['x.txt']);
    expect(b.merged).toEqual(['y.txt']);
  });
});

describe('limpieza [R13.7]', () => {
  it('[R13.7] release borra el espacio sin fusionar (cancelación)', async () => {
    const m = mgr();
    const ws = await m.acquire('n');
    await w(join(ws.dir, 'a.txt'), 'x');
    await m.release(ws);
    expect(await exists(ws.dir)).toBe(false);
    expect(await r(join(project, 'a.txt'))).toBe('A');
  });

  it('[R13.7] releaseAll limpia todos los espacios abiertos', async () => {
    const m = mgr();
    const spaces = [await m.acquire('a'), await m.acquire('b')];
    await m.releaseAll();
    for (const s of spaces) expect(await exists(s.dir)).toBe(false);
  });

  it('[R13.7] cleanupStale limpia lo que dejó un cierre inesperado', async () => {
    const first = mgr();
    const ws = await first.acquire('n');
    const second = mgr();
    expect(await second.cleanupStale()).toBe(1);
    expect(await exists(ws.dir)).toBe(false);
    expect(await second.cleanupStale()).toBe(0);
  });

  it('[R13.7] cleanupStale quita también worktrees de git huérfanos', async () => {
    const g = (...a: string[]) => execFileSync('git', ['-C', project, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]);
    g('init', '-q');
    await fs.writeFile(join(project, '.gitignore'), 'node_modules\n');
    g('add', '.');
    g('commit', '-qm', 'i');
    const o = { projectRoot: project, runDir: join(root, 'run'), tmpRoot: join(root, 'wt') };
    await new WorkspaceManager(o).acquire('n');
    expect(await new WorkspaceManager(o).cleanupStale()).toBe(1);
    expect(execFileSync('git', ['-C', project, 'worktree', 'list']).toString().trim().split('\n')).toHaveLength(1);
  });
});

describe('instantáneas por iteración [R13.5]', () => {
  it('[R13.5] guarda cada vuelta, emite iteration.snapshot y permite recuperar una anterior', async () => {
    const m = mgr();
    await w(join(project, 'out.txt'), 'v1');
    const dir1 = await m.snapshotIteration('bucle', 1);
    await w(join(project, 'out.txt'), 'v2');
    await m.snapshotIteration('bucle', 2);
    expect(dir1).toBe(join(root, 'run', 'iterations', 'bucle', '1'));
    expect(await r(join(dir1, 'out.txt'))).toBe('v1');
    expect(events.filter((e) => e.type === 'iteration.snapshot')).toEqual([
      { type: 'iteration.snapshot', loopId: 'bucle', n: 1, path: 'iterations/bucle/1' },
      { type: 'iteration.snapshot', loopId: 'bucle', n: 2, path: 'iterations/bucle/2' },
    ]);
    expect(await m.listIterations('bucle')).toEqual([1, 2]);
    const files = await m.restoreIteration('bucle', 1);
    expect(files).toContain('out.txt');
    expect(await r(join(project, 'out.txt'))).toBe('v1');
  });

  it('[R13.5] rechaza vueltas inexistentes, no válidas e ids de bucle peligrosos', async () => {
    const m = mgr();
    await expect(m.restoreIteration('bucle', 3)).rejects.toThrow(/No existe/);
    await expect(m.snapshotIteration('bucle', 0)).rejects.toThrow(/entero/);
    await expect(m.snapshotIteration('../fuera', 1)).rejects.toThrow(/no válido/);
    expect(await m.listIterations('nada')).toEqual([]);
  });

  it('[R13.5] volver a guardar la misma vuelta la sustituye', async () => {
    const m = mgr();
    await w(join(project, 'f.txt'), 'uno');
    await m.snapshotIteration('l', 1);
    await fs.rm(join(project, 'f.txt'));
    await m.snapshotIteration('l', 1);
    expect(await exists(join(root, 'run', 'iterations', 'l', '1', 'f.txt'))).toBe(false);
  });
});

describe('archivos producidos [R13.6]', () => {
  it('[R13.6] copia a output/ y emite file.produced', async () => {
    const m = mgr();
    await w(join(project, 'dist', 'juego.js'), 'código');
    const got = await m.registerProduced('n1', ['dist/juego.js', 'no-existe.txt']);
    expect(got).toEqual(['dist/juego.js']);
    expect(await r(join(root, 'run', 'output', 'dist', 'juego.js'))).toBe('código');
    expect(events).toEqual([{ type: 'file.produced', nodeId: 'n1', path: 'dist/juego.js' }]);
  });

  it('[R13.6] dos nodos con el mismo nombre y distinto contenido no se pisan', async () => {
    const m = mgr();
    await w(join(project, 'r.txt'), 'uno');
    await m.registerProduced('a', ['r.txt']);
    await w(join(project, 'r.txt'), 'dos');
    expect(await m.registerProduced('b', ['r.txt'])).toEqual(['b/r.txt']);
    expect(await r(join(root, 'run', 'output', 'r.txt'))).toBe('uno');
    expect(await r(join(root, 'run', 'output', 'b', 'r.txt'))).toBe('dos');
  });

  it('[R13.6] no permite salir de la carpeta con rutas manipuladas', async () => {
    const m = mgr();
    await expect(m.registerProduced('n', ['../secreto.txt'])).rejects.toThrow(/fuera/);
    await expect(m.registerProduced('n', ['/etc/passwd'])).rejects.toThrow(/fuera/);
    expect(() => resolveInside(project, 'a/../../x')).toThrow();
    expect(resolveInside(project, 'a/b.txt')).toBe(join(project, 'a', 'b.txt'));
  });
});
