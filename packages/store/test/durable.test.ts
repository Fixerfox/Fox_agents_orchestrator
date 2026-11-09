import { promises as fs } from 'node:fs';
import * as nodeFs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { ProjectStore, readRunMeta, startLoggedRun } from '../src';
import { chain, cleanupTmp, orchestrator, tmp } from './helpers';

vi.mock('node:fs', async (original) => {
  const real = await original<typeof import('node:fs')>();
  return { ...real, fsyncSync: vi.fn(real.fsyncSync) };
});

cleanupTmp();

describe('SPEC-074 · lo que se escribe en disco', () => {
  it('[R74.10] tras cada paso terminado, decisión o respuesta, el registro se vacía al disco antes de seguir', async () => {
    const project = await ProjectStore.create(await tmp(), { name: 'p' });
    const sync = vi.mocked(nodeFs.fsyncSync);
    sync.mockClear();
    const { orch } = orchestrator({ a: {}, b: {} });
    const { logged } = startLoggedRun(orch, project, chain(['a', 'b']), 'x', {});
    const result = await logged;
    const succeeded = result.events.filter((e) => e.type === 'node.finished' && e.status === 'succeeded').length;
    expect(sync.mock.calls.length).toBe(succeeded);
  });

  it('[R74.11] meta.json guarda el último paso terminado y cuántos terminaron', async () => {
    const project = await ProjectStore.create(await tmp(), { name: 'p' });
    const { orch } = orchestrator({ a: {}, b: {} });
    const { handle, logged } = startLoggedRun(orch, project, chain(['a', 'b']), 'x', {});
    await logged;
    const meta = await readRunMeta(project.paths.runDir(handle.runId));
    expect(meta).toMatchObject({ lastStepKey: 'output#1', stepsDone: 4 });
    expect(JSON.parse(await fs.readFile(`${project.paths.runDir(handle.runId)}/meta.json`, 'utf8')).lastStepKey).toBe('output#1');
  });
});
