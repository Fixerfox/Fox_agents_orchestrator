import { describe, expect, it } from 'vitest';
import {
  MemoryLibrary,
  MemoryRunRepository,
  MemoryWorkspaceFiles,
  MockAgent,
  MockDecider,
  Orchestrator,
  defaultSettings,
  memoryEngine,
  memoryPathPolicy,
  type AppSettings,
  type Diagram,
  type RunEvent,
} from '@orquestador/core';
import { RunError, RunService, RunSnapshots, createEngineOrchestrator, jobsOf, snapshotLibrary, takeSnapshot, type RunPorts } from '../src';

const D: Diagram = {
  id: 'd',
  name: 'D',
  schemaVersion: 1,
  nodes: [
    { id: 'entry', kind: 'entry' },
    { id: 'a', kind: 'agent', agentId: 'a', label: 'Analista' },
    { id: 'b', kind: 'agent', agentId: 'b', label: 'Builder' },
    { id: 'output', kind: 'output' },
  ],
  edges: [
    { id: 'e1', from: 'entry', to: 'a' },
    { id: 'e2', from: 'a', to: 'b' },
    { id: 'e3', from: 'b', to: 'output' },
  ],
};

/** Todo en memoria: ni disco ni Claude. Es lo que haría una persistencia nueva. */
function rig(agent = new MockAgent({ a: { output: 'plan' }, b: { output: 'obra' } }), decider = new MockDecider()) {
  const runs = new MemoryRunRepository();
  const library = new MemoryLibrary();
  library.diagrams.set('d', D);
  const ports: RunPorts = { runs, library, policy: memoryPathPolicy, files: new MemoryWorkspaceFiles() };
  let n = 0;
  const orchestrator = new Orchestrator({ getAdapter: () => agent, decider, newRunId: () => `run-${++n}` });
  return { runs, library, ports, svc: new RunService(ports, orchestrator), agent };
}

describe('SPEC-056 · casos de uso: otra persistencia', () => {
  it('[R56.4] una ejecución completa funciona con un repositorio en memoria, sin tocar el servicio', async () => {
    const { svc, runs } = rig();
    const { runId } = await svc.start({ diagramId: 'd', order: 'pedido' });
    await svc.settled(runId);
    expect((await svc.list()).map((m) => [m.runId, m.status])).toEqual([[runId, 'succeeded']]);
    const { backlog } = await svc.subscribe(runId, 1, () => {});
    expect(backlog.at(-1)).toMatchObject({ type: 'run.finished', status: 'succeeded' });
    expect((await runs.readEvents(runId)).length).toBe(backlog.length);
  });

  it('[R56.4] reanudar y corregir también funcionan solo con los puertos', async () => {
    const { svc, runs, agent } = rig();
    const first = await svc.start({ diagramId: 'd', order: 'pedido' });
    await svc.settled(first.runId);
    const fix = await svc.correctRun(first.runId, { text: 'faltan cosas', nodeId: 'b' });
    await svc.settled(fix.runId);
    expect(agent.callsOf('a')).toHaveLength(1);
    expect(agent.callsOf('b')).toHaveLength(2);
    expect(runs.runs.get(first.runId)!.meta.correctedBy).toEqual([fix.runId]);
    expect(runs.runs.get(fix.runId)!.meta.correctedFrom).toBe(first.runId);
    await expect(svc.resumeRun(first.runId)).rejects.toBeInstanceOf(RunError);
  });

  it('[R56.4] los trabajos se listan desde la biblioteca, también con un diagrama roto', async () => {
    const { library } = rig();
    library.diagrams.set('roto', { ...D, id: 'roto', name: 'Roto', edges: [] });
    const jobs = await jobsOf(library);
    expect(jobs.find((j) => j.id === 'd')).toEqual({ id: 'd', name: 'D', steps: 2, problems: 0 });
    expect(jobs.find((j) => j.id === 'roto')!.problems).toBeGreaterThan(0);
  });
});

