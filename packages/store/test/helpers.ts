import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach } from 'vitest';
import {
  MockAgent,
  MockDecider,
  Orchestrator,
  type Diagram,
  type DiagramNode,
  type Edge,
  type MockAgentScript,
} from '@orquestador/core';

const dirs: string[] = [];

export async function tmp(prefix = 'orq-'): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

export function cleanupTmp(): void {
  afterEach(async () => {
    for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
  });
}

export const ENTRY: DiagramNode = { id: 'entry', kind: 'entry' };
export const OUTPUT: DiagramNode = { id: 'output', kind: 'output' };
export const agent = (id: string): DiagramNode => ({ id, kind: 'agent', agentId: id, label: id });
export const edge = (from: string, to: string): Edge => ({ id: `${from}->${to}`, from, to });

export function chain(ids: string[], id = 'd'): Diagram {
  const all = ['entry', ...ids, 'output'];
  return {
    id,
    name: id,
    schemaVersion: 1,
    nodes: [ENTRY, ...ids.map(agent), OUTPUT],
    edges: all.slice(1).map((to, i) => edge(all[i]!, to)),
  };
}

export function orchestrator(scripts: Record<string, MockAgentScript> = {}) {
  const agents = new MockAgent(scripts);
  const orch = new Orchestrator({
    getAdapter: () => agents,
    decider: new MockDecider(),
    sleep: async () => undefined,
  });
  return { agents, orch };
}

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
