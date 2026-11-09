import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { QueryFn, SdkMessage } from '@orquestador/claude';
import { defaultSettings, newAgent, type AppSettings, type Diagram } from '@orquestador/core';
import { RunService } from '@orquestador/runtime';
import type { ProjectStore } from '@orquestador/store';
import { cleanupSpaces, composeOrchestrator, composeRunPorts, createProject, type OrchestratorContext } from '../src/main/composition';

const fan: Diagram = {
  id: 'abanico',
  name: 'Abanico',
  schemaVersion: 1,
  nodes: [
    { id: 'entry', kind: 'entry' },
    { id: 'w', kind: 'agent', agentId: 'pintor', label: 'Web', task: 'web.md' },
    { id: 'a', kind: 'agent', agentId: 'pintor', label: 'Api', task: 'api.md' },
    { id: 'output', kind: 'output' },
  ],
  edges: [
    { id: 'e1', from: 'entry', to: 'w' },
    { id: 'e2', from: 'entry', to: 'a' },
    { id: 'e3', from: 'w', to: 'output' },
    { id: 'e4', from: 'a', to: 'output' },
  ],
};
const result = (text: string): SdkMessage => ({ type: 'result', subtype: 'success', is_error: false, result: text, usage: { input_tokens: 3, output_tokens: 2 }, total_cost_usd: 0.001 });

let dir: string;
let data: string;
let store: ProjectStore;
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'orq-ciso-'));
  data = await fs.mkdtemp(join(tmpdir(), 'orq-datos-'));
  store = await createProject(dir, { name: 'p' });
  await store.diagrams.save(fan);
  await store.saveAgent({ ...newAgent('pintor', 'Pintor'), instructions: 'Pinta' });
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.rm(data, { recursive: true, force: true });
});

const context = (more: Partial<AppSettings> = {}): OrchestratorContext => ({ store, projectRoot: dir, settings: () => ({ ...defaultSettings(), engine: 'claude', supervisorReview: false, permissions: 'full', ...more }), apiKey: async () => undefined, spacesRoot: join(data, 'spaces') });

/** Cada paso escribe el archivo de su tarea en su carpeta actual, pasando por la política. */
const writing = (cwds: string[]): QueryFn =>
  async function* ({ prompt, options }) {
    cwds.push(options.cwd!);
    const file = /(\w+\.md)/.exec(String(prompt))?.[1] ?? 'x.md';
    await options.canUseTool!('Write', { file_path: file, content: 'x' }, { signal: new AbortController().signal, toolUseID: file });
    await fs.writeFile(join(options.cwd!, file), `de ${file}`);
    yield result('Hecho');
  };

describe('SPEC-073 · la app aísla las ramas en paralelo', () => {
  it('[R73.2][R73.6][R73.11] cada rama trabaja en su espacio, fuera de la carpeta, y al acabar todo está junto', async () => {
    const cwds: string[] = [];
    const svc = new RunService(composeRunPorts(store), composeOrchestrator(context(), writing(cwds)));
    const { runId } = await svc.start({ diagramId: 'abanico', order: 'Pinta' });
    await svc.settled(runId);
    expect((await svc.list())[0]).toMatchObject({ runId, status: 'succeeded' });
    expect(cwds).toHaveLength(2);
    expect(new Set(cwds).size).toBe(2);
    for (const c of cwds) expect(c.startsWith(join(data, 'spaces'))).toBe(true);
    expect(await fs.readFile(join(dir, 'web.md'), 'utf8')).toBe('de web.md');
    expect(await fs.readFile(join(dir, 'api.md'), 'utf8')).toBe('de api.md');
    // Los espacios se borran al acabar [R73.18].
    expect(await fs.readdir(join(data, 'spaces'))).toEqual([]);
  });

  it('[R73.2] con «Aislar las ramas en paralelo» apagado, comparten la carpeta como antes', async () => {
    const cwds: string[] = [];
    const svc = new RunService(composeRunPorts(store), composeOrchestrator(context({ isolateBranches: false }), writing(cwds)));
    const { runId } = await svc.start({ diagramId: 'abanico', order: 'Pinta' });
    await svc.settled(runId);
    expect(cwds).toEqual([dir, dir]);
  });

  it('[R73.18] al arrancar la app se borran los espacios que quedaron de un cierre inesperado', async () => {
    await fs.mkdir(join(data, 'spaces', '001-web-abc'), { recursive: true });
    await fs.writeFile(join(data, 'spaces', '001-web-abc', 'a.txt'), 'a');
    expect(await cleanupSpaces(join(data, 'spaces'), [dir])).toBe(1);
    expect(await fs.readdir(join(data, 'spaces'))).toEqual([]);
  });
});
