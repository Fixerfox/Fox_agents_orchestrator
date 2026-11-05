import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newAgent, newSkill, reduceRunState, type Diagram, type RunEvent } from '@orquestador/core';
import { CHANNELS, parseRequest } from '@orquestador/editor';
import { createDemoOrchestrator } from '@orquestador/runtime';
import { DesktopHandlers } from '../src/main/handlers';

let dir: string;
let h: DesktopHandlers;
let pushed: { runId: string; events: RunEvent[] }[];

const chain: Diagram = {
  id: 'flujo',
  name: 'Flujo',
  schemaVersion: 1,
  nodes: [
    { id: 'entry', kind: 'entry' },
    { id: 'c', kind: 'agent', agentId: 'creador' },
    { id: 's', kind: 'agent', agentId: 'sprites' },
    { id: 'output', kind: 'output' },
  ],
  edges: [
    { id: 'e1', from: 'entry', to: 'c' },
    { id: 'e2', from: 'c', to: 's' },
    { id: 'e3', from: 's', to: 'output' },
  ],
};

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'orq-runs-'));
  pushed = [];
  h = new DesktopHandlers({
    pickFolder: async () => join(dir, 'p'),
    createOrchestrator: createDemoOrchestrator,
    push: (runId, events) => pushed.push({ runId, events }),
    batchMs: 10,
  });
});
afterEach(async () => {
  h.dispose();
  await fs.rm(dir, { recursive: true, force: true });
});

const val = <T,>(r: unknown) => {
  const x = r as { ok: boolean; value?: T; error?: unknown };
  if (!x.ok) throw new Error(JSON.stringify(x.error));
  return x.value as T;
};

async function openWithFlow() {
  await h.invoke(CHANNELS.createProject, undefined);
  await h.invoke(CHANNELS.saveDiagram, chain);
}

