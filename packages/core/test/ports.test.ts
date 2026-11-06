import { describe, expect, it } from 'vitest';
import { MemoryLibrary, MemoryRunRepository, MemoryWorkspaceFiles, MockAgent, MockDecider, Orchestrator, memoryEngine, memoryPathPolicy, newAgent } from '../src';
import { chain } from './helpers';

const orch = () => new Orchestrator({ getAdapter: () => new MockAgent(), decider: new MockDecider() });

describe('SPEC-056 · dobles en memoria de los puertos', () => {
  it('[R56.3] AgentEngine: un motor es un id, un adaptador y quien decide', () => {
    const engine = memoryEngine('propio');
    expect(engine.id).toBe('propio');
    expect(engine.adapter.run).toBeTypeOf('function');
    expect(engine.decider.route).toBeTypeOf('function');
  });

  it('[R56.3] RunRepository: guarda la ejecución, sus eventos y su diagrama', async () => {
    const repo = new MemoryRunRepository();
    const d = chain(['a']);
    const { handle, logged } = repo.start(orch(), d, 'orden', {});
    await logged;
    const [meta] = await repo.list({ live: new Set() });
    expect(meta).toMatchObject({ runId: handle.runId, diagramId: d.id, status: 'succeeded', order: 'orden' });
    expect(meta!.eventCount).toBe((await repo.readEvents(handle.runId)).length);
    expect(await repo.readDiagram(handle.runId)).toBe(d);
  });

  it('[R56.3] RunRepository: una ejecución sin terminar que no sigue viva sale como interrumpida', async () => {
    const repo = new MemoryRunRepository();
    const { handle, logged } = repo.start(orch(), chain(['a']), 'orden', {});
    expect((await repo.list({ live: new Set([handle.runId]) }))[0]!.status).toBe('running');
    expect((await repo.list({ live: new Set() }))[0]!.status).toBe('interrupted');
    await logged;
  });

  it('[R56.3] RunRepository: anota quién reanuda y quién corrige, y descarta solo las que no terminaron', async () => {
    const repo = new MemoryRunRepository();
    const { handle, logged } = repo.start(orch(), chain(['a']), 'orden', {});
    expect(await repo.dismissInterrupted(handle.runId)).toBe(true);
    await logged;
    await repo.markResumedBy(handle.runId, 'r2');
    await repo.markCorrectedBy(handle.runId, 'r3');
    await repo.markCorrectedBy(handle.runId, 'r3');
    const [meta] = await repo.list({ live: new Set() });
    expect(meta).toMatchObject({ resumedBy: 'r2', correctedBy: ['r3'] });
    expect(await repo.dismissInterrupted(handle.runId)).toBe(false);
  });

  it('[R56.3] RunRepository: leer una ejecución que no existe falla', async () => {
    const repo = new MemoryRunRepository();
    await expect(repo.readEvents('nada')).rejects.toThrow('nada');
    expect(await repo.readDiagram('nada')).toBeNull();
  });

  it('[R56.3] RunRepository: copia lo que hizo un paso sin los archivos bloqueados', async () => {
    const repo = new MemoryRunRepository();
    await repo.snapshotStep({ runId: 'r', workRoot: '/t', key: 'a', files: ['ok.txt', '.env'], blocked: (f) => f === '.env' });
    expect(await repo.findPreview('r', 'a', 'ok.txt')).toBeDefined();
    expect(await repo.findPreview('r', 'a', '.env')).toBeUndefined();
  });

  it('[R56.3] RunRepository: resuelve archivos de entrada y adjuntos, y rechaza los que no existen', async () => {
    const repo = new MemoryRunRepository();
    repo.projectFiles.set('a.md', 5);
    repo.attachments.set('adj', 'adjuntos/adj.png');
    expect(await repo.inputFiles(['a.md'])).toEqual([{ path: 'a.md', size: 5, image: false }]);
    expect(await repo.attachmentInputPath('adj')).toBe('adjuntos/adj.png');
    await expect(repo.inputFiles(['b.md'])).rejects.toThrow();
    await expect(repo.attachmentInputPath('otro')).rejects.toThrow();
  });

  it('[R56.3] LibraryReader: lee lo que tiene y falla con un diagrama que no existe', async () => {
    const lib = new MemoryLibrary();
    lib.agentList = [newAgent('a', 'Ana')];
    lib.diagrams.set('d', chain(['a']));
    expect((await lib.agents()).map((a) => a.id)).toEqual(['a']);
    expect(await lib.contexts()).toEqual([]);
    expect(await lib.diagramIds()).toEqual(['d']);
    expect((await lib.diagram('d')).id).toBe('d');
    await expect(lib.diagram('x')).rejects.toThrow('x');
  });

  it('[R56.3] PathPolicy: los secretos no se enseñan y las rutas internas tampoco', () => {
    expect(memoryPathPolicy.isSensitive('.env')).toBe(true);
    expect(memoryPathPolicy.isPreviewable('web/index.html')).toBe(true);
    for (const rel of ['.env', '../fuera', '/absoluta', '.git/config', '.orquestador/x', 'C:/x', 'a\\b']) expect(memoryPathPolicy.isPreviewable(rel), rel).toBe(false);
  });

  it('[R56.3] WorkspaceFiles: lista por carpeta y no deja salir de ella', async () => {
    const files = new MemoryWorkspaceFiles();
    files.folders.set('/s', new Map([['a.txt', { size: 3 }]]));
    expect([...(await files.manifestOf('/s'))]).toEqual([['a.txt', { size: 3 }]]);
    expect((await files.manifestOf('/otra')).size).toBe(0);
    expect(files.resolveInside('/s', 'a.txt')).toBe('/s/a.txt');
    expect(() => files.resolveInside('/s', '../b')).toThrow();
  });
});
