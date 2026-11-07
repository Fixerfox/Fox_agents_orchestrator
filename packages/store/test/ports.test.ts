import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockAgent, MockDecider, Orchestrator, newAgent, type Diagram } from '@orquestador/core';
import { MAX_INPUT_FILES, ProjectStore, encodeStepKey, libraryReaderOf, runRepositoryOf, safePreviewPath, readRunLog } from '../src';

const D: Diagram = {
  id: 'd',
  name: 'D',
  schemaVersion: 1,
  nodes: [
    { id: 'entry', kind: 'entry' },
    { id: 'output', kind: 'output' },
  ],
  edges: [{ id: 'e', from: 'entry', to: 'output' }],
};

let dir: string;
let store: ProjectStore;
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'orq-ports-'));
  store = await ProjectStore.create(dir, { name: 'p' });
  await store.diagrams.save(D);
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

const orch = () => new Orchestrator({ getAdapter: () => new MockAgent(), decider: new MockDecider() });

describe('SPEC-056 · el proyecto como puertos', () => {
  it('[R56.5] RunRepository: la ejecución queda en disco y se relee', async () => {
    const repo = runRepositoryOf(store);
    const { handle, logged } = repo.start(orch(), D, 'orden', {});
    await logged;
    const [meta] = await repo.list({ live: new Set() });
    expect(meta).toMatchObject({ runId: handle.runId, status: 'succeeded' });
    expect((await repo.readEvents(handle.runId)).at(-1)).toMatchObject({ type: 'run.finished' });
    expect((await repo.readDiagram(handle.runId))?.id).toBe('d');
    expect(repo.outputFolder(handle.runId)).toBe(join(store.paths.runDir(handle.runId), 'output'));
    await expect(repo.readEvents('nada')).rejects.toThrow();
  });

  it('[R56.5] RunRepository: anota reanudada y corregida en meta.json', async () => {
    const repo = runRepositoryOf(store);
    const { handle, logged } = repo.start(orch(), D, 'orden', {});
    await logged;
    await repo.markResumedBy(handle.runId, 'r2');
    await repo.markCorrectedBy(handle.runId, 'r3');
    expect((await repo.list({ live: new Set() }))[0]).toMatchObject({ resumedBy: 'r2', correctedBy: ['r3'] });
    expect(await repo.dismissInterrupted(handle.runId)).toBe(false);
  });

  it('[R56.5] RunRepository: copia y encuentra lo que hizo un paso', async () => {
    const repo = runRepositoryOf(store);
    const { handle, logged } = repo.start(orch(), D, 'orden', {});
    await logged;
    await fs.writeFile(join(dir, 'a.txt'), 'hola');
    await fs.writeFile(join(dir, 'b.txt'), 'no');
    await repo.snapshotStep({ runId: handle.runId, workRoot: dir, key: 'bucle/a', files: ['a.txt', 'b.txt'], blocked: (f) => f === 'b.txt' });
    expect(await repo.findPreview(handle.runId, 'bucle/a', 'a.txt')).toBeDefined();
    expect(await repo.findPreview(handle.runId, 'bucle/a', 'b.txt')).toBeUndefined();
  });

  it('[R56.5] RunRepository: la carpeta de trabajo por defecto es la del proyecto', async () => {
    const repo = runRepositoryOf(store);
    expect(await repo.workRoot()).toBe(store.paths.root);
    expect(repo.maxInputFiles).toBe(MAX_INPUT_FILES);
  });

  it('[R56.5] LibraryReader: lee agentes y diagramas guardados', async () => {
    await store.saveAgent(newAgent('ana', 'Ana'));
    const lib = libraryReaderOf(store);
    expect((await lib.agents()).map((a) => a.id)).toEqual(['ana']);
    expect(await lib.diagramIds()).toEqual(['d']);
    expect((await lib.diagram('d')).name).toBe('D');
    await expect(lib.diagram('nada')).rejects.toThrow();
  });

  it('[R56.5] store sigue exportando las utilidades de rutas que pasaron a core', () => {
    expect(safePreviewPath('a/b.txt')).toBe(true);
    expect(safePreviewPath('../a')).toBe(false);
    expect(encodeStepKey('bucle/a b')).toBe('bucle~a%20b');
  });
});

describe('leer el log de una ejecución [R2.10]', () => {
  it('[R2.10] una grabación con eventos cambiados de sitio se lee en orden', async () => {
    const run = join(dir, 'run');
    await fs.mkdir(run);
    const line = (seq: number) => JSON.stringify({ runId: 'r', seq, ts: 't', type: 'node.queued', nodeId: 'a' });
    await fs.writeFile(join(run, 'events.jsonl'), [1, 3, 2, 4].map(line).join('\n') + '\n');
    expect((await readRunLog(run)).events.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
  });
});
