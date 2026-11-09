import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { memoryFiles } from '@orquestador/core';
import { ProjectStore, readRunLog, startLoggedRun } from '../src';
import { chain, cleanupTmp, deferred, orchestrator, tmp } from './helpers';

cleanupTmp();

describe('SPEC-072 · la memoria en disco', () => {
  it('[R72.20] escribe memory.json (con versión) y memory.md al terminar cada paso y al final', async () => {
    const project = await ProjectStore.create(await tmp(), { name: 'p' });
    const gate = deferred();
    const { orch } = orchestrator({ a: { output: 'Hice el plan.' }, b: { waitFor: gate.promise } });
    const { handle, logged } = startLoggedRun(orch, project, chain(['a', 'b']), 'x');
    const runDir = project.paths.runDir(handle.runId);
    // Al terminar «a» ya está, aunque la ejecución siga.
    for (let i = 0; i < 50 && !existsSync(path.join(runDir, 'memory.md')); i++) await new Promise((r) => setTimeout(r, 10));
    expect(await fs.readFile(path.join(runDir, 'memory.md'), 'utf8')).toContain('Hice el plan.');
    gate.resolve();
    await logged;
    const json = JSON.parse(await fs.readFile(path.join(runDir, 'memory.json'), 'utf8')) as { schemaVersion: number; steps: { nodeId: string }[] };
    expect(json.schemaVersion).toBe(1);
    expect(json.steps.map((s) => s.nodeId)).toEqual(['a', 'b']);
    // Los eventos siguen mandando: de events.jsonl sale lo mismo.
    const { events } = await readRunLog(runDir);
    expect(await fs.readFile(path.join(runDir, 'memory.md'), 'utf8')).toBe(memoryFiles(events, (id) => id).markdown);
  });
});
