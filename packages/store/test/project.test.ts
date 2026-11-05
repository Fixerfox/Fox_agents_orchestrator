import { cp, promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  JsonCollection,
  ProjectStore,
  StoreError,
  readVersioned,
  type VersionedSpec,
} from '../src';
import { chain, cleanupTmp, tmp } from './helpers';

cleanupTmp();

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof StoreError ? e.code : `otro: ${(e as Error).message}`;
  }
  return 'sin error';
};

describe('SPEC-010 · proyecto y documentos', () => {
  it('[R10.9] crear genera la estructura; crear de nuevo falla; abrir una carpeta ajena falla', async () => {
    const root = await tmp();
    const now = () => new Date('2026-11-04T20:00:00.000Z');
    const project = await ProjectStore.create(root, { name: 'Mi juego', now });
    expect(await project.info()).toEqual({
      schemaVersion: 1,
      name: 'Mi juego',
      createdAt: '2026-11-04T20:00:00.000Z',
      pins: {},
    });
    for (const d of ['diagrams', 'templates', 'agents', 'skills', 'contexts', 'runs']) {
      expect((await fs.stat(path.join(root, '.orquestador', d))).isDirectory()).toBe(true);
    }
    expect(await codeOf(ProjectStore.create(root, { name: 'otra vez' }))).toBe('exists');
    expect(await codeOf(ProjectStore.open(await tmp()))).toBe('not-a-project');
    expect((await ProjectStore.open(root)).paths.root).toBe(root);
  });

  it('[R10.1] guarda y carga diagramas y plantillas con su schemaVersion', async () => {
    const project = await ProjectStore.create(await tmp(), { name: 'p' });
    const d = chain(['a', 'b'], 'principal');
    await project.diagrams.save(d);
    await project.templates.save(chain(['x'], 'pintar'));
    expect(await project.diagrams.load('principal')).toEqual(d);
    expect(await project.diagrams.list()).toEqual(['principal']);
    expect(await project.templates.list()).toEqual(['pintar']);
    expect(await project.diagrams.exists('principal')).toBe(true);
    expect(await project.diagrams.exists('nada')).toBe(false);
    const raw = JSON.parse(await fs.readFile(project.diagrams.file('principal'), 'utf8')) as { schemaVersion: number };
    expect(raw.schemaVersion).toBe(1);
  });

  it('[R10.1] migra paso a paso, escribe el resultado y conserva una copia de respaldo', async () => {
    const dir = await tmp();
    const file = path.join(dir, 'doc.json');
    const original = `${JSON.stringify({ id: 'doc', schemaVersion: 1, a: 1 })}\n`;
    await fs.writeFile(file, original);
    const spec: VersionedSpec = {
      kind: 'prueba',
      current: 3,
      migrations: {
        1: (d) => ({ ...d, b: d['a'] }),
        2: (d) => ({ ...d, c: 'nuevo' }),
      },
    };
    const res = await readVersioned<Record<string, unknown>>(file, spec);
    expect(res.migratedFrom).toBe(1);
    expect(res.data).toMatchObject({ id: 'doc', schemaVersion: 3, a: 1, b: 1, c: 'nuevo' });
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toMatchObject({ schemaVersion: 3, c: 'nuevo' });
    expect(await fs.readFile(`${file}.v1.bak`, 'utf8')).toBe(original);

    // abrir uno ya actual: sin migrar y sin nuevos respaldos
    const again = await readVersioned(file, spec);
    expect(again.migratedFrom).toBeUndefined();
    expect((await fs.readdir(dir)).sort()).toEqual(['doc.json', 'doc.json.v1.bak']);
  });

  it('[R10.7] corrupto, de versión futura o inexistente: error claro y el archivo no se toca', async () => {
    const project = await ProjectStore.create(await tmp(), { name: 'p' });
    const corrupt = project.diagrams.file('roto');
    await fs.writeFile(corrupt, '{ esto no es json');
    const future = project.diagrams.file('futuro');
    const futureText = JSON.stringify({ id: 'futuro', schemaVersion: 99 });
    await fs.writeFile(future, futureText);
    const noVersion = project.diagrams.file('sinversion');
    await fs.writeFile(noVersion, JSON.stringify({ id: 'sinversion' }));

    expect(await codeOf(project.diagrams.load('roto'))).toBe('corrupt');
    expect(await codeOf(project.diagrams.load('futuro'))).toBe('future-version');
    expect(await codeOf(project.diagrams.load('sinversion'))).toBe('corrupt');
    expect(await codeOf(project.diagrams.load('noexiste'))).toBe('not-found');
    expect(await fs.readFile(corrupt, 'utf8')).toBe('{ esto no es json');
    expect(await fs.readFile(future, 'utf8')).toBe(futureText);
  });

  it('[R10.8] un id con separadores o ".." se rechaza y no escribe fuera de la carpeta', async () => {
    const root = await tmp();
    const project = await ProjectStore.create(root, { name: 'p' });
    expect(await codeOf(project.diagrams.save(chain(['a'], '../evil')))).toBe('invalid-id');
    expect(await codeOf(project.diagrams.load('../../x'))).toBe('invalid-id');
    expect(await fs.readdir(root)).toEqual(['.orquestador']);
  });

  it('[R10.5] se rechaza guardar secretos y no se crea ni modifica el archivo', async () => {
    const project = await ProjectStore.create(await tmp(), { name: 'p' });
    const d = chain(['a'], 'con-secreto');
    d.nodes[1] = { ...d.nodes[1]!, label: 'usa sk-ant-api03-ABCDEFGH12345678' };
    expect(await codeOf(project.diagrams.save(d))).toBe('secrets');
    expect(await project.diagrams.exists('con-secreto')).toBe(false);

    const ok = chain(['a'], 'ok');
    await project.diagrams.save(ok);
    const before = await fs.readFile(project.diagrams.file('ok'), 'utf8');
    const bad = { ...ok, nodes: [...ok.nodes, { id: 'z', kind: 'agent' as const, agentId: 'z', apiKey: 'abc' }] };
    expect(await codeOf(project.diagrams.save(bad as never))).toBe('secrets');
    expect(await fs.readFile(project.diagrams.file('ok'), 'utf8')).toBe(before);

    const generic = new JsonCollection<{ id: string; schemaVersion: number; password?: string }>(
      path.join(project.paths.orq, 'x'),
      { kind: 'ajustes', current: 1 },
    );
    expect(await codeOf(generic.save({ id: 's', schemaVersion: 1, password: 'hunter2' }))).toBe('secrets');
  });

  it('[R10.4] un proyecto copiado a otra carpeta se abre y se lee igual', async () => {
    const a = await tmp();
    const project = await ProjectStore.create(a, { name: 'orig' });
    await project.diagrams.save(chain(['a', 'b'], 'principal'));
    const b = path.join(await tmp(), 'copia');
    await new Promise<void>((res, rej) => cp(a, b, { recursive: true }, (e) => (e ? rej(e) : res())));
    const copy = await ProjectStore.open(b);
    expect((await copy.info()).name).toBe('orig');
    expect(await copy.diagrams.load('principal')).toEqual(chain(['a', 'b'], 'principal'));
    expect(copy.paths.root).toBe(b);
  });
});
