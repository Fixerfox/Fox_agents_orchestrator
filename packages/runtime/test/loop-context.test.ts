import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockAgent, MockDecider, defaultSettings, memoryEngine, type Diagram } from '@orquestador/core';
import { ProjectStore, libraryReaderOf } from '@orquestador/store';
import { createEngineOrchestrator } from '../src';

const LOOPED: Diagram = {
  id: 'b',
  name: 'Bucle',
  schemaVersion: 1,
  nodes: [
    { id: 'entry', kind: 'entry' },
    {
      id: 'l',
      kind: 'loop',
      label: 'Hasta que cumpla',
      loop: {
        mode: 'count',
        count: 2,
        maxIterations: 2,
        body: { id: 'cuerpo', name: 'Cuerpo', schemaVersion: 1, nodes: [{ id: 'entry', kind: 'entry' }, { id: 'a', kind: 'agent', agentId: 'a' }, { id: 'output', kind: 'output' }], edges: [{ id: 'b1', from: 'entry', to: 'a' }, { id: 'b2', from: 'a', to: 'output' }] },
      },
    },
    { id: 'output', kind: 'output' },
  ],
  edges: [
    { id: 'e1', from: 'entry', to: 'l' },
    { id: 'e2', from: 'l', to: 'output' },
  ],
};

let dir: string;
let store: ProjectStore;
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'orq-loop-'));
  store = await ProjectStore.create(dir, { name: 'p' });
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

describe('SPEC-084 · la app enciende el contexto del bucle', () => {
  it('[R84.6] el orquestador de la app da a cada agente del cuerpo su vuelta', async () => {
    const agents = new MockAgent({ a: { output: 'Hecho' } });
    const orch = createEngineOrchestrator({ library: libraryReaderOf(store), settings: () => ({ ...defaultSettings(), engine: 'mem' as never }) }, [memoryEngine('mem', { adapter: agents, decider: new MockDecider() })]);
    const res = await orch.start(LOOPED, 'Pedido').result;
    expect(res.status).toBe('succeeded');
    expect(agents.callsOf('a').map((c) => c.loop?.split('\n')[2])).toEqual(['Bucle «Hasta que cumpla»: vuelta 1 de 2.', 'Bucle «Hasta que cumpla»: vuelta 2 de 2.']);
  });
});
