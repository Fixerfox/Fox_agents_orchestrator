import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueryFn, SdkMessage } from '@orquestador/claude';
import { promptText } from '@orquestador/claude';
import { defaultSettings, newAgent, type Diagram } from '@orquestador/core';
import { CHANNELS, parseRequest, type JobInfo, type QueuedRunView, type RunSummary } from '@orquestador/editor';
import { createDemoOrchestrator } from '@orquestador/runtime';
import { composeOrchestrator } from '../src/main/composition';
import { SettingsStore } from '@orquestador/store';
import { DesktopHandlers } from '../src/main/handlers';

let dir: string;
let h: DesktopHandlers;

const val = <T,>(r: unknown) => {
  const x = r as { ok: boolean; value?: T; error?: unknown };
  if (!x.ok) throw new Error(JSON.stringify(x.error));
  return x.value as T;
};
const result = (text: string): SdkMessage => ({ type: 'result', subtype: 'success', is_error: false, result: text, usage: { input_tokens: 1, output_tokens: 1 } });

const sub: Diagram = {
  id: 'sub',
  name: 'Revisión',
  schemaVersion: 1,
  nodes: [
    { id: 'entry', kind: 'entry' },
    { id: 'r', kind: 'agent', agentId: 'revisor' },
    { id: 'output', kind: 'output' },
  ],
  edges: [
    { id: 'a', from: 'entry', to: 'r' },
    { id: 'b', from: 'r', to: 'output' },
  ],
};
const main: Diagram = {
  id: 'main',
  name: 'Informe',
  schemaVersion: 1,
  nodes: [
    { id: 'entry', kind: 'entry' },
    { id: 'p', kind: 'agent', agentId: 'pintor' },
    { id: 'q', kind: 'agent', agentId: 'revisor' },
    { id: 's', kind: 'subdiagram', subdiagram: { templateId: 'sub', version: 'latest' } },
    { id: 'output', kind: 'output' },
  ],
  edges: [
    { id: 'e1', from: 'entry', to: 'p' },
    { id: 'e2', from: 'p', to: 'q' },
    { id: 'e3', from: 'q', to: 's' },
    { id: 'e4', from: 's', to: 'output' },
  ],
};

