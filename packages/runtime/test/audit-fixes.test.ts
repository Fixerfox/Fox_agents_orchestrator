import { describe, expect, it } from 'vitest';
import { MemoryLibrary, MockAgent, defaultSettings, memoryEngine, type AppSettings, type Diagram, type RunEvent, type RunMeta, type RunRepository } from '@orquestador/core';
import { createEngineOrchestrator } from '../src';
import { RunHistory } from '../src/run-history';
import { LiveRuns, type Live } from '../src/run-types';

const D: Diagram = {
  id: 'd',
  name: 'd',
  schemaVersion: 1,
  nodes: [{ id: 'entry', kind: 'entry' }, { id: 'a', kind: 'agent', agentId: 'a', label: 'a' }, { id: 'b', kind: 'agent', agentId: 'b', label: 'b' }, { id: 'output', kind: 'output' }],
  edges: [{ id: 'e1', from: 'entry', to: 'a' }, { id: 'e2', from: 'a', to: 'b' }, { id: 'e3', from: 'b', to: 'output' }],
};

describe('SPEC-063 · motor y sesión', () => {
  it('[R63.13] cambiar el motor en Ajustes no cambia el de una ejecución en marcha', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const real = new MockAgent({ a: { output: 'uno', waitFor: gate }, b: { output: 'dos' } });
    let engine = 'claude';
    const orch = createEngineOrchestrator({ library: new MemoryLibrary(), settings: (): AppSettings => ({ ...defaultSettings(), engine: engine as AppSettings['engine'] }) }, [memoryEngine('claude', { adapter: real })]);
    const run = orch.start(D, 'x');
    await new Promise((r) => setTimeout(r, 10));
    engine = 'simulated';
    release();
    await run.result;
    expect(real.callsOf('b')).toHaveLength(1);
    // La siguiente ya usa el nuevo.
    await orch.start(D, 'x').result;
    expect(real.callsOf('a')).toHaveLength(1);
  });

  it('[R63.19] la sesión guarda como mucho 10 ejecuciones terminadas', () => {
    const live = new LiveRuns();
    const make = (i: number, finished: boolean) => ({ handle: { runId: `r${i}` }, finished, diagram: D, previews: [] }) as unknown as Live;
    live.add(make(0, false));
    for (let i = 1; i <= 12; i++) live.add(make(i, true));
    expect(live.find('r0')).toBeDefined();
    expect(live.find('r1')).toBeUndefined();
    expect(live.find('r2')).toBeUndefined();
    expect(live.find('r3')).toBeDefined();
    expect(live.find('r12')).toBeDefined();
  });

  it('[R63.20] reanudar toma la entrada del nodo de entrada aunque no se llame «entry»', async () => {
    const diagram: Diagram = { ...D, nodes: D.nodes.map((n) => (n.kind === 'entry' ? { ...n, id: 'inicio' } : n)), edges: D.edges.map((e) => (e.from === 'entry' ? { ...e, from: 'inicio' } : e)) };
    const long = 'Pedido largo '.repeat(40);
    const events = [{ runId: 'r', seq: 1, ts: '2026-11-07T10:00:00Z', type: 'node.started', nodeId: 'inicio', input: { text: long, files: [] } }] as unknown as RunEvent[];
    const meta = { runId: 'r', diagramId: 'd', startedAt: '2026-11-07T10:00:00Z', status: 'failed', order: long.slice(0, 200) } as RunMeta;
    const runs = { list: async () => [meta], readEvents: async () => events, readDiagram: async () => diagram } as unknown as RunRepository;
    const past = await new RunHistory(new LiveRuns(), runs, new MemoryLibrary()).past('r');
    expect(past.order).toEqual({ text: long, files: [] });
  });
});
