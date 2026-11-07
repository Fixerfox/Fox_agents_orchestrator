import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Diagram } from '@orquestador/core';
import { CHANNELS } from '@orquestador/editor';
import { createDemoOrchestrator } from '@orquestador/runtime';
import { DesktopHandlers } from '../src/main/handlers';

let dir: string;
let h: DesktopHandlers;
const flow: Diagram = {
  id: 'flujo',
  name: 'Flujo',
  schemaVersion: 1,
  nodes: [{ id: 'entry', kind: 'entry' }, { id: 'c', kind: 'agent', agentId: 'creador' }, { id: 'output', kind: 'output' }],
  edges: [{ id: 'e1', from: 'entry', to: 'c' }, { id: 'e2', from: 'c', to: 'output' }],
};
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'orq-accept-'));
  h = new DesktopHandlers({ pickFolder: async () => join(dir, 'p'), createOrchestrator: createDemoOrchestrator, push: () => undefined, batchMs: 10 });
});
afterEach(async () => {
  h.dispose();
  await fs.rm(dir, { recursive: true, force: true });
});
const result = (r: unknown) => r as { ok: boolean; value?: unknown; error?: { code: string; message: string } };

describe('SPEC-065 · run:accept en la app de escritorio', () => {
  it('[R65.6] el proceso principal valida la petición y no acepta una que no falló', { timeout: 30_000 }, async () => {
    await h.invoke(CHANNELS.createProject, undefined);
    await h.invoke(CHANNELS.saveDiagram, flow);
    const { runId } = result(await h.invoke(CHANNELS.startRun, { diagramId: 'flujo', order: 'Dibuja' })).value as { runId: string };
    // El agente de demostración pregunta: se cancela, que tampoco es una ejecución fallida.
    await h.invoke(CHANNELS.controlRun, { runId, action: 'cancel' });
    await vi.waitFor(async () => expect((result(await h.invoke(CHANNELS.listRuns, undefined)).value as { runId: string; status: string }[]).find((r) => r.runId === runId)?.status).toBe('cancelled'), { timeout: 10_000 });
    expect(result(await h.invoke(CHANNELS.acceptRun, { runId, by: 'user', reason: 'vale' }))).toEqual({ ok: true, value: false });
    expect(result(await h.invoke(CHANNELS.acceptRun, { runId, by: 'user', reason: '' })).ok).toBe(false);
    expect(result(await h.invoke(CHANNELS.acceptRun, { runId: 'no-existe', by: 'user', reason: 'vale' })).error?.code).toBe('not-found');
  });
});