afterEach(async () => {
  h.dispose();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('SPEC-052 · copia de lo que usa cada ejecución', () => {
  let systems: string[];
  let release: () => void;
  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'orq-jobs-'));
    systems = [];
    let gate = new Promise<void>((r) => (release = r));
    const query: QueryFn = async function* ({ options }) {
      systems.push(options.systemPrompt ? promptText(options.systemPrompt) : '');
      // El primer paso de cada ejecución espera hasta que el test lo suelta.
      if (systems.length === 1) await gate;
      yield result('hecho');
    };
    h = new DesktopHandlers({ pickFolder: async () => join(dir, 'p'), createOrchestrator: (ctx) => composeOrchestrator(ctx, query), claudeQuery: query, settings: new SettingsStore(join(dir, 'config')) });
    void gate;
    gate = gate.then(() => undefined);
  });

  it('[R52.1] editar agentes y subdiagramas a mitad de una ejecución no la cambia; la siguiente usa lo nuevo', async () => {
    val(await h.invoke(CHANNELS.createProject, undefined));
    val(await h.invoke(CHANNELS.saveSettings, { ...defaultSettings(), engine: 'claude' }));
    val(await h.invoke(CHANNELS.saveAgent, { ...newAgent('pintor', 'Pintor'), instructions: 'Pinta' }));
    val(await h.invoke(CHANNELS.saveAgent, { ...newAgent('revisor', 'Revisor'), instructions: 'REVISA-VIEJO' }));
    val(await h.invoke(CHANNELS.saveAgent, { ...newAgent('otro', 'Otro'), instructions: 'OTRO-AGENTE' }));
    val(await h.invoke(CHANNELS.saveDiagram, sub));
    val(await h.invoke(CHANNELS.saveDiagram, main));
    const { runId } = val<{ runId: string }>(await h.invoke(CHANNELS.startRun, { diagramId: 'main', order: 'Haz el informe' }));
    await vi.waitFor(() => expect(systems).toHaveLength(1));
    // Mientras el primer paso trabaja, se cambian el revisor y el subdiagrama.
    val(await h.invoke(CHANNELS.saveAgent, { ...newAgent('revisor', 'Revisor'), instructions: 'REVISA-NUEVO' }));
    val(await h.invoke(CHANNELS.saveDiagram, { ...sub, nodes: sub.nodes.map((n) => (n.id === 'r' ? { ...n, agentId: 'otro' } : n)) }));
    release();
    await vi.waitFor(async () => expect(val<RunSummary[]>(await h.invoke(CHANNELS.listRuns, undefined)).find((r) => r.runId === runId)?.status).toBe('succeeded'));
    expect(systems).toHaveLength(3);
    expect(systems[1]).toContain('REVISA-VIEJO');
    expect(systems[2]).toContain('REVISA-VIEJO');
    expect(systems.join('\n')).not.toContain('REVISA-NUEVO');
    expect(systems.join('\n')).not.toContain('OTRO-AGENTE');
    // La siguiente ejecución ya usa lo nuevo.
    const next = val<{ runId: string }>(await h.invoke(CHANNELS.startRun, { diagramId: 'main', order: 'Otra vez' }));
    await vi.waitFor(async () => expect(val<RunSummary[]>(await h.invoke(CHANNELS.listRuns, undefined)).find((r) => r.runId === next.runId)?.status).toBe('succeeded'));
    expect(systems[4]).toContain('REVISA-NUEVO');
    expect(systems[5]).toContain('OTRO-AGENTE');
  });
});

