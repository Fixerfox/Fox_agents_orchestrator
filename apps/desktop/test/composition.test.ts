import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promptText, type QueryFn, type SdkMessage } from '@orquestador/claude';
import { defaultSettings, newAgent, newContext, type AppSettings, type Diagram } from '@orquestador/core';
import { RunService, RunSnapshots, takeSnapshot } from '@orquestador/runtime';
import type { ProjectStore } from '@orquestador/store';
import { claudeEnvironment, composeLibrary, composeOrchestrator, composeRunPorts, createProject, openProject, type OrchestratorContext } from '../src/main/composition';

const flow: Diagram = {
  id: 'flujo',
  name: 'Flujo',
  schemaVersion: 1,
  nodes: [
    { id: 'entry', kind: 'entry' },
    { id: 'p', kind: 'agent', agentId: 'pintor' },
    { id: 'output', kind: 'output' },
  ],
  edges: [
    { id: 'e1', from: 'entry', to: 'p' },
    { id: 'e2', from: 'p', to: 'output' },
  ],
};

const result = (text: string): SdkMessage => ({ type: 'result', subtype: 'success', is_error: false, result: text, usage: { input_tokens: 3, output_tokens: 2 }, total_cost_usd: 0.001 });

let dir: string;
let store: ProjectStore;
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'orq-comp-'));
  store = await createProject(dir, { name: 'p' });
  await store.diagrams.save(flow);
  await store.saveAgent({ ...newAgent('pintor', 'Pintor'), instructions: 'PINTA-ORIGINAL' });
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

function context(engine: AppSettings['engine'], snapshots?: RunSnapshots): OrchestratorContext {
  return { store, projectRoot: dir, settings: () => ({ ...defaultSettings(), engine }), apiKey: async () => undefined, ...(snapshots ? { snapshots } : {}) };
}

describe('SPEC-056 · composición de la aplicación', () => {
  it('[R56.5] crea y abre proyectos', async () => {
    expect((await (await openProject(dir)).info()).name).toBe('p');
    await expect(openProject(join(dir, 'no-existe'))).rejects.toThrow();
  });

  it('[R56.5] conecta el motor de Claude: una ejecución real pasa por la consulta inyectada', async () => {
    const prompts: string[] = [];
    const query: QueryFn = async function* ({ options }) {
      prompts.push(options.systemPrompt ? promptText(options.systemPrompt) : '');
      yield result('Hecho');
    };
    const svc = new RunService(composeRunPorts(store), composeOrchestrator(context('claude'), query));
    const { runId } = await svc.start({ diagramId: 'flujo', order: 'Pinta' });
    await svc.settled(runId);
    expect((await svc.list())[0]).toMatchObject({ runId, status: 'succeeded' });
    expect(prompts.join('\n')).toContain('PINTA-ORIGINAL');
  });

  it('[R56.5] con el motor simulado no se llama a Claude', async () => {
    let calls = 0;
    const query: QueryFn = async function* () {
      calls++;
      yield result('no');
    };
    const svc = new RunService(composeRunPorts(store), composeOrchestrator(context('simulated'), query));
    const { runId } = await svc.start({ diagramId: 'flujo', order: 'Pinta' });
    await svc.settled(runId);
    expect(calls).toBe(0);
  });

  it('[R56.5] el entorno de Claude lee de la copia de la ejecución si la hay', async () => {
    await store.saveContext({ ...newContext('estilo', 'Estilo'), value: 'antes' });
    const snapshots = new RunSnapshots();
    snapshots.set('r1', await takeSnapshot(composeLibrary(store), flow));
    await store.saveAgent({ ...newAgent('pintor', 'Pintor'), instructions: 'PINTA-NUEVO' });
    await store.saveContext({ ...newContext('estilo', 'Estilo'), value: 'después' });
    const env = claudeEnvironment(context('claude', snapshots));
    expect((await env.loadAgent('pintor', 'r1'))?.instructions).toBe('PINTA-ORIGINAL');
    expect((await env.loadAgent('pintor', 'r2'))?.instructions).toBe('PINTA-NUEVO');
    expect((await env.loadContexts(['estilo'], 'r1'))[0]?.value).toBe('antes');
    expect((await env.loadContexts(['estilo'])).map((c) => c.value)).toEqual(['después']);
  });

  it('[R56.5] la política de rutas que recibe el servicio no enseña secretos', () => {
    const { policy } = composeRunPorts(store);
    expect(policy.isPreviewable('.env')).toBe(false);
    expect(policy.isPreviewable('web/index.html')).toBe(true);
  });
});