describe('ejecución por IPC [R19.7]', () => {
  it('[R19.7] iniciar, suscribirse, responder la pregunta y recibir todo en orden por lotes', async () => {
    await openWithFlow();
    const { runId } = val<{ runId: string }>(await h.invoke(CHANNELS.startRun, { diagramId: 'flujo', order: 'hazme un juego' }));
    const backlog = val<RunEvent[]>(await h.invoke(CHANNELS.subscribeRun, { runId, fromSeq: 1 }));

    await vi.waitFor(async () => {
      const q = val<{ questionId: string }[]>(await h.invoke(CHANNELS.pendingQuestions, runId));
      expect(q).toHaveLength(1);
    });
    const [q] = val<{ questionId: string; text: string }[]>(await h.invoke(CHANNELS.pendingQuestions, runId));
    expect(q!.text).toBe('¿Qué estilo prefieres?');
    expect(val(await h.invoke(CHANNELS.answerRun, { runId, questionId: q!.questionId, text: 'Pixel art' }))).toBe(true);
    expect(val(await h.invoke(CHANNELS.answerRun, { runId, questionId: q!.questionId, text: 'otra' }))).toBe(false);

    await vi.waitFor(() => expect(pushed.flatMap((p) => p.events).some((e) => e.type === 'run.finished')).toBe(true));
    const all = [...backlog, ...pushed.flatMap((p) => p.events)];
    expect(all.map((e) => e.seq)).toEqual(Array.from({ length: all.length }, (_, i) => i + 1));
    expect(reduceRunState(all).status).toBe('succeeded');
    expect(pushed.every((p) => p.runId === runId)).toBe(true);
    expect(pushed.length).toBeLessThan(pushed.flatMap((p) => p.events).length); // agrupados por lotes
  });

  it('[R19.7] pausar, reanudar y cancelar por IPC', async () => {
    await openWithFlow();
    const { runId } = val<{ runId: string }>(await h.invoke(CHANNELS.startRun, { diagramId: 'flujo', order: 'x' }));
    await h.invoke(CHANNELS.subscribeRun, { runId, fromSeq: 1 });
    for (const action of ['pause', 'resume', 'cancel'] as const) {
      expect(await h.invoke(CHANNELS.controlRun, { runId, action })).toEqual({ ok: true, value: null });
    }
    await vi.waitFor(() => expect(pushed.flatMap((p) => p.events).some((e) => e.type === 'run.finished')).toBe(true));
    const types = pushed.flatMap((p) => p.events).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['run.paused', 'run.resumed', 'run.cancelled']));
  });

  it('[R19.7] reconectar desde seq+1 devuelve solo lo que falta y la lista de ejecuciones', async () => {
    await openWithFlow();
    const { runId } = val<{ runId: string }>(await h.invoke(CHANNELS.startRun, { diagramId: 'flujo', order: 'x' }));
    await h.invoke(CHANNELS.controlRun, { runId, action: 'cancel' });
    await vi.waitFor(async () => expect(val<{ status: string }[]>(await h.invoke(CHANNELS.listRuns, undefined))[0]!.status).toBe('cancelled'));
    const all = val<RunEvent[]>(await h.invoke(CHANNELS.subscribeRun, { runId, fromSeq: 1 }));
    const rest = val<RunEvent[]>(await h.invoke(CHANNELS.subscribeRun, { runId, fromSeq: 3 }));
    expect(rest.map((e) => e.seq)).toEqual(all.slice(2).map((e) => e.seq));
    expect(await h.invoke(CHANNELS.unsubscribeRun, runId)).toEqual({ ok: true, value: null });
  });

  it('[R19.7] resultados: lista y lee solo dentro de output/', async () => {
    await openWithFlow();
    const { runId } = val<{ runId: string }>(await h.invoke(CHANNELS.startRun, { diagramId: 'flujo', order: 'x' }));
    await h.invoke(CHANNELS.controlRun, { runId, action: 'cancel' });
    await vi.waitFor(async () => expect(val<{ status: string }[]>(await h.invoke(CHANNELS.listRuns, undefined))[0]!.status).toBe('cancelled'));
    expect(val(await h.invoke(CHANNELS.listOutput, runId))).toEqual([]);
    expect(await h.invoke(CHANNELS.readOutput, { runId, path: '../meta.json' })).toMatchObject({ ok: false, error: { code: 'bad-request' } });
    expect(await h.invoke(CHANNELS.readOutput, { runId, path: 'nada.txt' })).toMatchObject({ ok: false, error: { code: 'not-found' } });
  });

  it('[R19.7] sin proyecto abierto no hay ejecuciones', async () => {
    expect(await h.invoke(CHANNELS.startRun, { diagramId: 'x', order: 'y' })).toMatchObject({ ok: false, error: { code: 'not-found' } });
    expect(await h.invoke(CHANNELS.listRuns, undefined)).toMatchObject({ ok: false });
  });

  it('[R19.7] un diagrama con problemas se rechaza con un mensaje sin rutas', async () => {
    await h.invoke(CHANNELS.createProject, undefined);
    await h.invoke(CHANNELS.saveDiagram, { ...chain, edges: [] });
    const res = await h.invoke(CHANNELS.startRun, { diagramId: 'flujo', order: 'x' });
    expect(res).toMatchObject({ ok: false, error: { code: 'invalid-diagram' } });
    expect(JSON.stringify(res)).not.toContain(dir);
  });

  it('[R19.7] una ejecución desconocida devuelve not-found', async () => {
    await openWithFlow();
    expect(await h.invoke(CHANNELS.controlRun, { runId: 'nope', action: 'pause' })).toMatchObject({ ok: false, error: { code: 'not-found' } });
    expect(await h.invoke(CHANNELS.subscribeRun, { runId: 'nope', fromSeq: 1 })).toMatchObject({ ok: false, error: { code: 'not-found' } });
  });

  it('[R19.7] valida la forma de cada petición de ejecución', () => {
    const bad: [string, unknown][] = [
      [CHANNELS.startRun, { diagramId: '../x', order: 'a' }],
      [CHANNELS.startRun, { diagramId: 'x', order: '' }],
      [CHANNELS.startRun, { diagramId: 'x', order: 'a', maxTokens: -1 }],
      [CHANNELS.startRun, { diagramId: 'x', order: 'a', cwd: '/tmp' }],
      [CHANNELS.controlRun, { runId: 'r', action: 'borrar' }],
      [CHANNELS.answerRun, { runId: 'r', questionId: '', text: 'a' }],
      [CHANNELS.subscribeRun, { runId: 'r', fromSeq: 0 }],
      [CHANNELS.subscribeRun, { runId: 'r', fromSeq: 1.5 }],
      [CHANNELS.readOutput, { runId: 'r', path: '' }],
      [CHANNELS.listOutput, '../r'],
      [CHANNELS.pendingQuestions, 5],
    ];
    for (const [c, p] of bad) expect(() => parseRequest(c, p), `${c} ${JSON.stringify(p)}`).toThrow(/no válid|no permitido/);
    expect(parseRequest(CHANNELS.startRun, { diagramId: 'x', order: 'a', maxTokens: 10, maxCostUsd: 0.5 })).toBeTruthy();
    expect(parseRequest(CHANNELS.subscribeRun, { runId: 'r', fromSeq: 4 })).toEqual({ runId: 'r', fromSeq: 4 });
  });

  it('[R19.5] cambiar de proyecto corta las suscripciones anteriores', async () => {
    const picks = [join(dir, 'p1'), join(dir, 'p2')];
    const h2 = new DesktopHandlers({
      pickFolder: async () => picks.shift() ?? null,
      createOrchestrator: createDemoOrchestrator,
      push: (runId, events) => pushed.push({ runId, events }),
      batchMs: 10,
    });
    await h2.invoke(CHANNELS.createProject, undefined);
    await h2.invoke(CHANNELS.saveDiagram, chain);
    const { runId } = val<{ runId: string }>(await h2.invoke(CHANNELS.startRun, { diagramId: 'flujo', order: 'x' }));
    await h2.invoke(CHANNELS.subscribeRun, { runId, fromSeq: 1 });
    await vi.waitFor(() => expect(pushed.length).toBeGreaterThan(0));
    await h2.invoke(CHANNELS.createProject, undefined); // segundo proyecto: sustituye al primero
    expect(await h2.invoke(CHANNELS.controlRun, { runId, action: 'pause' })).toMatchObject({ ok: false, error: { code: 'not-found' } });
    await new Promise((r) => setTimeout(r, 30));
    const before = pushed.length;
    await new Promise((r) => setTimeout(r, 120));
    expect(pushed.length).toBe(before);
    h2.dispose();
  });
});