describe('SPEC-052 · varias a la vez, cola y trabajos por IPC', () => {
  const chain: Diagram = {
    id: 'flujo',
    name: 'Flujo',
    schemaVersion: 1,
    nodes: [
      { id: 'entry', kind: 'entry' },
      { id: 'c', kind: 'agent', agentId: 'creador' },
      { id: 'output', kind: 'output' },
    ],
    edges: [
      { id: 'e1', from: 'entry', to: 'c' },
      { id: 'e2', from: 'c', to: 'output' },
    ],
  };
  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'orq-jobs-'));
    h = new DesktopHandlers({ pickFolder: async () => join(dir, 'p'), createOrchestrator: createDemoOrchestrator });
    val(await h.invoke(CHANNELS.createProject, undefined));
    val(await h.invoke(CHANNELS.saveDiagram, chain));
  });
  const answerAll = async (runId: string) => {
    for (const q of val<{ questionId: string }[]>(await h.invoke(CHANNELS.pendingQuestions, runId))) val(await h.invoke(CHANNELS.answerRun, { runId, questionId: q.questionId, text: 'Pixel art' }));
  };
  const runs = async () => val<RunSummary[]>(await h.invoke(CHANNELS.listRuns, undefined));

  it('[R52.2][R52.3] dos a la vez del mismo diagrama; una tercera «en cola» espera y arranca al terminar las dos', async () => {
    const a = val<{ runId: string }>(await h.invoke(CHANNELS.startRun, { diagramId: 'flujo', order: 'uno' }));
    const b = val<{ runId: string }>(await h.invoke(CHANNELS.startRun, { diagramId: 'flujo', order: 'dos', whenBusy: 'parallel' }));
    expect(a.runId).not.toBe(b.runId);
    const c = val<{ queuedId?: string; runId?: string }>(await h.invoke(CHANNELS.startRun, { diagramId: 'flujo', order: 'tres', whenBusy: 'queue' }));
    expect(c.queuedId).toBeTruthy();
    expect(c.runId).toBeUndefined();
    const d = val<{ queuedId?: string }>(await h.invoke(CHANNELS.startRun, { diagramId: 'flujo', order: 'cuatro', whenBusy: 'queue' }));
    expect(val<QueuedRunView[]>(await h.invoke(CHANNELS.listQueue, undefined)).map((q) => q.order)).toEqual(['tres', 'cuatro']);
    expect(val(await h.invoke(CHANNELS.unqueue, d.queuedId))).toBe(true);
    expect(val(await h.invoke(CHANNELS.unqueue, d.queuedId))).toBe(false);
    const [queued] = val<QueuedRunView[]>(await h.invoke(CHANNELS.listQueue, undefined));
    expect(queued).toMatchObject({ diagramId: 'flujo', diagramName: 'Flujo', order: 'tres' });
    await vi.waitFor(async () => expect((await runs()).filter((r) => r.status === 'running')).toHaveLength(2));
    await vi.waitFor(async () => expect(val<unknown[]>(await h.invoke(CHANNELS.pendingQuestions, a.runId))).toHaveLength(1));
    await answerAll(a.runId);
    await vi.waitFor(async () => expect((await runs()).find((r) => r.runId === a.runId)?.status).toBe('succeeded'));
    // Queda una en marcha: la de la cola sigue esperando.
    expect(val<QueuedRunView[]>(await h.invoke(CHANNELS.listQueue, undefined))).toHaveLength(1);
    await vi.waitFor(async () => expect(val<unknown[]>(await h.invoke(CHANNELS.pendingQuestions, b.runId))).toHaveLength(1));
    await answerAll(b.runId);
    await vi.waitFor(async () => expect(await runs()).toHaveLength(3));
    expect(val<QueuedRunView[]>(await h.invoke(CHANNELS.listQueue, undefined))).toEqual([]);
    const third = (await runs()).find((r) => r.runId !== a.runId && r.runId !== b.runId)!;
    expect(third.order).toBe('tres');
  });

  it('[R52.3] «en cola» sin nada en marcha arranca al momento; cerrar el proyecto vacía la cola', async () => {
    const r = val<{ runId?: string }>(await h.invoke(CHANNELS.startRun, { diagramId: 'flujo', order: 'sola', whenBusy: 'queue' }));
    expect(r.runId).toBeTruthy();
    val(await h.invoke(CHANNELS.startRun, { diagramId: 'flujo', order: 'detrás', whenBusy: 'queue' }));
    expect(val<QueuedRunView[]>(await h.invoke(CHANNELS.listQueue, undefined))).toHaveLength(1);
    val(await h.invoke(CHANNELS.closeProject, undefined));
    val(await h.invoke(CHANNELS.openProject, undefined));
    expect(val<QueuedRunView[]>(await h.invoke(CHANNELS.listQueue, undefined))).toEqual([]);
  });

  it('[R52.4] listJobs da cada diagrama con sus pasos y sus problemas', async () => {
    val(await h.invoke(CHANNELS.saveDiagram, { ...chain, id: 'roto', name: 'Roto', nodes: [...chain.nodes, { id: 'x', kind: 'agent' }] }));
    const jobs = val<JobInfo[]>(await h.invoke(CHANNELS.listJobs, undefined));
    expect(jobs.find((j) => j.id === 'flujo')).toEqual({ id: 'flujo', name: 'Flujo', steps: 1, problems: 0 });
    expect(jobs.find((j) => j.id === 'roto')!.problems).toBeGreaterThan(0);
  });

  it('[R52.4] el contrato valida whenBusy y el id de unqueue', () => {
    expect(parseRequest(CHANNELS.startRun, { diagramId: 'flujo', order: 'x', whenBusy: 'queue' })).toMatchObject({ whenBusy: 'queue' });
    expect(() => parseRequest(CHANNELS.startRun, { diagramId: 'flujo', order: 'x', whenBusy: 'ya' })).toThrow();
    expect(() => parseRequest(CHANNELS.unqueue, '../x')).toThrow();
  });
});