describe('SPEC-056 · casos de uso: otro motor', () => {
  const settingsWith = (engine: string) => (): AppSettings => ({ ...defaultSettings(), engine: engine as AppSettings['engine'] });

  it('[R56.4] se elige el motor por `settings().engine`, sin construir ningún adaptador concreto', async () => {
    const mine = new MockAgent({ a: { output: 'de mi motor' }, b: { output: 'fin' } });
    const orch = createEngineOrchestrator({ library: new MemoryLibrary(), settings: settingsWith('otro') }, [memoryEngine('otro', { adapter: mine })]);
    const r = await orch.start(D, 'x').result;
    expect(r.status).toBe('succeeded');
    expect(mine.callsOf('a')).toHaveLength(1);
  });

  it('[R56.4] el cambio de motor se nota en la siguiente ejecución', async () => {
    const one = new MockAgent();
    const two = new MockAgent();
    let engine = 'uno';
    const orch = createEngineOrchestrator({ library: new MemoryLibrary(), settings: () => settingsWith(engine)() }, [memoryEngine('uno', { adapter: one }), memoryEngine('dos', { adapter: two })]);
    await orch.start(D, 'x').result;
    engine = 'dos';
    await orch.start(D, 'x').result;
    expect(one.calls).toHaveLength(2);
    expect(two.calls).toHaveLength(2);
  });

  it('[R56.4] sin motor con ese id usa los agentes de demostración', async () => {
    const unused = new MockAgent();
    const orch = createEngineOrchestrator({ library: new MemoryLibrary(), settings: settingsWith('simulated') }, [memoryEngine('claude', { adapter: unused })]);
    expect((await orch.start(D, 'x').result).status).toBe('succeeded');
    expect(unused.calls).toEqual([]);
  });

  it('[R56.4] quien decide es el del motor activo', async () => {
    const route = new MockDecider();
    const orch = createEngineOrchestrator({ library: new MemoryLibrary(), settings: settingsWith('otro') }, [memoryEngine('otro', { decider: route })]);
    const d: Diagram = {
      ...D,
      nodes: [D.nodes[0]!, { id: 'r', kind: 'router', label: 'r', router: { mode: 'ai' } }, D.nodes[1]!, D.nodes[3]!],
      edges: [
        { id: 'x1', from: 'entry', to: 'r' },
        { id: 'x2', from: 'r', to: 'a' },
        { id: 'x3', from: 'a', to: 'output' },
      ],
    };
    await orch.start(d, 'x').result;
    expect(route.routeCalls).toHaveLength(1);
  });

  it('[R56.4] un motor que no transforma deja el mismo error que no saber hacerlo', async () => {
    const decider = new MockDecider();
    const bare = { route: decider.route, judge: decider.judge, condition: decider.condition };
    const orch = createEngineOrchestrator({ library: new MemoryLibrary(), settings: settingsWith('otro') }, [memoryEngine('otro', { decider: bare })]);
    const d: Diagram = {
      ...D,
      nodes: [D.nodes[0]!, { id: 't', kind: 'transform', label: 't', transform: { mode: 'ai', format: 'text', instructions: 'x', maxAttempts: 1 } }, D.nodes[3]!],
      edges: [
        { id: 'y1', from: 'entry', to: 't' },
        { id: 'y2', from: 't', to: 'output' },
      ],
    };
    const r = await orch.start(d, 'x').result;
    expect(r.status).toBe('failed');
    expect(r.events.some((e: RunEvent) => e.type === 'error' && e.message.includes('no sabe transformar'))).toBe(true);
  });

  it('[R56.4] los subdiagramas se leen de la biblioteca, y de la copia de la ejecución si la hay', async () => {
    const library = new MemoryLibrary();
    library.diagrams.set('plantilla', { ...D, id: 'plantilla' });
    const snapshots = new RunSnapshots();
    const orch = createEngineOrchestrator({ library: snapshotLibrary(library, snapshots), settings: settingsWith('otro') }, [memoryEngine('otro')]);
    const d: Diagram = {
      ...D,
      nodes: [D.nodes[0]!, { id: 's', kind: 'subdiagram', label: 's', subdiagram: { templateId: 'plantilla', version: 'latest' } }, D.nodes[3]!],
      edges: [
        { id: 'z1', from: 'entry', to: 's' },
        { id: 'z2', from: 's', to: 'output' },
      ],
    };
    expect((await orch.start(d, 'x').result).status).toBe('succeeded');
  });
});

describe('SPEC-056 · copias de la biblioteca', () => {
  it('[R56.3] con copia se lee la copia y, sin ella, la biblioteca', async () => {
    const library = new MemoryLibrary();
    const sub: Diagram = { ...D, id: 'sub' };
    library.diagrams.set('sub', sub);
    const main: Diagram = { ...D, id: 'main', nodes: [...D.nodes, { id: 's', kind: 'subdiagram', subdiagram: { templateId: 'sub', version: 'latest' } }] };
    const snap = await takeSnapshot(library, main);
    expect([...snap.templates.keys()]).toEqual(['sub']);
    library.diagrams.set('sub', { ...sub, name: 'cambiado' });
    const snapshots = new RunSnapshots();
    snapshots.set('r1', snap);
    const reader = snapshotLibrary(library, snapshots);
    expect((await reader.diagram('sub', 'r1')).name).toBe('D');
    expect((await reader.diagram('sub', 'r2')).name).toBe('cambiado');
    expect((await reader.diagram('sub')).name).toBe('cambiado');
  });

  it('[R56.3] sin registro de copias se comporta como la biblioteca', async () => {
    const library = new MemoryLibrary();
    library.diagrams.set('d', D);
    expect(await snapshotLibrary(library, undefined).diagramIds()).toEqual(['d']);
  });
});