describe('sin cerrojo de ejecución [R52.2]', () => {
  it('[R52.2] mientras se ejecuta, su diagrama, sus agentes y sus skills se pueden guardar y borrar', async () => {
    await openWithFlow();
    val(await h.invoke(CHANNELS.saveSkill, { ...newSkill('trazo', 'Trazo'), description: 'Contornos', body: 'Pasos' }));
    val(await h.invoke(CHANNELS.saveAgent, { ...newAgent('creador', 'Creador'), skillIds: ['trazo'] }));
    const { runId } = val<{ runId: string }>(await h.invoke(CHANNELS.startRun, { diagramId: 'flujo', order: 'hazme un juego' }));
    await vi.waitFor(async () => expect(val<unknown[]>(await h.invoke(CHANNELS.pendingQuestions, runId))).toHaveLength(1));
    val(await h.invoke(CHANNELS.saveDiagram, { ...chain, name: 'Flujo 2' }));
    val(await h.invoke(CHANNELS.saveAgent, { ...newAgent('creador', 'Creador 2'), skillIds: ['trazo'] }));
    val(await h.invoke(CHANNELS.saveSkill, { ...newSkill('trazo', 'Trazo'), description: 'Otro', body: 'x' }));
    expect(val(await h.invoke(CHANNELS.deleteAgent, 'creador'))).toBeTruthy();
    expect(val(await h.invoke(CHANNELS.deleteDiagram, 'flujo'))).toBe(true);
    // la ejecución sigue con su copia y termina
    const [q] = val<{ questionId: string }[]>(await h.invoke(CHANNELS.pendingQuestions, runId));
    val(await h.invoke(CHANNELS.answerRun, { runId, questionId: q!.questionId, text: 'Pixel art' }));
    await vi.waitFor(async () => expect(val<{ runId: string; status: string }[]>(await h.invoke(CHANNELS.listRuns, undefined)).find((r) => r.runId === runId)?.status).toBe('succeeded'));
  });

  it('[R32.38] borrar un diagrama por IPC', async () => {
    await openWithFlow();
    expect(val(await h.invoke(CHANNELS.deleteDiagram, 'flujo'))).toBe(true);
    expect(val(await h.invoke(CHANNELS.deleteDiagram, 'flujo'))).toBe(false);
    expect(val<unknown[]>(await h.invoke(CHANNELS.listDiagrams, undefined))).toEqual([]);
  });
});

