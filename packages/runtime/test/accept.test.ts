import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockDecider, Orchestrator, type Diagram } from '@orquestador/core';
import { ProjectStore } from '@orquestador/store';
import { RunService } from '../src';
import { portsOf } from './ports';

const D: Diagram = {
  id: 'd',
  name: 'D',
  schemaVersion: 1,
  nodes: [{ id: 'entry', kind: 'entry' }, { id: 'a', kind: 'agent', agentId: 'a' }, { id: 'output', kind: 'output' }],
  edges: [{ id: 'e1', from: 'entry', to: 'a' }, { id: 'e2', from: 'a', to: 'output' }],
};

let dir: string;
let store: ProjectStore;
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'orq-acc-'));
  store = await ProjectStore.create(dir, { name: 'p' });
  await store.diagrams.save(D);
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

/** `fail`: la comprobación final dice que no cumple lo pedido, como en el caso real. */
function service(fail: boolean) {
  const adapter = {
    async *run() {
      yield { type: 'result', text: 'hecho' };
    },
  };
  const decider = new MockDecider({ supervise: () => Promise.resolve({ ok: true, reason: '', summary: 'ok' }), verifyRun: () => Promise.resolve(fail ? { met: false, missing: 'Falta medir 30 minutos' } : { met: true, missing: '' }) });
  const orch = new Orchestrator({ getAdapter: () => adapter as never, decider, supervisor: { review: () => true } } as never);
  return new RunService(portsOf(store), orch);
}

describe('SPEC-065 · dar por buena una ejecución', () => {
  it('[R65.5][R65.6] añade run.accepted al registro y la deja terminada bien, sin perder por qué falló', async () => {
    const svc = service(true);
    const { runId } = await svc.start({ diagramId: 'd', order: 'pedido' });
    await svc.settled(runId);
    const before = (await svc.list()).find((m) => m.runId === runId)!;
    expect(before.status).toBe('failed');
    expect(await svc.accept(runId, { by: 'user', reason: '  El fallo no importa  ' })).toBe(true);
    const meta = (await svc.list()).find((m) => m.runId === runId)!;
    expect(meta).toMatchObject({ status: 'succeeded', reason: 'El fallo no importa', accepted: { by: 'user', reason: 'El fallo no importa', previousReason: 'No cumple lo pedido: Falta medir 30 minutos' } });
    expect(before.reason).toBe('No cumple lo pedido: Falta medir 30 minutos');
    const lines = (await fs.readFile(join(store.paths.runDir(runId), 'events.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l) as { type: string; seq: number });
    expect(lines.at(-1)).toMatchObject({ type: 'run.accepted', by: 'user', reason: 'El fallo no importa' });
    expect(lines.at(-1)!.seq).toBe(lines.at(-2)!.seq + 1);
    // ya no está fallida: aceptar otra vez no hace nada, y no se reanuda
    expect(await svc.accept(runId, { by: 'assistant', reason: 'otra vez' })).toBe(false);
    await expect(svc.resumeRun(runId)).rejects.toThrow(/Solo se reanuda/);
  });

  it('[R65.6] exige un motivo, no acepta una que terminó bien y avisa si no existe', async () => {
    const svc = service(false);
    const { runId } = await svc.start({ diagramId: 'd', order: 'pedido' });
    await svc.settled(runId);
    await expect(svc.accept(runId, { by: 'user', reason: '   ' })).rejects.toThrow(/por qué/);
    await expect(svc.accept(runId, { by: 'user', reason: 'x'.repeat(2001) })).rejects.toThrow(/2000/);
    expect(await svc.accept(runId, { by: 'user', reason: 'vale' })).toBe(false);
    await expect(svc.accept('no-existe', { by: 'user', reason: 'vale' })).rejects.toThrow(/No existe/);
  });
});
