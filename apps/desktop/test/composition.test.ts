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

  it('[R53.5] la revisión humana vuelve al paso que propone Claude, no al último', async () => {
    const reviewed: Diagram = {
      id: 'revisado',
      name: 'Revisado',
      schemaVersion: 1,
      nodes: [
        { id: 'entry', kind: 'entry' },
        { id: 'a', kind: 'agent', agentId: 'pintor', label: 'Plan' },
        { id: 'b', kind: 'agent', agentId: 'pintor', label: 'Obra' },
        { id: 'rev', kind: 'review', label: 'Revisión', review: { maxRounds: 3, mode: 'human' } },
        { id: 'output', kind: 'output' },
      ],
      edges: [
        { id: 'e1', from: 'entry', to: 'a' },
        { id: 'e2', from: 'a', to: 'b' },
        { id: 'e3', from: 'b', to: 'rev' },
        { id: 'e4', from: 'rev', to: 'output', port: 'approved' },
        { id: 'e5', from: 'rev', to: 'output', port: 'exhausted' },
      ],
    };
    const query: QueryFn = async function* ({ prompt }) {
      yield result(String(prompt).includes('Elige el paso') ? '{"nodeId":"a","reason":"el plan"}' : 'Hecho');
    };
    const handle = composeOrchestrator(context('claude'), query).start(reviewed, 'Pinta');
    const answers = ['Cambia el plan', 'lo propuesto', 'Aprobar'];
    handle.bus.subscribe((e) => {
      if (e.type === 'agent.question') setTimeout(() => handle.answer(e.questionId, answers.shift()!), 0);
    });
    const { events, status } = await handle.result;
    expect(status).toBe('succeeded');
    expect(events.find((e) => e.type === 'correction.routed')).toMatchObject({ targetId: 'a', reason: 'el plan' });
    expect(events.filter((e) => e.type === 'node.started' && e.nodeId === 'a')).toHaveLength(2);
  });

  it('[R53.10] corregir una ejecución terminada propone el paso que dice Claude', async () => {
    await store.diagrams.save({
      ...flow,
      nodes: [flow.nodes[0]!, { id: 'p', kind: 'agent', agentId: 'pintor', label: 'Plan' }, { id: 'q', kind: 'agent', agentId: 'pintor', label: 'Obra' }, flow.nodes[2]!],
      edges: [
        { id: 'e1', from: 'entry', to: 'p' },
        { id: 'e2', from: 'p', to: 'q' },
        { id: 'e3', from: 'q', to: 'output' },
      ],
    });
    const query: QueryFn = async function* ({ prompt }) {
      yield result(String(prompt).includes('Elige el paso') ? '{"nodeId":"p","reason":"el plan"}' : 'Hecho');
    };
    const svc = new RunService(composeRunPorts(store), composeOrchestrator(context('claude'), query));
    const { runId } = await svc.start({ diagramId: 'flujo', order: 'Pinta' });
    await svc.settled(runId);
    expect((await svc.proposeCorrection(runId, 'Cambia el plan')).proposal).toEqual({ nodeId: 'p', reason: 'el plan' });
  });

  it('[R58.2] un script que crea la rama, sin comandos git a la vista, llega como evento de la ejecución', async () => {
    await fs.mkdir(join(dir, '.git'));
    await fs.writeFile(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    const query: QueryFn = async function* () {
      yield { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'bash crear-feature.sh' } }] } } as SdkMessage;
      await fs.writeFile(join(dir, '.git', 'HEAD'), 'ref: refs/heads/001-feature\n');
      yield { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } } as SdkMessage;
      yield result('Hecho');
    };
    const { events } = await composeOrchestrator(context('claude'), query).start(flow, 'Pinta').result;
    expect(events.filter((e) => e.type === 'git.branch')).toMatchObject([{ nodeId: 'p', branch: '001-feature', via: 'head' }]);
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
